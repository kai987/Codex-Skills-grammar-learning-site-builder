import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  requiredConfirmations,
  validateDescription,
} from "./check-pr-description.mjs";
import { renderReconciliationSummary } from "./pr-description-summary.mjs";

export const commentMarker =
  "<!-- grammar-learning-site-builder:pr-description -->";
export const descriptionLabel = "needs-description";
const repoPattern = /^[\w.-]+\/[\w.-]+$/;

const isDescriptionLabel = (label) =>
  label?.name?.toLowerCase() === descriptionLabel;

function createFeedbackClient({ repository, token, apiUrl, fetchImpl }) {
  if (
    !repoPattern.test(repository ?? "") ||
    !token ||
    typeof apiUrl !== "string" ||
    !apiUrl.startsWith("https://")
  )
    throw new Error(
      "Missing or invalid PR feedback repository, API URL, or token.",
    );

  const request = async (route, method, body) => {
    const response = await fetchImpl(`${apiUrl}/repos/${repository}${route}`, {
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
    if (!response.ok) {
      const error = new Error(
        `PR feedback API request failed (HTTP ${response.status}).`,
      );
      error.status = response.status;
      throw error;
    }
    return response.status === 204 ? undefined : response.json();
  };
  const list = async (route, key, onPage) => {
    const result = [];
    for (let page = 1; ; page++) {
      const data = await request(
        `${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      const items = key ? data?.[key] : data;
      if (!Array.isArray(items))
        throw new Error("Invalid paginated GitHub API response.");
      onPage?.(items);
      result.push(...items);
      if (items.length < 100) return result;
    }
  };
  const removeDescriptionLabel = async (number) => {
    try {
      await request(
        `/issues/${number}/labels/${encodeURIComponent(descriptionLabel)}`,
        "DELETE",
      );
    } catch (error) {
      if (error.status !== 404) throw error;
      const labels = await list(`/issues/${number}/labels`);
      if (labels.some(isDescriptionLabel)) throw error;
    }
  };
  return { request, list, removeDescriptionLabel };
}

export function renderTerminalDescriptionComment(status) {
  if (status === "merged")
    return `${commentMarker}\n### PR description: merged ✅\n\nThis PR has been merged. Description feedback is archived; no description changes are required. Other labels are preserved.`;
  if (status === "closed")
    return `${commentMarker}\n### PR description: closed ⚪\n\nThis PR was closed without merging. Description feedback is archived; no description changes are required. Other labels are preserved.`;
  throw new Error("Expected a closed or merged PR feedback status.");
}

function isFeedbackComment(comment) {
  return (
    Number.isSafeInteger(comment.id) &&
    comment.id > 0 &&
    comment.user?.login === "github-actions[bot]" &&
    comment.user?.type === "Bot" &&
    typeof comment.body === "string" &&
    comment.body.startsWith(`${commentMarker}\n`)
  );
}

function terminalStatus(pr) {
  if (typeof pr.merged !== "boolean")
    throw new Error("Cannot determine whether the closed PR was merged.");
  return pr.merged ? "merged" : "closed";
}

async function updateTerminalDescriptionComment(
  client,
  pr,
  isBoundTerminalPR,
  result = { number: pr.number, action: "unchanged" },
) {
  const { request, list, removeDescriptionLabel } = client;
  const status = terminalStatus(pr);
  const body = renderTerminalDescriptionComment(status);
  const comments = await list(`/issues/${pr.number}/comments`);
  const existing = comments.find(isFeedbackComment);
  const labels = await list(`/issues/${pr.number}/labels`);
  const labelChange = labels.some(isDescriptionLabel);
  // Never create a terminal comment when there was no original feedback.
  const commentChange = existing && existing.body !== body;
  const stillTerminal = async () => {
    const latest = await request(`/pulls/${pr.number}`);
    return (
      latest.number === pr.number &&
      isBoundTerminalPR(latest) &&
      terminalStatus(latest) === status
    );
  };
  if (labelChange) {
    if (!(await stillTerminal())) return { ...result, action: "stale" };
    await removeDescriptionLabel(pr.number);
    result.label = "removed";
  }
  if (commentChange) {
    if (!(await stillTerminal())) return { ...result, action: "stale" };
    await request(`/issues/comments/${existing.id}`, "PATCH", { body });
    result.action = "updated";
    result.id = existing.id;
  }
  return result;
}

function reconciliationFailureReason(error) {
  // Do not put arbitrary exception messages (which can contain URLs, tokens,
  // or untrusted response text) in summaries or the structured report.
  if (
    Number.isInteger(error?.status) &&
    error.status >= 100 &&
    error.status <= 599
  )
    return `GitHub API request failed (HTTP ${error.status}).`;
  if (error?.name === "TimeoutError") return "GitHub API request timed out.";
  if (error?.message === "Cannot determine whether the closed PR was merged.")
    return "Live PR merged status is missing or invalid.";
  if (error?.message === "Invalid paginated GitHub API response.")
    return "GitHub API returned an invalid paginated response.";
  return "Cleanup request failed; inspect the step logs and rerun the sweep.";
}

export async function reconcileClosedDescriptionComments({
  repository,
  token,
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
  report = {},
}) {
  report.entries = [];
  report.discoveryComplete = false;
  report.scanError = null;
  let client;
  try {
    client = createFeedbackClient({ repository, token, apiUrl, fetchImpl });
  } catch (error) {
    report.scanError =
      "PR feedback repository, API URL, or token configuration is invalid.";
    throw error;
  }
  const isRepositoryPR = (pr) =>
    Number.isSafeInteger(pr?.number) &&
    pr.number > 0 &&
    pr.base?.repo?.full_name?.toLowerCase() === repository.toLowerCase();
  const isClosedPR = (pr) => isRepositoryPR(pr) && pr.state === "closed";
  // No label filter or age cutoff: a lost PATCH can leave only an old comment
  // to repair. The default-branch schedule needs no PR event or source run.
  const candidates = new Map();
  try {
    await client.list(
      "/pulls?state=closed&sort=updated&direction=desc",
      undefined,
      (page) => {
        for (const candidate of page.filter(isRepositoryPR)) {
          if (candidates.has(candidate.number)) continue;
          const entry = {
            number: candidate.number,
            status: "skipped",
            reason: "Not processed because PR discovery did not complete.",
            labelRemoved: false,
            commentUpdated: false,
          };
          report.entries.push(entry);
          candidates.set(candidate.number, { candidate, entry });
        }
      },
    );
    report.discoveryComplete = true;
  } catch (error) {
    report.scanError = reconciliationFailureReason(error);
    throw new Error(`PR discovery failed: ${report.scanError}`, {
      cause: error,
    });
  }
  const results = [];
  const errors = [];
  for (const { candidate, entry } of candidates.values()) {
    if (!isClosedPR(candidate)) {
      entry.reason = "PR is no longer closed in the scan results.";
      continue;
    }
    const progress = { number: candidate.number, action: "unchanged" };
    const recordChanges = (result) => {
      entry.labelRemoved = result.label === "removed";
      entry.commentUpdated = result.action === "updated";
      if (result.id) entry.commentId = result.id;
    };
    try {
      const pr = await client.request(`/pulls/${candidate.number}`);
      if (
        pr?.number !== candidate.number ||
        !isClosedPR(pr) ||
        !/^[a-f\d]{40}$/i.test(pr.head?.sha ?? "") ||
        typeof pr.head?.ref !== "string" ||
        !pr.head.ref ||
        typeof pr.base?.ref !== "string" ||
        !pr.base.ref ||
        (pr.head?.repo != null &&
          !repoPattern.test(pr.head.repo.full_name ?? ""))
      ) {
        entry.reason =
          pr?.state === "open"
            ? "PR was reopened before inspection."
            : "Live PR identity or metadata no longer matches the scan.";
        continue;
      }
      entry.terminalStatus = terminalStatus(pr);
      // Pin the live identity, including the closure epoch. Reopening and
      // closing again must not let a stale sweep overwrite newer feedback.
      const stillSamePR = (latest) =>
        isClosedPR(latest) &&
        latest.head?.sha === pr.head.sha &&
        latest.head?.ref === pr.head.ref &&
        latest.head?.repo?.full_name?.toLowerCase() ===
          pr.head?.repo?.full_name?.toLowerCase() &&
        latest.base?.ref === pr.base.ref &&
        latest.merge_commit_sha === pr.merge_commit_sha &&
        latest.closed_at === pr.closed_at;
      const result = await updateTerminalDescriptionComment(
        client,
        pr,
        stillSamePR,
        progress,
      );
      recordChanges(result);
      if (result.action === "stale") {
        entry.reason =
          "PR reopened or its identity or terminal state changed before a write.";
      } else if (entry.labelRemoved || entry.commentUpdated) {
        entry.status = "repaired";
        entry.reason = "Terminal feedback cleanup completed.";
      } else {
        entry.reason =
          "No cleanup needed; labels and existing feedback are already up to date.";
      }
      results.push(result);
    } catch (error) {
      // One inaccessible PR must not starve every other missed closure. Mark
      // the run failed after attempting the rest; the next sweep can retry.
      recordChanges(progress);
      entry.status = "failed";
      entry.reason = reconciliationFailureReason(error);
      errors.push(
        new Error(`PR #${candidate.number}: ${entry.reason}`, {
          cause: error,
        }),
      );
    }
  }
  if (errors.length)
    throw new AggregateError(
      errors,
      `Closed PR feedback reconciliation failed for ${errors.length} PR(s): ${errors.map((error) => error.message).join("; ")}`,
    );
  return results;
}

export function renderDescriptionComment(errors, repository, number) {
  const checks = `https://github.com/${repository}/pull/${number}/checks`;
  if (!errors.length)
    return `${commentMarker}\n### PR description: complete ✅\n\nThe changes, validation results, and all three generated-file confirmations are complete. This updates the original feedback comment; no new comment was created.\n\nAll [required CI checks](${checks}) must still pass before merging.`;

  const missing = errors.map((error) => {
    const item = error.match(/template item ([1-3]) /);
    const wording = item
      ? `\n  > ${requiredConfirmations[Number(item[1]) - 1]}`
      : "";
    return `- ${error}${wording}`;
  });
  return `${commentMarker}\n### PR description: incomplete ❌\n\nEdit the **PR description**, not this comment, to fix the following items:\n\n${missing.join("\n")}\n\nKeep the template headings, command rows, and confirmation wording unchanged. Each Result needs \`Pass — summary or link\`, \`Fail — summary or link\`, or \`Not run — reason\`. Editing the description reruns [the check](${checks}) and updates this same comment after it finishes.`;
}

export async function updateDescriptionComments({
  repository,
  token,
  run,
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  const isLifecycle = run?.name === "PR description lifecycle";
  const validHeadRepo = repoPattern.test(run?.head_repository?.full_name ?? "");
  const validHeadBranch =
    typeof run?.head_branch === "string" && run.head_branch.length > 0;
  const sourcePaths = new Map([
    ["PR description", ".github/workflows/pr-description.yml"],
    [
      "PR description label recheck",
      ".github/workflows/pr-description-label-recheck.yml",
    ],
    [
      "PR description lifecycle",
      ".github/workflows/pr-description-lifecycle.yml",
    ],
  ]);
  if (
    !repoPattern.test(repository ?? "") ||
    !token ||
    !apiUrl.startsWith("https://") ||
    !sourcePaths.has(run?.name) ||
    run?.event !== "pull_request" ||
    run?.status !== "completed" ||
    run?.path !== sourcePaths.get(run?.name) ||
    run?.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
    (isLifecycle
      ? (run?.head_repository != null && !validHeadRepo) ||
        (run?.head_branch != null && !validHeadBranch)
      : !validHeadRepo || !validHeadBranch) ||
    !/^[a-f\d]{40}$/i.test(run?.head_sha ?? "")
  )
    throw new Error(
      "Missing or invalid description workflow-run metadata or token.",
    );

  const isLabelRecheck = run.name === "PR description label recheck";
  if (isLabelRecheck) {
    const isHuman = (actor) =>
      actor?.type === "User" &&
      typeof actor.login === "string" &&
      actor.login.length > 0 &&
      !/\[bot\]$/i.test(actor.login);
    // Check both identities: rerunning a human's event as a bot must not turn
    // that event into another write-capable feedback cycle.
    if (!isHuman(run.actor) || !isHuman(run.triggering_actor)) return [];
  }
  if (isLabelRecheck || isLifecycle) {
    if (
      !Number.isSafeInteger(run.id) ||
      run.id < 1 ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1
    )
      throw new Error(
        `Missing or invalid ${isLifecycle ? "lifecycle" : "label-recheck"} run ID or attempt.`,
      );
  }

  const client = createFeedbackClient({ repository, token, apiUrl, fetchImpl });
  const { request, list, removeDescriptionLabel } = client;

  if (isLabelRecheck || isLifecycle) {
    // An explicitly skipped/cancelled source cannot authorize any writes. Its
    // jobs may not be indexed yet when workflow_run arrives; do not fetch them
    // and mistake an empty, eventually consistent list for a broken workflow.
    if (
      [
        "skipped",
        "cancelled",
        "neutral",
        "timed_out",
        "action_required",
        "startup_failure",
        "stale",
      ].includes(run.conclusion)
    )
      return [];
    // A skipped optional job still gives its workflow a successful conclusion.
    // Inspect this exact attempt, not just the workflow conclusion, so other
    // labels/bot events never reach PR mutations or overwrite feedback.
    const jobs = await list(
      `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
      "jobs",
    );
    const kind = isLifecycle ? "lifecycle" : "label-recheck";
    const matches = jobs.filter(
      (job) => job?.name === `pr-description-${kind}`,
    );
    if (matches.length !== 1)
      throw new Error(
        `Expected exactly one ${kind} job in the source attempt.`,
      );
    const job = matches[0];
    if (
      job.run_id !== run.id ||
      job.run_attempt !== run.run_attempt ||
      job.head_sha !== run.head_sha
    )
      throw new Error(
        `${isLifecycle ? "Lifecycle" : "Label-recheck"} job does not match its source run, attempt, and HEAD.`,
      );
    if (
      job.status !== "completed" ||
      !["success", "failure"].includes(job.conclusion)
    )
      return [];
  }

  const ensureRepositoryLabel = async () => {
    const route = `/labels/${encodeURIComponent(descriptionLabel)}`;
    const check = (label) => {
      if (!isDescriptionLabel(label))
        throw new Error("Invalid needs-description repository label response.");
      if (label.archived_at)
        throw new Error(
          "The needs-description label is archived; it cannot be added to PRs.",
        );
    };
    try {
      check(await request(route));
    } catch (error) {
      if (error.status !== 404) throw error;
      try {
        check(
          await request("/labels", "POST", {
            name: descriptionLabel,
            color: "fbca04",
            description:
              "PR description needs required changes, validation results, or confirmations.",
          }),
        );
      } catch (creationError) {
        // Another PR's writer can create the same repository label in parallel.
        // Confirm it exists; never overwrite its metadata or blindly retry POST.
        if (creationError.status !== 422) throw creationError;
        check(await request(route));
      }
    }
  };

  if (isLifecycle) {
    const sourceRepo = run.head_repository?.full_name?.toLowerCase();
    const isBoundTerminalPR = (pr) => {
      if (
        !Number.isSafeInteger(pr?.number) ||
        pr.number < 1 ||
        pr.state !== "closed" ||
        pr.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase() ||
        (pr.head?.sha !== run.head_sha && pr.merge_commit_sha !== run.head_sha)
      )
        return false;
      if (
        run.head_branch &&
        run.head_branch !== pr.head?.ref &&
        run.head_branch !== pr.base?.ref
      )
        return false;
      const headRepo = pr.head?.repo?.full_name?.toLowerCase();
      return (
        !sourceRepo ||
        !headRepo ||
        sourceRepo === headRepo ||
        sourceRepo === repository.toLowerCase()
      );
    };
    // Closed, unmerged PRs can have empty run/check-suite/commit associations.
    // Bind live closed PRs by exact source head OR merge SHA instead of trusting
    // PR numbers or text from a PR-controlled workflow. Deleted forks are valid.
    const candidates = await list("/pulls?state=closed");
    const results = [];
    for (const candidate of candidates.filter(isBoundTerminalPR)) {
      const pr = await request(`/pulls/${candidate.number}`);
      if (pr.number !== candidate.number || !isBoundTerminalPR(pr)) continue;
      results.push(
        await updateTerminalDescriptionComment(client, pr, isBoundTerminalPR),
      );
    }
    return results;
  }

  const headRepo = run.head_repository.full_name.toLowerCase();
  const isCurrentPR = (pr) =>
    Number.isSafeInteger(pr?.number) &&
    pr.number > 0 &&
    pr.state === "open" &&
    pr.base?.repo?.full_name?.toLowerCase() === repository.toLowerCase() &&
    pr.head?.repo?.full_name?.toLowerCase() === headRepo &&
    pr.head?.ref === run.head_branch &&
    pr.head?.sha === run.head_sha;

  // The run's pull_requests array can be empty, including for fork PRs. Match
  // live open PRs by repository, branch AND SHA instead of trusting that array.
  const owner = run.head_repository.full_name.split("/")[0];
  const candidates = await list(
    `/pulls?state=open&head=${encodeURIComponent(`${owner}:${run.head_branch}`)}`,
  );
  const results = [];
  for (const candidate of candidates.filter(isCurrentPR)) {
    const pr = await request(`/pulls/${candidate.number}`);
    if (!isCurrentPR(pr)) continue;
    const errors = validateDescription(pr.body);
    const body = renderDescriptionComment(errors, repository, pr.number);
    const comments = await list(`/issues/${pr.number}/comments`);
    const existing = comments.find(isFeedbackComment);

    const labels = await list(`/issues/${pr.number}/labels`);
    const hasDescriptionLabel = labels.some(isDescriptionLabel);
    const labelChange = errors.length
      ? !hasDescriptionLabel
      : hasDescriptionLabel;
    const commentChange = existing ? existing.body !== body : errors.length > 0;
    const result = { number: pr.number, action: "unchanged" };

    // Comment deduplication must not prevent label repair (or removal on an
    // initially complete PR that has never needed a feedback comment).
    if (!commentChange && !labelChange) {
      results.push(result);
      continue;
    }
    const stillCurrent = async () => {
      const latest = await request(`/pulls/${pr.number}`);
      return (
        isCurrentPR(latest) &&
        latest.number === pr.number &&
        latest.body === pr.body
      );
    };

    if (!(await stillCurrent())) {
      results.push({ ...result, action: "stale" });
      continue;
    }
    if (labelChange) {
      if (errors.length) await ensureRepositoryLabel();
      // Repository-label preparation may take time. Recheck immediately before
      // each PR mutation, not just before creating the repository definition.
      if (!(await stillCurrent())) {
        results.push({ ...result, action: "stale" });
        continue;
      }
      if (errors.length) {
        await request(`/issues/${pr.number}/labels`, "POST", {
          labels: [descriptionLabel],
        });
        result.label = "added";
      } else {
        await removeDescriptionLabel(pr.number);
        result.label = "removed";
      }
    }

    if (commentChange) {
      if (!(await stillCurrent())) {
        results.push({ ...result, action: "stale" });
        continue;
      }
      // Never automatically retry comment POST: a timeout/5xx can hide a
      // successful creation. A rerun starts with a fresh comment lookup.
      const saved = existing
        ? await request(`/issues/comments/${existing.id}`, "PATCH", { body })
        : await request(`/issues/${pr.number}/comments`, "POST", { body });
      result.action = existing ? "updated" : "created";
      result.id = saved.id;
    }
    results.push(result);
  }
  return results;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const eventName = process.env.GITHUB_EVENT_NAME;
    if (!["workflow_run", "schedule", "workflow_dispatch"].includes(eventName))
      throw new Error(
        "PR feedback must run from a trusted workflow_run context or default-branch schedule/manual context.",
      );
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    const options = {
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      apiUrl: process.env.GITHUB_API_URL,
    };
    let result;
    if (eventName === "workflow_run") {
      result = await updateDescriptionComments({
        ...options,
        run: event.workflow_run,
      });
    } else {
      const defaultBranch = event.repository?.default_branch;
      if (
        typeof defaultBranch !== "string" ||
        !defaultBranch ||
        process.env.GITHUB_REF !== `refs/heads/${defaultBranch}` ||
        event.repository?.full_name?.toLowerCase() !==
          options.repository?.toLowerCase()
      )
        throw new Error(
          "PR reconciliation must run on the repository's trusted default branch.",
        );
      const report = {};
      let reconciliationError;
      try {
        result = await reconcileClosedDescriptionComments({
          ...options,
          report,
        });
      } catch (error) {
        reconciliationError = error;
        throw error;
      } finally {
        console.log("PR cleanup report:", JSON.stringify(report));
        if (process.env.GITHUB_STEP_SUMMARY) {
          try {
            appendFileSync(
              process.env.GITHUB_STEP_SUMMARY,
              `\n${renderReconciliationSummary({ repository: options.repository, report })}\n`,
              "utf8",
            );
          } catch {
            // A reporting failure must not hide the original cleanup failure.
            const message = "Could not write the PR cleanup run summary.";
            if (reconciliationError) console.error(message);
            else throw new Error(message);
          }
        }
      }
    }
    console.log("PR description feedback:", JSON.stringify(result));
  } catch (error) {
    console.error("PR description feedback failed:", error.message);
    process.exitCode = 1;
  }
}
