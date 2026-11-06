# Pacelet 0.7.0 validation — 2026-11-06

Production identity: `Pacelet`, UUID
`4481EF3F-FB7F-4EE1-85C4-5B3E1DBA08B2`, Emery only.

- `npm test`: 111 checks pass, including the real C controller/transport,
  pause reconciliation, storage pressure, polling recovery and both GPS bridges.
- `pebble build`: succeeds using SDK 4.33.1 and tool 5.1.2. About 34 KB RAM
  footprint, 96 KB free heap and 7 KB resources. The pre-existing SDK linker
  RWX-segment warning remains; no new compiler warnings.
- Native shipping-renderer QA: 27 screens, 13 exact transition-end comparisons,
  and cancellation tests for focus, unload, motion changes, low battery, frame
  completion and GPS retry. UI snapshots use fixed storage; the compiled dirty
  handler has a small stack frame instead of two full model copies.
- All 17 Emery flow captures pass stable native-colour/label assertions and
  visual inspection: picker, GPS search/ready, countdown, recording, split,
  paused, finish, saved, upload exit, three live pages, history/detail and
  recovery/discard. Captures remain ignored under `screenshots/emulator/`.
- The updated tool uses QuickJS. The local geolocation simulator now supports
  its JSON dictionaries and the legacy V8 wrapper shape, including the real
  phone's timestamp-less callbacks. Capture checks reject a GPS-wait screen
  when the requested state is an activity or confirmation.
- Final-bundle Walking/Cycling smoke captures check the other activity modes.
- The publishing account resolves the existing Pacelet listing rather than
  creating another app. Store images are native 200×228 fixtures of the actual
  shipping C renderer; release notes are in `store-assets/`.

Physical-watch frame pacing, haptics, sunlight and battery endurance, and a real
Strava activity upload, were not tested in this session. Network behavior is
covered by deterministic service tests. No production physical-watch install,
production reset or copying of personal credentials took place.

The active/hollow navigator and route-map idea remain in `docs/roadmap.md`.
