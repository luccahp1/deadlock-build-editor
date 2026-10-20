r"""Build the Easy Build Editor mod into dist/pak<NN>_dir.vpk.

Compiles everything under src/panorama with tools/bin/pancomp.exe, using the
game's own compiled files as templates, then packs the result into a VPK.

    python build.py            # build dist/pak42_dir.vpk
    python build.py --pak 17   # pick another pak number
    python build.py --install  # also copy it into the game's addons folder

The game is looked for in the default Steam folder; set DEADLOCK_ROOT to the
folder that holds game/ (e.g. D:\SteamLibrary\steamapps\common\Deadlock)
if it lives elsewhere.

The script gets a build id (git commit + time) that it logs on load as
"[EasyBuildEditor] loaded build <id>", so the console log shows which build
the game is running. See docs/TESTING.md.
"""
import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src" / "panorama"
STAGE = ROOT / "build" / "stage"
DIST = ROOT / "dist"
PANCOMP = ROOT / "tools" / "bin" / "pancomp.exe"
VPKREAD = ROOT / "tools" / "vpkread.py"
DEADLOCK_ROOT = Path(os.environ.get("DEADLOCK_ROOT", r"C:\Program Files (x86)\Steam\steamapps\common\Deadlock"))
GAME_VPK = DEADLOCK_ROOT / "game" / "citadel" / "pak01_dir.vpk"
ADDONS = DEADLOCK_ROOT / "game" / "citadel" / "addons"
TEMPLATES = ROOT / "build" / "templates"
STAMPED = ROOT / "build" / "stamped"
BUILD_ID_LINE = 'const BUILD_ID = "dev";'

# Game files used as templates: (kind, path inside the game VPK)
TEMPLATE_FOR = {
    "layout": "panorama/layout/citadel_shop_mods_build.vxml_c",
    "style": "panorama/styles/citadel_shop_mods_build.vcss_c",
    "script": "panorama/scripts/async.vts_c",
}

KIND_BY_SUFFIX = {".xml": ("layout", ".vxml_c"), ".css": ("style", ".vcss_c"), ".js": ("script", ".vts_c")}


def run(*args):
    result = subprocess.run([str(a) for a in args], capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"failed: {' '.join(map(str, args))}\n{result.stdout}{result.stderr}")
    return result.stdout


def extract_templates():
    TEMPLATES.mkdir(parents=True, exist_ok=True)
    pattern = "^(" + "|".join(p.replace(".", r"\.") for p in TEMPLATE_FOR.values()) + ")$"
    run(sys.executable, "-I", VPKREAD, GAME_VPK, "x", TEMPLATES, pattern)
    return {kind: TEMPLATES / path for kind, path in TEMPLATE_FOR.items()}


def build_id():
    try:
        commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT,
                                capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain", "--", "src"], cwd=ROOT,
                               capture_output=True, text=True).stdout.strip()
    except OSError:
        commit, dirty = "", ""
    return f"{commit or 'nogit'}{'+' if dirty else ''}@{time.strftime('%Y%m%d-%H%M%S')}"


# Scripts get their build id written in before compiling.
def stamped(source, stamp):
    text = source.read_text(encoding="utf-8")
    if BUILD_ID_LINE not in text:
        return source
    out = STAMPED / source.name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text.replace(BUILD_ID_LINE, f'const BUILD_ID = "{stamp}";'), encoding="utf-8")
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pak", type=int, default=42)
    parser.add_argument("--install", action="store_true", help="copy the VPK into the game's addons folder")
    args = parser.parse_args()

    if not PANCOMP.exists():
        sys.exit("tools/bin/pancomp.exe missing, run: dotnet build tools/pancomp -c Release -o tools/bin")

    if not GAME_VPK.exists():
        sys.exit(f"game not found at {GAME_VPK}, set DEADLOCK_ROOT")

    templates = extract_templates()
    shutil.rmtree(STAGE, ignore_errors=True)
    stamp = build_id()

    for source in sorted(SRC.rglob("*")):
        if not source.is_file() or source.suffix not in KIND_BY_SUFFIX:
            continue
        kind, compiled_suffix = KIND_BY_SUFFIX[source.suffix]
        target = STAGE / "panorama" / source.relative_to(SRC).with_suffix(compiled_suffix)
        target.parent.mkdir(parents=True, exist_ok=True)
        run(PANCOMP, kind, templates[kind], stamped(source, stamp) if kind == "script" else source, target)
        print(f"compiled {source.relative_to(ROOT)} -> {target.relative_to(STAGE)}")

    DIST.mkdir(exist_ok=True)
    out = DIST / f"pak{args.pak:02d}_dir.vpk"
    out.unlink(missing_ok=True)
    run(PANCOMP, "vpk", STAGE, out)
    print(f"built {out.relative_to(ROOT)} ({out.stat().st_size} bytes), build id {stamp}")

    if args.install:
        if not ADDONS.is_dir():
            sys.exit(f"no addons folder at {ADDONS}")
        try:
            shutil.copy2(out, ADDONS / out.name)
        except PermissionError:
            sys.exit("could not replace the installed VPK: close Deadlock first (mods load at startup only)")
        print(f"installed {ADDONS / out.name}")


if __name__ == "__main__":
    main()
