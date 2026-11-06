#!/usr/bin/env python3
"""Capture the isolated Route Ribbon preview from the real Emery emulator.

This script never builds or installs Pacelet's production watchapp. The
preview has its own fixed UUID and advances sample screens with DOWN.
"""

import argparse
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "emulator"
PBW = ROOT / "build" / "emulator-preview.pbw"
SCREENS = [
    "00-choose",
    "01-gps-search",
    "02-gps-ready",
    "03-countdown",
    "04-walking",
    "05-running",
    "06-cycling",
    "07-split",
    "08-paused",
    "09-recovery",
    "10-finish-confirm",
    "11-discard-confirm",
    "12-saved",
    "13-history-list",
    "14-history-detail",
    "15-dark-running",
    "16-gps-error",
    "17-measuring-hr",
    "18-phone-offline",
    "19-history-empty",
    "20-edge-long-values",
]


def run(*args):
    print("+", " ".join(str(arg) for arg in args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--screen", choices=SCREENS,
                        help="Capture one screen after advancing to it")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    run("pebble", "build")
    run("pebble", "install", "--emulator", "emery", str(PBW))
    time.sleep(0.5)
    for index, screen in enumerate(SCREENS):
        if index:
            run("pebble", "emu-button", "--emulator", "emery",
                "click", "down")
            time.sleep(0.15)
        if args.screen and screen != args.screen:
            continue
        run("pebble", "screenshot", "--emulator", "emery",
            "--no-open", str(OUT / (screen + ".png")))
        print("captured", screen, flush=True)
        if args.screen:
            break


if __name__ == "__main__":
    main()
