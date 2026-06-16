# Pebble Activity Tracker

Pebble Activity Tracker is a Pebble watchapp for recording outdoor activities.
The watch acts as the controller and live dashboard, while the paired phone
provides GPS.

The primary platform for this project is `emery` because that is the watch used
for day-to-day testing. Other configured Pebble targets are kept buildable, but
layout and manual QA decisions should prioritize `emery`.

## Features

- Walking, Running, and Cycling activity modes.
- Guided watch flow: choose activity from a compact menu, wait for GPS lock, run
  a 3-second countdown, then record.
- Phone GPS lock required before starting an activity.
- Walking and Running screens show elapsed time, distance, smoothed pace, and
  heart rate.
- Cycling screen shows elapsed time, distance, smoothed speed in km/h, and
  heart rate.
- Watch screens use a right-side action rail with icons aligned to the hardware
  buttons.
- Heart rate is read from Pebble Health when supported by the device.
- Activities can be started, paused, resumed, finished, and saved from the
  watch.
- Phone-side recorder stores recent activity summaries, GPS points, and
  heart-rate samples in Pebble JavaScript `localStorage`.
- Optional personal Strava upload using credentials entered in the Pebble
  configuration page.
- Light/dark watch display mode, defaulting to light mode.
- Recent saved activities in the configuration page with TCX export and Strava
  retry actions.
- Deterministic Node test harness for the core tracking logic.

## Watch Controls

- `SELECT`: advance the flow, pause, resume, or return to the activity picker.
- `UP`: refresh GPS on the GPS or saved screens.
- `DOWN`: cycle activity type on the choose/GPS screens.
- Hold `DOWN`: finish and save an active or paused activity.

Startup flow:

```text
Choose Activity -> GPS lock status -> 3,2,1 countdown -> Activity started
```

## Project Layout

- `src/c/main.c`: Pebble watch app UI, state machine, controls, HR reads, and
  AppMessage communication.
- `src/pkjs/index.js`: PebbleKit JS runtime integration, phone GPS, persistence,
  and watch-phone messages.
- `src/pkjs/tracker_core.js`: Pure GPS/activity logic used by the phone runtime
  and tests.
- `src/pkjs/strava.js`: Personal Strava token refresh, TCX generation, multipart
  upload request building, and upload status helpers.
- `src/pkjs/config_page.js`: Embedded Pebble configuration page for personal
  Strava credentials.
- `test/tracker_core.test.js`: Test harness for tracking behavior.
- `test/strava.test.js`: Test harness for TCX/export/upload helpers.
- `tools/manual_emery_gps.py`: Manual emulator harness that runs the app in
  `emery` with simulated phone GPS.
- `tools/screenshot_emulator.py`: Real emulator screenshot harness, defaulting
  to `emery`.
- `tools/pypkjs_gps_sim/sitecustomize.py`: Local `pypkjs` geolocation shim used
  only by the emulator harnesses.
- `tools/render_screenshots.js`: Platform-aware screenshot mock renderer.
- `screenshots/`: Generated SVG/PNG design mockups. Real emulator captures go
  under `screenshots/emulator/` and are ignored by git.

## Personal Strava Upload

This app can upload saved activities to Strava without a separate companion app
or backend by storing personal Strava credentials in the Pebble configuration
page.

Open the app settings from the Pebble/Rebble phone app and enter:

- Strava client ID
- Strava client secret
- Refresh token, or a one-time authorization code that the app can exchange for
  tokens
- Optional current access token and expiry
- Whether to auto-upload after saving an activity

Use `Open Strava Authorization` in the settings page to request a code with
`read,activity:write` scope. A read-only token cannot upload activities.

When an activity is saved, PebbleKit JS refreshes the access token if needed,
generates a TCX file with GPS and heart-rate trackpoints, uploads it to Strava,
then polls Strava briefly for the resulting activity ID.

If you paste a one-time authorization code into settings, the app exchanges it
for access/refresh tokens when you save the configuration, then clears the code.

## Saved Activities And Export

Activities are saved on the paired phone in PebbleKit JS `localStorage` under:

```text
pebbleTrackerActivities
```

Open the app settings from the Pebble/Rebble phone app to see recent saved
activity summaries. Each entry has:

- `Export TCX`: opens a generated TCX data URL for that activity.
- `Retry Strava`: retries the Strava upload using the current credentials.

The configuration page also has an Appearance section with a dark-mode toggle
for the watch app.

Important caveat: this is a personal-use integration. The client secret and
tokens are stored in Pebble app settings on the phone, so this approach is not
appropriate for a public/distributed app build.

## Screenshots

Regenerate the current SVG screen mockups with:

```sh
npm run screenshots
```

Generate PNG previews too with:

```sh
npm run screenshots:png
```

Capture a real `emery` emulator screenshot of the current app with:

```sh
npm run screenshots:emulator
```

Capture the main app flow from the `emery` emulator in one run with:

```sh
npm run screenshots:emulator:all
```

The screenshot renderer defaults to `emery`, which has a 200x228 native screen,
matching the manual emulator harness. You can render another supported target
with `--platform`, for example:

```sh
npm run screenshots:png -- --platform basalt
```

Supported screenshot targets are `basalt` and `diorite` at 144x168, `chalk` at
180x180, and `emery` at 200x228.

PNG rendering uses a custom software renderer: it draws the native Pebble screen
into a pixel buffer, then writes a 2x nearest-neighbor PNG so individual watch
pixels are easy to inspect. No external renderer is required.

The emulator screenshot harness builds and installs the PBW, drives the app to a
selected screen or the main app flow, and saves real captures under
`screenshots/emulator/`. The all-screens mode captures choose, GPS searching,
GPS ready, countdown, activity, and paused states with ordered filenames.
Useful variants:

```sh
npm run screenshots:emulator -- --all-screens --activity cycling
npm run screenshots:emulator -- --screen gps-ready
npm run screenshots:emulator -- --screen activity --activity cycling
npm run screenshots:emulator -- --screen paused --reuse-emulator
```

Current mockup examples are emitted as both `.svg` and `.png` files for each
screen. The SVG paths are:

- `screenshots/choose-running.svg`
- `screenshots/gps-search.svg`
- `screenshots/gps-ready.svg`
- `screenshots/countdown.svg`
- `screenshots/walking.svg`
- `screenshots/running.svg`
- `screenshots/paused.svg`
- `screenshots/cycling.svg`

## Tests

Run the deterministic tracker tests and JS syntax checks:

```sh
npm test
```

The test harness covers activity type mapping, GPS lock gating, smoothed
Walking/Running pace, Cycling speed, pause/resume distance handling,
heart-rate samples, finish summaries, TCX generation, token refresh payloads,
multipart Strava upload bodies, activity export controls, and the config page.

## Manual Emulator GPS Harness

Run the app in the `emery` emulator with simulated phone GPS:

```sh
npm run manual:emery:gps
```

By default the harness:

- kills any existing Pebble emulator so the local `pypkjs` GPS shim is loaded,
- builds and installs the PBW into the `emery` emulator,
- selects Running and presses `SELECT` to request GPS,
- waits 30 seconds before returning GPS fixes,
- then emits points every 5 seconds around a slightly jittered 1 km loop, and
- streams Pebble logs until you press `Ctrl+C`.

Useful variants:

```sh
npm run manual:emery:gps -- --activity cycling
npm run manual:emery:gps -- --activity walking --auto-start-activity
npm run manual:emery:gps -- --no-auto-request-gps
npm run manual:emery:gps -- --lock-delay-s 10 --loop-distance-m 2000
```

The GPS simulator is injected through `PYTHONPATH` only for the spawned emulator
phone runtime. It does not add dummy GPS behavior to the production app bundle.

## Build

Build the Pebble app with:

```sh
pebble build
```

The PBW is written to `build/pebble-activity-tracker.pbw`.

## Strava

The current Strava path is the personal credentials flow described above. A
public/distributed Strava integration would need a tiny OAuth backend so the
Strava client secret is not shipped inside the Pebble app bundle.

## License

MIT. See `LICENSE.md`.
