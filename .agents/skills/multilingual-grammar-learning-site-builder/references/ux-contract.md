# Learning site UX contract

Use this contract for every generated site. Adapt the visual expression to the report, but do not remove the interaction and readability guarantees below.

## Content-led direction

- Derive the visual brief from the report title, overview, article or dialogue type, chapter summaries, language mix, and sentence density.
- Make the interface feel appropriate to the source. For example, use an editorial reading-workbench direction for interviews or essays and a transcript-oriented direction for timed dialogue.
- Use report content for hierarchy and labels. Do not invent themes, claims, imagery, chapter names, or metadata.
- Avoid a generic dashboard composition when the source is primarily an article. Prioritize reading, then grammar inspection, then supporting metadata.

## Required reading loop

Keep this path obvious and functional:

1. Open the overview.
2. Start reading or enter through a chapter.
3. Locate the active chapter and sentence.
4. Select a grammar point and read its explanation.
5. Move to the previous or next sentence.
6. Return to the overview without losing theme or UI-language state.

Use shareable URL state for view, sentence, grammar point, filters, UI language, and theme when applicable.

## Information architecture and controls

- Keep search visible in the reading view.
- Keep secondary language and level filters available without letting them dominate the mobile viewport.
- Provide a clear-filter action and an accurate visible-result count.
- Give chapter, sentence, grammar, and navigation controls distinct active, hover, focus, disabled, and pressed states.
- Keep previous and next controls labeled; do not rely on arrows alone.
- Keep the active sentence visible in the sentence index. Center it automatically when the index scrolls horizontally.
- On narrow screens, scroll the selected grammar explanation into view.
- Do not render inactive overview or navigation controls that appear clickable but do nothing.

## Typography and reading comfort

- Prefer readable editorial line lengths over filling every available pixel.
- Use responsive sentence sizing. Reduce type progressively for long and very long sentences while keeping comfortable line height.
- Keep grammar explanations and essential details at normal reading size; reserve small mono text for coordinates and secondary metadata.
- Avoid all-caps body copy, dense unbroken paragraphs, and low-contrast essential text.
- Keep hierarchy visible through size, weight, spacing, and alignment rather than color alone.

## Responsive behavior

At desktop widths, keep the sentence and grammar inspector simultaneously usable without making the explanation column too narrow.

At mobile widths:

- Keep the primary search field visible and collapse secondary filters behind an explicit expanded-state button.
- Provide a fixed bottom reading dock for previous sentence, overview or position, and next sentence.
- Add enough bottom padding that the dock never covers the final content.
- Use at least 44 px targets for primary touch controls and at least 40 px for compact sentence-index controls.
- Prevent horizontal page overflow. Allow deliberate horizontal scrolling only inside bounded index or chip regions.
- Keep the first meaningful sentence content within roughly the first 45% of a typical phone viewport when filters are collapsed.
- Respect safe-area insets and reduced-motion preferences.

## Accessibility

- Use semantic landmarks, headings, lists, labels, and native controls.
- Expose current chapter or sentence with `aria-current` and selected grammar with `aria-pressed` or equivalent semantics.
- Maintain visible keyboard focus and logical tab order.
- Preserve a skip link to main content.
- Do not communicate state through color alone.

## Browser acceptance

Verify at minimum at 1440×900 and 390×844:

- No horizontal page overflow.
- Overview, start-reading, chapter, sentence, grammar, previous, next, clear-filter, filter-toggle, and return-to-overview controls work.
- Mobile filter expansion and collapse update both the UI and accessibility state.
- The fixed mobile dock remains usable while content scrolls.
- Long sentences remain readable without clipping.
- Active sentence and grammar state agree with the URL.
- Light, dark, and system themes remain usable.
- Chinese, Japanese, and English UI modes do not break layout.
- Browser console contains no errors or unexpected warnings.
- Production assets, favicon, and immutable report data load successfully.

Capture desktop and mobile screenshots after the interaction checks. Record any browser or platform not manually exercised as a remaining risk.
