# Portainer CE 2.45.0 UX Pattern Library Dossier

Scope: `app/react/components/**`, with emphasis on `datatables/`, `modals/`, `form-components/`, `buttons/`, `Tip/Tooltip`, `Badge/`, `Widget/`, `BoxSelector/`, `InlineLoader/`, plus wizard and notification code. All paths are relative to `.ref/portainer/` unless stated. Commit 4a4a157. Read-only research, no builds run.

All of this is CE-only surface (no BE gating observed in this component tree; BE gating shows up as a cross-cutting concern via `BEFeatureIndicator`/`FeatureId`, see section 7).

---

## 1. Component inventory

### Data display / tables

| Component | Purpose | Path |
|---|---|---|
| `Datatable` | Full-featured TanStack table: header (title/search/actions/settings), body, footer (pagination) | `app/react/components/datatables/Datatable.tsx` |
| `CardExpandableList` | Same TanStack table instance/settings contract as `Datatable`, renders rows as stacked cards instead of a `<table>`; used for mobile-friendlier or naturally-card-shaped data | `app/react/components/datatables/CardExpandableList.tsx` |
| `CardExpandableListRow` | Single card row with optional expand-to-subrow | `app/react/components/datatables/CardExpandableListRow.tsx` |
| `BasicTable` | Minimal table wrapper without the settings/pagination chrome, for small static tables | `app/react/components/datatables/BasicTable.tsx` |
| `NestedDatatable` / `NestedTable` | Table embedded inside an expanded parent row | `app/react/components/datatables/NestedDatatable.tsx`, `NestedTable.tsx` |
| `ExpandableDatatable` / `ExpandableDatatableRow` | Thin Datatable variant wired for `getExpandedRowModel` | `app/react/components/datatables/ExpandableDatatable.tsx` |
| `EditableDatatable` | Inline-editable rows (edit/accept/revert per row) built via `extendTableOptions` + `withMeta` | `app/react/components/datatables/editable/EditableDatatable.tsx` |
| `Table.*` compound (`Table`, `Table.Container`, `Table.HeaderRow`, `Table.Content`) | Low-level `<table>` primitives Datatable composes | `app/react/components/datatables/Table.tsx`, `TableContainer.tsx`, `TableHeaderRow.tsx`, `TableContent.tsx`, `TableRow.tsx`, `TableFooter.tsx` |
| `ColumnVisibilityMenu` | Reach `Menu` + checkboxes to hide/show columns | `app/react/components/datatables/ColumnVisibilityMenu.tsx` |
| `Filter` / `MultipleSelectionFilter` / `filterHOC` | Per-column multi-select faceted filter dropdown | `app/react/components/datatables/Filter.tsx` |
| `SearchBar` | Debounced global-search input, session-storage persisted per table | `app/react/components/datatables/SearchBar.tsx` |
| `TableSettingsMenu` / `TableSettingsMenuAutoRefresh` | Gear-icon dropdown holding column visibility + auto-refresh interval picker | `app/react/components/datatables/TableSettingsMenu.tsx`, `TableSettingsMenuAutoRefresh.tsx` |
| `PaginationControls` (+ `PageSelector`, `PageInput`, `ItemsPerPageSelector`) | Page navigation with jump-to-page and page-size select | `app/react/components/PaginationControls/*` |
| `DetailsTable` / `DetailsRow` | Key/value definition-list-as-table for detail panels | `app/react/components/DetailsTable/*` |
| `StatusSummaryBar` / `FilterBarButton` / `FilterBarActiveIndicator` | Clickable status-count chips above a table that double as quick filters | `app/react/components/StatusSummaryBar/*` |
| `ResourceDetailHeader` (+ `ResourceDetailHeaderSkeleton`, `ResourceStatBlock`) | Standard "resource detail page" header with stat blocks and an action bar | `app/react/components/ResourceDetailHeader/*` |
| `SortableList` (+ `SortableListGroup`, `SortableListHeader`, `SortByGroup`) | Drag-reorderable grouped list (dnd), zustand-backed | `app/react/components/SortableList/*` |

### Modals / overlays

| Component | Purpose | Path |
|---|---|---|
| `Modal` (+ `.Header/.Body/.Footer`, `CloseButton`) | Reach `DialogOverlay`/`DialogContent` wrapper, compound-component API | `app/react/components/modals/Modal/*` |
| `openModal` | Imperative promise-based modal mounter (creates a DOM node, `ReactDOM.render`s the modal, resolves on submit, unmounts) | `app/react/components/modals/open-modal.tsx` |
| `Dialog` / `openDialog` | Generic title+message+buttons modal, supports a self-submitting countdown timer on a button | `app/react/components/modals/Dialog.tsx` |
| `confirm.ts` (`confirm`, `confirmDestructive`, `confirmDelete`, `confirmUpdate`, `confirmWebEditorDiscard`, `confirmGenericDiscard`, `confirmChangePassword`) | Promise-returning confirmation helpers built on `openDialog` | `app/react/components/modals/confirm.ts` |
| `SwitchPrompt` / `openSwitchPrompt` | Confirm dialog with an embedded on/off toggle, resolves `{ value: boolean }` | `app/react/components/modals/SwitchPrompt.tsx` |
| `Sheet` (+ `SheetContent`, `SheetHeader`, `SheetTrigger`, ...) | Radix `Dialog` based slide-in drawer (shadcn-derived), 4 sides | `app/react/components/Sheet.tsx` |
| `DropdownMenu` | Reach `Menu`-based filter dropdown with "All" + option list + counts | `app/react/components/DropdownMenu/DropdownMenu.tsx` |
| `MenuButton` / `MenuButtonLink` | Reach `Menu` styled as a split action button with chevron | `app/react/components/buttons/MenuButton.tsx` |
| `CommandPalette` | Cmd-K style global command palette | `app/react/components/CommandPalette/CommandPalette.tsx` |

### Forms

| Component | Purpose | Path |
|---|---|---|
| `FormControl` | Label + tooltip + required marker + children + inline loader + `FormError`; Bootstrap-grid-style column sizing (`col-sm-*`) | `app/react/components/form-components/FormControl/FormControl.tsx` |
| `FormError` | Warning-icon + message row, renders nothing if empty | `app/react/components/form-components/FormError.tsx` |
| `FormSection` / `FormSectionTitle` | Collapsible fieldset with optional fold/unfold | `app/react/components/form-components/FormSection/FormSection.tsx` |
| `FormActions` | Standard submit/cancel button row for forms | `app/react/components/form-components/FormActions.tsx` |
| `SwitchField` / `Switch` | Labeled toggle switch, BE-feature-flag aware (`FeatureId`) | `app/react/components/form-components/SwitchField/*` |
| `Checkbox` | Styled checkbox incl. indeterminate state | `app/react/components/form-components/Checkbox.tsx` |
| `Input` / `InputLabeled` / `Select` / `Textarea` | Base styled native inputs | `app/react/components/form-components/Input/*` |
| `InputGroup` (+ `Addon`, `ButtonWrapper`) | Bootstrap-style input-with-affix group | `app/react/components/form-components/InputGroup/*` |
| `ReactSelect` (`Select`, `Creatable`, `Async`, `TooManyResultsSelector`) | Thin wrapper over `react-select` / `react-select-async-paginate` / `-creatable`, auto-switches to async paginated mode above 1000 options | `app/react/components/form-components/ReactSelect.tsx` |
| `PortainerSelect` | Higher-level select built on `ReactSelect` with Portainer-specific option rendering | `app/react/components/form-components/PortainerSelect.tsx` |
| `AutocompleteSelect` | Free-text + suggestions combo box | `app/react/components/form-components/AutocompleteSelect/*` |
| `ButtonSelector` | Segmented single-choice button group (radio semantics) | `app/react/components/form-components/ButtonSelector/ButtonSelector.tsx` |
| `SegmentedControl` | Tab-like segmented control | `app/react/components/form-components/SegmentedControl.tsx` |
| `Slider` / `SliderWithInput` | Range slider, optionally paired with numeric input | `app/react/components/form-components/Slider/*` |
| `InputList` | Dynamic add/remove list of rows (env vars, ports, etc.) with `useInputList` hook | `app/react/components/form-components/InputList/*` |
| `EnvironmentVariablesFieldset` | Simple/advanced (.env paste) dual-mode env var editor | `app/react/components/form-components/EnvironmentVariablesFieldset/*` |
| `FileUploadField` / `FileUploadForm` | Drag/drop or click file upload with Yup file validation | `app/react/components/form-components/FileUpload/*`, `yup-file-validation.ts` |
| `FilePicker` (+ `FilePickerSkeleton`, `TreeNode`) | Tree-based remote file browser/picker with skeleton loading state | `app/react/components/form-components/FilePicker/*` |
| `ColorPicker` | Color swatch picker | `app/react/components/form-components/ColorPicker/ColorPicker.tsx` |
| `DateTimeField` | Date/time input | `app/react/components/DateTimeField.tsx` |
| `TLSFieldset` | TLS cert/key/CA upload fieldset for endpoint registration | `app/react/components/TLSFieldset/TLSFieldset.tsx` |
| `usePreventFormExit` | Blocks router transition and browser unload when a form is dirty, via `confirmGenericDiscard` | `app/react/components/form-components/usePreventFormExit.ts` |
| `validate-form.ts`, `validate-unique.ts`, `validate-url.ts` | Yup/Formik glue helpers (`validateForm`, async uniqueness check, URL validator) | `app/react/components/form-components/*.ts` |

### Buttons / actions

| Component | Purpose | Path |
|---|---|---|
| `Button` | Base button (color/size/icon variants) | `app/react/components/buttons/Button.tsx` (referenced throughout; not separately re-read but is the shared primitive) |
| `LoadingButton` | Button that swaps its icon for a spinner and its label for `loadingText` while `isLoading` | `app/react/components/buttons/LoadingButton.tsx` |
| `DeleteButton` | Danger-styled button that runs `confirmDelete(message)` before calling `onConfirmed`, or skips confirmation if `onClick` is passed | `app/react/components/buttons/DeleteButton.tsx` |
| `AddButton` | Standard "+ Add X" button | `app/react/components/buttons/AddButton.tsx` |
| `MenuButton` | See Modals section | `app/react/components/buttons/MenuButton.tsx` |
| `CopyButton` | Copy-to-clipboard button with transient "Copied" feedback | `app/react/components/buttons/CopyButton/*` |

### Feedback / status

| Component | Purpose | Path |
|---|---|---|
| `Badge` (+ `SystemBadge`, `ExternalBadge`, `WorkflowBadge`, `UnusedBadge`) | CVA-based pill/rect badge, 8 semantic color variants, bordered variant | `app/react/components/Badge/*` |
| `BadgeIcon` | Icon-only badge (e.g. count bubble) | `app/react/components/BadgeIcon/BadgeIcon.tsx` |
| `StatusBadge` / `StatusDot` | Colored dot/badge for resource status | `app/react/components/StatusBadge.tsx`, `primitives/StatusDot.tsx` |
| `Alert` | Bordered callout box, 5 color variants (`success/error/info/warn/default`), title optional | `app/react/components/Alert/Alert.tsx` |
| `Note` / `TextTip` / `InformationPanel` | Inline informational callouts of varying weight | `app/react/components/Note/Note.tsx`, `Tip/TextTip/*`, `InformationPanel.tsx` |
| `Tooltip` (in `Tip/Tooltip`) | `?`-icon that opens a `TooltipWithChildren` popover; supports raw HTML message for AngularJS interop | `app/react/components/Tip/Tooltip/Tooltip.tsx` |
| `TooltipWithChildren` | Generic hover/focus popover wrapping arbitrary children | `app/react/components/Tip/TooltipWithChildren/*` |
| `TerminalTooltip` | Tooltip variant styled for the exec-console UI | `app/react/components/TerminalTooltip/TerminalTooltip.tsx` |
| `InlineLoader` | Spinner + text, 3 sizes, used inside buttons, `FormControl`, and page fragments | `app/react/components/InlineLoader/InlineLoader.tsx` |
| `ViewLoading` | Full-view loading placeholder | `app/react/components/ViewLoading/ViewLoading.tsx` |
| `*Skeleton` components (`ResourceDetailHeaderSkeleton`, `FilePickerSkeleton`, `SortableListSkeleton`) | `animate-pulse` shaped skeleton blocks, one per composite widget, not a generic `<Skeleton>` primitive | see files above |
| `NotificationsMenu` | Bell-icon dropdown showing the last 50 persisted notifications | `app/react/components/PageHeader/NotificationsMenu.tsx` |
| `BEFeatureIndicator` / `BEOverlay` / `BETeaserButton` | "Business Edition" lock badge/overlay for CE users hitting a BE-gated feature | `app/react/components/BEFeatureIndicator/*`, `BETeaserButton.tsx` |
| `ExpandableMessageByLines` | Collapses long text/log output to N lines with a "show more" toggle | `app/react/components/ExpandableMessageByLines.tsx` |
| `CollapseExpandButton` | Chevron toggle button, shared by `FormSection`, expand columns, etc. | `app/react/components/CollapseExpandButton.tsx` |

### Layout / navigation / structural

| Component | Purpose | Path |
|---|---|---|
| `Widget` (+ `WidgetBody`, `WidgetTitle`, `WidgetFooter`, `WidgetTaskbar`, `WidgetIcon`, `Loading`) | The single card/panel container used for nearly every content block in the app | `app/react/components/Widget/*` |
| `WidgetTabs` | Tab strip variant scoped to a Widget | `app/react/components/Widget/WidgetTabs.tsx` |
| `PageHeader` (+ `Breadcrumbs`, `HeaderContainer`, `HeaderTitle`, `ContextHelp`, `AskAILink`) | Page-level title/breadcrumb/reload/help bar | `app/react/components/PageHeader/*` |
| `NavTabs` / `NavContainer` | Tab navigation (`pills` or default style), used both for page-level and in-form tabs | `app/react/components/NavTabs/NavTabs.tsx` |
| `Stepper` / `Step` / `useWizardSteps` | Horizontal numbered-step indicator + step-index state hook | `app/react/components/Stepper/*` |
| `StickyFooter` | Bottom-pinned action bar (used by wizards and long forms) | `app/react/components/StickyFooter/StickyFooter.tsx` |
| `BoxSelector` / `BoxOption` / `BoxSelectorItem` | Card-style radio/checkbox grid (e.g. environment type picker) | `app/react/components/BoxSelector/*` |
| `Card` / `Tabs` (primitives) | Generic card and tabs primitives used by newer "Design System" surfaces | `app/react/components/primitives/Card.tsx`, `primitives/Tabs/*` |
| `DashboardItem` / `DashboardGrid` | Home-dashboard summary tile + grid layout | `app/react/components/DashboardItem/*` |
| `CodeEditor` / `DiffViewer` | CodeMirror-based editor and diff viewer (compose files, configs) | `app/react/components/CodeEditor/*` |
| `Terminal` | xterm.js wrapper for exec/console | `app/react/components/Terminal/Terminal.tsx` |
| `JsonTree` | Collapsible JSON viewer | `app/react/components/JsonTree.tsx` |

---

## 2. Datatable deep dive (TanStack Table v8)

### Architecture

`Datatable.tsx` (`app/react/components/datatables/Datatable.tsx:1-300`) is a thin orchestration layer around `useReactTable`. Key structure:

- **Row models wired in unconditionally**: `getCoreRowModel`, `getFilteredRowModel`, `getPaginationRowModel`, `getFacetedRowModel`, `getFacetedUniqueValues`, `getFacetedMinMaxValues`, `getExpandedRowModel` (`Datatable.tsx:159-166`).
- **Sorting** is conditional: client-side `getSortedRowModel()` is only added when `!isServerSidePagination`; server-paginated tables instead set `manualPagination`/`manualFiltering`/`manualSorting: true` and an externally computed `pageCount` (`Datatable.tsx:167-176`).
- **Selection column** is injected via `createSelectColumn` and prepended to the caller's columns unless `disableSelect` (`Datatable.tsx:120-124`, `select-column.tsx`). Selection supports shift-click range-select (tracks `lastSelectedId` in a closure) and a header checkbox with 3 states (none/some/all), plus shift-click-header to select across all pages vs. just the current page (`select-column.tsx:14-40`).
- **Global search** uses a custom `globalFilterFn` (`defaultGlobalFilterFn`, `Datatable.tsx` bottom) that lowercases and substring-matches primitives, and recurses one level into arrays/objects (but not deeper, "to avoid searching nested objects").
- **Column filtering**: per-column `Filter`/`MultipleSelectionFilter` components (`Filter.tsx`) read `column.getFacetedRowModel()` to compute the option list and store selections as `ColumnFiltersState` via TanStack's own filter API; persisted separately via `filteredColumnsSettings` (`types.ts`).
- **Column visibility**: `ColumnVisibilityMenu.tsx` calls `table.setColumnVisibility(...)` directly and mirrors the hidden-column id list into the settings store.
- **Expandable rows**: `getRowCanExpand` prop threaded through; `expand-column.tsx` builds a dedicated expand/collapse column reusable by any Datatable-based table; `NestedDatatable`/`ExpandableDatatable` compose this for parent/child resource views (stacks -> containers, etc).
- **Row rendering is overridable**: `renderRow(row, highlightedItemId)` defaults to a plain `TableRow`, letting call sites customize row markup while keeping table mechanics centralized.
- **Server vs. client pagination is a discriminated union** (`PaginationProps` in `Datatable.tsx:38-49`): either all of `isServerSidePagination`, `totalCount`, `page`, `onPageChange` are required, or none are (`never`), enforced at the type level.
- **`CardExpandableList`** (`CardExpandableList.tsx`) is a parallel component built against the exact same `TableState`/settings contract and most of the same TanStack config, but renders `<div>` cards with a `CardExpandableListRow` instead of a `<table>`. It reuses `createSelectColumn`, `SearchBar`, `SelectedRowsCount`, `PaginationControls`. This is the primary "mobile-suited" alternative already in Portainer's own toolkit (see section 6/7).
- **`EditableDatatable`** (`editable/EditableDatatable.tsx`) demonstrates the extension mechanism: it wraps `Datatable` and injects extra behavior purely through `extendTableOptions` + a `meta` object (`withMeta`) carrying `editRow`/`updateRow`/`revertRow`/`acceptRow` callbacks that per-cell renderers pull out of `table.options.meta`. `autoResetPageIndex` is explicitly suppressed during an in-place edit via a `useSkipper` ref-based flag, otherwise editing row N on page 2 would silently reset pagination to page 1 on data mutation (a real edge case TanStack warns about).

### Feature checklist

| Feature | Supported | Mechanism |
|---|---|---|
| Client-side sorting | Yes | `getSortedRowModel()`, single-column (`sortBy: { id, desc }`), toggled via `TableHeaderSortIcons` |
| Server-side sorting | Yes | `manualSorting: true` + `handleSortChange` calls `settings.setSortBy` which the caller's query hook reads |
| Column filters (faceted) | Yes | `getFacetedRowModel/UniqueValues/MinMaxValues` + `filterHOC`/`MultipleSelectionFilter` |
| Global text search | Yes | Custom `globalFilterFn`, debounced `SearchBar`, persisted to `sessionStorage` (not the zustand store) |
| Column visibility | Yes | `table.setColumnVisibility` driven by `ColumnVisibilityMenu`, persisted in the same zustand settings store as sort/pagination |
| Pagination (client) | Yes | `getPaginationRowModel()`, `PaginationControls` |
| Pagination (server) | Yes | `manualPagination: true`, explicit `pageCount`, `page`/`onPageChange` props |
| Row selection | Yes | TanStack `enableRowSelection`, custom select column w/ shift-range and select-across-pages |
| Bulk actions | Yes | `renderTableActions(selectedRows)` prop receives the selected row *originals*; caller renders buttons that act on them |
| Expandable rows | Yes | `getRowCanExpand`, `getExpandedRowModel()`, `expand-column.tsx`, `NestedDatatable` |
| Auto-refresh | Yes (opt-in via composed settings) | `refreshableSettings` in `types.ts` + `TableSettingsMenuAutoRefresh.tsx` (10s/30s/1min/2min/5min); the interval itself is just stored, the calling view is responsible for polling on it |
| Inline row editing | Yes | `EditableDatatable` + `meta`-based callbacks |
| Settings persistence | Yes | See below |

### Persistence mechanism (exact file:line)

Two independent persistence layers exist, and Portainer has been actively migrating from the first to the second:

1. **Zustand `persist` + localStorage** (older/still-common pattern), `app/react/components/datatables/types.ts`:
   - `createPersistedStore` (`types.ts:122-139`) builds a Zustand vanilla store composed from `sortableSettings` + `paginationSettings` + a caller-supplied `create` fn, wrapped in `persist(...)`:
     ```ts
     // types.ts:122-139
     export function createPersistedStore<T extends BasicTableSettings>(
       storageKey: string,
       initialSortBy?: string | { id: string; desc: boolean },
       create: (set: ZustandSetFunc<T>) => Partial<T> = () => ({}) as T
     ) {
       return createStore<T>()(
         persist(
           (set) => ({ ...sortableSettings<T>(set, initialSortBy), ...paginationSettings<T>(set), ...create(set) } as T),
           { name: keyBuilder(`datatable_settings_${storageKey}`), version: 1 }
         )
       );
     }
     ```
   - `keyBuilder` (`app/react/hooks/useLocalStorage.ts:5-7`) prefixes every key with `portainer.`, so the actual `localStorage` key is `portainer.datatable_settings_<storageKey>`. Zustand's `persist` middleware serializes the whole state object to that key on every `set` call and rehydrates it on store creation (browser default storage = `localStorage`).
   - `useTableStateWithStorage` (`app/react/components/datatables/useTableState.ts:28-31`) is the hook call sites use: it lazily creates the store once via `useState(() => createPersistedStore(...))`, then feeds it through `useTableState` (`useTableState.ts:10-26`), which layers the *search* string on top via a **separate** hook (`useSearchBarState`, see below) rather than persisting search in the same zustand blob.
   - Column visibility (`hiddenColumnsSettings`, `types.ts:70-84`) and auto-refresh rate (`refreshableSettings`, `types.ts:87-101`) and column filters (`filteredColumnsSettings`, `types.ts:104-118`) are opt-in composables a given table's store can mix in; they are not part of `BasicTableSettings` by default (which only bundles `SortableTableSettings` + `PaginationTableSettings`, `types.ts:120-121`).
   - **Search** is persisted separately, to **`sessionStorage`**, not `localStorage`: `useSearchBarState` (`app/react/components/datatables/SearchBar.tsx:60-69`) calls `useLocalStorage(filterKey, '', sessionStorage)` with `filterKey = "datatable_text_filter_" + key` (further prefixed to `portainer.datatable_text_filter_<key>` by `keyBuilder`). So a table's sort/page-size/hidden-columns survive a browser restart, but its active search text does not (it survives only within the tab session). This is a deliberate, easy-to-miss split worth replicating consciously, not by accident.

2. **URL query params + localStorage mirror** (newer pattern for tables with a shareable/bookmarkable/deep-linkable state), `app/react/components/datatables/useTableStateFromUrl.ts`:
   - `useTableStateFromUrl` builds on `usePersistedParamsState` (`@/react/hooks/useParamState`), which keeps a whitelisted set of keys (`sort`, `order`, `groupBy`, `groupFilter`, `pageSize`, plus caller-supplied `persistedExtraKeys`) synced both into the URL query string and into `localStorage` under `datatable_${localStorageKey}_state` (`useTableStateFromUrl.ts:87-90`, further prefixed by `keyBuilder`). Non-persisted fields (`search`, `page`) live in the URL only and reset to defaults on navigation.
   - This gives shareable/back-button-friendly table state (e.g. sort + group-by survive a page refresh from a bookmarked URL) at the cost of needing `parseExtra`/`buildExtra` hooks per table for anything beyond the core shape.
   - `groupSortState.ts` layers a "group by dimension + click a dimension value to filter" behavior on top (`buildGroupSortExtras`), used for resource lists that support both "sort by X" and "drill into group X = value" from the same header click.

**Net finding**: settings persistence is store-shaped and composable (mix-in functions rather than one monolithic settings object), which keeps each table's store minimal, but there are *three* different storage substrates in play for a single table (`localStorage` via zustand persist, `sessionStorage` for the search box, and for newer tables the URL + a second `localStorage` key), which is real accidental complexity a rewrite should avoid by unifying on one persistence primitive.

---

## 3. Modal system

### Imperative opening

Modals are not JSX children mounted in the tree; they're opened **imperatively** and resolve a Promise, which is what lets `AddButton`-style call sites and even legacy AngularJS controllers (`.then()`-style) share the same confirm API:

- `openModal<TProps, TResult>(Modal, props)` (`app/react/components/modals/open-modal.tsx:8-27`) creates a `<div id="dialog-N">`, appends it to `document.body`, `ReactDOM.render`s the modal component into it with an injected `onSubmit` prop that resolves the wrapping Promise, then on submit does `unmountComponentAtNode` + removes the div. This is legacy React 17-style `ReactDOM.render`/`unmountComponentAtNode` (deprecated API surface in React 18, kept here presumably for the imperative-outside-tree use case and AngularJS interop) rather than a `createRoot` call, and it is a genuine leak risk if the returned promise never resolves (the DOM node stays mounted forever) since there's no `AbortController`/timeout unmount path.
- `Dialog<T>` (`app/react/components/modals/Dialog.tsx`) is the generic title+message+buttons body used by `openDialog`. It supports an optional **auto-resolving countdown**: the first button with a `timeout` (seconds) starts a `setInterval`, decrements a counter shown in the button label as `(N)`, and calls `onSubmit(button.value)` when it hits zero (`Dialog.tsx:29-56`) - this is used for things like "this will happen automatically in 10s" flows.

### Confirmation-dialog API

`app/react/components/modals/confirm.ts` exposes a small vocabulary built on `openConfirm` (which itself wraps `openDialog` with a cancel + confirm button pair):

- `confirm(options)` - plain OK/Cancel.
- `confirmDestructive(options)` - same but forces `modalType: ModalType.Destructive` (red header accent bar).
- `confirmDelete(message)` - `confirmDestructive` preset with title "Are you sure?" and a `buildConfirmButton('Remove', 'danger')`.
- `confirmUpdate(message, callback)` - like `confirm` but also invokes a callback with the boolean result (used to bridge into non-async legacy call sites).
- `confirmWebEditorDiscard()` / `confirmGenericDiscard()` - fixed-copy "unsaved changes" prompts used by `usePreventFormExit` and code-editor navigation guards.
- `confirmChangePassword()` - fixed-copy prompt used before a password change (warns the user will be logged out).

All resolve to `boolean` (`!!result`, `confirm.ts:24-27`), so call sites do `if (!(await confirmDelete(msg))) return;`. This exact helper (`confirmDelete`) is called from **60+ sites** across both the React tree and legacy AngularJS controllers (verified via grep: `app/agent/components/host-browser/hostBrowserController.js`, `app/docker/views/**/*.js`, `app/kubernetes/views/**/*.js`, `app/portainer/views/**/*.js`, `app/react/components/buttons/DeleteButton.tsx`, etc.) - it is the single most-reused interaction primitive in the codebase, proof that a small imperative confirm API pays for itself across a big legacy+new hybrid surface.

`SwitchPrompt`/`openSwitchPrompt` (`app/react/components/modals/SwitchPrompt.tsx`) is the same pattern extended to collect one extra boolean input (a labeled switch) inside the confirmation body, resolving `{ value: boolean } | undefined`.

### Focus trap / escape / backdrop behavior

`Modal.tsx` is built directly on `@reach/dialog`'s `DialogOverlay`/`DialogContent`, which is where focus trapping, `Escape`-to-dismiss, and click-outside-to-dismiss all come from (Reach UI's own accessible-dialog implementation; Portainer adds no custom focus-trap code on top). `onDismiss` is wired to both the backdrop and Escape by Reach's contract, and Portainer's own `CloseButton` calls the same `onDismiss`. Nested-overlay z-index is hand-managed: `Modal.tsx:44` sets `zIndex: 60` and explicitly overrides `pointerEvents: 'auto'` with a comment explaining that Radix's `DismissableLayer` (used by `Sheet`) sets `body.style.pointerEvents = 'none'` when a Sheet is open, which would otherwise make a `Modal` opened from within a `Sheet` unclickable - i.e. **two different unrelated headless-UI libraries (Reach for Modal/Menu, Radix for Sheet) coexist and their stacking/pointer-event side effects had to be manually reconciled**. This is exactly the kind of cross-library friction a from-scratch Svelte design system avoids by picking one primitive layer.

Three modal sizes (`sm/md/lg` -> actually `md/lg/xl` = 450px/700px/1000px fixed widths, `Modal.tsx:34-38`), no responsive/fluid sizing logic - width is a fixed pixel value with only a `max-w-[calc(100vw-2rem)]` clamp for small viewports.

### Forms inside modals

There's no special "modal form" component; a modal body just renders a normal Formik form, and the modal's own footer buttons (or the form's submit button) drive `onSubmit`. `SwitchPrompt` shows the simplest case (raw `useState`, no Formik, since it's one field). For more complex modal forms elsewhere in the app (not in this dossier's core paths but visible via `openModal` call sites), the pattern is: build a small standalone component with its own Formik instance, pass it to `openModal(Component, props)`, and have the component call the injected `onSubmit(result)` from its own submit handler. There is no shared "modal + Formik" wrapper component; each call site wires that manually.

---

## 4. Form system (Formik + Yup)

### Conventions

- **`validateOnMount` is the default posture on essentially every top-level form** (confirmed via grep across `azure/container-instances`, `docker/containers/CreateView`, `docker/images`, `docker/stacks`, `edge/**`, `kubernetes/cluster/ConfigureView`, `portainer/gitops/sources/CreateView`, 60+ hits total). This means the submit/continue button's disabled state (`disabled={!isValid}`) is correct from first paint, not just after the user's first edit - avoids the classic bug where an invalid empty form's submit button is enabled until the user touches something.
- Validation is schema-driven via Yup (`validationSchema` prop / `SchemaOf<T>`), and `validateForm` (`app/react/components/form-components/validate-form.ts`) is a small manual-invocation helper (`schema.validate(values, { strict: true, abortEarly: false })` -> `yupToFormErrors`) used where validation needs to run outside Formik's own lifecycle (e.g. imperative pre-submit checks, or wizard step gating - see section 6).
- `enableReinitialize` is used selectively (only where the form's initial values load asynchronously after mount, e.g. `CreateContainerInstanceForm.tsx`, `StackEditorTab.tsx`, `ConfigureForm.tsx`), not globally - keeping it off elsewhere avoids the well-known Formik pitfall of resetting user edits whenever a background refetch changes `initialValues`.
- `Form` (Formik's own) plus native `noValidate` shows up on wizard forms to suppress the browser's own HTML5 validation UI in favor of Yup+`FormError`.
- **Async/cross-field/debounced validation**: `useCachedTest.ts` and `validate-unique.ts` (`app/react/components/form-components/`) implement a memoizing Yup `.test()` wrapper so expensive async uniqueness checks (e.g. "is this container name already taken") aren't refired on every keystroke of unrelated fields - this is a real, non-obvious problem (naive async Yup tests refire on every validate pass) solved once and reused.

### Composition primitives

- **`FormControl`** (`FormControl/FormControl.tsx`) is the field-row wrapper: label (with Bootstrap `col-sm-*` width class keyed off a `size` prop: `xsmall/small/medium/large/vertical`), optional required-asterisk, optional `Tooltip`, children, and `FormError` rendered below. It also has a built-in **loading-state affordance**: `isLoading` swaps the children for an `InlineLoader` inside a fixed `h-[34px]` box specifically to "reduce layout shift when loading is complete" (`FormControl.tsx:63-67`) - a small but concrete anti-jank detail worth keeping.
- **`FormError`** renders nothing if falsy (so call sites can pass `errors={formik.errors.name}` unconditionally), otherwise a warning-triangle icon + text, `role="alert"`.
- **`FormSection`** is a `<section>` with a title bar (`FormSectionTitle`) and optional fold/unfold (`CollapseExpandButton`), used to break a long form into named groups without leaving the current page (contrast with the wizard pattern, section 6).
- Grid sizing is **Bootstrap-era `col-sm-N`/`col-lg-N` classes**, not a Tailwind grid/flex system, despite Tailwind being used everywhere else for spacing/color - this is legacy CSS debt baked into a "new" component (`FormControl.tsx:78-99`), evidence the form grid was never fully modernized even in React-rewritten components.

### Switch / toggle and select primitives

- **`Switch`** (`SwitchField/Switch.tsx`) is a plain checkbox styled as an iOS-style slider via CSS (`Switch.css`), not a Radix/Reach primitive - no keyboard-focus ring customization beyond the browser default, and it is **feature-flag aware out of the box**: if `featureId` is set and `isLimitedToBE(featureId)` is true, the switch is force-disabled and a `BEFeatureIndicator` badge is rendered next to it (`Switch.tsx:37-52`). This couples a generic UI primitive to the CE/BE licensing model directly inside the component, rather than at the call site - a boundary a rewrite should keep clean (licensing checks should wrap the primitive, not live inside it).
- **`SwitchField`** adds the label, tooltip, and optional `valueExplanation` text next to a `Switch`.
- **Select** has three layers: `Select`/`Creatable`/`Async` (`ReactSelect.tsx`) are direct `react-select` wrappers (auto-upgrading a plain sync `Select` to `Async`+client-side-paginated `TooManyResultsSelector` once options exceed 1000, `ReactSelect.tsx:88-97`), and `PortainerSelect.tsx` is the app-specific higher-level component built on top with custom option renderers (`PortainerSelectCustomRenderers.tsx`). This is a real, working "virtualize implicitly past a threshold" pattern worth stealing conceptually (even if the underlying library differs in a Svelte rewrite).

---

## 5. Feedback patterns

### Toasts / notifications - two independent layers

1. **Transient toast** (`app/portainer/services/notifications.ts`): thin wrapper over the **`toastr`** jQuery-era library (not React-native, not accessible via ARIA live regions beyond whatever `toastr` itself provides). `notifySuccess`/`notifyWarning`/`notifyError` all: (a) sanitize the title/text with `sanitize-html` + `_.escape` before interpolating into `toastr`'s HTML-based API, (b) persist a copy into a Zustand-backed notification store, (c) fire the actual toast. Timeouts: success = library default (configured globally to 3000ms, `notifications.ts:12-16`), warning/error = 6000ms explicit override. `notifyError` additionally has an error-message-extraction heuristic (`pickErrorMsg`, tries ~10 possible property paths like `err.data.details`, `data.message`, `msg`, etc., to cope with inconsistent backend error shapes) and suppresses the toast entirely (but still logs to console and saves to history) for the specific message `"Invalid JWT token"` to avoid spamming users on session-expiry storms.
2. **Persisted notification center** (`app/react/portainer/notifications/notifications-store.ts`): a Zustand store, `persist`-backed to `localStorage` key `portainer.notifications`, keyed by `userId -> ToastNotification[]`, newest-first, capped for *display* at 50 (`NotificationsMenu.tsx:33`, note: not capped in storage, only in the render slice - a latent unbounded-growth issue). Surfaced via a bell icon (`NotificationsMenu.tsx`) with individual delete, "clear all", and a link to a full `/notifications` list view. Each entry shows a relative-time string it recomputes ad hoc (`formatTime`, hours/minutes buckets under 24h, else absolute date via Moment) rather than a library like `date-fns`/`dayjs` formatDistance.

### Inline loaders

`InlineLoader` (`Loader2` icon + `animate-spin-slow` + text) is the single spinner-with-label primitive reused inside `LoadingButton`, `FormControl`'s loading slot, and standalone page fragments. There's no skeleton variant of it - loading states are either this spinner+text row, or a bespoke `*Skeleton` component per composite widget (see below). No unified `<Skeleton>` primitive exists.

### Skeletons

Skeleton components are hand-built per composite (`ResourceDetailHeaderSkeleton`, `FilePickerSkeleton`, `SortableListSkeleton`), each independently reimplementing `animate-pulse` + hardcoded shaped `div`s that approximate the real widget's layout. There is no generic `<Skeleton width height />` primitive to compose from - each skeleton is bespoke markup. **Datatables specifically do not use skeletons at all**: `TableContent.tsx` renders a plain single-column `<tr><td>Loading...</td></tr>` text row for both the loading and empty states (`TableContent.tsx:17-27`), and `CardExpandableList` does the same with a centered "Loading..." / empty-label text block. This is a real, consistent gap: Portainer's most-used composite (the datatable) has the least effort put into its loading affordance.

### Empty states

Also minimal: a single centered muted-text line (`"No items available."` default, overridable via `emptyContentLabel`/`emptyContent` prop), no illustration, no call-to-action slot, no distinction between "no data at all" vs. "no results for this filter/search" (both render the same generic string unless the call site manually varies `emptyContentLabel` based on whether a filter is active).

### Error boundaries

**None found.** Grepping the entire `app/react` tree for `ErrorBoundary`/`componentDidCatch`/`react-error-boundary` returns zero matches. Errors during render are not caught anywhere in the component tree; the only structured error handling is imperative (`notifyError` inside mutation `onError` handlers, try/catch around explicit async calls). A crash in a deeply nested React component will white-screen that view with no fallback UI. This is a concrete gap worth deliberately fixing in a rewrite rather than replicating.

---

## 6. Wizard pattern

Two distinct, **not shared**, wizard implementations coexist in this codebase, representing an older and a newer generation of the same idea:

### A. Environment-creation wizard (older pattern) - `app/react/portainer/environments/wizard/EnvironmentsCreationView/EnvironmentsCreationView.tsx`

- **Step model**: steps come from a static config list (`environmentTypes`) filtered by which types the user picked on a prior screen (`EnvironmentTypeSelectView`); step identity and progress live in the **URL** (`?step=<id>` router param), not component state - `currentStepIndex` is derived by looking up `urlStep` in the `steps` array (`EnvironmentsCreationView.tsx:60-64`). Navigating "Back"/"Continue" calls `router.stateService.go('.', { step: ... })`.
- **State persistence across steps**: each step's own sub-form (`WizardDocker`, `WizardAzure`, `WizardKubernetes`, `WizardPodman`) is an independent, self-contained Formik form that calls `onCreate(environment, analyticsKey)` on its own successful submit (i.e. each step actually performs its own network call and creates a real environment immediately, rather than accumulating a single multi-step draft object client-side). The parent only accumulates the **resulting environment IDs** (`setEnvironmentIds`) to render a running list (`WizardEndpointsList`) and per-step analytics counters.
- **Validation gating**: none at the wizard-navigation level - "Continue"/"Back" buttons are never disabled based on form validity; each step's internal form has its own submit button and its own validation, and the outer Continue/Back pair merely changes which step is displayed. This means a user actually creating an environment must submit each per-type form explicitly; the wizard chrome around it is just a stepper display.

### B. GitOps source wizard (newer pattern) - `app/react/portainer/gitops/sources/CreateView/*`

- **Step model**: `WizardStep` (`WizardContext.tsx:8-11`) = `{ id, label, component: ComponentType, validateStep: () => YupSchema }`; a static `steps` array is passed straight to the generic `useWizardSteps` hook (`app/react/components/Stepper/useWizardSteps.ts`) which manages `stepIndex` as plain component state (no URL involvement here) and exposes `currentStep/isFirstStep/isLastStep/canGoBack/canGoForward/goToNextStep/goToPreviousStep/goToStep/goToStepByIndex`.
- **State persistence**: a **single Formik instance wraps the entire wizard** (`CreateForm.tsx`), holding one `FormValues` object for all steps combined; only the `currentStep.component` is rendered inside the `<Form>` at a time, but all fields' values persist in the one Formik state regardless of which step is visible - so going back to step 1 after filling step 2 does not lose step-2 data (contrast with resetting per-step local state).
- **Validation gating**: the `validationSchema` passed to the wrapping `<Formik>` is **dynamically swapped per step** by calling `currentStep.validateStep()` (each step exports its own schema, e.g. `validateConfigureStep`, `validateAccessControlStep`), and `WizardFooter.tsx` disables the primary action button with `disabled={!isValid}` sourced straight from `useFormikContext()` - i.e. per-step Yup validation directly gates whether "Continue"/"Create" is clickable, and the actual network submission only happens once, on the last step (`isLastStep ? 'Create' : 'Continue'`).
- This is the materially better of the two patterns: **one shared step-index hook (`useWizardSteps`), one Formik instance for the whole flow, per-step Yup schema swapped in as the active `validationSchema`, and a generic `WizardFooter` reading `isValid`/`isSubmitting` from Formik context** - directly portable to a Svelte 5 rewrite (steps array + a small step-store + validation schema per step).

### Container-creation form (not a wizard) - `app/react/docker/containers/CreateView/CreateView.tsx` + `CreateInnerForm.tsx`

Deliberately **not** modeled as a multi-step wizard despite being the most complex creation form in the app. It's a single `Formik` instance (`validateOnMount`, full `validationSchema` covering every field up front) rendering one always-visible "base" section (name/image/registry/access-control) plus a `NavTabs` (`type="pills"`, `justified`) holding 8 tabs (Commands & logging, Volumes, Network, Env, Labels, Restart policy, Runtime & resources, Capabilities) that are all part of the *same* form/validation state - switching tabs never loses or re-validates only-the-current-tab's data, because everything validates together against one schema (`CreateView.tsx:118-121`, `CreateInnerForm.tsx:53-58`). Submission triggers a single `mutation.mutate(...)` call; a pre-submit `confirmDestructive` prompt is inserted only when replacing an existing same-named container (`CreateView.tsx:132-146`). This "flat form + tabs for organization, not for sequencing" pattern is a strong precedent for a Compose-file-editing UI where most fields are genuinely peers, not a sequence: **prefer this over a wizard whenever steps aren't causally ordered**.

---

## 7. The 12 patterns most worth stealing (Svelte 5 + Material 3 rewrite)

1. **`validateOnMount` as the default posture for every form.** Submit/continue affordances should reflect real validity from first paint, not only after first interaction. Cheap correctness win, directly portable to any reactive form library. (`useValidation`/`validateOnMount` usage across 60+ call sites.)
2. **Promise-based imperative confirm API (`confirmDelete`, `confirmDestructive`, etc.) as the single vocabulary for destructive actions.** One tiny module, reused 60+ times across old and new code, with consistent copy ("Are you sure?") and consistent danger styling. In Svelte, implement as a small store-driven singleton dialog + a `confirmDelete(message): Promise<boolean>` function - keeps call sites at `if (!(await confirmDelete(msg))) return;` with zero per-call-site markup. (`app/react/components/modals/confirm.ts`)
3. **One shared TanStack-Table-equivalent state contract reused by two renderers (table vs. cards).** `Datatable` and `CardExpandableList` consume the *same* `settingsManager`/columns/dataset shape and differ only in the leaf renderer. For a mobile-first rewrite, design the table logic (sort/filter/paginate/select state) once, independent of whether the leaf view is a `<table>` or a stacked-card list, so desktop and mobile share one data layer. (`Datatable.tsx`, `CardExpandableList.tsx`)
4. **Shift-click range selection and select-across-all-pages-vs-current-page on the header checkbox**, with a real 3-state (none/some/all) header checkbox. Small, well-executed detail that materially speeds up bulk operations on long lists. (`select-column.tsx:14-63`)
5. **Composable settings-store mixins (`sortableSettings`, `paginationSettings`, `hiddenColumnsSettings`, `refreshableSettings`, `filteredColumnsSettings`) instead of one monolithic table-settings shape.** Each table opts into exactly the persisted fields it needs. Translate directly to Svelte stores/runes: small composable factories merged into one per-table store. (`app/react/components/datatables/types.ts`)
6. **Per-step Yup-schema-swap + single-Formik-instance wizard pattern (gitops CreateView), not the URL-driven/self-submitting-per-step older pattern.** One flow-level form state, one step-index store, `disabled={!isValid}` sourced from the active step's schema. This is the correct wizard architecture to port; explicitly avoid porting the older environment-wizard's "each step submits independently" model. (`app/react/portainer/gitops/sources/CreateView/{WizardContext,CreateForm,WizardFooter}.tsx`)
7. **"Flat form + tabs for organization, not sequencing" for non-linear multi-section forms (container create).** Don't force a wizard onto fields that are true peers (compose service config sections are exactly this shape) - validate the whole thing together, use tabs purely as a visual grouping/navigation aid. (`docker/containers/CreateView/CreateInnerForm.tsx`)
8. **Dual notification layers: transient toast + persisted, dismissible notification center, decoupled from each other.** The bell-icon history is genuinely useful for "what happened while I wasn't looking" on a control panel that fires background mutations; keep the concept (a durable, per-user event log a toast merely announces) even though the concrete implementation (`toastr` + ad hoc localStorage cap-at-render-time) should not be copied verbatim. (`app/portainer/services/notifications.ts`, `notifications-store.ts`, `NotificationsMenu.tsx`)
9. **Error-message extraction heuristic across inconsistent API error shapes** (`pickErrorMsg` trying `err.data.details`, `data.message`, `msg`, etc.) and **suppressing noisy known-benign errors (JWT-expiry) from the toast layer** while still logging/recording them. A pragmatic pattern for surfacing backend errors from an API you don't fully control the shape of. (`notifications.ts:73-99`)
10. **`FormControl`'s built-in loading slot with a fixed-height placeholder to prevent layout shift** (`h-[34px]` box swapped for the real control on load). Tiny but concrete anti-CLS (Cumulative Layout Shift) discipline worth encoding directly into the base form-field component rather than leaving to each call site. (`FormControl.tsx:63-67`)
11. **Debounced search input with client-visible-immediately + async-apply-later split** (`useDebounce` local state updates the input instantly; `onChange`/actual filter application is debounced), decoupled from persistence choice (session vs. local storage) per field. Keep the debounce-input mechanism; make the persistence-tier choice a single deliberate policy instead of per-component happenstance (see reject #6 below). (`SearchBar.tsx`)
12. **Auto-upgrade a plain select to an async, paginated, virtualized-by-fetch select once the option count crosses a threshold (1000), transparently to the call site.** Good general pattern for a Compose-file/registry/image picker UI that might face large option sets (e.g. hundreds of images/tags) without needing every call site to pre-decide "is this a big list." (`ReactSelect.tsx:88-97`)

## 8 patterns worth rejecting

1. **Mixing two headless UI libraries (Reach UI for Modal/Menu, Radix for Sheet) in the same app**, which required a hand-documented `pointerEvents` workaround (`Modal.tsx:44-46`) because Radix's `DismissableLayer` fights Reach's overlay stacking. Pick exactly one primitives layer for the rewrite.
2. **Legacy `ReactDOM.render`/`unmountComponentAtNode` imperative mounting for modals** (`open-modal.tsx`) - deprecated React API, and has no safety net if the returned promise never resolves (permanent DOM/leak). A rewrite (Svelte has no equivalent legacy-API baggage, but the general lesson holds) should use a proper portal/store-driven overlay manager with guaranteed cleanup, not manual DOM node lifecycle management.
3. **No error boundaries anywhere in the React tree.** A render-time exception in any nested component white-screens that entire view with zero fallback UI. Must build boundary/fallback handling in from day one in the rewrite, not bolt it on later.
4. **Bootstrap-era `col-sm-N`/`col-lg-N` grid classes baked directly into "modernized" components like `FormControl`** (`FormControl.tsx:78-99`) despite Tailwind utility classes being used everywhere else. This is exactly the kind of two-conventions-for-one-concept debt to never introduce in a greenfield rewrite: pick one layout system (CSS Grid/Flex via Tailwind or native CSS) and never mix in a second grid metaphor.
5. **Three different persistence substrates for one logical "table state" concept** (zustand+localStorage for sort/page/columns, sessionStorage for search text, and for newer tables a second localStorage key plus URL params) - accidental complexity from incremental evolution rather than a deliberate design. Unify on one persistence primitive (e.g. one URL+localStorage-synced store shape) from the start.
6. **Bespoke, one-off skeleton components per composite widget with zero shared primitive**, while the single most-used composite (`Datatable`) has *no* skeleton at all and instead shows a bare `Loading...` text row in place of the table body. Build one generic `<Skeleton>` primitive (rows/blocks/text-line variants) and use it uniformly, including for tables.
7. **Licensing/feature-flag logic (`isLimitedToBE`, `BEFeatureIndicator`) embedded directly inside a generic UI primitive (`Switch.tsx:37-52`)** rather than composed at the call site. Couples a reusable atom to a business concern that has zero equivalent in a from-scratch open product; even if a future paywall exists, keep the primitive licensing-agnostic and wrap it externally.
8. **Empty-state and loading-state copy is a single hardcoded generic string with no distinction between "genuinely no data," "no results for the current filter," and "error loading data."** (`emptyContentLabel = 'No items available.'` covers all three by default.) A rewrite should treat these as three distinct, purposefully designed states, especially valuable for a mobile-first Compose panel where screen space for guidance text is scarcer and clarity matters more.
