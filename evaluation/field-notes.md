# Public-site field note: Bootstrap buttons

This is a focused exploratory check, not a held-out accuracy study. On 2026-11-04 UTC, development revision `c464ade` captured the public [Bootstrap 5.3 button documentation](https://getbootstrap.com/docs/5.3/components/buttons/) in Chromium 156 at a 1440 × 900 viewport. The source scan used UI Sheet's unrelated synthetic `examples/button-review/index.html`, so the check was **not** a validation of Bootstrap source mapping.

The scan observed 95 native buttons, of which 77 were eligible for the current comparison. It captured all 28 requested representative button previews and reported two possible differences in the inferred `.btn` / `primary` group. Both outlier images showed examples labeled “Custom button”; the upstream documentation describes one as a custom-size example and the other as a custom documentation-specific button style. In this context, those differences are intentional examples and should not be treated as product defects. Their source locations were unresolved in this run.

The scan did not label every control, establish the number of missed issues, test other pages or states, or verify a deployed source revision. The page and browser may change, so a later run can produce different counts. This example illustrates why inferred frequency is a review lead and why explicit groups, approved baselines, and saved decisions matter.

To repeat a similar check from the repository after installing Playwright Chromium:

```sh
node bin/ui-sheet.js scan examples/button-review --include index.html --page https://getbootstrap.com/docs/5.3/components/buttons/ --capture --out .ui-sheet-lab/bootstrap-current
```

The output directory is ignored by Git. Use a different output directory to preserve an earlier report.

A follow-up on 2026-11-04 at 03:38 UTC used the same public page and unrelated synthetic source fixture with the visibility checks enabled. It observed 95 native buttons, of which 77 were eligible; none were classified as possibly blocked, and 73 eligible buttons had unverified visibility at the initial viewport. All 28 requested representative previews were captured, and two possible differences were reported. The check returned partial coverage and `--strict-coverage` exited 2. This is a snapshot of one page, not a visual-obstruction accuracy study; hit testing can miss overlays and the page may change.

## Public application and source: Microsoft Edge accessibility demo

On 2026-11-04 UTC, a development build scanned the public [Microsoft Edge accessibility-testing demo](https://microsoftedge.github.io/Demos/devtools-a11y-testing/) alongside its HTML and three CSS files from [the demo's source directory](https://github.com/MicrosoftEdge/Demos/tree/b580fc1ce460a67207f4c0b69292f70d2c84f12a/devtools-a11y-testing) at commit `b580fc1ce460a67207f4c0b69292f70d2c84f12a`. The files were downloaded into an ignored local folder; this does not establish that the live site was deployed from that commit. The demo is deliberately built with accessibility issues.

At 1440 × 900 and 2× in Chromium 156, UI Sheet found 42 inventory items across the four selected source files, reported two possible static ID-and-tag matches, and captured 11 source-linked inventory previews. These are heuristic associations, not independently verified source-link accuracy. The page contained zero native buttons for the current comparison. `check --strict-coverage` returned exit code 2 for insufficient evidence rather than reporting a clean button comparison.

The source contains button-like donation controls implemented as `div` elements without button roles. They were not included in the native-button consistency check or captured as controls by the default inventory. This is a real coverage gap: the scan cannot infer every custom control or assess its intent. No interactions or form submissions were performed. The run did not establish precision, recall, accessibility compliance, or behavior in other states.

The check also exposed a Git-context bug: initially, the ignored local source folder inherited the enclosing UI Sheet checkout's commit. The current code omits Git context when none of the scanned source files are tracked in that checkout and reports tracked-file counts for mixed scans. Older reports should be regenerated to obtain this correction.

A follow-up with explicit inventory classifications for `donationbutton` and `submitbutton` produced 15 source-linked inventory previews in total, including the four button-like `div` controls. The Buttons filter showed their real captures and source lines. The source association for the submit control used a unique configured class and tag; it remains a likely match, not a verified deployment link. The native-button analysis still had zero eligible controls and insufficient coverage. Configuring inventory categories does not make these elements accessible or add them to consistency comparison.

In a further spot check on the same date, the live HTML response was byte-for-byte identical to the pinned `index.html` (SHA-256 `7aab0f25b8bc6ca1a33ac4db730474ed605474ea9562534aac59b625dcea9b29`). The four configured controls at lines 115–117 and 124, the input at line 121, and the navigation at line 137 had matching tags and identifying text or IDs in the rendered page. This checks six selected associations against one static response and a read-only DOM inspection; it is not an independent accuracy benchmark, and the matching HTML does not establish the deployed CSS, JavaScript, or full repository revision.

The six selected stored previews also had byte-for-byte identical PNGs in a fresh capture on the same Chromium installation. This is a narrow diagnostic: different PNG bytes would not necessarily mean different pixels, and page state or browser rendering can change.

Run `npm run evaluate:public-source` to repeat these selected checks. The command uses separate requests for capture and DOM inspection and reports a changed upstream HTML response rather than assuming the original result still holds. Its PNG comparisons are reported separately and do not determine the association result.
