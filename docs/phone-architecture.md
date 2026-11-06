# Phone Architecture

PebbleKit JS is the phone-side recorder and integration runtime. Its entry point
coordinates four focused modules instead of owning their implementation.

```text
Pebble events and AppMessage
            |
         index.js
       /       |        \
      v        v         v
   GPS      recovery    Strava
 service  coordinator  service
      |       /  \        |
      v      v    v       v
 tracker_core.js  activity_store.js
```

## Module Responsibilities

### `index.js`

Creates the services and connects Pebble events to them. It owns the short
workflows that cross module boundaries:

- Starting, pausing, resuming, and finishing an activity
- Reconciling recovery state and session-aware watch commands
- Sending completed summaries back to the watch
- Opening and handling the configuration page
- Sending compact saved-activity history to the watch
- Routing watch history TCX export and Strava retry actions
- Routing incoming watch commands and HR samples

It should not implement storage, geolocation, HTTP, or activity calculations.

### `tracker_core.js`

Contains deterministic activity logic:

- GPS point acceptance and distance calculation
- Confirmation of a new GPS segment after gaps or persistent outliers
- Accuracy-based position smoothing and stationary jitter suppression
- Pace and speed smoothing
- Pause/resume semantics
- Validation and restoration of checkpointed activities
- HR samples and zone summaries
- Final activity summaries

This module does not use Pebble, localStorage, geolocation, or HTTP globals.

### `activity_store.js`

Owns phone-side localStorage:

- Normalized settings
- Saved activity history
- Versioned in-progress activity drafts and corrupt-draft quarantine
- Compact activity summaries for the configuration page
- Strava upload-status updates

Storage and settings normalization are injected so the module can be tested
without a browser or Pebble runtime.

### `activity_recovery.js`

Coordinates durable partial activities without owning their data model:

- Writes a draft immediately on state changes and every 15 seconds while active
- Restores a valid draft in a paused recovery state when PebbleKit JS starts
- Waits for a fresh GPS lock before resuming on a new GPS segment
- Matches resume, finish, and discard requests to the activity ID
- Clears the draft only after a successful save or confirmed discard

### `gps_service.js`

Owns phone geolocation:

- High-accuracy position watch
- Fifteen-second fallback polling
- Restarting acquisition after 30 seconds without fresh valid callbacks
- Rejecting stale/out-of-order callbacks and isolating stopped request generations
- Current GPS lock/error state
- GPS and live metric AppMessage dictionaries
- Stopping geolocation when no activity is active

It records positions through `tracker_core.js` but does not decide when an
activity starts or finishes.

The [current phone bridge](https://github.com/coredevices/mobileapp/blob/master/libpebble3/src/androidMain/assets/startup.js)
returns callbacks with `coords` and no `timestamp`. The service uses receipt
time when the timestamp is absent, while preserving strict checks for supplied
timestamps. Such fixes expire 15 seconds after receipt; their native measurement
age and ordering cannot be verified because the bridge does not expose them.
Developer Mode logs identify this fallback once per runtime and rate-limit
invalid/stale fix rejection logs, including before recording starts.

The emulator GPS shim omits timestamps by default to exercise the phone's
callback shape. Set `PEBBLE_TRACKER_SIM_TIMESTAMP=milliseconds` to exercise the
numeric timestamp path. `test/index_recovery.test.js` also covers both watch and
polling callbacks through GPS request, immediate ready status, countdown, and
activity start, including expiry before start.

### `strava.js`

Contains pure Strava helpers: settings normalization, OAuth request bodies,
multipart upload bodies, URLs, and activity naming. Re-exports the shared TCX
generator from `tcx.js`.

### `gps_diagnostics.js`

Records all-time GPS decision counters plus up to 64 event groups. Consecutive
events with the same reason retain their first/last time and occurrence count;
when the history fills, it drops the oldest group and increments `droppedEvents`.
Routine accepted/interval/duplicate decisions only increment counters. The
diagnostics live on the activity, so checkpointing and saved history preserve
them. No settings or credentials enter this record.

### `tcx.js`

Owns the shared, self-contained TCX generator. Strava uploads call it directly;
the config page embeds the same function and decodes a compact activity payload.
Both paths preserve millisecond timestamps and recorded segment distances.
The compact handoff rounds coordinates to six decimal places (roughly 0.1 m),
uses delta times/coordinates, and preserves all accepted points.

New activities mark the first point after a pause or GPS recovery with
`segmentStart` and store cumulative `distanceM` on every point. These become
separate TCX `Track` elements with no inferred distance across the gap. Historical
activities without those fields retain the legacy fallback; their lost pause
boundaries cannot be reconstructed reliably.

TCX `Notes` identify the recording app/filter version. Extensions in
`urn:pacelet:tcx:1` include point accuracy, raw coordinates when the point was
smoothed, and JSON diagnostic counters/events on the activity. Preserve the
Pacelet TCX when debugging; downstream exports may omit custom metadata.

### `strava_service.js`

Owns Strava network workflows:

- Authorization-code exchange
- Access-token refresh
- Activity upload
- Upload-status polling
- Auto-upload and retry decisions
- Activity update notifications for live watch-history refreshes

HTTP, timers, storage, and logging are injected for deterministic tests.

### `config_page.js`

Generates the embedded settings/status page and TCX export page, then parses
configuration responses. Saved-activity actions are watch initiated; the
settings page only displays recent activity status.

### `history_messages.js`

Builds the compact saved-activity payload sent to the watch and maps stored
Strava upload states to the watch-side status enum.

## Change Guide

- Change GPS filtering or pace/speed math: `tracker_core.js`
- Change geolocation acquisition or live watch updates: `gps_service.js`
- Change stored activity fields or history limits: `activity_store.js`
- Change checkpoint timing or recovery workflow: `activity_recovery.js`
- Change OAuth/multipart data: `strava.js`
- Change TCX XML/diagnostic metadata: `tcx.js`
- Change GPS diagnostic collection/limits: `gps_diagnostics.js`
- Change token, upload, or polling behavior: `strava_service.js`
- Change settings UI or TCX export UI: `config_page.js`
- Change watch history payload shape or status mapping: `history_messages.js`
- Add a watch command or cross-service workflow: `index.js`

New watch-phone message keys must be declared in `package.json` before use.

## Paceboard presentation protocol

`MOTION_MODE` is 0 Full, 1 Key moments, 2 Off. Existing settings are normalized
without resetting history or credentials. `DARK_MODE` remains a reserved legacy
slot. `SUMMARY_HR` is `average,z0Seconds,z1Seconds,z2Seconds,z3Seconds` from the
saved phone summary; `HISTORY_HR` carries the same rows separated by semicolons,
aligned with `HISTORY_ITEMS`. Each field is bounded and the watch inbox is 1280
bytes. Empty old summaries remain empty; the watch never invents HR data.

## Recording reliability protocol

- START is acknowledged by an activity-state reply with its session ID. Stale
  GPS returns `ACTIVITY_STATE=0` and `RECOVERY_MESSAGE=GPS LOST`.
- PAUSE/RESUME carry the desired state and `PAUSE_WINDOWS`: up to five pairs
  of little-endian uint48 UTC millisecond timestamps. A zero endpoint means an
  open pause. The phone echoes the exact bytes; old state replies cannot retire
  a newer snapshot. FINISH carries the same intervals before saving.
- The tracker merges intervals idempotently, removes GPS/HR within them, and
  marks new segments without adding distance across a pause. Phone-runtime
  downtime and delayed watch pauses are excluded only once. Recovery metadata
  is retained in the active draft.
- `HR_BPM_BATCH` contains up to ten samples, each a little-endian uint32 UTC
  second followed by BPM. Normal batches contain five samples. The activity
  ID scopes them; old/duplicate samples are rejected. `HR_BPM` remains supported.
- Phone messages are serialized and retried up to three times. Watch activity
  commands stay pending until a matching application reply, rather than only
  Bluetooth delivery success.
- `UPLOAD_PENDING` covers uploading/processing activities. On ready, uploads
  with a saved Strava ID resume GET polling instead of POSTing the file again.
  Unconfirmed interrupted POSTs require an explicit retry; duplicate responses
  are treated as already uploaded.

HR is stored as compact `[t,bpm]` rows and expanded by the store; old object
rows still load. A failed storage write may prune raw GPS/HR only from the
oldest already-uploaded activities and retry. Summaries/diagnostics and unsynced
tracks remain. Such activities are labelled `rawDataPruned`, and local TCX
export/re-upload gives an explanation instead of generating an empty track.

After phone-side changes, run:

```sh
npm test
pebble build
npm run screenshots:emulator:all
```
