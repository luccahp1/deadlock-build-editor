"use strict";
// Every way out of Easy mode must hand the UI back exactly as the game left
// it: no menus, ghosts, grids or dimmed items, no inline styles on game
// panels, no stray keyboard focus, no delayed work running afterwards.
//
//   node --test tests/

const test = require("node:test");
const assert = require("node:assert");
const { FakeGame } = require("./harness/fake_game");

// Panorama cannot unset `visibility`, so panels the mod collapsed get an
// inline `visibility: visible` back (see HANDOFF.md). Known and accepted
// until a clearable way to hide them is verified in game.
const KNOWN_RESIDUE = /visibility":"visible"}$/;

function assertClean(game, label) {
    const left = game.residue().filter(r => !KNOWN_RESIDUE.test(r));
    assert.deepStrictEqual(left, [], `${label || "exit"} left things behind`);
    assert.ok(game.logs(/exit check: clean/).length > 0, "the in-game exit check did not report clean");
}

function easyMode(options) {
    const game = new FakeGame(options);
    game.pressEdit().pressEasyEditor();
    assert.ok(game.build.BHasClass("EasyEdit"), "Easy mode did not turn on");
    return game;
}

function withSearchOpen(game) {
    game.focusSection("Early Game").rightClickEmpty(40).clickMenu("Add item").wait(0.1).typeSearch("extra");
    assert.ok(game.searchEntry(), "search did not open");
    assert.ok(game.dimmedCards().length > 0, "search did not dim the shop");
    assert.ok(game.rt.focus === game.searchEntry(), "search box did not get focus");
    return game;
}

// ---- the exits ----

test("Easy Editor button off restores everything", () => {
    const game = easyMode();
    withSearchOpen(game);
    game.pressEasyEditor().wait(1);
    assertClean(game);
    assert.strictEqual(game.tab, "Build");
    assert.ok(game.editing, "turning Easy mode off must not leave edit mode");
});

test("SAVE BUILD with the search open", () => {
    const game = withSearchOpen(easyMode());
    game.pressSave().wait(1);
    assertClean(game);
    assert.strictEqual(game.tab, "Build");
});

test("CANCEL with the search open", () => {
    const game = withSearchOpen(easyMode());
    game.pressCancel().wait(1);
    assertClean(game);
    assert.deepStrictEqual(game.snapshot().map(s => s.name), ["Early Game", "Late Game"]);
});

test("the game's own Save in the Edit Build strip", () => {
    const game = easyMode();
    game.rightClickEmpty(3); // plain menu open
    game.gameSave().wait(1);
    assertClean(game);
});

test("Esc in the search box closes only the search", () => {
    const game = withSearchOpen(easyMode());
    game.pressEscape();
    assert.ok(!game.menu(), "menu still open");
    assert.strictEqual(game.dimmedCards().length, 0, "shop still dimmed");
    assert.ok(game.rt.focus === null, "keyboard focus not handed back to the game");
    assert.ok(game.build.BHasClass("EasyEdit"), "Esc in the box should not leave Easy mode");
    game.pressEasyEditor().wait(1);
    assertClean(game);
});

test("Esc closing the shop drops the menu and the dimming", () => {
    const game = withSearchOpen(easyMode());
    game.rt.focus = null; // player clicked away from the box first
    game.pressEscape();
    assert.ok(!game.shopOpen);
    assert.ok(!game.menu(), "menu left open behind the closed shop");
    assert.strictEqual(game.dimmedCards().length, 0, "shop left dimmed");
    game.openShop().pressCancel().wait(1);
    assertClean(game);
});

test("Esc that also ends edit mode", () => {
    const game = withSearchOpen(easyMode({ escExitsEdit: true }));
    game.rt.focus = null;
    game.pressEscape().wait(1);
    assertClean(game);
});

test("the game rebuilding the section list takes the menu with it", () => {
    const game = withSearchOpen(easyMode({ rebuildWipesContainer: true }));
    game.rebuildSections();
    assert.strictEqual(game.dimmedCards().length, 0, "dimming outlived the menu");
    assert.ok(game.container.FindChild("EasyHitGrid"), "hit grid not recreated");
    game.pressSave().wait(1);
    assertClean(game);
});

test("Save while dragging a section", () => {
    const game = easyMode();
    const drop = game.startSectionDrag("Late Game");
    assert.ok(game.build.FindChildTraverse("EasyDragGhost"), "no drag ghost");
    game.pressSave();
    drop({ x: 400, y: 300 });
    game.wait(1);
    assertClean(game, "save mid-drag");
});

test("a drag that never ends is cleaned up on exit", () => {
    const game = easyMode();
    game.startSectionDrag("Late Game"); // DragEnd never fires
    game.pressCancel().wait(1);
    assertClean(game);
});

test("Hide shop shows the build, Show shop brings the shop back", () => {
    const game = easyMode();
    game.click(game.buttonByText("Hide shop")).wait(0.5);
    assert.strictEqual(game.tab, "Build", "build panel would be hidden behind the All Items tab");
    assert.strictEqual(game.build.FindChildTraverse("EasySplitLabel").text, "Show shop");
    assert.strictEqual(game.filtered.inlineStyles().width, undefined, "shop still laid out beside the build");
    assert.ok(game.container.inlineStyles()["flow-children"], "free placement dropped by Hide shop");
    game.click(game.buttonByText("Show shop")).wait(0.5);
    assert.strictEqual(game.tab, "AllItems");
    game.pressSave().wait(1);
    assertClean(game);
    assert.strictEqual(game.tab, "Build");
});

test("entering Easy mode with the shop hidden keeps the build tab", () => {
    const game = easyMode();
    game.click(game.buttonByText("Hide shop")).wait(0.5);
    game.pressSave().pressEdit().wait(0.5);
    assert.ok(game.build.BHasClass("EasyEdit"), "Easy mode should come back on the next Edit");
    assert.strictEqual(game.tab, "Build");
    game.pressCancel().wait(1);
    assertClean(game);
});

test("switching shop tabs with the chips, then leaving", () => {
    const game = easyMode();
    game.click(game.buttonByText("Weapon")).wait(0.3);
    assert.strictEqual(game.tab, "Weapon");
    game.pressSave().wait(1);
    assertClean(game);
    assert.strictEqual(game.tab, "Build");
});

// ---- delayed work must not outlive the edit session ----

test("a right-click probe stops when Easy mode ends (no purchases)", () => {
    const game = easyMode({ clickAdds: [] }); // like the hideout: nothing adds
    game.focusSection("Early Game").rightClickShopItem("Sprint Boots").wait(0.1);
    game.pressSave().wait(3);
    assertClean(game);
    assert.ok(game.logs(/right-click: stopped/).length > 0, "probe did not notice the exit");
});

test("queued sections are dropped on exit, not created in the next edit", () => {
    const game = easyMode();
    game.click(game.buttonByText("Starter set")).wait(0.1);
    game.pressCancel().wait(1);
    assertClean(game);
    game.pressEdit().wait(3);
    assert.deepStrictEqual(game.snapshot().map(s => s.name), ["Early Game", "Late Game"]);
});

test("a menu spawn point is dropped on exit", () => {
    const game = easyMode();
    game.rightClickEmpty(5).clickMenu("Create category");
    game.pressSave().wait(1);
    assertClean(game);
});

test("search focus timer firing after the menu closed", () => {
    const game = easyMode();
    game.rightClickEmpty(5).clickMenu("Add item"); // focus is set 0.05s later
    game.pressSave().wait(1);
    assertClean(game);
});

// ---- the loop itself ----

test("pressing Easy Editor many times keeps a single tick loop", () => {
    const game = easyMode();
    // An even number of presses: still on.
    for (let i = 0; i < 8; i++) {
        game.click(game.build.FindChildTraverse("EasyEditorButton"));
    }
    game.wait(2);
    assert.ok(game.build.BHasClass("EasyEdit"));
    assert.strictEqual(game.tickLoops(), 1, `${game.tickLoops()} tick loops running`);
    game.pressEasyEditor().wait(2); // one more: off
    assert.strictEqual(game.tickLoops(), 0, "loop still running with Easy mode off");
    assertClean(game);
});

test("a tick that throws does not freeze Easy mode", () => {
    const game = easyMode();
    const container = game.container;
    const real = container.Children.bind(container);
    let calls = 0;
    container.Children = () => {
        if (calls++ === 0) {
            throw new Error("simulated game hiccup");
        }
        return real();
    };
    game.wait(1);
    assert.ok(game.logs(/ERROR in tick/).length === 1, "error not logged");
    assert.strictEqual(game.tickLoops(), 1, "loop died");
    container.Children = real;
    game.rt.logs = game.rt.logs.filter(l => !/ERROR/.test(l));
    game.pressSave().wait(1);
    assertClean(game);
});

test("repeated edit sessions stay clean", () => {
    const game = easyMode();
    for (let i = 0; i < 3; i++) {
        withSearchOpen(game);
        game.pressSave().pressEdit().wait(0.5);
        assert.ok(game.build.BHasClass("EasyEdit"));
    }
    game.pressEasyEditor().wait(1);
    assertClean(game);
});
