# Using Pieceboard with an agent

When a user asks you to run Pieceboard, start with `docs/agent-quickstart.md` and the relevant instructions in the project being reviewed. Locate the requested project paths, choose a narrow UI source scope, and report which paths were scanned. A user asking to review UI does not necessarily ask you to change the application's code.

Run the included synthetic demo when introducing the tool. Explain where to open the generated report. A source-only scan is an inventory, not a rendering of the application. For an authorized capture, use the selected development or demo pages and a separate test account. Do not copy an existing browser profile or ask the user to paste credentials into the conversation.

Keep generated reports and browser state private and out of version control. Check the report's warnings, capture status, page, viewport, and theme; treat suggestions and source associations as leads for review. Do not claim that a source revision is deployed without separate evidence.

For changes to Pieceboard itself, use the development commands and contribution guidance in `README.md` and `CONTRIBUTING.md`.
