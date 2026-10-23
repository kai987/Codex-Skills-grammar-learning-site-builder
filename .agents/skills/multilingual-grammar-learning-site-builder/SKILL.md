---
name: multilingual-grammar-learning-site-builder
description: Build, modify, or validate an interactive language-learning website from a validated multilingual grammar-report JSON file. Use for grammar-report site tasks, not general frontend work, raw-text analysis, or subtitle generation. Preserve the source report unchanged.
---

# Multilingual Grammar Learning Site Builder

Build a static, content-led presentation layer from one validated `grammar-report.json`. Treat the report as immutable source data and the reading experience as a required product surface, not decorative styling.

## Follow the site workflow

Use the full workflow for a new site. For changes to an existing site, perform only the affected steps and preserve the existing report and reading behavior; do not regenerate the site for documentation or packaging tasks.

1. Validate the report against `schemas/grammar-report.schema.json` and stop on precise errors.
2. Copy the report into the generated site's `data/` directory without changing it. In the presentation layer, exclude sentences whose `grammar` array is empty; derive all displayed counts, routes, search, and navigation from the remaining sentences (see the data contract).
3. Derive a compact design brief from the report title, overview, content type, chapter summaries, language mix, and density. Do not invent article facts or decorative media.
4. Build the React/TypeScript/Vite site with local assets and no browser-side API keys. Preserve the repository template's proven interaction model unless the user explicitly requests a different one.
5. Keep UI language independent from content language.
6. Expose original-text and grammar search, language filters, and correctly separated JLPT/HSK/CEFR filters.
7. Show a collapsible timeline when valid sentence times exist. Show media controls only when media is enabled; do not require a video to browse timed sentences.
8. For a new site, release acceptance, or changes to shared navigation, layout, or state, exercise the complete reading loop: overview → start reading → chapter or sentence → grammar point → previous/next sentence → overview.
9. For those full-acceptance cases, verify the production build, keyboard navigation, responsive layout, theme modes, URL state, console output, and report hash. For local changes, check the affected page, language, or interaction and relevant regressions, retaining report-integrity checks where the data/build path is involved. Documentation-only and packaging tasks do not require browser QA.

## Enforce the UX baseline

Read [references/ux-contract.md](references/ux-contract.md) before generating, redesigning, or validating the UI. Preserve its interaction, readability, responsive, and accessibility guarantees; choose browser-QA scope according to the change as described in its Browser acceptance section.

Adapt the visual language to the article rather than applying a fixed generic dashboard theme. Keep the information architecture and core reading controls predictable even when color, typography, or editorial composition changes.

Default to the template's reading-first layout: compact navigation, balanced original-text/explanation columns, translation beside the original, optional readings on demand, sentence-number jump, safe keyboard navigation, and mobile return-to-sentence controls. Follow the UX contract for behavior and acceptance rather than copying a particular article's colors or labels.

The shared implementation is in `apps/grammar-learning-site-template/src/App.tsx`; its reading-first styles are in `reading-experience.css`, imported after `styles.css` by `main.tsx`. Preserve that import when adapting the template so future builds retain the upgraded layout.

When the user requests a different design direction, change the visual expression while retaining the required reading loop, mobile ergonomics, focus behavior, active states, and data integrity.

## Keep responsibilities separate

Do not infer, repair, or regenerate missing analysis. Do not process raw subtitles or video. Return a Schema error instead of inventing report content.

## Run the static builder

```bash
node .agents/skills/multilingual-grammar-learning-site-builder/scripts/run.mjs \
  --input "/path/to/grammar-report.json"
```

Use `--output` to select the analysis directory and `--copy-video` only when the user explicitly wants a local video copy. The build writes `site/index.html`, hashed local assets, immutable report data, `data/build-manifest.json`, and `README.txt`.

Read [references/site-contract.md](references/site-contract.md) when extending or validating the static build and data contract.
