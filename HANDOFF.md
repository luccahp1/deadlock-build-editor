# Handoff

## State (2026-10-19)

V1 is built (`dist/pak42_dir.vpk`) but **not yet tested in-game**. Every compiled file
decompiles cleanly with Source2Viewer and the layout compiler round-trips Valve's own
`citadel_shop_mods_build` to an identical AST, but the engine loading our files is unverified.

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

## Unverified, check first when testing

1. Does the engine load our vxml_c/vcss_c/vts_c? (Button visible in edit mode = yes.)
2. Do inline-style overrides keep the shop and build both visible after tab switches?
3. Does setting `CategoryNameTextEntry.text` from JS rename the new section?
4. Does `$.DispatchEvent("CitadelHudHeroBuildsAddNewCategory", panel)` work from JS?
5. Read `[EasyBuildEditor]` lines in `game/citadel/console.log` for the panel tree dump.

## Next ideas (V1.1)

- Per-section up/down/delete in the toolbar once `MoveCategory`/`DeleteCategory` args are known.
- Item count and soul cost per section in each header.
- Remember Easy mode across sessions.
