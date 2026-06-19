# Phone Architecture

PebbleKit JS is the phone-side recorder and integration runtime. Its entry point
coordinates four focused modules instead of owning their implementation.

```text
Pebble events and AppMessage
            |
         index.js
       /      |       \
      v       v        v
   GPS     activity   Strava
 service    store    service
      |        ^        |
      v        +--------+
 tracker_core.js
```

## Module Responsibilities

### `index.js`

Creates the services and connects Pebble events to them. It owns the short
workflows that cross module boundaries:

- Starting, pausing, resuming, and finishing an activity
- Sending completed summaries back to the watch
- Opening and handling the configuration page
- Routing incoming watch commands and HR samples

It should not implement storage, geolocation, HTTP, or activity calculations.

### `tracker_core.js`

Contains deterministic activity logic:

- GPS point acceptance and distance calculation
- Pace and speed smoothing
- Pause/resume semantics
- HR samples and zone summaries
- Final activity summaries

This module does not use Pebble, localStorage, geolocation, or HTTP globals.

### `activity_store.js`

Owns phone-side localStorage:

- Normalized settings
- Saved activity history
- Compact activity summaries for the configuration page
- Strava upload-status updates

Storage and settings normalization are injected so the module can be tested
without a browser or Pebble runtime.

### `gps_service.js`

Owns phone geolocation:

- High-accuracy position watch
- Fifteen-second fallback polling
- Current GPS lock/error state
- GPS and live metric AppMessage dictionaries
- Stopping geolocation when no activity is active

It records positions through `tracker_core.js` but does not decide when an
activity starts or finishes.

### `strava.js`

Contains pure Strava helpers: settings normalization, OAuth request bodies, TCX
generation, multipart upload bodies, URLs, and activity naming.

### `strava_service.js`

Owns Strava network workflows:

- Authorization-code exchange
- Access-token refresh
- Activity upload
- Upload-status polling
- Auto-upload and retry decisions

HTTP, timers, storage, and logging are injected for deterministic tests.

### `config_page.js`

Generates the embedded settings and TCX export pages and parses configuration
responses.

## Change Guide

- Change GPS filtering or pace/speed math: `tracker_core.js`
- Change geolocation acquisition or live watch updates: `gps_service.js`
- Change stored activity fields or history limits: `activity_store.js`
- Change OAuth/TCX/multipart data: `strava.js`
- Change token, upload, or polling behavior: `strava_service.js`
- Change settings UI or TCX export UI: `config_page.js`
- Add a watch command or cross-service workflow: `index.js`

New watch-phone message keys must be declared in `package.json` before use.

After phone-side changes, run:

```sh
npm test
pebble build
npm run screenshots:emulator:all
```
