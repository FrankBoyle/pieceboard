# Detect spacing and brand anomalies

Pieceboard can check explicit layout rules on selected rendered elements. This complements appearance comparisons: a button can have the correct colors and still crowd its text, collide with a neighboring label, or use a recreated logo instead of the approved artwork.

The first version is opt-in. It measures configured targets rather than scraping every paragraph or guessing that every unusual layout is wrong. Findings include measured values, project requirements, manual source references when supplied, and genuine high-density previews where capture succeeds.

## Try the seeded problems

```sh
npm run demo:layout
```

Open `.ui-sheet-demo-layout/index.html`. The synthetic example includes overlapping wordmark parts, text crowded against a blue container's bottom edge, unusual word spacing, a text substitute where an image is required, and a valid approved image. It uses original demo artwork, not private application assets or uploaded documents.

## Configure a project

Add `layoutChecks` to `ui-sheet.config.json`:

```json
{
  "pages": ["http://localhost:3000/demo"],
  "layoutChecks": [
    {
      "id": "callout-clearance",
      "kind": "text-inset",
      "selector": ".district-callout",
      "min": { "left": 16, "right": 16, "bottom": 12 },
      "source": { "file": "src/Callout.jsx", "line": 20 }
    },
    {
      "id": "wordmark-gap",
      "kind": "horizontal-gap",
      "selector": ".wordmark-first",
      "otherSelector": ".wordmark-second",
      "min": 4
    },
    {
      "id": "word-spacing",
      "kind": "style",
      "selector": ".summary",
      "property": "wordSpacing",
      "min": 0,
      "max": 2
    },
    {
      "id": "approved-wordmark",
      "kind": "image",
      "selector": "#brand-logo",
      "paths": ["/assets/approved-wordmark.svg"],
      "maxAspectRatioError": 0.02
    }
  ]
}
```

Run a successful fresh capture and then check its evidence:

```sh
npx --no-install ui-sheet scan . --capture
npx --no-install ui-sheet check-layout .ui-sheet --json --fail-on-findings --strict-coverage
```

Each selector must match exactly one target. The same configured checks apply to every selected page; use a suitable project configuration and viewport for that capture. Optional `source` references are user-supplied pointers, not verified DOM/source associations. The tool does not infer which deployed revision or every code location produced the layout.

## What each check establishes

| Kind | Measurement | Example finding |
| --- | --- | --- |
| `text-inset` | Visible descendant text rectangles relative to the container's inner border edges | Bottom text clearance is below the configured 12 px minimum. |
| `horizontal-gap` | Signed horizontal gap between two elements that overlap vertically | A negative gap means their bounding boxes overlap. |
| `style` | A selected computed CSS value or supported pixel range | Word spacing is 6 px while the project allows 0–2 px. |
| `image` | Actual decoded `<img>`, approved same-origin source pathname, and rendered aspect ratio | The logo was replaced by text, uses another source path, or is stretched. Undecoded images remain incomplete. |

All geometric lengths are CSS pixels. `text-inset` measures DOM text rectangles, not exact painted glyph outlines. It considers text only; images, pseudo-elements, canvas content, shadows, and arbitrary background artwork are outside that measurement. The gap check compares element rectangles rather than individual glyphs, so overlapping glyph artwork inside a single SVG/image requires a different check.

Style rules support margin and padding sides, `rowGap`, `columnGap`, `wordSpacing`, `letterSpacing`, `lineHeight`, and `textIndent`. Use a numeric `min` and/or `max`, or an exact computed `expected` string. Ranges require resolved pixel values; unsupported values such as `normal` remain incomplete rather than being replaced with zero. CSS margin values do not establish actual element separation; use the gap rule for that.

Image source rules require an actual image and compare its loaded pathname with the explicitly approved paths. They perform no extra resource fetches. They do **not** compare asset bytes or establish that the file at the approved path remains unchanged. Approve each intended derivative or theme-specific path explicitly. Source identity, image distortion, and placement are separate questions.

## Screen and print preview

`"layoutMedia": "print"` runs the layout checks with browser print-media styles. Ordinary UI appearance captures still use screen media. The layout results record media, viewport, browser version, color scheme, and pixel ratio so their context is visible. A screen result does not validate print styling, and a print-preview result does not validate a separately generated PDF.

Direct PDF import, glyph geometry, embedded-logo verification, and mapping PDF issues back to document-generation code are planned separately. The current package does not audit an uploaded PDF. Use browser checks before export where the document originates in HTML; other PDF generators need their own adapter.

## Coverage and CI

Rules report `passed`, `finding`, or `incomplete`. Missing or ambiguous selectors, hidden targets, unsupported geometry, bounded text limits, unstable measurements, and unavailable evidence stay incomplete. Measurements are sampled twice; this is a stability check, not a guarantee against every animation or later change. Transformed or unsupported writing-mode geometry is conservative. Text measurements do not prove that another element is not covering the target.

At most 30 explicit rules run per page. Text traversal and rectangles are bounded. Up to ten real target previews are attempted, prioritizing findings; images above the size limit can fall back to 1× or be omitted. Inspect the preview's density and availability rather than assuming every measurement has a screenshot.

`check-layout` emits image-free `ui-sheet/layout-check-v1` JSON. A matched completed scan record and no incomplete rules or source warnings are required for observed coverage. Missing completion metadata is unverified. The checker reads saved evidence and cannot notice edits made after a scan.

By default, the command reports findings. `--fail-on-findings` exits 1 when a rule finds a violation. `--strict-coverage` exits 2 for partial or insufficient evidence and takes precedence. Invalid, failed, interrupted, or mismatched reports also exit 2; with `--json`, failures use `ui-sheet/error-v1` and `LAYOUT_CHECK_FAILED`. Run `check` separately for existing button/configured-family findings and `check-tokens` for source token contracts.

Rules express project intent. Intentional overlap, responsive wrapping, or a deliberate logo variant should be represented by appropriate rules and capture contexts, not automatically “fixed” to satisfy a generic aesthetic preference. This experimental feature has seeded browser tests, not representative accuracy evidence or comprehensive document-layout validation.
