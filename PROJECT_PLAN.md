# Pieceboard: project plan

## Product goal

Help people and coding agents keep an application's UI consistent. Pieceboard should discover relevant interface elements, show clear images of comparable examples, identify possible inconsistencies, and provide evidence about where to investigate the code.

For example, if comparable Save buttons usually have an 8 px border radius and one has a 3 px radius, the report should show both appearances, explain the difference and their observed frequency, and link to the relevant source when that link can be established. A rare appearance is a suggestion for review, not automatically an error.

The package should be useful without an AI provider. Optional Codex and Claude Code skills should enable agents to consult existing UI patterns before making changes and review findings afterward.

## Principles

- Focus on interface controls and design foundations, not ordinary page content or unrelated data.
- Capture genuine, readable examples; never invent what a component looks like.
- Compare like with like: component family, purpose, state, theme, and viewport matter.
- Count occurrences before selecting or deduplicating preview images.
- Separate measured facts, inferred relationships, manually supplied information, and unknowns.
- Prefer approved project conventions over an assumption that the most common appearance is correct.
- Operate locally by default and make rendering, authentication, and page interactions explicit.
- Keep findings useful without requiring an AI service or an API key.

## Current status

The alpha scans JSX/TSX, static HTML and PHP template markup, CSS custom properties, fonts and image assets. It generates an offline visual inventory with real high-density captures, compares native buttons and explicitly configured UI groups, and supports approved references and source-anchored review decisions. It can inspect selected pages at multiple browser widths for possible overflow, clipping, and text overlap. It ships JSON schemas, coding-agent instructions and report-only CI checks. A second coding agent exercised the documented workflow, and a separately authored accessibility review found and verified fixes for three issues. Configured non-button families remain experimental; representative accuracy, real screen-reader/native-zoom review, and Claude execution remain open. The checklist records those limits rather than treating an alpha as the entire roadmap.

## Milestone 1: protect the prototype and establish the baseline

- [x] Review and preserve the existing prototype and its tests; keep local reports and screenshots out of the public repository.
- [x] Document the supported environments, the actual current commands, and the distinction between source scanning and opt-in page rendering.
- [x] Establish the automated test and package-verification baseline.
- [x] Define versioned current-producer schemas, compact public interchange contracts, and a clear regeneration path for older reports.

**Acceptance:** the existing prototype runs from a clean checkout, reports are not accidentally committed, and changes begin from a tested baseline.

## Milestone 2: make the first button comparison work

- [x] Start with native buttons on one accessible page in a desktop viewport, excluding disabled controls and common toggle/disclosure states.
- [ ] Track focus, hover, occlusion and other inherited states before claiming complete default-state coverage.
- [x] Document source definitions/usages, rendered observations, groups/variants/states, appearances and findings as separate evidence in the schemas.
- [x] Record eligible rendered occurrences independently of preview capture limits and count excluded controls.
- [ ] Account for inaccessible, covered and changing controls in coverage and sample confidence.
- [x] Count representative button previews that were captured, unavailable, or omitted by the per-page limit, and mark incomplete preview evidence as partial coverage.
- [x] Exclude buttons with failed in-viewport hit tests and report offscreen or unverified visibility as incomplete coverage.
- [x] Measure normalized rendered properties such as background and text colors, typography, border, radius, padding and shadow.
- [x] Measure border width, style and color on each side, and require old approvals to be recaptured when those measurements are absent.
- [x] Measure supported gradients and additional text styling; exclude unsupported image backgrounds and report incomplete coverage.
- [x] Measure opacity and supported resource-free filters, require a genuine majority, and report repeated minority deviations.
- [x] Group comparable controls conservatively and identify rare or unexpected appearances with an explanation and sample counts.
- [x] Show a side-by-side comparison with the precise values that differ, page context, and source evidence when available.
- [x] Retain existing inventory functionality and label uncertain or undersampled comparisons clearly.

**Acceptance:** a seeded inconsistent button is reported, an intentionally different destructive button is not presented as a definite error, and a reviewer can see why the finding was made.

## Milestone 3: readable visuals and trustworthy evidence

- [x] Capture actual component images at high pixel density, after fonts and layout have settled, with suitable size limits and honest fallback behavior.
- [x] Provide readable comparison previews, original-size viewing and zoom without stretching low-resolution images.
- [ ] Test image clarity on standard- and high-density displays and recapture low-resolution examples where possible.
- [x] Record viewport, detected theme and route for comparisons.
- [x] Record Chromium version and local Git revision/working-tree status when available; label this as local context rather than proof of deployment.
- [x] Report how many scanned source files are tracked in the enclosing checkout and omit Git context when none are tracked.
- [x] Allow a user-supplied selector and recorded source location to supplement ambiguous automatic matches; label this evidence as manual.
- [x] Allow explicitly classified static CSS classes to add custom elements to the visual inventory and type filters, without treating them as native buttons.
- [x] Label source evidence as instrumented, likely, manually linked or unresolved; do not present an inferred match as verified.
- [x] Add opt-in Vite development instrumentation for selected JSX/TSX controls, with file-fingerprint matching and explicit coverage limits.
- [x] Exercise instrumented captures on a standalone component from a local project using sample data, without modifying its repository.

**Acceptance:** comparison labels and details are readable, genuine screenshots are used, and no finding fabricates a source location.

## Milestone 4: review and approved patterns

- [x] Let reviewers record intentional, needs-fix, deferred and false-positive decisions through the CLI.
- [x] Store source-anchored decisions that become stale when their appearance, group, page or source identity changes.
- [x] Preserve a finding identity across a line move when a static element ID is unique in selected source and the rendered page.
- [x] Add in-report review controls with import and export of source-anchored decisions.
- [ ] Support reliable decisions for more kinds of source evidence.
- [x] Allow an explicitly approved button appearance to take precedence over frequency-based suggestions for a page, viewport, theme and stable group.
- [x] Support approving observed button appearances without an existing finding.
- [x] Allow captured appearances to be approved and exported from the visual report, with an import path for existing baselines.
- [x] Add separate approved references for explicitly configured UI families, scoped to observed state and rendering context.
- [x] Approve exact source CSS token declarations by file, selector and complete at-rule context; check changed, missing, ambiguous and unscanned declarations without a browser.
- [ ] Evaluate token contracts and each added component family beyond synthetic fixtures; runtime token cascade/value enforcement remains outside the source contract.
- [ ] Separate light and dark themes, responsive breakpoints, and normal, disabled, selected, focused and hover states.
- [x] Allow project-specific button group and variant definitions using non-overlapping CSS selectors.

**Acceptance:** intentional variations can be accepted without suppressing unrelated issues, and approved patterns are honored on subsequent runs.

## Milestone 5: realistic capture coverage

- [x] Configure or explicitly select multiple routes and source scopes; analyze each route separately.
- [x] Scan selected UI paths from multiple local projects under a common parent, and warn when workspace package names are ambiguous.
- [x] List observed occurrences of a button family across the selected routes, with available source clues.
- [x] Offer compact configured-family queries and finding-specific lookup for every matching observed occurrence, including unresolved sources and truncation.
- [x] Offer opt-in cross-page comparison for explicitly named button groups and variants, with page-frequency evidence and representative captures.
- [x] Support an explicitly approved cross-page button reference that takes precedence over frequency for the same group, viewport and theme.
- [x] Configure one viewport and browser light/dark color preference per captured scan; keep their baselines and decisions separate.
- [ ] Broaden cross-page comparison to additional well-evaluated component families and application-specific theme switches.
- [x] Track requested pages, completed observation/capture phases and failed page indexes; report observed controls, omissions and incomplete evidence separately.
- [x] Keep focus/hover actions opt-in per exact page, verify their setup, record their context, and provide no automatic clicks or form submission.
- [x] Bound capture and browser cleanup time and publish evidence only after a successful capture.
- [x] Support a dedicated demo/test account through a user-led authentication flow or explicitly provided local browser state.
- [x] Keep authentication material out of generated reports and provide an ignored local state directory for this repository.
- [x] Allow configurable CSS-selector masks in automatically captured screenshots.
- [x] Allow configured and CLI source-path exclusions, including paths nested inside selected source directories.
- [x] Document data boundaries and exercise synthetic privacy canaries for browser state, resource URLs, field values and matching screenshot masks.
- [x] Exercise isolated selected UI components from two local projects with synthetic content; do not claim full application or deployment coverage.

**Acceptance:** several chosen demo pages can be examined, coverage limitations are visible, and private authentication data is not embedded in reports.

## Milestone 6: coding-agent integration

- [x] Document the prototype's versioned, provider-neutral JSON outputs and regeneration behavior.
- [x] Ship schemas and compatibility rules for current alpha reports, compact queries/checks, baselines, decisions, source evidence and coverage.
- [ ] Stabilize the complete interface for a production release after external integration feedback.
- [x] Provide installable Codex and Claude Code skill instructions for consulting existing patterns and reviewing a fresh report.
- [x] Explain uncertain findings, deliberate variants, authorization boundaries and coverage to coding agents.
- [x] Exercise the agent-facing CLI workflow on a small project with both a consistent change and a seeded regression.
- [x] Have a fresh second Codex agent exercise the documented workflow without implementation knowledge; fix its structured-error finding.
- [x] Have another fresh Codex agent exercise source token approvals against stale and incomplete reports without implementation knowledge, preserving current source and approval files.
- [ ] Evaluate actual Codex and Claude behavior independently, including cases where the tool is incomplete or stale.
- [x] Keep source-only scanning functional without AI access, model training, or network access.

**Acceptance:** a coding agent can consult an existing button pattern, make a UI change, run a check, and report a known inconsistency with useful evidence.

## Milestone 7: evaluate accuracy and broaden support

- [x] Add a labeled synthetic button development set that reports false positives and false negatives without claiming representative accuracy.
- [x] Prepare a separate set of labeled synthetic browser scenarios before scoring them, with authorship and sampling limitations documented.
- [x] Record an initial precision, recall, preview-count, and source-association result on those frozen scenarios without claiming representative accuracy.
- [x] Record an exploratory public-site check with intentional variations and explicitly unresolved source links.
- [x] Exercise a second public application against selected upstream source files and document an unsupported custom-control case.
- [x] Make the six selected public source-link spot checks repeatable, with pinned source and an HTML hash comparison.
- [x] Build synthetic fixtures with known differences and intentional variants across configured families, observed states, browser themes and selected viewports.
- [x] Freeze separately authored labels before scoring and preserve the first runtime's precision, recall, errors, source associations and preview counts.
- [ ] Evaluate the revised detector against fresh labels after tuning; the preserved first score remains below the provisional targets.
- [ ] Measure coverage, screenshot readability, source-link accuracy and reviewer false-positive feedback.
- [ ] Treat 90% precision and 80% recall on the early evaluation set as provisional goals, not claims; document sample size and limitations.
- [x] Add opt-in experimental comparisons for configured inputs, dropdowns, selectors, tabs, headers, sidebars, navigation, headings and text, with state separation and genuine previews.
- [ ] Promote additional families beyond experimental support only after their own labeled evaluation meets acceptance criteria.
- [x] Retain tested static HTML/PHP inventory and capture support, with the separate PHP component sample's manual/likely evidence clearly labeled.

**Acceptance:** tests demonstrate useful detection without overwhelming reviewers, and supported component families have documented limits.

## Milestone 8: package, CI and release

- [x] Provide non-overwriting init, documented source/route/group configuration, reproducible demos and packed-install verification.
- [x] Add a report-only CLI check with image-free JSON, optional failure for all actionable findings, and explicit incomplete-coverage handling.
- [x] Compare compatible reports and optionally fail for new, source-anchored actionable findings; treat incomplete evidence as inconclusive.
- [x] Mark scans with source warnings or missing warning metadata as incomplete in CI checks.
- [x] Record failed or interrupted CLI scans and make checks require a matching completed record for full coverage.
- [ ] Detect introduced findings reliably when source locations move or cannot be linked confidently.
- [x] Reject failed/interrupted/mismatched scans and expose incomplete evidence; strict coverage checks exit unsuccessfully.
- [x] Test a packed installation and move the Node support policy to maintained releases.
- [x] Prepare alpha package metadata and verify that the current npm name was not published when checked; availability is not reserved.
- [x] Confirm the initial CI matrix across Windows and Linux on Node 22, 24 and 26.
- [x] Prepare a README with a real synthetic-demo capture, examples, contribution guide, changelog and issue templates.
- [x] Exercise keyboard navigation, focus visibility, dialogs and reduced motion in a browser smoke test.
- [x] Check the contrast of key report labels and source paths in a browser smoke test.
- [x] Run automated accessibility rules on selected desktop, mobile, review, and dialog states, and address the issues found in the synthetic report.
- [x] Complete a separately authored agent accessibility review of the synthetic report and verify fixes for its three findings.
- [ ] Complete external human accessibility review, including screen-reader output and native browser zoom.
- [x] Establish an owner-approved security reporting policy, verify its application to the source tree, and include it in the package. The policy provides a fallback when private reporting is unavailable.
- [ ] Recheck package name availability, review release contents, and publish an alpha before considering a stable release.
- [x] Compare and document how UI Sheet complements Storybook and visual regression testing.

**Acceptance:** an independent developer can install the package, configure a small project, review a meaningful finding, and understand its limitations without help.

## Layout, typography, and brand anomaly extension

- [x] Add opt-in rules for actual text/container clearance, signed gaps between elements, computed margin/padding/word-spacing values, and approved logo image sources/aspect ratio.
- [x] Separate these explicit layout rules from existing frequency-based appearance identities and approvals.
- [x] Keep missing, hidden, unsupported, bounded, and unstable evidence incomplete; show measured requirements, manual source links, and real previews in the report.
- [x] Support separate screen/print-preview layout contexts and a compact CI check with strict incomplete-evidence handling.
- [x] Add synthetic wordmark-overlap, crowded-callout, spacing, and approved-image fixtures; keep uploaded PDFs and private brand assets out of tracked examples.
- [ ] Evaluate against separately authored real-world layout cases, responsive states, and deliberate overlaps; this first version is experimental.
- [ ] Add direct PDF glyph/container geometry and embedded-logo checks with honest source-provenance limits.
- [ ] Add exact approved asset-byte verification and additional rendered-content checks beyond descendant text rectangles.

## Initial delivery order

1. Preserve the prototype and create focused test fixtures.
2. Record rendered button occurrences and normalized style evidence.
3. Compare similar button occurrences and explain candidate differences.
4. Show crisp side-by-side previews with source-confidence labels.
5. Test against known positive and intentional-variant examples.
6. Add multiple routes, approved patterns, agent integration and CI incrementally.

## Planning estimates

For one full-time developer, the rough target is 2–3 weeks for a focused proof of concept, 5–8 weeks for a private alpha, 10–14 weeks for a public beta, and 4–6 months for a stable release. These are estimates, not guarantees. Grouping, source mapping, authenticated capture, and reducing false positives are the largest unknowns.
