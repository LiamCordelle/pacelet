# Changelog

All notable changes to Pacelet are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
