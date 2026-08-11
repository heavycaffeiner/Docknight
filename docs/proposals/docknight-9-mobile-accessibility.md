# Mobile Accessibility and Compact Layout - Spec Proposal

| Item       | Detail                           |
|------------|----------------------------------|
| Author     | heavycaffeiner(Dong Hyun Kim)    |
| Created    | 2026-08-11                       |
| Status     | **Draft** / In Review / Approved |
| Reviewers  |                                  |

---

## 1. Summary

Docknight renders on a phone, and every rule in proposal 8 passes when it does. It is still unusable
there. This proposal states why the two facts are compatible, and specifies the layout, density,
disclosure, and keyboard changes that fix it without splitting the interface into a desktop design and
a separate mobile design.

The central claim is that the compact layout is not a smaller copy of the expanded one, and the
current stylesheet treats it as exactly that: same controls, same disclosure, same information
architecture, one density step down. Touch needs the opposite of a density step down, and a 390 pixel
column needs a different disclosure policy rather than a narrower version of the same one.

Everything below is measured against the built frontend and the `typical` fixture at 390x844, which is
an iPhone 15 class viewport, unless a different size is named.

## 2. Background & Motivation

### 2.1 What the verification suite does not look at

`tests/support/matrix.ts` samples six widths: 320, 360, 600, 840, 1280, 1920. `tests/support/harness.ts`
line 35 sets the viewport for every one of them:

```ts
await page.setViewportSize({ width: cell.width, height: 900 });
```

Height is a constant. No cell in the matrix has ever rendered a phone. A 360 pixel wide window that is
900 pixels tall is a narrow desktop window, and a narrow desktop window is driven by a mouse, has no
virtual keyboard, and has 900 pixels of vertical room. All three assumptions are false on the device
the width was chosen to represent.

Nothing in the matrix emulates a coarse pointer either. Playwright's `hasTouch` is unset, so
`pointer: coarse` never matches and no rule has ever asked whether a target is large enough for a
thumb rather than a cursor.

This is the root cause of the gap between "the audit is green" and "the phone is unusable". The suite
is well built and the rules are correct. It is sampling the wrong space.

### 2.2 Density runs the wrong way

`frontend/src/styles/tokens.css` line 78:

```css
@media (width < 600px) {
    :root {
        --m3-util-density: -1;
        --size-control-md: 36px;
    }
}
```

m3-svelte 5.15.5 draws its default button at `calc(2.5rem + var(--m3-util-density-term))`. One density
step is 4 pixels, so the same button is 40 pixels tall on a desktop and 36 pixels tall on a phone.

Measured on the stack screen in edit mode, the icon buttons inside `ArrayInput` are 40x40 at 1280 and
40x36 at 390. The controls shrink on the only input modality that needs them to grow.

The token file states the reason: comfortable sizing "held in one hand leaves a screen showing six rows
of content". The observation is right and the remedy is wrong. The way to fit more on a phone is to
show fewer controls, not smaller ones.

### 2.3 Measured density of the compact screens

Every visible control matching `a[href], button, input, select, textarea, [role="button"]`, counted at
390x844 against the `typical` fixture. The 44 pixel column is the WCAG 2.5.5 and Apple HIG figure,
used here because it is the widest-agreed number to count against. It is not the target this proposal
adopts, which is 48 and is argued in 4.1.

| Screen                | Controls | Below 44px on an axis | Below the fold | Outlet scroll / window | Screenfuls |
|-----------------------|----------|-----------------------|----------------|------------------------|------------|
| Stack `immich`, view  | 24       | 20 (83%)              | 15             | 1740 / 732             | 2.38       |
| Stack `immich`, edit  | 48       | 38 (79%)              | 34             | 2844 / 732             | 3.89       |
| Settings, security    | 20       | 12 (60%)              | 5              | 840 / 732              | 1.15       |
| Stack `immich`, edit, at 1280x900 | 56 | 40 (71%)         | 26             | 3076 / 852             | 3.61       |

The stack screen in edit mode is the working screen of this application, and it puts 48 controls on a
phone, 38 of them under 44 pixels, 34 of them below the fold, spread over 3.89 screenfuls.

Fourteen of those 48 measure exactly 40x36, which is every square icon button on the screen: eight are
the `CodeEditor` toolbars, four per editor across two editors, and six are `ArrayInput` row buttons,
three per entry. `immich` carries only two array entries, so six is the floor rather than the typical
case. The same screen against the `dense` fixture, whose `wide-stack` has 12 services with 20 ports
each, holds 240 array rows and 1089 controls, 1049 of them under 44 pixels, over 31.26 screenfuls. The
count is linear in how much a user has actually configured, which is the wrong thing for it to be
linear in.

That is the "everything is a button" complaint, quantified. It is not a mobile styling problem. The
screen exposes every affordance it has at every width, and 390 pixels is where that stops working.

### 2.4 The alignment complaint is optical, not geometric

Measured left edges of the top-level blocks in the outlet, stack screen at 390:

```
h1.type-headline    left=12
ul.urls             left=12
div.bar             left=12
section.editors     left=12
section.services    left=12
section.networks    left=12
section.pane        left=12
```

Every box is on the same edge. The auditor's `column-edge` rule is correct and passing. Now the same
screen measured by the left edge of the first glyph, using a `Range` over the first text node:

```
 12   <span> immich
 24   <span> https://photos.example.test
 40   <span> Running
122   <button> Deploy
 12   <h2> Compose file
```

Three column starts in the first 150 pixels of the page: 12 for the heading, 24 for the chip, 40 for
the status badge. A reader does not align on boxes. A reader aligns on ink, and a filled control's ink
starts inside its own padding.

The same divergence appears vertically. In the action bar, measured at 390:

| Element      | Height | Top |
|--------------|--------|-----|
| status badge | 32     | 146 |
| Deploy       | 36     | 144 |
| Save draft   | 36     | 144 |
| Discard      | 36     | 144 |

A 32 pixel pill beside three 36 pixel pills, on two different top edges, sharing a centre axis. The
`row-axis` rule checks the centre axis, which holds. The eye reads the outline, which does not.

### 2.5 The virtual keyboard is not handled at all

`frontend/index.html`:

```html
<meta name="viewport" content="width=device-width, initial-scale=1" />
```

No `interactive-widget`, so the browser default `resizes-visual` applies: the keyboard overlays the
visual viewport and leaves the layout viewport at its full height. `Layout.svelte` sets
`.shell { block-size: 100dvh }`, and `dvh` resolves against the layout viewport, so the shell stays 844
pixels tall while the user can only see the top 500 or so.

Measured chrome on a 390x844 phone: header 48, bottom navigation bar 64, leaving the outlet a 732 pixel
window. A typical iOS keyboard on that device takes roughly 336 pixels. The consequences follow
directly:

- The bottom navigation bar sits at y 780 to 844 and is entirely behind the keyboard whenever one is
  open. It is not scrolled out of the way, it is covered, and there is nothing the user can do about it
  short of dismissing the keyboard.
- Roughly 270 of the outlet's 732 pixels are behind the keyboard as well. The outlet is its own scroll
  container, so the browser's focus scrolling operates inside a window whose true visible height the
  layout does not know.
- Any control anchored to the bottom of the shell is unreachable while typing.

`ConfirmDialog` compounds this. The disable-authentication and delete-stack confirmations carry a
password field, and a centred dialog on a keyboard-shrunk visual viewport is the standard case where
the confirm button lands underneath the keyboard.

### 2.6 The Dashboard is unreachable below 840 pixels

`Layout.svelte` lines 349 to 367:

```css
@media (width < 840px) {
    .panel:not(.panel-home) { display: none; }
    .panel-home + .outlet   { display: none; }
}
```

`/` is the only route that loads `Dashboard.svelte` (`router.svelte.ts` line 15), and `/` is the route
where `.panel-home` is set. Verified by measurement:

| Width | `.outlet` display | Dashboard counts visible | Converter visible | Hosts visible |
|-------|-------------------|--------------------------|-------------------|---------------|
| 390   | none              | false                    | false             | false         |
| 600   | none              | false                    | false             | false         |
| 839   | none              | false                    | false             | false         |
| 840   | flex              | true                     | true              | true          |

Below 840 pixels the stack counts, the `docker run` converter, and remote host management do not exist.
They are not collapsed or moved. There is no route that reaches them. This is a functional loss on
every phone and every tablet in portrait, and it is a bug rather than a design question.

### 2.7 Smaller findings in the same class

- `MenuButton.svelte` positions its popup with `inset-block-start: 100%` and never flips. The popup's
  containing block is `.anchor`, which is inside `.outlet`, and `.outlet` is `overflow-y: auto`, so a
  menu opened in the lower half of a compact screen is clipped by the scroller.
- `TerminalView.svelte` line 37 reads `window.matchMedia("(width < 600px)").matches` once at component
  init and stores it in `wrapped`. It is not reactive, so a window resized across the breakpoint keeps
  whichever mode it started in.
- `TerminalView` exposes eight soft keys at 36 pixels tall with 12 pixels of gap, wrapping into three
  rows on a 390 pixel screen, directly above where a keyboard would open.
- `Settings.svelte` renders six navigation tabs in a `flex-wrap` row, which is two rows of pills at 390
  before any content appears.
- The two `CodeEditor` panes on the stack screen each carry their own four-button toolbar, so a phone
  shows eight identical square buttons on one screen for two editors.

## 3. Goals & Non-Goals

### 3.1 Goals

- [ ] One design system across widths. The same components, tokens, type scale, and information
      architecture at 390 and at 1920. What varies is density, disclosure, and placement, and each
      variation is driven by a stated window size class or input modality.
- [ ] Touch targets that grow rather than shrink under a coarse pointer, with spacing scaled to size.
- [ ] Progressive disclosure as the mechanism for fitting a working screen into 390 pixels, replacing
      the current mechanism of shrinking everything.
- [ ] A layout that survives a virtual keyboard: no control permanently covered, the focused field
      always in the visible band, and the bottom chrome out of the way while typing.
- [ ] Optical alignment. One text column per screen region, measured on glyph edges rather than box
      edges.
- [ ] The Dashboard reachable at every width.
- [ ] A verification matrix that samples real device geometry: viewport height, coarse pointer, and a
      keyboard-open state, so this class of defect fails a build rather than a user.

### 3.2 Non-Goals

- [ ] A separate mobile interface, a separate mobile route table, or a mobile-only component set. If a
      change cannot be expressed as the same component under a different window size class, it is out
      of scope.
- [ ] A native application, an app shell manifest, or offline support.
- [ ] Touch gestures as a primary means of operation. Swipe-to-delete and drag-to-reorder both require
      single-pointer alternatives under WCAG 2.5.1 and 2.5.7, which means building the control twice.
      Build the control once, as a control.
- [ ] Redesigning the expanded layout. Where a compact fix improves the expanded layout as a side
      effect, take it; do not go looking.
- [ ] Image comparison. Proposal 8's position holds and this proposal adds no baselines.

## 4. Technical Design

### 4.1 The principles this design is derived from

The relevant published guidance, and what each one contributes here.

**Target size.** WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA, sets a floor of 24x24 CSS pixels,
with an exception for targets that have 24 pixels of clear space. That is a legal floor, not a design
target, and it has been enforceable in the EU under the European Accessibility Act since 28 June 2025.
SC 2.5.5 Target Size (Enhanced), Level AAA, sets 44x44. Apple's Human Interface Guidelines specify
44x44 pt. Material 3 specifies a 48dp touch target. The project's own auditor already declares 48 as
`COMFORTABLE` in `tools/audit/rules/targetSize.ts` and permits 32 with clear space.

The design target adopted here is 48 under a coarse pointer, which is Material's number and the
project's own stated floor. The auditor's 32-with-clear-space branch stays available for a fine
pointer and is closed under a coarse one.

**Spacing scales with size.** Field guidance converging on the same numbers: 8 pixels minimum between
targets at or above 44, 12 minimum between targets in the 32 to 44 band, 16 when either target is near
a screen edge. The current compact layout pairs 36 pixel targets with an 8 pixel gap, which is the
worst cell in that table. Raising targets to 48 lets the 8 pixel gap become correct rather than
marginal.

**Thumb zones.** On a phone held one-handed, the bottom of the screen is easy to reach, the top corners
require a regrip. Primary actions belong in the bottom band and destructive actions do not. Docknight
currently puts Deploy at y 144 on an 844 pixel screen, above 3.89 screenfuls of content the user has to
scroll back from, and puts Delete in an overflow menu, which is the one placement decision on that
screen that is already right.

**Progressive disclosure.** Nielsen Norman Group's formulation: defer secondary options to a subsidiary
surface and show primary options by default. This is the trade that pays for larger targets. Forty
eight controls at 36 pixels is worse than twenty at 48.

**Window size classes.** Material 3 defines compact below 600dp, medium from 600 to 840, expanded from
840 up, and pairs each with a navigation pattern: navigation bar, navigation rail, navigation drawer.
Docknight already breaks at exactly 600 and 840 and already switches rail to bar at 600. The breakpoints
need no change. What is missing is that the size class currently changes only sizes, and it should be
changing disclosure.

**Virtual keyboard.** The `interactive-widget` viewport key selects whether the keyboard resizes the
visual viewport only (`resizes-visual`, the default), both viewports (`resizes-content`), or neither
(`overlays-content`). `resizes-content` makes `dvh` track the space actually left, which is what an app
shell with a bottom bar and a `100dvh` root needs. Chrome 108 and Firefox 132 support it; Safari does
not, which is why the design below pairs it with a `visualViewport` fallback rather than relying on it.

**Reflow and orientation.** WCAG 1.4.10 requires no two-dimensional scrolling at 320 CSS pixels, which
the matrix already asserts. WCAG 1.3.4 requires both orientations to work. Landscape on a phone is a
short viewport, roughly 390 tall, and is the case that the pinned 900 pixel test height has hidden most
completely.

### 4.2 Architecture overview

Six changes, in dependency order. Each is scoped to hold at every width.

```
1. Viewport and keyboard primitives          index.html, new lib/viewport.svelte.ts, Layout.svelte
2. Density: drop the step, raise on touch    tokens.css
3. Disclosure policy for compact             Stack.svelte, ServiceCard.svelte, ArrayInput.svelte (landed),
                                             CodeEditor.svelte, TerminalView.svelte, MenuButton.svelte
4. Optical alignment                         global.css, Layout.svelte, Stack.svelte
5. Dashboard reachability                    Layout.svelte, Dashboard.svelte
6. Verification matrix and two new rules     tests/support/matrix.ts, harness.ts, tools/audit/rules
```

Change 6 is written first in the implementation plan even though it is listed last, because every other
change needs it to demonstrate an effect.

### 4.3 Core logic

#### 4.3.1 Viewport and keyboard

Three parts, in increasing order of how much they are needed.

**The meta tag.** `frontend/index.html` gains one key:

```html
<meta name="viewport" content="width=device-width, initial-scale=1, interactive-widget=resizes-content" />
```

On Chrome and Firefox this alone makes `100dvh` shrink when a keyboard opens, which pulls the bottom
navigation bar above the keyboard and reduces the outlet window to what is genuinely visible. It is one
attribute and it fixes the majority case.

**The fallback.** Safari ignores the key, so a small module publishes the real visible height as a
custom property. `frontend/src/lib/viewport.svelte.ts`:

```ts
/**
 * The block size actually available to the shell. `interactive-widget=resizes-content` already gives
 * this on Chromium and Firefox; Safari leaves the layout viewport at full height and only shrinks the
 * visual one, so it is read from visualViewport instead. Published as a property rather than a store
 * because the only consumer is a stylesheet.
 */
export function trackViewport(): () => void { /* ... */ }
```

It sets two properties on the document element, and nothing else:

| Property             | Value                                                          |
|----------------------|----------------------------------------------------------------|
| `--viewport-block`   | `visualViewport.height` in pixels, or `100dvh` when unavailable |
| `--keyboard-inset`   | `layoutHeight - visualViewport.height - visualViewport.offsetTop`, floored at 0 |

`Layout.svelte` then reads the first:

```css
.shell {
    block-size: var(--viewport-block, 100dvh);
}
```

A keyboard is treated as open when `--keyboard-inset` exceeds 120 pixels, which is comfortably above
the largest browser toolbar and below the smallest keyboard. The threshold is a constant in the module,
not a token, because it is not a spatial value on the grid.

**What happens when it is open.** The bottom navigation bar is hidden and the outlet reclaims its
height. This is what native applications do and it is the only option that does not either cover the
bar or waste 64 pixels of an already short viewport. The bar returns on blur. Since the bar is
navigation and not the current task, removing it while the user types costs nothing, and the shell's
`data-keyboard` attribute makes the state addressable:

```css
.shell[data-keyboard="open"] .rail { display: none; }
```

This applies to the navigation bar and to nothing else. Section 4.3.3 replaces that bar with a bottom
app bar on compact detail screens, and the app bar carries the primary action and the back affordance,
which are the current task rather than navigation away from it. Hiding those while a user types is the
opposite of what the thumb zone reasoning in 4.1 asks for. The app bar therefore stays, sitting on the
keyboard rather than behind it, which the corrected shell height already guarantees. The selector is
scoped to `.rail` so that this holds by construction rather than by review.

**Focus scrolling.** With the shell sized correctly, the browser's own scroll-into-view lands the
focused field in the visible band, because the outlet's client height is now the truth. One case still
needs help: `ConfirmDialog` centres in a viewport that has just halved. The dialog anchors to the block
start with a margin rather than centring when the keyboard is open, so the headline and the field stay
visible and the buttons stay above the keyboard.

#### 4.3.2 Density

`tokens.css` drops the density step and replaces the width query with a pointer query.

```css
/*
 * A thumb needs a larger target than a cursor, so the control height goes up under a coarse pointer
 * rather than down on a narrow one. What pays for the height is disclosure: a compact screen shows
 * fewer controls, not smaller ones.
 */
@media (pointer: coarse) {
    :root {
        --size-control-md: var(--size-control-lg);
    }
}
```

The `--m3-util-density: -1` declaration is deleted outright rather than moved into this block. Unset
and `0` are the same value to m3-svelte, so writing `0` here would look like a decision and change
nothing.

The query is on the pointer rather than the width because the requirement follows the input device. A
touchscreen laptop at 1400 pixels needs 48 pixel targets and a desktop window dragged to 390 pixels
does not. Width still selects the layout; the pointer selects the density.

The type scale steps at `width < 600px` stay as they are. A 32 pixel heading on a 390 pixel screen is
still the wrong size and that reasoning was never about touch.

The consequence is that every compact screen gets taller. Section 4.3.3 is what pays for it, but only
three of its five changes buy vertical room: the editor tab pair, the action bar collapse, and the
`ServiceCard` header. The other two buy control count and width without shortening the page, and the
plan in section 6 depends on that distinction.

#### 4.3.3 Disclosure

Five changes, each removing controls from the compact viewport without removing capability.

**`ArrayInput` loses its reorder buttons at every width. Landed.** Compose assigns no meaning to the
order of `ports`, `volumes`, `environment`, `depends_on`, or `networks`, so the buttons rearranged a
list that nothing reads in order. The YAML editor on the same screen, always in sync, is where an order
that matters to a reader can be set.

Measured before and after, at 390x844 in edit mode:

| Fixture and stack        | Array rows | Controls     | Under 44px   | Row field width | Outlet scroll |
|--------------------------|------------|--------------|--------------|-----------------|---------------|
| `typical` / `immich`     | 2          | 48 to 44     | 38 to 34     | 198 to 294      | 2844, unchanged |
| `dense` / `wide-stack`   | 240        | 1089 to 609  | 1049 to 569  | 198 to 294      | 22880, unchanged |

Two things this does not do, stated because the framing above would otherwise imply them. It does not
shorten the page: the buttons sat inline beside the field, so scroll height is identical to the pixel
in both fixtures. It does not help a small stack much: on `immich` it removes four controls. What it
does is remove 44 percent of the controls on a realistically configured stack and give the row's
monospace field 96 more pixels, which is the difference between reading `9000:80` and reading a bind
mount path.

**The stack action bar becomes one primary action plus an overflow.** View mode currently exposes Edit,
Restart, Stop, and a More menu; edit mode exposes Deploy, Save draft, and Discard. Under the compact
policy, one filled primary stays (Deploy in edit mode, Start or Restart in view mode) and everything
else joins the existing `MenuButton`. Expanded keeps the current row. The menu already exists, so this
is a change to which items it holds at which width, not a new mechanism.

**The primary action moves into the thumb zone on compact.** On a detail screen the action bar becomes
a bottom app bar and replaces the navigation bar rather than stacking with it, which is Material's own
rule for the two. Net chrome height is unchanged at 64 pixels, the primary action moves from y 144 to
the bottom band, and the bar carries a back affordance in place of the destinations it replaced. On
expanded the bar stays where it is now.

**The two editors become a tab pair on compact.** `Stack.svelte` stacks the compose editor and the
environment editor, each 400 pixels tall with its own four-button toolbar. On a 732 pixel outlet that is
the whole screen twice over, and eight identical square buttons. A two-tab container showing one editor
at a time removes 400 pixels of scroll and four of the eight buttons. At 1280 and above the existing
`2fr 1fr` grid is unchanged. Same `CodeEditor`, same toolbar, one container that resolves to tabs or to
a grid.

**`ServiceCard` collapses its header actions.** Shell, Start, Stop, Restart, and Remove are five text
buttons in a wrapping header. On compact they become one overflow menu, matching what the stack action
bar already does one level up.

**`MenuButton` becomes a bottom sheet on compact.** This solves the clipping in 2.7 and the thumb zone
at once: a sheet is not positioned inside `.outlet`, so the scroller cannot clip it, and its items land
in the bottom band. Material specifies a sheet as the compact form of a menu with more than a few
items, so this is the same component adapting rather than a second component. On expanded it stays an
anchored popup, and gains a flip so it is not clipped there either.

#### 4.3.4 Optical alignment

Two rules, both stated as design constraints rather than as fixes to individual screens.

**One text column per region.** Within a region of the outlet, the first glyph of every block-level
element starts on the same inline edge. A filled or outlined control that leads a row breaks this,
because its ink starts inside its own padding. Two remedies, applied in this order:

1. Do not lead a row with a filled control where a heading or body text starts the rows above and
   below it. On the stack screen this moves the status chip out of the action bar and onto the `h1`
   row, beside the endpoint badge, which is already the established pattern for that row.
2. Where a control must lead, offset the container by the control's own inset so the ink lands on the
   column. Expressed once in `global.css` as a `--optical-inset` utility rather than per screen.

**Full-bleed cards on compact.** A card currently carries 12 pixels of padding inside a 12 pixel outlet
inset, so text inside a card starts at 24 while a section heading outside one starts at 12. On compact
the outlet inset goes to 0 and the card keeps its padding, which puts both at 12, gives the card 24
pixels more content width, and is the standard compact card treatment. Expanded is unchanged.

**One row height per row.** The badge at 32 beside buttons at 36 is a row with two heights. Under
4.3.2 the buttons go to 48; `Badge` and `StatusChip` take the same floor under a coarse pointer so the
row has one outline height. This is a token change, not a per-component one.

#### 4.3.5 Dashboard reachability

Delete the `panel-home` special case rather than extending it.

```css
@media (width < 840px) {
    .panel  { display: none; }
    .outlet { flex: 1; }
}
```

Below 840 the outlet is the body at every route including `/`, and the stack list becomes the first
card of `Dashboard.svelte`, carrying the search field that currently lives in the panel head.
`Dashboard.svelte` already renders `StackList` conditionally, so the component is in place.

This removes a rule rather than adding one, restores three features that are currently unreachable, and
makes `/` mean the same thing at every width. The expanded layout keeps the pinned panel exactly as it
is now.

#### 4.3.6 Two new audit rules

**`glyph-edge`.** For every element carrying `data-audit-column`, measure the left edge of the first
glyph of each child block rather than the child's border box, using a `Range` over the first non-empty
text node. Report children whose glyph edge differs from the column's modal glyph edge by more than the
existing tolerance. This is the rule that would have caught 2.4, and `column-edge` stays as it is
because a box that is off its column is still a defect.

**`touch-target`.** Under `pointer: coarse`, the floor is 48x48 with no clear-space branch, and the
minimum gap between two targets in the same scroll container scales with the smaller of the two: 8
pixels at 48 and above, 12 below it. Under a fine pointer the existing `target-size` rule is unchanged.
The two rules share `activationRect`, `scrollContainer`, and `nearestNeighbour` from
`tools/audit/rules/shared.ts` rather than reimplementing them.

### 4.4 Verification matrix

The matrix gains a height and a pointer, and the harness stops pinning 900.

```ts
/** Viewport geometry, not just width. Height is what a keyboard takes and what landscape has none of. */
export interface Geometry {
    id: string;
    width: number;
    height: number;
    touch: boolean;
}

export const GEOMETRIES: readonly Geometry[] = [
    { id: "reflow",     width: 320,  height: 900,  touch: false },
    { id: "phone",      width: 390,  height: 844,  touch: true  },
    { id: "phone-wide", width: 600,  height: 900,  touch: true  },
    { id: "phone-land", width: 780,  height: 390,  touch: true  },
    { id: "keyboard",   width: 390,  height: 380,  touch: true  },
    { id: "tablet",     width: 840,  height: 1120, touch: true  },
    { id: "laptop",     width: 1280, height: 900,  touch: false },
    { id: "desktop",    width: 1920, height: 1080, touch: false },
];
```

This is the current `WIDTHS` list with 360 replaced by 390 and two rows added. 360 goes because a 390
pixel phone is the more common device and the two widths test the same branch. 600 and 840 stay as
`phone-wide` and `tablet` because they are the breakpoint edges, and a layout that breaks does it at
the edge.

`openCell` takes the height and the touch flag from the cell instead of writing 900. Playwright's
`hasTouch: true` is what makes `pointer: coarse` match, so the density and target rules are exercised
rather than assumed.

Three of these need their numbers justified, because the obvious choice is wrong in each case.

`phone-land` is 780 wide and not 844. An 844 pixel wide viewport is past the 840 breakpoint, so it
renders the expanded layout with the pinned side panel and tests the desktop design on a short screen,
which is not what WCAG 1.3.4 is asking about. 780 is a real phone landscape width that stays inside the
medium class, so the cell exercises the compact-to-medium layout at 390 pixels of height with 112
pixels of it already spent on chrome. This is the case the pinned 900 hid most completely.

`keyboard` models a keyboard-open phone as a short viewport, which is what
`interactive-widget=resizes-content` actually produces on the browsers that support it, so the layout
under test is the layout those users get. It does not exercise the Safari path: Playwright never opens
a keyboard, `visualViewport.height` equals the layout height, `--keyboard-inset` stays 0, and
`data-keyboard` never becomes `open`. The navigation bar hiding in 4.3.1 is therefore not covered by
this cell and needs a unit test that drives `trackViewport` against a stubbed `visualViewport` instead.
Stating this rather than letting the cell name imply coverage it does not have.

`reflow` keeps its 900 pixel height, which is the one place the pinned height survives. That cell runs
`REFLOW_RULES`, which is `overflow` alone, and 1.4.10 is a statement about width. Giving it a realistic
height would add a second failure mode to a cell that exists to isolate one.

Sampling stays bounded the way it is now. The full width list runs at its natural height in both themes;
the pseudo-locale, RTL, and extra-scenario cells run at `phone` and `laptop` rather than at 360 and 1280.
`keyboard` and `phone-land` run against the screens that carry a text field, which is login, setup,
stack, dashboard, and the settings sections, and skip the rest.

## 5. API Design

### 5-1. New / Modified

No protocol methods change. The surface that changes is the design token set, the audit rule set, and
the matrix.

**New tokens** in `frontend/src/styles/tokens.css`:

| Token               | Value                        | Purpose                                                      |
|---------------------|------------------------------|--------------------------------------------------------------|
| `--viewport-block`  | set by `viewport.svelte.ts`  | Block size the shell may occupy, keyboard already subtracted |
| `--keyboard-inset`  | set by `viewport.svelte.ts`  | Height the virtual keyboard occupies, 0 when closed          |
| `--optical-inset`   | `var(--space-3)`             | A leading control's own inset, subtracted to put ink on the column |

**Modified tokens**, all inside `@media (pointer: coarse)`:

| Token                | Fine pointer | Coarse pointer      |
|----------------------|--------------|---------------------|
| `--m3-util-density`  | unset        | unset               |
| `--size-control-md`  | `40px`       | `48px` (was `36px`) |

Two corrections to what an earlier draft of this table said.

`--m3-util-density` is deleted rather than set. Unset and `0` resolve identically in m3-svelte, so a
coarse block declaring `0` would be a no-op dressed as a decision. The change is that the `-1` under
`width < 600px` goes away and nothing replaces it.

`--size-control-sm` is not in this table, because it is not a touch target token. Its three users are
`Badge`, which is a label, `.rail-indicator`, which is the pill drawn behind a nav icon whose real
target is the 56 pixel `.rail-item` around it, and `.about-row a` in Settings. Raising it would inflate
two non-targets to fix one, and 40 would still fail the 48 floor that 4.3.6 sets. The About link is a
target and gets its own floor of `--size-control-lg` at its own declaration site.

**New module** `frontend/src/lib/viewport.svelte.ts`:

| Export           | Signature                | Behaviour                                                        |
|------------------|--------------------------|------------------------------------------------------------------|
| `trackViewport`  | `() => () => void`       | Subscribes to `visualViewport` resize and scroll, publishes the two properties and `data-keyboard` on the document element, returns an unsubscribe |
| `keyboardOpen`   | `{ readonly value: boolean }` | Reactive read of the same state, for the two components that branch on it in markup rather than in CSS |

Called once from `App.svelte`. It is a module and not a store because the primary consumer is a
stylesheet, and a store would mean every component subscribing to a value only the shell uses.

**New audit rules** in `tools/audit/rules/`, both implementing the existing `Rule` interface:

| Rule            | Severity | Fires when                                                              |
|-----------------|----------|-------------------------------------------------------------------------|
| `glyph-edge`    | error    | A child of a `data-audit-column` starts its ink off the column's modal glyph edge |
| `touch-target`  | error    | Under `pointer: coarse`, a target is under 48x48, or its gap to a neighbour is under the size-scaled minimum |

**Modified matrix**: `WIDTHS` and `DETAIL_WIDTHS` are replaced by `GEOMETRIES` and `DETAIL_GEOMETRIES`.
`Cell` gains `height` and `touch`. `REFLOW_WIDTH` becomes the `reflow` geometry's id and `REFLOW_RULES`
is unchanged. Cell ids gain the geometry id in place of the bare width, so `stack.light.1280` becomes
`stack.light.laptop`, and the existing report and screenshot naming follows without further change.
Every existing cell id changes, so any exemption or triage note that names one has to be rewritten
once. `design/exemptions.json` selects on `data-audit-id` rather than on cell ids, so it is unaffected.

### 5-2. Error Handling

`visualViewport` is absent in no browser this project supports, but the module treats it as optional
anyway: when it is missing, `--viewport-block` is left unset and the `100dvh` fallback in the `var()`
applies. There is no error path, because there is no state in which the shell should fail to have a
height.

A `--keyboard-inset` computed as negative is clamped to 0. It goes negative during the transient where
the visual viewport has grown but the layout viewport has not yet been reported, and a negative inset
would briefly stretch the shell past the viewport.

The two new audit rules report through the existing `Violation` model with `measured`, `expected`, and
`highlight` populated the way every other rule populates them, so `report.ts` needs no change.

## 6. Implementation Plan

### 6-1. Milestones

| Phase   | Task                                                                                  | Estimated Duration | Owner          |
|---------|---------------------------------------------------------------------------------------|--------------------|----------------|
| Phase 0 | `ArrayInput` reorder cut. **Landed.**                                                  | Done               | heavycaffeiner |
| Phase 1 | `GEOMETRIES`, `Cell` height and touch, `openCell` stops pinning 900                    | TBD                | heavycaffeiner |
| Phase 2 | `touch-target` and `glyph-edge` rules, with the shared helpers extracted               | TBD                | heavycaffeiner |
| Phase 3 | Baseline run on the new matrix, triaged into an ordered defect list                    | TBD                | heavycaffeiner |
| Phase 4 | `viewport.svelte.ts`, the meta tag, `.shell` sizing, navigation bar hiding             | TBD                | heavycaffeiner |
| Phase 5 | `ConfirmDialog` keyboard-aware placement                                               | TBD                | heavycaffeiner |
| Phase 6 | Density: delete the `-1` step, add the coarse-pointer control height                    | TBD                | heavycaffeiner |
| Phase 7 | Dashboard reachability: delete `panel-home`, move the list and search into the Dashboard | TBD              | heavycaffeiner |
| Phase 8 | `ServiceCard` header collapse                                                           | TBD                | heavycaffeiner |
| Phase 9 | Stack action bar policy and the compact bottom app bar                                  | TBD                | heavycaffeiner |
| Phase 10| `CodeEditor` tab pair on compact                                                        | TBD                | heavycaffeiner |
| Phase 11| `MenuButton` bottom sheet on compact, flip on expanded                                   | TBD                | heavycaffeiner |
| Phase 12| Optical alignment: `--optical-inset`, full-bleed cards, badge height floor               | TBD                | heavycaffeiner |
| Phase 13| `TerminalView` reactive `wrapped`, soft key sizing, `Settings` tab overflow              | TBD                | heavycaffeiner |
| Phase 14| Exemption review and the conformance sweep across the new matrix                         | TBD                | heavycaffeiner |

Phase 0 landed ahead of the matrix work, which contradicts the rule stated in the next paragraph. It
was taken on its own merits: the buttons operated on an order nothing reads, so the cut is correct
whatever the baseline turns out to say, and its effect was measured directly rather than through the
matrix. Nothing else in this plan has that property.

Phases 1 to 3 come first and are not negotiable in ordering. Every later phase is judged by whether it
moves a number in the Phase 3 list, and without that list the remaining eleven phases are opinion.

Phase 6 makes every compact screen taller and will fail the `in-viewport` and `overflow` rules on
screens that Phases 7 to 10 have not reached yet. That is expected and is the reason the disclosure
phases follow it directly rather than preceding it. Landing 6 without them is worse than landing none
of them.

Phase 4 is independent of 6 through 12 and can land first if the keyboard problem is judged the most
urgent, which it reasonably might be: it is one meta attribute plus one small module, and it is the only
defect in this proposal that makes a screen impossible to operate rather than unpleasant to.

### 6-2. Dependencies

No new packages. Every mechanism here is a browser API or an existing project facility.

| Facility                        | Purpose                                | Why not a package                                                     |
|---------------------------------|----------------------------------------|-----------------------------------------------------------------------|
| `VisualViewport`                | Keyboard inset and visible height       | One interface with two events; a package would wrap it and add nothing |
| `interactive-widget`            | Viewport resize behaviour               | A meta attribute                                                      |
| `Range.getBoundingClientRect`   | Glyph edge measurement                  | Already used by proposal 8's baseline measurement                      |
| Playwright `hasTouch`           | Coarse pointer emulation                | Already a dependency                                                  |
| m3-svelte `Menu`, `Dialog`      | The bottom sheet and the dialog          | Already a dependency; the sheet is the same `Menu` in a different container |

Deliberately absent:

| Not used                     | Replaced by                                                                 |
|------------------------------|------------------------------------------------------------------------------|
| A responsive framework       | Two media queries and a pointer query, which is what the design actually needs |
| A gesture library            | Non-goal 3.2. Gestures need single-pointer alternatives, so the alternative is the design |
| The VirtualKeyboard API      | `interactive-widget` plus `visualViewport` covers every supported browser; the API adds a third mechanism for the same result |
| A device detection library   | `pointer: coarse` and the window size classes. User agent sniffing answers a different question than the one being asked |

Internal dependencies: proposal 6 for the token scale and the breakpoints, proposal 7 for the screens
and their `data-audit-*` attributes, proposal 8 for the auditor, the rule interface, the fixture
backend, and the matrix this proposal extends.

## 7. References

- WCAG 2.2, the specification: https://www.w3.org/TR/WCAG22/
- Guidance on Applying WCAG 2.2 to Mobile Applications: https://www.w3.org/TR/wcag2mobile-22/
- WCAG 2.2 target size minimum, 2.5.8: https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- WCAG 2.1 target size enhanced, 2.5.5: https://www.w3.org/WAI/WCAG21/Understanding/target-size.html
- WCAG 2.2 dragging movements, 2.5.7: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html
- WCAG 2.1 pointer gestures, 2.5.1: https://www.w3.org/WAI/WCAG21/Understanding/pointer-gestures.html
- WCAG 2.1 reflow, 1.4.10: https://www.w3.org/WAI/WCAG21/Understanding/reflow.html
- WCAG 2.1 orientation, 1.3.4: https://www.w3.org/WAI/WCAG21/Understanding/orientation.html
- Material 3 window size classes and adaptive layout: https://m3.material.io/foundations/layout/applying-layout/window-size-classes
- Material 3 accessibility and touch target sizing: https://m3.material.io/foundations/designing/structure
- Apple Human Interface Guidelines: https://developer.apple.com/design/human-interface-guidelines/
- Nielsen Norman Group on progressive disclosure: https://www.nngroup.com/videos/progressive-disclosure/
- Tap targets and thumb zones, spacing thresholds: https://www.72technologies.com/blog/tap-targets-thumb-zones-mobile-ux
- `interactive-widget` viewport key: https://www.htmhell.dev/adventcalendar/2024/4/
- Viewport resize behaviour explainer: https://github.com/bramus/viewport-resize-behavior/blob/main/explainer.md
- `VisualViewport`: https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport
- Dynamic viewport units: https://developer.mozilla.org/en-US/docs/Web/CSS/length#viewport-percentage_lengths
- `pointer` media feature: https://developer.mozilla.org/en-US/docs/Web/CSS/@media/pointer
- Playwright emulation, `hasTouch` and viewport: https://playwright.dev/docs/emulation
- Companion proposals: `docknight-6-frontend-shell`, `docknight-7-frontend-features`,
  `docknight-8-design-verification`
