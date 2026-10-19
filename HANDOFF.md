# Handoff

## State (2026-10-19)

Runs in-game (tested 1920x1080). Easy mode layout: shop (scaled to fit) | build on top, the
game's Edit Build panel as a 250px strip along the bottom, the shop's side tab strip hidden
(toolbar chips switch tabs). Sections have a MOVE grip and stay where dropped (free placement,
`x`/`y` inline styles, session only: builds store order and width, not positions).
Turning Easy mode off restores the vanilla layout exactly (verified).

Right-click: shop item = add to selected section, build item = remove. Wired, but unverified:
in the hideout shop items are disabled (no shop nearby) and neither left-click nor the
replayed `Activated` event adds anything there. Needs a test inside a match.

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

- After a restart the shop half is blank until a shop tab (Weapon/Spirit/Vitality) is picked.
  Should auto-select Weapon on entering Easy mode.
- Quick-add sections (Early/Mid/Late/...) and renaming via `CategoryNameTextEntry` untested.
- Drag-drop after the z-index change confirmed only by a synthetic drag that did not land;
  needs a real mouse test.
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
