# AGENTS.md

This file gives AI coding agents the local context needed to work on Pacelet
without rediscovering the project shape every time.

## Project Overview

Pacelet is a Pebble watchapp for recording outdoor activities.
The watch app is the activity controller and live dashboard; the paired phone is
the GPS recorder.

The only target platform is `emery`. It is the device the owner has and its
native 200x228 display should guide visual layout, emulator screenshots, and
manual QA.

Core behavior:

- The user can choose Walking, Running, or Cycling before starting.
- The watch uses a guided start flow: choose activity from a compact menu, wait
  for phone GPS lock, show a 3-second countdown, then start recording.
- Walking and Running show elapsed time, distance, smoothed pace, and heart
  rate.
- Cycling shows elapsed time, distance, smoothed speed in km/h, and heart rate.
- The top status bar shows the current time on every watch screen.
- Each completed kilometre displays a six-second watch-side split summary with
  kilometre time, split pace or average cycling speed, and current HR.
- Heart rate comes from Pebble Health on the watch.
- GPS points, activity summaries, and heart-rate samples are kept by phone-side
  Pebble JavaScript.
- Personal Strava upload is implemented with credentials entered in the Pebble
  configuration page. This is intentionally personal-use only.
- Recent saved activities are surfaced in the configuration page for TCX export
  and Strava retry.
- The configuration page also controls the watch dark/light display flag. Light
  mode is the default for new installs/settings.

## Important Files

- `package.json`: Pebble manifest, message keys, supported platforms, and npm
  scripts.
- `wscript`: Pebble SDK build configuration.
- `src/c/main.c`: Watch-side UI, button handling, activity state, HR reads, and
  AppMessage communication.
- `src/pkjs/index.js`: Phone-side PebbleKit JS integration, GPS watch/polling,
  localStorage persistence, and AppMessage handling.
- `src/pkjs/tracker_core.js`: Pure tracking logic used by the phone app and
  deterministic tests.
- `src/pkjs/strava.js`: Strava settings normalization, token refresh request
  generation, TCX generation, multipart upload request generation, and upload
  status helpers.
- `src/pkjs/config_page.js`: Embedded settings page opened by Pebble's
  configuration flow.
- `resources/images/`: Generated black/white Material Symbols icon PNG
  resources used by the watch UI.
- `store-assets/`: Pixel-native Pacelet app-store icon assets and SVG master.
- `test/tracker_core.test.js`: Node test harness for GPS lock gating,
  pace/speed smoothing, pause/resume behavior, HR samples, and finish summaries.
- `test/strava.test.js`: Node test harness for Strava settings, TCX generation,
  multipart upload body generation, and config page generation.
- `tools/generate_activity_icons.js`: Dependency-free generator for the
  walking/running/cycling menu icon PNG resources.
- `tools/generate_brand_assets.js`: Dependency-free generator for the 25px app
  menu icon and app-store logo assets.
- `tools/manual_emery_gps.py`: Manual `emery` emulator harness with delayed
  simulated phone GPS around a jittered 1 km loop.
- `tools/screenshot_emulator.py`: Real emulator screenshot harness. Defaults to
  `emery` and can drive the app to choose/GPS/countdown/activity/paused screens.
- `tools/pypkjs_gps_sim/sitecustomize.py`: Local `pypkjs` geolocation shim
  loaded only by the emulator harnesses via `PYTHONPATH`.
- `tools/render_screenshots.js`: Generates Emery SVG/PNG design screenshots
  into `screenshots/`.

## Architecture Notes

Keep watch-side and phone-side responsibilities separate:

- Watch C should own UI state, button interactions, elapsed-time display, and
  heart-rate reads. The current watch state flow is `Choose -> GPS/Ready ->
  Countdown -> Active/Paused/Finished`.
- Watch screens use a right-side action rail with small icons aligned to the
  hardware `UP`, `SELECT`, and `DOWN` buttons instead of footer button text.
  The rail should contrast with the theme: dark in light mode, light in dark
  mode.
- Phone JS should own GPS acquisition, GPS point filtering, distance math,
  smoothed speed/pace calculations, persistence, and sync integrations.
- Pure logic that can be tested without Pebble runtime should live in
  `src/pkjs/tracker_core.js`.

AppMessage payloads are declared in `package.json` under `pebble.messageKeys`.
Any new watch-phone message must be added there before use in C or JS.

Current settings message flow:

- Phone sends `DARK_MODE` to the watch on ready, on settings save, and when the
  watch sends `REQUEST_SETTINGS`.
- Watch persists `DARK_MODE` in Pebble persistent storage and applies it to the
  drawing palette.

## Activity Type Mapping

The numeric activity type sent from the watch to the phone is:

- `0`: Walking
- `1`: Running
- `2`: Cycling

Keep this mapping synchronized between `src/c/main.c` and
`src/pkjs/tracker_core.js`.

## GPS And Metrics

Current defaults:

- Start lock accuracy: 25 m or better.
- Track point accuracy: 60 m or better.
- Minimum accepted point interval: 5 seconds.
- Minimum accepted point distance: 5 m.
- Live speed/pace smoothing: recent 10-second window plus an exponential moving
  average, with faster deceleration and a low-speed stop clamp.

For Walking and Running, the watch displays `CURRENT_PACE` as seconds per km.
For Cycling, the watch displays `CURRENT_SPEED` as centi-metres per second,
formatted as km/h.

## Strava Notes

The current Strava implementation is a personal/direct flow:

- The Pebble configuration page stores client ID, client secret, refresh token,
  optional one-time authorization code, access token, expiry, and auto-upload
  preference in phone-side localStorage.
- If an authorization code is present when settings are saved, PebbleKit JS
  exchanges it for access/refresh tokens and clears the code.
- Authorization codes are short-lived and single-use. They are tied to the
  Strava API client, not a watch instance. A reinstall that loses the locally
  stored refresh token needs a fresh authorization code.
- Strava uploads require `activity:write`. The config page has an authorization
  helper URL requesting `read,activity:write`; the runtime records the granted
  scope from token responses and skips upload with a clear error when it knows
  `activity:write` is missing.
- PebbleKit JS refreshes the Strava access token with `client_secret`.
- PebbleKit JS generates TCX from saved GPS/HR samples.
- PebbleKit JS uploads TCX to Strava using multipart/form-data.
- PebbleKit JS polls Strava briefly for the resulting activity ID.
- The same configuration page lists recent saved activity summaries and can send
  `export_tcx` or `retry_strava` actions back to phone-side JS.

This is a personal, user-supplied credential flow rather than a managed OAuth
service. Public builds must clearly state that each user needs their own Strava
API client and that the client secret and tokens are stored in Pebble app
settings on the phone.

## Commands

Run deterministic tests and JS syntax checks:

```sh
npm test
```

Regenerate UI and brand icon PNG resources:

```sh
npm run icons
```

Regenerate design SVG screenshots:

```sh
npm run screenshots
```

Generate PNG previews for visual inspection:

```sh
npm run screenshots:png
```

Capture a real emulator screenshot of the app:

```sh
npm run screenshots:emulator
```

Capture the main emulator app flow in one command:

```sh
npm run screenshots:emulator:all
```

PNG rendering uses the custom software pixel renderer in
`tools/render_screenshots.js`; it uses the `emery` native 200x228 screen buffer
and writes a 2x nearest-neighbor PNG. No external renderer is required.

`npm run screenshots:emulator` uses `tools/screenshot_emulator.py`. It builds
and installs the PBW in the `emery` emulator, saves PNGs under
`screenshots/emulator/`, and kills/restarts existing emulators unless
`--reuse-emulator` is passed. Use `npm run screenshots:emulator:all` after UI
changes to capture choose, GPS searching, GPS ready, countdown, activity,
kilometre split, and paused states. All-screens mode starts from a fresh install
for each screen so state does not leak between captures.

Run the manual `emery` emulator GPS harness:

```sh
npm run manual:emery:gps
```

Build the Pebble bundle:

```sh
pebble build
```

The built PBW is written to `build/pebble-activity-tracker.pbw`.

## Development Guidance

- Prefer small, focused changes. Pebble apps are constrained and AppMessage
  payload size matters.
- Keep C memory usage conservative; avoid large buffers or dynamic allocation
  unless clearly justified.
- Keep phone-side logic compatible with PebbleKit JS. Avoid modern JavaScript
  syntax unless the Pebble bundler/runtime is known to support it.
- Add or update tests in `test/tracker_core.test.js` for changes to GPS math,
  pace/speed smoothing, pause/resume semantics, activity type behavior, or
  summary generation.
- Add or update tests in `test/strava.test.js` for changes to TCX output,
  Strava token request generation, upload form fields, or config page behavior.
- Regenerate screenshots when the watch screen layout or labels change.
- Commit regenerated mock screenshots in `screenshots/` when they document an
  intentional UI change. Do not commit real emulator captures from
  `screenshots/emulator/`.
- The manual emulator GPS harness deliberately kills existing emulators by
  default so the `pypkjs` shim is loaded. Use `--reuse-emulator` only when you
  know the existing phone runtime already has the shim.
- Do not commit generated build internals unless explicitly requested. The PBW
  can be rebuilt with `pebble build`.
