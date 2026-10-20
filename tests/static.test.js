"use strict";
// Cross-checks between the layout, the script and the stylesheet: the
// mistakes that otherwise only show up after a game restart.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { parseXml } = require("./harness/panorama");
const { FakeGame } = require("./harness/fake_game");

const ROOT = path.resolve(__dirname, "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");
const LAYOUT = read("src/panorama/layout/citadel_shop_mods_build.xml");
const SCRIPT = read("src/panorama/scripts/easy_build_editor.js");
const CSS = read("src/panorama/styles/easy_build_editor.css");

function layoutNodes() {
    const out = [];
    const walk = node => {
        out.push(node);
        node.children.forEach(walk);
    };
    walk(parseXml(LAYOUT));
    return out;
}

const layoutIds = new Set(layoutNodes().map(n => n.attrs.id).filter(Boolean));
const scriptIds = new Set([...SCRIPT.matchAll(/CreatePanel\("\w+",\s*[\w.()]+,\s*"(\w+)"/g)].map(m => m[1]));
const constIds = new Set([...SCRIPT.matchAll(/const \w+_ID = "(\w+)"/g)].map(m => m[1]));

test("layout is well formed and includes the mod's style and script", () => {
    assert.match(LAYOUT, /easy_build_editor\.vcss/);
    assert.match(LAYOUT, /easy_build_editor\.vts/);
    assert.ok(layoutIds.has("CategoryContainer"));
});

test("every EasyBuildEditor call in the layout is exported by the script", () => {
    const game = new FakeGame();
    const exported = Object.keys(game.api);
    const called = new Set([...LAYOUT.matchAll(/EasyBuildEditor\.(\w+)/g)].map(m => m[1]));
    for (const name of called) {
        assert.ok(exported.includes(name), `layout calls EasyBuildEditor.${name}, script exports ${exported.join(", ")}`);
    }
});

test("ids the script looks up exist in the layout, the game or the script", () => {
    const game = new FakeGame();
    const gameIds = new Set(game.rt.allPanels.map(p => p.id).filter(Boolean));
    const looked = new Set([...SCRIPT.matchAll(/(?:find|FindChildTraverse|FindChild|activate)\("(\w+)"\)/g)].map(m => m[1]));
    for (const id of looked) {
        assert.ok(layoutIds.has(id) || gameIds.has(id) || scriptIds.has(id) || constIds.has(id),
            `script looks up #${id}, which nothing creates`);
    }
});

test("every #id in the stylesheet exists", () => {
    const cssIds = new Set([...CSS.matchAll(/#(\w+)/g)].map(m => m[1]).filter(id => !/^[0-9a-f]{3,8}$/i.test(id)));
    for (const id of cssIds) {
        assert.ok(layoutIds.has(id) || scriptIds.has(id) || constIds.has(id), `CSS styles #${id}, which nothing creates`);
    }
});

test("menu widths in the script match the stylesheet", () => {
    const width = selector => {
        const block = new RegExp(selector.replace(/[.#]/g, m => "\\" + m) + "\\s*\\{([^}]*)\\}").exec(CSS);
        return block ? Number(/width:\s*(\d+)px/.exec(block[1])[1]) : NaN;
    };
    assert.strictEqual(Number(/MENU_WIDTH = (\d+)/.exec(SCRIPT)[1]), width("#EasyContextMenu"));
    assert.strictEqual(Number(/SEARCH_WIDTH = (\d+)/.exec(SCRIPT)[1]), width("#EasyContextMenu.Search"));
});

test("shop tab switches use known tabs", () => {
    const tabs = ["Weapon", "Spirit", "Vitality", "AllItems", "Build", "Recommended"];
    for (const m of LAYOUT.matchAll(/CitadelSelectShopTab\(\s*EShopTab_(\w+)\s*\)/g)) {
        assert.ok(tabs.includes(m[1]), `unknown shop tab EShopTab_${m[1]}`);
    }
});
