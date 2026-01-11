# Column Panels (column_panels)

This module provides a simple “column-docked” floating panel system for Xavi Multi Grid.

- Column width is fixed at **350px** (via `--xavi-col-w`, default 350).
- Panels are horizontal-only (drag/resize on X axis only).

## Global API

When loaded, this module exposes:

- `window.XaviColumnPanels`

### `openPanel(options)`

Opens (or re-shows) a panel.

```js
window.XaviColumnPanels.openPanel({
  id: 'social-firehose',
  title: 'Firehose',
  // optional
  workspace: document.querySelector('xavi-multi-grid'),
  buildContent: () => {
    const el = document.createElement('div');
    el.textContent = 'Hello';
    return el;
  }
});
```

Options:

- `id` (required): stable panel id.
- `title` (optional): title shown in the panel titlebar and taskbar entry.
- `workspace` (optional): workspace element to attach to.
- `buildContent` (optional): `() => Node` to populate the panel.
- `colSpan` (optional): requested width in columns.
- `colStart` (optional): requested starting column.
- `responsive` (optional, default `true`): enables responsive span + reflow.
- `registerInTaskbar` (optional, default `true`): registers a taskbar launcher entry.
- `icon`, `category`, `priority` (optional): metadata used for the taskbar entry.

Behavior:

- If `colStart` is not provided, the panel is placed into the **left-most open column range**.
- If a 2-column panel cannot fit, placement falls back to a 1-column panel.

### `movePanel(id, deltaCols)`

Moves an existing panel by `deltaCols` columns (negative = left).

### `openPanelsManager(options)`

Opens a “Panels” manager panel that lists current panels and lets you reorder them.

- Uses vendored **SortableJS (MIT)** for drag reordering (loaded from `js/vendor/Sortable.min.js`).
- Reordering affects the manager’s internal ordering and therefore the left-to-right reflow order.

### `reorderPanels(panelIds)`

Reorders the internal panel list (Map insertion order). Used by the Panels manager.

### `_applyGeometry(id)`

Internal helper: clamps and applies `colStart/colSpan` into pixel `left/width`.

## Responsiveness

Responsiveness is based on how many 350px columns fit in the workspace.

- If the workspace can fit **4 or more columns**, new panels default to **2 columns**.
- If the workspace is narrower, panels default to **1 column**.

On resize:

- Visible panels are automatically reflowed left-to-right to avoid overlap.
- Responsive panels will **shrink** to 1 column when narrow, and **grow back** to 2 columns when wide.
- Manual resizing (drag-resize or using the +/- titlebar buttons) disables responsiveness for that panel.

## Taskbar integration

When `registerInTaskbar !== false`, `openPanel()` registers a taskbar launcher entry:

- id: `column-panel:<panelId>`
- launch behavior: if the panel exists, it is shown and brought to front; otherwise it is created.

This uses `window.registerTaskbarPanel` (provided by the `utils/panel-registry` module).
