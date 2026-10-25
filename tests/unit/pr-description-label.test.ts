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
  .replace(/\n-\n/, "\n- Synchronize the description label and feedback.\n")
  .replace(/\|\s*\|\s*$/gm, "| Pass — verified locally |")
  .replaceAll("- [ ]", "- [x]");
const repository = "owner/repo";
const metadata = {
  repository,
  token: "test-token",
  run: {
    name: "PR description",
    event: "pull_request",
    status: "completed",
    path: ".github/workflows/pr-description.yml",
    repository: { full_name: repository },
    head_repository: { id: 123, full_name: "contributor/fork" },
    head_branch: "feature/description-label",
    head_sha: "a".repeat(40),
    pull_requests: [],
  },
};
type Label = {
  name: string;
  color?: string;
  description?: string;
  archived_at?: string | null;
};
const success = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => structuredClone(value),
});
const failure = (status: number) => ({ ok: false, status });

function fakeGitHub({
  body = template,
  labels = [] as Label[],
  repoLabel = {
    name: descriptionLabel,
    color: "123abc",
    description: "Existing metadata",
  } as Label | null,
  comment = true,
} = {}) {
  const state = {
    pr: {
      number: 7,
      body,
      state: "open",
      base: { repo: { full_name: repository } },
      head: {
        repo: { full_name: metadata.run.head_repository.full_name },
        ref: metadata.run.head_branch,
        sha: metadata.run.head_sha,
      },
    },
    labels,
    repoLabel,
    comments: comment
      ? [
          {
            id: 900,
            body: renderDescriptionComment(
              validateDescription(body),
              repository,
              7,
            ),
            user: { login: "github-actions[bot]", type: "Bot" },
          },
        ]
      : [],
  };
  const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const route = url.pathname.replace(`/repos/${repository}`, "");
    const page = Number(url.searchParams.get("page") ?? 1);
    if (route === "/pulls") return success([state.pr]);
    if (route === "/pulls/7") return success(state.pr);
    if (route === `/labels/${descriptionLabel}`)
      return state.repoLabel ? success(state.repoLabel) : failure(404);
    if (route === "/labels" && init.method === "POST") {
      state.repoLabel = JSON.parse(String(init.body));
      return success(state.repoLabel);
    }
    if (route === "/issues/7/labels") {
      if (init.method === "POST") {
        for (const name of JSON.parse(String(init.body)).labels as string[]) {
          if (
            !state.labels.some(
              (label) => label.name.toLowerCase() === name.toLowerCase(),
            )
          )
            state.labels.push({ name });
        }
      }
      return success(state.labels.slice((page - 1) * 100, page * 100));
    }
    if (
      route === `/issues/7/labels/${descriptionLabel}` &&
      init.method === "DELETE"
    ) {
      state.labels = state.labels.filter(
        (label) => label.name.toLowerCase() !== descriptionLabel,
      );
      return success(state.labels);
    }
    if (route === "/issues/7/comments") {
      if (init.method === "POST") {
        const saved = {
          id: 900,
          body: JSON.parse(String(init.body)).body,
          user: { login: "github-actions[bot]", type: "Bot" },
        };
        state.comments.push(saved);
        return success(saved);
      }
      return success(state.comments);
    }
    if (route === "/issues/comments/900" && init.method === "PATCH") {
      state.comments[0].body = JSON.parse(String(init.body)).body;
      return success(state.comments[0]);
    }
    throw new Error(
      `Unexpected GitHub request: ${init.method ?? "GET"} ${route}`,
    );
  });
  const writes = () => fetchImpl.mock.calls.filter(([, init]) => init?.method);
  const labelWrites = () =>
    writes().filter(([url]) => /\/issues\/7\/labels(?:\/|$)/.test(url));
  const commentWrites = () =>
    writes().filter(([url]) =>
      /\/issues\/(?:7\/comments|comments\/900)$/.test(url),
    );
  const intercept = (
    handler: (url: URL, init: RequestInit) => unknown | Promise<unknown>,
  ) => {
    const original = fetchImpl.getMockImplementation()!;
    fetchImpl.mockImplementation(async (input, init = {}) => {
      const result = await handler(new URL(input), init);
      return result === undefined ? original(input, init) : result;
    });
  };
  const update = () => updateDescriptionComments({ ...metadata, fetchImpl });
  return {
    state,
    fetchImpl,
    writes,
    labelWrites,
    commentWrites,
    intercept,
    update,
  };
}

describe("needs-description label lifecycle", () => {
  it("adds, repairs, regresses, and reruns without replacing other labels or the bot comment", async () => {
    const api = fakeGitHub({
      labels: [{ name: "bug" }, { name: "documentation" }],
      comment: false,
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "created", id: 900, label: "added" },
    ]);
    expect(api.state.labels.map((label) => label.name)).toEqual([
      "bug",
      "documentation",
      descriptionLabel,
    ]);
    expect(await api.update()).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.labelWrites()).toHaveLength(1);
    expect(api.commentWrites()).toHaveLength(1);

    api.state.pr.body = completed;
    expect(await api.update()).toEqual([
      { number: 7, action: "updated", id: 900, label: "removed" },
    ]);
    expect(api.state.labels.map((label) => label.name)).toEqual([
      "bug",
      "documentation",
    ]);
    api.state.pr.body = template;
    expect(await api.update()).toEqual([
      { number: 7, action: "updated", id: 900, label: "added" },
    ]);
    expect(await api.update()).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.state.comments).toHaveLength(1);
    expect(api.state.comments[0].id).toBe(900);
    expect(api.labelWrites().map(([, init]) => init!.method)).toEqual([
      "POST",
      "DELETE",
      "POST",
    ]);
    expect(api.writes().every(([, init]) => init!.method !== "PUT")).toBe(true);
    for (const [, init] of api
      .labelWrites()
      .filter(([, init]) => init!.method === "POST"))
      expect(JSON.parse(String(init!.body))).toEqual({
        labels: [descriptionLabel],
      });
  });

  it("restores a missing label even when the feedback comment is already identical", async () => {
    const api = fakeGitHub();
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "added" },
    ]);
    expect(api.commentWrites()).toEqual([]);
    expect(api.labelWrites()).toHaveLength(1);
  });

  it("removes a stale label on an initially complete PR without creating a success comment", async () => {
    const api = fakeGitHub({
      body: completed,
      labels: [{ name: descriptionLabel }, { name: "bug" }],
      comment: false,
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.labels).toEqual([{ name: "bug" }]);
    expect(api.state.comments).toEqual([]);
    expect(await api.update()).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.labelWrites()).toHaveLength(1);
  });

  it("recognizes an already attached label case-insensitively", async () => {
    const api = fakeGitHub({ labels: [{ name: "Needs-Description" }] });
    expect(await api.update()).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.writes()).toEqual([]);
  });

  it("paginates attached labels and removes only the managed one on the second page", async () => {
    const others = Array.from({ length: 100 }, (_, index) => ({
      name: `label-${index}`,
    }));
    const api = fakeGitHub({
      body: completed,
      labels: [...others, { name: descriptionLabel }],
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.labels).toEqual(others);
    expect(
      api.fetchImpl.mock.calls.some(([url]) =>
        url.endsWith("/issues/7/labels?per_page=100&page=2"),
      ),
    ).toBe(true);
    expect(api.labelWrites()[0][0]).toBe(
      `https://api.github.com/repos/${repository}/issues/7/labels/${descriptionLabel}`,
    );
  });
});

describe("repository-label initialization", () => {
  it("creates a missing definition once with fixed metadata and then adds it to the PR", async () => {
    const api = fakeGitHub({ repoLabel: null });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "added" },
    ]);
    expect(api.state.repoLabel).toMatchObject({
      name: descriptionLabel,
      color: "fbca04",
    });
    expect(api.state.repoLabel!.description!.length).toBeLessThanOrEqual(100);
    expect(api.writes().map(([url]) => new URL(url).pathname)).toEqual([
      `/repos/${repository}/labels`,
      `/repos/${repository}/issues/7/labels`,
    ]);
    expect(await api.update()).toEqual([{ number: 7, action: "unchanged" }]);
    expect(api.writes()).toHaveLength(2);
  });

  it("keeps an existing definition's color and description unchanged", async () => {
    const api = fakeGitHub();
    const definition = structuredClone(api.state.repoLabel);
    await api.update();
    expect(api.state.repoLabel).toEqual(definition);
    expect(
      api.writes().every(([url]) => !url.endsWith("/labels/needs-description")),
    ).toBe(true);
    expect(api.writes()).toHaveLength(1);
  });

  it("handles a concurrent definition creation by confirming a 422 instead of retrying or overwriting", async () => {
    const api = fakeGitHub({ repoLabel: null });
    api.intercept((url, init) => {
      if (
        url.pathname === `/repos/${repository}/labels` &&
        init.method === "POST"
      ) {
        api.state.repoLabel = {
          name: descriptionLabel,
          color: "111111",
          description: "Created by another PR",
        };
        return failure(422);
      }
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "added" },
    ]);
    expect(api.state.repoLabel!.description).toBe("Created by another PR");
    expect(
      api
        .writes()
        .filter(
          ([url]) => new URL(url).pathname === `/repos/${repository}/labels`,
        ),
    ).toHaveLength(1);
    expect(
      api.fetchImpl.mock.calls.filter(([url]) =>
        url.endsWith(`/labels/${descriptionLabel}`),
      ),
    ).toHaveLength(2);
  });

  it("does not treat a 422 as successful initialization when no definition exists afterward", async () => {
    const api = fakeGitHub({ repoLabel: null });
    api.intercept((url, init) =>
      url.pathname === `/repos/${repository}/labels` && init.method === "POST"
        ? failure(422)
        : undefined,
    );
    await expect(api.update()).rejects.toThrow("HTTP 404");
    expect(api.labelWrites()).toEqual([]);
  });

  it.each([
    { name: descriptionLabel, archived_at: "2026-10-25T00:00:00Z" },
    { name: "unrelated" },
  ])(
    "rejects an unusable definition without PR writes: %j",
    async (repoLabel) => {
      const api = fakeGitHub({ repoLabel });
      await expect(api.update()).rejects.toThrow(
        /archived|Invalid needs-description/,
      );
      expect(api.labelWrites()).toEqual([]);
      expect(api.commentWrites()).toEqual([]);
    },
  );
});

describe("label mutation safety and failures", () => {
  it.each(["body", "head", "closed"])(
    "does not change labels when the PR %s changes during label initialization",
    async (change) => {
      const api = fakeGitHub();
      api.intercept((url) => {
        if (url.pathname.endsWith(`/labels/${descriptionLabel}`)) {
          if (change === "body") api.state.pr.body = completed;
          if (change === "head") api.state.pr.head.sha = "b".repeat(40);
          if (change === "closed") api.state.pr.state = "closed";
        }
      });
      expect(await api.update()).toEqual([{ number: 7, action: "stale" }]);
      expect(api.writes()).toEqual([]);
    },
  );

  it("rechecks before comment writes after the label API changed the PR body", async () => {
    const api = fakeGitHub({ comment: false });
    api.intercept((url, init) => {
      if (url.pathname.endsWith("/issues/7/labels") && init.method === "POST")
        api.state.pr.body = completed;
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "stale", label: "added" },
    ]);
    expect(api.commentWrites()).toEqual([]);
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.labels).toEqual([]);
  });

  it("accepts a concurrent removal only after confirming the managed label is absent", async () => {
    const api = fakeGitHub({
      body: completed,
      labels: [{ name: descriptionLabel }, { name: "bug" }],
    });
    api.intercept((url, init) => {
      if (
        url.pathname.endsWith(`/labels/${descriptionLabel}`) &&
        init.method === "DELETE"
      ) {
        api.state.labels = [{ name: "bug" }];
        return failure(404);
      }
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(api.state.labels).toEqual([{ name: "bug" }]);
    expect(api.labelWrites()).toHaveLength(1);
  });

  it("does not hide a removal 404 while the managed label is still attached", async () => {
    const api = fakeGitHub({
      body: completed,
      labels: [{ name: descriptionLabel }],
    });
    api.intercept((url, init) =>
      url.pathname.endsWith(`/labels/${descriptionLabel}`) &&
      init.method === "DELETE"
        ? failure(404)
        : undefined,
    );
    await expect(api.update()).rejects.toThrow("HTTP 404");
    expect(api.labelWrites()).toHaveLength(1);
  });

  it("handles a successful bodyless DELETE response without parsing JSON or sending a request body", async () => {
    const api = fakeGitHub({
      body: completed,
      labels: [{ name: descriptionLabel }],
    });
    const json = vi.fn().mockRejectedValue(new Error("204 has no JSON"));
    api.intercept((url, init) => {
      if (
        url.pathname.endsWith(`/labels/${descriptionLabel}`) &&
        init.method === "DELETE"
      )
        return { ok: true, status: 204, json };
    });
    expect(await api.update()).toEqual([
      { number: 7, action: "unchanged", label: "removed" },
    ]);
    expect(json).not.toHaveBeenCalled();
    const init = api.labelWrites()[0][1]!;
    expect(init).not.toHaveProperty("body");
    expect(init.headers).not.toHaveProperty("Content-Type");
  });

  it.each([403, 500])(
    "fails closed without retrying add/remove requests on HTTP %i",
    async (status) => {
      for (const remove of [false, true]) {
        const api = fakeGitHub({
          body: remove ? completed : template,
          labels: remove ? [{ name: descriptionLabel }] : [],
        });
        api.intercept((url, init) =>
          url.pathname.includes("/issues/7/labels") && init.method
            ? failure(status)
            : undefined,
        );
        await expect(api.update()).rejects.toThrow(`HTTP ${status}`);
        expect(api.labelWrites()).toHaveLength(1);
        expect(api.commentWrites()).toEqual([]);
      }
    },
  );

  it.each(["add", "remove"])(
    "does not retry an uncertain %s response and recognizes the completed mutation on rerun",
    async (operation) => {
      const remove = operation === "remove";
      const api = fakeGitHub({
        body: remove ? completed : template,
        labels: remove
          ? [{ name: descriptionLabel }, { name: "bug" }]
          : [{ name: "bug" }],
      });
      const actualFetch = api.fetchImpl.getMockImplementation()!;
      let lost = false;
      api.fetchImpl.mockImplementation(async (input, init = {}) => {
        const result = await actualFetch(input, init);
        if (!lost && input.includes("/issues/7/labels") && init.method) {
          lost = true;
          throw new DOMException(
            "Response lost after mutation",
            "TimeoutError",
          );
        }
        return result;
      });
      await expect(api.update()).rejects.toThrow("Response lost");
      expect(api.labelWrites()).toHaveLength(1);
      expect(await api.update()).toEqual([{ number: 7, action: "unchanged" }]);
      expect(api.labelWrites()).toHaveLength(1);
      expect(api.commentWrites()).toEqual([]);
      expect(api.state.labels.some((label) => label.name === "bug")).toBe(true);
      expect(
        api.state.labels.some((label) => label.name === descriptionLabel),
      ).toBe(!remove);
    },
  );

  it("fails closed on malformed label-list data before changing comments or labels", async () => {
    const api = fakeGitHub({ comment: false });
    api.intercept((url) =>
      url.pathname.endsWith("/issues/7/labels")
        ? success({ not: "an array" })
        : undefined,
    );
    await expect(api.update()).rejects.toThrow("Invalid paginated");
    expect(api.writes()).toEqual([]);
  });
});
