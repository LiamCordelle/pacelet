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
- Split timers and kilometre summary state
- Pebble Health sampling, stale-reading expiry, and HR messages

If a button should cause different behavior, change it here.

### `watch_services.c`

Owns external watch services:

- AppMessage serialization and parsing
- GPS/live metric updates received from the phone
- Watch settings persistence and migration

New watch-phone fields must first be declared in `package.json`.

### `watch_ui.c`

Owns all Emery drawing and bitmap lifetimes. It reads the model but does not
change activity state. Screen layouts, colors, fonts, labels, and action-rail
icons belong here.

The renderer is deliberately a larger cohesive file: splitting each screen
would create many tiny modules without reducing shared drawing context.

## State Flow

```text
Choose -> GPS -> Ready -> Countdown -> Active <-> Paused -> Finished
```

The finish confirmation and kilometre split are temporary overlays represented
by flags on the model rather than separate activity states.

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
