import path from "node:path";
import { pathToFileURL } from "node:url";

export const requiredCommands = [
  "npm run typecheck",
  "npm run build",
  "npm test",
  "npm run format:check",
  "npm run check:generated-files",
];

export const requiredConfirmations = [
  "I reviewed the PR diff and included only intended source, documentation, tests, and configuration changes.",
  "I did not commit `output/`, `cache/`, `temp/`, `node_modules/`, virtual environments, or other cache/dependency directories.",
  "I did not commit generated build or coverage files (`dist/`, `dist-types/`, `coverage/`, `*.tsbuildinfo`), logs, analysis reports, media exports, screenshots, or archives.",
];

// Examples and hidden comments must not count as filled-in template content.
function visibleLines(body) {
  let fence;
  return body
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replaceAll("\r\n", "\n")
    .split("\n")
    .filter((line) => {
      if (fence) {
        if (
          new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(
            line,
          )
        )
          fence = undefined;
        return false;
      }
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) {
        fence = { character: opening[1][0], length: opening[1].length };
        return false;
      }
      return !/^( {4}|\t)/.test(line);
    });
}

function plainText(value) {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_~]/g, "")
    .replace(/^\s*(?:[-+>]\s+|\d+[.)]\s+)*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasContent(value) {
  const text = plainText(value);
  return (
    /[\p{L}\p{N}]/u.test(text) &&
    !/^(?:todo|tbd|n\/?a|none|pending|not applicable|not yet|pass(?:\/fail)?|fail(?:\/pass)?|not run|reason|summary(?: or link)?|fill(?: in)?(?: here)?|your (?:changes|results|summary))\b[\s.!?:-]*$/i.test(
      text,
    )
  );
}

const normalizeConfirmation = (text) =>
  text.replaceAll("`", "").replace(/\s+/g, " ").trim().toLowerCase();

export function validateDescription(body) {
  if (typeof body !== "string" || !body.trim())
    return ["PR description is empty. Fill in the PR template."];

  const sections = new Map();
  let current;
  for (const line of visibleLines(body)) {
    const heading = line.match(/^ {0,3}##(?!#)\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading) {
      const name = heading[1].toLowerCase();
      current = [];
      sections.set(name, [...(sections.get(name) ?? []), current]);
    } else if (current) current.push(line);
  }

  const errors = [];
  const section = (name) => {
    const matches = sections.get(name.toLowerCase()) ?? [];
    if (matches.length !== 1) {
      errors.push(`Include exactly one "## ${name}" section.`);
      return [];
    }
    return matches[0];
  };

  if (!hasContent(section("Changes").join("\n")))
    errors.push(
      "Changes: describe what changed and why; placeholders do not count.",
    );

  const rows = section("Validation")
    .filter((line) => /^\s*\|/.test(line))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .replaceAll("\\|", "\u0000")
        .split("|")
        .map((cell) => cell.replaceAll("\u0000", "|").trim()),
    );
  for (const command of requiredCommands) {
    const matches = rows.filter(
      (cells) => plainText(cells[1] ?? "") === command,
    );
    if (matches.length !== 1 || matches[0].length !== 3) {
      errors.push(
        `Validation: include exactly one three-column row for "${command}".`,
      );
      continue;
    }
    const result = plainText(matches[0][2]);
    const status = result.match(
      /^(?:pass|fail|not run)(?:\s+[:—–-]?\s*|[:—–-]\s*)(.+)$/i,
    );
    if (!status || !hasContent(status[1]))
      errors.push(
        `Validation: "${command}" needs Pass/Fail plus a summary or link, or Not run plus a reason.`,
      );
  }

  const checklist = section("Generated-file confirmation")
    .map((line) => line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/))
    .filter(Boolean);
  requiredConfirmations.forEach((text, index) => {
    const matches = checklist.filter(
      (item) => normalizeConfirmation(item[2]) === normalizeConfirmation(text),
    );
    if (matches.length !== 1 || matches[0][1].toLowerCase() !== "x")
      errors.push(
        `Generated-file confirmation: check template item ${index + 1} exactly once; keep its wording.`,
      );
  });
  return errors;
}

// Read the live body instead of the frozen event body: rerunning an old event
// must not restore a green check after someone removes required information.
export async function checkPullRequestDescription({
  repository,
  number,
  headSha,
  token,
  apiUrl = "https://api.github.com",
  fetchImpl = fetch,
}) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "") ||
    !/^[1-9]\d*$/.test(String(number ?? "")) ||
    !/^[a-f\d]{40}$/i.test(headSha ?? "") ||
    !token ||
    !apiUrl.startsWith("https://")
  )
    throw new Error(
      "Missing or invalid PR metadata, GitHub API URL, or read-only token.",
    );

  const read = async () => {
    const response = await fetchImpl(
      `${apiUrl}/repos/${repository}/pulls/${number}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Cannot read current PR description (HTTP ${response.status}).`,
      );
    const pr = await response.json();
    if (
      pr.number !== Number(number) ||
      pr.base?.repo?.full_name?.toLowerCase() !== repository.toLowerCase() ||
      pr.head?.sha !== headSha
    )
      throw new Error(
        "PR metadata or HEAD changed. Run the check for the latest PR commit.",
      );
    return pr;
  };

  const before = await read();
  const errors = validateDescription(before.body);
  if (errors.length) return errors;
  const after = await read();
  if (before.body !== after.body)
    throw new Error(
      "PR description changed during validation. Wait for the new edited-event check.",
    );
  return errors;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const errors = await checkPullRequestDescription({
      repository: process.env.GITHUB_REPOSITORY,
      number: process.env.PR_NUMBER,
      headSha: process.env.PR_HEAD_SHA,
      token: process.env.GITHUB_TOKEN,
      apiUrl: process.env.GITHUB_API_URL,
    });
    if (errors.length) {
      console.error(
        "PR description is incomplete. Edit the PR body to rerun this check:",
      );
      for (const error of errors) console.error(`- ${error}`);
      process.exitCode = 1;
    } else
      console.log(
        "PR description passed: changes, validation, and all confirmations are complete.",
      );
  } catch (error) {
    console.error("PR description check failed:", error.message);
    process.exitCode = 1;
  }
}
