#!/usr/bin/env python3
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PBW = ROOT / 'build' / 'pebble-activity-tracker.pbw'
OUT_DIR = ROOT / 'screenshots' / 'emulator'
SIM_PATH = ROOT / 'tools' / 'pypkjs_gps_sim'

PLATFORMS = ['emery', 'basalt', 'chalk', 'diorite']
SCREENS = ['choose', 'gps-search', 'gps-ready', 'countdown', 'activity', 'paused']
ALL_SCREEN_SEQUENCE = ['choose', 'gps-search', 'gps-ready', 'countdown',
                       'activity', 'paused']
ACTIVITY_DOWN_CLICKS = {
    'running': 0,
    'cycling': 1,
    'walking': 2,
}


def build_parser():
    parser = argparse.ArgumentParser(
        description=(
            'Build/install the app in a Pebble emulator, drive it to one or '
            'more useful screens, and capture real emulator screenshots.'
        )
    )
    parser.add_argument('--platform', default='emery', choices=PLATFORMS,
                        help='Pebble emulator platform to capture. Default: emery.')
    parser.add_argument('--screen', default='choose', choices=SCREENS,
                        help='Screen to drive to before capture. Default: choose.')
    parser.add_argument('--all-screens', action='store_true',
                        help='Capture the main app flow in one emulator run.')
    parser.add_argument('--activity', default='running',
                        choices=['running', 'walking', 'cycling'],
                        help='Activity selected before capture. Default: running.')
    parser.add_argument('--output',
                        help='Output PNG path for single-screen capture.')
    parser.add_argument('--output-dir',
                        help='Output directory. Default: screenshots/emulator.')
    parser.add_argument('--lock-delay-s', type=float, default=None,
                        help='Seconds before simulated GPS lock after GPS request.')
    parser.add_argument('--settle-s', type=float, default=2.0,
                        help='Seconds to wait after install before button presses.')
    parser.add_argument('--skip-build', action='store_true',
                        help='Install the existing PBW instead of running pebble build first.')
    parser.add_argument('--reuse-emulator', action='store_true',
                        help='Do not kill existing emulators before install.')
    parser.add_argument('--vnc', action='store_true',
                        help='Pass --vnc to emulator commands for headless environments.')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print commands without executing them.')
    return parser


def default_lock_delay(screen, all_screens):
    if all_screens:
        return 3.0
    if screen == 'gps-search':
        return 30.0
    return 0.5


def output_dir(args):
    if args.output_dir:
        return Path(args.output_dir).expanduser()
    return OUT_DIR


def output_path(args):
    if args.output:
        return Path(args.output).expanduser()
    return output_dir(args) / '{}-{}.png'.format(args.platform, args.screen)


def all_output_path(args, screen, index):
    return output_dir(args) / '{}-{}-{:02d}-{}.png'.format(
        args.platform,
        args.activity,
        index,
        screen
    )


def command_env(args):
    lock_delay = args.lock_delay_s
    if lock_delay is None:
        lock_delay = default_lock_delay(args.screen, args.all_screens)

    env = os.environ.copy()
    existing_pythonpath = env.get('PYTHONPATH', '')
    env['PYTHONPATH'] = str(SIM_PATH) + (os.pathsep + existing_pythonpath if existing_pythonpath else '')
    env['PEBBLE_TRACKER_SIM_GPS'] = '1'
    env['PEBBLE_TRACKER_SIM_DELAY_S'] = str(lock_delay)
    env['PEBBLE_TRACKER_SIM_INTERVAL_S'] = '1.0'
    env['PEBBLE_TRACKER_SIM_LOOP_DISTANCE_M'] = '1000'
    env['PEBBLE_TRACKER_SIM_SPEED_MPS'] = '3.0'
    env['PEBBLE_TRACKER_SIM_JITTER_M'] = '4.0'
    env['PEBBLE_TRACKER_SIM_ACCURACY_M'] = '10.0'
    env['PEBBLE_TRACKER_SIM_CENTER_LAT'] = '51.5074'
    env['PEBBLE_TRACKER_SIM_CENTER_LON'] = '-0.1278'
    env['PEBBLE_TRACKER_SIM_ALTITUDE_M'] = '25.0'
    env['PEBBLE_TRACKER_SIM_SEED'] = '4242'
    return env, lock_delay


def with_vnc(command, args):
    if args.vnc and command[0] == 'pebble' and command[1] in (
            'install', 'screenshot', 'emu-button'):
        return command[:2] + ['--vnc'] + command[2:]
    return command


def run(command, *, env=None, check=True, dry_run=False, args=None):
    if args is not None:
        command = with_vnc(command, args)
    print('+ ' + ' '.join(str(part) for part in command), flush=True)
    if dry_run:
        return 0
    completed = subprocess.run(command, cwd=str(ROOT), env=env)
    if check and completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, command)
    return completed.returncode


def click(args, button, env):
    run(['pebble', 'emu-button', '--emulator', args.platform, 'click', button],
        env=env, dry_run=args.dry_run, args=args)


def press_activity_buttons(args, env):
    for _ in range(ACTIVITY_DOWN_CLICKS[args.activity]):
        click(args, 'down', env)
        if not args.dry_run:
            time.sleep(0.35)


def wait(seconds, dry_run):
    if dry_run:
        print('+ sleep {:.1f}'.format(seconds), flush=True)
        return
    time.sleep(max(0.0, seconds))


def drive_to_screen(args, env, lock_delay):
    wait(args.settle_s, args.dry_run)
    press_activity_buttons(args, env)

    if args.screen == 'choose':
        return

    click(args, 'select', env)

    if args.screen == 'gps-search':
        wait(1.0, args.dry_run)
        return

    wait(lock_delay + 2.0, args.dry_run)

    if args.screen == 'gps-ready':
        return

    click(args, 'select', env)

    if args.screen == 'countdown':
        wait(0.2, args.dry_run)
        return

    wait(4.0, args.dry_run)

    if args.screen == 'paused':
        click(args, 'select', env)
        wait(0.5, args.dry_run)


def capture(args, base_env, output):
    if not args.dry_run:
        output.parent.mkdir(parents=True, exist_ok=True)

    run(['pebble', 'screenshot', '--emulator', args.platform, '--no-open',
         str(output)],
        env=base_env, dry_run=args.dry_run, args=args)
    print('Saved emulator screenshot to {}'.format(output))


def capture_all_screens(args, sim_env, base_env, lock_delay):
    captured = []

    wait(args.settle_s, args.dry_run)
    press_activity_buttons(args, sim_env)

    captured.append(all_output_path(args, 'choose', 1))
    capture(args, base_env, captured[-1])

    click(args, 'select', sim_env)
    wait(0.8, args.dry_run)

    captured.append(all_output_path(args, 'gps-search', 2))
    capture(args, base_env, captured[-1])

    wait(lock_delay + 2.0, args.dry_run)

    captured.append(all_output_path(args, 'gps-ready', 3))
    capture(args, base_env, captured[-1])

    click(args, 'select', sim_env)
    wait(0.2, args.dry_run)

    captured.append(all_output_path(args, 'countdown', 4))
    capture(args, base_env, captured[-1])

    wait(4.0, args.dry_run)

    captured.append(all_output_path(args, 'activity', 5))
    capture(args, base_env, captured[-1])

    click(args, 'select', sim_env)
    wait(0.5, args.dry_run)

    captured.append(all_output_path(args, 'paused', 6))
    capture(args, base_env, captured[-1])

    print('Captured {} emulator screenshots.'.format(len(captured)))


def main(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.all_screens and args.output:
        parser.error('--output only applies to single-screen capture; use --output-dir with --all-screens.')

    sim_env, lock_delay = command_env(args)
    base_env = os.environ.copy()
    output = output_path(args)

    print('Emulator screenshot harness')
    print('  platform:          {}'.format(args.platform))
    print('  primary target:    emery')
    print('  mode:              {}'.format('all screens' if args.all_screens else 'single screen'))
    print('  screen:            {}'.format(' -> '.join(ALL_SCREEN_SEQUENCE) if args.all_screens else args.screen))
    print('  activity:          {}'.format(args.activity))
    print('  GPS lock delay:    {:.1f}s'.format(lock_delay))
    if args.all_screens:
        print('  output dir:        {}'.format(output_dir(args)))
    else:
        print('  output:            {}'.format(output))

    if args.dry_run:
        print('  dry run:           yes')

    if not args.reuse_emulator:
        run(['pebble', 'kill', '--force'], env=base_env, check=False,
            dry_run=args.dry_run)

    if not args.skip_build:
        run(['pebble', 'build'], env=base_env, dry_run=args.dry_run)

    if not PBW.exists() and not args.dry_run:
        raise SystemExit('PBW not found: {}'.format(PBW))

    run(['pebble', 'install', '--emulator', args.platform, str(PBW)],
        env=sim_env, dry_run=args.dry_run, args=args)

    if args.all_screens:
        capture_all_screens(args, sim_env, base_env, lock_delay)
    else:
        drive_to_screen(args, sim_env, lock_delay)
        capture(args, base_env, output)

    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
