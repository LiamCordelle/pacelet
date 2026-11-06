#!/usr/bin/env python3
"""Sample GPS and countdown motion from the isolated Emery preview."""

import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent / "emulator"
PBW = ROOT / "build" / "emulator-preview.pbw"


def run(*args):
    print("+", " ".join(str(arg) for arg in args), flush=True)
    subprocess.run(args, cwd=ROOT, check=True)


def button(name):
    run("pebble", "emu-button", "--emulator", "emery", "click", name)


def shot(name):
    run("pebble", "screenshot", "--emulator", "emery",
        "--no-open", str(OUT / (name + ".png")))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    run("pebble", "build")
    run("pebble", "install", "--emulator", "emery", str(PBW))
    time.sleep(0.4)
    button("down")  # GPS search
    button("select")  # Start the 8 frame orbit
    time.sleep(0.13)
    shot("motion-gps-a")
    time.sleep(0.23)
    shot("motion-gps-b")
    for _ in range(3):
        if ((OUT / "motion-gps-a.png").read_bytes() !=
                (OUT / "motion-gps-b.png").read_bytes()):
            break
        time.sleep(0.25)
        shot("motion-gps-b")
    button("down")  # GPS ready, cancels the orbit
    button("down")  # Countdown
    button("select")  # Run three-second vector countdown
    start = time.monotonic()
    for name, target in [("motion-countdown-a", 0),
                         ("motion-countdown-b", 0),
                         ("motion-countdown-c", 1.4)]:
        time.sleep(max(0, start + target - time.monotonic()))
        shot(name)
        print("countdown capture elapsed:",
              round(time.monotonic() - start, 2), flush=True)


if __name__ == "__main__":
    main()
