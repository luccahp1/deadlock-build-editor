# Deadlock Easy Build Editor

A client-side UI mod for [Deadlock](https://store.steampowered.com/app/1422450/Deadlock/) that
turns the hero build editor into a single screen. Press **Easy Editor** in edit mode and you get
the full item shop and your build side by side, with the game's Edit Build controls in a strip
along the bottom.

It only changes UI files. Every edit still goes through the game's own build commands, so
saving, sharing and publishing work exactly as they do without the mod. No gameplay changes,
no memory editing, no injected code.

## Features

- **Shop and build on one screen.** The All Items shop (Weapon, Spirit and Vitality) sits on the
  left, scaled to fit, and the build sits on the right. No more flipping between tabs to add items.
- **Free section placement.** Grab a section by its **MOVE** tag and drop it anywhere. Sections
  stay where you put them, with no snapping.
- **Right-click menu.** Right-click empty space in the build area to:
  - **Create category** at that spot.
  - **Add item**: search the shop by name. Matching items stay lit in the shop and the rest dim,
    so you can drag the one you want, or press Enter to add the best match.
- **Right-click items.** Right-click a shop item to add it to the selected section, or a build
  item to remove it.
- **"Adding to" banner.** Shows which section is selected and how many items it holds.
- **Toolbar.** Shop tab shortcuts, quick-add sections (Early, Mid, Late, Situational, Blank, or a
  four-section starter set), Compact all, and Hide shop.
- **Save / Cancel** pinned at the bottom of the build.

Turning Easy mode off puts the editor back to the game's own layout.

> **Working on the mod (including Claude sessions):** you don't need the game to test most changes.
> Run `npm test` and see [Testing without the game](#testing-without-the-game-read-this-first-claude-sessions).

## Install

1. Download `dist/pak42_dir.vpk` from this repository, or build it yourself (below).
2. Copy it into `Steam\steamapps\common\Deadlock\game\citadel\addons\`.
   If you already have a `pak42_dir.vpk` from another mod, rebuild with a free number:
   `python build.py --pak 43`.
3. Make sure `game\citadel\gameinfo.gi` lists `Game citadel/addons` under `SearchPaths`.
   Mod managers usually set this up for you.
4. Restart Deadlock (mods load at startup only).
5. Open the shop, pick a build, press **Edit**, then **Easy Editor**.

To uninstall, delete the VPK.

## Known limitations

- Section positions last for the current game session. Builds store section order and width,
  not positions.
- Adding an item with a right-click or from search relies on the game accepting a replayed click
  on the shop item. It is not confirmed to work everywhere; dragging the item onto a section
  always works.
- Tested at 1920x1080. The layout reads the screen size, so other 16:9 resolutions should work.
- A game patch that changes the build panel layout can break the mod until it is updated.

## Build from source

Requirements: Windows, Python 3.10+, the .NET 10 SDK and a Deadlock install.

```bash
git clone https://github.com/ValveResourceFormat/ValveResourceFormat _ext/vrf
dotnet build tools/pancomp -c Release -o tools/bin
python build.py
```

The output is `dist/pak42_dir.vpk`. `python build.py --install` also copies it into the game's
`addons` folder. Set `DEADLOCK_ROOT` if Deadlock is not in the default Steam folder.

`tools/pancomp` is a small compiler built on ValveResourceFormat. It compiles Panorama `xml`,
`css` and `js` sources into the `vxml_c`, `vcss_c` and `vts_c` resources Deadlock loads, using
the game's own compiled files as templates, and packs them into a VPK.

## Testing without the game (read this first, Claude sessions)

Deadlock loads mods only at startup, so every in-game test costs a full restart. Most of the mod
can be tested without the game at all, including from a cloud session that has no Deadlock
install. **Do this after every change, before asking anyone to launch the game:**

```bash
npm test     # = node --test "tests/*.test.js"; Node.js 20+, no npm install needed
```

What it does: `tests/harness/panorama.js` is a small fake of Valve's Panorama UI runtime, and
`tests/harness/fake_game.js` is a fake Deadlock shop and build editor that answers the game's build
commands. Together they load the mod's **real** `easy_build_editor.js` and layout XML, so the tests
exercise the code that ships. The tests cover:

- `tests/exit_paths.test.js`: every way out of Easy mode (Easy Editor button, SAVE BUILD, CANCEL,
  the game's own Save, Esc in the search box, Esc closing the shop, leaving mid-drag, mid-search,
  mid right-click, with queued sections, Hide shop, ...). Each one must leave nothing behind: no
  mod panels, no inline styles on game panels, no dimmed items, no stray keyboard focus, no
  delayed work running afterwards. `game.residue()` lists anything left over.
- `tests/static.test.js`: the layout, script and CSS agree (exported functions, ids, menu widths,
  shop tab names).

The fake reproduces the known Panorama quirks (camelCase styles can't be unset, a cleared
`visibility` stays hidden, `DeleteAsync` is delayed, calls into deleted panels throw), so code
that breaks in game because of them also fails here. GitHub CI runs the same tests on every push.

**Trying something by hand**, without writing a test:

```bash
node -e '
const { FakeGame } = require("./tests/harness/fake_game");
const g = new FakeGame();
g.pressEdit().pressEasyEditor().focusSection("Early Game");
g.rightClickEmpty(40).clickMenu("Add item").typeSearch("extra");
g.pressSave().wait(1);
console.log(g.residue(), g.rt.logs.slice(-5));'
```

Two `visibility: visible` entries in that output are a known, accepted leftover: Panorama can't
unset `visibility`, so panels the mod hid get it written back. The tests allow exactly that and
nothing else.

Player actions available on `FakeGame`: `pressEdit()`, `pressEasyEditor()`, `pressSave()`,
`pressCancel()`, `gameSave()`, `pressEscape()`, `openShop()`, `focusSection(name)`,
`rightClickEmpty(cell)`, `clickMenu(text)`, `typeSearch(text)`, `pressEnter()`,
`rightClickShopItem(name)`, `startSectionDrag(name)`, `click(panel)`, `buttonByText(text)`,
`rebuildSections()`, `wait(seconds)`. Options such as `new FakeGame({ clickAdds: [] })` change
how the fake game behaves (see `docs/TESTING.md`).

**When you change the mod:**

1. Add or update a test for the behaviour in `tests/`, then run `npm test`.
2. If the script calls a Panorama API the fake doesn't have yet, the test fails with
   `ERROR in ...`. Add the API to `tests/harness/panorama.js`, matching the real behaviour as far
   as it is known.
3. The fake only knows what has been learned about the real game. Its assumptions, and which ones
   have been checked in game, are listed under "Fake game beliefs" in
   [docs/TESTING.md](docs/TESTING.md). If the game turns out to behave differently, fix the fake
   first, then the mod.

**What still needs the game:** real layout and sizes, how the game reacts to replayed clicks,
and anything marked unverified in `docs/TESTING.md`. On the Windows PC, a Claude session can run
the whole loop itself; the player only has to click through the shop:

```powershell
powershell -ExecutionPolicy Bypass -File tools\dev.ps1 -Restart   # tests, close game, build, install, relaunch, wait for the new build
python tools\gamelog.py --check                                    # the mod's console lines; exit 1 on errors or leftovers
```

The script logs `[EasyBuildEditor] loaded build <id>` when the game loads it, so the log shows
whether the game is running the build you just made. After every exit from Easy mode it logs
`exit check: clean`, or `exit check: LEFTOVER ...` naming what was left behind.

[docs/TESTING.md](docs/TESTING.md) has the details: the research into avoiding restarts, the
experiments still to try in game, and the exit-path audit.

## Project layout

| Path | Contents |
|---|---|
| `src/panorama/layout/citadel_shop_mods_build.xml` | The game's build panel layout plus the Easy Editor button, toolbar and footer |
| `src/panorama/styles/easy_build_editor.css` | Styles for the added UI |
| `src/panorama/scripts/easy_build_editor.js` | Layout, free placement, right-click menu, search |
| `tests/` | Offline tests: fake Panorama runtime and fake game in `tests/harness/` |
| `docs/TESTING.md` | Test workflow, research on avoiding restarts, exit-path audit |
| `tools/dev.ps1` | Build, install, restart the game, wait for the new build |
| `tools/gamelog.py` | Mod lines and errors from the game's `console.log` |
| `tools/pancomp` | Panorama compiler and VPK packer |
| `tools/vpkread.py` | Minimal VPK reader and extractor |
| `tools/blocks.py` | Resource block inspector |
| `build.py` | Compiles the sources and packs the VPK |

## Updating after a game patch

The mod replaces `citadel_shop_mods_build` with a modified copy of the game's version. If a patch
changes that file, extract and decompile the new one, carry the Easy Editor additions over, then
rebuild:

```bash
python tools/vpkread.py "<Deadlock>/game/citadel/pak01_dir.vpk" x _ref "citadel_shop_mods_build"
tools/s2v/Source2Viewer-CLI.exe -i _ref/panorama/layout/citadel_shop_mods_build.vxml_c -o _ref/new.xml -d
```

## Troubleshooting

Launch with `-condebug` to write the game console to `game/citadel/console.log`. The mod logs
lines prefixed with `[EasyBuildEditor]`: the build it loaded (`loaded build <id>`), the measured
layout and how many shop cards loaded when Easy mode turns on, and an `exit check` after every
exit from Easy mode. `python tools/gamelog.py` prints just those lines and any script errors.

## License

MIT, see [LICENSE](LICENSE). Deadlock and its assets belong to Valve. This project is not
affiliated with or endorsed by Valve.
