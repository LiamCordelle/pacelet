# Changelog

All notable changes to Pacelet are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.0] - 2026-11-10

- Use a soft Sand & Slate palette with darker numbers on warm backgrounds.
- Hold SELECT on any watch screen to see labels for its button actions.
- Press BACK during an activity to wake the backlight. Press it again while
  the Pause tab is visible to pause the recording.
- Use circled green ticks and red crosses for Strava status in activity history.

## [0.8.0] - 2026-11-10

- Show a breadcrumb route from the live dashboard and highlight the current page
  in the action rail.
- Centre the countdown and use a circular wipe for each second.
- Prevent old GPS fixes from briefly showing Ready on a new search and make the
  orbit radius track improving accuracy.
- Show failed and unconfirmed Strava uploads on the saved screen, and show
  uploaded, unsent and pending markers in history.
- Keep a pending save through reconnect or restart until the matching summary
  arrives. Recover older Strava uploads that have no upload ID as retryable
  failures.
- Capture the full emulator flow in one session by default. Use `--isolated`
  to start a fresh emulator for each screen.

## [0.7.0] - 2026-11-06

### Added

- Ship Paceboard: a soft aqua/teal interface with pace-first Running, speed-first
  Cycling, DIST. KM, Last KM/delta and a precise, configurable HR-zone strip.
- Add focused kilometre, time-in-zone and rolling-minute HR pages, including
  pause/gap handling and compact restart checkpoints. Saved/history recaps use
  authoritative phone HR summaries.
- Add smooth, bounded GPS orbit/fix/lock motion, countdown/GO, picker/page/split,
  pause/confirmation, save and upload cues, with Full / Key moments / Off.
  Cancel motion on focus loss/unload and reduce optional effects at low battery.
- Replace the theme toggle with motion settings; preserve existing settings,
  personal Strava credentials and activity history.
- Add native screenshots of the shipping renderer, exact animation-end checks,
  motion lifecycle checks, and full Emery-flow QA tooling.
- Separate native-font Pulse, Aperture and Pebble Workout-inspired design
  comparisons, with long-value checks and focused HR/zone page proposals.
- Host-compiled tests of the real watch controller, model and transport.
- Confirm before leaving during a save or Strava upload. Leaving may pause
  status checks; it does not promise cancellation at Strava.

### Fixed

- Reject stale-GPS starts explicitly and retain START until the phone replies.
- Reconcile offline pause intervals idempotently, removing paused GPS/HR and
  excluding overlaps with phone-runtime recovery downtime only once.
- BACK pauses a recording, cancels countdown/confirmation, and navigates back
  in history. Paused and interrupted recordings require an explicit finish.
- Keep walking step totals across midnight, including while paused.
- Resume saved Strava upload polling on startup, retry transient polling errors,
  recognize duplicate uploads, and preserve settings saved during token refresh.
- Preserve GPS diagnostics in saved activities and both TCX export paths.
- Compact stored HR samples; on storage pressure reclaim only raw data from
  uploaded activities, retain summaries, and explain unavailable local exports.
- Batch timestamped watch HR samples every five seconds, retain failed sends,
  and serialize/retry phone-to-watch messages and watch GPS/history requests.
- Light the split screen and checkpoint at low battery without ending a run.
- Keep paused pace/speed visible and prevent navigation from resetting a save
  before its phone acknowledgement.

## [0.6.2] - 2026-09-22

### Changed

- Document a fixed `Pacelet Dev` name and separate UUID for future phone test
  installs, keeping production store updates, settings, and activity history
  separate. Require isolated development builds and identity checks before
  installation.

## [0.6.1] - 2026-09-22

### Fixed

- Restore GPS acquisition when the Pebble phone bridge omits fix timestamps.
  Use callback receipt time only for missing timestamps; supplied stale or
  malformed timestamps remain rejected, and received fixes still expire.
- Send GPS lock transitions immediately, even when the fix arrives within the
  status-message throttle window after requesting GPS.
- Log timestamp fallback, GPS lock changes, and rate-limited invalid/stale fix
  rejections so Developer Mode can explain failures before an activity starts.
- Cover timestamp-less watch and polling callbacks through activity start,
  expiry, and validation tests. Match the phone's missing timestamps in the
  default emulator GPS simulator.

## [0.6.0] - 2026-09-20

### Added

- Record bounded GPS diagnostic counters and events, the recording app/filter
  version, accepted-point accuracy, and original coordinates of smoothed fixes.
  Preserve these in TCX notes/extensions for future tracking investigations.

### Fixed

- Confirm coherent fixes after GPS gaps or persistent jumps, then resume on a
  new segment without counting the unknown connecting distance.
- Reject stale, invalid, duplicate, and out-of-order fixes; restart silent
  geolocation acquisition and prevent overlapping fallback polls or late
  callbacks from overwriting current GPS state.
- Reduce stationary jitter and uncertain-position noise, use window displacement
  for live pace, and clear stale speed after GPS loss.
- Share TCX generation between phone export and Strava upload, preserving
  millisecond timestamps, pause/recovery segment boundaries and recorded
  cumulative distances. Use valid TCX sport values and required calorie fields.
- Preserve full millisecond timestamps across the emulator's Python/JavaScript
  bridge so simulated GPS fixes pass the same freshness checks as real fixes.
- Exercise the emulator split screen with an explicit 1 km metric instead of
  simulated 250 m/s GPS jumps rejected by the recorder.

### Changed

- Document Conventional Commits as the format for future commits.

## [0.5.0] - 2026-09-08

### Added

- Added crash- and power-loss recovery for in-progress activities, with
  periodic phone checkpoints and a compact watch-side fallback record.
- Added a recovery screen that can resume, finish, or confirm discarding the
  matching partial activity after the phone runtime or watch app restarts.
- Added restart, checkpoint, corrupt-draft, stale-session, and idempotent finish
  tests, plus Emery recovery-screen mockups and emulator capture support.

### Changed

- Made activity commands retry across temporary watch-phone transport failures
  and attach activity IDs so delayed commands cannot affect a newer session.
- Show phone disconnection status during an activity and exclude recovery
  downtime from moving time and GPS distance.

## [0.4.8] - 2026-07-08

### Changed

- Removed the TCX export page's unreliable file handoff button and made the
  copy-based export path explicit.

## [0.4.7] - 2026-07-08

### Changed

- Changed the TCX export page's file action to try phone share/download APIs
  with visible fallback status instead of relying on a silent download link.

## [0.4.6] - 2026-07-07

### Fixed

- Cleared stale Strava failure text while retries are uploading, processing, or
  uploaded so successful retries no longer keep showing old 403 errors.

### Changed

- Updated Strava setup docs for the desktop authorization flow and inactive API
  app/subscription failures.

## [0.4.5] - 2026-07-07

### Changed

- Removed the unreliable in-phone Strava authorization launcher and documented
  the desktop manual OAuth flow in settings.

## [0.4.4] - 2026-07-07

### Changed

- Changed watch-side TCX export to prepare the selected activity and prompt the
  user to open Pacelet settings on the phone, avoiding unreliable background
  attempts to foreground generated export pages.

## [0.4.3] - 2026-07-05

### Fixed

- Made watch-side TCX export handoffs much smaller for long saved activities,
  avoiding silent phone-side drops when opening restored activity history.
- Added Strava upload-stage logging and HTTP response snippets to make retry
  failures such as 403 Forbidden easier to diagnose from phone logs.

## [0.4.2] - 2026-07-04

### Added

- Show distance, moving time, and average pace or speed on Activity History
  list and detail screens.

## [0.4.1] - 2026-07-04

### Fixed

- Fixed a watch crash when opening Activity History by replacing the watch-side
  saved-activity parser's libc integer parsing with a small bounded parser.

## [0.4.0] - 2026-07-04

### Added

- Added watch-side Activity History with saved-activity list/detail screens,
  TCX export, Strava retry, and status refresh messages from the phone.
- Added compact watch-history AppMessage payloads and mock screenshots for the
  new history screens.

### Changed

- Made the configuration page show recent activity status only; export and
  retry actions now live on the watch to avoid fragile config-page close/reopen
  behavior.

## [0.3.2] - 2026-07-04

### Fixed

- Made TCX export handoffs much smaller and more reliable by opening a compact
  export page that generates the TCX file after it loads.

## [0.3.1] - 2026-06-27

### Fixed

- Count walking activity steps from Pebble Health's live daily total instead of
  a weighted time-range estimate, fixing severe under-counting on short walks.

## [0.3.0] - 2026-06-25

### Changed

- Show activity step count on the walking screen instead of pace.
- Use app-store-friendly `emery_` prefixes for default emulator screenshot
  filenames.

### Fixed

- Filter implausible GPS spikes and non-forward timestamps before adding
  distance, reducing over-counted walking tracks when phone GPS jitters.

## [0.2.2] - 2026-06-25

### Fixed

- Accepted full Pebble settings close URLs for TCX export and Strava retry
  actions.

## [0.2.1] - 2026-06-19

### Added

- Watch-side and phone-side architecture guides.
- Deterministic tests for activity persistence, GPS lifecycle, Strava token
  exchange, activity upload, and upload polling.

### Changed

- Split the watch application into focused model, controller, service, and
  rendering modules.
- Split the PebbleKit JS runtime into focused storage, GPS, and Strava service
  modules.
- Reduced the watch and phone entry points to lifecycle and event coordination.

## [0.2.0] - 2026-06-18

### Added

- Current clock and kilometre split summaries on the watch.
- Configurable heart-rate zones and zone-aware watch presentation.
- Native-style countdown, activity controls, metric bands, and workout
  completion flow.
- Emery-specific design QA, Material Symbols activity icons, and Pacelet store
  artwork.

### Changed

- Improved live heart-rate responsiveness and kept sampling warm while paused.
- Targeted Emery exclusively.

## [0.1.1] - 2026-06-17

### Fixed

- Repaired Strava retry and TCX export actions in the configuration page.

## [0.1.0] - 2026-06-16

### Added

- Initial Pacelet watch app with walking, running, and cycling activity modes.
- Phone GPS recording, smoothed pace and speed, heart-rate samples, saved
  activities, TCX export, and personal Strava upload.
