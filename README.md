# Multilingual Grammar Learning Site Builder

[![CI](https://github.com/kai987/Codex-Skills-grammar-learning-site-builder/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/kai987/Codex-Skills-grammar-learning-site-builder/actions/workflows/ci.yml)

English | [日本語](README.ja.md)

Standalone core runtime for the Codex skill that turns a validated multilingual
`grammar-report.json` into a responsive, static React learning site.

The generated site provides content-led editorial presentation, sentence and
grammar search, language and level filters, shareable URL state, responsive
reading navigation, light/dark/system themes, and optional local media copying.
The input report is validated and copied byte-for-byte into the site.

## Reading experience

- Show only sentences with grammar notes, without changing the source report.
- Use a compact two-column reader with translations beside the original and expandable readings.
- Jump by sentence number, switch sentences with arrow keys, and browse a collapsible timeline.
- Keep mobile navigation within reach and return from a grammar explanation without losing the selection.

## Continuous integration

[GitHub Actions CI](https://github.com/kai987/Codex-Skills-grammar-learning-site-builder/actions/workflows/ci.yml)
runs on every push and pull request, and can also be started manually. Four
independent checks run on Ubuntu with Node.js 24 and npm 11.18.0:
`typecheck`, `build`, `test`, and `format:check`. Each installs dependencies with
`npm ci`; a failing check does not cancel the other checks.

A fifth check, `generated-files`, scans the entire Git commit tree with Node.js
and no dependency installation. It rejects generated directories at any depth
(including `output/`, caches, build output, coverage, and dependencies), build
metadata/logs, archives, media exports, and known generated reports. Source
assets, schemas, and synthetic report fixtures under `tests/fixtures/` remain
allowed. Ignored or untracked local build output does not fail the check.

A sixth check, [`pr-description`](https://github.com/kai987/Codex-Skills-grammar-learning-site-builder/actions/workflows/pr-description.yml),
requires the PR template to be completed: describe the changes, fill in every
validation result, and check all three generated-file confirmations. It reads
the current PR body using a read-only token and runs when a PR is opened,
edited, reopened, updated with commits, or marked ready for review. Editing the
description reruns this check without rerunning the other five CI checks.

After the check finishes, a separate `PR description feedback` workflow lists
missing items in a single bot comment. Fixing the description updates that same
comment to show completion; later failures reuse it, and unchanged feedback is
not posted again. PRs that have never failed receive no extra success comment.
The same workflow adds `needs-description` when the current description is
incomplete and removes it once the description is complete. It creates the
repository label on first use if needed, without changing an existing label's
color or description. It preserves all other PR labels and repairs label state
even when the feedback comment is unchanged or no success comment is needed.
Repeated runs do not add duplicate labels or comments. Label changes happen
after the description check finishes; API errors fail the feedback job visibly.

Manually adding or removing `needs-description` on an open PR also starts the
read-only `PR description label recheck` workflow. After it runs, trusted
feedback recomputes the current description: an incomplete PR regains the
label, while a complete PR loses it. Unrelated labels, GitHub bot accounts,
bot-initiated reruns, and skipped recheck jobs do not cause feedback writes.
The bot uses `GITHUB_TOKEN`, whose label events do not trigger another run,
and repeated results remain idempotent. This optional recheck is separate from
the six required checks; skipping it cannot replace their results.
Rechecks do not cancel one another. Feedback writes remain serialized, with
GitHub's bounded queue of up to 100 pending runs instead of replacing a pending
run when another event arrives.

Closing or merging a PR starts the permission-free `PR description lifecycle`
signal workflow. Trusted feedback then removes only `needs-description` and
updates the original bot comment to **closed** or **merged** using the current
GitHub state. It preserves other labels, creates no new terminal comment, and
does not repeat identical updates. Reopening the PR lets the original checks
restore normal feedback and label state.
Explicitly skipped or cancelled source runs never write feedback; their job
metadata does not need to be available before they can be safely ignored.

Event-driven lifecycle cleanup verifies the exact source job and matches live closed PRs
by repository and head/merge commit, including deleted forks and missing PR
association lists. All writers share one repository-level queue so delayed
open-PR checks cannot race close/merge cleanup. Reopened or changed PRs are
rechecked before each write. No PR-controlled text or code authorizes cleanup.

The same [`PR description feedback` workflow](https://github.com/kai987/Codex-Skills-grammar-learning-site-builder/actions/workflows/pr-description-comment.yml)
also runs every hour at minute **17 (UTC)** to recover missed close/merge
notifications, including those suppressed when `GITHUB_TOKEN` closes or merges
a PR. It scans all pages of closed PRs, including merged PRs and deleted forks,
without a time cutoff or a `needs-description` label filter. This also repairs
an outdated comment after the label has already been removed. It uses current
GitHub state, removes only `needs-description`, and updates only the existing
feedback comment to **closed** or **merged**; other labels remain untouched.
No original comment means no new terminal comment, and unchanged results cause
no writes. The sweep shares the event-driven writer's queue and rechecks each
PR's identity and terminal state before every write, skipping reopened or
changed PRs. An API failure for one PR does not prevent the remaining PRs from
being checked, but fails the overall run visibly so a later sweep can retry.

To view results, open **Actions → PR description feedback**, choose a scheduled
or manually dispatched run, and open **Summary → PR description cleanup**.
It shows **Scanned / Repaired / Skipped / Failed** totals and a table linking
each PR to its closed/merged state, result, confirmed changes, and reason.
Scanned counts unique, valid PR candidates found in this repository; the other
three totals partition that count. Already-clean PRs, including those with no
original feedback comment, are skipped, as are reopened, changed, or invalid
live PRs. A failed or skipped row still records any earlier confirmed change,
such as label removal; an unsuccessful write is never reported as confirmed.

The summary is written even when a PR fails. A PR-listing failure explicitly
marks the scan incomplete and shows only discovered candidates, rather than
claiming a complete repository scan or inventing a failed PR. Empty scans show
zero PRs. If the display limit is reached, the summary keeps the full counts,
states how many rows were omitted, and points to the step logs for the complete
report. It includes no PR titles, bodies, or tokens. These summaries apply only
to scheduled/manual sweeps; they add no PR comments or repository artifacts.

Scheduled/manual sweeps also have a separate `pr-cleanup-alert` job that runs
after the scan, including scan-job checkout, Node.js setup, or timeout failures.
The first failure creates one bot-owned GitHub Issue. Later failures update
that Issue's body without posting comments or adding mentions; the same event
and content cause no extra write. A successful recovery updates and closes the
Issue, and a later failure reopens that same Issue. Healthy runs with no alert,
or an already recovered alert, make no Issue changes. Other Issues, labels,
and assignees are preserved.

The alert links to the latest failed run and recovery run, where the cleanup
summary and job logs explain the result. It includes no raw exception text or
PR content. Stored workflow run numbers and attempts prevent an old rerun from
overwriting a newer failure or recovery already recorded in the Issue. This default-branch-only job has
`contents: read` and `issues: write`; normal feedback permissions stay unchanged,
and both jobs share the repository's serialized queue.
Cancelled or skipped scans neither create nor resolve alerts. Workflow
cancellation or a GitHub/Issue API outage can prevent delivery; an alert-job
error remains visible in Actions, and a later sweep reconciles the Issue again.
Alert delivery failures do not recursively create more alerts.

For an immediate catch-up, open that workflow in Actions, select **Run workflow**
with the default branch (`main`), or run:

```bash
gh workflow run pr-description-comment.yml --ref main
```

The manual sweep accepts no PR inputs and runs only on the default branch.
[GitHub schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
can be delayed or dropped during high load, so the hourly sweep is a fallback,
not an exact completion deadline. Public repositories also have scheduled
workflows disabled after 60 days without activity; re-enable this workflow in
Actions before starting a manual catch-up if that happens.

GitHub may require approval for a fork's first workflow run, and `pull_request`
workflows do not run while the PR has merge conflicts. Resolve conflicts or
approve the run, then rerun the label recheck if needed.
The default-branch sweep does not depend on delivery of a `closed` event or a
successful PR workflow, so it can clean up missed terminal feedback in these
cases too. It does not change the checks required while a PR is open.

The feedback writer uses only trusted default-branch code and limited PR write permission
(plus read-only Actions access to verify recheck job results),
not PR code, dependencies, or artifacts. It also handles fork PRs whose workflow
metadata has no PR-number list. It does not replace the six required checks.

## Contributing

`main` is protected. All changes must be submitted through a pull request;
direct pushes to `main` are blocked, including for administrators.

1. Start a branch from the latest `main` in your local clone:

   ```bash
   git switch main
   git pull --ff-only origin main
   git switch -c codex/your-change
   ```

2. Make your changes and run the same checks as CI with Node.js 24 and npm 11.18.0:

   ```bash
   npm ci
   npm run typecheck
   npm run build
   npm test
   npm run format:check
   ```

   If formatting needs correction, run `npm run format`, review the changes,
   then rerun `npm run format:check`. Keep generated `output/`, reports, videos,
   build artifacts, caches, and `node_modules/` out of commits.

3. Commit the intended files, then run `npm run check:generated-files` to inspect
   that commit before pushing your branch. Open a PR targeting `main` and
   complete its template. Keep the three section headings, command rows, and
   checklist wording unchanged. Write the changes in any language; fill each
   Result cell with `Pass — summary or link`, `Fail — summary or link`, or
   `Not run — reason`. Empty cells, status-only answers, TODO/TBD placeholders,
   comments, and code-block examples do not count. Review the diff and check
   all three generated-file confirmations.

4. Wait for all six required GitHub Actions checks to pass: `typecheck`,
   `build`, `test`, `format:check`, `generated-files`, and `pr-description`.
   An incomplete description blocks merging; edit the PR body to fix it and
   rerun the description check automatically. A PR cannot merge while any
   required check is pending or failing. The PR branch must also be up to date with
   `main`; if `main` advances, update your branch and wait for CI to pass again
   before merging.

## Requirements

- Node.js 24
- npm 11 or newer

## Install and verify

```bash
git clone https://github.com/kai987/Codex-Skills-grammar-learning-site-builder.git
cd Codex-Skills-grammar-learning-site-builder

npm ci
npm run typecheck
npm run build
npm test
```

## Build a site

Run through the bundled skill entrypoint:

```bash
node .agents/skills/multilingual-grammar-learning-site-builder/scripts/run.mjs \
  --input "/path/to/grammar-report.json" \
  --output output/sample
```

Or call the focused CLI directly:

```bash
npm run build-learning-site -- \
  --input "/path/to/grammar-report.json" \
  --output output/sample
```

Add `--overwrite` to replace only the selected `site/` directory. Use
`--copy-video /path/to/video.mp4` only when a local video copy is explicitly
required.

Serve the generated directory with any static server:

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory output/sample/site
```

## Runtime scope

This repository intentionally contains only the runnable site-builder closure:

- `.agents/skills/multilingual-grammar-learning-site-builder`
- `apps/grammar-learning-site-template`
- `packages/site-builder-core`
- the focused shared grammar-report schema and filesystem utilities
- `schemas/grammar-report.schema.json`
- the focused CLI and integration test

It excludes generated `output/`, analysis reports, videos, caches, benchmarks,
virtual environments, subtitle/transcription pipelines, and unrelated skills.

## License

[MIT](LICENSE). Source texts, reports, and videos retain their own usage conditions.
