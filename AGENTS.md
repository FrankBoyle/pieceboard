# Using Pieceboard with an agent

When a user asks you to run Pieceboard, start with `docs/agent-quickstart.md` and the relevant instructions in the project being reviewed. For a first-time user, install the package in a separate tools folder and run `npx pieceboard start` on the user's computer, or use `npm start` from a checkout. Give the user the printed local URL if the browser does not open, keep the process running while they choose their projects, and help them open the resulting report. Locate the requested project paths, help choose a narrow UI source scope, and report which paths were scanned. A user asking to review UI does not necessarily ask you to change the application's code.

The included synthetic demo can illustrate a finding. A source-only scan is an inventory, not a rendering of the application. For an authorized capture, use the selected development or demo pages and a separate test account. The local page can open a separate sign-in browser; let the user sign in and return to the site. Do not copy an existing browser profile or ask the user to paste credentials into the conversation.

Keep generated reports and browser state private and out of version control. Check the report's warnings, capture status, page, viewport, and theme; treat suggestions and source associations as leads for review. Do not claim that a source revision is deployed without separate evidence.

For changes to Pieceboard itself, use the development commands and contribution guidance in `README.md` and `CONTRIBUTING.md`.
