import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const cleanupAlertMarker =
  "<!-- grammar-learning-site-builder:pr-cleanup-alert -->";
export const cleanupAlertTitle = "[Automation] PR cleanup sweep failure";
const metadataPrefix = "<!-- pr-cleanup-alert-state: ";
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const isRepository = (value) =>
  typeof value === "string" &&
  value.length <= 250 &&
  /^[\w.-]+\/[\w.-]+$/.test(value) &&
  !value.split("/").some((part) => [".", ".."].includes(part));
const isRun = (value) =>
  value != null &&
  ["runId", "runNumber", "runAttempt"].every((key) =>
    isPositiveInteger(value[key]),
  );
const compareRuns = (left, right) =>
  left.runNumber - right.runNumber || left.runAttempt - right.runAttempt;
const sameRun = (left, right) =>
  left.runId === right.runId && compareRuns(left, right) === 0;
const hasKeys = (value, keys) =>
  value != null &&
  !Array.isArray(value) &&
  typeof value === "object" &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));

function ownsAlert(issue) {
  return (
    issue?.pull_request == null &&
    issue?.user?.login === "github-actions[bot]" &&
    issue?.user?.type === "Bot" &&
    typeof issue?.body === "string" &&
    issue.body.startsWith(`${cleanupAlertMarker}\n`)
  );
}

function readAlertState(issue) {
  try {
    if (
      !isPositiveInteger(issue.number) ||
      !["open", "closed"].includes(issue.state)
    )
      throw new Error();
    const lines = issue.body.split("\n");
    if (
      !lines[1]?.startsWith(metadataPrefix) ||
      !lines[1].endsWith(" -->") ||
      lines.filter((line) => line.startsWith(metadataPrefix)).length !== 1
    )
      throw new Error();
    const state = JSON.parse(lines[1].slice(metadataPrefix.length, -4));
    if (
      !hasKeys(state, ["version", "current", "failure"]) ||
      state.version !== 1 ||
      !hasKeys(state.current, ["runId", "runNumber", "runAttempt", "result"]) ||
      !hasKeys(state.failure, ["runId", "runNumber", "runAttempt"]) ||
      !isRun(state.current) ||
      !isRun(state.failure) ||
      !["success", "failure"].includes(state.current.result) ||
      compareRuns(state.failure, state.current) > 0 ||
      (state.failure.runNumber === state.current.runNumber &&
        state.failure.runId !== state.current.runId) ||
      (state.current.result === "failure"
        ? !sameRun(state.failure, state.current)
        : compareRuns(state.failure, state.current) >= 0)
    )
      throw new Error();
    return state;
  } catch {
    throw new Error("Managed PR cleanup alert has invalid metadata.");
  }
}

function runLink(repository, run) {
  return `https://github.com/${repository}/actions/runs/${run.runId}/attempts/${run.runAttempt}`;
}

function renderAlertBody(repository, state) {
  const failed = state.current.result === "failure";
  return `${cleanupAlertMarker}\n${metadataPrefix}${JSON.stringify(state)} -->\n\n## PR cleanup sweep ${failed ? "failed" : "recovered"}\n\n${failed ? "The scheduled or manually dispatched cleanup sweep failed. Review its run summary and logs, resolve the cause, then run the default-branch sweep again." : "The cleanup sweep succeeded after a recorded failure. This alert is resolved and the same Issue will be reused if a later sweep fails."}\n\nLatest failure: [run ${state.failure.runNumber}, attempt ${state.failure.runAttempt}](${runLink(repository, state.failure)}).\n${failed ? "" : `\nRecovery: [run ${state.current.runNumber}, attempt ${state.current.runAttempt}](${runLink(repository, state.current)}).\n`}\nRepeated failures update this Issue's body without posting comments or mentions. Other labels and assignees are preserved.`;
}

export async function synchronizeCleanupAlert({
  repository,
  token,
  result,
  runId,
  runNumber,
  runAttempt,
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  const current = { runId, runNumber, runAttempt, result };
  let api;
  try {
    api = new URL(apiUrl);
    if (
      !isRepository(repository) ||
      typeof token !== "string" ||
      !token.trim() ||
      !isRun(current) ||
      !["success", "failure"].includes(result) ||
      api.protocol !== "https:" ||
      api.username ||
      api.password ||
      api.search ||
      api.hash
    )
      throw new Error();
  } catch {
    throw new Error("Missing or invalid PR cleanup alert metadata or token.");
  }
  const apiBase = api.href.replace(/\/+$/, "");
  const request = async (route, method, body) => {
    let response;
    try {
      response = await fetchImpl(`${apiBase}/repos/${repository}${route}`, {
        ...(method ? { method } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      throw new Error(
        error?.name === "TimeoutError"
          ? "PR cleanup alert API request timed out."
          : "PR cleanup alert API request failed.",
      );
    }
    if (!response.ok)
      throw new Error(
        Number.isInteger(response.status) &&
          response.status >= 100 &&
          response.status <= 599
          ? `PR cleanup alert API request failed (HTTP ${response.status}).`
          : "PR cleanup alert API returned an invalid HTTP response.",
      );
    try {
      return await response.json();
    } catch {
      throw new Error("PR cleanup alert API returned invalid JSON.");
    }
  };
  const owned = new Map();
  for (let page = 1; ; page++) {
    const issues = await request(
      `/issues?state=all&sort=created&direction=asc&per_page=100&page=${page}`,
    );
    if (!Array.isArray(issues))
      throw new Error("PR cleanup alert API returned an invalid issue list.");
    for (const issue of issues.filter(ownsAlert)) {
      readAlertState(issue);
      const previous = owned.get(issue.number);
      if (
        previous &&
        (previous.body !== issue.body || previous.state !== issue.state)
      )
        throw new Error("Managed PR cleanup alert changed during discovery.");
      owned.set(issue.number, issue);
    }
    if (issues.length < 100) break;
  }
  if (owned.size > 1)
    throw new Error("Multiple managed PR cleanup alert Issues exist.");
  const existing = [...owned.values()][0];
  if (!existing) {
    if (result === "success") return { action: "unchanged" };
    const state = {
      version: 1,
      current,
      failure: { runId, runNumber, runAttempt },
    };
    const body = renderAlertBody(repository, state);
    // Do not retry POST: a lost response can hide a successful creation. The
    // next serialized run rediscovers that Issue before considering a create.
    const saved = await request("/issues", "POST", {
      title: cleanupAlertTitle,
      body,
    });
    if (!ownsAlert(saved) || saved.body !== body || saved.state !== "open")
      throw new Error(
        "PR cleanup alert API returned an invalid created Issue.",
      );
    readAlertState(saved);
    return { action: "created", number: saved.number };
  }
  const previous = readAlertState(existing);
  if (
    current.runNumber === previous.current.runNumber &&
    current.runId !== previous.current.runId
  )
    throw new Error(
      "PR cleanup alert run identity does not match its recorded run number.",
    );
  const order = compareRuns(current, previous.current);
  if (order < 0) return { action: "stale", number: existing.number };
  if (order === 0 && current.result !== previous.current.result)
    throw new Error(
      "PR cleanup alert received conflicting results for one run attempt.",
    );
  // Already-resolved alerts stay quiet on later successful sweeps. Ordering
  // guards compare against the recorded failure/recovery transition.
  if (
    result === "success" &&
    existing.state === "closed" &&
    previous.current.result === "success"
  )
    return { action: "unchanged", number: existing.number };
  const state = {
    version: 1,
    current,
    failure:
      result === "failure"
        ? { runId, runNumber, runAttempt }
        : previous.failure,
  };
  const body = renderAlertBody(repository, state);
  const desiredState = result === "failure" ? "open" : "closed";
  if (
    body === existing.body &&
    existing.state === desiredState &&
    existing.title === cleanupAlertTitle
  )
    return { action: "unchanged", number: existing.number };
  const latest = await request(`/issues/${existing.number}`);
  if (
    !ownsAlert(latest) ||
    latest.number !== existing.number ||
    latest.body !== existing.body ||
    latest.state !== existing.state ||
    latest.title !== existing.title
  )
    return { action: "stale", number: existing.number };
  readAlertState(latest);
  const saved = await request(`/issues/${existing.number}`, "PATCH", {
    title: cleanupAlertTitle,
    body,
    ...(existing.state === desiredState
      ? {}
      : {
          state: desiredState,
          state_reason: desiredState === "closed" ? "completed" : "reopened",
        }),
  });
  if (
    !ownsAlert(saved) ||
    saved.number !== existing.number ||
    saved.body !== body ||
    saved.state !== desiredState
  )
    throw new Error("PR cleanup alert API returned an invalid updated Issue.");
  readAlertState(saved);
  return {
    action:
      result === "success"
        ? "closed"
        : existing.state === "closed"
          ? "reopened"
          : "updated",
    number: existing.number,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    if (
      !["schedule", "workflow_dispatch"].includes(process.env.GITHUB_EVENT_NAME)
    )
      throw new Error(
        "PR cleanup alerts require a trusted scheduled or manual context.",
      );
    let event;
    try {
      event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    } catch {
      throw new Error("Could not read the trusted PR cleanup alert event.");
    }
    const repository = process.env.GITHUB_REPOSITORY;
    const defaultBranch = event.repository?.default_branch;
    if (
      !isRepository(repository) ||
      typeof defaultBranch !== "string" ||
      !defaultBranch ||
      process.env.GITHUB_REF !== `refs/heads/${defaultBranch}` ||
      event.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      process.env.GITHUB_WORKFLOW_REF !==
        `${repository}/.github/workflows/pr-description-comment.yml@refs/heads/${defaultBranch}`
    )
      throw new Error(
        "PR cleanup alerts require the repository's trusted default-branch workflow.",
      );
    const numberFromEnvironment = (key) => {
      const value = process.env[key];
      if (!/^[1-9]\d*$/.test(value ?? "") || !isPositiveInteger(Number(value)))
        throw new Error(
          "PR cleanup alert run IDs, numbers, and attempts must be positive integers.",
        );
      return Number(value);
    };
    const runId = numberFromEnvironment("GITHUB_RUN_ID");
    const runNumber = numberFromEnvironment("GITHUB_RUN_NUMBER");
    const runAttempt = numberFromEnvironment("GITHUB_RUN_ATTEMPT");
    const alert = await synchronizeCleanupAlert({
      repository,
      token: process.env.GITHUB_TOKEN,
      result: process.env.PR_CLEANUP_RESULT,
      runId,
      runNumber,
      runAttempt,
      apiUrl: process.env.GITHUB_API_URL,
    });
    console.log("PR cleanup alert:", JSON.stringify(alert));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const summary = `\n## PR cleanup failure alert\n\nResult: **${alert.action}**.\n\n${alert.number ? `[Managed Issue #${alert.number}](https://github.com/${repository}/issues/${alert.number}).` : "No managed failure Issue was required."}\n\n[Workflow run](${runLink(repository, { runId, runAttempt })}).\n`;
      try {
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
      } catch {
        throw new Error("Could not write the PR cleanup alert run summary.");
      }
    }
  } catch (error) {
    console.error("PR cleanup alert failed:", error.message);
    process.exitCode = 1;
  }
}
