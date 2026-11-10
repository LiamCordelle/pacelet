#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PBW = ROOT / 'build' / 'pebble-activity-tracker.pbw'
OUT_DIR = ROOT / 'screenshots' / 'emulator'
SIM_PATH = ROOT / 'tools' / 'pypkjs_gps_sim'

EMULATOR = 'emery'
SCREENS = ['choose', 'gps-search', 'gps-ready', 'countdown', 'activity',
           'split', 'paused', 'end-confirm', 'finished', 'recovery',
           'recovery-discard', 'upload-exit', 'kilometres', 'zones', 'heart-history',
           'history', 'history-detail', 'route']
ALL_SCREEN_SEQUENCE = ['choose', 'gps-search', 'gps-ready', 'countdown',
                       'activity', 'split', 'paused', 'end-confirm',
                       'finished', 'upload-exit', 'kilometres', 'zones', 'heart-history',
                       'history', 'history-detail', 'recovery', 'recovery-discard', 'route']
ACTIVITY_DOWN_CLICKS = {
    'running': 0,
    'cycling': 1,
    'walking': 3,
}


def build_parser():
    parser = argparse.ArgumentParser(
        description=(
            'Build/install the app in a Pebble emulator, drive it to one or '
            'more useful screens, and capture real emulator screenshots.'
        )
    )
    parser.add_argument('--screen', default='choose', choices=SCREENS,
                        help='Screen to drive to before capture. Default: choose.')
    parser.add_argument('--dark-mode', action='store_true',
                        help='Send the ignored legacy DARK_MODE flag for compatibility QA.')
    parser.add_argument('--all-screens', action='store_true',
                        help='Capture the main app flow in one command.')
    parser.add_argument('--isolated', action='store_true',
                        help='Boot a fresh emulator for each capture in all-screens mode.')
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
    parser.add_argument('--capture-retries', type=int, default=2,
                        help='Retries after a failed pebble screenshot capture. Default: 2.')
    parser.add_argument('--post-capture-s', type=float, default=0.5,
                        help='Seconds to settle after each screenshot in all-screens mode.')
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
        return 5.0
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
    return output_dir(args) / '{}_{}.png'.format(EMULATOR, args.screen)


def all_output_path(args, screen, index):
    return output_dir(args) / '{}_{}_{:02d}_{}.png'.format(
        EMULATOR,
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
    command = [
        'pebble', 'emu-button', '--emulator', EMULATOR, 'click', button
    ]
    attempts = 3
    for attempt in range(attempts):
        code = run(command, env=env, check=False,
                   dry_run=args.dry_run, args=args)
        if code == 0:
            return
        if attempt + 1 < attempts:
            print('Button click failed; retrying ({}/{})...'.format(
                attempt + 2, attempts
            ))
            wait(0.75, args.dry_run)
    raise subprocess.CalledProcessError(code, command)


def install_app(args, env):
    command = ['pebble', 'install', '--emulator', EMULATOR, str(PBW)]
    attempts = 3
    code = 0
    for attempt in range(attempts):
        code = run(command, env=env, check=False,
                   dry_run=args.dry_run, args=args)
        if code == 0:
            return
        if attempt + 1 < attempts:
            print('App install failed; retrying ({}/{})...'.format(
                attempt + 2, attempts
            ))
            wait(1.5, args.dry_run)
    raise subprocess.CalledProcessError(code, command)


def reset_emulator(args, base_env):
    run(['pebble', 'kill', '--force'], env=base_env, check=False,
        dry_run=args.dry_run)
    wait(1.0, args.dry_run)
    run(['pebble', 'wipe'], env=base_env, check=False,
        dry_run=args.dry_run)
    wait(1.5, args.dry_run)


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


def send_metric(args, env, key, value):
    if not args.dry_run:
        appinfo = json.loads((ROOT / 'build' / 'appinfo.json').read_text())
        key = appinfo['appKeys'][key]
    run(['pebble', 'send-app-message', '--emulator', EMULATOR,
         '--int', '{}={}'.format(key, value)], env=env,
        dry_run=args.dry_run, args=args)


def drive_to_screen(args, env, lock_delay):
    wait(args.settle_s, args.dry_run)
    if args.dark_mode:
        send_metric(args, env, 'DARK_MODE', 1)
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
        wait(1.0, args.dry_run)
        return

    wait(4.0, args.dry_run)

    if args.screen in ('recovery', 'recovery-discard'):
        # Let the phone write at least one periodic draft, then close and
        # relaunch the watch app. PebbleKit JS restarts with the app and should
        # offer the persisted draft instead of silently starting over.
        wait(16.0, args.dry_run)
        # BACK now pauses safely. Reinstall directly to interrupt/relaunch.
        # Reinstalling the same UUID relaunches the app without clearing its
        # persisted watch or PebbleKit JS data. This avoids depending on the
        # launcher's post-exit selection, which varies after an emulator wipe.
        install_app(args, env)
        wait(5.0, args.dry_run)
        if args.screen == 'recovery-discard':
            click(args, 'down', env)
            wait(0.5, args.dry_run)
        return

    pages = ('kilometres', 'zones', 'heart-history', 'route')
    if args.screen in pages:
        for _ in range(pages.index(args.screen) + 1):
            click(args, 'down', env)
            wait(0.35, args.dry_run)
        return

    if args.screen == 'split':
        # Exercise the watch's split UI with an explicit metric. Racing the
        # GPS simulator at 250 m/s only exercises outlier rejection.
        send_metric(args, env, 'DISTANCE_M', 1000)
        wait(0.25, args.dry_run)
        return

    if args.screen in ('paused', 'end-confirm', 'finished', 'upload-exit', 'history', 'history-detail'):
        click(args, 'up', env)
        wait(0.5, args.dry_run)

    if args.screen in ('end-confirm', 'finished', 'upload-exit', 'history', 'history-detail'):
        click(args, 'select', env)
        wait(0.5, args.dry_run)

    if args.screen in ('finished', 'upload-exit', 'history', 'history-detail'):
        click(args, 'up', env)
        wait(1.0, args.dry_run)

    if args.screen in ('history', 'history-detail'):
        click(args, 'select', env)
        wait(2.0, args.dry_run)
        if args.screen == 'history-detail':
            click(args, 'select', env)
            wait(0.5, args.dry_run)
        return

    if args.screen == 'upload-exit':
        send_metric(args, env, 'UPLOAD_PENDING', 1)
        click(args, 'back', env)
        wait(0.5, args.dry_run)


def verify_capture(args, output):
    from PIL import Image
    # Stable native-colour regions distinguish real controller states from a
    # GPS-wait screen. Text/clock/data values intentionally vary between runs.
    checks = {
        'gps-ready': ('gps-ready', (78, 85)),
        'countdown': ('countdown', (90, 140)),
        'activity': ('activity', (170, 100)),
        'split': ('split', (170, 100)),
        'paused': ('paused', (170, 100)),
        'finished': ('finished', (170, 100)),
        'end-confirm': ('end-confirm', (10, 40)),
        'upload-exit': ('upload-exit', (10, 40)),
        'recovery': ('recovery', (10, 100)),
        'recovery-discard': ('recovery-discard', (10, 40)),
        'history': ('history', (10, 45)),
        'history-detail': ('history-detail', (170, 100)),
    }
    if args.screen not in checks and args.screen not in ('gps-search', 'kilometres', 'zones', 'heart-history', 'route'):
        return
    reference, point = checks.get(args.screen, (args.screen, (0, 22)))
    actual = Image.open(output).convert('RGB')
    expected = Image.open(ROOT/'screenshots'/(reference+'.png')).convert('RGB')
    def pixel(image):
        scale = image.width / 200
        return image.getpixel((round(point[0]*scale), round(point[1]*scale)))
    if args.screen in checks and sum(abs(a-b) for a,b in zip(pixel(actual),pixel(expected))) > 30:
        raise RuntimeError('Capture did not reach '+args.screen+'; inspect '+str(output))
    regions = {
        'paused': (120, 1, 174, 19), 'finished': (120, 1, 174, 19),
        'end-confirm': (8, 57, 172, 125), 'upload-exit': (8, 57, 172, 125),
        'recovery': (8, 34, 172, 72), 'recovery-discard': (8, 57, 172, 125),
        'kilometres': (8, 27, 172, 62), 'zones': (8, 27, 172, 62),
        'heart-history': (8, 27, 172, 62),
        'route': (8, 27, 172, 62),
        'gps-search': (8, 148, 172, 181),
    }
    if args.screen in regions:
        box = regions[args.screen]
        a = actual.resize((200, 228), Image.Resampling.NEAREST).crop(box).tobytes()
        b = expected.resize((200, 228), Image.Resampling.NEAREST).crop(box).tobytes()
        if sum(abs(x-y)>10 for x,y in zip(a,b))/len(a) > 0.01:
            raise RuntimeError('Capture label does not match '+args.screen+'; inspect '+str(output))


def capture(args, base_env, output):
    command = ['pebble', 'screenshot', '--emulator', EMULATOR, '--no-open',
               str(output)]
    attempts = max(1, args.capture_retries + 1)
    code = 0

    if not args.dry_run:
        output.parent.mkdir(parents=True, exist_ok=True)

    for attempt in range(attempts):
        code = run(command, env=base_env, check=False, dry_run=args.dry_run,
                   args=args)
        if code == 0:
            break
        if attempt + 1 < attempts:
            print('Screenshot capture failed; retrying ({}/{})...'.format(
                attempt + 2, attempts
            ))
            wait(1.0, args.dry_run)

    if code != 0:
        raise subprocess.CalledProcessError(code, command)

    if not args.dry_run:
        verify_capture(args, output)
    print('Saved emulator screenshot to {}'.format(output))
    if args.all_screens:
        wait(args.post_capture_s, args.dry_run)


def capture_shared_flow(args, sim_env, base_env, lock_delay):
    original_screen = args.screen
    captured = set()

    def shot(screen):
        args.screen = screen
        index = ALL_SCREEN_SEQUENCE.index(screen) + 1
        capture(args, base_env, all_output_path(args, screen, index))
        captured.add(screen)

    def press(button, delay=0.35):
        click(args, button, sim_env)
        wait(delay, args.dry_run)

    def start_recording():
        press('select', lock_delay + 0.5)
        press('select', 3.3)

    try:
        if not args.reuse_emulator:
            reset_emulator(args, base_env)
        install_app(args, sim_env)
        wait(args.settle_s, args.dry_run)
        if args.dark_mode:
            send_metric(args, sim_env, 'DARK_MODE', 1)
        press_activity_buttons(args, sim_env)
        shot('choose')
        started = time.monotonic()
        press('select', 0.35)
        shot('gps-search')
        wait(lock_delay + 0.8 - (time.monotonic() - started), args.dry_run)
        shot('gps-ready')
        started = time.monotonic()
        press('select', 0.25)
        shot('countdown')
        wait(3.6 - (time.monotonic() - started), args.dry_run)
        shot('activity')

        for page in ('kilometres', 'zones', 'heart-history', 'route'):
            press('down')
            shot(page)
        press('select')
        send_metric(args, sim_env, 'DISTANCE_M', 1000)
        wait(0.35, args.dry_run)
        shot('split')
        press('up')
        shot('paused')
        press('select')
        shot('end-confirm')
        press('up', 1.1)
        shot('finished')
        send_metric(args, sim_env, 'UPLOAD_PENDING', 1)
        press('back')
        shot('upload-exit')
        press('down')
        send_metric(args, sim_env, 'UPLOAD_PENDING', 0)
        press('select', 0.8)
        shot('history')
        press('select')
        shot('history-detail')

        # Recover a second recording. Reinstall on the same emulator so its
        # watch checkpoint and phone draft survive the app/runtime restart.
        press('back')
        press('back')
        start_recording()
        # Pause/resume sends immediate phone checkpoints. This leaves an active
        # draft to recover without waiting for the periodic checkpoint timer.
        press('up', 0.8)
        press('up', 0.8)
        install_app(args, sim_env)
        wait(3.0, args.dry_run)
        shot('recovery')
        press('down')
        shot('recovery-discard')
    finally:
        args.screen = original_screen
    print('Captured {} emulator screenshots in one session.'.format(len(captured)))


def capture_all_screens(args, sim_env, base_env, lock_delay):
    original_screen = args.screen
    captured = []
    index = 1

    try:
        for screen in ALL_SCREEN_SEQUENCE:
            args.screen = screen
            screen_env = sim_env.copy()
            if screen == 'gps-search': screen_env['PEBBLE_TRACKER_SIM_DELAY_S'] = '30'
            screen_output = all_output_path(args, screen, index)
            for attempt in range(2):
                try:
                    reset_emulator(args, base_env)
                    install_app(args, screen_env)
                    drive_to_screen(args, screen_env, lock_delay)
                    capture(args, base_env, screen_output)
                    break
                except subprocess.CalledProcessError:
                    if attempt + 1 >= 2:
                        raise
                    print('Screen flow failed; restarting emulator and '
                          'retrying {}/2...'.format(attempt + 2))
            captured.append(screen_output)
            index += 1
    finally:
        args.screen = original_screen

    print('Captured {} emulator screenshots.'.format(len(captured)))


def main(argv):
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.isolated and not args.all_screens:
        parser.error('--isolated requires --all-screens.')
    if args.all_screens and args.output:
        parser.error('--output only applies to single-screen capture; use --output-dir with --all-screens.')

    sim_env, lock_delay = command_env(args)
    base_env = os.environ.copy()
    output = output_path(args)

    print('Emulator screenshot harness')
    print('  platform:          {}'.format(EMULATOR))
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

    if args.all_screens:
        if not args.skip_build:
            run(['pebble', 'build'], env=base_env, dry_run=args.dry_run)

        if not PBW.exists() and not args.dry_run:
            raise SystemExit('PBW not found: {}'.format(PBW))

        capture_flow = capture_all_screens if args.isolated else capture_shared_flow
        capture_flow(args, sim_env, base_env, lock_delay)
        return 0

    if not args.reuse_emulator:
        reset_emulator(args, base_env)

    if not args.skip_build:
        run(['pebble', 'build'], env=base_env, dry_run=args.dry_run)

    if not PBW.exists() and not args.dry_run:
        raise SystemExit('PBW not found: {}'.format(PBW))

    install_app(args, sim_env)

    drive_to_screen(args, sim_env, lock_delay)
    capture(args, base_env, output)

    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
