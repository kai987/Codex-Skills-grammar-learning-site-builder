import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  commentMarker,
  descriptionLabel,
  renderDescriptionComment,
  updateDescriptionComments,
} from "../../scripts/comment-pr-description.mjs";
import {
  requiredConfirmations,
  validateDescription,
} from "../../scripts/check-pr-description.mjs";

const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
const completed = template
  .replace(
    /\n-\n/,
    "\n- Add reusable feedback for incomplete PR descriptions.\n",
  )
  .replace(/\|\s*\|\s*$/gm, "| Pass — verified locally |")
  .replaceAll("- [ ]", "- [x]");
const repository = "owner/repo";
const headSha = "a".repeat(40);
const run = {
  name: "PR description",
  event: "pull_request",
  status: "completed",
  path: ".github/workflows/pr-description.yml",
  repository: { full_name: repository },
  head_repository: { id: 321, full_name: "contributor/fork" },
  head_branch: "feature/feedback",
  head_sha: headSha,
  pull_requests: [],
};
const metadata = { repository, token: "test-token", run };
const pr = (number = 7, body = template) => ({
  number,
  body,
  state: "open",
  base: { repo: { full_name: repository } },
  head: {
    repo: { full_name: run.head_repository.full_name },
    ref: run.head_branch,
    sha: headSha,
  },
});
type PullRequest = ReturnType<typeof pr>;
type Comment = {
  id: number;
  body: string;
  user: { login: string; type: string };
};
const botComment = (id: number, body: string): Comment => ({
  id,
  body,
  user: { login: "github-actions[bot]", type: "Bot" },
});
const response = (value: unknown) => ({
  ok: true,
  json: async () => structuredClone(value),
});

function fakeGitHub(prs = [pr()], comments = new Map<number, Comment[]>()) {
  const state = {
    prs,
    comments,
    labels: new Map<number, { name: string }[]>(),
    nextCommentId: 900,
  };
  const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const route = url.pathname.replace(`/repos/${repository}`, "");
    const page = Number(url.searchParams.get("page") ?? "1");
    if (route === "/pulls")
      return response(state.prs.slice((page - 1) * 100, page * 100));
    const singlePR = route.match(/^\/pulls\/(\d+)$/);
    if (singlePR)
      return response(
        state.prs.find((item) => item.number === Number(singlePR[1])),
      );
    if (route === `/labels/${descriptionLabel}`)
      return response({ name: descriptionLabel });
    const issueLabels = route.match(/^\/issues\/(\d+)\/labels$/);
    if (issueLabels) {
      const number = Number(issueLabels[1]);
      const existing = state.labels.get(number) ?? [];
      if (init.method === "POST") {
        const names = JSON.parse(String(init.body)).labels as string[];
        state.labels.set(number, [
          ...existing,
          ...names
            .filter((name) => !existing.some((label) => label.name === name))
            .map((name) => ({ name })),
        ]);
        return response(state.labels.get(number));
      }
      return response(existing.slice((page - 1) * 100, page * 100));
    }
    const removedLabel = route.match(/^\/issues\/(\d+)\/labels\/([^/]+)$/);
    if (removedLabel && init.method === "DELETE") {
      const number = Number(removedLabel[1]);
      const remaining = (state.labels.get(number) ?? []).filter(
        (label) => label.name !== decodeURIComponent(removedLabel[2]),
      );
      state.labels.set(number, remaining);
      return response(remaining);
    }
    const issueComments = route.match(/^\/issues\/(\d+)\/comments$/);
    if (issueComments) {
      const number = Number(issueComments[1]);
      const existing = state.comments.get(number) ?? [];
      if (init.method === "POST") {
        const saved = botComment(
          state.nextCommentId++,
          JSON.parse(String(init.body)).body,
        );
        state.comments.set(number, [...existing, saved]);
        return response(saved);
      }
      return response(existing.slice((page - 1) * 100, page * 100));
    }
    const comment = route.match(/^\/issues\/comments\/(\d+)$/);
    if (comment && init.method === "PATCH") {
      const saved = [...state.comments.values()]
        .flat()
        .find((item) => item.id === Number(comment[1]));
      if (!saved) throw new Error("Unexpected comment ID");
      saved.body = JSON.parse(String(init.body)).body;
      return response(saved);
    }
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${route}`);
  });
  // These regression assertions isolate comment writes; label behavior has its
  // own persistent-state integration tests in pr-description-label.test.ts.
  const writes = () =>
    fetchImpl.mock.calls.filter(
      ([url, init]) =>
        init?.method && /\/issues\/(?:\d+\/comments|comments\/\d+)$/.test(url),
    );
  return { state, fetchImpl, writes };
}

describe("PR description feedback rendering", () => {
  it("explains every missing item and includes the canonical checklist text", () => {
    const errors = validateDescription(template);
    const body = renderDescriptionComment(errors, repository, 7);
    expect(body.startsWith(`${commentMarker}\n`)).toBe(true);
    expect(body).toContain("incomplete ❌");
    for (const error of errors) expect(body).toContain(error);
    for (const confirmation of requiredConfirmations)
      expect(body).toContain(confirmation);
    expect(body).toContain("Edit the **PR description**, not this comment");
    expect(body).toContain("https://github.com/owner/repo/pull/7/checks");
  });

  it("describes completeness without claiming that all CI checks passed", () => {
    const body = renderDescriptionComment([], repository, 7);
    expect(body).toContain("complete ✅");
    expect(body).toContain("must still pass before merging");
    expect(body).not.toContain("incomplete ❌");
  });
});

describe("sticky PR description feedback", () => {
  it("creates once, fixes and regresses the same ID, and leaves repeated results alone", async () => {
    const api = fakeGitHub();
    const update = () =>
      updateDescriptionComments({ ...metadata, fetchImpl: api.fetchImpl });

    expect(await update()).toMatchObject([
      { number: 7, action: "created", id: 900 },
    ]);
    expect(api.state.comments.get(7)).toHaveLength(1);
    expect(api.state.comments.get(7)![0].body).toContain("incomplete ❌");

    api.state.prs[0].body = completed;
    expect(await update()).toMatchObject([
      { number: 7, action: "updated", id: 900 },
    ]);
    expect(api.state.comments.get(7)![0].body).toContain("complete ✅");

    api.state.prs[0].body = template;
    expect(await update()).toMatchObject([
      { number: 7, action: "updated", id: 900 },
    ]);
    expect(await update()).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.state.comments.get(7)).toHaveLength(1);
    expect(api.writes().map(([, init]) => init!.method)).toEqual([
      "POST",
      "PATCH",
      "PATCH",
    ]);
    expect(
      api
        .writes()
        .slice(1)
        .every(([url]) => url.endsWith("/comments/900")),
    ).toBe(true);
  });

  it("does not create a success comment on an initially complete PR", async () => {
    const api = fakeGitHub([pr(7, completed)]);
    expect(
      await updateDescriptionComments({
        ...metadata,
        fetchImpl: api.fetchImpl,
      }),
    ).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.writes()).toEqual([]);
    expect(api.state.comments.size).toBe(0);
  });

  it("finds its bot comment after 100 comments and ignores copied markers", async () => {
    const copied = renderDescriptionComment([], repository, 7);
    const comments = Array.from({ length: 100 }, (_, index) => ({
      ...botComment(index + 1, copied),
      user: { login: "contributor", type: "User" },
    }));
    comments[1] = {
      ...botComment(2, copied),
      user: { login: "another-app[bot]", type: "Bot" },
    };
    comments[2] = {
      ...botComment(3, copied),
      user: { login: "github-actions[bot]", type: "User" },
    };
    comments[3] = botComment(4, `Some unrelated text\n${copied}`);
    comments.push(botComment(501, copied));
    const api = fakeGitHub([pr()], new Map([[7, comments]]));

    expect(
      await updateDescriptionComments({
        ...metadata,
        fetchImpl: api.fetchImpl,
      }),
    ).toMatchObject([{ number: 7, action: "updated", id: 501 }]);
    expect(
      api.fetchImpl.mock.calls.some(([url]) =>
        url.endsWith("/issues/7/comments?per_page=100&page=2"),
      ),
    ).toBe(true);
    expect(api.writes()).toHaveLength(1);
    expect(api.writes()[0][0]).toContain("/issues/comments/501");
    expect(api.state.comments.get(7)).toHaveLength(101);
    expect(api.state.comments.get(7)![0].body).toBe(copied);
  });

  it("does not treat a human or different bot's marker as an existing comment", async () => {
    const copied = renderDescriptionComment([], repository, 7);
    const api = fakeGitHub(
      [pr()],
      new Map([
        [
          7,
          [
            { ...botComment(1, copied), user: { login: "user", type: "User" } },
            {
              ...botComment(2, copied),
              user: { login: "other[bot]", type: "Bot" },
            },
          ],
        ],
      ]),
    );
    expect(
      await updateDescriptionComments({
        ...metadata,
        fetchImpl: api.fetchImpl,
      }),
    ).toMatchObject([{ number: 7, action: "created", id: 900 }]);
    expect(api.state.comments.get(7)).toHaveLength(3);
  });

  it.each(["body", "head", "closed"])(
    "skips a write when the PR's %s changes before posting",
    async (change) => {
      const changed = pr();
      if (change === "body") changed.body = completed;
      if (change === "head") changed.head.sha = "b".repeat(40);
      if (change === "closed") changed.state = "closed";
      const api = fakeGitHub();
      const actualFetch = api.fetchImpl.getMockImplementation()!;
      let reads = 0;
      const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
        if (new URL(input).pathname.endsWith("/pulls/7") && ++reads > 1)
          return response(changed);
        return actualFetch(input, init);
      });
      expect(
        await updateDescriptionComments({ ...metadata, fetchImpl }),
      ).toEqual([{ number: 7, action: "stale" }]);
      expect(reads).toBe(2);
      expect(fetchImpl.mock.calls.every(([, init]) => !init.method)).toBe(true);
    },
  );

  it("skips candidates that change between listing and the first live read", async () => {
    const changed = pr();
    changed.head.sha = "b".repeat(40);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(response([pr()]))
      .mockResolvedValueOnce(response(changed));
    expect(await updateDescriptionComments({ ...metadata, fetchImpl })).toEqual(
      [],
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(["HTTP 403", "HTTP 500", "timeout"])(
    "fails on a %s POST without retrying an ambiguous creation",
    async (failure) => {
      const api = fakeGitHub();
      const actualFetch = api.fetchImpl.getMockImplementation()!;
      const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
        if (input.endsWith("/issues/7/comments") && init.method === "POST") {
          if (failure === "timeout")
            throw new DOMException("Timed out", "TimeoutError");
          return { ok: false, status: Number(failure.slice(5)) };
        }
        return actualFetch(input, init);
      });

      await expect(
        updateDescriptionComments({ ...metadata, fetchImpl }),
      ).rejects.toThrow(failure === "timeout" ? "Timed out" : failure);
      expect(
        fetchImpl.mock.calls.filter(
          ([url, init]) =>
            url.endsWith("/issues/7/comments") && init.method === "POST",
        ),
      ).toHaveLength(1);
    },
  );

  it("finds a comment on a rerun after creation succeeded but its response was lost", async () => {
    const api = fakeGitHub();
    const actualFetch = api.fetchImpl.getMockImplementation()!;
    api.fetchImpl.mockImplementation(async (input, init = {}) => {
      const result = await actualFetch(input, init);
      if (input.endsWith("/issues/7/comments") && init.method === "POST")
        throw new Error("Response lost after creation");
      return result;
    });
    await expect(
      updateDescriptionComments({ ...metadata, fetchImpl: api.fetchImpl }),
    ).rejects.toThrow("Response lost");
    expect(api.state.comments.get(7)).toHaveLength(1);
    expect(
      await updateDescriptionComments({
        ...metadata,
        fetchImpl: api.fetchImpl,
      }),
    ).toMatchObject([{ number: 7, action: "unchanged" }]);
    expect(api.writes()).toHaveLength(1);
  });

  it.each([{ ok: false, status: 403 }, response({ invalid: "not a list" })])(
    "fails closed on an unsuccessful or malformed list response",
    async (value) => {
      const fetchImpl = vi.fn().mockResolvedValue(value);
      await expect(
        updateDescriptionComments({ ...metadata, fetchImpl }),
      ).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );
});

describe("workflow-run PR identification", () => {
  it("matches a fork using exact live metadata even with no event PR associations", async () => {
    const api = fakeGitHub();
    expect(run.pull_requests).toEqual([]);
    expect(
      await updateDescriptionComments({
        ...metadata,
        fetchImpl: api.fetchImpl,
      }),
    ).toMatchObject([{ number: 7, action: "created", id: 900 }]);
    const url = new URL(api.fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get("head")).toBe("contributor:feature/feedback");
    expect(url.searchParams.get("state")).toBe("open");
    for (const [, init] of api.fetchImpl.mock.calls) {
      expect(init).toMatchObject({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
        signal: expect.any(AbortSignal),
      });
    }
  });

  it("URL-encodes the branch as one query parameter", async () => {
    const branch = "feature/feedback#note&state=closed";
    const candidate = pr();
    candidate.head.ref = branch;
    const api = fakeGitHub([candidate]);
    await updateDescriptionComments({
      ...metadata,
      run: { ...run, head_branch: branch },
      fetchImpl: api.fetchImpl,
    });
    const url = new URL(api.fetchImpl.mock.calls[0][0]);
    expect(url.searchParams.get("head")).toBe(`contributor:${branch}`);
    expect(url.searchParams.getAll("state")).toEqual(["open"]);
    expect(url.hash).toBe("");
  });

  it.each([
    "head repository",
    "head ref",
    "head SHA",
    "base repository",
    "closed",
    "invalid number",
  ])(
    "ignores a nonmatching %s instead of guessing from the branch alone",
    async (field) => {
      const candidate = pr();
      if (field === "head repository")
        candidate.head.repo.full_name = "another/fork";
      if (field === "head ref") candidate.head.ref = "Feature/feedback";
      if (field === "head SHA") candidate.head.sha = "b".repeat(40);
      if (field === "base repository")
        candidate.base.repo.full_name = "another/repo";
      if (field === "closed") candidate.state = "closed";
      if (field === "invalid number") candidate.number = 0;
      const api = fakeGitHub([candidate]);
      expect(
        await updateDescriptionComments({
          ...metadata,
          fetchImpl: api.fetchImpl,
        }),
      ).toEqual([]);
      expect(api.fetchImpl).toHaveBeenCalledTimes(1);
      expect(api.writes()).toEqual([]);
    },
  );

  it("compares repository names case-insensitively without loosening branch matching", async () => {
    const candidate = pr();
    candidate.head.repo.full_name = "Contributor/Fork";
    candidate.base.repo.full_name = "Owner/Repo";
    const api = fakeGitHub([candidate]);
    expect(
      await updateDescriptionComments({
        ...metadata,
        fetchImpl: api.fetchImpl,
      }),
    ).toMatchObject([{ number: 7, action: "created", id: 900 }]);
  });

  it("updates every matching open PR for the same source branch and SHA", async () => {
    const api = fakeGitHub([pr(7), pr(8, completed), pr(9)]);
    expect(
      await updateDescriptionComments({
        ...metadata,
        fetchImpl: api.fetchImpl,
      }),
    ).toMatchObject([
      { number: 7, action: "created", id: 900 },
      { number: 8, action: "unchanged" },
      { number: 9, action: "created", id: 901 },
    ]);
    expect(api.state.comments.get(7)).toHaveLength(1);
    expect(api.state.comments.has(8)).toBe(false);
    expect(api.state.comments.get(9)).toHaveLength(1);
  });

  it("paginates the open-PR search instead of silently dropping later candidates", async () => {
    const unrelated = Array.from({ length: 100 }, (_, index): PullRequest => {
      const candidate = pr(index + 100);
      candidate.head.sha = "b".repeat(40);
      return candidate;
    });
    const api = fakeGitHub([...unrelated, pr()]);
    expect(
      await updateDescriptionComments({
        ...metadata,
        fetchImpl: api.fetchImpl,
      }),
    ).toMatchObject([{ number: 7, action: "created", id: 900 }]);
    const searchCalls = api.fetchImpl.mock.calls
      .map(([url]) => new URL(url))
      .filter((url) => url.pathname.endsWith("/pulls"));
    expect(searchCalls.map((url) => url.searchParams.get("page"))).toEqual([
      "1",
      "2",
    ]);
  });

  it.each([
    { repository: "" },
    { repository: "owner/repo/issues" },
    { token: "" },
    { apiUrl: "http://example.invalid" },
    { run: undefined },
    { run: { ...run, name: "CI" } },
    { run: { ...run, event: "push" } },
    { run: { ...run, status: "in_progress" } },
    { run: { ...run, path: ".github/workflows/other.yml" } },
    { run: { ...run, repository: { full_name: "another/repo" } } },
    { run: { ...run, head_repository: null } },
    { run: { ...run, head_repository: { full_name: "invalid" } } },
    { run: { ...run, head_branch: "" } },
    { run: { ...run, head_sha: "invalid" } },
  ])(
    "rejects invalid metadata before making any request: %j",
    async (override) => {
      const fetchImpl = vi.fn();
      await expect(
        updateDescriptionComments({ ...metadata, ...override, fetchImpl }),
      ).rejects.toThrow("Missing or invalid");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});

describe("trusted notification workflow", () => {
  it("uses trusted workflow-run and default-branch sweep contexts with minimal write permission", () => {
    const workflow = readFileSync(
      ".github/workflows/pr-description-comment.yml",
      "utf8",
    );
    const feedback = workflow.split("\n  alert:\n")[0];
    expect(workflow).toContain("workflow_run:");
    const sources = workflow.match(/workflows:[\s\S]*?types:/)?.[0];
    expect(sources).toContain("PR description");
    expect(sources).toContain("PR description label recheck");
    expect(sources).toContain("PR description lifecycle");
    expect(workflow).toContain("types: [completed]");
    expect(workflow).toContain(
      "github.event_name == 'workflow_run' && github.event.workflow_run.event == 'pull_request'",
    );
    expect(workflow).toContain('cron: "17 * * * *"');
    expect(workflow).toMatch(/^  workflow_dispatch:\s*$/m);
    expect(workflow).not.toContain("inputs:");
    expect(workflow).toContain("github.event_name == 'schedule'");
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain(
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    );
    expect(workflow).toMatch(/^  contents: read$/m);
    expect(workflow).toMatch(/^  pull-requests: write$/m);
    expect(workflow).toMatch(/^  actions: read$/m);
    expect(workflow).toContain("repository: ${{ github.repository }}");
    expect(workflow).toContain("ref: ${{ github.sha }}");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("package-manager-cache: false");
    expect(workflow).toContain("run: node scripts/comment-pr-description.mjs");
    expect(feedback).not.toMatch(
      /pull_request_target:|contents: write|issues: write|actions: write/,
    );
    expect(workflow).not.toMatch(/ref:.*(?:pull_request|workflow_run\.head)/);
    expect(workflow).not.toMatch(/run:.*(?:npm|npx|yarn|pnpm|eval|\$\{\{)/);
    expect(workflow).not.toMatch(
      /uses:\s*actions\/download-artifact|cache:\s*npm/,
    );
    const actions = [...feedback.matchAll(/uses:\s*([^\s]+)@([^\s]+)/g)];
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action[2]).toMatch(/^[a-f\d]{40}$/);
  });

  it("serializes open, terminal, and scheduled writers for the repository without cancelling an in-flight POST", () => {
    const workflow = readFileSync(
      ".github/workflows/pr-description-comment.yml",
      "utf8",
    );
    expect(workflow).toContain(
      "group: pr-description-feedback-${{ github.repository_id }}",
    );
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).toContain("queue: max");
    const group = workflow
      .split("\n")
      .find((line) => line.trim().startsWith("group:"))!;
    expect(group).not.toMatch(
      /head_sha|run_id|run_attempt|head_branch|head_repository/,
    );
  });

  it("rejects a CLI invocation outside workflow_run without using a token", () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/comment-pr-description.mjs")],
      {
        env: {
          ...process.env,
          GITHUB_EVENT_NAME: "pull_request",
          GITHUB_TOKEN: "test-token",
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("trusted workflow_run context");
    expect(result.stderr).not.toContain("test-token");
  });
});
