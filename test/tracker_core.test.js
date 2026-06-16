var assert = require('assert');
var TrackerCore = require('../src/pkjs/tracker_core');

var START = {
  lat: 51.5074,
  lon: -0.1278,
  accuracy: 8,
  altitude: 20,
  timestamp: 0
};

function pointAtMetersEast(origin, meters, timestamp, accuracy) {
  var latRad = origin.lat * Math.PI / 180;
  var metersPerDegreeLon = 111320 * Math.cos(latRad);
  return {
    lat: origin.lat,
    lon: origin.lon + (meters / metersPerDegreeLon),
    accuracy: accuracy || 8,
    altitude: origin.altitude,
    timestamp: timestamp
  };
}

function assertWithin(actual, expected, tolerance, label) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    label + ': expected ' + actual + ' to be within ' + tolerance +
      ' of ' + expected
  );
}

function run(name, fn) {
  fn();
  console.log('ok - ' + name);
}

run('activity types are walking, running, cycling', function() {
  assert.strictEqual(TrackerCore.activityTypeName(0), 'walking');
  assert.strictEqual(TrackerCore.activityTypeName(1), 'running');
  assert.strictEqual(TrackerCore.activityTypeName(2), 'cycling');
  assert.strictEqual(TrackerCore.activityTypeName(999), 'running');
});

run('GPS lock is required before starting', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  var poorGps = pointAtMetersEast(START, 0, 0, 80);

  assert.strictEqual(tracker.canStartFromPosition(poorGps), false);
  assert.strictEqual(tracker.startActivity(poorGps, 1), null);
  assert.strictEqual(tracker.getActiveActivity(), null);
});

run('running pace uses the smoothed recent GPS speed', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 1);
  clock = 5000;
  tracker.recordPosition(pointAtMetersEast(START, 16.67, clock, 8));

  var metrics = tracker.getMetrics();
  assertWithin(metrics.currentSpeedCentiMps, 333, 20, 'running speed');
  assertWithin(metrics.currentPaceSPerKm, 300, 20, 'running pace');
});

run('walking pace is reported from the same smoothed metric', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 0);
  clock = 10000;
  tracker.recordPosition(pointAtMetersEast(START, 14, clock, 8));

  var metrics = tracker.getMetrics();
  assertWithin(metrics.currentSpeedCentiMps, 140, 15, 'walking speed');
  assertWithin(metrics.currentPaceSPerKm, 714, 80, 'walking pace');
});

run('cycling speed is available in centi-metres per second', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 2);
  clock = 10000;
  tracker.recordPosition(pointAtMetersEast(START, 83.33, clock, 8));

  var metrics = tracker.getMetrics();
  assertWithin(metrics.currentSpeedCentiMps, 833, 35, 'cycling speed');
});

run('cycling speed clamps to zero after a near-stationary GPS leg', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 2);
  clock = 10000;
  tracker.recordPosition(pointAtMetersEast(START, 83.33, clock, 8));
  assert.ok(tracker.getMetrics().currentSpeedCentiMps > 700);

  clock = 15000;
  tracker.recordPosition(pointAtMetersEast(START, 87.33, clock, 8));

  var metrics = tracker.getMetrics();
  assert.strictEqual(metrics.currentSpeedCentiMps, 0);
});

run('pause and resume do not add GPS jump distance', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 1);
  clock = 5000;
  tracker.recordPosition(pointAtMetersEast(START, 15, clock, 8));

  clock = 6000;
  assert.strictEqual(tracker.pauseActivity(), true);

  clock = 20000;
  tracker.recordPosition(pointAtMetersEast(START, 1000, clock, 8));
  assert.strictEqual(
    tracker.resumeActivity(pointAtMetersEast(START, 1000, clock, 8)),
    true
  );

  clock = 25000;
  tracker.recordPosition(pointAtMetersEast(START, 1015, clock, 8));

  var metrics = tracker.getMetrics();
  assert.ok(metrics.distanceM > 25, 'distance should include both moving legs');
  assert.ok(metrics.distanceM < 40, 'distance should exclude paused GPS jump');
});

run('heart-rate samples attach to activity and latest point', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 1);
  clock = 2000;
  assert.strictEqual(tracker.recordHr(148), true);

  var activity = tracker.getActiveActivity();
  assert.strictEqual(activity.hrSamples.length, 1);
  assert.strictEqual(activity.hrSamples[0].bpm, 148);
  assert.strictEqual(activity.lastPoint.hr, 148);
});

run('finish returns a saved activity summary and clears active state', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 2);
  clock = 10000;
  tracker.recordPosition(pointAtMetersEast(START, 80, clock, 8));
  var finished = tracker.finishActivity(pointAtMetersEast(START, 85, clock, 8));

  assert.ok(finished.id.indexOf('pt-') === 0);
  assert.ok(finished.summaryDistanceM >= 80);
  assert.strictEqual(finished.movingTimeS, 10);
  assert.strictEqual(tracker.getActiveActivity(), null);
});
