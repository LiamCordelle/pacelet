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

run('walking GPS spikes above plausible speed are ignored', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 0);
  clock = 1000;
  assert.strictEqual(
    tracker.recordPosition(pointAtMetersEast(START, 20, clock, 8)),
    false
  );

  var activity = tracker.getActiveActivity();
  assert.strictEqual(activity.points.length, 1);
  assert.strictEqual(tracker.getMetrics().distanceM, 0);

  clock = 6000;
  assert.strictEqual(
    tracker.recordPosition(pointAtMetersEast(START, 9, clock, 8)),
    true
  );
  assertWithin(tracker.getMetrics().distanceM, 9, 1, 'walking distance');
});

run('stale GPS timestamps are ignored', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 1);
  assert.strictEqual(
    tracker.recordPosition(pointAtMetersEast(START, 10, 0, 8)),
    false
  );
  assert.strictEqual(tracker.getActiveActivity().points.length, 1);
});

run('cycling keeps plausible short interval movement', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(START, 2);
  clock = 1000;
  assert.strictEqual(
    tracker.recordPosition(pointAtMetersEast(START, 12, clock, 8)),
    true
  );

  assertWithin(tracker.getMetrics().distanceM, 12, 1, 'cycling distance');
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

run('heart-rate summary includes average and configured zone times', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({
    nowMs: function() { return clock; },
    hrZoneThresholds: [100, 140, 170]
  });

  tracker.startActivity(START, 1);
  clock = 1000;
  tracker.recordHr(90);
  clock = 2000;
  tracker.recordHr(120);
  clock = 3000;
  tracker.recordHr(150);
  clock = 4000;
  tracker.recordHr(180);
  clock = 5000;
  var finished = tracker.finishActivity();

  assert.strictEqual(finished.avgHrBpm, 135);
  assert.deepStrictEqual(finished.hrZoneTimeS, [1, 1, 1, 1]);
  assert.deepStrictEqual(finished.hrZoneThresholds, [100, 140, 170]);
});

run('heart-rate samples received while paused are not stored', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({
    nowMs: function() { return clock; }
  });

  tracker.startActivity(START, 1);
  clock = 1000;
  tracker.recordHr(140);
  clock = 2000;
  tracker.pauseActivity();
  clock = 3000;
  tracker.recordHr(170);

  assert.strictEqual(tracker.getActiveActivity().hrSamples.length, 1);
  assert.strictEqual(tracker.getActiveActivity().hrSamples[0].bpm, 140);
});

run('clearing heart rate prevents stale BPM attaching to later GPS points', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({
    nowMs: function() { return clock; }
  });

  tracker.startActivity(START, 1);
  clock = 1000;
  tracker.recordHr(150);
  clock = 5000;
  tracker.recordPosition(pointAtMetersEast(START, 15, clock, 8));
  clock = 6000;
  assert.strictEqual(tracker.recordHr(0), true);
  clock = 10000;
  tracker.recordPosition(pointAtMetersEast(START, 30, clock, 8));

  var activity = tracker.getActiveActivity();
  assert.strictEqual(activity.hrSamples.length, 1);
  assert.strictEqual(activity.points[activity.points.length - 1].hr, null);
});

run('heart-rate zone time does not bridge long sample gaps', function() {
  var summary = TrackerCore.summarizeHeartRate([
    { t: 1000, bpm: 150 },
    { t: 20000, bpm: 150 }
  ], 21000, [100, 140, 170]);

  assert.strictEqual(summary.avgHrBpm, 150);
  assert.deepStrictEqual(summary.hrZoneTimeS, [0, 0, 6, 0]);
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

run('starting cannot overwrite an activity already in progress', function() {
  var clock = 1000;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  var first = tracker.startActivity(START, 1);

  clock = 2000;
  assert.strictEqual(tracker.startActivity(START, 2), null);
  assert.strictEqual(tracker.getActiveActivity().id, first.id);
  assert.strictEqual(tracker.getActiveActivity().type, 'running');
});

run('restored activity excludes downtime and starts a new GPS segment', function() {
  var clock = 1000000;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(START, 1);
  clock += 10000;
  tracker.recordPosition(pointAtMetersEast(START, 30, clock, 8));

  var snapshot = JSON.parse(JSON.stringify(tracker.getActiveActivity()));
  var checkpointedAt = clock + 5000;
  clock += 65000;

  var restored = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  assert.ok(restored.restoreActivity(snapshot, checkpointedAt));
  assert.strictEqual(restored.getActiveActivity().paused, true);
  assert.strictEqual(restored.getMetrics().movingS, 15);

  assert.strictEqual(
    restored.resumeActivity(pointAtMetersEast(START, 1000, clock, 8)),
    true
  );
  assertWithin(restored.getMetrics().distanceM, 30, 2,
               'distance before recovered segment');

  clock += 5000;
  restored.recordPosition(pointAtMetersEast(START, 1015, clock, 8));
  assertWithin(restored.getMetrics().distanceM, 45, 2,
               'distance after recovered segment');
  assert.strictEqual(restored.finishActivity().movingTimeS, 20);
});

run('restoring an activity that was paused preserves its original pause', function() {
  var clock = 2000000;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(START, 0);
  clock += 10000;
  tracker.pauseActivity();

  var snapshot = JSON.parse(JSON.stringify(tracker.getActiveActivity()));
  clock += 90000;
  var restored = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  assert.ok(restored.restoreActivity(snapshot, snapshot.pausedAt + 10000));
  assert.strictEqual(restored.getMetrics().movingS, 10);
});

run('discard requires the matching active activity id', function() {
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return 3000000; } });
  var activity = tracker.startActivity(START, 1);

  assert.strictEqual(tracker.discardActivity('another-session'), false);
  assert.ok(tracker.getActiveActivity());
  assert.strictEqual(tracker.discardActivity(activity.id), true);
  assert.strictEqual(tracker.getActiveActivity(), null);
});
