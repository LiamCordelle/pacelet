# Watch Architecture

The watch app uses one shared `PaceletModel` and four small modules around it.
The model is intentionally explicit: Pebble callbacks are event-driven, so a
single state object makes it possible to see what the renderer, controller, and
phone transport are reading and changing.

```text
Pebble lifecycle and buttons
          |
        main.c
          |
          v
activity_controller.c <---- watch_services.c <---- phone AppMessage
          |                       |
          +--------+--------------+
                   v
             PaceletModel
                   |
                   v
              watch_ui.c
```

## Module Responsibilities

### `main.c`

Creates the window, registers Pebble services, forwards button/tick/health
callbacks, and tears everything down. It should not contain product behavior or
drawing code.

### `pacelet.h` and `pacelet_model.c`

Define and initialize the shared model. Helpers that describe the model without
performing I/O belong here, including elapsed time, activity labels, and HR-zone
classification.

The activity type values are part of the watch-phone protocol:

- `0`: Walking
- `1`: Running
- `2`: Cycling

Keep them synchronized with `src/pkjs/tracker_core.js`.

### `activity_controller.c`

Owns user actions and time-based behavior:

- GPS request and countdown
- Start, pause, resume, finish, and return-to-picker transitions
- Partial-activity resume, finish, and confirmed discard transitions
- Activity History list/detail navigation and history actions
- Split timers and kilometre summary state
- Pebble Health sampling, stale-reading expiry, and HR messages

If a button should cause different behavior, change it here.

### `watch_services.c`

Owns external watch services:

- AppMessage serialization and parsing
- GPS/live metric updates received from the phone
- Saved-activity history responses received from the phone
- Watch settings persistence and migration
- Compact activity recovery persistence and reliable command retries

New watch-phone fields must first be declared in `package.json`.

### `watch_ui.c`

Owns Emery drawing and short animation bursts. `WatchView` captures model/time
snapshots; drawing and frame callbacks never change recording state. Four layers
separate content, temporary overlays, header and action rail. The rail is a
transparent full-screen-coordinate layer which only draws its right-hand strip.

The UI owns one 33 ms frame timer, active only during effects. GPS orbiting has a
15-second budget; later fixes get a brief radius response. Focus loss, unload,
motion Off or an obsolete transition cancels its timer. Key moments / low battery
suppress optional effects. Buffers are fixed UI storage so copies do not overflow
the legacy Pebble app's 2 KiB stack. No generated animation atlas ships in the PBW.

The renderer is deliberately a larger cohesive file: splitting each screen
would create many tiny modules without reducing shared drawing context.

## State Flow

```text
Choose -> GPS -> Ready -> Countdown -> Active <-> Paused -> Finished
                                      |          |
                                      +-> Recovery <- app/phone restart
                                             |\
                                             | +-> Finished
                                             +---> Active (after fresh GPS)
   |
   +-> History List -> History Detail
```

The finish confirmation, recovery discard confirmation, and kilometre split
are one exclusive `PaceletOverlay` enum rather than separate activity states.
All activity changes use `pacelet_set_state`; it clears pages/overlays.
`pacelet_set_overlay` returns focus to the dashboard for a new sheet. Recovery
is a first-class activity state because it may survive process and watch-app
restarts.

The watch saves compact activity metadata on state changes, every 30 seconds
while active, and during app teardown. It never attempts to reconstruct the
GPS track; the phone checkpoint is authoritative. Commands that change an
activity carry its ID and are retried when transport fails, preventing a
delayed command from mutating a newer session.

START, pause/resume, finish, recovery and discard now wait for a phone state
reply. Pause/resume additionally require the exact echoed pause snapshot.
Unacknowledged pause intervals use a separate versioned persistence key tagged
with the activity ID, preserving the existing recovery format. At most five
unacknowledged pauses fit in a packet; if that fills while disconnected, the
watch stays paused and displays `SYNC PHONE TO RESUME` until acknowledged.

BACK pauses Active, cancels Countdown and confirmation sheets, navigates
history, and keeps Paused/Recovery open. Outside recording states, an upload or
pending save opens an explicit leave/stay sheet. The platform can still close
or kill an app independently of this button handler. Low battery triggers an
immediate watch/phone checkpoint request and a status warning, not auto-finish.

HR samples are buffered in the model and normally sent every five seconds;
failed sends retain the bytes until transport acknowledgement. The phone
retains original timestamps and deduplicates retries. Split/GPS-lock haptics
also enable the backlight.

DOWN cycles the dashboard and four focused pages, including the GPS route. SELECT returns from a data
page and a 20-second controller timeout also returns to the dashboard. The
route page requests a bounded breadcrumb snapshot on entry and every five
seconds while visible. A busy outbox defers the request to the next tick.
Replies carry the activity ID and segment breaks. The model
keeps eight recent splits, four active HR-zone second counters, a debounced
visual zone, and a timestamp-indexed 60-byte HR ring. Missing/paused seconds are
empty columns. A separate versioned, activity-ID-tagged metric checkpoint
preserves splits/totals through a restart; the phone owns saved HR summaries.
A paused hero captures the last pace/speed instead of clearing it with phone
stop updates. Saving navigation waits for the phone acknowledgement.

`npm test` now host-compiles the actual controller/model and transport against
the small SDK fake under `test/watch_stubs/`. It covers recording/exit controls,
midnight steps, HR batching, ACK filtering, persistence and retry behavior.

## Change Guide

- Add a screen or alter layout: `watch_ui.c`
- Change a button or activity transition: `activity_controller.c`
- Add a phone message or persisted setting: `package.json` and
  `watch_services.c`
- Add a shared field: `PaceletModel` in `pacelet.h`
- Add pure state-derived behavior: `pacelet_model.c`
- Change GPS filtering or activity calculations: `src/pkjs/tracker_core.js`

After watch-side changes, run:

```sh
npm test
pebble build
npm run screenshots:emulator:all
```
