/**
 * Every mdui custom element the app renders, registered once. Cherry-picked rather than
 * importing the barrel so the bundle carries only what is used.
 */
import "mdui/mdui.css";

// Self-hosted Material Icons, the two variants the app uses. mdui resolves an icon `name`
// suffix to one of these font families, so without them every icon renders as its own name.
import "@fontsource/material-icons";
import "@fontsource/material-icons-outlined";
import "@fontsource/jetbrains-mono";

import "mdui/components/badge.js";
import "mdui/components/button.js";
import "mdui/components/button-icon.js";
import "mdui/components/card.js";
import "mdui/components/checkbox.js";
import "mdui/components/chip.js";
import "mdui/components/circular-progress.js";
import "mdui/components/collapse.js";
import "mdui/components/collapse-item.js";
import "mdui/components/dialog.js";
import "mdui/components/divider.js";
import "mdui/components/dropdown.js";
import "mdui/components/fab.js";
import "mdui/components/icon.js";
import "mdui/components/layout.js";
import "mdui/components/layout-item.js";
import "mdui/components/layout-main.js";
import "mdui/components/linear-progress.js";
import "mdui/components/list.js";
import "mdui/components/list-item.js";
import "mdui/components/list-subheader.js";
import "mdui/components/menu.js";
import "mdui/components/menu-item.js";
import "mdui/components/navigation-bar.js";
import "mdui/components/navigation-bar-item.js";
import "mdui/components/navigation-drawer.js";
import "mdui/components/navigation-rail.js";
import "mdui/components/navigation-rail-item.js";
import "mdui/components/segmented-button.js";
import "mdui/components/segmented-button-group.js";
import "mdui/components/select.js";
import "mdui/components/switch.js";
import "mdui/components/tab.js";
import "mdui/components/tab-panel.js";
import "mdui/components/tabs.js";
import "mdui/components/text-field.js";
import "mdui/components/tooltip.js";
import "mdui/components/top-app-bar.js";
import "mdui/components/top-app-bar-title.js";
