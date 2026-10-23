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

3. Commit the intended files, push your branch, and open a PR targeting `main`.
   Describe the change and the checks you ran.

4. Wait for all four required GitHub Actions checks to pass: `typecheck`,
   `build`, `test`, and `format:check`. A PR cannot merge while any required
   check is pending or failing. The PR branch must also be up to date with
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
