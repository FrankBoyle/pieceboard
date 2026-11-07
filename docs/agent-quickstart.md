# Run Pieceboard with a coding agent

This guide is for someone who wants an agent to clone Pieceboard and run a UI review. It also works if the agent is already in a Pieceboard checkout. Node.js 22 or newer and Git are required; no AI API key is required by Pieceboard.

Tell the agent which project or projects to inspect and the UI journey that matters. For example:

> Set up Pieceboard from its repository and show me the included demo. Then review the relevant UI source in my project or projects. Start with a narrow source inventory and tell me where to open the report. If I provide an authorized demo page, capture it and explain what was and was not observed. Use a separate test account and let me sign in myself. Do not change my application code unless I ask.

The agent should inspect project instructions and reuse existing checkouts when available. If a needed path, test URL, or test-account access cannot be determined, it should ask for that detail. It should not assume that a public website or its signed-in data is available for capture.

## 1. Set up the checkout and see the demo

In a terminal, or with help from the agent:

```sh
git clone https://github.com/FrankBoyle/pieceboard.git
cd pieceboard
npm ci
npx playwright install chromium
npm run demo:consistency
```

Open `.ui-sheet-demo-consistency/index.html` in a browser. The report shows a synthetic button comparison with real browser captures. The demo starts a temporary local server and closes it after creating the report. If the browser cannot be installed, `npm run demo:inventory` creates a source-only example at `.ui-sheet-demo/index.html` without a browser download. See the [README](../README.md#try-the-example) for other demos and an installed-browser option.

The commands below run from the Pieceboard checkout. They use `node bin/ui-sheet.js`, so Pieceboard does not need to be installed as a dependency in the project being reviewed. Quote paths containing spaces.

## 2. Inventory the requested UI source

Replace the project path and `src` with existing paths in the project:

```sh
node bin/ui-sheet.js scan /path/to/project --include src --out .ui-sheet-lab/my-project
```

Open `.ui-sheet-lab/my-project/index.html`. Add `--include` for each relevant source or style directory. Includes are existing paths relative to the project root, not glob patterns. Use a narrow scope and include the styles and assets needed for the review. This scan reads source; it does not sign in, execute the application, or show how a current page renders.

To inventory UI source from two local repositories in one report, use their common parent as the scan root and include only the relevant paths:

```sh
node bin/ui-sheet.js scan /path/to/workspace --include project-one/src --include project-two/src --out .ui-sheet-lab/joined-source
```

Replace the example paths with the actual relative paths. You can instead run a separate scan for each repository. A combined report does not record a separate Git revision for each nested repository: record each checkout's commit and working-tree status separately, and do not treat either commit as proof of the deployed website revision.

## 3. Capture an authorized test page

Capture renders the selected page, runs its JavaScript, and makes its normal network requests. Use a development or demo environment and synthetic data. For a page accessible without sign-in, add `--page` and `--capture` to a scan, keeping the same source scope:

```sh
node bin/ui-sheet.js scan /path/to/project --include src --page http://localhost:3000/ --capture --out .ui-sheet-lab/my-project-capture
```

For a signed-in demo, run the following in an **interactive terminal**. A separate browser opens; the person operating the account signs in there, returns to the requested page, and presses Enter in that terminal:

```sh
node bin/ui-sheet.js auth --url https://demo.example.com/dashboard --out .ui-sheet-auth/demo-state.json
```

Then supply that state for a capture of the same authorized site:

```sh
node bin/ui-sheet.js scan /path/to/project --include src --page https://demo.example.com/dashboard --capture --storage-state .ui-sheet-auth/demo-state.json --out .ui-sheet-lab/my-project-capture
```

The state file can contain credentials; keep it private and never commit or share it. It is not copied from an existing browser profile. Some session-storage-only or multi-origin sign-ins cannot be restored this way. If the page redirects, requires an interaction, or does not show the intended signed-in view, do not describe the capture as successful; inspect the warnings and use the documented [manual screenshot workflow](../README.md#add-screenshots-from-a-signed-in-session) if appropriate. Pieceboard does not automatically click through workflows or inspect content inside embedded frames.

## 4. Review together

- Open the report's `index.html`, read its warnings and captured-page context, and browse the relevant UI type. Use **Possible button differences** and **Browse observed button appearances** when available.
- Compare the same control or destination in the same role, state, theme, and viewport. A suggested difference or a source association is a lead; a common appearance is not automatically the right choice. Non-button comparisons need explicit configured groups.
- Multiple `--page` options put selected pages in one report, but ordinary checks analyze each page separately. Cross-page button checks need explicitly configured comparable groups and sufficient observations; they are not automatic comparison of two arbitrary sites.
- Record the user's decisions and any missing evidence. Review report HTML, JSON, screenshots, paths, and notes before sharing. The `.ui-sheet-lab/` and `.ui-sheet-auth/` directories are ignored in a Pieceboard checkout; outputs stored elsewhere need their own protection.

For future UI changes in an application where Pieceboard is installed, the optional [agent skill](../skills/ui-consistency/SKILL.md) adds a reusable before-and-after workflow. Installation of that skill is separate from running this checkout.
