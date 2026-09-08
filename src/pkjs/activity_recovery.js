var TrackerCore = require('./tracker_core');

var STATE_NONE = 0;
var STATE_ACTIVE = 1;
var STATE_PAUSED = 2;
var STATE_RECOVERY = 3;
var DEFAULT_CHECKPOINT_INTERVAL_MS = 15000;

function createActivityRecovery(options) {
  options = options || {};

  var tracker = options.tracker;
  var store = options.store;
  var nowMs = options.nowMs || function() {
    return Date.now ? Date.now() : new Date().getTime();
  };
  var setIntervalFn = options.setIntervalFn || setInterval;
  var clearIntervalFn = options.clearIntervalFn || clearInterval;
  var checkpointIntervalMs = options.checkpointIntervalMs ||
      DEFAULT_CHECKPOINT_INTERVAL_MS;
  var log = options.log || function() {};
  var checkpointTimer = null;
  var lastCheckpointedAt = 0;
  var recoveryPending = false;
  var resumePending = false;

  function activeActivity() {
    return tracker.getActiveActivity();
  }

  function checkpoint() {
    var activity = activeActivity();
    var timestamp;
    if (!activity) {
      return false;
    }
    timestamp = nowMs();
    if (!store.saveActiveActivity(activity, timestamp)) {
      return false;
    }
    lastCheckpointedAt = timestamp;
    return true;
  }

  function stopCheckpointing() {
    if (checkpointTimer !== null) {
      clearIntervalFn(checkpointTimer);
      checkpointTimer = null;
    }
  }

  function startCheckpointing() {
    if (checkpointTimer === null && activeActivity() &&
        !activeActivity().paused) {
      checkpointTimer = setIntervalFn(checkpoint, checkpointIntervalMs);
    }
  }

  function restore() {
    var draft = store.getActiveActivityDraft();
    var restored;
    if (!draft) {
      return false;
    }
    try {
      restored = tracker.restoreActivity(
        draft.activity, draft.checkpointedAt);
    } catch (err) {
      log('Active activity restore failed: ' + err);
      restored = null;
    }
    if (!restored) {
      store.quarantineActiveActivity('invalid activity payload');
      return false;
    }
    lastCheckpointedAt = draft.checkpointedAt;
    recoveryPending = true;
    resumePending = false;
    log('Recovered active activity draft ' + draft.activity.id);
    return true;
  }

  function recordStarted() {
    recoveryPending = false;
    resumePending = false;
    checkpoint();
    startCheckpointing();
  }

  function recordPaused() {
    resumePending = false;
    checkpoint();
    stopCheckpointing();
  }

  function recordResumed() {
    recoveryPending = false;
    resumePending = false;
    checkpoint();
    startCheckpointing();
  }

  function recordFinished(saved) {
    stopCheckpointing();
    recoveryPending = false;
    resumePending = false;
    if (saved) {
      store.clearActiveActivity();
      lastCheckpointedAt = 0;
    }
  }

  function matchesActivity(activityId) {
    var activity = activeActivity();
    return !!activity && (!activityId || activity.id === activityId);
  }

  function requestResume(activityId, position) {
    if (!recoveryPending || !matchesActivity(activityId)) {
      return 'unavailable';
    }
    if (!tracker.canStartFromPosition(position)) {
      resumePending = true;
      return 'waiting';
    }
    if (!tracker.resumeActivity(position)) {
      return 'unavailable';
    }
    recordResumed();
    return 'resumed';
  }

  function tryPendingResume(position) {
    if (!resumePending || !recoveryPending ||
        !tracker.canStartFromPosition(position)) {
      return false;
    }
    if (!tracker.resumeActivity(position)) {
      return false;
    }
    recordResumed();
    return true;
  }

  function discard(activityId) {
    if (!recoveryPending || !matchesActivity(activityId) ||
        !store.clearActiveActivity()) {
      return false;
    }
    if (!tracker.discardActivity(activityId)) {
      return false;
    }
    stopCheckpointing();
    recoveryPending = false;
    resumePending = false;
    lastCheckpointedAt = 0;
    return true;
  }

  function stateDictionary(message) {
    var activity = activeActivity();
    var metrics;
    var state;
    var dictionary = {
      ACTIVITY_STATE: STATE_NONE,
      RECOVERY_MESSAGE: message || ''
    };
    if (!activity) {
      return dictionary;
    }

    metrics = tracker.getMetrics();
    state = recoveryPending ? STATE_RECOVERY :
      (activity.paused ? STATE_PAUSED : STATE_ACTIVE);
    dictionary.ACTIVITY_STATE = state;
    dictionary.ACTIVITY_ID = activity.id;
    dictionary.ACTIVITY_TYPE = TrackerCore.activityTypeValue(activity.type);
    dictionary.ACTIVITY_STARTED_AT = Math.floor(activity.startedAt / 1000);
    dictionary.ACTIVITY_MOVING_S = metrics ? metrics.movingS : 0;
    dictionary.ACTIVITY_CHECKPOINTED_AT = Math.floor(
      (lastCheckpointedAt || nowMs()) / 1000);
    dictionary.DISTANCE_M = metrics ? metrics.distanceM : 0;
    return dictionary;
  }

  return {
    restore: restore,
    checkpoint: checkpoint,
    recordStarted: recordStarted,
    recordPaused: recordPaused,
    recordResumed: recordResumed,
    recordFinished: recordFinished,
    requestResume: requestResume,
    tryPendingResume: tryPendingResume,
    discard: discard,
    matchesActivity: matchesActivity,
    stateDictionary: stateDictionary,
    isRecoveryPending: function() {
      return recoveryPending;
    },
    isResumePending: function() {
      return resumePending;
    }
  };
}

module.exports = {
  STATE_NONE: STATE_NONE,
  STATE_ACTIVE: STATE_ACTIVE,
  STATE_PAUSED: STATE_PAUSED,
  STATE_RECOVERY: STATE_RECOVERY,
  DEFAULT_CHECKPOINT_INTERVAL_MS: DEFAULT_CHECKPOINT_INTERVAL_MS,
  createActivityRecovery: createActivityRecovery
};
