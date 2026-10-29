import { describe, expect, it } from "vitest";

import { renderReconciliationSummary } from "../../scripts/pr-description-summary.mjs";

const repository = "owner/repo";
const entry = (number = 7) => ({
  number,
  status: "repaired",
  terminalStatus: "closed",
  reason: "Cleanup completed.",
  labelRemoved: true,
  commentUpdated: true,
  commentId: 900,
});
const report = (entries = [entry()]) => ({
  entries,
  discoveryComplete: true,
  scanError: null as string | null,
});
const render = (value = report(), maxBytes?: number) =>
  renderReconciliationSummary({ repository, report: value, maxBytes });

describe("PR cleanup run summaries", () => {
  it("shows complete totals, PR links, confirmed repairs, and the original comment link", () => {
    const output = render();
    expect(output).toContain("## PR description cleanup");
    expect(output).toContain("Scan: **complete**.");
    expect(output).toContain("| Scanned | Repaired | Skipped | Failed |");
    expect(output).toContain("| 1 | 1 | 0 | 0 |");
    expect(output).toContain(
      "| [#7](https://github.com/owner/repo/pull/7) | closed | Repaired |",
    );
    expect(output).toContain("Removed needs-description");
    expect(output).toContain(
      "[original comment](https://github.com/owner/repo/pull/7#issuecomment-900)",
    );
    expect(output).toContain("Cleanup completed.");
  });

  it("partitions scanned PRs into repaired, skipped, and failed outcomes", () => {
    const output = render(
      report([
        { ...entry(), terminalStatus: "merged" },
        {
          ...entry(8),
          status: "skipped",
          reason: "No cleanup needed.",
          labelRemoved: false,
          commentUpdated: false,
        },
        {
          ...entry(9),
          status: "failed",
          reason: "API request failed (HTTP 403).",
          labelRemoved: false,
          commentUpdated: false,
        },
      ]),
    );
    expect(output).toContain("| 3 | 1 | 1 | 1 |");
    expect(output).toContain("| merged | Repaired |");
    expect(output).toContain("| closed | Skipped | No cleanup needed. |");
    expect(output).toContain("| closed | Failed | API request failed");
    for (const number of [7, 8, 9])
      expect(output).toContain(
        `[#${number}](https://github.com/owner/repo/pull/${number})`,
      );
  });

  it.each(["failed", "skipped"])(
    "retains confirmed label removal in a partially handled %s row",
    (status) => {
      const output = render(
        report([
          {
            ...entry(),
            status,
            commentUpdated: false,
            reason: "Comment update did not complete.",
          },
        ]),
      );
      expect(output).toContain("Removed needs-description");
      expect(output).toContain("Comment update did not complete.");
      expect(output).not.toContain("Updated original comment");
      expect(output).not.toContain("#issuecomment-");
      expect(output).toContain(
        status === "failed" ? "| 1 | 0 | 0 | 1 |" : "| 1 | 0 | 1 | 0 |",
      );
    },
  );

  it("renders an empty completed scan without fabricating failed PRs", () => {
    const output = render(report([]));
    expect(output).toContain("Scan: **complete**.");
    expect(output).toContain("| 0 | 0 | 0 | 0 |");
    expect(output).toContain("No PRs were discovered.");
    expect(output).not.toContain("| PR | State |");
  });

  it("distinguishes an incomplete discovery failure from failed PR outcomes", () => {
    const output = render({
      ...report([]),
      discoveryComplete: false,
      scanError: "PR discovery failed (HTTP 500).",
    });
    expect(output).toContain("Scan: **incomplete**.");
    expect(output).toContain("Scan failure: PR discovery failed");
    expect(output).toContain("HTTP 500");
    expect(output).toContain("| 0 | 0 | 0 | 0 |");
    expect(output).toContain("do not represent a complete scan");
  });

  it("shows known PRs skipped after an incomplete paginated scan", () => {
    const output = render({
      ...report([
        {
          ...entry(),
          status: "skipped",
          reason: "Not processed because PR discovery did not finish.",
          labelRemoved: false,
          commentUpdated: false,
          terminalStatus: "unknown",
        },
      ]),
      discoveryComplete: false,
      scanError: "PR listing failed.",
    });
    expect(output).toContain("| 1 | 0 | 1 | 0 |");
    expect(output).toContain("| unknown | Skipped |");
    expect(output).toContain(
      "Not processed because PR discovery did not finish.",
    );
  });

  it("escapes text so untrusted reasons cannot inject markup, links, rows, or commands", () => {
    const reason =
      "<img src=x onerror=alert(1)> | [click](https://evil.test)\n| forged | **bold** `code` ::error:: @owner";
    const output = render({
      ...report([{ ...entry(), reason }]),
      scanError: reason,
    });
    expect(output).not.toContain("<img");
    expect(output).not.toContain("[click]");
    expect(output).not.toContain("**bold**");
    expect(output).not.toContain("`code`");
    expect(output).not.toContain("::error::");
    expect(output).not.toContain("@owner");
    expect(output).not.toContain("\n| forged |");
    expect(output).toContain("&#124;");
    expect(output).toContain("&#60;img");
    expect(output).toContain("&#91;click&#93;");
  });

  it("ignores PR titles, bodies, arbitrary exception fields, and token properties", () => {
    const value = {
      ...report([
        {
          ...entry(),
          title: "private-title",
          body: "private-body",
          token: "secret-token",
          error: { message: "private-exception" },
        },
      ]),
      token: "report-token",
      error: new Error("raw-exception"),
    };
    const output = render(value);
    expect(output).not.toMatch(
      /private-|secret-token|report-token|raw-exception/,
    );
  });

  it.each([0, -1, "900", "900) [click](https://evil.test)"])(
    "does not build a comment URL from an invalid comment id: %j",
    (commentId) => {
      const output = render(report([{ ...entry(), commentId }]));
      expect(output).toContain("Updated original comment");
      expect(output).not.toContain("#issuecomment-");
      expect(output).not.toContain("evil.test");
    },
  );

  it("bounds Unicode-heavy output by bytes and explicitly reports omitted rows with full totals", () => {
    const entries = Array.from({ length: 100 }, (_, index) => ({
      ...entry(index + 1),
      reason: "説明文".repeat(100),
    }));
    const output = render(report(entries), 4096);
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(4096);
    expect(output).toContain("| 100 | 100 | 0 | 0 |");
    expect(output).toMatch(/\d+ PR row\(s\) omitted/);
    expect(output).toContain("see the complete report in the step logs");
    const shown = [...output.matchAll(/\| \[#\d+\]/g)].length;
    const omitted = Number(output.match(/(\d+) PR row\(s\) omitted/)![1]);
    expect(shown + omitted).toBe(100);
  });

  it("caps the default summary below the GitHub one-MiB limit even for large reports", () => {
    const entries = Array.from({ length: 10_000 }, (_, index) => ({
      ...entry(index + 1),
      reason: "x".repeat(1000),
    }));
    const output = render(report(entries));
    expect(Buffer.byteLength(output)).toBeLessThanOrEqual(900_000);
    expect(output).toContain("| 10000 | 10000 | 0 | 0 |");
    expect(output).toContain("PR row(s) omitted");
  });

  it("keeps all rows when the report fits and truncates excessively long individual reasons", () => {
    const output = render(report([{ ...entry(), reason: "x".repeat(2000) }]));
    expect(output).toContain("details truncated; see step logs");
    expect(output).not.toContain("PR row(s) omitted");
    expect(output).toContain("[#7]");
  });

  it.each(["bad", "owner/repo/extra", "owner/repo)[x](evil)", "../repo"])(
    "rejects an invalid repository instead of building an unsafe link: %s",
    (invalidRepository) => {
      expect(() =>
        renderReconciliationSummary({
          repository: invalidRepository,
          report: report(),
        }),
      ).toThrow("Invalid repository");
    },
  );

  it.each([0, 1, 4095, -1, 4096.5, Number.NaN])(
    "rejects an unusable summary byte limit: %j",
    (maxBytes) => {
      expect(() => render(report(), maxBytes)).toThrow("byte limit");
    },
  );

  it.each([
    { entries: null, discoveryComplete: true },
    { entries: [], discoveryComplete: "yes" },
    { entries: [], discoveryComplete: true, scanError: {} },
    { ...report(), entries: [entry(0)] },
    { ...report(), entries: [{ ...entry(), status: "unknown" }] },
    { ...report(), entries: [entry(), entry()] },
  ])(
    "rejects a malformed report instead of reporting false counts: %j",
    (bad) => {
      expect(() =>
        renderReconciliationSummary({ repository, report: bad }),
      ).toThrow();
    },
  );
});
