"""Build the Easy Build Editor mod into dist/pak<NN>_dir.vpk.

Compiles everything under src/panorama with tools/bin/pancomp.exe, using the
game's own compiled files as templates, then packs the result into a VPK.

    python build.py            # build dist/pak42_dir.vpk
    python build.py --pak 17   # pick another pak number
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src" / "panorama"
STAGE = ROOT / "build" / "stage"
DIST = ROOT / "dist"
PANCOMP = ROOT / "tools" / "bin" / "pancomp.exe"
VPKREAD = ROOT / "tools" / "vpkread.py"
GAME_VPK = Path(r"C:\Program Files (x86)\Steam\steamapps\common\Deadlock\game\citadel\pak01_dir.vpk")
TEMPLATES = ROOT / "build" / "templates"

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pak", type=int, default=42)
    args = parser.parse_args()

    if not PANCOMP.exists():
        sys.exit("tools/bin/pancomp.exe missing, run: dotnet build tools/pancomp -c Release -o tools/bin")

    templates = extract_templates()
    shutil.rmtree(STAGE, ignore_errors=True)

    for source in sorted(SRC.rglob("*")):
        if not source.is_file() or source.suffix not in KIND_BY_SUFFIX:
            continue
        kind, compiled_suffix = KIND_BY_SUFFIX[source.suffix]
        target = STAGE / "panorama" / source.relative_to(SRC).with_suffix(compiled_suffix)
        target.parent.mkdir(parents=True, exist_ok=True)
        run(PANCOMP, kind, templates[kind], source, target)
        print(f"compiled {source.relative_to(ROOT)} -> {target.relative_to(STAGE)}")

    DIST.mkdir(exist_ok=True)
    out = DIST / f"pak{args.pak:02d}_dir.vpk"
    out.unlink(missing_ok=True)
    run(PANCOMP, "vpk", STAGE, out)
    print(f"built {out.relative_to(ROOT)} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
