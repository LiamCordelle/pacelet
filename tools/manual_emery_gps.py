#!/usr/bin/env python3
import argparse
import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PBW = ROOT / 'build' / 'pebble-activity-tracker.pbw'
SIM_PATH = ROOT / 'tools' / 'pypkjs_gps_sim'
EMULATOR = 'emery'

ACTIVITY_DOWN_CLICKS = {
    'running': 0,
    'cycling': 1,
    'walking': 2,
}


def build_parser():
    parser = argparse.ArgumentParser(
        description=(
            'Run Pacelet in the emery emulator with simulated '
            'phone GPS. The simulator starts returning GPS fixes after the '
            'configured delay, then moves around a slightly jittered 1 km loop.'
        )
    )
    parser.add_argument('--activity', default='running',
                        choices=['running', 'walking', 'cycling'],
                        help='Activity selected with emulator button clicks before GPS request.')
    parser.add_argument('--lock-delay-s', type=float, default=30.0,
                        help='Seconds to wait after GPS is requested before fixes appear.')
    parser.add_argument('--interval-s', type=float, default=5.0,
                        help='Seconds between simulated GPS fixes.')
    parser.add_argument('--loop-distance-m', type=float, default=1000.0,
                        help='Distance around one loop. Default: 1000m.')
    parser.add_argument('--speed-mps', type=float, default=1.35,
                        help='Nominal walking/running speed for the loop.')
    parser.add_argument('--jitter-m', type=float, default=6.0,
                        help='Maximum route jitter in metres.')
    parser.add_argument('--accuracy-m', type=float, default=10.0,
                        help='Reported GPS accuracy in metres, before tiny random variation.')
    parser.add_argument('--center-lat', type=float, default=51.5074,
                        help='Route centre latitude. Default: central London.')
    parser.add_argument('--center-lon', type=float, default=-0.1278,
                        help='Route centre longitude. Default: central London.')
    parser.add_argument('--altitude-m', type=float, default=25.0,
                        help='Reported altitude in metres.')
    parser.add_argument('--seed', type=int, default=1337,
                        help='Seed for deterministic route jitter.')
    parser.add_argument('--select-delay-s', type=float, default=2.0,
                        help='Seconds to wait after install before automated button presses.')
    parser.add_argument('--auto-start-activity', action='store_true',
                        help='Click SELECT again after GPS lock to start the 3,2,1 countdown.')
    parser.add_argument('--no-auto-request-gps', action='store_true',
                        help='Do not press SELECT after install; you can drive the watch manually.')
    parser.add_argument('--reuse-emulator', action='store_true',
                        help='Do not kill existing emulators before install. Existing pypkjs may miss the GPS shim.')
    parser.add_argument('--skip-build', action='store_true',
                        help='Install the existing PBW instead of running pebble build first.')
    parser.add_argument('--no-logs', action='store_true',
                        help='Exit after setup instead of streaming pebble logs.')
    parser.add_argument('--dry-run', action='store_true',
                        help='Print commands and simulator environment without executing them.')
    return parser


def command_env(args):
    env = os.environ.copy()
    existing_pythonpath = env.get('PYTHONPATH', '')
    env['PYTHONPATH'] = str(SIM_PATH) + (os.pathsep + existing_pythonpath if existing_pythonpath else '')
    env['PEBBLE_TRACKER_SIM_GPS'] = '1'
    env['PEBBLE_TRACKER_SIM_DELAY_S'] = str(args.lock_delay_s)
    env['PEBBLE_TRACKER_SIM_INTERVAL_S'] = str(args.interval_s)
    env['PEBBLE_TRACKER_SIM_LOOP_DISTANCE_M'] = str(args.loop_distance_m)
    env['PEBBLE_TRACKER_SIM_SPEED_MPS'] = str(args.speed_mps)
    env['PEBBLE_TRACKER_SIM_JITTER_M'] = str(args.jitter_m)
    env['PEBBLE_TRACKER_SIM_ACCURACY_M'] = str(args.accuracy_m)
    env['PEBBLE_TRACKER_SIM_CENTER_LAT'] = str(args.center_lat)
    env['PEBBLE_TRACKER_SIM_CENTER_LON'] = str(args.center_lon)
    env['PEBBLE_TRACKER_SIM_ALTITUDE_M'] = str(args.altitude_m)
    env['PEBBLE_TRACKER_SIM_SEED'] = str(args.seed)
    return env


def run(command, *, env=None, check=True, dry_run=False):
    print('+ ' + ' '.join(str(part) for part in command), flush=True)
    if dry_run:
        return 0
    completed = subprocess.run(command, cwd=str(ROOT), env=env)
    if check and completed.returncode != 0:
        raise subprocess.CalledProcessError(completed.returncode, command)
    return completed.returncode


def click(button, *, env, dry_run):
    run(['pebble', 'emu-button', '--emulator', EMULATOR, 'click', button],
        env=env, dry_run=dry_run)


def press_activity_buttons(args, env):
    for _ in range(ACTIVITY_DOWN_CLICKS[args.activity]):
        click('down', env=env, dry_run=args.dry_run)
        if not args.dry_run:
            time.sleep(0.4)


def main(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    sim_env = command_env(args)
    base_env = os.environ.copy()

    print('Manual GPS harness')
    print('  platform:          {}'.format(EMULATOR))
    print('  activity:          {}'.format(args.activity))
    print('  GPS lock delay:    {:.1f}s after GPS request'.format(args.lock_delay_s))
    print('  loop distance:     {:.0f}m'.format(args.loop_distance_m))
    print('  update interval:   {:.1f}s'.format(args.interval_s))
    print('  pypkjs shim path:  {}'.format(SIM_PATH))

    if args.dry_run:
        print('  dry run:           yes')

    if not args.reuse_emulator:
        run(['pebble', 'kill', '--force'], env=base_env, check=False, dry_run=args.dry_run)

    if not args.skip_build:
        run(['pebble', 'build'], env=base_env, dry_run=args.dry_run)

    if not PBW.exists() and not args.dry_run:
        raise SystemExit('PBW not found: {}'.format(PBW))

    run(['pebble', 'install', '--emulator', EMULATOR, str(PBW)],
        env=sim_env, dry_run=args.dry_run)

    if not args.no_auto_request_gps:
        if not args.dry_run:
            time.sleep(max(0.0, args.select_delay_s))
        press_activity_buttons(args, sim_env)
        click('select', env=sim_env, dry_run=args.dry_run)
        print('Requested GPS from the watch. Simulated fixes begin after {:.1f}s.'.format(
            args.lock_delay_s
        ))

    if args.auto_start_activity:
        wait_s = args.lock_delay_s + 2.0
        print('Waiting {:.1f}s, then pressing SELECT to start countdown.'.format(wait_s))
        if not args.dry_run:
            time.sleep(wait_s)
        click('select', env=sim_env, dry_run=args.dry_run)

    if args.no_logs:
        print('Setup complete. Emulator continues running until `pebble kill --force`.')
        return 0

    print('Streaming logs. Press Ctrl+C to stop logs; the emulator will keep running.')
    try:
        run(['pebble', 'logs', '--emulator', EMULATOR],
            env=base_env, dry_run=args.dry_run)
    except KeyboardInterrupt:
        print()
        print('Stopped logs. Emulator continues running until `pebble kill --force`.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
