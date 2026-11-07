# Approve source design tokens

Use token baselines when a project has decided that a specific CSS declaration should keep a particular value. For example, approve `--control-radius: 8px` inside `:root` in `src/theme.css`, then detect a later change to `3px`.

This is a source check. It needs no browser, application server, AI provider, or API key. It compares the selected CSS declarations and does not calculate the CSS cascade, resolve aliases, or establish which token value reaches a rendered component. Rendered appearance checks remain a separate workflow.

## Record an approved value

1. Scan the relevant source successfully:

   ```sh
   npx --no-install ui-sheet scan . --include src --out .ui-sheet
   ```

2. List declarations for the token. The name beginning with `--` is the value of `--name`:

   ```sh
   npx --no-install ui-sheet tokens .ui-sheet --name --control-radius --file src/theme.css
   ```

   Inspect each entry's `value`, `important`, `file`, and `context`. A context records the full sequence of enclosing selectors and at-rules, from outermost to innermost. Light and dark selectors, media queries, and CSS layers remain distinct. The JSON query returns at most 200 entries; inspect `total` and `truncated`.

3. Copy the chosen entry's `id` into an approval command:

   ```sh
   npx --no-install ui-sheet token-baseline .ui-sheet --file ui-token-baselines.json --declaration TOKEN_ID_FROM_QUERY --reason "Approved shared control radius"
   ```

   An approval requires a matching completed scan record, a successfully scanned target file, and exactly one declaration for that scope. Duplicate declarations with the same file, token, and complete context are ambiguous, even if their values agree. Resolve them or choose a different scope before approving. Approval updates that scope in a recognized baseline file and preserves the other rules. Invalid existing files are rejected unchanged.

Keep `ui-token-baselines.json` in version control if its values and review reasons are suitable for the project. Reports remain local. Approval records project intent; agents should create or change approvals only when the user or project workflow authorizes that decision.

Approvals to the same file are serialized with an exclusive sidecar lock. A concurrent approval fails and can be retried after the active writer finishes. If a process is interrupted and leaves a lock, first verify that no approval command is still running, then remove only the named lock and retry. The CLI does not remove a pre-existing lock automatically.

## Check after a change

Run a fresh scan with the required files included, stop if it fails, and then check:

```sh
npx --no-install ui-sheet scan . --include src --out .ui-sheet
npx --no-install ui-sheet check-tokens .ui-sheet --file ui-token-baselines.json --json --fail-on-findings --strict-coverage
```

| Status | Meaning |
| --- | --- |
| `matched` | One declaration has the approved value and importance. |
| `changed` | One declaration has a different value or `!important` setting. |
| `missing` | The CSS file was successfully parsed, but the approved declaration scope was absent. |
| `ambiguous` | Several declarations match the same scope. |
| `unscanned` | The required file was excluded, absent, failed to parse, or lacks current token-source metadata. |

`--fail-on-findings` exits 1 for changed or missing declarations. `--strict-coverage` exits 2 for partial or insufficient evidence and takes precedence. By default the command reports results without failing on differences. Invalid input or a failed, interrupted, or mismatched tracked scan exits 2. With `--json`, a command error returns `ui-sheet/error-v1` with `error.code: "TOKEN_CHECK_FAILED"`.

`coverage: "observed"` means the approved scopes were checked against the completed saved source scan. It does not mean every application token is approved. Empty approval sets have insufficient coverage; ambiguous or unscanned scopes have partial coverage. Source warnings also prevent a complete result. A saved report can become stale after editing files; the checker does not reopen the project or notice edits made after the scan.

## Identity and limits

An approval's identity includes the project-relative CSS file, case-sensitive custom property name, and full selector/at-rule context. Moving lines leaves the identity unchanged. Moving a declaration to a different file or changing its selector/context requires review and a new approval. The old scope will be missing if its original file was scanned, or unscanned if that file was absent. The tool does not guess a move or apply one theme's approval to another.

Values are the strings returned by the CSS parser, compared exactly along with the boolean importance flag. Equivalent spellings such as `#fff` and `white` can therefore differ. This check does not normalize colors or expand token references. Unsupported SCSS, CSS-in-JS declarations, dynamically generated values, and inline styles are outside this source contract. The inventory can record references without resolving those definitions.

Baseline files use `ui-sheet/token-baselines-v1`, are limited to 1,000 rules and 2 MB, and require a reason of 1–500 characters for each rule. The report stores `ui-sheet/token-source-v1` evidence; the listing and check outputs use `ui-sheet/tokens-v1` and `ui-sheet/token-check-v1`. See [schema contracts](schema.md) for machine-readable definitions. These files can contain project paths, values, and review reasons; review them before sharing.

Token-source metadata also has bounded values, names, paths, selectors, and nesting, as specified by the schema. If one declaration exceeds those limits, the scan retains the ordinary inventory, warns, and marks that CSS file's token evidence failed without publishing a partial declaration set. A path that the token contract cannot represent is omitted from token-source files with a warning. Such evidence remains incomplete; rescanning unchanged unsupported input does not make it valid.
