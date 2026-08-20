# Phase 10: Verification Runtime

Implements proposal 8 phases 5 to 14: the auditor and its rules, the content stress machinery, the
accessibility gate, the overlay, the report, and the CI gate. After this phase the design rules
fail builds instead of reviews.

## Step 1: Auditor core (`tools/audit/index.ts`)

```ts
export async function audit(options: AuditOptions): Promise<Violation[]>;
```

```
audit(options):
    await fontsReady(10_000)                 # timeout -> throw "fonts did not load"
    await settle()
    root := document.querySelector("[data-audit-root]") ?? document.body
    nodes := []
    walk(root):
        skip [hidden], display:none, visibility:hidden, zero-area
        nodes.push({ node, path: auditPath(node), rect: getBoundingClientRect(),
                     style: getComputedStyle(node) })
    auditPath(node): join of data-audit-id values from root to node, "/" separated
                     (elements without an id contribute their tag + index)

    measuring := RULES.filter(r => !r.mutates); mutating := RULES.filter(r => r.mutates)
    violations := flatten(r.check(nodes, options) for r of measuring, skipping options.skip)
    violations += flatten(r.check(...) for r of mutating)     # focus-visible runs last
    return violations.filter(v => not matchExemption(v, options.exemptions))

settle():
    await two rAFs
    running := document.getAnimations().filter(a => a.playState == "running"
                   and not under [data-audit-volatile])
    if running.length: throw "page did not settle: " + describe(running[0])

matchExemption(v, exemptions):
    for e of exemptions where e.rule == v.rule:
        if v.node matches e.selector (data-audit-id selector only):
            e.matchCount += 1
            if e.matchCount > e.maxMatches: convert to "exemption over-matched" failure
            return true
    return false
    # after the run: entries with matchCount == 0 recorded; two consecutive zero runs
    # (tracked in design/exemption-usage.json, gitignored) -> "stale exemption" failure
```

## Step 2: `tools/audit/rules/shared.ts`

```ts
export function activationRect(el: Element): DOMRect;   // rect incl. exposed padding hit area
export function scrollContainer(el: Element): Element;  // nearest scrollable ancestor
export function nearestNeighbour(el, candidates): { el; gap: number };
export function firstGlyphEdge(el: Element): number | null;
export function firstBaseline(el: Element): number | null;
export const INTERACTIVE_SELECTOR = 'a[href], button, input, select, textarea, [role="button"], ...';
```

```
firstGlyphEdge(el):
    tn := first non-empty text node in el (TreeWalker)
    if none: return null
    range := new Range(); range.selectNodeContents(tn)
    rects := range.getClientRects(); return rects[0]?.left ?? null
    # RTL: use the inline-start side based on the computed direction

firstBaseline(el): same walk, return rects[0]?.bottom ?? null
```

## Step 3: Geometry rules

Each rule module: `{ name, mutates?, check(nodes, options) }`. Tolerance = `options.tolerance`
(0.5) unless stated. Every violation fills `measured`, `expected`, `highlight`.

```
token-usage:
    for node: for prop of SPATIAL_PROPS:
        v := parse px from node.style[prop]; skip auto/percent/content-driven
        if v not in TOKEN_PX_VALUES and v != 0 and not borderException(prop):
            report(prop, v, nearestToken(v))

grid-offset:
    origins := nodes with [data-grid-origin] (+ the audit root content box as default)
    for origin: assert its own inline size is an even integer      # centring half-pixel guard
    for node (excluding subtrees under terminal/code-editor exemption ancestors):
        origin := nearest ancestor origin
        for edge of [inlineStart, blockStart]:
            off := node.rect[edge] - origin.rect[edge]
            m := ((off % 4) + 4) % 4
            if m > 0.5 and m < 3.5: report(edge, off, nearest multiple)
        blockSize check identical
    # inline extents NOT checked: content-driven width is legitimately fractional

column-edge:
    for col of nodes with [data-audit-column]:
        children := direct in-flow children
        edges := children.map(c => c.rect.inlineStart)
        modal := mode(edges rounded to 0.5)
        for c where |edge - modal| > tolerance: report(c, edge, modal)

glyph-edge:
    for col of nodes with [data-audit-column]:
        glyphs := children.map(firstGlyphEdge).filter(non-null)
        if glyphs.length < 2: continue
        modal := mode(glyphs)
        for child where |glyph - modal| > tolerance: report(child, glyph, modal)
    # the rule that catches ink scattering while boxes align; both rules run

row-axis:
    for row of nodes with [data-audit-row]:
        mode := attribute value ("center" | "baseline")
        center: block-axis rect centres equal within tolerance
        baseline: firstBaseline of each child equal within tolerance
        report the outlier and its delta
        additionally: interactive children must share one height
            heights := children matching INTERACTIVE_SELECTOR .rect.height
            if max - min > tolerance: report "mixed control heights in one row"

numeric-alignment:
    for cell of nodes with [data-audit-numeric]:
        if not style.fontVariantNumeric.includes("tabular-nums"): report
    group cells by their [data-audit-column] ancestor:
        inline-end edges must match within tolerance
```

## Step 4: Robustness rules

```
overflow:
    doc: scrollingElement.scrollWidth > innerWidth + 1 -> fatal   # the only rule at "reflow"
    element: scrollWidth > clientWidth + 1, overflow-x visible|hidden, no [data-audit-clip]
    clipping: scrollHeight > clientHeight + 1, overflow-y hidden, no line-clamp, no clip marker

collision:
    for container of [data-audit-column] + [data-audit-row]:
        pairs of in-flow children (skip position:absolute, transformed, dialog/popover subtrees):
            if rect intersection area on both axes > 0.5: report the pair

in-viewport:
    for node: rect.left < -0.5 or rect.right > innerWidth + 0.5 -> report

contrast:
    for node containing a direct text node:
        fg := style.color
        bg := walk ancestors until an opaque background-color; composite semi-transparent
              layers where alpha-resolvable; else mark "contrast-unknown"
        ratio := wcagContrast(fg, bg)
        large := fontSize >= 24 or (fontSize >= 18.66 and weight >= 700)
        required := large ? 3 : 4.5
        if ratio < required: report(ratio, required)
    for node with [data-audit-boundary]: border/outline colour vs adjacent bg >= 3
    contrast-unknown nodes: listed in the report, never silently passed

target-size (fine-pointer cells only):
    for el matching INTERACTIVE_SELECTOR, excluding inline links in prose:
        r := activationRect(el)
        ok := (r.w >= 48 and r.h >= 48)
              or (r.w >= 32 and r.h >= 32 and clearSpace(el) >= 8)
        if not ok: report

touch-target (coarse-pointer cells only):
    for el matching INTERACTIVE_SELECTOR, same prose exclusion:
        r := activationRect(el)
        if r.w < 48 or r.h < 48: report(r, "48x48")     # no clear-space branch
        n := nearestNeighbour(el, targets in the same scrollContainer)
        minGap := min(r.w, r.h, n.rect...) >= 48 ? 8 : 12
        if n.gap < minGap: report(gap, minGap)

focus-visible (mutates: true, runs last):
    for el matching INTERACTIVE_SELECTOR:
        el.focus({ preventScroll: true })
        s := getComputedStyle(el)
        if s.outlineStyle == "none": report
        else if contrast(outlineColor, adjacent bg) < 3: report
    restore original focus
```

## Step 5: Matrix specs (`tests/layout/audit.spec.ts`)

```
for cell of cells():                          # phase 7 matrix
    test(cell.id):
        { page, done } := openCell(cell)
        violations := page.evaluate(auditSource, {
            unit: 4, tolerance: 0.5,
            coarsePointer: cell.geometry.touch,
            exemptions: loadedExemptions,
            skip: cell.rules ? allRulesExcept(cell.rules) : [],
        })
        for v of violations where severity == "error":
            attach cropped screenshot of v.highlight
        expect errors to be empty
        record warnings + exemption counts into the report collector
        done()
```

`design/exemptions.json` starts with exactly the entries the design predicts: terminal surface
cell metrics and the code editor surface, each with a tight `maxMatches`. Anything else found in
the first full run is a defect to fix, not to exempt.

## Step 6: Pseudo-locale generator (`tools/i18n/pseudo.ts`)

```
generate():
    en := read frontend/src/locales/en.json
    for key, value of en:
        accented := map ASCII letters to accented equivalents, keep {placeholders} intact
        padded := accented + "~".repeat(ceil(value.length * 0.4))
        out[key] := "[" + padded + "]"
    write frontend/src/locales/en-XA.json     # gitignored, built before test runs
    languageName := "Pseudo (en-XA)"; excluded from the production selector
        (the selector filters tags starting with "en-X")
```

Run as a pretest step of `test:layout`.

## Step 7: Accessibility specs (`tests/a11y/`)

```
for cell of a11yCells():                      # every screen at phone + laptop, both themes
    { page } := openCell(cell)
    results := inject axe-core, run with WCAG 2.1 AA tags
    fail on impact in ["serious", "critical"]
    record moderate/minor into the report
```

## Step 8: Overlay (`tools/overlay/overlay.svelte`)

Mounted only in dev builds (`import.meta.env.DEV`), toggled by `Ctrl+Shift+G` (grid) and
`Ctrl+Shift+A` (audit).

```
grid layer: fixed, pointer-events none, repeating-linear-gradient every 4px,
            every 4th line emphasised (16px rhythm)
audit layer:
    run the SAME rule modules (imported, not copied) against the live DOM
    MutationObserver debounced 500 ms re-runs
    outline each violating element; side panel lists rule / path / delta;
    click logs the element to the console
pseudo-locale toggle: swap message store content in place with the generator's transform
```

## Step 9: Report (`tools/audit/report.ts`)

```
collect per run: cells, violations, warnings, exemption ledger, contrast-unknown list
write verification-report.html (single self-contained file):
    summary table by rule x severity
    per violation: rule, cell id, data-audit-id path, measured, expected, cropped screenshot
    exemption ledger with match counts and stale flags
uploaded as a CI artifact on success AND failure
```

## Step 10: CI completion

```
verify.yml final form:
    typecheck, lint:style, lint:js, unit        every push
    build frontend -> test:layout (sharded), test:a11y   every PR, both gate
    image build (phase 11 adds the Dockerfile)  every push/PR, push to GHCR only on push
labeler: PR touching design/exemptions.json gets an "exemptions" label
```

## Tests for the tools themselves

```
- each rule: a minimal HTML fixture that violates it and a sibling that passes
  (rules are pure functions over measured nodes; test in a headless page)
- glyph-edge: the proposal's own counterexample: boxes aligned at 12, ink at 12/24/40 -> fires
- touch-target: 40px button in a coarse cell -> fires; same in a fine cell -> target-size
  path allows it with clear space
- exemption machinery: over-match fails, stale detection across two simulated runs
- pseudo-locale: placeholders survive, length >= 140%
```

## Done checklist

- [ ] Full matrix green on the phase-9 screens, with an exemption ledger containing only the
      terminal and editor entries.
- [ ] Intentionally breaking a screen (14px padding, a 36px button, ink off column) fails the
      correct rule with a usable report entry and screenshot.
- [ ] `test:a11y` green at serious+ across the matrix.
- [ ] Overlay and CI import the same rule modules (assert by module identity in a unit test).
- [ ] Report artifact present on both a passing and a failing CI run.
