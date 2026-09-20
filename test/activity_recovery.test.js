var assert = require('assert');
var ActivityRecovery = require('../src/pkjs/activity_recovery');
var ActivityStore = require('../src/pkjs/activity_store');
var TrackerCore = require('../src/pkjs/tracker_core');

var START = {
  lat: 51.5074,
  lon: -0.1278,
  accuracy: 8,
  altitude: 20,
  timestamp: 1000000
};

function run(name, fn) {
  fn();
  console.log('ok - ' + name);
}

function memoryStorage() {
  var values = {};
  return {
    getItem: function(key) {
      return values.hasOwnProperty(key) ? values[key] : null;
    },
    setItem: function(key, value) {
      values[key] = String(value);
    },
    removeItem: function(key) {
      delete values[key];
    }
  };
}

function createStore(storage) {
  return ActivityStore.createActivityStore({
    storage: storage,
    normalizeSettings: function(value) { return value || {}; }
  });
}

run('recovery checkpoints and restores an active activity as paused', function() {
  var clock = 1000000;
  var storage = memoryStorage();
  var store = createStore(storage);
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  var timerCallback = null;
  var recovery = ActivityRecovery.createActivityRecovery({
    tracker: tracker,
    store: store,
    nowMs: function() { return clock; },
    setIntervalFn: function(callback, delay) {
      assert.strictEqual(delay, 15000);
      timerCallback = callback;
      return 7;
    }
  });

  tracker.startActivity(Object.assign({}, START, { timestamp: clock }), 1);
  recovery.recordStarted();
  assert.ok(timerCallback);
  assert.strictEqual(store.getActiveActivityDraft().activity.type, 'running');

  clock += 15000;
  timerCallback();
  assert.strictEqual(store.getActiveActivityDraft().checkpointedAt, clock);

  clock += 60000;
  var restoredTracker = TrackerCore.createTrackerCore({
    nowMs: function() { return clock; }
  });
  var restoredRecovery = ActivityRecovery.createActivityRecovery({
    tracker: restoredTracker,
    store: store,
    nowMs: function() { return clock; }
  });
  assert.strictEqual(restoredRecovery.restore(), true);
  assert.strictEqual(restoredTracker.getActiveActivity().paused, true);
  assert.strictEqual(
    restoredRecovery.stateDictionary('').ACTIVITY_STATE,
    ActivityRecovery.STATE_RECOVERY
  );
  assert.strictEqual(restoredTracker.getMetrics().movingS, 15);
});

run('recovery waits for GPS then resumes exactly once', function() {
  var clock = 2000000;
  var storage = memoryStorage();
  var store = createStore(storage);
  var original = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  original.startActivity(Object.assign({}, START, { timestamp: clock }), 2);
  store.saveActiveActivity(original.getActiveActivity(), clock);

  clock += 30000;
  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  var recovery = ActivityRecovery.createActivityRecovery({
    tracker: tracker,
    store: store,
    nowMs: function() { return clock; },
    setIntervalFn: function() { return 8; }
  });
  recovery.restore();

  assert.strictEqual(
    recovery.requestResume(tracker.getActiveActivity().id, null),
    'waiting'
  );
  assert.strictEqual(recovery.isResumePending(), true);
  assert.strictEqual(recovery.tryPendingResume(Object.assign({}, START, { timestamp: clock })), true);
  assert.strictEqual(recovery.tryPendingResume(Object.assign({}, START, { timestamp: clock })), false);
  assert.strictEqual(tracker.getActiveActivity().paused, false);
  assert.strictEqual(
    recovery.discard(tracker.getActiveActivity().id),
    false
  );
  assert.strictEqual(
    recovery.stateDictionary('').ACTIVITY_STATE,
    ActivityRecovery.STATE_ACTIVE
  );
});

run('recovery rejects stale session commands and confirms discard', function() {
  var clock = 3000000;
  var storage = memoryStorage();
  var store = createStore(storage);
  var original = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  var activity = original.startActivity(Object.assign({}, START, { timestamp: clock }), 0);
  store.saveActiveActivity(activity, clock);

  var tracker = TrackerCore.createTrackerCore({ nowMs: function() { return clock; } });
  var recovery = ActivityRecovery.createActivityRecovery({
    tracker: tracker,
    store: store,
    nowMs: function() { return clock; }
  });
  recovery.restore();

  assert.strictEqual(recovery.discard('wrong-id'), false);
  assert.ok(store.getActiveActivityDraft());
  assert.strictEqual(recovery.discard(activity.id), true);
  assert.strictEqual(store.getActiveActivityDraft(), null);
  assert.strictEqual(tracker.getActiveActivity(), null);
  assert.strictEqual(
    recovery.stateDictionary('').ACTIVITY_STATE,
    ActivityRecovery.STATE_NONE
  );
});

run('invalid tracker payload is quarantined during recovery', function() {
  var storage = memoryStorage();
  var store = createStore(storage);
  store.saveActiveActivity({ id: 'bad', type: 'teleporting' }, 4000000);
  var recovery = ActivityRecovery.createActivityRecovery({
    tracker: TrackerCore.createTrackerCore(),
    store: store
  });

  assert.strictEqual(recovery.restore(), false);
  assert.strictEqual(store.getActiveActivityDraft(), null);
  assert.ok(storage.getItem(ActivityStore.CORRUPT_ACTIVE_ACTIVITY_KEY));
});

run('malformed point collections cannot crash recovery startup', function() {
  var storage = memoryStorage();
  var store = createStore(storage);
  store.saveActiveActivity({
    id: 'bad-points',
    type: 'running',
    startedAt: 4000000,
    paused: false,
    pausedAt: 0,
    pausedMs: 0,
    distanceM: 0,
    points: { length: 1 },
    hrSamples: []
  }, 4001000);
  var recovery = ActivityRecovery.createActivityRecovery({
    tracker: TrackerCore.createTrackerCore(),
    store: store
  });

  assert.doesNotThrow(function() {
    assert.strictEqual(recovery.restore(), false);
  });
  assert.strictEqual(store.getActiveActivityDraft(), null);
  assert.ok(storage.getItem(ActivityStore.CORRUPT_ACTIVE_ACTIVITY_KEY));
});
