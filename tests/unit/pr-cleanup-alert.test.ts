import { describe, expect, it, vi } from "vitest";

import {
  cleanupAlertMarker,
  cleanupAlertTitle,
  synchronizeCleanupAlert,
} from "../../scripts/alert-pr-cleanup.mjs";

const repository = "owner/repo";
const bot = { login: "github-actions[bot]", type: "Bot" };
const metadata = {
  repository,
  token: "test-token",
  result: "failure",
  runId: 1000,
  runNumber: 10,
  runAttempt: 1,
};
type Issue = {
  number: number;
  id: number;
  title: string;
  body: string;
  state: string;
  user: { login: string; type: string };
  labels: { name: string }[];
  assignees: { login: string }[];
  pull_request?: object;
  state_reason?: string;
};
const success = (value: unknown) => ({
  ok: true,
  status: 200,
  json: async () => structuredClone(value),
});
const failure = (status: number) => ({ ok: false, status });

function fakeGitHub() {
  const state = { issues: [] as Issue[] };
  const fetchImpl = vi.fn(async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const route = url.pathname.replace(`/repos/${repository}`, "");
    if (route === "/issues" && init.method === "POST") {
      const issue: Issue = {
        number: 42,
        id: 900,
        ...JSON.parse(String(init.body)),
        state: "open",
        user: bot,
        labels: [{ name: "documentation" }],
        assignees: [{ login: "maintainer" }],
      };
      state.issues.push(issue);
      return success(issue);
    }
    if (route === "/issues") {
      const page = Number(url.searchParams.get("page") ?? "1");
      return success(state.issues.slice((page - 1) * 100, page * 100));
    }
    const match = route.match(/^\/issues\/(\d+)$/);
    if (match) {
      const issue = state.issues.find(
        (item) => item.number === Number(match[1]),
      );
      if (!issue) return failure(404);
      if (init.method === "PATCH")
        Object.assign(issue, JSON.parse(String(init.body)));
      else if (init.method)
        throw new Error("Only body/state patches are supported.");
      return success(issue);
    }
    throw new Error(`Unexpected request: ${route}`);
  });
  const synchronize = (overrides: Partial<typeof metadata> = {}) =>
    synchronizeCleanupAlert({ ...metadata, ...overrides, fetchImpl });
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
  return { state, fetchImpl, synchronize, writes, intercept };
}

function editRecordedState(issue: Issue, edit: (state: any) => void) {
  const lines = issue.body.split("\n");
  const prefix = "<!-- pr-cleanup-alert-state: ";
  const value = JSON.parse(lines[1].slice(prefix.length, -4));
  edit(value);
  lines[1] = `${prefix}${JSON.stringify(value)} -->`;
  issue.body = lines.join("\n");
}

describe("one reusable PR cleanup failure Issue", () => {
  it("creates one owned Issue on the first failure with fixed safe links and no comments", async () => {
    const api = fakeGitHub();
    expect(await api.synchronize()).toEqual({ action: "created", number: 42 });
    const [issue] = api.state.issues;
    expect(issue.title).toBe(cleanupAlertTitle);
    expect(issue.body.startsWith(`${cleanupAlertMarker}\n`)).toBe(true);
    expect(issue.body).toContain("PR cleanup sweep failed");
    expect(issue.body).toContain("/actions/runs/1000/attempts/1");
    expect(issue.body).not.toContain("test-token");
    expect(api.writes()).toHaveLength(1);
    expect(JSON.parse(String(api.writes()[0][1]!.body))).toEqual({
      title: cleanupAlertTitle,
      body: issue.body,
    });
    const list = new URL(api.fetchImpl.mock.calls[0][0]);
    expect(list.searchParams.get("state")).toBe("all");
    expect(list.searchParams.get("sort")).toBe("created");
    expect(list.searchParams.get("direction")).toBe("asc");
  });

  it("does not create a success Issue before any failure", async () => {
    const api = fakeGitHub();
    expect(await api.synchronize({ result: "success" })).toEqual({
      action: "unchanged",
    });
    expect(api.state.issues).toEqual([]);
    expect(api.writes()).toEqual([]);
  });

  it("does not update or comment again for an identical failed run attempt", async () => {
    const api = fakeGitHub();
    await api.synchronize();
    api.fetchImpl.mockClear();
    expect(await api.synchronize()).toEqual({
      action: "unchanged",
      number: 42,
    });
    expect(api.writes()).toEqual([]);
  });

  it("updates the same Issue body for the next failure and preserves labels and assignees", async () => {
    const api = fakeGitHub();
    await api.synchronize();
    api.fetchImpl.mockClear();
    expect(await api.synchronize({ runId: 2000, runNumber: 11 })).toEqual({
      action: "updated",
      number: 42,
    });
    expect(api.state.issues).toHaveLength(1);
    expect(api.state.issues[0].body).toContain("/actions/runs/2000/attempts/1");
    expect(api.state.issues[0].labels).toEqual([{ name: "documentation" }]);
    expect(api.state.issues[0].assignees).toEqual([{ login: "maintainer" }]);
    expect(api.writes()).toHaveLength(1);
    const patch = JSON.parse(String(api.writes()[0][1]!.body));
    expect(Object.keys(patch).sort()).toEqual(["body", "title"]);
    expect(
      api.fetchImpl.mock.calls.map(([url]) => new URL(url).pathname),
    ).not.toContain(`/repos/${repository}/issues/42/comments`);
  });

  it("closes the original Issue on recovery and stays quiet on later successful sweeps", async () => {
    const api = fakeGitHub();
    await api.synchronize();
    expect(
      await api.synchronize({ result: "success", runId: 2000, runNumber: 11 }),
    ).toEqual({ action: "closed", number: 42 });
    const closed = structuredClone(api.state.issues[0]);
    expect(closed.state).toBe("closed");
    expect(closed.state_reason).toBe("completed");
    expect(closed.body).toContain("PR cleanup sweep recovered");
    expect(closed.body).toContain("/actions/runs/1000/attempts/1");
    expect(closed.body).toContain("/actions/runs/2000/attempts/1");
    api.fetchImpl.mockClear();
    expect(
      await api.synchronize({ result: "success", runId: 3000, runNumber: 12 }),
    ).toEqual({ action: "unchanged", number: 42 });
    expect(api.state.issues[0]).toEqual(closed);
    expect(api.writes()).toEqual([]);
  });

  it("reopens the same closed Issue if a later sweep fails", async () => {
    const api = fakeGitHub();
    await api.synchronize();
    await api.synchronize({ result: "success", runId: 2000, runNumber: 11 });
    api.fetchImpl.mockClear();
    expect(await api.synchronize({ runId: 3000, runNumber: 12 })).toEqual({
      action: "reopened",
      number: 42,
    });
    expect(api.state.issues).toHaveLength(1);
    expect(api.state.issues[0].state_reason).toBe("reopened");
    expect(api.state.issues[0].body).toContain("/actions/runs/3000/attempts/1");
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["PATCH"]);
  });

  it("records recovery even when a human already closed the still-failing alert", async () => {
    const api = fakeGitHub();
    await api.synchronize();
    api.state.issues[0].state = "closed";
    api.state.issues[0].state_reason = "not_planned";
    api.fetchImpl.mockClear();
    expect(
      await api.synchronize({ result: "success", runId: 2000, runNumber: 11 }),
    ).toEqual({ action: "closed", number: 42 });
    expect(api.state.issues[0].body).toContain("PR cleanup sweep recovered");
    expect(api.state.issues[0].body).toContain("/actions/runs/2000/attempts/1");
    expect(api.state.issues[0].state).toBe("closed");
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["PATCH"]);
  });

  it("supports recovery on a newer attempt of the same workflow run", async () => {
    const api = fakeGitHub();
    await api.synchronize();
    expect(await api.synchronize({ result: "success", runAttempt: 2 })).toEqual(
      { action: "closed", number: 42 },
    );
    expect(api.state.issues[0].body).toContain("/actions/runs/1000/attempts/2");
  });

  it.each([
    { result: "success", runId: 900, runNumber: 9, runAttempt: 4 },
    { result: "failure", runId: 900, runNumber: 9, runAttempt: 4 },
    { result: "success", runId: 1000, runNumber: 10, runAttempt: 1 },
  ])(
    "ignores an attempt older than the recorded transition: %j",
    async (old) => {
      const api = fakeGitHub();
      await api.synchronize({ runAttempt: 2 });
      api.fetchImpl.mockClear();
      expect(await api.synchronize(old)).toEqual({
        action: "stale",
        number: 42,
      });
      expect(api.writes()).toEqual([]);
    },
  );

  it("orders by workflow run number instead of assuming global run IDs are monotonic", async () => {
    const api = fakeGitHub();
    await api.synchronize({ runId: 5000 });
    expect(await api.synchronize({ runId: 2000, runNumber: 11 })).toEqual({
      action: "updated",
      number: 42,
    });
  });

  it.each([{ result: "success" }, { runId: 2000 }])(
    "rejects conflicting identity or result for one recorded run attempt: %j",
    async (change) => {
      const api = fakeGitHub();
      await api.synchronize();
      api.fetchImpl.mockClear();
      await expect(api.synchronize(change)).rejects.toThrow();
      expect(api.writes()).toEqual([]);
    },
  );
});

describe("owned Issue discovery and safe updates", () => {
  it.each([
    { user: { login: "contributor", type: "User" } },
    { user: { login: "another[bot]", type: "Bot" } },
    { user: { login: "github-actions[bot]", type: "User" } },
    { pull_request: {} },
    { body: `Preface\n${cleanupAlertMarker}\nCopied marker` },
  ])(
    "does not treat a copied marker or PR as its owned Issue: %j",
    async (change) => {
      const api = fakeGitHub();
      await api.synchronize();
      Object.assign(api.state.issues[0], change);
      api.fetchImpl.mockClear();
      expect(
        await api.synchronize({
          result: "success",
          runId: 2000,
          runNumber: 11,
        }),
      ).toEqual({ action: "unchanged" });
      expect(api.writes()).toEqual([]);
    },
  );

  it("paginates through all closed and open issues and deduplicates repeated list rows", async () => {
    const api = fakeGitHub();
    await api.synchronize();
    const issue = api.state.issues[0];
    const unrelated = Array.from({ length: 100 }, (_, index) => ({
      ...issue,
      number: index + 100,
      user: { login: "user", type: "User" },
    }));
    api.state.issues = [...unrelated, issue, structuredClone(issue)];
    api.fetchImpl.mockClear();
    expect(await api.synchronize()).toEqual({
      action: "unchanged",
      number: 42,
    });
    expect(
      api.fetchImpl.mock.calls.some(
        ([url]) => new URL(url).searchParams.get("page") === "2",
      ),
    ).toBe(true);
    expect(api.writes()).toEqual([]);
  });

  it("fails without writes if more than one owned alert Issue exists", async () => {
    const api = fakeGitHub();
    await api.synchronize();
    api.state.issues.push({ ...api.state.issues[0], number: 43, id: 901 });
    api.fetchImpl.mockClear();
    await expect(api.synchronize()).rejects.toThrow("Multiple managed");
    expect(api.writes()).toEqual([]);
  });

  it.each([
    (issue: Issue) => {
      issue.number = 0;
    },
    (issue: Issue) => {
      issue.state = "unknown";
    },
    (issue: Issue) => {
      issue.body = `${cleanupAlertMarker}\nInvalid metadata`;
    },
    (issue: Issue) =>
      editRecordedState(issue, (state) => {
        state.version = 2;
      }),
    (issue: Issue) =>
      editRecordedState(issue, (state) => {
        state.current.runId = 0;
      }),
    (issue: Issue) =>
      editRecordedState(issue, (state) => {
        state.current.runNumber = "10";
      }),
    (issue: Issue) =>
      editRecordedState(issue, (state) => {
        state.failure.runId = 999;
      }),
    (issue: Issue) =>
      editRecordedState(issue, (state) => {
        state.failure.runNumber = 99;
      }),
    (issue: Issue) =>
      editRecordedState(issue, (state) => {
        state.current.result = "cancelled";
      }),
  ])(
    "rejects malformed bot-owned metadata instead of creating another alert",
    async (edit) => {
      const api = fakeGitHub();
      await api.synchronize();
      edit(api.state.issues[0]);
      api.fetchImpl.mockClear();
      await expect(api.synchronize()).rejects.toThrow("invalid metadata");
      expect(api.writes()).toEqual([]);
    },
  );

  it.each(["body", "state", "title", "number", "author", "pull request"])(
    "does not PATCH if the discovered Issue changes its %s before writing",
    async (change) => {
      const api = fakeGitHub();
      await api.synchronize();
      api.fetchImpl.mockClear();
      api.intercept((url) => {
        if (!url.pathname.endsWith("/issues/42")) return;
        const issue = structuredClone(api.state.issues[0]);
        if (change === "body") issue.body += "\nHuman edit";
        if (change === "state") issue.state = "closed";
        if (change === "title") issue.title = "Human title";
        if (change === "number") issue.number = 43;
        if (change === "author") issue.user = { login: "human", type: "User" };
        if (change === "pull request") issue.pull_request = {};
        return success(issue);
      });
      expect(await api.synchronize({ runId: 2000, runNumber: 11 })).toEqual({
        action: "stale",
        number: 42,
      });
      expect(api.writes()).toEqual([]);
    },
  );
});

describe("alert API failures and validation", () => {
  it.each([403, 500, 503])(
    "fails visibly on HTTP %i discovery errors without creating an Issue",
    async (status) => {
      const api = fakeGitHub();
      api.intercept(() => failure(status));
      await expect(api.synchronize()).rejects.toThrow(`HTTP ${status}`);
      expect(api.writes()).toEqual([]);
    },
  );

  it.each(["POST", "PATCH"])(
    "does not blindly retry an ambiguous %s",
    async (method) => {
      const api = fakeGitHub();
      if (method === "PATCH") await api.synchronize();
      api.fetchImpl.mockClear();
      api.intercept((_url, init) =>
        init.method === method ? failure(500) : undefined,
      );
      await expect(
        api.synchronize({ runId: 2000, runNumber: 11 }),
      ).rejects.toThrow("HTTP 500");
      expect(api.writes()).toHaveLength(1);
    },
  );

  it("rediscovers one Issue after a successful creation loses its response", async () => {
    const api = fakeGitHub();
    const original = api.fetchImpl.getMockImplementation()!;
    let loseResponse = true;
    api.fetchImpl.mockImplementation(async (url, init = {}) => {
      const response = await original(url, init);
      if (init.method === "POST" && loseResponse) {
        loseResponse = false;
        throw new Error("private test-token response lost");
      }
      return response;
    });
    await expect(api.synchronize()).rejects.toThrow("API request failed");
    expect(api.state.issues).toHaveLength(1);
    expect(await api.synchronize()).toEqual({
      action: "unchanged",
      number: 42,
    });
    expect(api.writes().map(([, init]) => init!.method)).toEqual(["POST"]);
  });

  it.each([
    { name: "Error", message: "private test-token" },
    { name: "TimeoutError", message: "private test-token" },
  ])("uses safe fixed errors for transport failures: %s", async (error) => {
    const api = fakeGitHub();
    api.intercept(() => {
      throw Object.assign(new Error(error.message), { name: error.name });
    });
    try {
      await api.synchronize();
      throw new Error("Expected failure");
    } catch (failure: any) {
      expect(failure.message).not.toMatch(/private|test-token/);
      expect(failure.message).toMatch(
        error.name === "TimeoutError" ? /timed out/ : /request failed/,
      );
    }
  });

  it.each([
    success({ invalid: "list" }),
    {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("private token JSON");
      },
    },
  ])(
    "rejects malformed issue-list responses without writes",
    async (response) => {
      const api = fakeGitHub();
      api.intercept(() => response);
      await expect(api.synchronize()).rejects.toThrow(/invalid/i);
      expect(api.writes()).toEqual([]);
    },
  );

  it("does not trust an incorrect Issue returned after POST", async () => {
    const api = fakeGitHub();
    api.intercept((_url, init) =>
      init.method === "POST"
        ? success({ number: 42, body: "unrelated" })
        : undefined,
    );
    await expect(api.synchronize()).rejects.toThrow("invalid created Issue");
    expect(api.writes()).toHaveLength(1);
  });

  it.each([
    { repository: "invalid" },
    { repository: "../repo" },
    { token: "" },
    { token: 123 },
    { result: "cancelled" },
    { result: "skipped" },
    { runId: 0 },
    { runId: "1000" },
    { runNumber: -1 },
    { runNumber: NaN },
    { runAttempt: 1.5 },
    { runAttempt: Number.MAX_SAFE_INTEGER + 1 },
    { apiUrl: "http://api.github.com" },
    { apiUrl: "https://secret@api.github.com" },
    { apiUrl: "https://api.github.com?token=private" },
  ])("validates metadata before API calls: %j", async (change) => {
    const fetchImpl = vi.fn();
    await expect(
      synchronizeCleanupAlert({ ...metadata, ...change, fetchImpl }),
    ).rejects.toThrow("invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sets a bounded timeout and authentication headers without a GET request body", async () => {
    const api = fakeGitHub();
    await api.synchronize({ result: "success" });
    const [, init] = api.fetchImpl.mock.calls[0];
    expect(init).toMatchObject({
      headers: { Authorization: "Bearer test-token" },
      signal: expect.any(AbortSignal),
    });
    expect(init).not.toHaveProperty("body");
  });
});
