# Deadlock Easy Build Editor

A client-side UI mod for Deadlock that adds an **Easy Editor** button to the hero build editor
(next to the info icon, in edit mode). It turns the editor into one screen:

- **Split view**: the item shop on the left, your build on the right, so adding items no longer
  means flipping between the shop tabs and the build tab.
- **"Adding to" banner**: shows which section is selected and how many items it holds.
- **Shop shortcuts**: Weapon / Spirit / Vitality / All tabs in the toolbar.
- **Quick-add sections**: Early, Mid, Late, Situational, Blank, or a 4-section starter set.
- **Tidy layout**: full-width sections, drag and resize handles hidden, compact all.
- **Save / Cancel** pinned at the bottom of the build.

All edits still go through the game's own build commands, so saving, sharing and publishing
behave exactly as they do without the mod. It only changes UI files; no gameplay, no memory
editing, no injected code.

## Install

1. Build it (below) or take `dist/pak42_dir.vpk`.
2. Copy it into `Steam\steamapps\common\Deadlock\game\citadel\addons\`.
   If `pak42_dir.vpk` is taken, rebuild with another number: `python build.py --pak 43`.
3. Your `gameinfo.gi` must have `Game citadel/addons` in `SearchPaths` (any mod manager sets this).
4. Restart Deadlock. Open a build, press Edit, then **Easy Editor**.

Uninstall by deleting the VPK.

## Build

Requirements: Windows, Python 3.10+, .NET 10 SDK, a Deadlock install.

```bash
git clone https://github.com/ValveResourceFormat/ValveResourceFormat _ext/vrf
dotnet build tools/pancomp -c Release -o tools/bin
python build.py
```

`tools/pancomp` is a small compiler built on ValveResourceFormat. It compiles Panorama
`xml`, `css` and `js` sources into the `vxml_c`, `vcss_c` and `vts_c` resources Deadlock loads,
using the game's own compiled files as templates, and packs them into a VPK.

## Layout

| Path | What |
|---|---|
| `src/panorama/layout/citadel_shop_mods_build.xml` | The game's build panel layout plus the button, toolbar and footer |
| `src/panorama/styles/easy_build_editor.css` | Styles for the new UI |
| `src/panorama/scripts/easy_build_editor.js` | Split view, selection banner, quick-add, tidy |
| `tools/pancomp` | Panorama compiler + VPK packer |
| `tools/vpkread.py` | Minimal VPK reader/extractor |
| `build.py` | Compile and pack |

## Updating after a game patch

The mod replaces `citadel_shop_mods_build` with a copy of Valve's version. If a patch changes
that file, decompile the new one, carry the Easy Editor additions over, and rebuild:

```bash
python tools/vpkread.py "<Deadlock>/game/citadel/pak01_dir.vpk" x _ref "citadel_shop_mods_build"
tools/s2v/Source2Viewer-CLI.exe -i _ref/panorama/layout/citadel_shop_mods_build.vxml_c -o _ref/new.xml -d
```

## Troubleshooting

The script logs to the game console with the prefix `[EasyBuildEditor]` (also in
`game/citadel/console.log`). The first press of the button prints the panel tree it found.
