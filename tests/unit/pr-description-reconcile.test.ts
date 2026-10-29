import { describe, expect, it, vi } from "vitest";

import {
  commentMarker,
  descriptionLabel,
  reconcileClosedDescriptionComments,
  renderTerminalDescriptionComment,
} from "../../scripts/comment-pr-description.mjs";

const repository = "owner/repo";
const bot = { login: "github-actions[bot]", type: "Bot" };
const pullRequest = (number = 7, merged = false) => ({
  number,
  state: "closed",
  merged,
  closed_at: "2020-01-02T03:04:05Z",
  merge_commit_sha: merged ? "b".repeat(40) : null,
  body: "Description still incomplete when the bot closed this PR.",
  base: { ref: "main", repo: { full_name: repository } },
  head: {
    ref: `feature/${number}`,
    sha: "a".repeat(40),
    repo: { full_name: "contributor/fork" },
  },
});
const ownedComment = (id = 900) => ({
  id,
  body: `${commentMarker}\n### PR description: incomplete ❌\n\nMissing confirmations.`,
  user: bot,
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
  labels = [descriptionLabel, "bug", "documentation"],
} = {}) {
  const pr = pullRequest(7, merged);
  const state = {
    candidates: [pr],
    pulls: new Map([[7, pr]]),
    comments: new Map([[7, comment ? [ownedComment()] : []]]),
    labels: new Map([[7, labels]]),
  };
  const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const route = url.pathname.replace(`/repos/${repository}`, "");
    const page = Number(url.searchParams.get("page") ?? "1");
    const slice = <T>(items: T[]) => items.slice((page - 1) * 100, page * 100);
    if (route === "/pulls") return success(slice(state.candidates));
    const pull = route.match(/^\/pulls\/(\d+)$/);
    if (pull) return success(state.pulls.get(Number(pull[1])));
    const comments = route.match(/^\/issues\/(\d+)\/comments$/);
    if (comments) {
      if (init.method) throw new Error("Sweep must never create a comment.");
      return success(slice(state.comments.get(Number(comments[1])) ?? []));
    }
    const patch = route.match(/^\/issues\/comments\/(\d+)$/);
    if (patch && init.method === "PATCH") {
      const saved = [...state.comments.values()]
        .flat()
        .find((comment) => comment.id === Number(patch[1]))!;
      saved.body = JSON.parse(String(init.body)).body;
      return success(saved);
    }
    const labelList = route.match(/^\/issues\/(\d+)\/labels$/);
    if (labelList) {
      if (init.method) throw new Error("Sweep must never replace labels.");
      return success(
        slice(state.labels.get(Number(labelList[1])) ?? []).map((name) => ({
          name,
        })),
      );
    }
    const labelDelete = route.match(/^\/issues\/(\d+)\/labels\/([^/]+)$/);
    if (labelDelete && init.method === "DELETE") {
      expect(decodeURIComponent(labelDelete[2])).toBe(descriptionLabel);
      const number = Number(labelDelete[1]);
      const remaining = (state.labels.get(number) ?? []).filter(
        (name) => name.toLowerCase() !== descriptionLabel,
      );
      state.labels.set(number, remaining);
      return success(remaining.map((name) => ({ name })));
    }
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
  const reconcile = () =>
    reconcileClosedDescriptionComments({
      repository,
      token: "test-token",
      fetchImpl,
    });
  return { pr, state, fetchImpl, writes, intercept, reconcile };
}

describe("scheduled terminal feedback reconciliation", () => {
  it.each([
    { merged: false, status: "closed" },
    { merged: true, status: "merged" },
  ])(
    "repairs old $status PRs without a source workflow run and preserves other labels and the same comment",
    async ({ merged, status }) => {
      const api = fakeGitHub({ merged });
      expect(await api.reconcile()).toEqual([
        { number: 7, action: "updated", label: "removed", id: 900 },
      ]);
      expect(api.state.labels.get(7)).toEqual(["bug", "documentation"]);
      expect(api.state.comments.get(7)).toEqual([
        { ...ownedComment(), body: renderTerminalDescriptionComment(status) },
      ]);
      expect(api.writes().map(([, init]) => init!.method)).toEqual([
        "DELETE",
        "PATCH",
      ]);
      expect(await api.reconcile()).toEqual([
        { number: 7, action: "unchanged" },
      ]);
      expect(api.writes()).toHaveLength(2);
      const search = new URL(api.fetchImpl.mock.calls[0][0]);
      expect(search.searchParams.get("state")).toBe("closed");
      expect(search.searchParams.get("sort")).toBe("updated");
      expect(search.searchParams.get("direction")).toBe("desc");
      expect([...search.searchParams.keys()].sort()).toEqual([
        "direction",
        "page",
        "per_page",
        "sort",
        "state",
      ]);
      expect(
        api.fetchImpl.mock.calls.some(([url]) =>
          new URL(url).pathname.includes("/actions/"),
        ),
      ).toBe(false);
    },
  );

  it("repairs a stale comment even if the managed label is already absent", async () => {
    const api = fakeGitHub({ labels: ["documentation"] });
    expect(await api.reconcile()).toEqual([
      { number: 7, action: "updated", id: 900 },
    ]);
    expect(api.state.labels.get(7)).toEqual(["documentation"]);
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["PATCH"]);
  });

  it("removes only the managed label without creating feedback when no original exists", async () => {
    const api = fakeGitHub({ comment: false });
    expect(await api.reconcile()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.comments.get(7)).toEqual([]);
    expect(api.state.labels.get(7)).toEqual(["bug", "documentation"]);
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["DELETE"]);
  });

  it("does not write anything for an already clean PR without original feedback", async () => {
    const api = fakeGitHub({ comment: false, labels: ["bug"] });
    expect(await api.reconcile()).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.writes()).toEqual([]);
  });

  it.each([
    { login: "contributor", type: "User" },
    { login: "another[bot]", type: "Bot" },
    { login: "github-actions[bot]", type: "User" },
  ])("does not patch a copied marker belonging to %j", async (user) => {
    const api = fakeGitHub();
    api.state.comments.get(7)![0].user = user;
    const original = structuredClone(api.state.comments.get(7));
    expect(await api.reconcile()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.comments.get(7)).toEqual(original);
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["DELETE"]);
  });

  it("repairs PRs from deleted forks without a usable source event", async () => {
    const api = fakeGitHub();
    api.pr.head.repo = null;
    expect(await api.reconcile()).toMatchObject([
      { number: 7, action: "updated", label: "removed", id: 900 },
    ]);
  });

  it("reads live merged state when the closed-PR listing omits the merged flag", async () => {
    const api = fakeGitHub({ merged: true });
    api.state.candidates = [{ ...api.pr, merged: undefined }];
    expect(await api.reconcile()).toMatchObject([
      { number: 7, action: "updated", id: 900 },
    ]);
    expect(api.state.comments.get(7)![0].body).toBe(
      renderTerminalDescriptionComment("merged"),
    );
  });

  it("paginates all closed PRs, comments, and labels, including old PRs past the first page", async () => {
    const api = fakeGitHub();
    const oldClean = Array.from({ length: 100 }, (_, index) =>
      pullRequest(index + 100),
    );
    api.state.candidates = [...oldClean, api.pr];
    for (const pr of oldClean) api.state.pulls.set(pr.number, pr);
    api.state.comments.set(7, [
      ...Array.from({ length: 100 }, (_, index) => ({
        ...ownedComment(index + 1000),
        user: { login: "contributor", type: "User" },
      })),
      ownedComment(),
    ]);
    const unrelated = Array.from({ length: 100 }, (_, index) => `tag-${index}`);
    api.state.labels.set(7, [...unrelated, descriptionLabel]);
    const result = await api.reconcile();
    expect(result).toHaveLength(101);
    expect(result).toContainEqual({
      number: 7,
      action: "updated",
      label: "removed",
      id: 900,
    });
    expect(api.state.labels.get(7)).toEqual(unrelated);
    expect(api.state.comments.get(7)).toHaveLength(101);
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

describe("scheduled sweep identity and per-write guards", () => {
  it.each(["open", "wrong repository", "invalid number"])(
    "skips %s candidates before fetching their details",
    async (kind) => {
      const api = fakeGitHub();
      if (kind === "open") api.pr.state = "open";
      if (kind === "wrong repository")
        api.pr.base.repo.full_name = "other/repo";
      if (kind === "invalid number") api.pr.number = 0;
      expect(await api.reconcile()).toEqual([]);
      expect(api.fetchImpl).toHaveBeenCalledTimes(1);
      expect(api.writes()).toEqual([]);
    },
  );

  it.each(["number", "open", "repository", "SHA"])(
    "skips a live endpoint response with mismatched %s",
    async (kind) => {
      const api = fakeGitHub();
      api.intercept((url) => {
        if (!url.pathname.endsWith("/pulls/7")) return;
        const live = structuredClone(api.pr);
        if (kind === "number") live.number = 8;
        if (kind === "open") live.state = "open";
        if (kind === "repository") live.base.repo.full_name = "other/repo";
        if (kind === "SHA") live.head.sha = "not-a-sha";
        return success(live);
      });
      expect(await api.reconcile()).toEqual([]);
      expect(api.writes()).toEqual([]);
    },
  );

  it.each([
    "state",
    "head SHA",
    "head branch",
    "head repository",
    "base repository",
    "base branch",
    "merge SHA",
    "closure time",
    "merged status",
  ])("skips writes when the live %s changes after lookup", async (field) => {
    const api = fakeGitHub();
    let reads = 0;
    api.intercept((url) => {
      if (!url.pathname.endsWith("/pulls/7") || ++reads < 2) return;
      if (field === "state") api.pr.state = "open";
      if (field === "head SHA") api.pr.head.sha = "c".repeat(40);
      if (field === "head branch") api.pr.head.ref = "another-branch";
      if (field === "head repository")
        api.pr.head.repo.full_name = "other/fork";
      if (field === "base repository")
        api.pr.base.repo.full_name = "other/repo";
      if (field === "base branch") api.pr.base.ref = "release";
      if (field === "merge SHA") api.pr.merge_commit_sha = "d".repeat(40);
      if (field === "closure time") api.pr.closed_at = "2026-10-30T00:00:00Z";
      if (field === "merged status") api.pr.merged = true;
    });
    expect(await api.reconcile()).toEqual([{ number: 7, action: "stale" }]);
    expect(api.writes()).toEqual([]);
  });

  it("rechecks after removing the label and leaves feedback untouched if the PR reopens", async () => {
    const api = fakeGitHub();
    api.intercept((url, init) => {
      if (url.pathname.endsWith(`/labels/${descriptionLabel}`) && init.method)
        api.pr.state = "open";
    });
    expect(await api.reconcile()).toEqual([
      { number: 7, action: "stale", label: "removed" },
    ]);
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["DELETE"]);
    expect(api.state.comments.get(7)![0].body).toContain("incomplete");
  });

  it("allows description-only edits while reconciling a closed PR", async () => {
    const api = fakeGitHub();
    let reads = 0;
    api.intercept((url) => {
      if (url.pathname.endsWith("/pulls/7") && ++reads > 1)
        api.pr.body = "Changed text does not change terminal identity.";
    });
    expect(await api.reconcile()).toMatchObject([
      { number: 7, action: "updated", label: "removed" },
    ]);
  });

  it.each([null, undefined, "false", 0])(
    "fails rather than guessing an unknown live merged status: %s",
    async (merged) => {
      const api = fakeGitHub();
      api.intercept((url) =>
        url.pathname.endsWith("/pulls/7")
          ? success({ ...api.pr, merged })
          : undefined,
      );
      await expect(api.reconcile()).rejects.toBeInstanceOf(AggregateError);
      expect(api.writes()).toEqual([]);
    },
  );
});

describe("scheduled sweep failures and recovery", () => {
  it.each([403, 500])(
    "continues other closed PRs but fails the run on a per-PR HTTP %i error",
    async (status) => {
      const api = fakeGitHub();
      const second = pullRequest(8, true);
      api.state.candidates.push(second);
      api.state.pulls.set(8, second);
      api.state.comments.set(8, [ownedComment(901)]);
      api.state.labels.set(8, [descriptionLabel, "enhancement"]);
      api.intercept((url, init) =>
        url.pathname.endsWith(`/issues/7/labels/${descriptionLabel}`) &&
        init.method === "DELETE"
          ? failure(status)
          : undefined,
      );
      await expect(api.reconcile()).rejects.toBeInstanceOf(AggregateError);
      expect(api.state.labels.get(7)).toContain(descriptionLabel);
      expect(api.state.comments.get(7)![0].body).toContain("incomplete");
      expect(api.state.labels.get(8)).toEqual(["enhancement"]);
      expect(api.state.comments.get(8)![0]).toMatchObject({
        id: 901,
        body: renderTerminalDescriptionComment("merged"),
      });
      expect(
        api.writes().filter(([url]) => url.includes("/issues/7/")),
      ).toHaveLength(1);
    },
  );

  it("repairs a comment on the next sweep after partial label-removal success", async () => {
    const api = fakeGitHub();
    let failPatch = true;
    api.intercept((_url, init) =>
      init.method === "PATCH" && failPatch ? failure(500) : undefined,
    );
    await expect(api.reconcile()).rejects.toBeInstanceOf(AggregateError);
    expect(api.state.labels.get(7)).toEqual(["bug", "documentation"]);
    expect(api.state.comments.get(7)![0].body).toContain("incomplete");
    failPatch = false;
    expect(await api.reconcile()).toEqual([
      { number: 7, action: "updated", id: 900 },
    ]);
    expect(api.state.comments.get(7)![0].body).toBe(
      renderTerminalDescriptionComment("closed"),
    );
    expect(api.writes().map(([, init]) => init!.method)).toEqual([
      "DELETE",
      "PATCH",
      "PATCH",
    ]);
  });

  it("accepts DELETE 404 only after confirming the managed label is absent", async () => {
    const api = fakeGitHub({ comment: false });
    api.intercept((url, init) => {
      if (url.pathname.endsWith(`/labels/${descriptionLabel}`) && init.method) {
        api.state.labels.set(7, ["bug", "documentation"]);
        return failure(404);
      }
    });
    expect(await api.reconcile()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.labels.get(7)).toEqual(["bug", "documentation"]);
  });

  it("fails a DELETE 404 when the managed label remains attached", async () => {
    const api = fakeGitHub({ comment: false });
    api.intercept((url, init) =>
      url.pathname.endsWith(`/labels/${descriptionLabel}`) && init.method
        ? failure(404)
        : undefined,
    );
    await expect(api.reconcile()).rejects.toBeInstanceOf(AggregateError);
    expect(api.writes()).toHaveLength(1);
    expect(api.state.labels.get(7)).toContain(descriptionLabel);
  });

  it("supports bodyless DELETE 204 without attempting to parse JSON", async () => {
    const api = fakeGitHub({ comment: false });
    const json = vi.fn(() => {
      throw new Error("A 204 response has no JSON body.");
    });
    api.intercept((url, init) => {
      if (url.pathname.endsWith(`/labels/${descriptionLabel}`) && init.method) {
        api.state.labels.set(7, ["bug", "documentation"]);
        return { ok: true, status: 204, json };
      }
    });
    expect(await api.reconcile()).toMatchObject([
      { number: 7, label: "removed" },
    ]);
    expect(json).not.toHaveBeenCalled();
  });

  it.each([failure(403), failure(500), success({ not: "an array" })])(
    "fails closed when the initial PR scan cannot be read safely: %j",
    async (response) => {
      const fetchImpl = vi.fn().mockResolvedValue(response);
      await expect(
        reconcileClosedDescriptionComments({
          repository,
          token: "test-token",
          fetchImpl,
        }),
      ).rejects.toThrow();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0][1]?.method).toBeUndefined();
    },
  );

  it.each([
    { repository: "invalid" },
    { repository: "owner/repo/extra" },
    { token: "" },
    { apiUrl: "http://api.github.com" },
  ])(
    "validates credentials and repository before requests: %j",
    async (bad) => {
      const fetchImpl = vi.fn();
      await expect(
        reconcileClosedDescriptionComments({
          repository,
          token: "test-token",
          ...bad,
          fetchImpl,
        }),
      ).rejects.toThrow();
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );
});
