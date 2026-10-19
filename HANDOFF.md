# Handoff

## State (2026-10-19)

V1 runs in-game (tested on 1920x1080). Verified: mod loads, Easy Editor button sits left of
the info icon in edit mode, Easy mode lays out edit sidebar (80%) | full shop (all four tiers,
~74% scale) | build (85%) across the whole screen, "Adding to" banner tracks the focused
section, toolbar shop tabs work, header buttons decluttered. Items are added the vanilla way,
by dragging from the shop onto a section (one drag confirmed landing; z-order fix applied after).

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
- Only tested at 1920x1080; layout reads the root width so other 16:9 sizes should follow.

## Next ideas (V1.1)

- Per-section up/down/delete in the toolbar once `MoveCategory`/`DeleteCategory` args are known.
- Item count and soul cost per section in each header.
- Remember Easy mode across sessions.
