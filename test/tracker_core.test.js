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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
  clock = 5000;
  tracker.recordPosition(pointAtMetersEast(START, 16.67, clock, 8));

  var metrics = tracker.getMetrics();
  assertWithin(metrics.currentSpeedCentiMps, 333, 20, 'running speed');
  assertWithin(metrics.currentPaceSPerKm, 300, 20, 'running pace');
});

run('walking pace is reported from the same smoothed metric', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 0);
  clock = 10000;
  tracker.recordPosition(pointAtMetersEast(START, 14, clock, 8));

  var metrics = tracker.getMetrics();
  assertWithin(metrics.currentSpeedCentiMps, 140, 15, 'walking speed');
  assertWithin(metrics.currentPaceSPerKm, 714, 80, 'walking pace');
});

run('cycling speed is available in centi-metres per second', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 2);
  clock = 10000;
  tracker.recordPosition(pointAtMetersEast(START, 83.33, clock, 8));

  var metrics = tracker.getMetrics();
  assertWithin(metrics.currentSpeedCentiMps, 833, 35, 'cycling speed');
});

run('cycling speed clamps to zero after a near-stationary GPS leg', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 2);
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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 0);
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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
  assert.strictEqual(
    tracker.recordPosition(pointAtMetersEast(START, 10, 0, 8)),
    false
  );
  assert.strictEqual(tracker.getActiveActivity().points.length, 1);
});

run('cycling keeps plausible short interval movement', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 2);
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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
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

  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 2);
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
  var first = tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);

  clock = 2000;
  assert.strictEqual(tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 2), null);
  assert.strictEqual(tracker.getActiveActivity().id, first.id);
  assert.strictEqual(tracker.getActiveActivity().type, 'running');
});

run('restored activity excludes downtime and starts a new GPS segment', function() {
  var clock = 1000000;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
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
  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 0);
  clock += 10000;
  tracker.pauseActivity();

  var snapshot = JSON.parse(JSON.stringify(tracker.getActiveActivity()));
  clock += 90000;
  var restored = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });

  assert.ok(restored.restoreActivity(snapshot, snapshot.pausedAt + 10000));
  assert.strictEqual(restored.getMetrics().movingS, 10);
});

run('discard requires the matching active activity id', function() {
  var clock = 3000000;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return 3000000; } });
  var activity = tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);

  assert.strictEqual(tracker.discardActivity('another-session'), false);
  assert.ok(tracker.getActiveActivity());
  assert.strictEqual(tracker.discardActivity(activity.id), true);
  assert.strictEqual(tracker.getActiveActivity(), null);
});

run('invalid, cached and future fixes cannot start or corrupt a recording', function() {
  var clock = 100000;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  [NaN, Infinity, -1].forEach(function(accuracy) {
    var bad = pointAtMetersEast(START, 0, clock, 8);
    bad.accuracy = accuracy;
    assert.strictEqual(tracker.startActivity(bad, 1), null);
  });
  assert.strictEqual(tracker.startActivity(START, 1), null);
  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
  assert.strictEqual(tracker.recordPosition({ lat: NaN, lon: 0, accuracy: 8,
    timestamp: clock + 1 }), false);
  assert.strictEqual(tracker.recordPosition(pointAtMetersEast(START, 30, clock + 60000, 8)), false);
  clock += 60000;
  assert.strictEqual(tracker.recordPosition(pointAtMetersEast(START, 10, clock - 30000, 8)), false);
  assert.strictEqual(tracker.getMetrics().distanceM, 0);
});

run('a 42-second gap requires consistent fixes and excludes its 313-metre jump', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(START, 1);
  clock = 5000;
  tracker.recordPosition(pointAtMetersEast(START, 15, clock, 8));
  clock = 47000;
  assert.strictEqual(tracker.getMetrics().currentSpeedCentiMps, 0);
  assert.strictEqual(tracker.recordPosition(pointAtMetersEast(START, 328, clock, 8)), false);
  clock += 2000;
  assert.strictEqual(tracker.recordPosition(pointAtMetersEast(START, 334, clock, 8)), false);
  clock += 2000;
  assert.strictEqual(tracker.recordPosition(pointAtMetersEast(START, 340, clock, 8)), true);
  var activity = tracker.getActiveActivity();
  assertWithin(activity.distanceM, 27, 1, 'only measured legs');
  assert.strictEqual(activity.points[2].segmentStart, true);
  assertWithin(activity.points[2].distanceM, 15, 1, 'new segment baseline');
  assertWithin(tracker.getMetrics().currentPaceSPerKm, 333, 15, 'recovered pace');
  assert.strictEqual(activity.gpsDiagnostics.counts.recovered, 1);
});

run('an isolated recovery spike is not committed and does not block the real route', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(START, 1);
  clock = 30000;
  tracker.recordPosition(pointAtMetersEast(START, 1000, clock, 8));
  clock += 2000;
  tracker.recordPosition(pointAtMetersEast(START, 90, clock, 8));
  clock += 2000;
  tracker.recordPosition(pointAtMetersEast(START, 96, clock, 8));
  clock += 2000;
  tracker.recordPosition(pointAtMetersEast(START, 102, clock, 8));
  assertWithin(tracker.getMetrics().distanceM, 12, 1, 'recovery from real cluster');
  assert.ok(tracker.getActiveActivity().points.every(function(p) {
    return TrackerCore.haversineMeters(START, p) < 105;
  }));
});

run('duplicates and poor fixes cannot satisfy recovery confirmation', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(START, 1);
  clock = 30000;
  var fix = pointAtMetersEast(START, 90, clock, 8);
  tracker.recordPosition(fix);
  for (var i = 0; i < 10; i += 1) { tracker.recordPosition(fix); }
  clock += 4000;
  tracker.recordPosition(pointAtMetersEast(START, 102, clock, 50));
  clock += 2000;
  tracker.recordPosition(pointAtMetersEast(START, 108, clock, 8));
  assert.strictEqual(tracker.getActiveActivity().points.length, 1);
  tracker.finishActivity(pointAtMetersEast(START, 108, clock, 8));
});

run('consistent new fixes escape a bad previous anchor without waiting for its speed gate', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(START, 1);
  [5000, 7000, 9000].forEach(function(t, i) {
    clock = t;
    tracker.recordPosition(pointAtMetersEast(START, 200 + i * 6, clock, 8));
  });
  assertWithin(tracker.getMetrics().distanceM, 12, 1, 'unstranded route');
  assert.strictEqual(tracker.getActiveActivity().points[1].segmentStart, true);
});

run('stable urban fixes can recover without regaining start-lock accuracy', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(START, 1);
  for (var i = 0; i < 5; i += 1) {
    clock = 30000 + i * 2000;
    var accepted = tracker.recordPosition(pointAtMetersEast(START, 90 + i * 6, clock, 45));
    assert.strictEqual(accepted, i === 4);
  }
  assert.strictEqual(tracker.getActiveActivity().points[1].segmentStart, true);
  assert.ok(tracker.getMetrics().distanceM < 25);
});

run('stationary jitter inside reported uncertainty adds no distance or pace', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(pointAtMetersEast(START, 0, 0, 12), 0);
  for (clock = 1000; clock <= 60000; clock += 1000) {
    tracker.recordPosition(pointAtMetersEast(START, clock % 2000 ? -3 : 3, clock, 12));
  }
  assert.strictEqual(tracker.getMetrics().distanceM, 0);
  assert.strictEqual(tracker.getMetrics().currentSpeedCentiMps, 0);
  assert.ok(tracker.getActiveActivity().points[1].rawLat);
});

run('uncertain zigzags are smoothed while retaining a steady run and raw observations', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(pointAtMetersEast(START, 0, 0, 20), 1);
  var rawDistance = 0;
  var previous = START;
  for (clock = 2000; clock <= 120000; clock += 2000) {
    var point = pointAtMetersEast(START, clock / 1000 * 3, clock, 20);
    point.lat += ((clock / 2000) % 2 ? 3 : -3) / 111320;
    rawDistance += TrackerCore.haversineMeters(previous, point);
    tracker.recordPosition(point);
    previous = point;
  }
  var metrics = tracker.getMetrics();
  assert.ok(metrics.distanceM < rawDistance * 0.9, 'reduce zigzag inflation');
  assertWithin(metrics.distanceM, 360, 40, 'preserve running distance');
  assertWithin(metrics.currentSpeedCentiMps, 300, 40, 'steady pace');
});

run('clean corners, a U-turn and acceleration remain trackable', function() {
  var clock = 0;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  tracker.startActivity(START, 1);
  var east = [15, 30, 30, 30, 30, 30, 45, 70];
  var north = [0, 0, 15, 30, 15, 0, 0, 0];
  east.forEach(function(meters, i) {
    clock += 5000;
    var point = pointAtMetersEast(START, meters, clock, 8);
    point.lat += north[i] / 111320;
    assert.strictEqual(tracker.recordPosition(point), true);
  });
  assertWithin(tracker.getMetrics().distanceM, 130, 2, 'route around turns');
  assert.strictEqual(tracker.getActiveActivity().gpsDiagnostics.counts.recovered, undefined);
});

run('diagnostics remain bounded and survive checkpoints with segment distances', function() {
  var clock = 1000000;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; }, appVersion: 'test' });
  tracker.startActivity(pointAtMetersEast(START, 0, clock, 8), 1);
  for (var i = 0; i < 200; i += 1) {
    tracker.recordGpsEvent(i % 2 ? 'watch_restart' : 'error_3');
  }
  var saved = JSON.parse(JSON.stringify(tracker.getActiveActivity()));
  var restored = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  restored.restoreActivity(saved, clock);
  var diagnostics = restored.getActiveActivity().gpsDiagnostics;
  assert.strictEqual(diagnostics.events.length, 64);
  assert.strictEqual(diagnostics.counts.error_3, 100);
  assert.strictEqual(diagnostics.droppedEvents, 136);
  assert.strictEqual(diagnostics.appVersion, 'test');
  assert.strictEqual(restored.getActiveActivity().points[0].distanceM, 0);
});
