# Separately authored synthetic button evaluation

This set was authored by a second software agent on 2026-11-04, before that agent saw any predictions for the set. It contains 47 scenarios: 40 scored cases (22 positive and 18 negative), plus 7 unscorable diagnostics. The scored fixtures contain 208 button records, including 28 labeled defective controls; the complete set contains 239 records. These are authored records, not claims about capture eligibility.

The author read only the project README, evaluation README, and browser fixture/scoring adapter for context and format. Those documents expose current behavior and previous aggregate failures. The author did not read the detector implementation, existing case JSON, or predictions for this set. A second agent is separate authorship, not an independent human evaluator, a blind study, or an external representative sample. No human has reviewed these labels.

## Label rules

A scored case states its design requirement in its description. Every zero-based index in `expected` violates that requirement in the requested observed context. Every other control in that scored case is acceptable in that context. The labels reflect authored intent rather than whichever appearance is most common. Repeated defective instances each count as positives.

Requirements in descriptions belong to the evaluation oracle; they are not additional machine-readable rules supplied to the detector. The wrong-majority, equal-frequency, two-control, and approved-unmarked-exception cases deliberately expose the limits of inferring intent from appearance. Opacity, letter spacing, and blur cases remain scored even if the implementation does not support those properties. Do not silently remove these cases from the overall result. Any narrower supported-scope result must name its inclusion rule and report the excluded cases separately.

Cases with `scoring: "unscorable"` have no established correctness oracle for the full review question. Their empty `expected` arrays are required format placeholders, not negative labels. Exclude all seven cases from precision, recall, false-positive, and false-negative denominators; preserve their observations as diagnostics. These cases cover uncertain family assignment, unknown minority intent, unknown two-control references, tied appearances, offscreen coverage, unvisited hover, and local theme context.

## Fixture contract

Use the existing base button CSS and one button per generated source line. This JSON adds declarative fields that the original fixture adapter does not implement:

- Serialize every `button.group` and `button.variant` as `data-ui-sheet-group` and `data-ui-sheet-variant`. These are supplied comparison hints, not evidence that the grouping is objectively correct.
- If the `pressed` property exists, emit `aria-pressed="true"` or `aria-pressed="false"`, including false. The toggle case needs both states to be represented.
- Default to a 1280 by 900 CSS-pixel viewport, light preference, and 2x pixel ratio. Apply a case's `viewport` or `colorScheme` override before loading it.
- Start the pointer at 0,0, away from the controls. Apply `interactions` in order after load using the zero-based button index: `focus` means programmatic focus and `hover` means moving the pointer over that control.
- Verify each requested state immediately before observation: the expected active element for focus and `:hover` membership for hover. A failed setup is a harness error, not a detector miss. Keep that state through observation. No controls are clicked or submitted.
- Score every occurrence of a reported defective appearance. Retain button indexes, setup results, context, source association checks, and representative-preview counts separately from accuracy.

The two mixed-state positives each have one idle defect at index 3 and an intentionally hovered or focused control at index 4. A runner that ignores interactions would not exercise the intended state boundary. The dark/light pair and mobile/desktop pair use identical CSS within each pair, with different requested browser contexts.

## Freeze and reporting

Freeze this JSON and this review in a commit before the first detector run. Record that commit, both SHA-256 hashes, the evaluated detector revision, actual Chromium version, capture contexts, and run timestamp with the result. The parent agent will record the hashes externally after these files are written; hashes cannot be self-contained in the files they hash.

No detector has been run by this author, and there are no scores in this review. After the freeze, do not change a label to match a prediction or tune the detector against this set while continuing to call it held out. Report every scored case's expected and predicted indexes and its false positives and false negatives. Preserve the original frozen result when later development uses these failures. A correction to a genuine fixture mistake requires a new version with its reason and both old and new labels retained.

## Limits

The pages are synthetic and static apart from explicitly requested pointer/focus state. They do not sample real application repositories, component distributions, authenticated flows, asynchronous loading, nested containers, iframes, shadow DOM, visual overlays, transitions, or keyboard-driven focus-visible behavior. Programmatic focus tests `:focus`; it does not prove keyboard accessibility.

The dark case exercises a CSS response to browser color preference. It does not switch an application's theme, establish the correctness of an embedded theme, or compare the same control across theme sessions. The narrow case exercises one 390 by 844 viewport, and the wide case one 1280 by 900 viewport. No general responsive-coverage conclusion follows. The unvisited-hover and below-fold diagnostics explicitly leave those coverage questions open.

The fixture makes source association easy with unique IDs and known source lines. Report association results as a separate synthetic harness check. Preview presence does not establish screenshot readability or the correct deployed source revision. Precision and recall on this finite authored set describe only this set, its frozen labels, the recorded contexts, and the evaluated detector revision; they do not establish product-wide accuracy.
