r"""Read the mod's lines out of Deadlock's console log.

The game writes game/citadel/console.log when launched with -condebug. This
prints only what matters for the mod: its own [EasyBuildEditor] lines plus
anything that looks like a script or layout error, so a Claude session can
check a test run without anyone reading the console by hand.

    python tools/gamelog.py                  # mod lines + errors from the last game start
    python tools/gamelog.py --all            # every line from the last game start
    python tools/gamelog.py --follow         # keep printing new lines (Ctrl+C to stop)
    python tools/gamelog.py --check          # exit 1 if an error or exit-check LEFTOVER was logged
    python tools/gamelog.py --wait-build ID  # wait until the game loads build ID (see build.py)

Set DEADLOCK_ROOT if the game is not in the default Steam folder, or pass
--log with the path to console.log.
"""
import argparse
import os
import re
import sys
import time
from pathlib import Path

DEFAULT_ROOT = r"C:\Program Files (x86)\Steam\steamapps\common\Deadlock"

MOD = re.compile(r"\[EasyBuildEditor\]")
PROBLEM = re.compile(
    r"easy_build_editor|citadel_shop_mods_build|Uncaught|SyntaxError|TypeError|ReferenceError|RangeError"
    r"|Unable to load layout|Failed to load|panorama.*(error|fail)",
    re.IGNORECASE,
)
BAD = re.compile(r"\[EasyBuildEditor\] (ERROR|exit check: LEFTOVER)|Uncaught|SyntaxError|TypeError|ReferenceError"
                 r"|Unable to load layout", re.IGNORECASE)
LOADED = re.compile(r"\[EasyBuildEditor\] loaded build (\S+)")


def log_path(args):
    if args.log:
        return Path(args.log)
    root = Path(os.environ.get("DEADLOCK_ROOT", DEFAULT_ROOT))
    return root / "game" / "citadel" / "console.log"


def read_lines(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read().splitlines()


# console.log keeps growing across runs; a game start is where the engine
# prints its command line. Falls back to the whole file.
START = re.compile(r"^(Command line|CommandLine|Steam AppId|Using breakpad)", re.IGNORECASE)


def last_run(lines):
    starts = [i for i, line in enumerate(lines) if START.search(line)]
    return lines[starts[-1]:] if starts else lines


def wanted(line, show_all):
    return show_all or MOD.search(line) or PROBLEM.search(line)


def follow(path, show_all):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        f.seek(0, os.SEEK_END)
        while True:
            line = f.readline()
            if not line:
                time.sleep(0.3)
                continue
            if wanted(line, show_all):
                print(line.rstrip("\n"), flush=True)


def wait_build(path, build, timeout):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if path.exists():
            for line in reversed(read_lines(path)):
                m = LOADED.search(line)
                if m:
                    if m.group(1) == build:
                        print(f"game loaded build {build}")
                        return 0
                    break
        time.sleep(2)
    print(f"build {build} not seen in {path} after {timeout}s", file=sys.stderr)
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--log", help="path to console.log")
    parser.add_argument("--all", action="store_true", help="print every line, not just the mod's")
    parser.add_argument("--whole-file", action="store_true", help="read the whole file, not just the last game start")
    parser.add_argument("--follow", action="store_true", help="keep printing new lines")
    parser.add_argument("--check", action="store_true", help="exit 1 if errors or leftovers were logged")
    parser.add_argument("--wait-build", metavar="ID", help="wait until the game logs this build id")
    parser.add_argument("--timeout", type=int, default=300)
    args = parser.parse_args()

    path = log_path(args)
    if args.wait_build:
        return wait_build(path, args.wait_build, args.timeout)
    if not path.exists():
        print(f"{path} not found: launch the game with -condebug", file=sys.stderr)
        return 2
    if args.follow:
        try:
            follow(path, args.all)
        except KeyboardInterrupt:
            pass
        return 0

    lines = read_lines(path)
    if not args.whole_file:
        lines = last_run(lines)
    shown = [line for line in lines if wanted(line, args.all)]
    print("\n".join(shown))
    if args.check:
        bad = [line for line in lines if BAD.search(line)]
        if bad:
            print(f"\n{len(bad)} problem line(s):", file=sys.stderr)
            print("\n".join(bad), file=sys.stderr)
            return 1
        print("\nno errors or leftovers logged", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
