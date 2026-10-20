"use strict";
// Easy Build Editor
//
// Runs inside the shop's build panel (CitadelShopModsBuild). The real editing
// is still done by the game: every change goes through the game's own build
// commands and panels, so saving, sharing and publishing work as normal. This
// script only rearranges what is on screen and adds shortcuts.

var EasyBuildEditor = (function () {
    const LOG_PREFIX = "[EasyBuildEditor] ";
    // build.py replaces this with the git commit and build time, so the
    // console log shows which build the game actually loaded.
    const BUILD_ID = "dev";
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
    // Bumped every time Easy mode turns on or off, so delayed work started in
    // one edit session never runs in the next one (or outside edit mode).
    let session = 0;
    let splitWanted = true;
    let splitApplied = false;
    let tickScheduled = false;
    let dumped = false;
    let pendingNames = [];

    function log(message) {
        $.Msg(LOG_PREFIX + message);
    }

    function logError(where, e) {
        log(`ERROR in ${where}: ${e}${e && e.stack ? "\n" + e.stack : ""}`);
    }

    // Runs one step of a multi-step job; a failure is logged and the rest of
    // the job still runs.
    function safely(where, fn) {
        try {
            return fn();
        } catch (e) {
            logError(where, e);
            return undefined;
        }
    }

    function alive(panel) {
        try {
            return !!panel && (!panel.IsValid || panel.IsValid());
        } catch (e) {
            return false;
        }
    }

    // Deleting a focused text entry leaves keyboard focus on nothing, which
    // can swallow the game's own keys until the player clicks somewhere.
    function dropFocus(panel) {
        if (!alive(panel)) {
            return;
        }
        try {
            if (typeof panel.BHasKeyFocus !== "function" || panel.BHasKeyFocus()) {
                $.DispatchEvent("DropInputFocus", panel);
            }
        } catch (e) {
            logError("dropFocus", e);
        }
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
    // the panels back to the game's own CSS. Styles belong to a group: "split"
    // is the shop | build layout (undone by Hide shop), "easy" is the rest.
    const touched = [];

    function setStyle(panel, prop, value, group) {
        if (!panel) {
            return;
        }
        group = group || "split";
        if (!touched.some(t => t.panel === panel && t.prop === prop)) {
            touched.push({ panel: panel, prop: prop, group: group });
        }
        panel.style[prop] = value;
    }

    // Panel properties that are not styles (visible, hittest): the game's own
    // value is kept and put back on exit.
    const changedProps = [];

    function setProp(panel, prop, value) {
        if (!panel) {
            return;
        }
        if (!changedProps.some(t => t.panel === panel && t.prop === prop)) {
            changedProps.push({ panel: panel, prop: prop, original: panel[prop] });
        }
        panel[prop] = value;
    }

    function restoreProps() {
        for (const t of changedProps) {
            if (alive(t.panel)) {
                safely(`restore ${t.prop}`, () => { t.panel[t.prop] = t.original; });
            }
        }
        changedProps.length = 0;
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

    // Restores one group, or every group when none is given.
    function restoreStyles(group) {
        const keep = [];
        for (const t of touched) {
            if (group && t.group !== group) {
                keep.push(t);
                continue;
            }
            try {
                if (!alive(t.panel)) {
                    continue;
                }
                clearStyle(t.panel, t.prop);
            } catch (e) {
                log(`restore ${t.prop} failed: ${e}`);
            }
        }
        touched.length = 0;
        touched.push(...keep);
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

    // Hide shop: the game hides the build panel while another tab is
    // selected, so the build tab has to be selected for the build to show.
    function showBuildTabOnly() {
        selectedAllItems = true; // leaving Easy mode still selects Build
        activate("EasyTabBuild");
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
            restoreStyles("split");
            restoreProps();
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
        setProp(shop, "visible", true);

        const buildWidth = listsWidth - shopWidth - GAP;
        setStyle(buildPanel, "width", `${Math.floor(buildWidth / BUILD_SCALE)}px`);
        setStyle(buildPanel, "uiScale", `${BUILD_SCALE * 100}%`);
        setStyle(buildPanel, "horizontalAlign", "right");
        setStyle(buildPanel, "opacity", "1");
        setStyle(buildPanel, "transform", "none");
        // Above the shop, so drops onto a section reach the section.
        setStyle(buildPanel, "zIndex", "20");
        setProp(buildPanel, "visible", true);

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
        setStyle(container, "marginTop", `${bottom + 6}px`, "easy");
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
        if (!applied) {
            return; // the toolbar is only shown in Easy mode
        }
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

    // Long enough for the game to rebuild the section, so a slow add is not
    // mistaken for a failed one and repeated by the next method.
    const PROBE_SETTLE = 0.35;

    // Tries methods from `start` until the item count moves by `wantDelta`.
    function tryMethods(methods, start, icon, target, countOf, wantDelta, done) {
        // Easy mode ended (Save, Cancel, Esc) while probing: stop. Outside
        // edit mode a replayed click on a shop item could buy it.
        const probeSession = session;
        if (!applied || !alive(icon) || !alive(target)) {
            log("right-click: stopped, Easy mode ended or the item is gone");
            done(-1);
            return;
        }
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
        $.Schedule(PROBE_SETTLE, () => {
            if (probeSession !== session || !applied) {
                log("right-click: stopped, Easy mode ended");
                done(-1);
                return;
            }
            if (countOf() - before === wantDelta) {
                log(`right-click: ${methods[start].name} works`);
                done(start);
            } else {
                log(`right-click: ${methods[start].name} did nothing`);
                tryMethods(methods, start + 1, icon, target, countOf, wantDelta, done);
            }
        });
    }


    // `onDone(added)` runs once the outcome is known.
    function addFromShop(icon, onDone) {
        const category = focusedCategory();
        const finish = added => {
            if (onDone) {
                onDone(added, category);
            }
        };
        if (!category) {
            setStatus("Select a section first");
            finish(false);
            return;
        }
        const before = itemCount(category);
        if (addMethod >= 0) {
            ADD_METHODS[addMethod].run(icon, category);
            $.Schedule(PROBE_SETTLE, () => finish(itemCount(category) > before));
            return;
        }
        const probeSession = session;
        tryMethods(ADD_METHODS, 0, icon, category, () => itemCount(category), 1, found => {
            // An aborted probe proves nothing about the methods.
            if (probeSession === session) {
                addMethod = found;
            }
            finish(found >= 0);
        });
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
        const probeSession = session;
        tryMethods(REMOVE_METHODS, 0, icon, category, () => itemCount(category), -1, found => {
            if (probeSession === session) {
                removeMethod = found;
            }
        });
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
    // Looked up by panel first, so renaming a section does not move it; the
    // name key covers panels the game recreates.
    const positions = {};
    const panelPositions = new Map();

    function positionOf(list, category) {
        return panelPositions.get(category) || positions[positionKey(list, category)] || null;
    }

    function rememberPosition(list, category, pos) {
        panelPositions.set(category, pos);
        positions[positionKey(list, category)] = pos;
    }

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

    function addGrip(category) {
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
            if (!applied) {
                return false;
            }
            const scale = unitsOf(category);
            const ghost = $.CreatePanel("Panel", buildPanel, GHOST_ID);
            drags.push({ ghost: ghost, category: category });
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
            endDrag(category, ghost);
            const container = find("CategoryContainer");
            // Easy mode may have ended mid-drag (Save, Cancel, Esc): placing
            // the section now would leave it floating in the game's layout.
            if (applied && alive(ghost) && alive(category) && container) {
                const ghostPos = ghost.GetPositionWithinWindow();
                const boxPos = container.GetPositionWithinWindow();
                const scale = unitsOf(container);
                const scrollY = container.scrolloffset_y || 0;
                const pos = {
                    x: Math.max(0, (ghostPos.x - boxPos.x) / scale),
                    y: Math.max(0, (ghostPos.y - boxPos.y - scrollY) / scale),
                };
                log(`moved "${categoryName(category)}" to ${Math.round(pos.x)},${Math.round(pos.y)}`);
                rememberPosition(categories(), category, pos);
                placeSection(category, pos);
            }
            if (alive(ghost)) {
                ghost.DeleteAsync(0);
            }
            return true;
        });
    }

    // Drags in progress, so leaving Easy mode mid-drag can clean up.
    const GHOST_ID = "EasyDragGhost";
    let drags = [];

    function endDrag(category, ghost) {
        drags = drags.filter(d => d.category !== category && d.ghost !== ghost);
        if (alive(category)) {
            clearStyle(category, "opacity");
        }
    }

    function cancelDrags() {
        for (const drag of drags) {
            if (alive(drag.category)) {
                safely("cancel drag", () => clearStyle(drag.category, "opacity"));
            }
            if (alive(drag.ghost)) {
                drag.ghost.DeleteAsync(0);
            }
        }
        drags = [];
        // A ghost the drag code never handed back.
        const stray = buildPanel.FindChildTraverse(GHOST_ID);
        if (stray) {
            stray.DeleteAsync(0);
        }
    }

    function freeLayout(list) {
        const container = find("CategoryContainer");
        if (!container) {
            return;
        }
        setStyle(container, "flowChildren", "none", "easy");

        // Sections without a position go below everything already placed.
        let nextY = 0;
        for (const category of list) {
            const pos = positionOf(list, category);
            if (pos) {
                nextY = Math.max(nextY, pos.y + category.actuallayoutheight / unitsOf(category) + 12);
            }
        }
        if (spawnAt && (Date.now() - spawnAt.at) / 1000 > SPAWN_TIMEOUT) {
            spawnAt = null; // the section never arrived
        }
        for (const category of list) {
            let pos = positionOf(list, category);
            // A new panel may share its name key with a deleted section, so a
            // pending spawn point wins over the name key.
            if (!panelPositions.has(category) && spawnAt && list.length > spawnAt.previousCount) {
                pos = { x: spawnAt.x, y: spawnAt.y };
                spawnAt = null;
            }
            if (!pos) {
                pos = { x: 0, y: nextY };
                nextY += category.actuallayoutheight / unitsOf(category) + 12;
            }
            rememberPosition(list, category, pos);
            placeSection(category, pos);
            addGrip(category);
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
    const SPAWN_TIMEOUT = 5; // seconds to wait for a section made from the menu
    const MENU_WIDTH = 220;      // keep in step with #EasyContextMenu in the CSS
    const SEARCH_WIDTH = 300;    // #EasyContextMenu.Search
    let spawnAt = null;   // where the next new section goes
    let menuAt = null;
    // Held directly: a menu being replaced is still found by id until its
    // async delete runs, so looking it up by id can pick the old one.
    let menuPanel = null;
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
            const pos = positionOf(list, category);
            if (pos) {
                bottom =Math.max(bottom, pos.y + category.actuallayoutheight / unitsOf(category) + CELL * 4);
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

    function deleteMenu() {
        if (alive(menuPanel)) {
            dropFocus(menuPanel.FindChildTraverse("EasySearchEntry"));
            menuPanel.DeleteAsync(0);
        }
        menuPanel = null;
    }

    function closeMenu() {
        deleteMenu();
        menuAt = null;
        clearShopFilter();
    }

    function newMenu(at, width) {
        const container = find("CategoryContainer");
        if (!container) {
            return null;
        }
        deleteMenu();
        menuAt = at;
        const menu = $.CreatePanel("Panel", container, MENU_ID);
        menuPanel = menu;
        // Open to the left of the click when the menu would run off the right
        // edge of the build area.
        const room = container.actuallayoutwidth / unitsOf(container);
        const x = at.x + width > room ? Math.max(0, room - width - 4) : at.x;
        menu.style.x = `${Math.round(x)}px`;
        menu.style.y = `${Math.round(at.y)}px`;
        return menu;
    }

    function openMenu(at) {
        if (!applied) {
            return;
        }
        clearShopFilter();
        const menu = newMenu(at, MENU_WIDTH);
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
        spawnAt = { x: at.x, y: at.y, previousCount: categories().length, at: Date.now() };
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
            if (alive(card)) {
                safely("clear filter", () => { card.style.opacity = null; });
            }
        }
        filtered = [];
    }

    function openSearch(at) {
        if (!applied) {
            return;
        }
        const menu = newMenu(at, SEARCH_WIDTH);
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
        // The menu may be gone by then (Esc, Save, a click elsewhere).
        $.Schedule(0.05, () => {
            if (menuPanel === menu && alive(entry)) {
                entry.SetFocus();
            }
        });
    }

    function pickResult(match) {
        filterShop([match.card]);
        addFromShop(match.card, (added, category) => {
            if (!category) {
                return;
            }
            if (added) {
                setStatus(`Added ${match.name} to ${categoryName(category)}`);
                closeMenu();
            } else {
                setStatus(`Drag ${match.name} from the shop onto ${categoryName(category)}`);
            }
        });
    }

    // ---- main loop ----

    // Set once any ancestor has been seen with gShopOpen; after that, its
    // absence means the shop was closed (Esc). Never seen: assume open.
    let shopClassSeen = false;

    function shopOpen() {
        if (hasShopClass("gShopOpen")) {
            shopClassSeen = true;
            return true;
        }
        return !shopClassSeen;
    }

    function apply(on) {
        if (on === applied) {
            return;
        }
        applied = on;
        session++;
        buildPanel.SetHasClass("EasyEdit", on);
        if (on) {
            applySplit(splitWanted);
            for (const category of categories()) {
                tidyCategory(category, true);
            }
            if (splitWanted) {
                selectAllItemsTab();
            }
            log("easy mode on");
            return;
        }

        // Every way out of edit mode (Easy Editor button, Save, Cancel, Esc,
        // the game's own buttons) lands here. Each step runs even if an
        // earlier one fails, so nothing is left on screen.
        safely("close menu", closeMenu);
        safely("cancel drags", cancelDrags);
        pendingNames = [];
        spawnAt = null;
        safely("restore split", () => applySplit(false));
        safely("restore styles", () => restoreStyles());
        for (const category of categories()) {
            safely("untidy section", () => tidyCategory(category, false));
        }
        safely("remove hit grid", removeHitGrid);
        safely("clear free layout", clearFreeLayout);
        safely("restore tab", restoreBuildTab);
        for (const panel of Array.from(panelPositions.keys())) {
            if (!alive(panel)) {
                panelPositions.delete(panel);
            }
        }
        log("easy mode off");
        const exitSession = session;
        $.Schedule(0.3, () => safely("exit check", () => exitCheck(exitSession)));
    }

    // Logged after every exit so a console.log read shows whether anything
    // the mod made is still around.
    function exitCheck(exitSession) {
        if (exitSession !== session || applied) {
            return;
        }
        const left = [];
        for (const id of [MENU_ID, HIT_GRID_ID, GHOST_ID, GRIP_ID]) {
            if (buildPanel.FindChildTraverse(id)) {
                left.push(`#${id}`);
            }
        }
        const counts = {
            "dimmed shop items": filtered.length,
            "queued sections": pendingNames.length,
            "inline styles": touched.length,
            "panel props": changedProps.length,
            "drags": drags.length,
        };
        for (const name in counts) {
            if (counts[name] > 0) {
                left.push(`${counts[name]} ${name}`);
            }
        }
        if (menuAt || menuPanel) {
            left.push("menu state");
        }
        if (spawnAt) {
            left.push("spawn point");
        }
        log(left.length ? `exit check: LEFTOVER ${left.join(", ")}` : "exit check: clean");
    }

    // One pass of the loop. Returns false once the loop can stop.
    function update() {
        if (!alive(buildPanel)) {
            return false;
        }
        if (!wanted) {
            apply(false);
            return false;
        }

        const editing = isEditing();
        apply(editing);

        if (editing) {
            // Esc closed the shop, or the game rebuilt the section list and
            // took the menu with it: drop the menu, its focus and the dimming.
            if ((menuAt || menuPanel) && (!shopOpen() || !alive(menuPanel))) {
                closeMenu();
            }
            const list = categories();
            for (const category of list) {
                tidyCategory(category, true);
            }
            if (splitWanted) {
                // The game hides whichever tab is not selected; keep both up.
                applySplit(true);
            }
            safely("place sections", placeCategories);
            safely("free layout", () => freeLayout(list));
            safely("hit grid", () => sizeHitGrid(list));
            safely("hook icons", hookIcons);
            safely("selection", () => refreshSelection(list));
            safely("pending names", processPendingNames);
            setStatus(`${list.length} section${list.length === 1 ? "" : "s"}, ${totalItems(list)} items`);
        }
        return true;
    }

    function tick() {
        tickScheduled = false;
        let keepGoing = true;
        try {
            keepGoing = update();
        } catch (e) {
            // A thrown tick must not end the loop, or Easy mode freezes in
            // whatever state it was in.
            logError("tick", e);
        }
        if (keepGoing) {
            schedule(applied ? TICK_EDITING : TICK_IDLE);
        }
    }

    // Only one tick is ever pending, however often the buttons are pressed.
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

    log(`loaded build ${BUILD_ID}`);

    // ---- public, called from the layout ----

    return {
        Toggle() {
            wanted = !wanted;
            safely("dump", dumpOnce);
            if (wanted) {
                dispatch("CitadelHudHeroBuildsCompactCategory", -1);
            }
            try {
                if (update()) {
                    schedule(applied ? TICK_EDITING : TICK_IDLE);
                }
            } catch (e) {
                logError("Toggle", e);
                schedule(TICK_EDITING);
            }
        },
        ToggleSplit() {
            safely("ToggleSplit", () => {
                splitWanted = !splitWanted;
                if (applied) {
                    applySplit(false);
                    if (splitWanted) {
                        applySplit(true);
                        selectAllItemsTab();
                    } else {
                        showBuildTabOnly();
                    }
                }
                updateSplitLabel();
            });
        },
        AddSection(name) {
            safely("AddSection", () => queueSection(name));
        },
        AddStarterTemplate() {
            safely("AddStarterTemplate", () => {
                for (const name of STARTER_SECTIONS) {
                    queueSection(name);
                }
            });
        },
    };
})();
