import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repository = "owner/repo";
const script = path.resolve("scripts/comment-pr-description.mjs");
// Exercise the actual CLI guard with a stubbed built-in fetch. No network or
// credentials are needed, even if a regression mistakenly reaches the API.
const runner = `
import { pathToFileURL } from "node:url";
process.argv[1] = process.env.TEST_FEEDBACK_SCRIPT;
const scenario = process.env.TEST_FEEDBACK_SCENARIO;
const pr = number => ({
  number, state: "closed", merged: false, closed_at: "2020-01-02T03:04:05Z",
  merge_commit_sha: null,
  base: { ref: "main", repo: { full_name: "owner/repo" } },
  head: { ref: "feature/" + number, sha: "a".repeat(40), repo: { full_name: "owner/repo" } }
});

const original = {
  id: 900,
  body: "<!-- grammar-learning-site-builder:pr-description -->\\nOld feedback",
  user: { login: "github-actions[bot]", type: "Bot" }
};
globalThis.fetch = async (input, init = {}) => {
  const route = new URL(input).pathname.replace("/repos/owner/repo", "");
  console.log("API request:", init.method ?? "GET", new URL(input).pathname);
  const success = value => ({ ok: true, status: 200, json: async () => value });
  if (scenario === "list-failure" && route === "/pulls") return { ok: false, status: 503 };
  if (scenario === "unknown-failure" && route === "/pulls") throw new Error("private test-token content");
  if (scenario === "empty") return success([]);
  if (route === "/pulls") return success([pr(7), pr(8)]);
  if (route === "/pulls/7") return success(pr(7));
  if (route === "/pulls/8") return success(pr(8));
  if (route === "/issues/7/comments") return success([original]);
  if (route === "/issues/8/comments") return success([]);
  if (route === "/issues/7/labels") return success([{name:"needs-description"}, {name:"documentation"}]);
  if (route === "/issues/8/labels") return success([{name:"documentation"}]);
  if (route === "/issues/7/labels/needs-description" && init.method === "DELETE")
    return { ok: true, status: 204 };
  if (route === "/issues/comments/900" && init.method === "PATCH") {
    if (scenario === "partial-failure") return { ok: false, status: 500 };
    return success({ ...original, body: JSON.parse(init.body).body });
  }
  throw new Error("Unexpected fixture API route");
};
await import(pathToFileURL(process.argv[1]).href);
`;

function invoke(
  eventName: string,
  {
    ref = "refs/heads/main",
    event = { repository: { full_name: repository, default_branch: "main" } },
    scenario = "empty",
    summaryMode = "absent",
  }: {
    ref?: string;
    event?: unknown;
    scenario?:
      | "empty"
      | "mixed"
      | "list-failure"
      | "unknown-failure"
      | "partial-failure";
    summaryMode?: "absent" | "file" | "directory";
  } = {},
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pr-feedback-event-"));
  try {
    const eventPath = path.join(directory, "event.json");
    const summaryPath = path.join(directory, "summary.md");
    writeFileSync(eventPath, JSON.stringify(event));
    if (summaryMode === "file")
      writeFileSync(summaryPath, "Earlier summary content\n");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", runner],
      {
        env: {
          ...process.env,
          TEST_FEEDBACK_SCRIPT: script,
          TEST_FEEDBACK_SCENARIO: scenario,
          GITHUB_EVENT_NAME: eventName,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: repository,
          GITHUB_REF: ref,
          GITHUB_API_URL: "https://api.github.com",
          GITHUB_TOKEN: "test-token",
          GITHUB_STEP_SUMMARY:
            summaryMode === "file"
              ? summaryPath
              : summaryMode === "directory"
                ? directory
                : "",
        },
        encoding: "utf8",
      },
    );
    return {
      ...result,
      summary: existsSync(summaryPath)
        ? readFileSync(summaryPath, "utf8")
        : null,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("trusted scheduled and manual CLI dispatch", () => {
  it.each(["schedule", "workflow_dispatch"])(
    "runs a default-branch %s sweep without a source workflow or PR inputs",
    (eventName) => {
      const result = invoke(eventName);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        "API request: GET /repos/owner/repo/pulls",
      );
      expect(result.stdout).toContain("PR description feedback: []");
      expect(result.stdout).not.toContain("/actions/");
      expect(result.stdout + result.stderr).not.toContain("test-token");
    },
  );

  it("uses the actual default branch instead of hard-coding main", () => {
    const result = invoke("workflow_dispatch", {
      ref: "refs/heads/trunk",
      event: {
        repository: { full_name: "Owner/Repo", default_branch: "trunk" },
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PR description feedback: []");
  });

  for (const eventName of ["schedule", "workflow_dispatch"]) {
    it.each([
      { ref: "refs/heads/feature/untrusted" },
      { ref: "refs/tags/main" },
      { ref: "" },
      {
        event: {
          repository: { full_name: "other/repo", default_branch: "main" },
        },
      },
      { event: { repository: { full_name: repository } } },
      { event: {} },
    ])("rejects an untrusted " + eventName + " context: %j", (options) => {
      const result = invoke(eventName, options);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("trusted default branch");
      expect(result.stdout).not.toContain("API request:");
      expect(result.stdout + result.stderr).not.toContain("test-token");
    });
  }

  it("keeps the existing workflow-run metadata checks separate from sweeps", () => {
    const result = invoke("workflow_run");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "invalid description workflow-run metadata",
    );
    expect(result.stdout).not.toContain("API request:");
  });

  it("does not let a PR event authorize a sweep even on a matching ref", () => {
    const result = invoke("pull_request");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("trusted workflow_run context");
    expect(result.stdout).not.toContain("API request:");
  });
});

describe("scheduled and manual Actions summaries", () => {
  it.each(["schedule", "workflow_dispatch"])(
    "appends a linked per-PR result summary for a successful %s sweep",
    (eventName) => {
      const result = invoke(eventName, {
        scenario: "mixed",
        summaryMode: "file",
      });
      expect(result.status).toBe(0);
      expect(result.summary).toMatch(/^Earlier summary content\n/);
      expect(result.summary).toMatch(/scanned/i);
      expect(result.summary).toMatch(/repaired/i);
      expect(result.summary).toMatch(/skipped/i);
      expect(result.summary).toMatch(/failed/i);
      expect(result.summary).toContain("https://github.com/owner/repo/pull/7");
      expect(result.summary).toContain("https://github.com/owner/repo/pull/8");
      expect(result.stdout).toContain('"labelRemoved":true');
      expect(result.summary + result.stdout + result.stderr).not.toContain(
        "test-token",
      );
    },
  );

  it("writes an empty-scan summary and still succeeds", () => {
    const result = invoke("workflow_dispatch", { summaryMode: "file" });
    expect(result.status).toBe(0);
    expect(result.summary).toMatch(/scanned/i);
    expect(result.summary).toContain("0");
    expect(result.summary).not.toContain("/pull/7");
  });

  it("retains partial repairs and failures in the summary while returning a failed exit status", () => {
    const result = invoke("workflow_dispatch", {
      scenario: "partial-failure",
      summaryMode: "file",
    });
    expect(result.status).toBe(1);
    expect(result.summary).toContain("https://github.com/owner/repo/pull/7");
    expect(result.summary).toContain("https://github.com/owner/repo/pull/8");
    expect(result.summary).toContain("500");
    expect(result.summary).toMatch(/failed/i);
    expect(result.stdout).toContain('"labelRemoved":true');
    expect(result.stdout).toContain('"commentUpdated":false');
    expect(result.stderr).toContain("500");
  });

  it("writes a discovery failure summary without inventing failed PRs", () => {
    const result = invoke("schedule", {
      scenario: "list-failure",
      summaryMode: "file",
    });
    expect(result.status).toBe(1);
    expect(result.summary).toContain("503");
    expect(result.summary).toMatch(/incomplete|discovery|scan.*fail/i);
    expect(result.summary).not.toContain("https://github.com/owner/repo/pull/");
  });

  it("does not include arbitrary exception messages in the Actions summary or diagnostic report", () => {
    const result = invoke("schedule", {
      scenario: "unknown-failure",
      summaryMode: "file",
    });
    expect(result.status).toBe(1);
    expect(result.summary).toBeTruthy();
    expect(result.summary + result.stdout + result.stderr).not.toMatch(
      /private|test-token/,
    );
  });

  it("allows local CLI runs without a summary environment file", () => {
    const result = invoke("workflow_dispatch", { scenario: "mixed" });
    expect(result.status).toBe(0);
    expect(result.summary).toBeNull();
  });

  it.each([
    { eventName: "workflow_dispatch", ref: "refs/heads/untrusted" },
    { eventName: "pull_request", ref: "refs/heads/main" },
  ])(
    "does not write a sweep summary in an untrusted context: %j",
    ({ eventName, ref }) => {
      const result = invoke(eventName, { ref, summaryMode: "file" });
      expect(result.status).toBe(1);
      expect(result.summary).toBe("Earlier summary content\n");
      expect(result.stdout).not.toContain("API request:");
    },
  );

  it("does not add a sweep summary to event-driven workflow-run feedback", () => {
    const result = invoke("workflow_run", {
      summaryMode: "file",
      event: {
        workflow_run: {
          name: "PR description",
          event: "pull_request",
          status: "completed",
          path: ".github/workflows/pr-description.yml",
          repository: { full_name: repository },
          head_repository: { full_name: "contributor/fork" },
          head_branch: "feature/feedback",
          head_sha: "a".repeat(40),
          pull_requests: [],
        },
      },
    });
    expect(result.status).toBe(0);
    expect(result.summary).toBe("Earlier summary content\n");
  });

  it("fails visibly if a successful sweep cannot write its requested summary", () => {
    const result = invoke("workflow_dispatch", { summaryMode: "directory" });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/summary/i);
    expect(result.stdout).toContain("API request:");
  });

  it("preserves the API failure when writing the summary also fails", () => {
    const result = invoke("workflow_dispatch", {
      scenario: "list-failure",
      summaryMode: "directory",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("503");
    expect(result.stderr).toMatch(/summary/i);
    expect(result.stdout + result.stderr).not.toContain("test-token");
  });
});
