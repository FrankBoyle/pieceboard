# Independent accessibility review

Reviewed 2026-11-04 by a second coding agent, independently of the implementation agent and the repository's existing accessibility test. This is an automated and keyboard-driven browser review with screenshot inspection. It is not a human accessibility audit, screen-reader test, or assistive-technology certification.

**Outcome:** Three initial issues were reported, repaired by the implementation agent, and resolved in a targeted fresh-page recheck. No unresolved defect was found within the tested scope. This limited result does not establish full accessibility conformance.

## Scope and method

Only the newly generated synthetic report `.ui-sheet-demo-consistency/index.html` was opened. No private project report, other `.ui-sheet-lab` report, or real application UI was opened or operated. The report's embedded preview images are evidence about the synthetic fixture; their depicted controls are not interactive controls in this report.

Initial report SHA-256: `bd262b9283b88533b599ceae03370f7b29786fecae382ab16395f39f56dfcd9d`. Repository HEAD at review: `8ab0e0d641350c0074d0ee882590fb2f4efdf129`. Generated timestamp shown by the report: `2026-11-04T10:06:14.389Z`.

Finite, separately authored Playwright scripts used installed Microsoft Edge `156.0.4314.58`, headless, through `file:` navigation. No existing repository accessibility test was run as this review. Tests used Tab, Shift+Tab, Enter, Space, arrow keys, Escape, PageDown, and the slash shortcut; DOM inspection read state, names, geometry, and contrast. Supplemental axe-core sweeps covered WCAG A/AA tags on the initial desktop, open review form, 400px viewport, and open dialog states. Screenshots of the narrow layout, focused navigation, dialog, expanded image capture, and zoom/reflow layouts were inspected.

Viewports were 1280×900, 400×900, and 640×450. The 640×450 viewport checks the layout space equivalent to a 1280×900 browser at 200% zoom; a separate CSS `zoom: 200%` pass checked enlarged text and controls. These are emulations, not an assertion that Edge's native browser zoom UI was exercised.

## Initial findings, subsequently fixed

### A11Y-01 — Numeric type counts have insufficient contrast

**Moderate; confirmed in the initial report.** Inactive `.type-count` text is 10px and has `opacity: 0.72`. The inherited `#4e6855` therefore composites to approximately `#809285` on white, producing **3.29:1** contrast. These digits communicate available item counts and need the normal-text 4.5:1 contrast level. The visible “Buttons 5” count demonstrates that this also affects a populated filter, not just zero-result options.

To reproduce, open the report, inspect an inactive UI-type chip count, and compare its rendered foreground/background colors. Axe reports these single-character nodes as **incomplete** (`shortTextContent`), so its zero-violation summary does not resolve this issue. Remove the count opacity or use a sufficiently dark count color, then verify both selected and unselected chips.

### A11Y-02 — Light focus outlines have insufficient contrast on light panels

**Moderate; confirmed in the initial report.** The authored `3px solid #74ab8c` focus outline measures **2.64:1** against white, **2.48:1** against the page background `#f7f8f5`, and **2.53:1** against `#f8fbf7` form panels. This is below the 3:1 non-text contrast level for an authored focus indicator.

To reproduce, Tab to an inactive UI-type chip, a decision field, or an inventory card. The outline appears and keyboard focus is otherwise retained, but its contrast is weak. Use a darker outline on light surfaces; retain adequate contrast on the dark sidebar and green selected controls.

### A11Y-03 — Narrow navigation clips its outer focus outline

**Low; confirmed visually at 400px.** Tab to “Other tokens” in the horizontal navigation. The browser scrolls the button fully into view, but the overflowing navigation clips the outside focus ring, leaving mainly its left edge visible. The last button ends at x=382 and its outline extends beyond the navigation's right edge. Top/bottom portions are clipped too.

Content and the button remain reachable, so this is a focus-visibility improvement rather than a keyboard blocker. Reserve space for the outline within the scrolling navigation or use an inset focus treatment, then inspect the first and last buttons again.

## Verification after repair

The implementation agent regenerated the same permitted synthetic report after changing its report CSS. The final targeted recheck ran at `2026-11-04T12:36:21Z`; final report SHA-256: `d901b3bd746382730a91a3efd681d6107c24f85af65c71edb13f1b65b0fa16b0`.

| Finding | Fresh-page observation | Result |
| --- | --- | --- |
| A11Y-01 | Inactive count opacity is now `1`; `#4e6855` on white measures **6.11:1**. The targeted axe color-contrast sweep found zero violations and no count-related incomplete nodes. | Resolved |
| A11Y-02 | Search now computes the darker `#28563a` outline, measuring **8.46:1** against white and **7.94:1** against the page. Sidebar focus uses `#b8e8ca`, measuring **11.07:1** against its dark background. | Resolved |
| A11Y-03 | At 400px, first and last navigation buttons use `outline-offset: -3px`. Their entire inset rings are visible in inspected screenshots. The selected mobile button uses a dark `#28563a` ring against `#d5ead9`, measuring **6.69:1**. | Resolved |

The first targeted recheck caught an explicit search outline override that still used the old color. It also prompted verification of the selected mobile button, whose pale background required a dark inset outline. Both states were corrected before the final observations above. The targeted follow-up did not repeat all previously successful workflows.

## Results that passed

| Area | Observed behavior |
| --- | --- |
| Skip navigation | The first Tab exposes “Skip to main content”; Enter focuses the main region. |
| Category/type filters | Enter and Space activate native buttons, update `aria-pressed`, retain focus after re-render, and update the result count. |
| Search | The named “Search the sheet” searchbox filters results, preserves focus, exposes an empty state, and updates an `aria-live="polite"` count. `/` focuses search outside text controls and remains literal text inside the reason field. |
| Details dialog | A card opens a named native modal dialog. Close receives initial focus; background controls are not reached while it is open. Escape and the named close button close it and return focus to the triggering card. PageDown scrolls its long content. |
| Decision form | Keyboard expansion exposes a “Decision” combobox, “Reason” textbox, and “Queue decision” button with accessible names. A blank reason produces status feedback; a valid reason queues the selected decision and exposes confirmation. |
| Image zoom | Keyboard expansion exposes a named range control. ArrowLeft changes the displayed zoom from 200% to 199%. At 400px the tested capture fit its scroll area (304px client/scroll width), so horizontal capture scrolling was not exercised by this fixture. |
| 400px reflow | Document width remained 400px with no page-level horizontal overflow. The horizontal navigation scrolled to focused offscreen filters. The dialog fit within the viewport and its close button remained visible. |
| 200% equivalent reflow | At 640×450, document width remained 640px. Search and the expanded decision form's queue button scrolled into view and remained operable. |
| CSS 200% enlargement | Text and controls enlarged; search remained visible and focusable. This supplemental pass does not substitute for native browser-zoom testing. |

The four supplemental axe sweeps returned **zero reported violations**, with 23, 27, 24, and 21 passing rules respectively. Contrast remained incomplete for 20 desktop nodes, 20 open-form nodes, 16 narrow nodes, and one dialog node. Inspection identified the count contrast defect above. Most other desktop incompletes were decorative glyphs. The dialog incomplete was the “×” close icon: its measured contrast was 3.38:1, and it has the accessible name “Close details.”

The initial keyboard run completed without page JavaScript errors. A supplemental probe initially assumed a horizontally overflowing capture; measured dimensions showed no overflow in this fixture, and the corrected run completed. A separate contrast probe was corrected to use an explicit Playwright browser context before its successful run.

## Limits and cleanup

Import/download file-picker workflows, other report datasets, other browsers, touch input, forced colors, native 200% browser zoom, and screen-reader announcements were not verified. Live-region attributes and accessibility-tree names were inspected; actual spoken output was not tested. The three initial findings were sent to the implementation agent, repaired, and rechecked against the regenerated report as described above.

All review browser instances were closed in `finally` blocks and all finite scripts exited. A process check confirmed the recorded review browser PIDs, including the final recheck browser, had exited. No server or watcher was started. Existing user/application processes, another active task's Playwright browser, and Codex connectors were left running. A read-only connector audit identified one pre-existing stale candidate; no connector cleanup was performed.
