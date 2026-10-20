"use strict";
// A fake Deadlock HUD around the mod's real layout and script. It answers the
// game commands the mod sends (CitadelHudHeroBuilds*, CitadelSelectShopTab)
// the way the game is believed to, so exit paths can be tested without the
// game. What it believes is listed in docs/TESTING.md; when the real game
// turns out to differ, fix the fake first, then the mod.

const fs = require("fs");
const path = require("path");
const { Runtime, Panel, parseXml, buildPanels } = require("./panorama");

const ROOT = path.resolve(__dirname, "..", "..");
const LAYOUT = path.join(ROOT, "src/panorama/layout/citadel_shop_mods_build.xml");
const SCRIPT = path.join(ROOT, "src/panorama/scripts/easy_build_editor.js");

const DEFAULT_CARDS = [
    "Basic Magazine", "Close Quarters", "Headshot Booster", "High-Velocity Mag",
    "Extra Charge", "Mystic Burst", "Extra Spirit", "Ammo Scavenger",
    "Extra Health", "Extra Regen", "Healing Rite", "Sprint Boots",
];

const DEFAULTS = {
    // Which replayed clicks add a shop item / remove a build item in edit
    // mode. [] = none (what the hideout does), or any of "mouse",
    // "keyboard", "MouseActivate".
    clickAdds: ["mouse"],
    // Esc with nothing focused: closes the shop; also leave edit mode?
    escExitsEdit: false,
    // Rebuilding the section list deletes every child of CategoryContainer,
    // including panels the mod put there.
    rebuildWipesContainer: false,
    cards: DEFAULT_CARDS,
    savedBuild: [
        { name: "Early Game", items: ["Basic Magazine", "Extra Health"] },
        { name: "Late Game", items: ["Mystic Burst"] },
    ],
};

class FakeGame {
    constructor(options) {
        this.opts = Object.assign({}, DEFAULTS, options || {});
        this.rt = new Runtime();
        this.purchases = [];
        this.outsideEdit = [];   // build commands sent while not editing
        this.saved = this.opts.savedBuild.map(c => ({ name: c.name, items: c.items.slice() }));
        this.rt.eventHandlers.push((name, panel, args) => this.onEvent(name, panel, args));
        this.buildTree();
        this.rt.runScript(fs.readFileSync(SCRIPT, "utf8"), SCRIPT);
        this.api = this.rt.context.EasyBuildEditor;
        this.baseline(this.root);
    }

    // ---- the HUD ----

    panel(type, id, parent, classes) {
        const p = new Panel(this.rt, type, id, "game");
        (classes || []).forEach(c => p._classes.add(c));
        if (parent) {
            parent.append(p);
        }
        return p;
    }

    buildTree() {
        const rt = this.rt;
        this.root = this.panel("CitadelHud", "Hud", null, ["gShopOpen"]);
        this.root.actuallayoutwidth = 1920;
        this.root.actuallayoutheight = 1080;
        this.shop = this.panel("Panel", "Shop", this.root, ["showingBuild"]);
        const main = this.panel("Panel", "MainPanel", this.shop);
        const mods = this.panel("Panel", "ShopModsContainer", main);
        this.panel("Panel", "ShopNavigation", mods);
        const lists = this.panel("Panel", "ShopModListsContainer", mods);

        const layout = parseXml(fs.readFileSync(LAYOUT, "utf8"));
        const rootNode = layout.children.find(n => n.tag === "root");
        const buildNode = rootNode.children.find(n => n.tag === "CitadelShopModsBuild");
        this.build = buildPanels(rt, buildNode, lists);
        this.build.actuallayoutwidth = 1000;
        rt.contextPanel = this.build;

        this.filtered = this.panel("Panel", "ShopModsFiltered", lists);
        const tiers = this.panel("Panel", "ModsContainer", this.filtered);
        for (const name of this.opts.cards) {
            const card = this.panel("CitadelShopMod", "", tiers, ["isWeapon"]);
            const label = this.panel("Label", "", card, ["modName"]);
            label.text = name;
        }
        this.panel("Panel", "ShopModsRecommended", lists);

        const sidebar = this.panel("Panel", "EditBuildSidebar", this.root);
        this.panel("Label", "", sidebar, ["EditSectionTitle"]);
        const editBuild = this.panel("Panel", "EditBuildSection", sidebar);
        this.panel("TextEntry", "BuildDescriptionTextEntry", editBuild);
        const editCategory = this.panel("Panel", "EditCategorySection", sidebar);
        this.nameEntry = this.panel("TextEntry", "CategoryNameTextEntry", editCategory);
        // Typing a name renames the focused section, as in the game.
        let entryText = "";
        Object.defineProperty(this.nameEntry, "text", {
            get: () => entryText,
            set: value => {
                entryText = value;
                const focused = this.sections().find(c => c.BHasClass("Focused"));
                if (focused) {
                    focused.FindChildTraverse("BuildCategoryName").text = value;
                }
            },
        });
        this.panel("Panel", "EditModSection", sidebar);
        this.panel("Panel", "AbilityOrder", sidebar);
        this.panel("Panel", "SaveChangesSection", sidebar);

        this.container = this.build.FindChildTraverse("CategoryContainer");
        this.container.actuallayoutwidth = 1000;
        this.container.actuallayoutheight = 700;
        this.container.windowPos = { x: 800, y: 300 };
        this.build.FindChildTraverse("EasyToolbar").actuallayoutheight = 240;
        this.renderSections(this.saved);
    }

    // Visible / hittest values as the game left them, for residue checks.
    baseline(panel) {
        panel._baseline = { visible: panel.visible, hittest: panel.hittest };
        for (const child of panel._children) {
            this.baseline(child);
        }
    }

    // ---- sections ----

    sections() {
        return this.container.Children().filter(c => c.paneltype === "CitadelShopModsBuildCategory");
    }

    section(name) {
        return this.sections().find(c => c.FindChildTraverse("BuildCategoryName").text === name) || null;
    }

    makeSection(name, items) {
        const category = this.panel("CitadelShopModsBuildCategory", "", this.container);
        category.actuallayoutwidth = 300;
        category.actuallayoutheight = 120;
        const header = this.panel("Panel", "BuildCategoryHeader", category);
        this.panel("Panel", "CategoryDragHandle", header);
        this.panel("Label", "BuildCategoryName", header).text = name;
        const mods = this.panel("Panel", "ModsContainer", category);
        for (const item of items) {
            this.panel("CitadelModIcon", "", mods).itemName = item;
        }
        this.panel("Panel", "CategoryResizeHandle", category);
        this.baseline(category);
        return category;
    }

    renderSections(list) {
        if (this.opts.rebuildWipesContainer) {
            this.container.RemoveAndDeleteChildren();
        } else {
            for (const c of this.sections()) {
                c._destroy();
            }
        }
        for (const c of list) {
            this.makeSection(c.name, c.items);
        }
    }

    snapshot() {
        return this.sections().map(c => ({
            name: c.FindChildTraverse("BuildCategoryName").text,
            items: c.FindChildTraverse("ModsContainer").Children().map(i => i.itemName),
        }));
    }

    // ---- state ----

    get editing() {
        return this.shop.BHasClass("gEditingBuilds");
    }

    set editing(on) {
        this.shop.SetHasClass("gEditingBuilds", on);
    }

    get tab() {
        const cls = [...this.shop._classes].find(c => c.startsWith("showing"));
        return cls ? cls.slice("showing".length) : null;
    }

    set tab(name) {
        for (const c of [...this.shop._classes]) {
            if (c.startsWith("showing")) {
                this.shop.RemoveClass(c);
            }
        }
        this.shop.AddClass("showing" + name);
    }

    get shopOpen() {
        return this.root.BHasClass("gShopOpen");
    }

    // ---- what the game does with the mod's commands ----

    onEvent(name, panel, args) {
        if (name === "Activated" || name === "MouseActivate") {
            const source = name === "MouseActivate" ? "MouseActivate" : args[0];
            if (panel.paneltype === "CitadelShopMod") {
                const itemName = panel.FindChildrenWithClassTraverse("modName")[0].text;
                if (!this.editing) {
                    this.purchases.push(itemName); // a click outside edit mode buys
                } else if (this.opts.clickAdds.includes(source)) {
                    const focused = this.sections().find(c => c.BHasClass("Focused"));
                    if (focused) {
                        this.panel("CitadelModIcon", "", focused.FindChildTraverse("ModsContainer")).itemName = itemName;
                    }
                }
                return true;
            }
            if (panel.paneltype === "CitadelModIcon") {
                if (this.editing && this.opts.clickAdds.includes(source)) {
                    panel._destroy();
                }
                return true;
            }
            return false; // a layout button: run its onactivate
        }
        if (name.startsWith("UI")) {
            return true; // tooltips
        }
        if (name.startsWith("CitadelHudHeroBuilds") && !this.editing &&
            name !== "CitadelHudHeroBuildsEditSelectedBuild" && name !== "CitadelHudHeroBuildsCompactCategory") {
            this.outsideEdit.push(name);
            return true;
        }
        switch (name) {
            case "CitadelSelectShopTab":
                this.tab = String(args[0]).replace("EShopTab_", "");
                return true;
            case "CitadelHudHeroBuildsEditSelectedBuild":
                this.editing = true;
                this.tab = "Build";
                return true;
            case "CitadelHudHeroBuildsAddNewCategory":
                for (const c of this.sections()) {
                    c.RemoveClass("Focused");
                }
                this.makeSection("New Category", []).AddClass("Focused");
                return true;
            case "CitadelHudHeroBuildsSaveEdits":
                this.saved = this.snapshot();
                this.editing = false;
                this.renderSections(this.saved);
                return true;
            case "CitadelHudHeroBuildsDiscardEdits":
                this.editing = false;
                this.renderSections(this.saved);
                return true;
            case "CitadelHudHeroBuildsCompactCategory":
            case "CitadelHudHeroBuildsToggleFavoriteSelector":
            case "CitadelHudHeroBuildsPasteBuildFromClipboard":
            case "CitadelCopySelectedBuildContentsToClipboard":
            case "CitadelHudHeroBuildsQuickbuyQueueFullBuild":
                return true;
            default:
                return false;
        }
    }

    // ---- what the player does ----

    wait(seconds) {
        this.rt.advance(seconds === undefined ? 1 : seconds);
        return this;
    }

    click(panel) {
        this.rt.dispatch("Activated", panel, "mouse");
        return this;
    }

    // A layout or menu button by its label text.
    buttonByText(text) {
        const b = this.rt.allPanels.find(p => p._valid && !p._pendingDelete && /Button$/.test(p.paneltype) &&
            (p.text === text || p.Children().some(c => c.text === text)));
        if (!b) {
            throw new Error(`no button "${text}"`);
        }
        return b;
    }

    pressEdit() {
        this.click(this.build.FindChildTraverse("EditHeroBuildButton"));
        return this.wait(0.5);
    }

    pressEasyEditor() {
        this.click(this.build.FindChildTraverse("EasyEditorButton"));
        return this.wait(0.5);
    }

    pressSave() {
        return this.click(this.buttonByText("SAVE BUILD")).wait(0.5);
    }

    pressCancel() {
        return this.click(this.buttonByText("CANCEL")).wait(0.5);
    }

    // The game's own Save / Cancel in the Edit Build strip.
    gameSave() {
        this.rt.dispatch("CitadelHudHeroBuildsSaveEdits", this.build);
        return this.wait(0.5);
    }

    pressEscape() {
        const focus = this.rt.focus;
        if (focus && focus._valid && focus.fire("oncancel")) {
            return this.wait(0.5); // a text entry eats Esc
        }
        this.root.RemoveClass("gShopOpen");
        if (this.opts.escExitsEdit) {
            this.rt.dispatch("CitadelHudHeroBuildsDiscardEdits", this.build);
        }
        return this.wait(0.5);
    }

    openShop() {
        this.root.AddClass("gShopOpen");
        return this.wait(0.5);
    }

    focusSection(name) {
        for (const c of this.sections()) {
            c.SetHasClass("Focused", c.FindChildTraverse("BuildCategoryName").text === name);
        }
        return this.wait(0.3);
    }

    // Rebuilds the section list mid-edit, as the game may do at any time.
    rebuildSections() {
        const focused = this.sections().findIndex(c => c.BHasClass("Focused"));
        this.renderSections(this.snapshot());
        if (focused >= 0) {
            this.sections()[focused].AddClass("Focused");
        }
        return this.wait(0.5);
    }

    hitCell(index) {
        const grid = this.container.FindChild("EasyHitGrid");
        if (!grid) {
            throw new Error("no hit grid");
        }
        return grid.Children()[index || 0];
    }

    rightClickEmpty(index) {
        this.hitCell(index).fire("oncontextmenu");
        return this.wait(0.2);
    }

    // The live context menu, ignoring one that is waiting to be deleted.
    menu() {
        return this.container.Children().find(c => c.id === "EasyContextMenu" && !c._pendingDelete) || null;
    }

    clickMenu(text) {
        const menu = this.menu();
        if (!menu) {
            throw new Error("no menu open");
        }
        const button = menu.FindChildrenWithClassTraverse("EasyMenuItem")
            .find(b => b.Children().some(l => l.text.startsWith(text)));
        if (!button) {
            throw new Error(`no menu item "${text}"`);
        }
        this.click(button);
        return this.wait(0.2);
    }

    searchEntry() {
        const menu = this.menu();
        return menu ? menu.FindChildTraverse("EasySearchEntry") : null;
    }

    typeSearch(text) {
        const entry = this.searchEntry();
        entry.text = text;
        entry.fire("ontextentrychange");
        return this.wait(0.1);
    }

    pressEnter() {
        this.searchEntry().fire("oninputsubmit");
        return this;
    }

    shopCard(name) {
        return this.filtered.FindChildrenWithClassTraverse("modName").find(l => l.text === name)._parent;
    }

    rightClickShopItem(name) {
        this.shopCard(name).fire("oncontextmenu");
        return this;
    }

    // Starts dragging a section by its MOVE grip; returns the drop function.
    startSectionDrag(name) {
        const grip = this.section(name).FindChildTraverse("EasyMoveGrip");
        const drag = {};
        for (const fn of grip._listeners.DragStart || []) {
            fn(grip.id, drag);
        }
        return to => {
            const ghost = drag.displayPanel || null;
            if (ghost && ghost._valid && to) {
                ghost.windowPos = { x: this.container.windowPos.x + to.x, y: this.container.windowPos.y + to.y };
            }
            for (const fn of grip._valid ? grip._listeners.DragEnd || [] : []) {
                this.rt.guard("DragEnd", () => fn(grip.id, ghost));
            }
            return this.wait(0.3);
        };
    }

    // ---- checks ----

    logs(pattern) {
        return this.rt.logs.filter(l => pattern.test(l));
    }

    tickLoops() {
        return this.rt.queue.filter(e => e.fn && e.fn.name === "tick").length;
    }

    dimmedCards() {
        return this.filtered.FindChildrenWithClassTraverse("modName")
            .map(l => l._parent)
            .filter(card => card.style.opacity !== undefined);
    }

    // Everything the mod should have handed back once Easy mode is off.
    residue() {
        const out = [];
        for (const p of this.rt.allPanels) {
            if (!p._valid) {
                continue;
            }
            if (p._origin === "script") {
                out.push(`script panel still exists: ${p.path()}`);
                continue;
            }
            if (p._styles.size > 0) {
                out.push(`inline styles left on ${p.path()}: ${JSON.stringify(p.inlineStyles())}`);
            }
            if (p._baseline && (p.visible !== p._baseline.visible || p.hittest !== p._baseline.hittest)) {
                out.push(`visible/hittest changed on ${p.path()}`);
            }
        }
        if (this.rt.focus === this.rt.LOST_FOCUS) {
            out.push("keyboard focus left on a deleted panel");
        } else if (this.rt.focus && this.rt.focus._origin === "script") {
            out.push("keyboard focus left on a mod panel");
        }
        if (this.build.BHasClass("EasyEdit")) {
            out.push("build panel still has .EasyEdit");
        }
        if (this.purchases.length) {
            out.push(`items bought outside edit mode: ${this.purchases.join(", ")}`);
        }
        if (this.outsideEdit.length) {
            out.push(`build commands sent outside edit mode: ${this.outsideEdit.join(", ")}`);
        }
        out.push(...this.logs(/LEFTOVER|ERROR/));
        out.push(...this.rt.errors);
        return out;
    }
}

module.exports = { FakeGame };
