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
const script = path.resolve("scripts/alert-pr-cleanup.mjs");
// Run the actual CLI while stubbing fetch before its import. A guard regression
// cannot make an authenticated network request or expose a real token.
const runner = `
import { pathToFileURL } from "node:url";
process.argv[1] = process.env.TEST_ALERT_SCRIPT;
const scenario = process.env.TEST_ALERT_SCENARIO;
globalThis.fetch = async (input, init = {}) => {
  const route = new URL(input).pathname.replace("/repos/owner/repo", "");
  console.log("API request:", init.method ?? "GET", route);
  if (scenario === "api-http") return { ok: false, status: 503 };
  if (scenario === "api-transport") throw new Error("private test-token transport detail");
  const success = value => ({ ok: true, status: 200, json: async () => value });
  if (route === "/issues" && !init.method) return success([]);
  if (route === "/issues" && init.method === "POST") {
    const body = JSON.parse(init.body);
    return success({
      ...body, id: 900, number: 42, state: "open",
      user: { login: "github-actions[bot]", type: "Bot" },
      html_url: "https://github.com/owner/repo/issues/42"
    });
  }
  throw new Error("Unexpected fixture API route");
};
await import(pathToFileURL(process.argv[1]).href);
`;

function invoke(
  eventName = "schedule",
  {
    event = { repository: { full_name: repository, default_branch: "main" } },
    env = {},
    scenario = "healthy",
    summaryMode = "absent",
  }: {
    event?: unknown;
    env?: Record<string, string>;
    scenario?: "healthy" | "api-http" | "api-transport";
    summaryMode?: "absent" | "file" | "directory";
  } = {},
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pr-cleanup-alert-"));
  try {
    const eventPath = path.join(directory, "event.json");
    const summaryPath = path.join(directory, "summary.md");
    writeFileSync(eventPath, JSON.stringify(event));
    if (summaryMode === "file") writeFileSync(summaryPath, "Earlier notes\n");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", runner],
      {
        env: {
          ...process.env,
          TEST_ALERT_SCRIPT: script,
          TEST_ALERT_SCENARIO: scenario,
          GITHUB_EVENT_NAME: eventName,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: repository,
          GITHUB_REF: "refs/heads/main",
          GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/pr-description-comment.yml@refs/heads/main`,
          GITHUB_API_URL: "https://api.github.com",
          GITHUB_TOKEN: "test-token",
          GITHUB_RUN_ID: "1234",
          GITHUB_RUN_NUMBER: "100",
          GITHUB_RUN_ATTEMPT: "1",
          PR_CLEANUP_RESULT: "success",
          GITHUB_STEP_SUMMARY:
            summaryMode === "file"
              ? summaryPath
              : summaryMode === "directory"
                ? directory
                : "",
          ...env,
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

describe("trusted cleanup alert CLI", () => {
  it.each(["schedule", "workflow_dispatch"])(
    "does not create an issue for a healthy first %s sweep",
    (eventName) => {
      const result = invoke(eventName);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'PR cleanup alert: {"action":"unchanged"}',
      );
      expect(result.stdout).toContain("API request: GET /issues");
      expect(result.stdout).not.toContain("POST");
      expect(result.stdout + result.stderr).not.toContain("test-token");
    },
  );

  it.each(["schedule", "workflow_dispatch"])(
    "creates the managed issue for a failed %s sweep",
    (eventName) => {
      const result = invoke(eventName, {
        env: { PR_CLEANUP_RESULT: "failure" },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(
        'PR cleanup alert: {"action":"created","number":42}',
      );
      expect(result.stdout).toContain("API request: POST /issues");
      expect(result.stdout + result.stderr).not.toContain("test-token");
    },
  );

  it("uses the actual default branch rather than hard-coding main", () => {
    const result = invoke("workflow_dispatch", {
      event: { repository: { full_name: repository, default_branch: "trunk" } },
      env: {
        GITHUB_REF: "refs/heads/trunk",
        GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/pr-description-comment.yml@refs/heads/trunk`,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("PR cleanup alert:");
  });

  it.each([
    { GITHUB_REF: "refs/heads/feature/untrusted" },
    { GITHUB_REF: "refs/tags/main" },
    { GITHUB_REF: "" },
    { GITHUB_REPOSITORY: "other/repo" },
    {
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/ci.yml@refs/heads/main`,
    },
    {
      GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/pr-description-comment.yml@refs/heads/untrusted`,
    },
    {
      GITHUB_WORKFLOW_REF: `other/repo/.github/workflows/pr-description-comment.yml@refs/heads/main`,
    },
    { GITHUB_WORKFLOW_REF: "" },
    { PR_CLEANUP_RESULT: "cancelled" },
    { PR_CLEANUP_RESULT: "skipped" },
    { PR_CLEANUP_RESULT: "" },
    { GITHUB_RUN_ID: "0" },
    { GITHUB_RUN_ID: "9007199254740992" },
    { GITHUB_RUN_ID: "1e3" },
    { GITHUB_RUN_NUMBER: "-1" },
    { GITHUB_RUN_NUMBER: "1.5" },
    { GITHUB_RUN_NUMBER: "" },
    { GITHUB_RUN_ATTEMPT: "NaN" },
    { GITHUB_RUN_ATTEMPT: "0" },
    { GITHUB_TOKEN: "" },
  ])("rejects unsafe run metadata or result before API access: %j", (env) => {
    const result = invoke("workflow_dispatch", { env });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("API request:");
    expect(result.stdout + result.stderr).not.toContain("test-token");
  });

  it.each([
    {},
    { repository: { full_name: repository } },
    { repository: { full_name: "other/repo", default_branch: "main" } },
  ])("rejects missing or mismatched repository context: %j", (event) => {
    const result = invoke("schedule", { event });
    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("API request:");
  });

  it.each(["workflow_run", "pull_request", "pull_request_target", "issues"])(
    "does not issue alerts for an unrelated %s event",
    (eventName) => {
      const result = invoke(eventName, {
        env: { PR_CLEANUP_RESULT: "failure" },
      });
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain("API request:");
    },
  );

  it.each(["api-http", "api-transport"] as const)(
    "fails safely when notification cannot be delivered: %s",
    (scenario) => {
      const result = invoke("schedule", {
        scenario,
        env: { PR_CLEANUP_RESULT: "failure" },
      });
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toMatch(/private|test-token/);
      if (scenario === "api-http") expect(result.stderr).toContain("503");
    },
  );

  it("appends an alert summary with the issue link after first failure", () => {
    const result = invoke("workflow_dispatch", {
      env: { PR_CLEANUP_RESULT: "failure" },
      summaryMode: "file",
    });
    expect(result.status).toBe(0);
    expect(result.summary).toMatch(/^Earlier notes\n/);
    expect(result.summary).toMatch(/PR cleanup.*alert/i);
    expect(result.summary).toContain("https://github.com/owner/repo/issues/42");
    expect(result.summary).not.toContain("test-token");
  });

  it("does not alter a requested summary in an untrusted context", () => {
    const result = invoke("workflow_dispatch", {
      env: { GITHUB_REF: "refs/heads/untrusted" },
      summaryMode: "file",
    });
    expect(result.status).toBe(1);
    expect(result.summary).toBe("Earlier notes\n");
  });

  it("allows trusted local invocations without an Actions summary file", () => {
    const result = invoke();
    expect(result.status).toBe(0);
    expect(result.summary).toBeNull();
  });
});

describe("independent least-privilege alert job", () => {
  const workflow = () =>
    readFileSync(".github/workflows/pr-description-comment.yml", "utf8");
  const alertJob = () => workflow().split(/^  alert:\s*$/m)[1];

  it("observes the sweep job even after checkout, setup, or execution failure", () => {
    const alert = alertJob();
    expect(alert).toBeTruthy();
    expect(alert).toContain("name: pr-cleanup-alert");
    expect(alert).toMatch(/needs:\s*(?:comment|\[comment\])/);
    expect(alert).toContain("always()");
    expect(alert).toContain("needs.comment.result == 'success'");
    expect(alert).toContain("needs.comment.result == 'failure'");
  });

  it("limits notification to default-branch scheduled and manual sweeps", () => {
    const alert = alertJob();
    const condition = alert?.match(/if:[\s\S]*?runs-on:/)?.[0] ?? "";
    expect(condition).toContain("github.event_name == 'schedule'");
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
    expect(condition).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
    expect(condition).not.toMatch(/workflow_run|cancelled|skipped/);
  });

  it("gives only the alert job Issue write access and trusted read-only checkout", () => {
    const alert = alertJob();
    const permissions =
      alert?.match(/permissions:\n(?: {6}[^\n]+\n)+/)?.[0] ?? "";
    expect(permissions).toContain("contents: read");
    expect(permissions).toContain("issues: write");
    expect(permissions).not.toMatch(/pull-requests:|actions:|contents: write/);
    expect(workflow().split(/^jobs:/m)[0]).not.toContain("issues: write");
    expect(alert).toContain("repository: ${{ github.repository }}");
    expect(alert).toContain("ref: ${{ github.sha }}");
    expect(alert).toContain("persist-credentials: false");
    expect(alert).toContain("package-manager-cache: false");
    expect(alert).toContain("PR_CLEANUP_RESULT: ${{ needs.comment.result }}");
    expect(alert).toContain("run: node scripts/alert-pr-cleanup.mjs");
    expect(alert).not.toMatch(
      /ref:.*(?:pull_request|workflow_run\.head)|download-artifact|run:.*(?:npm|npx|yarn|pnpm|eval|\$\{\{)/,
    );
    const actions = [...alert.matchAll(/uses:\s*[^\s]+@([^\s]+)/g)];
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action[1]).toMatch(/^[a-f\d]{40}$/);
  });

  it("keeps alert creation and recovery serialized with the existing feedback writers", () => {
    const source = workflow();
    expect(source).toContain(
      "group: pr-description-feedback-${{ github.repository_id }}",
    );
    expect(source).toContain("queue: max");
    expect(source).toContain("cancel-in-progress: false");
    expect(alertJob()).not.toContain("concurrency:");
  });
});
