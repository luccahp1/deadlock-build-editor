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
    // Full-screen layout: shop | build on top, the game's Edit Build panel as a
    // strip along the bottom.
    const GAP = 16;
    const MARGIN = 20;
    const TOP = 20;               // the game's MainPanel margin-top
    const STRIP_HEIGHT = 250;
    const STRIP_BOTTOM = 84;      // clears the ability bar and ESC hint
    const SHOP_NATIVE_WIDTH = 1110; // shop list width inside the game's 1200px MainPanel
    const SHOP_NATIVE_HEIGHT = 960;
    const SHOP_MAX_SHARE = 0.62;
    const BUILD_SCALE = 0.85;
    // Edit Build sections across the strip.
    const STRIP_SECTIONS = [
        { id: "EditBuildSection", width: 600 },
        { id: "EditCategorySection", width: 420 },
        { id: "EditModSection", width: 420 },
        { id: "AbilityOrder", width: 0 },
        { id: "SaveChangesSection", width: 200 },
    ];
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

    // camelCase style names are aliases in Panorama and cannot be unset; the
    // CSS property name (margin-right, horizontal-align, ...) can.
    const BASE_STYLE = {
        x: "position", y: "position",
        marginTop: "margin", marginRight: "margin", marginBottom: "margin", marginLeft: "margin",
        paddingTop: "padding", paddingRight: "padding", paddingBottom: "padding", paddingLeft: "padding",
        horizontalAlign: "align", verticalAlign: "align",
    };

    function clearStyle(panel, prop) {
        if (prop === "visibility") {
            // Clearing visibility leaves the panel hidden; everything we hide
            // is visible in the game's own layout.
            panel.style.visibility = "visible";
            return;
        }
        panel.style[BASE_STYLE[prop] || prop.replace(/[A-Z]/g, m => "-" + m.toLowerCase())] = null;
    }

    function restoreStyles() {
        for (const t of touched) {
            try {
                if (t.panel.IsValid && !t.panel.IsValid()) {
                    continue;
                }
                clearStyle(t.panel, t.prop);
            } catch (e) {
                log(`restore ${t.prop} failed: ${e}`);
            }
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

    function screenSize() {
        const root = hudRoot();
        const w = Math.round(root.actuallayoutwidth / (root.actualuiscale_x || 1)) || 1920;
        const h = Math.round(root.actuallayoutheight / (root.actualuiscale_y || 1)) || 1080;
        return { w: w, h: h };
    }

    function layoutEditStrip(screen) {
        const strip = editSidebar();
        if (!strip) {
            return;
        }
        setStyle(strip, "flowChildren", "right");
        setStyle(strip, "horizontalAlign", "left");
        setStyle(strip, "verticalAlign", "bottom");
        setStyle(strip, "marginLeft", `${MARGIN}px`);
        setStyle(strip, "marginBottom", `${STRIP_BOTTOM}px`);
        setStyle(strip, "paddingTop", "0px");
        setStyle(strip, "width", `${screen.w - MARGIN * 2}px`);
        setStyle(strip, "height", `${STRIP_HEIGHT}px`);

        for (const child of strip.Children()) {
            if (child.BHasClass("EditSectionTitle")) {
                setStyle(child, "visibility", "collapse");
            }
        }
        for (const section of STRIP_SECTIONS) {
            const panel = strip.FindChild(section.id);
            if (!panel) {
                continue;
            }
            setStyle(panel, "height", "100%");
            setStyle(panel, "marginTop", "0px");
            setStyle(panel, "marginBottom", "0px");
            setStyle(panel, "marginLeft", "0px");
            setStyle(panel, "marginRight", "8px");
            if (section.width > 0) {
                setStyle(panel, "width", `${section.width}px`);
            }
        }
        const save = strip.FindChild("SaveChangesSection");
        setStyle(save, "flowChildren", "down");
        const description = strip.FindChildTraverse("BuildDescriptionTextEntry");
        setStyle(description, "height", "40px");
        setStyle(description, "width", "100%");
    }

    // ---- shop tab ----
    //
    // The game only fills in shop cards (art, tier, colours) for the tab it
    // has selected. Easy mode shows the shop next to the build, so it selects
    // All Items itself instead of leaving the build tab selected with an empty
    // shop drawn over it.

    let selectedAllItems = false;

    function hasShopClass(name) {
        for (let panel = buildPanel; panel; panel = panel.GetParent()) {
            if (panel.BHasClass(name)) {
                return true;
            }
        }
        return false;
    }

    function activate(id) {
        const button = find(id);
        if (button) {
            $.DispatchEvent("Activated", button, "mouse");
        }
    }

    function selectAllItemsTab() {
        if (hasShopClass("showingAllItems")) {
            return;
        }
        selectedAllItems = true;
        activate("EasyTabAllItems");
        $.Schedule(0.3, () => log(`all items tab ${hasShopClass("showingAllItems") ? "selected" : "NOT selected"}, ` +
            `cards ${cardStats(shopPanel())}`));
    }

    function restoreBuildTab() {
        if (selectedAllItems) {
            selectedAllItems = false;
            activate("EasyTabBuild");
        }
    }

    // A card the game has filled in carries its item category class.
    function cardStats(panel) {
        const cards = modIcons(panel);
        const filled = cards.filter(c => c.BHasClass("isWeapon") || c.BHasClass("isTech") || c.BHasClass("isArmor"));
        return `${filled.length}/${cards.length} filled`;
    }

    function logLayout(shop) {
        const strip = editSidebar();
        if (strip) {
            const parent = strip.GetParent();
            log(`strip: y=${strip.actualyoffset} h=${strip.actuallayoutheight} scale=${strip.actualuiscale_y} ` +
                `parent=${parent ? parent.paneltype + "#" + parent.id : "?"} parentH=${parent ? parent.actuallayoutheight : 0}`);
        }
        if (!shop) {
            return;
        }
        const tiers = shop.FindChildTraverse("ModsContainer");
        log(`layout: screen=${screenSize().w}x${screenSize().h} shop=${shop.actuallayoutwidth}x${shop.actuallayoutheight} ` +
            `content=${tiers ? tiers.contentheight : "?"} scale=${shop.actualuiscale_x} ` +
            `build=${buildPanel.actuallayoutwidth} x=${buildPanel.actualxoffset} cards ${cardStats(shop)}`);
    }

    function applySplit(on) {
        if (!on) {
            restoreStyles();
            splitApplied = false;
            updateSplitLabel();
            return;
        }

        const screen = screenSize();
        layoutEditStrip(screen);

        const mainWidth = screen.w - MARGIN * 2;
        const mainHeight = screen.h - TOP - STRIP_HEIGHT - STRIP_BOTTOM - GAP;
        setStyle(ancestorById("Shop"), "marginRight", "0px");
        setStyle(ancestorById("Shop"), "width", "100%");
        setStyle(ancestorById("MainPanel"), "width", `${mainWidth}px`);
        setStyle(ancestorById("MainPanel"), "height", `${mainHeight}px`);
        setStyle(ancestorById("MainPanel"), "marginRight", `${MARGIN}px`);
        setStyle(ancestorById("ShopModsContainer"), "marginRight", "0px");
        // The toolbar switches shop tabs, so the game's side tab strip is hidden.
        const shopTabs = ancestorById("ShopModsContainer");
        setStyle(shopTabs ? shopTabs.FindChild("ShopNavigation") : null, "visibility", "collapse");

        // Shop scaled so a whole tab fits both the height and its share of the width.
        const listsWidth = mainWidth;
        const shopScale = Math.min(1, mainHeight / SHOP_NATIVE_HEIGHT,
            (listsWidth * SHOP_MAX_SHARE) / SHOP_NATIVE_WIDTH);
        const shopWidth = Math.round(SHOP_NATIVE_WIDTH * shopScale);

        const shop = shopPanel();
        setStyle(shop, "width", `${SHOP_NATIVE_WIDTH}px`);
        setStyle(shop, "uiScale", `${Math.round(shopScale * 100)}%`);
        setStyle(shop, "horizontalAlign", "left");
        setStyle(shop, "opacity", "1");
        setStyle(shop, "transform", "none");
        // All Items is taller than the space left above the edit strip.
        setStyle(shop, "overflow", "clip scroll");
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
        for (const id of ["CategoryDragHandle", "CategoryResizeHandle"]) {
            const handle = category.FindChildTraverse(id);
            if (handle) {
                // Hidden by opacity: the game shows these only on the focused
                // section, and a cleared visibility would not come back.
                if (on) {
                    handle.style.opacity = "0";
                } else {
                    clearStyle(handle, "opacity");
                }
                handle.hittest = !on;
            }
        }
        const header = category.FindChildTraverse("BuildCategoryHeader");
        if (header) {
            if (on && category.BHasClass("Focused")) {
                header.style.backgroundColor = "#3fb37f55";
            } else {
                clearStyle(header, "backgroundColor");
            }
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

    // ---- right-click: add from the shop, remove from the build ----
    //
    // The game adds items when one is dropped onto a section and has no
    // documented "add item" call, so each method below is tried in turn and
    // checked by counting the section's items. The first one that works is
    // remembered for the rest of the session.

    const ITEM_TYPES = ["CitadelShopMod", "CitadelModIcon"];
    // In edit mode the game adds a shop item / removes a build item when the
    // item is clicked, so right-click replays that click.
    const ADD_METHODS = [
        { name: "Activated mouse", run: icon => $.DispatchEvent("Activated", icon, "mouse") },
        { name: "Activated keyboard", run: icon => $.DispatchEvent("Activated", icon, "keyboard") },
        { name: "MouseActivate", run: icon => $.DispatchEvent("MouseActivate", icon) },
    ];
    const REMOVE_METHODS = ADD_METHODS;
    let addMethod = -1;
    let removeMethod = -1;

    function modIcons(root) {
        const icons = [];
        const walk = panel => {
            for (const child of panel.Children()) {
                if (ITEM_TYPES.includes(child.paneltype)) {
                    icons.push(child);
                } else {
                    walk(child);
                }
            }
        };
        if (root) {
            walk(root);
        }
        return icons;
    }

    function focusedCategory() {
        return categories().find(c => c.BHasClass("Focused")) || null;
    }

    function owningCategory(icon) {
        for (let panel = icon.GetParent(); panel; panel = panel.GetParent()) {
            if (panel.paneltype === "CitadelShopModsBuildCategory") {
                return panel;
            }
        }
        return null;
    }

    // Tries methods from `start` until the item count moves by `wantDelta`.
    function tryMethods(methods, start, icon, target, countOf, wantDelta, done) {
        if (start >= methods.length) {
            setStatus("Right-click could not change the build, drag instead");
            log("right-click: no method worked");
            done(-1);
            return;
        }
        const before = countOf();
        try {
            methods[start].run(icon, target);
        } catch (e) {
            log(`right-click: ${methods[start].name} threw ${e}`);
        }
        $.Schedule(0.15, () => {
            if (countOf() - before === wantDelta) {
                log(`right-click: ${methods[start].name} works`);
                done(start);
            } else {
                log(`right-click: ${methods[start].name} did nothing`);
                tryMethods(methods, start + 1, icon, target, countOf, wantDelta, done);
            }
        });
    }


    function addFromShop(icon) {
        const category = focusedCategory();
        if (!category) {
            setStatus("Select a section first");
            return;
        }
        if (addMethod >= 0) {
            ADD_METHODS[addMethod].run(icon, category);
            return;
        }
        tryMethods(ADD_METHODS, 0, icon, category, () => itemCount(category), 1, found => { addMethod = found; });
    }

    function removeFromBuild(icon) {
        const category = owningCategory(icon);
        if (!category) {
            return;
        }
        if (removeMethod >= 0) {
            REMOVE_METHODS[removeMethod].run(icon, category);
            return;
        }
        tryMethods(REMOVE_METHODS, 0, icon, category, () => itemCount(category), -1, found => { removeMethod = found; });
    }

    // Icons are recreated by the game, so new ones are hooked every tick. The
    // handlers do nothing outside Easy mode.
    function hookIcons() {
        for (const icon of modIcons(shopPanel())) {
            if (!icon.BHasClass("EasyHooked")) {
                icon.AddClass("EasyHooked");
                icon.SetPanelEvent("oncontextmenu", () => {
                    if (applied) {
                        addFromShop(icon);
                    }
                });
            }
        }
        for (const icon of modIcons(find("CategoryContainer"))) {
            if (!icon.BHasClass("EasyHooked")) {
                icon.AddClass("EasyHooked");
                icon.SetPanelEvent("oncontextmenu", () => {
                    if (applied) {
                        removeFromBuild(icon);
                    }
                });
            }
        }
    }

    // ---- free placement of sections ----
    //
    // Sections stay where they are dropped, no snapping. Positions live for
    // this game session only: the build itself stores order and width, not
    // positions.

    const GRIP_ID = "EasyMoveGrip";
    const positions = {};

    function positionKey(list, category) {
        const name = categoryName(category);
        let nth = 0;
        for (const other of list) {
            if (other === category) {
                break;
            }
            if (categoryName(other) === name) {
                nth++;
            }
        }
        return `${name}#${nth}`;
    }

    function unitsOf(panel) {
        return panel.actualuiscale_x || 1;
    }

    function placeSection(category, pos) {
        category.style.x = `${Math.round(pos.x)}px`;
        category.style.y = `${Math.round(pos.y)}px`;
    }

    function addGrip(category, key) {
        const header = category.FindChildTraverse("BuildCategoryHeader");
        if (!header || header.FindChild(GRIP_ID)) {
            return;
        }
        const grip = $.CreatePanel("Label", header, GRIP_ID);
        grip.text = "MOVE";
        grip.style.fontSize = "11px";
        grip.style.fontWeight = "bold";
        grip.style.color = "#0b1a12";
        grip.style.backgroundColor = "#3fb37f";
        grip.style.borderRadius = "3px";
        grip.style.padding = "2px 6px";
        grip.style.margin = "6px 4px 6px 8px";
        grip.style.verticalAlign = "center";
        header.MoveChildBefore(grip, header.GetChild(0));
        grip.SetDraggable(true);

        $.RegisterEventHandler("DragStart", grip, (panelId, drag) => {
            const scale = unitsOf(category);
            const ghost = $.CreatePanel("Panel", buildPanel, "EasyDragGhost");
            ghost.style.width = `${Math.round(category.actuallayoutwidth / scale)}px`;
            ghost.style.height = `${Math.round(category.actuallayoutheight / scale)}px`;
            ghost.style.backgroundColor = "#3fb37f40";
            ghost.style.border = "2px dashed #3fb37f";
            ghost.style.borderRadius = "4px";
            drag.displayPanel = ghost;
            drag.offsetX = Math.round(grip.actualxoffset + grip.actuallayoutwidth / 2);
            drag.offsetY = Math.round(grip.actualyoffset + grip.actuallayoutheight / 2);
            drag.removePositionBeforeDrop = false;
            category.style.opacity = "0.35";
            return true;
        });

        $.RegisterEventHandler("DragEnd", grip, (panelId, ghost) => {
            clearStyle(category, "opacity");
            const container = find("CategoryContainer");
            if (ghost && container) {
                const ghostPos = ghost.GetPositionWithinWindow();
                const boxPos = container.GetPositionWithinWindow();
                const scale = unitsOf(container);
                const scrollY = container.scrolloffset_y || 0;
                const pos = {
                    x: Math.max(0, (ghostPos.x - boxPos.x) / scale),
                    y: Math.max(0, (ghostPos.y - boxPos.y - scrollY) / scale),
                };
                log(`moved "${key}" to ${Math.round(pos.x)},${Math.round(pos.y)} (ghost ${ghostPos.x},${ghostPos.y} box ${boxPos.x},${boxPos.y} scroll ${scrollY})`);
                positions[key] = pos;
                placeSection(category, pos);
            }
            if (ghost) {
                ghost.DeleteAsync(0);
            }
            return true;
        });
    }

    function freeLayout(list) {
        const container = find("CategoryContainer");
        if (!container) {
            return;
        }
        setStyle(container, "flowChildren", "none");

        // Sections without a position go below everything already placed.
        let nextY = 0;
        for (const category of list) {
            const pos = positions[positionKey(list, category)];
            if (pos) {
                nextY = Math.max(nextY, pos.y + category.actuallayoutheight / unitsOf(category) + 12);
            }
        }
        for (const category of list) {
            const key = positionKey(list, category);
            if (!positions[key] && spawnAt && list.length > spawnAt.previousCount) {
                positions[key] = { x: spawnAt.x, y: spawnAt.y };
                spawnAt = null;
            }
            if (!positions[key]) {
                positions[key] = { x: 0, y: nextY };
                nextY += category.actuallayoutheight / unitsOf(category) + 12;
            }
            placeSection(category, positions[key]);
            addGrip(category, key);
        }
    }

    function clearFreeLayout() {
        for (const category of categories()) {
            try {
                clearStyle(category, "x");
                clearStyle(category, "opacity");
            } catch (e) {
                log(`clear position failed: ${e}`);
            }
            const grip = category.FindChildTraverse(GRIP_ID);
            if (grip) {
                grip.DeleteAsync(0);
            }
        }
    }

    // ---- right-click on empty space: context menu ----
    //
    // Panorama gives scripts no cursor position, so the empty space behind
    // the sections is covered by a grid of invisible cells. The cell that gets
    // the right-click says where the menu opens.

    const HIT_GRID_ID = "EasyHitGrid";
    const MENU_ID = "EasyContextMenu";
    const CELL = 32;
    const MAX_RESULTS = 8;
    let spawnAt = null;   // where the next new section goes
    let menuAt = null;
    let gridSize = "";

    function hitGrid() {
        const container = find("CategoryContainer");
        if (!container) {
            return null;
        }
        let grid = container.FindChild(HIT_GRID_ID);
        if (!grid) {
            grid = $.CreatePanel("Panel", container, HIT_GRID_ID);
            grid.style.flowChildren = "right-wrap";
            grid.hittest = false;
            container.MoveChildBefore(grid, container.GetChild(0));
            gridSize = "";
        }
        return grid;
    }

    function sizeHitGrid(list) {
        const container = find("CategoryContainer");
        const grid = hitGrid();
        if (!container || !grid) {
            return;
        }
        const scale = unitsOf(container);
        let bottom = container.actuallayoutheight / scale;
        for (const category of list) {
            const pos = positions[positionKey(list, category)];
            if (pos) {
                bottom = Math.max(bottom, pos.y + category.actuallayoutheight / unitsOf(category) + CELL * 4);
            }
        }
        const cols = Math.max(1, Math.floor(container.actuallayoutwidth / scale / CELL));
        const rows = Math.max(1, Math.ceil(bottom / CELL));
        const size = `${cols}x${rows}`;
        if (size === gridSize) {
            return;
        }
        gridSize = size;
        grid.style.width = `${cols * CELL}px`;
        grid.style.height = `${rows * CELL}px`;
        grid.RemoveAndDeleteChildren();
        for (let i = 0; i < cols * rows; i++) {
            const cell = $.CreatePanel("Panel", grid, "");
            cell.style.width = `${CELL}px`;
            cell.style.height = `${CELL}px`;
            cell.hittest = true;
            const at = { x: (i % cols) * CELL + CELL / 2, y: Math.floor(i / cols) * CELL + CELL / 2 };
            cell.SetPanelEvent("oncontextmenu", () => openMenu(at));
            cell.SetPanelEvent("onactivate", closeMenu);
        }
    }

    function removeHitGrid() {
        const container = find("CategoryContainer");
        const grid = container ? container.FindChild(HIT_GRID_ID) : null;
        if (grid) {
            grid.DeleteAsync(0);
        }
        gridSize = "";
    }

    function menuButton(parent, text, onClick, extraClass) {
        const button = $.CreatePanel("Button", parent, "");
        button.AddClass("EasyMenuItem");
        if (extraClass) {
            button.AddClass(extraClass);
        }
        const label = $.CreatePanel("Label", button, "");
        label.text = text;
        button.SetPanelEvent("onactivate", onClick);
        return button;
    }

    function closeMenu() {
        const container = find("CategoryContainer");
        const menu = container ? container.FindChild(MENU_ID) : null;
        if (menu) {
            menu.DeleteAsync(0);
        }
        menuAt = null;
        clearShopFilter();
    }

    function newMenu(at) {
        const container = find("CategoryContainer");
        if (!container) {
            return null;
        }
        const old = container.FindChild(MENU_ID);
        if (old) {
            old.DeleteAsync(0);
        }
        menuAt = at;
        const menu = $.CreatePanel("Panel", container, MENU_ID);
        menu.style.x = `${Math.round(at.x)}px`;
        menu.style.y = `${Math.round(at.y)}px`;
        return menu;
    }

    function openMenu(at) {
        if (!applied) {
            return;
        }
        clearShopFilter();
        const menu = newMenu(at);
        if (!menu) {
            return;
        }
        menuButton(menu, "Create category", () => createCategoryAt(at));
        const target = focusedCategory();
        const addLabel = target ? `Add item to ${categoryName(target)}` : "Add item";
        menuButton(menu, addLabel, () => openSearch(at));
    }

    function createCategoryAt(at) {
        closeMenu();
        spawnAt = { x: at.x, y: at.y, previousCount: categories().length };
        queueSection("");
    }

    // ---- add item: search the shop by name ----

    function cardName(card) {
        const walk = panel => {
            for (const child of panel.Children()) {
                if (child.BHasClass("modName")) {
                    return child;
                }
                const found = walk(child);
                if (found) {
                    return found;
                }
            }
            return null;
        };
        const label = walk(card);
        return label ? label.text : "";
    }

    function shopCards() {
        return modIcons(shopPanel()).map(card => ({ card: card, name: cardName(card) })).filter(c => c.name);
    }

    // Best matches first: name starts with the query, then a word does, then
    // it appears anywhere.
    function searchShop(query) {
        const q = query.trim().toLowerCase();
        if (!q) {
            return [];
        }
        const rank = name => {
            const n = name.toLowerCase();
            if (n.startsWith(q)) {
                return 0;
            }
            if (n.split(/\s+/).some(word => word.startsWith(q))) {
                return 1;
            }
            return n.includes(q) ? 2 : -1;
        };
        return shopCards()
            .map(c => Object.assign(c, { rank: rank(c.name) }))
            .filter(c => c.rank >= 0)
            .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    }

    let filtered = [];

    function filterShop(keep) {
        clearShopFilter();
        if (!keep) {
            return;
        }
        for (const card of modIcons(shopPanel())) {
            if (!keep.includes(card)) {
                card.style.opacity = "0.15";
                filtered.push(card);
            }
        }
    }

    function clearShopFilter() {
        for (const card of filtered) {
            try {
                card.style.opacity = null;
            } catch (e) {
                // card was recreated by the game
            }
        }
        filtered = [];
    }

    function openSearch(at) {
        const menu = newMenu(at);
        if (!menu) {
            return;
        }
        menu.AddClass("Search");
        const target = focusedCategory();
        const title = $.CreatePanel("Label", menu, "");
        title.AddClass("EasyMenuTitle");
        title.text = target ? `Add to ${categoryName(target)}` : "Select a section first, then add";
        const entry = $.CreatePanel("TextEntry", menu, "EasySearchEntry", { placeholder: "Search items..." });
        const results = $.CreatePanel("Panel", menu, "EasySearchResults");

        const render = () => {
            const matches = searchShop(entry.text);
            results.RemoveAndDeleteChildren();
            filterShop(entry.text.trim() ? matches.map(m => m.card) : null);
            for (const match of matches.slice(0, MAX_RESULTS)) {
                menuButton(results, match.name, () => pickResult(match), "Result");
            }
            if (entry.text.trim() && matches.length === 0) {
                const none = $.CreatePanel("Label", results, "");
                none.AddClass("EasyMenuEmpty");
                none.text = "No items match";
            }
        };
        entry.SetPanelEvent("ontextentrychange", render);
        entry.SetPanelEvent("oninputsubmit", () => {
            const matches = searchShop(entry.text);
            if (matches.length > 0) {
                pickResult(matches[0]);
            }
        });
        entry.SetPanelEvent("oncancel", closeMenu);
        menuButton(menu, "Close", closeMenu, "Close");
        $.Schedule(0.05, () => entry.SetFocus());
    }

    function pickResult(match) {
        const category = focusedCategory();
        if (!category) {
            setStatus("Select a section first");
            return;
        }
        filterShop([match.card]);
        const before = itemCount(category);
        addFromShop(match.card);
        $.Schedule(0.6, () => {
            if (itemCount(category) > before) {
                setStatus(`Added ${match.name} to ${categoryName(category)}`);
                closeMenu();
            } else {
                setStatus(`Drag ${match.name} from the shop onto ${categoryName(category)}`);
            }
        });
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
        if (on) {
            selectAllItemsTab();
        } else {
            closeMenu();
            removeHitGrid();
            clearFreeLayout();
            restoreBuildTab();
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
            freeLayout(list);
            sizeHitGrid(list);
            hookIcons();
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
