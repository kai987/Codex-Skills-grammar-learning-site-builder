import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  requiredConfirmations,
  validateDescription,
} from "./check-pr-description.mjs";

export const commentMarker =
  "<!-- grammar-learning-site-builder:pr-description -->";

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
  if (
    !repoPattern.test(repository ?? "") ||
    !token ||
    !apiUrl.startsWith("https://") ||
    run?.name !== "PR description" ||
    run?.event !== "pull_request" ||
    run?.status !== "completed" ||
    run?.path !== ".github/workflows/pr-description.yml" ||
    run?.repository?.full_name?.toLowerCase() !== repository.toLowerCase() ||
    !repoPattern.test(run?.head_repository?.full_name ?? "") ||
    typeof run?.head_branch !== "string" ||
    !run.head_branch ||
    !/^[a-f\d]{40}$/i.test(run?.head_sha ?? "")
  )
    throw new Error(
      "Missing or invalid description workflow-run metadata or token.",
    );

  const request = async (route, method, body) => {
    const response = await fetchImpl(`${apiUrl}/repos/${repository}${route}`, {
      ...(method ? { method, body: JSON.stringify(body) } : {}),
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(method ? { "Content-Type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `PR feedback API request failed (HTTP ${response.status}).`,
      );
    return response.json();
  };
  const list = async (route) => {
    const result = [];
    for (let page = 1; ; page++) {
      const items = await request(
        `${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      if (!Array.isArray(items))
        throw new Error("Invalid paginated GitHub API response.");
      result.push(...items);
      if (items.length < 100) return result;
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

    // Do not post a success comment on a PR that has never needed feedback.
    if ((!existing && !errors.length) || existing?.body === body) {
      results.push({ number: pr.number, action: "unchanged" });
      continue;
    }
    const latest = await request(`/pulls/${pr.number}`);
    if (!isCurrentPR(latest) || latest.body !== pr.body) {
      results.push({ number: pr.number, action: "stale" });
      continue;
    }

    // Never automatically retry POST: a timeout/5xx can hide a successful
    // creation. A rerun starts with a fresh, paginated comment lookup instead.
    const saved = existing
      ? await request(`/issues/comments/${existing.id}`, "PATCH", { body })
      : await request(`/issues/${pr.number}/comments`, "POST", { body });
    results.push({
      number: pr.number,
      action: existing ? "updated" : "created",
      id: saved.id,
    });
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
