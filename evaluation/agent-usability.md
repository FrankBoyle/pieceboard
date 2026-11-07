# Second Codex coding-agent exercise

On 2026-11-04, a fresh Codex subagent read `README.md` and
`skills/ui-consistency/SKILL.md`, then exercised the documented workflow without
reading implementation files. This is one directed coding-agent exercise on a
synthetic project, not a Claude evaluation, human user study, or accuracy estimate.
The installed skill was read manually; new-session skill discovery was not tested.

Environment: Windows, PowerShell, Node v22.23.1, local UI Sheet checkout
(`0.1.0-alpha.0`, working tree rather than an immutable release), installed Edge
Chromium 156.0.4314.58. Captures used the defaults: 1440 × 900, light, 2×.

## Reproduction

Create a new temporary project with a private `package.json`, `index.html`, and
`styles.css`. Keep each button on its own line:

```html
<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><title>Agent UI practice</title><link rel="stylesheet" href="styles.css"></head>
<body>
<main><h1>Project actions</h1>
<button id="save-project" class="button primary" data-ui-sheet-group="project actions" data-ui-sheet-variant="primary">Save project</button>
<button id="save-draft" class="button primary" data-ui-sheet-group="project actions" data-ui-sheet-variant="primary">Save draft</button>
<button id="save-template" class="button primary" data-ui-sheet-group="project actions" data-ui-sheet-variant="primary">Save template</button>
</main>
</body></html>
```

```css
:root { --action-color: #2463cf; --action-radius: 6px; }
body { font-family: Arial, sans-serif; background: white; color: #17202a; padding: 32px; }
.button { background: var(--action-color); color: white; border: 1px solid #16468f; border-radius: var(--action-radius); padding: 10px 18px; font: 600 16px Arial, sans-serif; }
```

From that project, run the following, substituting the checkout path:

```powershell
npm install --save-dev "C:\path\to\pieceboard"
npx --no-install ui-sheet install-skill --agent codex
npx --no-install ui-sheet init
```

Set the generated config's `include` to `["index.html", "styles.css"]`. Run:

```powershell
npx --no-install ui-sheet scan . --out .ui-sheet-source
npx --no-install ui-sheet catalog .ui-sheet-source --kind components --search button
npx --no-install ui-sheet check .ui-sheet-source --json
```

Serve the two fixture files on a local HTTP server, set `pages` in the config to
its URL, and keep that URL/server unchanged for all three capture states. The
exercise used a tiny task-owned Node HTTP server bound to `127.0.0.1` with an
automatically assigned port; it served only `/` and `/styles.css`.

```powershell
$browser = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
npx --no-install ui-sheet scan . --capture --browser $browser --out .ui-sheet-baseline
npx --no-install ui-sheet check .ui-sheet-baseline --json
npx --no-install ui-sheet appearances .ui-sheet-baseline --page 1
npx --no-install ui-sheet baseline .ui-sheet-baseline --file ui-sheet.baselines.json --observation button:0 --page 1 --reason 'Synthetic evaluation: approve the six pixel radius shared primary action'
```

Add `style="border-radius: 24px"` to `save-template`, then run:

```powershell
npx --no-install ui-sheet scan . --capture --browser $browser --baseline ui-sheet.baselines.json --out .ui-sheet-inconsistent
npx --no-install ui-sheet check .ui-sheet-inconsistent --previous .ui-sheet-baseline --json --fail-on-new
npx --no-install ui-sheet locations .ui-sheet-inconsistent --family "project actions" --variant primary
```

Remove the override and add a fourth button, `save-copy`, with the same classes,
group, and variant. Capture and check it:

```powershell
npx --no-install ui-sheet scan . --capture --browser $browser --baseline ui-sheet.baselines.json --out .ui-sheet-consistent
npx --no-install ui-sheet check .ui-sheet-consistent --previous .ui-sheet-baseline --json --fail-on-new --strict-coverage
```

## Observed results

| Step | Native exit | Result |
| --- | --- | --- |
| Install, skill install, init | 0 | All succeeded without implementation knowledge. |
| Source scan/catalog | 0 | Five items across two files; button entry had three correct source locations and no preview. |
| Source-only `check --json` | 2 | Plain-text error asking for a captured scan; no JSON. |
| Captured baseline | 0 | Three eligible buttons, `scanStatus: completed`, `coverage: observed`, zero findings. |
| Seeded radius change with `--fail-on-new` | 1 | Exactly one new actionable finding, approved reference, all four corners `6px` versus `24px`, likely source `index.html:8`, unique ID `save-template`. |
| Restored style plus matching fourth button | 0 | Four eligible buttons, applied baseline, observed coverage, zero findings and `no-new-findings`, including strict coverage. |

Catalog, appearance, location, and check outputs were compact enough to use without
loading screenshot data. No false finding occurred in the matching addition, and
the seeded measured-property regression was found. These are two controlled cases
with explicit groups and unique IDs; they do not establish general reliability.

One usability issue was observed: `check --json` on a valid source-only report
returned only `UI Sheet: The report has no button consistency analysis. Run a
captured scan first.` Both `npx` and direct `node <checkout>/bin/ui-sheet.js`
reproduction had native exit 2. The initial tool wrapper displayed exit 1; explicit
`$LASTEXITCODE` inspection corrected that observation. This is an error-output
contract issue for JSON consumers, not a clean consistency result. The observation
records the tested behavior before any subsequent fix.

Raw error output, explicit exit-code records, fixture files, and successful/new
finding check JSON were preserved only in ignored
`.ui-sheet-lab/agent-usability-20261104/`. Existing reports and application projects
were untouched. The task-owned server was stopped, all capture commands exited,
and the final process audit found no task-owned process or remaining Edge process.
The connector audit was read-only; unrelated processes were left running.

Temporary-artifact cleanup was blocked by the environment's approval policy;
the retained path and junction caution are recorded in an ignored local cleanup
note. No cleanup workaround was attempted.

## Source-token exercise with stale and incomplete evidence

A separate fresh Codex agent exercised the new token workflow on 2026-11-04,
using the bundled skill, README, token documentation, CLI help, and two synthetic
projects. It did not read implementation or tests. This was a working-tree
exercise of the token-contract change, not an immutable published release,
automatic skill-discovery test, Claude evaluation, or accuracy estimate.

Both projects approved `theme.css` → `:root` → `--control-radius: 8px`, with an
unapproved dark selector defining `6px`. In Cedar, the saved completed report
still contained `8px` after source changed to `3px`. The agent inspected current
code, regenerated the source report, and found one changed approved declaration
with observed coverage and exit 1. In Maple, an existing scan included only HTML;
the checker reported one unscanned scope and partial coverage. After including
the CSS in a fresh scan, the agent obtained one match and observed coverage.
Neither project's separate dark definition was treated as a violation.

The agent preserved source and baseline hashes and created only fresh ignored
reports. An apparent exit-status discrepancy came from the PowerShell tool
wrapper: direct Node child-process verification confirmed strict partial coverage
exits 2 as documented. No CLI defect was established in this exercise. The saved
report limitation remains: the checker does not detect source edits made after a
scan. Successful rescanning and respecting incomplete evidence are essential to
the workflow; these two directed cases do not establish reliable behavior across
agents or projects. Raw observations are retained only under ignored
`.ui-sheet-lab/token-agent-validation/`. No server or browser was needed.
