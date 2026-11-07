# Contributing

Pieceboard is an early prototype. Small, well-scoped changes with evidence are especially helpful. Please read [the project plan](PROJECT_PLAN.md) for the current goals and limitations before starting substantial work.

## Development setup

Use Node.js 22 or newer and a recent npm:

```sh
npm ci
npx playwright install chromium
npm test
npm run test:package
npm run evaluate:buttons
```

The test suite uses a local synthetic web server and closes it when the test finishes. Set `UI_SHEET_TEST_BROWSER` to a compatible Chromium-based browser executable if you prefer an already installed browser. Browser tests are skipped when neither that variable nor Playwright Chromium is available; install a browser before considering the full suite verified.

Routine GitHub Actions pushes and pull requests run the full browser suite and package check once on Ubuntu/Node 24, plus a short Windows/Node 24 scan-status and Vite capture smoke. To qualify a release across Node 22, 24 and 26 on both systems, start the CI workflow manually with **full_matrix** enabled. The full Windows suite runs serially to avoid unrelated browser processes competing on a runner. CI only tests Pieceboard; it does not deploy a website.

Run `npm run demo` for real captures of synthetic fields, tabs, dropdowns, selectors and actions, or `npm run demo:consistency` for the smaller button report. `npm run demo:inventory` is the source-only example with supplied SVG illustrations. Generated reports are ignored by Git. Use `npm run screenshot:demo` after the button demo, or `node scripts/export-demo-image.js --elements` after the default demo, to refresh the corresponding synthetic README images.

## Making a change

- Explain the user-facing problem, the expected behavior, and any important tradeoffs.
- Add a focused fixture or test when behavior changes, including intentional variants or incomplete evidence where relevant.
- Preserve the distinction between measured values, inferred grouping, possible source matches, and approved conventions.
- Keep browser interaction opt-in. Do not submit forms, collect private browser state, or upload project data as part of a scan.
- Update the README and project plan when supported behavior or limitations change.
- Run the relevant tests and report any skipped browser checks or remaining limitations in the pull request.

Use synthetic data in fixtures, screenshots, issues, and pull requests. Do not include credentials, browser state files, or real user records.
