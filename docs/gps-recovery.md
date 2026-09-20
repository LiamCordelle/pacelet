# GPS recovery and filtering

## September 2026 investigation

The supplied Pacelet TCX and Strava GPX each contain 1,168 positions from the
17 September run, spanning approximately 44 minutes 33 seconds. Their ordered
positions largely agree: the median separation is about 0.36 m, with only four
points separated by more than 2 m. The large trajectory errors are therefore
already present in the Pacelet export, rather than appearing only in Strava's
GPX conversion.

The sparse portion is concentrated around minutes 10–25. Examples from the
TCX (times in UTC; add one hour for local BST):

| Next point time | Gap | Straight-line displacement |
| --- | ---: | ---: |
| 10:30:50 | 29 s | 228 m |
| 10:32:06 | 34 s | 230 m |
| 10:34:23 | 42 s | 313 m |
| 10:35:29 | 22 s | 114 m |
| 10:39:48 | 36 s | 108 m |

The owner paused a couple of times to try to recover GPS and slowed for foot
traffic on Tower Bridge. These gaps cannot all be labelled signal losses:
the old exports omit pause boundaries, reported accuracy and rejected fixes.
Sampling becomes dense again later, which establishes that recording resumed,
but does not prove the later positions were accurate. No ground-truth route or
raw callback stream is available to quantify the actual location error.

The lap reports 8,845 m, while the copied TCX's cumulative point distance ends
at 9,165 m. Code inspection found that both old exporters recomputed distance
by joining every saved point, including across pauses, although the recorder
excluded those jumps. The compact copy export also rounded timestamps to whole
seconds and coordinates to five decimal places. This creates artificial
same-time points and distorts speeds computed from the export.

## Filter version 2

- Validate finite coordinates, accuracy and timestamps. Reject fixes older than
  15 seconds or more than one second in the future, and never replace a newer
  service position with an older/duplicate callback. Starting requires fresh
  accuracy of 25 m or better.
- Retain the 60 m tracking accuracy ceiling and activity speed ceilings of
  3.5/8/25 m/s for walking/running/cycling. For uncertain fixes worse than 25 m,
  also compare implausible speed increases with recent movement.
- After at least 20 seconds without an accepted point, quarantine new fixes.
  Three coherent fixes spanning at least four seconds establish a new segment;
  fixes worse than 35 m need five over eight seconds. Persistent speed outliers
  can also establish a new anchor this way, escaping a bad previous position.
  An implausible candidate-to-candidate jump restarts confirmation.
- Never add the unknown old-to-new displacement to recorded distance. Confirmed
  candidate points become the beginning of the new segment. Reset the speed
  window there so old errors do not contaminate the recovered pace.
- Hold movements within a 2–8 m deadband derived from the smaller endpoint
  accuracy. Smooth positions worse than 10 m with a time-based exponential
  filter, up to a three-second time constant. Save original coordinates whenever
  filtering changes them.
- Derive live speed from net displacement over the recent 10-second window,
  followed by the existing asymmetric exponential smoothing and stop clamp.
  This avoids adding every zigzag as extra pace. Clear live speed after a
  20-second gap or a pause.
- Poll every 15 seconds with at most one outstanding request. After 30 seconds
  without a fresh valid callback, restart acquisition on a polling tick and
  invalidate old callbacks. A failed fallback poll cannot overwrite a fresh
  watch-position result with an error.

These choices trade some responsiveness for stability. Position smoothing can
round corners when accuracy is poor; net-displacement pace can dip during tight
turns. Missing segments reduce recorded distance rather than inventing a route.
Several consistently wrong positions with optimistic reported accuracy can
still pass: this is not map matching or a reconstruction of the hidden route.
Restarting the geolocation subscription is a recovery attempt, not a promise
that the phone's location provider will recover.

## Traceability

New activities keep cumulative distance and segment boundaries on accepted
points. The shared exporter writes these as separate TCX tracks, preserves
millisecond timestamps, and writes diagnostic notes/extensions. The compact
phone handoff retains six decimal places of coordinate precision, and reduces
size using delta coordinates/times and repeated-interval compression.

Each activity has recording app/filter version, decision counters, and up to
64 event groups. Repeated reasons coalesce; the oldest groups are dropped when
full, with a dropped-group count. Events record observation time, reason,
accuracy, position and fix age when available. Pauses, resumes, GPS errors,
subscription restarts and recoveries are distinguishable. Routine accepted,
interval-thinned and duplicate callbacks increment counters only. Accepted
points carry accuracy and any original coordinates displaced by smoothing.
This is bounded diagnostic history, not a full raw GPS log.

Notes and extensions follow the
[Garmin TCX v2 schema](https://www8.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd).
Custom elements use `urn:pacelet:tcx:1`. The position freshness checks use the
timestamp supplied by the phone's
[Geolocation API](https://www.w3.org/TR/geolocation/).
Keep the Pacelet TCX for diagnosis; do not rely on downstream exports retaining
custom extensions. Existing saved activities remain exportable, but their
missing diagnostics and pause boundaries cannot be recovered retrospectively.

## Validation

Deterministic tests cover a 42-second/313 m gap, isolated recovery spikes,
duplicate callbacks, weak urban recovery, persistent outlier anchoring,
stationary jitter, a noisy steady run, clean corners/U-turns/acceleration,
pause and restart semantics, and bounded checkpointed diagnostics. Runtime
tests cover stalled acquisition, late callbacks, overlapping polls and stale
lock/pace. Export tests execute the generated copy page and check metadata,
millisecond timing, segment distance, script escaping and compact payload size.

Direct and copied TCX samples, walking/cycling samples and an empty activity
were validated with `xmllint` against Garmin's schema. The GPS simulator passes
full millisecond timestamps through STPyV8 as floating-point values to avoid
32-bit integer truncation; this was checked through the native bridge. Split
screen captures inject a 1 km watch metric rather than bypassing GPS filters.
Emulator checks verify integration; repeat a real outdoor route with covered
sections to assess the
filter on the phone's actual GPS stream.
