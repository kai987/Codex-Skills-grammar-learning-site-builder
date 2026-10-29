const maximumSummaryBytes = 900_000;
const statuses = new Map([
  ["repaired", "Repaired"],
  ["skipped", "Skipped"],
  ["failed", "Failed"],
]);

function textCell(value, limit = 1000) {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const bounded =
    text.length > limit
      ? `${text.slice(0, limit)}… (details truncated; see step logs)`
      : text;
  // Encode Markdown punctuation as well as HTML so API text cannot add table
  // rows, links, markup, mentions, or workflow commands to the summary.
  return bounded.replace(/[&<>|\\`*_\[\]()#!~:@]/g, (character) =>
    character === "&" ? "&amp;" : `&#${character.charCodeAt(0)};`,
  );
}

export function renderReconciliationSummary({
  repository,
  report,
  maxBytes = maximumSummaryBytes,
}) {
  if (
    typeof repository !== "string" ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    repository.split("/").some((part) => [".", ".."].includes(part)) ||
    repository.length > 250
  )
    throw new Error("Invalid repository for the PR cleanup summary.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 4096)
    throw new Error("PR cleanup summary byte limit must be at least 4096.");
  const byteLimit = Math.min(maxBytes, maximumSummaryBytes);
  if (
    !Array.isArray(report?.entries) ||
    typeof report.discoveryComplete !== "boolean" ||
    (report.scanError != null && typeof report.scanError !== "string")
  )
    throw new Error("Invalid PR cleanup report.");

  const counts = { repaired: 0, skipped: 0, failed: 0 };
  const seen = new Set();
  for (const entry of report.entries) {
    if (
      !Number.isSafeInteger(entry?.number) ||
      entry.number < 1 ||
      seen.has(entry.number) ||
      !statuses.has(entry.status)
    )
      throw new Error("Invalid or duplicate PR cleanup report entry.");
    seen.add(entry.number);
    counts[entry.status]++;
  }

  let output = `## PR description cleanup\n\nScan: **${report.discoveryComplete ? "complete" : "incomplete"}**.\n\n`;
  if (report.scanError)
    output += `Scan failure: ${textCell(report.scanError, 240)}\n\n`;
  output += `| Scanned | Repaired | Skipped | Failed |\n| --- | --- | --- | --- |\n| ${report.entries.length} | ${counts.repaired} | ${counts.skipped} | ${counts.failed} |\n\n`;
  output +=
    "Scanned counts unique PR candidates discovered in this repository. Each PR has one final result; failed or skipped rows may include earlier confirmed changes.\n\n";
  if (!report.discoveryComplete)
    output +=
      "PR discovery did not finish; these counts do not represent a complete scan of the repository.\n\n";
  if (!report.entries.length) return `${output}No PRs were discovered.\n`;

  output += "| PR | State | Result | Details |\n| --- | --- | --- | --- |\n";
  const repositoryUrl = `https://github.com/${repository.split("/").map(encodeURIComponent).join("/")}`;
  const omittedNotice = (omitted) =>
    `\n${omitted} PR row(s) omitted to keep the summary below the GitHub size limit. Counts above include every discovered PR; see the complete report in the step logs.\n`;
  const reserveBytes = Buffer.byteLength(omittedNotice(report.entries.length));
  let usedBytes = Buffer.byteLength(output);
  let displayed = 0;
  for (const entry of report.entries) {
    const prUrl = `${repositoryUrl}/pull/${entry.number}`;
    const details = [];
    if (entry.labelRemoved) details.push("Removed needs-description");
    if (entry.commentUpdated) {
      const comment =
        Number.isSafeInteger(entry.commentId) && entry.commentId > 0
          ? `[original comment](${prUrl}#issuecomment-${entry.commentId})`
          : "original comment";
      details.push(`Updated ${comment}`);
    }
    if (entry.reason) details.push(textCell(entry.reason));
    const state = ["closed", "merged"].includes(entry.terminalStatus)
      ? entry.terminalStatus
      : "unknown";
    const row = `| [#${entry.number}](${prUrl}) | ${state} | ${statuses.get(entry.status)} | ${details.join("; ") || "No confirmed changes"} |\n`;
    const rowBytes = Buffer.byteLength(row);
    if (usedBytes + rowBytes + reserveBytes > byteLimit) break;
    output += row;
    usedBytes += rowBytes;
    displayed++;
  }
  if (displayed < report.entries.length)
    output += omittedNotice(report.entries.length - displayed);
  return output;
}
