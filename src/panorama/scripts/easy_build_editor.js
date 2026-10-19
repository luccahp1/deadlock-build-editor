"use strict";
// Easy Build Editor
//
// Runs inside the shop's build panel (CitadelShopModsBuild). The real editing
// is still done by the game: every change goes through the game's own build
// commands and panels, so saving, sharing and publishing work as normal. This
// script only rearranges what is on screen and adds shortcuts.

var EasyBuildEditor = (function () {
    const LOG_PREFIX = "[EasyBuildEditor] ";
    const TICK_EDITING = 0.2;
    const TICK_IDLE = 0.5;
    // Full-screen layout: edit sidebar | shop | build.
    const SIDEBAR_SCALE = 0.8;
    const SIDEBAR_WIDTH = 520; // CitadelHudHeroBuilds width in the game's CSS
    const SIDEBAR_LEFT = 20;
    const GAP = 16;
    const SHOP_NATIVE_WIDTH = 1110; // shop list width inside the game's 1200px MainPanel
    const SHOP_SHARE = 0.6;
    const BUILD_SCALE = 0.85;
    const STARTER_SECTIONS = ["Early Game", "Mid Game", "Late Game", "Situational"];

    const buildPanel = $.GetContextPanel();
    let wanted = false;
    let applied = false;
    let splitWanted = true;
    let splitApplied = false;
    let tickScheduled = false;
    let dumped = false;
    let pendingNames = [];

    function log(message) {
        $.Msg(LOG_PREFIX + message);
    }

    function find(id) {
        return buildPanel.FindChildTraverse(id);
    }

    function hudRoot() {
        let panel = buildPanel;
        while (panel.GetParent()) {
            panel = panel.GetParent();
        }
        return panel;
    }

    function isEditing() {
        for (let panel = buildPanel; panel; panel = panel.GetParent()) {
            if (panel.BHasClass("gEditingBuilds")) {
                return true;
            }
        }
        return false;
    }

    function shopPanel() {
        const parent = buildPanel.GetParent();
        return parent ? parent.FindChild("ShopModsFiltered") : null;
    }

    function categories() {
        const container = find("CategoryContainer");
        if (!container) {
            return [];
        }
        return container.Children().filter(c => c.paneltype === "CitadelShopModsBuildCategory");
    }

    function categoryName(category) {
        const label = category.FindChildTraverse("BuildCategoryName");
        const text = label ? label.text : "";
        return text && text.length > 0 ? text : "Untitled section";
    }

    function itemCount(category) {
        const mods = category.FindChildTraverse("ModsContainer");
        return mods ? mods.GetChildCount() : 0;
    }

    function setStatus(text) {
        const status = find("EasyStatus");
        if (status) {
            status.text = text;
        }
    }

    function dispatch(eventName, ...args) {
        try {
            $.DispatchEvent(eventName, buildPanel, ...args);
            return true;
        } catch (e) {
            log(`dispatch ${eventName} failed: ${e}`);
            return false;
        }
    }

    // ---- full-screen layout: edit sidebar | shop | build ----

    // Every inline style we set is recorded so turning Easy mode off can hand
    // the panels back to the game's own CSS.
    const touched = [];

    function setStyle(panel, prop, value) {
        if (!panel) {
            return;
        }
        if (!touched.some(t => t.panel === panel && t.prop === prop)) {
            touched.push({ panel: panel, prop: prop });
        }
        panel.style[prop] = value;
    }

    function restoreStyles() {
        for (const t of touched) {
            if (t.panel.IsValid && !t.panel.IsValid()) {
                continue;
            }
            t.panel.style[t.prop] = null;
        }
        touched.length = 0;
    }

    function ancestorById(id) {
        for (let panel = buildPanel.GetParent(); panel; panel = panel.GetParent()) {
            if (panel.id === id) {
                return panel;
            }
        }
        return null;
    }

    function editSidebar() {
        const section = hudRoot().FindChildTraverse("EditBuildSection");
        return section ? section.GetParent() : null;
    }

    function screenWidth() {
        const root = hudRoot();
        const scale = root.actualuiscale_x || 1;
        return Math.round(root.actuallayoutwidth / scale) || 1920;
    }

    function logLayout(shop) {
        if (!shop) {
            return;
        }
        log(`layout: screen=${screenWidth()} shop=${shop.actuallayoutwidth}x${shop.actuallayoutheight} ` +
            `scale=${shop.actualuiscale_x} build=${buildPanel.actuallayoutwidth} x=${buildPanel.actualxoffset}`);
    }

    function applySplit(on) {
        if (!on) {
            restoreStyles();
            splitApplied = false;
            updateSplitLabel();
            return;
        }

        const sidebarRight = SIDEBAR_LEFT + Math.round(SIDEBAR_WIDTH * SIDEBAR_SCALE);
        const mainWidth = screenWidth() - sidebarRight - GAP * 2;

        setStyle(editSidebar(), "uiScale", `${SIDEBAR_SCALE * 100}%`);
        setStyle(ancestorById("Shop"), "marginRight", "0px");
        setStyle(ancestorById("Shop"), "width", "100%");
        setStyle(ancestorById("MainPanel"), "width", `${mainWidth}px`);
        setStyle(ancestorById("MainPanel"), "marginRight", `${GAP}px`);
        setStyle(ancestorById("ShopModsContainer"), "marginRight", "0px");

        const listsWidth = mainWidth - 90; // minus the shop's tab strip
        const shopWidth = Math.round(listsWidth * SHOP_SHARE);
        const shopScale = Math.min(1, shopWidth / SHOP_NATIVE_WIDTH);

        // ui-scale also scales the panel's own px width, so widths are given
        // in the panel's scaled units: native width * scale = space on screen.
        const shop = shopPanel();
        setStyle(shop, "width", `${SHOP_NATIVE_WIDTH}px`);
        setStyle(shop, "uiScale", `${Math.round(shopScale * 100)}%`);
        setStyle(shop, "horizontalAlign", "left");
        setStyle(shop, "opacity", "1");
        setStyle(shop, "transform", "none");
        setStyle(shop, "overflow", "clip clip");
        setStyle(shop, "zIndex", "0");
        if (shop) {
            shop.visible = true;
        }

        const buildWidth = listsWidth - shopWidth - GAP;
        setStyle(buildPanel, "width", `${Math.floor(buildWidth / BUILD_SCALE)}px`);
        setStyle(buildPanel, "uiScale", `${BUILD_SCALE * 100}%`);
        setStyle(buildPanel, "horizontalAlign", "right");
        setStyle(buildPanel, "opacity", "1");
        setStyle(buildPanel, "transform", "none");
        // Above the shop, so drops onto a section reach the section.
        setStyle(buildPanel, "zIndex", "20");
        buildPanel.visible = true;

        if (!splitApplied) {
            $.Schedule(0.5, () => logLayout(shop));
        }
        splitApplied = true;
        updateSplitLabel();
    }

    function updateSplitLabel() {
        const label = find("EasySplitLabel");
        if (label) {
            label.text = splitWanted ? "Hide shop" : "Show shop";
        }
    }

    // Keep the section list starting right under the toolbar, whatever height
    // the toolbar ends up at.
    function placeCategories() {
        const toolbar = find("EasyToolbar");
        const container = find("CategoryContainer");
        if (!toolbar || !container || toolbar.actuallayoutheight <= 0) {
            return;
        }
        const scale = toolbar.actualuiscale_y || 1;
        const bottom = Math.ceil((toolbar.actualyoffset + toolbar.actuallayoutheight) / scale);
        setStyle(container, "marginTop", `${bottom + 6}px`);
    }

    // ---- per-category tidy up ----

    function tidyCategory(category, on) {
        category.style.minWidth = on ? "100%" : null;
        for (const id of ["CategoryDragHandle", "CategoryResizeHandle"]) {
            const handle = category.FindChildTraverse(id);
            if (handle) {
                handle.style.visibility = on ? "collapse" : null;
            }
        }
        const header = category.FindChildTraverse("BuildCategoryHeader");
        if (header) {
            header.style.backgroundColor = on && category.BHasClass("Focused") ? "#3fb37f55" : null;
        }
    }

    function refreshSelection(list) {
        const card = find("EasySelectedCard");
        const nameLabel = find("EasySelectedName");
        const metaLabel = find("EasySelectedMeta");
        if (!card || !nameLabel || !metaLabel) {
            return;
        }

        const index = list.findIndex(c => c.BHasClass("Focused"));
        card.SetHasClass("HasSelection", index >= 0);
        if (index < 0) {
            nameLabel.text = list.length === 0 ? "No sections yet" : "No section selected";
            metaLabel.text = list.length === 0 ? "Add one with the buttons below" : "Click a section below";
            return;
        }

        const count = itemCount(list[index]);
        nameLabel.text = categoryName(list[index]);
        metaLabel.text = `Section ${index + 1} of ${list.length}  |  ${count} item${count === 1 ? "" : "s"}`;
    }

    function totalItems(list) {
        return list.reduce((sum, c) => sum + itemCount(c), 0);
    }

    // ---- naming new sections ----

    function categoryNameEntry() {
        return hudRoot().FindChildTraverse("CategoryNameTextEntry");
    }

    function nameFocusedCategory(name, previousCount) {
        const list = categories();
        if (list.length <= previousCount) {
            return false; // not created yet
        }
        const newest = list[list.length - 1];
        if (!newest.BHasClass("Focused")) {
            log("new section is not focused, leaving its default name");
            return true;
        }
        const entry = categoryNameEntry();
        if (entry && name) {
            entry.text = name;
            log(`named new section "${name}"`);
        }
        return true;
    }

    function processPendingNames() {
        if (pendingNames.length === 0) {
            return;
        }
        const job = pendingNames[0];
        job.tries++;
        if (nameFocusedCategory(job.name, job.previousCount) || job.tries > 15) {
            pendingNames.shift();
            if (pendingNames.length > 0) {
                const next = pendingNames[0];
                next.previousCount = categories().length;
                dispatch("CitadelHudHeroBuildsAddNewCategory");
            }
        }
    }

    function queueSection(name) {
        const job = { name: name, previousCount: categories().length, tries: 0 };
        pendingNames.push(job);
        if (pendingNames.length === 1) {
            dispatch("CitadelHudHeroBuildsAddNewCategory");
        }
    }

    // ---- main loop ----

    function apply(on) {
        if (on === applied) {
            return;
        }
        applied = on;
        buildPanel.SetHasClass("EasyEdit", on);
        applySplit(on && splitWanted);
        for (const category of categories()) {
            tidyCategory(category, on);
        }
        log(on ? "easy mode on" : "easy mode off");
    }

    function tick() {
        tickScheduled = false;
        if (!wanted) {
            apply(false);
            return;
        }

        const editing = isEditing();
        apply(editing);

        if (editing) {
            const list = categories();
            for (const category of list) {
                tidyCategory(category, true);
            }
            if (splitWanted) {
                // The game hides whichever tab is not selected; keep both up.
                applySplit(true);
            }
            placeCategories();
            refreshSelection(list);
            processPendingNames();
            setStatus(`${list.length} section${list.length === 1 ? "" : "s"}, ${totalItems(list)} items`);
        }

        schedule(editing ? TICK_EDITING : TICK_IDLE);
    }

    function schedule(delay) {
        if (!tickScheduled) {
            tickScheduled = true;
            $.Schedule(delay, tick);
        }
    }

    // ---- diagnostics, printed once to the console so the mod can be tuned ----

    function describe(panel) {
        const classes = [];
        for (const c of ["Focused", "Optional", "EasyEdit", "gEditingBuilds", "gShopOpen"]) {
            if (panel.BHasClass(c)) {
                classes.push(c);
            }
        }
        return `${panel.paneltype}#${panel.id}${classes.length ? " ." + classes.join(".") : ""} children=${panel.GetChildCount()}`;
    }

    function dumpTree(panel, depth, maxDepth, out) {
        out.push("  ".repeat(depth) + describe(panel));
        if (depth >= maxDepth) {
            return;
        }
        for (const child of panel.Children()) {
            dumpTree(child, depth + 1, maxDepth, out);
        }
    }

    function dumpOnce() {
        if (dumped) {
            return;
        }
        dumped = true;
        const lines = [];
        for (let panel = buildPanel; panel; panel = panel.GetParent()) {
            lines.push("ancestor " + describe(panel));
        }
        dumpTree(buildPanel, 0, 4, lines);
        const shop = shopPanel();
        if (shop) {
            dumpTree(shop, 0, 3, lines);
        }
        for (const line of lines) {
            log(line);
        }
    }

    // ---- public, called from the layout ----

    return {
        Toggle() {
            wanted = !wanted;
            dumpOnce();
            if (wanted) {
                dispatch("CitadelHudHeroBuildsCompactCategory", -1);
            }
            tick();
        },
        ToggleSplit() {
            splitWanted = !splitWanted;
            applySplit(false);
            applySplit(splitWanted && applied);
            for (const category of categories()) {
                tidyCategory(category, applied);
            }
        },
        AddSection(name) {
            queueSection(name);
        },
        AddStarterTemplate() {
            for (const name of STARTER_SECTIONS) {
                queueSection(name);
            }
        },
    };
})();
