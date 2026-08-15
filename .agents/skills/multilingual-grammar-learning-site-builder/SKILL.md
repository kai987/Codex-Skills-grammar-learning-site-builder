---
name: multilingual-grammar-learning-site-builder
description: Build and UX-validate an interactive Chinese, Japanese, and English language-learning website from a validated multilingual grammar-report JSON file. Use for content-led visual direction, readable typography, responsive and touch-friendly reading flows, grammar-report visualization, language and difficulty filters, grammar cards, subtitle timeline links, optional media synchronization, and static-site generation. Do not analyze raw text, transcribe media, discover or generate subtitles, change grammar explanations, call OpenAI from the browser, or modify the source grammar report.
---

# Multilingual Grammar Learning Site Builder

Build a static, content-led presentation layer from one validated `grammar-report.json`. Treat the report as immutable source data and the reading experience as a required product surface, not decorative styling.

## Follow the site workflow

1. Validate the report against `schemas/grammar-report.schema.json` and stop on precise errors.
2. Copy the report into the generated site's `data/` directory without changing it.
3. Derive a compact design brief from the report title, overview, content type, chapter summaries, language mix, and density. Do not invent article facts or decorative media.
4. Build the React/TypeScript/Vite site with local assets and no browser-side API keys. Preserve the repository template's proven interaction model unless the user explicitly requests a different one.
5. Keep UI language independent from content language.
6. Expose original-text and grammar search, language filters, and correctly separated JLPT/HSK/CEFR filters.
7. Show timeline and optional media controls only when valid times and enabled media exist.
8. Exercise the complete reading loop: overview → start reading → chapter or sentence → grammar point → previous/next sentence → overview.
9. Verify the production build, keyboard navigation, responsive layout, theme modes, URL state, console output, and report hash.

## Enforce the UX baseline

Read [references/ux-contract.md](references/ux-contract.md) before generating, redesigning, or validating the UI. Treat its interaction, readability, responsive, accessibility, and browser-QA requirements as acceptance criteria.

Adapt the visual language to the article rather than applying a fixed generic dashboard theme. Keep the information architecture and core reading controls predictable even when color, typography, or editorial composition changes.

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
