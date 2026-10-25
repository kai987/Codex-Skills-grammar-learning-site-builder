import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  commentMarker,
  descriptionLabel,
  renderTerminalDescriptionComment,
  updateDescriptionComments,
} from "../../scripts/comment-pr-description.mjs";

const repository = "owner/repo";
const headSha = "a".repeat(40);
const mergeSha = "b".repeat(40);
const bot = { login: "github-actions[bot]", type: "Bot" };
const run = {
  id: 42,
  run_attempt: 2,
  name: "PR description lifecycle",
  path: ".github/workflows/pr-description-lifecycle.yml",
  event: "pull_request",
  status: "completed",
  conclusion: "success",
  repository: { full_name: repository },
  head_repository: { id: 100, full_name: "contributor/fork" },
  head_branch: "feature/description",
  head_sha: headSha,
  actor: bot,
  triggering_actor: bot,
  pull_requests: [],
};
const job = {
  id: 501,
  name: "pr-description-lifecycle",
  run_id: run.id,
  run_attempt: run.run_attempt,
  head_sha: headSha,
  status: "completed",
  conclusion: "success",
};
const metadata = { repository, token: "test-token", run };
const ownedComment = (id = 900) => ({
  id,
  body: `${commentMarker}\n### PR description: incomplete ❌\n\nMissing confirmations.`,
  user: bot,
});
const pullRequest = (number = 7, merged = false) => ({
  number,
  state: "closed",
  merged,
  merge_commit_sha: merged ? mergeSha : null,
  body: "An incomplete description does not prevent terminal cleanup.",
  base: { ref: "main", repo: { full_name: repository } },
  head: {
    ref: run.head_branch,
    sha: headSha,
    repo: { full_name: run.head_repository.full_name },
  },
});
const success = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => structuredClone(value),
});
const failure = (status: number) => ({ ok: false, status });

function fakeGitHub({
  merged = false,
  comment = true,
  labels = [descriptionLabel, "bug"],
} = {}) {
  const pr = pullRequest(7, merged);
  const state = {
    pr,
    candidates: [pr],
    jobs: [{ ...job }],
    comments: comment ? [ownedComment()] : [],
    labels,
  };
  const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const route = url.pathname.replace(`/repos/${repository}`, "");
    const page = Number(url.searchParams.get("page") ?? "1");
    const slice = <T>(items: T[]) => items.slice((page - 1) * 100, page * 100);
    if (route === "/actions/runs/42/attempts/2/jobs")
      return success({ jobs: slice(state.jobs) });
    if (route === "/pulls") return success(slice(state.candidates));
    if (route === "/pulls/7") return success(state.pr);
    if (route === "/issues/7/comments") return success(slice(state.comments));
    if (route === "/issues/comments/900" && init.method === "PATCH") {
      const saved = state.comments.find((comment) => comment.id === 900)!;
      saved.body = JSON.parse(String(init.body)).body;
      return success(saved);
    }
    if (route === "/issues/7/labels") {
      if (init.method === "POST") {
        for (const name of JSON.parse(String(init.body)).labels as string[])
          if (!state.labels.includes(name)) state.labels.push(name);
      }
      return success(slice(state.labels).map((name) => ({ name })));
    }
    if (
      route === `/issues/7/labels/${descriptionLabel}` &&
      init.method === "DELETE"
    ) {
      state.labels = state.labels.filter((name) => name !== descriptionLabel);
      return success(state.labels.map((name) => ({ name })));
    }
    // Supported only for the reopened/open-source regression below. Terminal
    // behavior must never query or create a repository label definition.
    if (route === `/labels/${descriptionLabel}`)
      return success({ name: descriptionLabel });
    throw new Error(`Unexpected request: ${init.method ?? "GET"} ${route}`);
  });
  const writes = () => fetchImpl.mock.calls.filter(([, init]) => init?.method);
  const intercept = (
    handler: (url: URL, init: RequestInit) => unknown | Promise<unknown>,
  ) => {
    const original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init = {}) => {
      const override = await handler(new URL(input), init);
      return override === undefined ? original(input, init) : override;
    });
  };
  const update = (source = run) =>
    updateDescriptionComments({ ...metadata, run: source, fetchImpl });
  return { state, fetchImpl, writes, intercept, update };
}

describe("terminal feedback and label cleanup", () => {
  it.each([
    {
      merged: false,
      status: "closed",
      header: "### PR description: closed ⚪",
    },
    { merged: true, status: "merged", header: "### PR description: merged ✅" },
  ])(
    "cleans $status PRs once while preserving other labels and the bot comment ID",
    async ({ merged, status, header }) => {
      const api = fakeGitHub({ merged });
      expect(await api.update()).toEqual([
        { number: 7, action: "updated", label: "removed", id: 900 },
      ]);
      expect(api.state.labels).toEqual(["bug"]);
      expect(api.state.comments).toHaveLength(1);
      expect(api.state.comments[0].id).toBe(900);
      expect(api.state.comments[0].body).toBe(
        renderTerminalDescriptionComment(status),
      );
      expect(api.state.comments[0].body).toContain(header);
      expect(api.state.comments[0].body.startsWith(`${commentMarker}\n`)).toBe(
        true,
      );
      expect(api.writes().map(([, init]) => init!.method)).toEqual([
        "DELETE",
        "PATCH",
      ]);
      expect(await api.update()).toEqual([{ number: 7, action: "unchanged" }]);
      expect(api.writes()).toHaveLength(2);
      expect(
        api.fetchImpl.mock.calls.some(
          ([url]) =>
            new URL(url).pathname ===
            `/repos/${repository}/labels/${descriptionLabel}`,
        ),
      ).toBe(false);
      const search = new URL(
        api.fetchImpl.mock.calls.find(([url]) =>
          new URL(url).pathname.endsWith("/pulls"),
        )![0],
      );
      expect(search.searchParams.get("state")).toBe("closed");
    },
  );

  it("removes the managed label without creating a terminal comment if no original bot comment exists", async () => {
    const api = fakeGitHub({ comment: false });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.comments).toEqual([]);
    expect(api.state.labels).toEqual(["bug"]);
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["DELETE"]);
  });

  it("updates an existing comment even when the managed label is already absent", async () => {
    const api = fakeGitHub({ labels: ["bug"] });
    expect(await api.update()).toEqual([
      { number: 7, action: "updated", id: 900 },
    ]);
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["PATCH"]);
  });

  it.each([
    { login: "contributor", type: "User" },
    { login: "unrelated[bot]", type: "Bot" },
  ])(
    "does not modify another author's copied comment marker: %j",
    async (user) => {
      const api = fakeGitHub();
      api.state.comments[0].user = user;
      const original = structuredClone(api.state.comments);
      expect(await api.update()).toEqual([
        { number: 7, action: "unchanged", label: "removed" },
      ]);
      expect(api.state.comments).toEqual(original);
      expect(api.writes().every(([, init]) => init!.method === "DELETE")).toBe(
        true,
      );
    },
  );

  it("supports a normal bot closure and does not require human actor identities", async () => {
    const api = fakeGitHub();
    expect(
      await api.update({ ...run, actor: null, triggering_actor: null }),
    ).toMatchObject([{ number: 7, action: "updated", label: "removed" }]);
    expect(api.fetchImpl).toHaveBeenCalled();
  });

  it("paginates closed PRs, comments, and labels before selecting the matching PR and owned marker", async () => {
    const api = fakeGitHub();
    api.state.candidates = [
      ...Array.from({ length: 100 }, (_, index) => ({
        ...pullRequest(index + 100),
        head: { ...api.state.pr.head, sha: "c".repeat(40) },
      })),
      api.state.pr,
    ];
    api.state.comments = [
      ...Array.from({ length: 100 }, (_, index) => ({
        ...ownedComment(index + 100),
        user: { login: "other", type: "User" },
      })),
      ownedComment(),
    ];
    const unrelated = Array.from(
      { length: 100 },
      (_, index) => `label-${index}`,
    );
    api.state.labels = [...unrelated, descriptionLabel];
    expect(await api.update()).toEqual([
      { number: 7, action: "updated", label: "removed", id: 900 },
    ]);
    expect(api.state.labels).toEqual(unrelated);
    expect(api.state.comments).toHaveLength(101);
    for (const suffix of ["/pulls", "/issues/7/comments", "/issues/7/labels"])
      expect(
        api.fetchImpl.mock.calls.some(([input]) => {
          const url = new URL(input);
          return (
            url.pathname.endsWith(suffix) &&
            url.searchParams.get("page") === "2"
          );
        }),
      ).toBe(true);
  });
});

describe("closed workflow source binding", () => {
  it("accepts a merged event bound by merge SHA, default branch, and base repository", async () => {
    const api = fakeGitHub({ merged: true });
    api.state.jobs[0].head_sha = mergeSha;
    expect(
      await api.update({
        ...run,
        head_sha: mergeSha,
        head_branch: "main",
        head_repository: { id: 200, full_name: repository },
      }),
    ).toMatchObject([{ number: 7, action: "updated", label: "removed" }]);
  });

  it("uses exact SHA evidence when the event's fork repository and branch are null", async () => {
    const api = fakeGitHub();
    expect(
      await api.update({ ...run, head_branch: null, head_repository: null }),
    ).toMatchObject([{ number: 7, action: "updated", label: "removed" }]);
  });

  it("handles a deleted live fork while retaining head-SHA and branch binding", async () => {
    const api = fakeGitHub();
    api.state.pr.head.repo = null;
    expect(await api.update()).toMatchObject([
      { number: 7, action: "updated", label: "removed" },
    ]);
  });

  it("does not require the closed-PR list to include the full endpoint's merged flag", async () => {
    const api = fakeGitHub();
    api.state.candidates = [{ ...api.state.pr, merged: undefined }];
    expect(await api.update()).toMatchObject([
      { number: 7, action: "updated", label: "removed" },
    ]);
  });

  it("ignores event PR-number associations and binds the closed PR by live SHA evidence", async () => {
    const api = fakeGitHub();
    expect(
      await api.update({ ...run, pull_requests: [{ number: 999 }] }),
    ).toMatchObject([{ number: 7, action: "updated" }]);
    expect(
      api.fetchImpl.mock.calls.every(
        ([url]) => !new URL(url).pathname.includes("999"),
      ),
    ).toBe(true);
  });

  it("keeps repository matching case-insensitive but branch matching exact", async () => {
    const api = fakeGitHub();
    api.state.pr.base.repo.full_name = "Owner/Repo";
    api.state.pr.head.repo.full_name = "Contributor/Fork";
    expect(await api.update()).toMatchObject([
      { number: 7, action: "updated" },
    ]);
  });

  it.each([
    "head SHA",
    "source branch",
    "source repository",
    "base repository",
    "open state",
    "branch case",
  ])(
    "does not fall back to a loose match for an unrelated %s",
    async (mismatch) => {
      const api = fakeGitHub();
      const source = { ...run };
      if (mismatch === "head SHA") api.state.pr.head.sha = "c".repeat(40);
      if (mismatch === "source branch") source.head_branch = "unrelated";
      if (mismatch === "source repository")
        source.head_repository = { id: 201, full_name: "unrelated/fork" };
      if (mismatch === "base repository")
        api.state.pr.base.repo.full_name = "other/repo";
      if (mismatch === "open state") api.state.pr.state = "open";
      if (mismatch === "branch case")
        source.head_branch = "Feature/description";
      expect(await api.update(source)).toEqual([]);
      expect(api.writes()).toEqual([]);
    },
  );

  it.each([null, undefined, "false", 0])(
    "rejects an unknown live merged flag without terminal writes: %s",
    async (merged) => {
      const api = fakeGitHub();
      api.intercept((url) =>
        url.pathname.endsWith("/pulls/7")
          ? success({ ...api.state.pr, merged })
          : undefined,
      );
      await expect(api.update()).rejects.toThrow(
        "Cannot determine whether the closed PR was merged",
      );
      expect(api.writes()).toEqual([]);
    },
  );

  it("does not trust a different PR number returned by the live endpoint", async () => {
    const api = fakeGitHub();
    api.intercept((url) =>
      url.pathname.endsWith("/pulls/7")
        ? success({ ...api.state.pr, number: 8 })
        : undefined,
    );
    expect(await api.update()).toEqual([]);
    expect(api.writes()).toEqual([]);
  });
});

describe("terminal source evidence and stale-write protection", () => {
  it.each(["skipped", "cancelled", "neutral", "timed_out", null])(
    "ignores an inconclusive lifecycle job: %s",
    async (conclusion) => {
      const api = fakeGitHub();
      api.state.jobs[0].conclusion = conclusion;
      expect(await api.update()).toEqual([]);
      expect(api.fetchImpl).toHaveBeenCalledTimes(1);
      expect(api.writes()).toEqual([]);
    },
  );

  it.each([
    { field: "missing", jobs: [] },
    { field: "duplicate", jobs: [job, { ...job, id: 502 }] },
    { field: "name", jobs: [{ ...job, name: "pr-description-label-recheck" }] },
    { field: "attempt", jobs: [{ ...job, run_attempt: 1 }] },
    { field: "run ID", jobs: [{ ...job, run_id: 99 }] },
    { field: "SHA", jobs: [{ ...job, head_sha: mergeSha }] },
  ])(
    "fails closed on mismatched lifecycle job $field evidence",
    async ({ jobs }) => {
      const fetchImpl = vi.fn().mockResolvedValue(success({ jobs }));
      await expect(
        updateDescriptionComments({ ...metadata, fetchImpl }),
      ).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it.each([{ id: 0 }, { id: "42" }, { run_attempt: 0 }, { run_attempt: "2" }])(
    "rejects invalid lifecycle run metadata before API access: %j",
    async (override) => {
      const api = fakeGitHub();
      await expect(api.update({ ...run, ...override })).rejects.toThrow();
      expect(api.fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each(["reopened", "SHA", "merged status"])(
    "does not write after the live PR changes its %s",
    async (change) => {
      const api = fakeGitHub();
      let reads = 0;
      api.intercept((url) => {
        if (url.pathname.endsWith("/pulls/7") && ++reads > 1) {
          if (change === "reopened") api.state.pr.state = "open";
          if (change === "SHA") api.state.pr.head.sha = "c".repeat(40);
          if (change === "merged status") api.state.pr.merged = true;
        }
      });
      expect(await api.update()).toEqual([{ number: 7, action: "stale" }]);
      expect(api.writes()).toEqual([]);
    },
  );

  it("does not treat body-only edits as a stale terminal identity", async () => {
    const api = fakeGitHub();
    let reads = 0;
    api.intercept((url) => {
      if (url.pathname.endsWith("/pulls/7") && ++reads > 1)
        api.state.pr.body = "Edited after closure.";
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "updated", label: "removed", id: 900 },
    ]);
    expect(api.state.comments[0].body).toBe(
      renderTerminalDescriptionComment("closed"),
    );
  });

  it("rechecks terminal state again after label removal and before comment patching", async () => {
    const api = fakeGitHub();
    api.intercept((url, init) => {
      if (
        url.pathname.endsWith(`/labels/${descriptionLabel}`) &&
        init.method === "DELETE"
      )
        api.state.pr.state = "open";
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "stale", label: "removed" },
    ]);
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["DELETE"]);
    expect(api.state.comments[0].body).toContain("incomplete");
  });

  it("allows the original open-source flow to restore feedback and the label after reopening", async () => {
    const api = fakeGitHub();
    await api.update();
    api.state.pr.state = "open";
    api.state.pr.body = readFileSync(
      ".github/PULL_REQUEST_TEMPLATE.md",
      "utf8",
    );
    const reopened = {
      ...run,
      name: "PR description",
      path: ".github/workflows/pr-description.yml",
    };
    expect(await api.update(reopened)).toEqual([
      { number: 7, action: "updated", label: "added", id: 900 },
    ]);
    expect(api.state.comments).toHaveLength(1);
    expect(api.state.comments[0].body).toContain("incomplete ❌");
    expect(api.state.labels).toEqual(["bug", descriptionLabel]);
  });
});

describe("terminal API failures and least-privilege signaling", () => {
  it.each([403, 500])(
    "fails closed without retrying terminal mutations on HTTP %i",
    async (status) => {
      for (const labels of [[descriptionLabel, "bug"], ["bug"]]) {
        const api = fakeGitHub({ labels });
        api.intercept((_url, init) =>
          init.method ? failure(status) : undefined,
        );
        await expect(api.update()).rejects.toThrow(`HTTP ${status}`);
        expect(api.writes()).toHaveLength(1);
        expect(api.writes()[0][1]!.method).toBe(
          labels.includes(descriptionLabel) ? "DELETE" : "PATCH",
        );
      }
    },
  );

  it("accepts a raced 404 label removal only after confirming the label is absent", async () => {
    const api = fakeGitHub({ comment: false });
    api.intercept((url, init) => {
      if (
        url.pathname.endsWith(`/labels/${descriptionLabel}`) &&
        init.method === "DELETE"
      ) {
        api.state.labels = ["bug"];
        return failure(404);
      }
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.labels).toEqual(["bug"]);
  });

  it("does not swallow a removal 404 when the managed label remains attached", async () => {
    const api = fakeGitHub({ comment: false });
    api.intercept((url, init) =>
      url.pathname.endsWith(`/labels/${descriptionLabel}`) &&
      init.method === "DELETE"
        ? failure(404)
        : undefined,
    );
    await expect(api.update()).rejects.toThrow("HTTP 404");
    expect(api.writes()).toHaveLength(1);
  });

  it("handles a bodyless 204 DELETE without creating comments or label definitions", async () => {
    const api = fakeGitHub({ comment: false });
    const json = vi.fn().mockRejectedValue(new Error("No JSON on 204"));
    api.intercept((url, init) => {
      if (
        url.pathname.endsWith(`/labels/${descriptionLabel}`) &&
        init.method === "DELETE"
      ) {
        api.state.labels = ["bug"];
        return { ok: true, status: 204, json };
      }
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(json).not.toHaveBeenCalled();
    expect(api.state.labels).toEqual(["bug"]);
    expect(api.writes()[0][1]).not.toHaveProperty("body");
    expect(api.writes().every(([, init]) => init!.method !== "POST")).toBe(
      true,
    );
  });

  it("uses a no-permission, no-checkout closed-event signal and one repository-wide trusted writer", () => {
    const source = readFileSync(
      ".github/workflows/pr-description-lifecycle.yml",
      "utf8",
    );
    expect(source).toContain("name: PR description lifecycle");
    expect(source).toContain("pull_request:");
    expect(source).toMatch(/types:\s*\[closed\]/);
    expect(source).toMatch(/^permissions:\s*\{\}$/m);
    expect(source).toContain("name: pr-description-lifecycle");
    expect(source).toMatch(/run: ["']?true["']?/);
    expect(source).not.toMatch(
      /uses:|pull_request_target:|GITHUB_TOKEN|npm|node-version/,
    );
    const writer = readFileSync(
      ".github/workflows/pr-description-comment.yml",
      "utf8",
    );
    expect(writer.match(/workflows:[\s\S]*?types:/)?.[0]).toContain(
      "PR description lifecycle",
    );
    expect(writer).toContain(
      "group: pr-description-feedback-${{ github.repository_id }}",
    );
    expect(writer).toContain("queue: max");
    expect(writer).toContain("cancel-in-progress: false");
    expect(writer).toContain("ref: ${{ github.sha }}");
    expect(writer).not.toMatch(
      /ref:.*(?:workflow_run\.head|pull_request)|download-artifact/,
    );
  });
});
