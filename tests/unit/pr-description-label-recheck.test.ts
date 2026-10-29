import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  descriptionLabel,
  renderDescriptionComment,
  updateDescriptionComments,
} from "../../scripts/comment-pr-description.mjs";
import { validateDescription } from "../../scripts/check-pr-description.mjs";

const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
const completed = template
  .replace(/\n-\n/, "\n- Recheck manual description-label changes.\n")
  .replace(/\|\s*\|\s*$/gm, "| Pass — verified locally |")
  .replaceAll("- [ ]", "- [x]");
const repository = "owner/repo";
const headSha = "a".repeat(40);
const actor = { login: "contributor", type: "User" };
const run = {
  id: 42,
  run_attempt: 2,
  name: "PR description label recheck",
  path: ".github/workflows/pr-description-label-recheck.yml",
  event: "pull_request",
  status: "completed",
  conclusion: "success",
  repository: { full_name: repository },
  head_repository: { id: 100, full_name: "contributor/fork" },
  head_branch: "feature/manual-description-label",
  head_sha: headSha,
  actor,
  triggering_actor: actor,
  pull_requests: [],
};
const expectedJob = {
  id: 501,
  name: "pr-description-label-recheck",
  run_id: run.id,
  run_attempt: run.run_attempt,
  head_sha: headSha,
  status: "completed",
  conclusion: "success",
};
const metadata = { repository, token: "test-token", run };
const success = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => structuredClone(value),
});

function fakeGitHub({ body = template, labels = ["bug"] } = {}) {
  const state = {
    jobs: [{ ...expectedJob }],
    labels,
    pr: {
      number: 7,
      state: "open",
      body,
      base: { repo: { full_name: repository } },
      head: {
        repo: { full_name: run.head_repository.full_name },
        ref: run.head_branch,
        sha: headSha,
      },
    },
    comments: [
      {
        id: 900,
        body: renderDescriptionComment(
          validateDescription(body),
          repository,
          7,
        ),
        user: { login: "github-actions[bot]", type: "Bot" },
      },
    ],
  };
  const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const route = url.pathname.replace(`/repos/${repository}`, "");
    const page = Number(url.searchParams.get("page") ?? "1");
    if (route === `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`)
      return success({ jobs: state.jobs.slice((page - 1) * 100, page * 100) });
    if (route === "/pulls") return success([state.pr]);
    if (route === "/pulls/7") return success(state.pr);
    if (route === "/issues/7/comments") return success(state.comments);
    if (route === "/issues/comments/900" && init.method === "PATCH") {
      state.comments[0].body = JSON.parse(String(init.body)).body;
      return success(state.comments[0]);
    }
    if (route === `/labels/${descriptionLabel}`)
      return success({ name: descriptionLabel });
    if (route === "/issues/7/labels") {
      if (init.method === "POST") {
        for (const label of JSON.parse(String(init.body)).labels as string[])
          if (!state.labels.includes(label)) state.labels.push(label);
      }
      return success(state.labels.map((name) => ({ name })));
    }
    if (
      route === `/issues/7/labels/${descriptionLabel}` &&
      init.method === "DELETE"
    ) {
      state.labels = state.labels.filter((name) => name !== descriptionLabel);
      return success(state.labels.map((name) => ({ name })));
    }
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${route}`);
  });
  const writes = () => fetchImpl.mock.calls.filter(([, init]) => init?.method);
  const update = (source = run) =>
    updateDescriptionComments({ ...metadata, run: source, fetchImpl });
  return { state, fetchImpl, writes, update };
}

describe("human description-label event rechecks", () => {
  it("removes a manually added label from a complete description and preserves the other labels/comment", async () => {
    const api = fakeGitHub({
      body: completed,
      labels: [descriptionLabel, "bug"],
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.labels).toEqual(["bug"]);
    expect(api.state.comments).toHaveLength(1);
    expect(api.state.comments[0].id).toBe(900);
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["DELETE"]);
    expect(await api.update()).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.writes()).toHaveLength(1);
    const first = new URL(api.fetchImpl.mock.calls[0][0]);
    expect(first.pathname).toBe(
      `/repos/${repository}/actions/runs/42/attempts/2/jobs`,
    );
  });

  it("restores a manually removed label on an incomplete description even when feedback is unchanged", async () => {
    const api = fakeGitHub();
    api.state.jobs[0].conclusion = "failure";
    expect(await api.update({ ...run, conclusion: "failure" })).toEqual([
      { number: 7, action: "unchanged", label: "added" },
    ]);
    expect(api.state.labels).toEqual(["bug", descriptionLabel]);
    expect(api.state.comments).toHaveLength(1);
    expect(api.writes()).toHaveLength(1);
    expect(JSON.parse(String(api.writes()[0][1]!.body))).toEqual({
      labels: [descriptionLabel],
    });
  });

  it.each(["success", "failure"])(
    "re-evaluates the live body instead of treating source job %s as the desired label state",
    async (conclusion) => {
      const api = fakeGitHub({ body: completed, labels: [descriptionLabel] });
      api.state.jobs[0].conclusion = conclusion;
      expect(await api.update({ ...run, conclusion })).toEqual([
        { number: 7, action: "unchanged", label: "removed" },
      ]);
      expect(api.state.labels).toEqual([]);
    },
  );

  it("does not classify an ordinary User account or PAT as a bot by its automation-like name", async () => {
    const api = fakeGitHub();
    const serviceUser = { login: "automation-service-account", type: "User" };
    expect(
      await api.update({
        ...run,
        actor: serviceUser,
        triggering_actor: serviceUser,
      }),
    ).toEqual([{ number: 7, action: "unchanged", label: "added" }]);
    expect(api.fetchImpl).toHaveBeenCalled();
  });

  it.each([
    { login: "github-actions[bot]", type: "Bot" },
    { login: "other[bot]", type: "User" },
    { login: "service", type: "Bot" },
    { login: "service", type: "Organization" },
    null,
    undefined,
  ])(
    "ignores a non-human original actor before API access: %j",
    async (sourceActor) => {
      const api = fakeGitHub();
      expect(await api.update({ ...run, actor: sourceActor })).toEqual([]);
      expect(api.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    { login: "github-actions[bot]", type: "Bot" },
    { login: "other[bot]", type: "User" },
    { login: "service", type: "Bot" },
    null,
    undefined,
  ])(
    "ignores a bot or unknown rerun actor before API access: %j",
    async (triggeringActor) => {
      const api = fakeGitHub();
      expect(
        await api.update({ ...run, triggering_actor: triggeringActor }),
      ).toEqual([]);
      expect(api.fetchImpl).not.toHaveBeenCalled();
    },
  );
});

describe("attempt-scoped source job evidence", () => {
  it.each([
    "skipped",
    "cancelled",
    "neutral",
    "timed_out",
    "action_required",
    "startup_failure",
    "stale",
  ])(
    "ignores parent workflow conclusion %s before reading eventually visible jobs",
    async (conclusion) => {
      const api = fakeGitHub();
      api.state.jobs = [];
      expect(await api.update({ ...run, conclusion })).toEqual([]);
      expect(api.fetchImpl).not.toHaveBeenCalled();
      expect(api.writes()).toEqual([]);
    },
  );

  it.each([{ id: 0 }, { run_attempt: 0 }])(
    "still validates run identity before skipping an inconclusive parent: %j",
    async (override) => {
      const api = fakeGitHub();
      await expect(
        api.update({ ...run, conclusion: "skipped", ...override }),
      ).rejects.toThrow("run ID or attempt");
      expect(api.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    "skipped",
    "cancelled",
    "neutral",
    "timed_out",
    "action_required",
    "startup_failure",
    "stale",
    null,
  ])(
    "ignores a non-executed or inconclusive source job: %s",
    async (conclusion) => {
      const api = fakeGitHub();
      api.state.jobs[0].conclusion = conclusion;
      expect(await api.update()).toEqual([]);
      expect(api.fetchImpl).toHaveBeenCalledTimes(1);
      expect(api.writes()).toEqual([]);
    },
  );

  it.each([
    { id: undefined },
    { id: 0 },
    { id: -1 },
    { id: 1.5 },
    { id: "42" },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { run_attempt: undefined },
    { run_attempt: 0 },
    { run_attempt: -1 },
    { run_attempt: 1.5 },
    { run_attempt: "2" },
    { run_attempt: Number.MAX_SAFE_INTEGER + 1 },
  ])(
    "rejects invalid run/attempt metadata before API access: %j",
    async (override) => {
      const api = fakeGitHub();
      await expect(api.update({ ...run, ...override })).rejects.toThrow();
      expect(api.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([
    { jobs: [], error: "Expected exactly one" },
    {
      jobs: [{ ...expectedJob, name: "typecheck" }],
      error: "Expected exactly one",
    },
    {
      jobs: [expectedJob, { ...expectedJob, id: 502 }],
      error: "Expected exactly one",
    },
    { jobs: [{ ...expectedJob, run_id: 99 }], error: "does not match" },
    { jobs: [{ ...expectedJob, run_attempt: 1 }], error: "does not match" },
    {
      jobs: [{ ...expectedJob, head_sha: "b".repeat(40) }],
      error: "does not match",
    },
    { jobs: [null], error: "Expected exactly one" },
  ])(
    "rejects missing, duplicate, stale, or malformed source-job evidence: %j",
    async ({ jobs, error }) => {
      const fetchImpl = vi.fn().mockResolvedValue(success({ jobs }));
      await expect(
        updateDescriptionComments({ ...metadata, fetchImpl }),
      ).rejects.toThrow(error);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty("method");
    },
  );

  it.each([null, {}, { jobs: null }, { jobs: {} }, { jobs: "invalid" }])(
    "rejects malformed jobs page %j",
    async (value) => {
      const fetchImpl = vi.fn().mockResolvedValue(success(value));
      await expect(
        updateDescriptionComments({ ...metadata, fetchImpl }),
      ).rejects.toThrow("Invalid paginated");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["in_progress", "queued"])(
    "ignores a source job that has not completed (%s)",
    async (status) => {
      const api = fakeGitHub();
      api.state.jobs[0].status = status;
      expect(await api.update()).toEqual([]);
      expect(api.fetchImpl).toHaveBeenCalledTimes(1);
      expect(api.writes()).toEqual([]);
    },
  );

  it.each([403, 500])("fails closed on jobs API HTTP %i", async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status });
    await expect(
      updateDescriptionComments({ ...metadata, fetchImpl }),
    ).rejects.toThrow(`HTTP ${status}`);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("finds the exact source job on the second page of the exact rerun attempt", async () => {
    const api = fakeGitHub();
    const unrelated = Array.from({ length: 100 }, (_, index) => ({
      ...expectedJob,
      id: index + 1000,
      name: `unrelated-${index}`,
    }));
    api.state.jobs = [...unrelated, { ...expectedJob }];
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "added" },
    ]);
    const jobPages = api.fetchImpl.mock.calls
      .map(([url]) => new URL(url))
      .filter((url) => url.pathname.endsWith("/attempts/2/jobs"));
    expect(jobPages.map((url) => url.searchParams.get("page"))).toEqual([
      "1",
      "2",
    ]);
    expect(
      jobPages.every((url) => url.searchParams.get("per_page") === "100"),
    ).toBe(true);
    expect(
      api.fetchImpl.mock.calls.every(
        ([url]) => !url.includes("/artifacts") && !url.includes("/logs"),
      ),
    ).toBe(true);
  });

  it("rejects duplicate matching jobs across pages rather than acting on the first page alone", async () => {
    const api = fakeGitHub();
    api.state.jobs = [
      expectedJob,
      ...Array.from({ length: 99 }, (_, index) => ({
        ...expectedJob,
        id: index + 1000,
        name: `other-${index}`,
      })),
      { ...expectedJob, id: 9999 },
    ];
    await expect(api.update()).rejects.toThrow();
    expect(api.fetchImpl).toHaveBeenCalledTimes(2);
    expect(api.writes()).toEqual([]);
  });

  it("still ignores a changed HEAD after valid human source evidence", async () => {
    const api = fakeGitHub();
    api.state.pr.head.sha = "b".repeat(40);
    expect(await api.update()).toEqual([]);
    expect(api.writes()).toEqual([]);
  });
});

describe("manual label recheck workflow safety", () => {
  it("runs only the read-only validator for human needs-description label events", () => {
    const workflow = readFileSync(
      ".github/workflows/pr-description-label-recheck.yml",
      "utf8",
    );
    expect(workflow).toContain("name: PR description label recheck");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toMatch(/types:\s*\[labeled, unlabeled\]/);
    expect(workflow).toContain("name: pr-description-label-recheck");
    expect(workflow).toContain(
      "github.event.label.name == 'needs-description'",
    );
    expect(workflow).toContain("github.event.sender.type == 'User'");
    expect(workflow).toContain("!endsWith(github.event.sender.login, '[bot]')");
    expect(workflow).toContain("!endsWith(github.triggering_actor, '[bot]')");
    expect(workflow).toMatch(/^  contents: read$/m);
    expect(workflow).toMatch(/^  pull-requests: read$/m);
    expect(workflow).not.toMatch(
      /^\s*(?:contents|pull-requests|issues|actions): write$/m,
    );
    expect(workflow).toContain("run: node scripts/check-pr-description.mjs");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).not.toMatch(/^\s*concurrency:/m);
    expect(workflow).not.toMatch(
      /pull_request_target:|download-artifact|run:.*(?:npm|npx|yarn|pnpm|\$\{\{)/,
    );
  });

  it("keeps the required gate unconditional and free of label-event skips", () => {
    const workflow = readFileSync(
      ".github/workflows/pr-description.yml",
      "utf8",
    );
    expect(workflow).toContain("name: pr-description");
    expect(workflow).toMatch(
      /types:\s*\[opened, edited, synchronize, reopened, ready_for_review\]/,
    );
    expect(workflow).not.toMatch(/^\s+if:/m);
    expect(workflow).not.toMatch(/\b(?:labeled|unlabeled)\b/);
    expect(workflow).not.toContain("pr-description-label-recheck");
  });

  it("funnels all sources into the same trusted repository-serialized writer with read-only job evidence", () => {
    const workflow = readFileSync(
      ".github/workflows/pr-description-comment.yml",
      "utf8",
    );
    const sources = workflow.match(/workflows:[\s\S]*?types:/)?.[0];
    expect(sources).toContain("PR description");
    expect(sources).toContain("PR description label recheck");
    expect(sources).toContain("PR description lifecycle");
    expect(workflow).toMatch(/^  actions: read$/m);
    expect(workflow).toMatch(/^  contents: read$/m);
    expect(workflow).toMatch(/^  pull-requests: write$/m);
    expect(workflow.split("\n  alert:\n")[0]).not.toMatch(
      /^\s*(?:contents|issues|actions): write$/m,
    );
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).toContain(
      "group: pr-description-feedback-${{ github.repository_id }}",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("queue: max");
    expect(workflow).not.toMatch(
      /ref:.*(?:pull_request|workflow_run\.head)|download-artifact|run:.*(?:npm|npx|yarn|pnpm)/,
    );
  });
});
