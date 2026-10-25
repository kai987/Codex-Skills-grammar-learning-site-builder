import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  requiredConfirmations,
  validateDescription,
} from "./check-pr-description.mjs";

export const commentMarker =
  "<!-- grammar-learning-site-builder:pr-description -->";
export const descriptionLabel = "needs-description";

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
  const repoPattern = /^[\w.-]+\/[\w.-]+$/;
  const sourcePaths = new Map([
    ["PR description", ".github/workflows/pr-description.yml"],
    [
      "PR description label recheck",
      ".github/workflows/pr-description-label-recheck.yml",
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
    !repoPattern.test(run?.head_repository?.full_name ?? "") ||
    typeof run?.head_branch !== "string" ||
    !run.head_branch ||
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
    if (
      !Number.isSafeInteger(run.id) ||
      run.id < 1 ||
      !Number.isSafeInteger(run.run_attempt) ||
      run.run_attempt < 1
    )
      throw new Error("Missing or invalid label-recheck run ID or attempt.");
  }

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
  const list = async (route, key) => {
    const result = [];
    for (let page = 1; ; page++) {
      const data = await request(
        `${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      const items = key ? data?.[key] : data;
      if (!Array.isArray(items))
        throw new Error("Invalid paginated GitHub API response.");
      result.push(...items);
      if (items.length < 100) return result;
    }
  };

  if (isLabelRecheck) {
    // A skipped optional job still gives its workflow a successful conclusion.
    // Inspect this exact attempt, not just the workflow conclusion, so other
    // labels/bot events never reach PR mutations or overwrite feedback.
    const jobs = await list(
      `/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
      "jobs",
    );
    const matches = jobs.filter(
      (job) => job?.name === "pr-description-label-recheck",
    );
    if (matches.length !== 1)
      throw new Error(
        "Expected exactly one label-recheck job in the source attempt.",
      );
    const job = matches[0];
    if (
      job.run_id !== run.id ||
      job.run_attempt !== run.run_attempt ||
      job.head_sha !== run.head_sha
    )
      throw new Error(
        "Label-recheck job does not match its source run, attempt, and HEAD.",
      );
    if (
      job.status !== "completed" ||
      !["success", "failure"].includes(job.conclusion)
    )
      return [];
  }

  const isDescriptionLabel = (label) =>
    label?.name?.toLowerCase() === descriptionLabel;
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
    const existing = comments.find(
      (comment) =>
        Number.isSafeInteger(comment.id) &&
        comment.id > 0 &&
        comment.user?.login === "github-actions[bot]" &&
        comment.user?.type === "Bot" &&
        typeof comment.body === "string" &&
        comment.body.startsWith(`${commentMarker}\n`),
    );

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
        try {
          await request(
            `/issues/${pr.number}/labels/${encodeURIComponent(descriptionLabel)}`,
            "DELETE",
          );
        } catch (error) {
          // A concurrent manual removal is already the desired state. A 404
          // alone is not proof: also verify the PR's current labels are clear.
          if (error.status !== 404) throw error;
          const currentLabels = await list(`/issues/${pr.number}/labels`);
          if (currentLabels.some(isDescriptionLabel)) throw error;
        }
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
    if (process.env.GITHUB_EVENT_NAME !== "workflow_run")
      throw new Error(
        "PR feedback must run from the trusted workflow_run context.",
      );
    const event = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
    );
    const result = await updateDescriptionComments({
      repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GITHUB_TOKEN,
      run: event.workflow_run,
      apiUrl: process.env.GITHUB_API_URL,
    });
    console.log("PR description feedback:", JSON.stringify(result));
  } catch (error) {
    console.error("PR description feedback failed:", error.message);
    process.exitCode = 1;
  }
}
