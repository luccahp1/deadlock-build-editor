# Testing and debugging without restarting the game

Deadlock loads mods only at startup, so every in-game check costs a full
restart. This file is how to avoid most of them. **Claude sessions: read it
before changing the mod.**

## The order to work in

1. **Offline tests, every change.** No game needed; this works in a cloud session.
   ```bash
   npm test            # same as: node --test "tests/*.test.js"
   ```
   They run the mod's real `easy_build_editor.js` and layout XML against a fake
   Panorama runtime and a fake Deadlock HUD (`tests/harness/`). CI runs them on
   every push (`.github/workflows/test.yml`).
2. **In game, only for what the fake cannot know** (real layout, real game
   reactions, anything under "Unverified" below). On the PC, one command:
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\dev.ps1 -Restart
   ```
   It runs the offline tests, closes Deadlock, builds, installs, relaunches with
   `-condebug -dev -novid` and waits until the game logs the new build id. Then:
   ```bash
   python tools/gamelog.py --check     # mod lines + errors; exit 1 on errors/leftovers
   ```
   A Claude session running on the PC can do all of this itself; the player only
   has to do what a script cannot (open the shop, press Edit, click things).
3. **Write down what you learned** in the "Fake game beliefs" table below and,
   if the fake was wrong, fix the fake first and then the mod.

## Offline harness

| File | What it is |
|---|---|
| `tests/harness/panorama.js` | Minimal Panorama: panels, classes, inline styles, `$.Schedule` on a virtual clock, `$.CreatePanel`, `$.DispatchEvent`, `$.RegisterEventHandler`, a layout XML loader. |
| `tests/harness/fake_game.js` | Fake HUD around the real layout: shop tabs, edit mode, sections, shop cards, and the game's answers to `CitadelHudHeroBuilds*` / `CitadelSelectShopTab`. Player actions: `pressEdit()`, `pressEasyEditor()`, `pressSave()`, `pressCancel()`, `pressEscape()`, `rightClickEmpty()`, `clickMenu()`, `typeSearch()`, `startSectionDrag()`, `rightClickShopItem()`, `wait(seconds)`. |
| `tests/exit_paths.test.js` | Every way out of Easy mode, checked with `game.residue()`. |
| `tests/static.test.js` | Layout ↔ script ↔ CSS cross-checks: exported functions, ids, menu widths, shop tab names. |

The mock models these Panorama quirks (from HANDOFF.md) so tests catch them:

- camelCase inline styles (`marginTop`) cannot be unset; clear the CSS name (`margin`).
- Clearing `visibility` leaves the panel hidden.
- `DeleteAsync` deletes on a later frame; the panel can still be found by id until then.
- Any call into a deleted panel throws.

`game.residue()` lists everything the mod should have handed back after
leaving Easy mode: panels the script created, inline styles on game panels,
changed `visible`/`hittest`, keyboard focus on a mod panel, `.EasyEdit`, items
bought outside edit mode, build commands sent outside edit mode, and any
`ERROR` or `exit check: LEFTOVER` the script logged.

Quick experiments without a test file:

```bash
node -e '
const { FakeGame } = require("./tests/harness/fake_game");
const g = new FakeGame();
g.pressEdit().pressEasyEditor().focusSection("Early Game").rightClickEmpty(40).clickMenu("Add item").typeSearch("extra");
g.pressSave().wait(1);
console.log(g.residue(), g.rt.logs.slice(-5));'
```

Fake game options (`new FakeGame({...})`): `clickAdds` (which replayed clicks
add items in edit mode; `[]` = none, like the hideout), `escExitsEdit`,
`rebuildWipesContainer`, `cards`, `savedBuild`.

When the script calls a Panorama API the mock lacks, the call throws, the
script logs `ERROR in ...` and the tests fail. Add the API to `panorama.js`,
copying the real behaviour as far as it is known.

### Fake game beliefs

What the fake assumes about the real game. Update this table when an in-game
test confirms or contradicts a belief.

| Belief | Status |
|---|---|
| Edit mode = `gEditingBuilds` class on an ancestor of the build panel | verified |
| Shop tab = `showing<Tab>` class on an ancestor (`showingAllItems`, ...) | verified for AllItems |
| Only the selected tab's cards are filled in; the other tabs are hidden by opacity classes | verified |
| `CitadelHudHeroBuildsSaveEdits` / `DiscardEdits` leave edit mode | believed |
| Shop open = `gShopOpen` class on an ancestor. The script only acts on it once it has seen the class, so a wrong name is harmless | unverified |
| Esc with no text box focused closes the shop. Whether it also leaves edit mode is unknown, so both are tested | unverified |
| A replayed `Activated` on a shop item adds it in edit mode, and **buys** it outside edit mode (in a match) | unverified (hideout: does nothing) |
| `DropInputFocus` on a focused text entry hands keyboard focus back to the game | unverified |
| A deleted focused panel passes focus to its parent | unverified |
| The game may rebuild the section list at any time | believed |

## In-game loop details

- **Launch options:** `-condebug` writes `game/citadel/console.log`; `-dev` and
  `-novid` skip the intro. `tools/dev.ps1` passes all three.
- **Build id:** `build.py` writes `<git commit>[+ if src is dirty]@<time>` into
  the script; the script logs `[EasyBuildEditor] loaded build <id>` when the HUD
  loads it. If the id in the log is not the one you just built, the game is
  running an old VPK (not restarted, or another `pakNN_dir.vpk` shadows it).
- **Exit check:** 0.3s after every exit from Easy mode the script logs
  `exit check: clean`, or `exit check: LEFTOVER ...` naming what is left
  (menu, hit grid, drag ghost, grips, dimmed items, queued sections, styles).
- **When the script loads:** `citadel_shop_mods_build` is part of the in-game
  HUD, so expect the `loaded build` line after entering the hideout or a match,
  not in the main menu.
- `DEADLOCK_ROOT` points `build.py`, `gamelog.py` and `dev.ps1` at a game
  installed outside the default Steam folder.

## Can the restart be avoided? Research (2026-10-20)

Done from a cloud session, so nothing here was tried in game yet.

- **No documented hot reload.** Deadlock modding guides and the Deadlock Mod
  Manager docs all say to restart after changing mods, and a HUD mod's README
  says "a reconnect is not enough"
  ([Deadlock Mod Manager docs](https://docs.deadlockmods.app/using-mod-manager/getting-started),
  [Deadlock-QoL-HUD-Mod](https://github.com/mntbliss/Deadlock-QoL-HUD-Mod)).
  VPKs in `addons` are mounted once at startup.
- **No script-side reload.** Dota 2's `$.AsyncWebRequest` (which could have
  fetched a script and `eval`'d it) was removed from Panorama for security
  reasons ([Gen Digital write-up](https://www.gendigital.com/blog/insights/research/dota-2-under-attack-how-a-v8-bug-was-exploited-in-the-game)),
  so a "dev loader" that pulls the script from localhost is not expected to work.
- **Panorama debugger.** Source 2 has one (F6 in workshop tools; it inspects
  panels and their styles live), but Valve's wiki says it appears disabled in
  some games ([Valve wiki](https://developer.valvesoftware.com/wiki/Panorama/Overview/Debugger)).
  Not known for Deadlock.
- **Remote console.** Source 2 tools mode runs a VConsole2 server on TCP port
  29000 that external programs can send console commands to
  ([CS2RemoteConsole](https://github.com/theokyr/CS2RemoteConsole)). It needs
  `-tools`, which Deadlock may not ship. Source 1's `-netconport` has no
  confirmed Source 2 equivalent.
- **Console commands.** The Valve wiki notes that Deadlock's `cvarlist` output
  is cut off by the console line limit and is not written by `-condebug`
  ([Valve wiki](https://developer.valvesoftware.com/wiki/List_of_Deadlock_console_commands_and_variables)),
  so search with `find <word>` instead.

### Experiments to run at home

Each one is a few minutes. Record the result in the table, then turn anything
that works into a script in `tools/`.

1. **Reload commands.** With `-condebug`, run in the console (F7):
   `find panorama`, `find reload`, `find hud`, `find resource`, `find addon`.
   Save `console.log` to `docs/research/convars.txt`. Look for anything that
   reloads layouts, styles or scripts (Source 1 had `hud_reloadscheme`).
2. **Loose files + map reload.** Extract the compiled files from
   `dist/pak42_dir.vpk` (`python tools/vpkread.py dist/pak42_dir.vpk x _loose .`)
   and place them loose under `game/citadel/` (e.g.
   `game/citadel/panorama/scripts/easy_build_editor.vts_c`) with the VPK removed.
   Start the game, enter the hideout and check the build id. Then rebuild,
   copy the new loose files over **while the game runs**, leave and re-enter the
   hideout (or `disconnect` then rejoin) and check whether the new build id is
   logged. If yes: no restart for script, style and layout changes.
3. **Tools mode / VConsole.** Launch with `-tools` and with `-vconsole`, and
   check `Test-NetConnection 127.0.0.1 -Port 29000`. If the port is open,
   console commands (`disconnect`, `map ...`) can be sent from a script.
4. **netcon.** Launch with `-netconport 2121` and check
   `Test-NetConnection 127.0.0.1 -Port 2121`. If open, a plain TCP connection
   takes console commands (Source 1 behaviour).
5. **Panorama debugger.** With `-dev`, press F6 in the hideout, or try
   `panorama_debugger` in the console. If it opens, live panel and style
   inspection replaces many restart-and-log cycles.
6. **Straight into the hideout.** Find the hideout map name (`status` in the
   hideout) and try launching with `+map <name>`, so `dev.ps1` can skip the
   menus.

| # | Experiment | Result |
|---|---|---|
| 1 | Reload commands (`find ...`) | not tried |
| 2 | Loose files + re-enter hideout | not tried |
| 3 | `-tools` / `-vconsole`, port 29000 | not tried |
| 4 | `-netconport 2121` | not tried |
| 5 | Panorama debugger (F6, `panorama_debugger`) | not tried |
| 6 | `+map` straight to the hideout | not tried |

## Exit-path audit (2026-10-20)

Every way out of Easy mode, what went wrong before, and the test that covers
it now (`tests/exit_paths.test.js`). Run against the old script, 10 of these
tests fail.

| Exit | Problem before | Now |
|---|---|---|
| Easy Editor button off | fine | covered |
| SAVE BUILD / CANCEL (footer), game's own Save | fine for the layout, but delayed work survived (below) | covered |
| Esc in the search box | menu closed but keyboard focus stayed on the deleted text box | focus dropped before the box is deleted |
| Esc closing the shop | menu, dimmed shop items and the focused search box stayed behind the closed shop | closed on the next tick |
| Esc that also ends edit mode | fine | covered |
| Game rebuilds the section list | menu went with it but the shop stayed dimmed | dimming cleared |
| Save / Cancel mid-drag | green drag ghost left on screen; a late DragEnd pinned the section at x/y in the game's own layout | ghost deleted, no placement after exit |
| A drag whose DragEnd never comes | ghost left forever | removed on exit |
| Hide shop | build panel vanished (All Items tab stays selected and the game hides the build tab); also wiped free placement for a tick | selects the Build tab; only the shop layout is undone |
| Edit again with the shop hidden | re-selected All Items, so the build was hidden | stays on Build |
| Right-click an item, then Save | probe kept replaying clicks on the shop item after exit (outside edit mode that could buy it) and threw on the deleted section | probe stops when the edit session ends |
| Starter set, then Cancel | the queued sections were created in the *next* edit session | queue dropped on exit |
| Create category, then Save | spawn point carried over | dropped |
| Search opened then closed within 0.05s | timer focused a deleted panel | checked first |
| Pressing Easy Editor repeatedly | every press started another tick loop (5 after 8 presses) | one loop |
| An error inside a tick | loop died, Easy mode frozen half on | logged as `ERROR in tick`, loop continues |
| Shop / build `visible` | forced to `true` and never put back | restored |

Still open (need the game):

- Panels the mod collapses (`ShopNavigation`, the Edit Build titles) get an
  inline `visibility: visible` on exit, because Panorama cannot unset
  visibility. Harmless unless the game later hides them with CSS. A clearable
  alternative (opacity 0 + zero size) needs an in-game look.
- Right-click handlers are set on shop and build items with `SetPanelEvent`
  and stay after exit (they do nothing outside Easy mode). If the game has its
  own right-click action on those items, the mod replaces it. Check: right-click
  a shop item outside Easy mode after using Easy mode once.
- The beliefs marked unverified above.
