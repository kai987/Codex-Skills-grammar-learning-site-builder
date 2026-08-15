# Learning site contract

## Data integrity

- Accept only a report that passes `schemas/grammar-report.schema.json`.
- Copy it byte-for-byte into the static output data directory.
- Never generate missing translations, readings, examples, vocabulary, or grammar explanations.
- Show explicit empty states instead of concealing missing data.
- Keep UI strings in separate `zh-CN`, `ja-JP`, and `en` resources.

## Static runtime

- Build with Vite using `base: "./"`, hashed local assets, and no CDN.
- Never call OpenAI or expose API keys in browser code.
- Keep video external by default. Copy video only when explicitly requested.
- Seek copied media only when both the sentence timing and media are valid.

## Required capabilities

Provide sentence and grammar search, content-language and correctly separated JLPT/HSK/CEFR filters, clear-filter action, shareable URL state, light/dark/system themes, confidence warnings, keyboard focus, responsive layout, and a sentence timeline.

Apply the separate [UX contract](ux-contract.md) to reading flow, typography, mobile controls, active states, and browser acceptance.

## Validation

Validate production HTML, local asset loading, console output, responsive width, theme and UI-language controls, keyboard navigation, and the complete reading loop. Confirm that `site/data/grammar-report.json` has the same bytes and SHA-256 as the input.
