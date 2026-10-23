import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  checkPullRequestDescription,
  requiredCommands,
  requiredConfirmations,
  validateDescription,
} from "../../scripts/check-pr-description.mjs";

const template = readFileSync(".github/PULL_REQUEST_TEMPLATE.md", "utf8");
const completed = template
  .replace(
    /\n-\n/,
    "\n- Add a PR description merge gate and document its requirements.\n",
  )
  .replace(/\|\s*\|\s*$/gm, "| Pass — verified locally |")
  .replaceAll("- [ ]", "- [x]");

describe("PR description policy", () => {
  it("accepts the completed real template, keeping parser and template in sync", () => {
    expect(validateDescription(completed)).toEqual([]);
    for (const command of requiredCommands) expect(template).toContain(command);
    for (const text of requiredConfirmations) expect(template).toContain(text);
  });

  it("rejects the unfilled real template with actionable errors", () => {
    const errors = validateDescription(template);
    expect(errors).toHaveLength(9);
    expect(errors.join("\n")).toContain("Changes");
    expect(errors.join("\n")).toContain("npm run typecheck");
    expect(errors.join("\n")).toContain("item 3");
  });

  it.each([undefined, null, "", " \n "])("rejects empty body %s", (body) => {
    expect(validateDescription(body)).not.toEqual([]);
  });

  it.each(["-", "TODO", "TBD", "N/A", "<!-- hidden description -->", "<br>"])(
    "rejects placeholder changes: %s",
    (changes) => {
      const body = completed.replace(
        "- Add a PR description merge gate and document its requirements.",
        changes,
      );
      expect(validateDescription(body).join("\n")).toContain("Changes:");
    },
  );

  it.each([
    "",
    "Pass",
    "Fail",
    "Not run",
    "Pass/Fail",
    "Pass — summary or link",
    "Not run — reason",
    "Pass — TODO",
    "Pass <!-- summary -->",
  ])("rejects incomplete validation result: %s", (result) => {
    const body = completed.replace("Pass — verified locally", result);
    expect(validateDescription(body).join("\n")).toContain("npm run typecheck");
  });

  it.each([
    "Pass — 12 assertions passed",
    "Fail: the expected negative fixture was rejected",
    "Not run — documentation-only change; hosted CI will verify it",
    "Pass — [successful run](https://example.invalid/run)",
    "Pass — 本地检查全部通过",
    "Pass — ローカル実行で成功",
    "Pass — unit \\| integration checks passed",
  ])("accepts documented result: %s", (result) => {
    expect(
      validateDescription(completed.replace("Pass — verified locally", result)),
    ).toEqual([]);
  });

  it.each(["```markdown", "~~~~markdown", "    "])(
    "does not accept a completed template hidden in code: %s",
    (fence) => {
      const example = fence.trim()
        ? `${fence}\n${completed}\n${fence.startsWith("`") ? "```" : "~~~~"}`
        : completed.replace(/^/gm, fence);
      expect(validateDescription(`${template}\n${example}`)).not.toEqual([]);
    },
  );

  it("does not accept a template hidden in comments or an unclosed comment", () => {
    expect(
      validateDescription(`${template}\n<!--\n${completed}\n-->`),
    ).not.toEqual([]);
    expect(validateDescription(`<!--\n${completed}`)).not.toEqual([]);
  });

  it.each(["Changes", "Validation", "Generated-file confirmation"])(
    "rejects missing or duplicate %s sections",
    (heading) => {
      expect(
        validateDescription(completed.replace(`## ${heading}`, "## Other")),
      ).not.toEqual([]);
      expect(
        validateDescription(`${completed}\n## ${heading}\nExtra content`),
      ).not.toEqual([]);
    },
  );

  it("rejects a missing or duplicate validation command", () => {
    const line = completed
      .split("\n")
      .find((row) => row.includes("`npm test`"))!;
    expect(validateDescription(completed.replace(line, ""))).not.toEqual([]);
    expect(
      validateDescription(completed.replace(line, `${line}\n${line}`)),
    ).not.toEqual([]);
  });

  it.each([0, 1, 2])("requires canonical checked confirmation %i", (index) => {
    const item = `- [x] ${requiredConfirmations[index]}`;
    for (const replacement of [
      item.replace("[x]", "[ ]"),
      item.replace("I ", "I might "),
      "- [x] Some unrelated checkbox",
      `${item}\n${item.replace("[x]", "[ ]")}`,
    ]) {
      expect(
        validateDescription(completed.replace(item, replacement)),
      ).not.toEqual([]);
    }
  });

  it("accepts uppercase checks and CRLF line endings", () => {
    expect(
      validateDescription(
        completed.replaceAll("[x]", "[X]").replaceAll("\n", "\r\n"),
      ),
    ).toEqual([]);
  });
});

describe("live GitHub PR validation", () => {
  const headSha = "a".repeat(40);
  const metadata = {
    repository: "owner/repo",
    number: "6",
    headSha,
    token: "test-token",
  };
  const pr = (body = completed, sha = headSha) => ({
    number: 6,
    body,
    head: { sha },
    base: { repo: { full_name: "owner/repo" } },
  });
  const response = (value = pr()) => ({
    ok: true,
    json: async () => value,
  });

  it("reads the live body twice and uses read-only authenticated GET requests", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response());
    expect(
      await checkPullRequestDescription({ ...metadata, fetchImpl }),
    ).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.github.com/repos/owner/repo/pulls/6",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty("method");
  });

  it("rejects the current empty body even when an older event was complete", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(pr("")));
    expect(
      await checkPullRequestDescription({ ...metadata, fetchImpl }),
    ).not.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    { repository: "" },
    { number: "0" },
    { number: "6/commits" },
    { headSha: "" },
    { token: "" },
    { apiUrl: "http://example.invalid" },
  ])("fails closed on invalid input %j", async (override) => {
    const fetchImpl = vi.fn();
    await expect(
      checkPullRequestDescription({ ...metadata, ...override, fetchImpl }),
    ).rejects.toThrow("Missing or invalid");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on API error, malformed response, or network failure", async () => {
    for (const fetchImpl of [
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
      vi.fn().mockResolvedValue(response({})),
      vi.fn().mockRejectedValue(new Error("network unavailable")),
    ]) {
      await expect(
        checkPullRequestDescription({ ...metadata, fetchImpl }),
      ).rejects.toThrow();
    }
  });

  it("rejects old HEADs and changes made while validating", async () => {
    for (const after of [pr(completed, "b".repeat(40)), pr(template)]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(response())
        .mockResolvedValueOnce(response(after));
      await expect(
        checkPullRequestDescription({ ...metadata, fetchImpl }),
      ).rejects.toThrow();
    }
  });

  it("returns a nonzero CLI exit code when PR metadata is missing", () => {
    const result = spawnSync(
      process.execPath,
      [path.resolve("scripts/check-pr-description.mjs")],
      {
        env: {
          ...process.env,
          GITHUB_TOKEN: "",
          PR_NUMBER: "",
          PR_HEAD_SHA: "",
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Missing or invalid PR metadata");
    expect(result.stderr).not.toContain("test-token");
  });
});
