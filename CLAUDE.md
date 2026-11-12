# Deadlock Easy Build Editor — Claude context

## Overview
Client-side Panorama UI mod for Deadlock: an "Easy Editor" button in the hero build editor puts
the All Items shop and the build on one screen, with free section placement, a right-click menu
(create category, add item by search) and a toolbar. UI files only; every edit goes through the
game's own build commands. Public repo, MIT. Current state and open checks: `HANDOFF.md`.

## Stack
- Mod: Panorama JS (`.js`), layout XML, CSS, compiled into `vts_c` / `vxml_c` / `vcss_c`.
- Tests: Node 20+ (`node --test`), no npm dependencies. CI uses Node 22.
- Build: Python 3.10+ (`build.py`) driving `tools/bin/pancomp.exe`, a .NET 10 compiler built on
  ValveResourceFormat. Windows plus a Deadlock install are needed only to build the VPK.

## Layout
- `src/panorama/scripts/easy_build_editor.js` — the whole mod logic
- `src/panorama/layout/citadel_shop_mods_build.xml` — the game's build panel layout, with the mod's panels added
- `src/panorama/styles/easy_build_editor.css` — mod styles
- `dist/pak42_dir.vpk` — the built mod people download (committed)
- `tests/harness/panorama.js`, `fake_game.js` — fake Panorama runtime and fake Deadlock HUD
- `tests/exit_paths.test.js`, `tests/static.test.js` — offline suites
- `build.py` — compile + pack; `tools/pancomp/` — the compiler source; `tools/bin/` — its build output
- `tools/dev.ps1` — build, install, restart the game, wait for the new build id
- `tools/gamelog.py` — reads the game console log; `tools/vpkread.py`, `tools/blocks.py` — format inspection
- `docs/TESTING.md` — the testing workflow and what the fake game models

## Setup
```bash
git clone https://github.com/ValveResourceFormat/ValveResourceFormat _ext/vrf
dotnet build tools/pancomp -c Release -o tools/bin
```
Env: `DEADLOCK_ROOT` (folder holding `game/`) if Deadlock is not in the default Steam folder.

## Run / Build / Test
```bash
npm test                                  # all offline tests, no game needed
node --test tests/exit_paths.test.js      # one file
python build.py                           # dist/pak42_dir.vpk
python build.py --install                 # also copy into game/citadel/addons
python build.py --pak 43                  # another pak number if 42 is taken
powershell -ExecutionPolicy Bypass -File tools\dev.ps1 -Restart   # full in-game loop on the PC
python tools/gamelog.py --check           # mod log lines + errors; exit 1 on errors or leftovers
```

## Conventions
- `npm test` after every change, before anyone launches the game. Fix the fake first when it
  turns out to be wrong, then the mod.
- The script logs `loaded build <id>` on load and `exit check: clean` (or `LEFTOVER ...`) on
  every exit from Easy mode; keep both.
- Commit straight to `main` once tests pass. Rebuild `dist/pak42_dir.vpk` only after an in-game check.

## Architecture
The build editor is native C++ (`CitadelShopModsBuild`, `CitadelHudHeroBuilds`). The mod can
only rearrange panels and fire the game's events (`CitadelHudHeroBuilds*`,
`CitadelSelectShopTab`). Entering Easy mode selects the All Items tab (the game only fills
shop cards for the selected tab); leaving it restores the vanilla layout and must leave no
residue (`game.residue()` in tests checks this).

## Gotchas
- Mods load at game startup only: every in-game test is a full restart.
- camelCase inline styles (`marginTop`) cannot be unset; clear the base CSS name (`margin`). See `BASE_STYLE`.
- Clearing `visibility` leaves a panel hidden: set it back to `visible`, or hide with opacity.
- `DeleteAsync` deletes on a later frame; calling into a deleted panel throws.
- `ui-scale` scales a panel's own px width too.
- No cursor position API: the right-click spot comes from a grid of 32px hit cells (`EasyHitGrid`).
- JS cannot read an item's id from a `CitadelShopMod` panel.
- Right-click add and search add rely on the game accepting a replayed click; unverified in a
  match (shop items are disabled in the hideout). Dragging always works.
- Only tested at 1920x1080.

## Known issues / TODO
- `dist/pak42_dir.vpk` predates the 2026-10-20 exit-path fixes in `src/`; rebuild after an in-game check.
