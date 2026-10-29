import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
globalThis.fetch = async (input, init = {}) => {
  console.log("API request:", init.method ?? "GET", new URL(input).pathname);
  return { ok: true, status: 200, json: async () => [] };
};
await import(pathToFileURL(process.argv[1]).href);
`;

function invoke(
  eventName: string,
  {
    ref = "refs/heads/main",
    event = { repository: { full_name: repository, default_branch: "main" } },
  }: { ref?: string; event?: unknown } = {},
) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pr-feedback-event-"));
  try {
    const eventPath = path.join(directory, "event.json");
    writeFileSync(eventPath, JSON.stringify(event));
    return spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", runner],
      {
        env: {
          ...process.env,
          TEST_FEEDBACK_SCRIPT: script,
          GITHUB_EVENT_NAME: eventName,
          GITHUB_EVENT_PATH: eventPath,
          GITHUB_REPOSITORY: repository,
          GITHUB_REF: ref,
          GITHUB_API_URL: "https://api.github.com",
          GITHUB_TOKEN: "test-token",
        },
        encoding: "utf8",
      },
    );
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
