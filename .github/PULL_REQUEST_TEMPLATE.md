## Changes

<!-- Required: describe what changed and why. Link related issues if applicable. -->

-

## Validation

<!-- Required: fill in every result with Pass/Fail and a short summary or link.
If a command was not run locally, write "Not run" and explain why.
All five required GitHub Actions checks must pass before this PR can merge.
Run the generated-file check after committing the intended changes. -->

| Check            | Command                         | Result |
| ---------------- | ------------------------------- | ------ |
| Type checking    | `npm run typecheck`             |        |
| Production build | `npm run build`                 |        |
| Tests            | `npm test`                      |        |
| Formatting       | `npm run format:check`          |        |
| Generated files  | `npm run check:generated-files` |        |

## Generated-file confirmation

<!-- Required: review the Files changed tab and confirm all items below. -->

- [ ] I reviewed the PR diff and included only intended source, documentation, tests, and configuration changes.
- [ ] I did not commit `output/`, `cache/`, `temp/`, `node_modules/`, virtual environments, or other cache/dependency directories.
- [ ] I did not commit generated build or coverage files (`dist/`, `dist-types/`, `coverage/`, `*.tsbuildinfo`), logs, analysis reports, media exports, screenshots, or archives.
