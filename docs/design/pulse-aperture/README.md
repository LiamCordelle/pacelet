# Pacelet design comparison — round 2

**Selected direction:** [Paceboard — complete redesign](../paceboard/README.md),
now developed in one softer palette with a full GPS, countdown, recording,
split, history and recovery motion preview. Earlier rounds remain below.

Historical comparison: these alternatives remain review previews. The selected
Paceboard layout is now implemented for production 0.7.0.

Open [the gallery](index.html) for all frames and a small split transition
study. [The main-screen comparison](first-look.png) is the quickest starting
point; [the full comparison](comparison.png) includes light/dark, long values,
walking, missing HR, split and paused states.

| Direction | Main-screen emphasis | Tradeoff |
| --- | --- | --- |
| A — Pulse | Pace hero, full-width coloured HR field and ten-minute trace | Last kilometre sits in the trace footer |
| B — Aperture | Pace hero, compact HR tile beside the last completed kilometre split | Previous result stays prominent; history moves to a secondary page |
| C — Workout-inspired | Pace hero and precise HR-zone marker | Last kilometre stays in the footer; metrics, zones and HR history get focused pages |

Owner feedback is incorporated: **no current-kilometre ring, kilometre counter,
or distance-to-next-kilometre indicator**. Distance already supplies that
information. A completed split is a separate result and still gets a temporary
takeover. The circular countdown remains a start cue.

Latest owner feedback: **pace is the running hero**, with distance and
elapsed time in the smaller pair below. Keep the last completed kilometre
visible in every option. Remove the redundant `HEART RATE` footer and `HR`/`BPM`
labels beside an unmistakable heart icon. The dedicated HR page still has a
navigation title. Cycling leads with speed; walking retains elapsed and steps
until its hierarchy is reviewed separately.

The last completed kilometre result shown in B is now an owner-endorsed
part of the direction. The remaining choice is how much HR history or zone
precision belongs on the main screen. Choose that before implementing page
navigation or production animations. UP continues to pause/resume; BACK now
pauses safely. Touch controls are outside this design pass.

## Rendering

These are 200×228 native PebbleOS graphics and SDK system fonts, with the same
LCD colour correction as emulator screenshots. They expose actual font sizing
and overflow. Fixtures are illustrative, including synthetic HR history; no
sensor recording or live animation implementation is implied. The browser's
split preview switches native frames; it does not measure device frame pacing.

The sibling renderer is read-only. Its firmware object files are reused; app
objects go into a temporary cache and outputs stay in this directory. To
regenerate after checkout, first build the isolated resource pack:

```sh
cd docs/design/pulse-aperture/preview
pebble build
cd ../../../..
npm run design:render
```

The preview has its own UUID and never installs over Pacelet. No phone install
is needed to review these images.

## Workout reference

The [PebbleOS redesign commit](https://github.com/coredevices/PebbleOS/commit/c3ee3803515aa97994a8c214470ef9a8a5a8d157)
and its `fw/apps/system/workout/active.c`, `style.h` and HR history changes were
reviewed. C is an original Pacelet adaptation of its information hierarchy:
exact zone position, focused pages, descending zone bars and minute-long
coloured HR columns. The proposals use Pacelet's existing configurable zone
thresholds and available metrics. They do not add unsupported cadence, calorie
or SpO2 readings. Keep the clock visible in paused/confirmation states too.

## Improvement review

Numbers refer to the local `design-concepts/improvements.md` review.

| Items | Work in this change set |
| --- | --- |
| 1–3 | Explicit start rejection/ACK, offline pause snapshots, safe BACK behavior |
| 4 | Compact HR storage and quota retry using oldest uploaded raw data only |
| 5–7 | Resumable polling, transient retries/duplicates, saved diagnostics, token/settings race |
| 8–9 | Midnight step carry, serialized/retried phone messages |
| 10–12 | Timestamped HR batches, split backlight/low-battery checkpoint, GPS/history retry |
| 15 | Host C tests of controller/model and transport |
| 13–14 | Deferred until layout selection: central state/overlay transitions, view model, per-screen layers and burst animation engine |

Upload exit confirmation is also implemented in the existing UI. It warns
that leaving may pause status checks; an upload accepted by Strava may still
finish. It does not claim to cancel a server-side upload.

## Validation — 2026-11-06

- `npm test`: 103 checks pass, including the real C controller/transport.
- `pebble build`: production-identity 0.7.0 Emery bundle builds successfully.
- 10 existing-app flow captures per theme, including upload exit confirmation,
  reviewed in light and dark mode. Captures stay ignored under
  `screenshots/emulator/`; the mock upload dialog is under `screenshots/`.
- Native comparison: 30 frames rendered with the sibling firmware graphics
  library, covering both the main layout choices and proposed secondary pages.
- No real phone installation, real Strava upload or physical-watch battery/HR
  session was performed. UI transition/layer refactors remain design-dependent.
