# Changelog

## 0.1.0-alpha.5 — 2026-11-07

- Use the owner-approved sharp Pieceboard artwork as the single packaged logo source, preserving the smooth blue-to-amber connection.
- Embed that exact image in generated reports and keep the SVG entry points as wrappers so the large logo and small mark cannot drift apart.
- Check the packaged image bytes in the report smoke test.

## 0.1.0-alpha.4 — 2026-11-07

- Replace the soft-glow README logo with crisp vector artwork and a small raster fallback for npm.
- Use the packaged connected-piece mark inside generated reports so the small icon stays consistent with the public logo.
- Verify the release-pinned README logo and packaged brand assets during the package smoke test.

## 0.1.0-alpha.3 — 2026-11-07

- Connect the lower-left and upper-right blue pieces in the logo and small vector mark for clearer recognition at header size.
- Point npm README images and source links to this immutable release tag.

## 0.1.0-alpha.2 — 2026-11-07

- Unpublished staged candidate superseded by alpha.3 before npm approval.

## 0.1.0-alpha.1 — 2026-11-07

- Rename the public package and primary CLI to Pieceboard, retain the `ui-sheet` command and serialized format for existing projects, and ship the owner-selected connected-piece logo.
- Frame visual review as a clear this-or-that choice between observed versions; keep source revision and reported served revision separate in supplied capture context.
- Validate optional role, school, viewport, timestamp, served revision, and image hash for manually supplied screenshots; show the context beside the image without treating it as deployment proof.
- Expand installation, safe sharing, and alpha publication instructions; verify the packed package from a fresh consumer.
- Add explicit layout checks for text clearance, signed element gaps, computed spacing, approved logo source paths, and distortion, with separate screen/print-preview context.
- Show measured layout findings and real previews in the report; add an image-free CI check and a reproducible synthetic demo.
- Treat missing, unsupported, hidden, or unstable layout evidence as incomplete rather than clean.
- Audit selected pages at multiple browser widths in one run, with width-specific overflow, clipped-text, and overlap evidence, privacy-masked screenshots, and reviewable CSS suggestions.

## 0.1.0-alpha.0 — 2026-11-04

- Record scoped CSS custom-property declarations and approve/check source token values without a browser; preserve theme, media, and layer contexts and distinguish missing, ambiguous, and unscanned evidence.
- Improve token value/label contrast and check token cards and scoped details with automated accessibility rules at desktop and narrow widths.
- Include the owner-approved security policy in the repository and package.

- Add opacity and safe CSS filter comparison, repeated-deviation findings, strict-majority ambiguity, and explicit migration to button baseline v4/element baseline v2.
- List every observed source occurrence for a selected finding, with a bounded CLI query and expandable report lists.
- Add configured-family appearance/location queries and visual approval import/export.
- Track per-page scan phases without retaining URLs or secrets in completion markers; reject completion with unvisited planned pages.
- Preserve the first separately authored evaluation result, including its misses, and add a reproducible multi-control demo and privacy-canary checks.

- Compare explicitly configured inputs, dropdowns, selectors, tabs, headers, sidebars, navigation, headings and text with state separation, source evidence and real previews; keep these new families experimental.
- Approve configured-family references separately from button baselines, with page/state/context scope and optional cross-page authority.
- Bound capture and browser cleanup, publish evidence transactionally, and support explicit verified focus/hover setup per page.
- Ship JSON schemas and compatibility documentation; return structured errors from `check --json`.
- Record separate coding-agent and accessibility exercises; fix count contrast and light/dark/mobile focus indicators found during review.

- Scan supported source files into an offline UI inventory with searchable source references and category filters.
- Capture real rendered controls and identify possible differences between comparable native buttons.
- Show high-density examples, measured differences, coverage, and source-confidence information.
- Record findings through the report or CLI, preserve existing decisions during export, and approve observed button appearances for a specific page, viewport, and theme.
- Define comparable button groups with project-specific CSS selectors and omit selected source paths or mask screenshot regions.
- Configure multiple routes and capture a selected viewport and browser color preference, with optional user-provided demo authentication state.
- Provide image-free CLI summaries, comparison with compatible prior reports, and installable Codex and Claude Code skills.
- List observed button-family occurrences across selected routes, with source-confidence clues.
- Optionally compare explicitly grouped button appearances across selected pages, counting a style once per page.
- Approve a cross-page button reference so a widespread drift can be detected even when the approved style is no longer visible.
- Distinguish source-linked inventory preview counts from comparison-preview counts in scan output.
- Allow explicitly configured, clearly labeled source links when automatic matching is ambiguous.
- Let projects classify exact CSS classes as UI types to include custom controls in the visual inventory without broadening the native-button comparison.
- Keep reviewed findings stable across line moves for unique static element IDs; regenerate older comparison reports and review decisions whose IDs become stale.
- Treat source-scan warnings or missing warning metadata as incomplete coverage in checks.
- Exclude possibly blocked buttons and report offscreen or otherwise unverified visibility as incomplete coverage.
- Improve report keyboard navigation, focus visibility, and reduced-motion behavior.
- Increase the size and contrast of key report labels and source paths.
- Add a repeatable, explicitly limited public-source association spot check.
- Queue and export approved appearances from the visual report, preserving imported baseline rules.
- Verify that a source-only CLI scan works with network calls blocked and AI credentials absent.
- Warn and leave package imports unresolved when selected projects contain duplicate workspace package names.
- Compare each border side's width, style, and color. Regenerate older comparisons and reapprove appearances into a new v2 baseline file; missing measurements cannot be safely inferred.
- Track CLI scan completion and prevent checks from treating a failed, interrupted, concurrent, or mismatched run as a fresh report.
- Improve contrast and text sizes across report navigation, summaries, and details; add automated accessibility checks for selected desktop, mobile, review, and dialog states.
- Show the source scan time in the report footer.
- Add an opt-in Vite development plugin that links supported JSX/TSX controls using source locations and file fingerprints, with incomplete-coverage reporting for missing or invalid markers.
- Add a separate, labeled browser evaluation with recorded false positives and misses.
- Compare supported gradients, font style, text transform, and decoration; exclude unsupported image backgrounds from comparison. Reapprove older baselines with the new measurements.
- Capture at configurable 1×–4× density and inspect original pixels with a resolution-aware zoom control; keep comparisons scoped to the capture density.
- Record browser version and local source-revision context when available.
- Avoid attributing entirely untracked or ignored source files to an enclosing Git revision, and report tracked-source coverage for mixed scans.

This is an unreleased prototype. See [the project plan](PROJECT_PLAN.md) for outstanding work and [the README](README.md) for supported behavior.
