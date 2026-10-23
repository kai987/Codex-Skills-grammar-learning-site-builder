## Changes

<!-- Required: keep the three section headings and checklist wording unchanged.
Replace the placeholder below with what changed and why, in any language.
Comments and code-block examples do not count as filled-in content. -->

-

## Validation

<!-- Required: keep every command row and fill in its Result cell.
Use "Pass — summary or link", "Fail — summary or link", or "Not run — reason".
A status alone (or a TODO/TBD placeholder) is not a complete result.
All six required GitHub Actions checks, including pr-description, must pass.
Run the generated-file check after committing the intended changes. -->

| Check            | Command                         | Result |
| ---------------- | ------------------------------- | ------ |
| Type checking    | `npm run typecheck`             |        |
| Production build | `npm run build`                 |        |
| Tests            | `npm test`                      |        |
| Formatting       | `npm run format:check`          |        |
| Generated files  | `npm run check:generated-files` |        |

## Generated-file confirmation

<!-- Required: review the Files changed tab and check all three items below.
Incomplete descriptions fail pr-description. Editing this body reruns that check. -->

- [ ] I reviewed the PR diff and included only intended source, documentation, tests, and configuration changes.
- [ ] I did not commit `output/`, `cache/`, `temp/`, `node_modules/`, virtual environments, or other cache/dependency directories.
- [ ] I did not commit generated build or coverage files (`dist/`, `dist-types/`, `coverage/`, `*.tsbuildinfo`), logs, analysis reports, media exports, screenshots, or archives.
