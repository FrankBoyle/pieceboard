# Data handling and tested limits

Pieceboard runs locally. Source-only scanning does not execute the scanned application's JavaScript or PHP. Rendering is explicit and runs the selected page's JavaScript with normal page network access. A capture browser is not a sandbox for hostile application code.

| Surface | What can be retained | Limits |
| --- | --- | --- |
| Selected source | Paths, definitions, usages, static text, CSS values, fonts, and small image assets | Include/exclude rules reduce reading; references in other selected files can still disclose excluded names or values. |
| Rendered controls | Real PNG pixels, labels/source clues, measured styles, and observed semantic state | Inputs' ordinary values are not used as state metadata. Visible values can still appear in screenshots, and labels or other report fields can contain private text. |
| Browser state | An explicitly supplied local state file is used by an isolated session | Existing user profiles are not copied automatically. State is not embedded in report data, but the page can use it normally. Protect the state file separately. |
| Resource styles | Supported gradients and filters, plus ordinary measured properties | Background-image resource URLs and resource-based filters are excluded before measurement data reaches Node. Source-derived CSS values, assets, screenshots, and other fields are separate surfaces. |
| Screenshot masks | Matching element pixels are replaced in automatic captures | Masks do not redact source text, labels, surrounding content, manual images, or regions missed by the selector. |
| Compact queries/reviews | Source paths, measured values, counts, reasons, and context | Queries omit image payloads. A JSON schema validates shape, not privacy or permission to share. |
| Scan progress | Requested-page count, completed phase indexes, active/failed page and phase | Progress stores no URLs, cookie values, source content, or page error strings. |

`test/privacy.browser.test.js` exercises synthetic cookie/local-storage/query canaries, resource background/filter URLs, input values, and masked screenshots. Supplied browser state is actually used; the canary strings do not enter the resulting measured report data. Changing a masked synthetic field value leaves its PNG bytes unchanged. Separate tests cover source exclusions, authentication-state validation, source-only operation without network/AI credentials, and safe report serialization.

These finite synthetic checks are not a comprehensive privacy or security audit. They do not establish that an arbitrary application or manually supplied image is free of sensitive information, that a page makes no network requests, or that masks find all sensitive regions. Inspect generated HTML/JSON, screenshots, exported review reasons, and source details before sharing them. Keep generated reports, browser state, and private fixtures out of public version control.
