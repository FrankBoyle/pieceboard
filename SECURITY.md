# Security Policy

## Reporting a vulnerability

Please avoid posting sensitive vulnerability details or credentials in public issues. If the repository's Security page offers private vulnerability reporting, use that channel. Otherwise, open an issue requesting a private security contact without including the vulnerability details. The maintainer can then provide a suitable private channel.

## System and scope

Pieceboard is a local Node.js command-line tool that scans project source into an offline report. It can optionally fetch selected pages, render them in a Chromium-based browser, capture element screenshots, and use an explicitly supplied browser-state file. This policy covers the package, CLI, generated report, and bundled agent instructions in this repository.

## Trust boundaries

Project source, configuration, manually supplied previews, URLs, rendered page content, and imported reports or decision files may be untrusted. The person running a scan chooses which source and pages the tool may access. Authentication state, source content, generated reports, screenshots, and review reasons can contain private data.

Source-only scanning should not execute the scanned project's application code. Rendering a selected page is opt-in and runs that page's JavaScript with its normal network access; the capture browser is not a security sandbox for a hostile site. The local Git revision recorded in a report does not establish what code is deployed at the selected URL.

## Security properties

- Existing browser profiles and cookies should not be copied or used implicitly. User-provided browser state should not be embedded in reports or logs.
- Source and page content incorporated into a generated report should be treated as data, not as executable markup or script in the report.
- Explicit project scopes, source exclusions, output-file ownership checks, and symlink handling should not be silently bypassed.
- A failed or incomplete scan should not be represented as a complete, clean result. Review decisions should apply only to their matching source-anchored findings.
- Screenshot masks cover matching pixels only. They do not promise that other report text, source data, manual previews, or unmatched regions are redacted.

## Reportability and limitations

Assess potential vulnerabilities using realistic input control, reachability, and impact on project files, authentication material, reports, or the machine running the tool. No blanket finding exclusions or accepted security risks have been established. This early prototype has not received a comprehensive security review, and its UI consistency findings are suggestions rather than security guarantees.
