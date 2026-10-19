# Handoff

## State (2026-10-19)

Runs in-game (tested 1920x1080). Easy mode layout: shop (scaled to fit) | build on top, the
game's Edit Build panel as a 250px strip along the bottom, the shop's side tab strip hidden
(toolbar chips switch tabs). Sections have a MOVE grip and stay where dropped (free placement,
`x`/`y` inline styles, session only: builds store order and width, not positions).
Turning Easy mode off restores the vanilla layout exactly (verified).

Entering Easy mode selects the All Items shop tab (`EasyTabAllItems` trigger button). The
game only fills in shop cards (art, tier, colours) for the selected tab; without this the
shop showed empty cards in the Weapon layout. Verified: `cards 156/156 filled` in the log.
Leaving Easy mode re-selects the Build tab. The shop scrolls (`overflow: clip scroll`),
All Items content is ~1875px tall.

Right-click on empty space in the build area opens a menu: Create category (new section
spawns where you clicked) and Add item (search box; filters/dims the shop, Enter or a result
tries to add it to the focused section, otherwise tells you to drag it). There is no cursor
position API, so the empty space is covered by a grid of 32px hit cells (`EasyHitGrid`,
first child of `CategoryContainer`) and the clicked cell gives the position. User checked
it in game and it looked right; adding via search shares the unverified click-to-add path.

Right-click: shop item = add to selected section, build item = remove. Wired, but unverified:
in the hideout shop items are disabled (no shop nearby) and neither left-click nor the
replayed `Activated` event adds anything there. Needs a test inside a match.

Section positions are kept per panel first (`panelPositions`), name key second, so renaming
a section no longer drops it to the bottom. The add-item probe waits 0.35s per method
(`PROBE_SETTLE`) so a slow add is not repeated by the next method. A menu spawn point expires
after 5s if the new section never shows up. These three fixes are built and installed but not
yet checked in game.

Repo: https://github.com/luccahp1/deadlock-build-editor (public, MIT).

Testing loop: build, copy `dist/pak42_dir.vpk` into `game/citadel/addons`, restart the game
(mods load at startup only). Launch with `steam.exe -applaunch 1422450 -condebug -dev` so
`game/citadel/console.log` is written live; the script logs `[EasyBuildEditor] layout: ...`
with measured sizes when Easy mode turns on.

## What is known

- The build editor is native C++ (`CitadelShopModsBuild`, `CitadelShopModsBuildCategory`,
  `CitadelHudHeroBuilds`). Panorama JS can only rearrange panels and fire the game's events.
- Native build events found in `client.dll` (args unknown unless used in a layout):
  `CitadelHudHeroBuilds{AddNewCategory, CompactCategory(int, -1 = all), DeleteCategory,
  FocusCategory, FocusMod, MoveCategory, ToggleMod, ToggleCategoryOptional, SaveEdits,
  DiscardEdits, CreateNewBuild, EditSelectedBuild, SetModTag, QuickbuyQueueCategory, ...}`,
  `CitadelSelectShopTab(EShopTab_Weapon|Spirit|Vitality|AllItems|Build|Recommended)`.
- Shop tabs are siblings in `#ShopModListsContainer`: `ShopModsSelectedBuild` (our panel),
  `ShopModsFiltered`, `ShopModsRecommended`; the hidden ones are hidden by opacity classes
  (`.showingWeapon` etc.), which is why inline styles can show two at once.
- Edit mode is the `gEditingBuilds` class on an ancestor.
- Compiled formats: vts_c DATA = plain JS. vcss_c DATA = crc32 + u16 image count + CSS text.
  vxml_c = DATA (crc + images) + LaCo (binary KV3 AST, see `pancomp`).

## Known issues / unverified

- On leaving Easy mode the game wrote `cached_hero_builds.kv3` twice 5ms apart; the first
  write errored (busy), the second succeeded. Not yet known if vanilla Save does the same.
- Quick-add sections and dragging items from the shop onto a section work with a real mouse
  (seen in the user's screenshots: named sections holding items).
- `ui-scale` scales a panel's own px width too: give widths in the panel's scaled units.
- Inline style names in JS are aliases: `marginTop` etc. cannot be unset. Clear the base
  property instead (`margin`, `padding`, `align`, `position`), see `BASE_STYLE`. Clearing
  `visibility` leaves a panel hidden, so restore it to `visible` or hide with opacity.
- Items are `CitadelShopMod` panels; JS cannot read their item id.
  `CitadelHudHeroBuildsToggleMod` takes two numbers (meaning unknown).
- Only tested at 1920x1080; layout reads the root width so other 16:9 sizes should follow.

## Next ideas (V1.1)

- Per-section up/down/delete in the toolbar once `MoveCategory`/`DeleteCategory` args are known.
- Item count and soul cost per section in each header.
- Remember Easy mode across sessions.
