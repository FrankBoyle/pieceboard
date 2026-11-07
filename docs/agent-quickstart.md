# Run Pieceboard with a coding agent

This guide is for someone who wants an agent to clone Pieceboard and run a UI review. It also works if the agent is already in a Pieceboard checkout. Node.js 22 or newer and Git are required; no AI API key is required by Pieceboard.

Tell the agent which project or projects to inspect and the UI journey that matters. For example:

> Set up Pieceboard from its repository and start its local page on my computer. Help me choose the projects and the UI source I want to review, then walk me through the sheet. If I provide an authorized demo page, capture it and explain what was and was not observed. Use a separate test account and let me sign in myself. Do not change my application code unless I ask.

The agent should inspect project instructions and reuse existing checkouts when available. If a needed path, test URL, or test-account access cannot be determined, it should ask for that detail. It should not assume that a public website or its signed-in data is available for capture.

## 1. Set up the checkout and open the start page

In a terminal, or with help from the agent:

```sh
git clone https://github.com/FrankBoyle/pieceboard.git
cd pieceboard
npm ci
npx playwright install chromium
npm start
```

Pieceboard opens a browser page on `127.0.0.1` and prints its local address in the terminal. Keep that process running while the person uses the page. If the browser does not open, open the printed address manually. Use `npm start -- --workspace /path/to/projects` to start in a particular folder, or `npm start -- --no-open` to print the address without opening a browser. A compatible installed browser can be selected for sign-in and captures with `npm start -- --browser "/path/to/browser"`. Press Ctrl+C after the review; completed reports remain in `.ui-sheet/launcher-runs/`.

On the page, find the folder containing the projects, select the repositories, and optionally enter existing source paths within each one. The list shows Git repositories directly inside the chosen folder, plus the folder itself. Add an authorized test-page URL for screenshots, or create a source-only inventory. To sign in, select **Open test sign-in**, sign in yourself in the separate browser, return to the test site, and choose **I’m signed in** in the launcher. If bundled Chromium cannot open, Pieceboard tries a compatible installed browser in a fresh profile and identifies it on the page. Browser state is stored in `.ui-sheet-auth/`; protect it like a credential. If a sign-in flow cannot be restored or the page redirects, inspect the warning and use the manual screenshot workflow described below. The launcher does not automatically inspect embedded frames or navigate through an entire workflow.

If the browser cannot be installed, the start page can still create a source-only inventory. The synthetic button demo is also available with `npm run demo:consistency`; open `.ui-sheet-demo-consistency/index.html`. See the [README](../README.md#try-the-example) for other demos and an installed-browser option.

The command-line alternative below runs from the Pieceboard checkout. It uses `node bin/ui-sheet.js`, so Pieceboard does not need to be installed as a dependency in the project being reviewed. Quote paths containing spaces.

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
