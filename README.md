# Multilingual Grammar Learning Site Builder

Standalone core runtime for the Codex skill that turns a validated multilingual
`grammar-report.json` into a responsive, static React learning site.

The generated site provides content-led editorial presentation, sentence and
grammar search, language and level filters, shareable URL state, responsive
reading navigation, light/dark/system themes, and optional local media copying.
The input report is validated and copied byte-for-byte into the site.

## Requirements

- Node.js 24
- npm 11 or newer

## Install and verify

```bash
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
python3 -m http.server 4173 --directory output/sample/site
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
