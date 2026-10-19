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
    const BUILD_WIDTH = "46%";
    const SHOP_WIDTH = "54%";
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

    // ---- split view: shop items on the left, build on the right ----

    function applySplit(on) {
        const shop = shopPanel();
        if (on) {
            buildPanel.style.width = BUILD_WIDTH;
            buildPanel.style.horizontalAlign = "right";
            buildPanel.style.opacity = "1";
            buildPanel.style.transform = "none";
            buildPanel.visible = true;
            if (shop) {
                shop.style.width = SHOP_WIDTH;
                shop.style.horizontalAlign = "left";
                shop.style.opacity = "1";
                shop.style.transform = "none";
                shop.visible = true;
            }
        } else {
            for (const panel of [buildPanel, shop]) {
                if (!panel) {
                    continue;
                }
                panel.style.width = null;
                panel.style.horizontalAlign = null;
                panel.style.opacity = null;
                panel.style.transform = null;
            }
        }
        splitApplied = on;
        const label = find("EasySplitLabel");
        if (label) {
            label.text = splitWanted ? "Hide shop" : "Show shop";
        }
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
            applySplit(splitWanted && applied);
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
