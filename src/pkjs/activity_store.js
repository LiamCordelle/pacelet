var SETTINGS_KEY = 'pebbleTrackerSettings';
var ACTIVITIES_KEY = 'pebbleTrackerActivities';
var PENDING_TCX_EXPORT_KEY = 'pebbleTrackerPendingTcxExport';
var ACTIVE_ACTIVITY_KEY = 'pebbleTrackerActiveActivity';
var CORRUPT_ACTIVE_ACTIVITY_KEY = 'pebbleTrackerCorruptActiveActivity';
var ACTIVE_ACTIVITY_VERSION = 1;
var MAX_STORED_ACTIVITIES = 10;

function createActivityStore(options) {
  options = options || {};

  var storage = options.storage;
  var normalizeSettings = options.normalizeSettings || function(value) {
    return value || {};
  };
  var log = options.log || function() {};
  var maxActivities = options.maxActivities || MAX_STORED_ACTIVITIES;
  var settings = loadSettings();

  function readJson(key, fallback, label) {
    try {
      var raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      log(label + ' read failed: ' + e);
      return fallback;
    }
  }

  function writeJson(key, value, label) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      log(label + ' write failed: ' + e);
      return false;
    }
  }

  function removeKey(key, label) {
    try {
      if (storage.removeItem) {
        storage.removeItem(key);
      } else {
        storage.setItem(key, '');
      }
      return true;
    } catch (e) {
      log(label + ' clear failed: ' + e);
      return false;
    }
  }

  function loadSettings() {
    return normalizeSettings(
      readJson(SETTINGS_KEY, null, 'Settings')
    );
  }

  function getSettings() {
    return settings;
  }

  function setSettings(value) {
    settings = normalizeSettings(value);
    writeJson(SETTINGS_KEY, settings, 'Settings');
    return settings;
  }

  function getActivities() {
    return readJson(ACTIVITIES_KEY, [], 'Activity history') || [];
  }

  function getActivity(activityId) {
    var history = getActivities();
    var i;
    for (i = 0; i < history.length; i += 1) {
      if (history[i].id === activityId) {
        return history[i];
      }
    }
    return null;
  }

  function activitySummaries() {
    var history = getActivities();
    var summaries = [];
    var i;
    for (i = 0; i < history.length; i += 1) {
      summaries.push({
        id: history[i].id,
        type: history[i].type,
        startedAt: history[i].startedAt,
        movingTimeS: history[i].movingTimeS,
        distanceM: history[i].distanceM,
        avgHrBpm: history[i].avgHrBpm || 0,
        hrZoneTimeS: history[i].hrZoneTimeS || [0, 0, 0, 0],
        points: history[i].points ? history[i].points.length : 0,
        stravaStatus: history[i].stravaStatus,
        stravaError: history[i].stravaError,
        stravaActivityId: history[i].stravaActivityId,
        stravaUploadStatus: history[i].stravaUploadStatus
      });
    }
    return summaries;
  }

  function saveActivity(activity) {
    var history = getActivities();
    var storedActivity = {
      id: activity.id,
      type: activity.type,
      startedAt: activity.startedAt,
      finishedAt: activity.finishedAt,
      movingTimeS: activity.movingTimeS,
      distanceM: activity.summaryDistanceM,
      points: activity.points,
      hrSamples: activity.hrSamples,
      avgHrBpm: activity.avgHrBpm,
      hrZoneTimeS: activity.hrZoneTimeS,
      hrZoneThresholds: activity.hrZoneThresholds,
      speedCentiMps: activity.summarySpeedCentiMps,
      stravaStatus: 'not_uploaded'
    };

    history = history.filter(function(existingActivity) {
      return existingActivity.id !== storedActivity.id;
    });
    history.unshift(storedActivity);
    if (history.length > maxActivities) {
      history = history.slice(0, maxActivities);
    }
    return writeJson(ACTIVITIES_KEY, history, 'Activity history');
  }

  function updateActivity(activityId, patch) {
    var history = getActivities();
    var i;
    var key;

    for (i = 0; i < history.length; i += 1) {
      if (history[i].id === activityId) {
        for (key in patch) {
          if (patch.hasOwnProperty(key)) {
            history[i][key] = patch[key];
          }
        }
        return writeJson(ACTIVITIES_KEY, history, 'Activity history update');
      }
    }
    return false;
  }

  function setPendingTcxExport(activityId) {
    return writeJson(
      PENDING_TCX_EXPORT_KEY,
      { activityId: activityId || '' },
      'Pending TCX export'
    );
  }

  function getPendingTcxExportActivityId() {
    var pending = readJson(
      PENDING_TCX_EXPORT_KEY, null, 'Pending TCX export'
    );
    return pending && pending.activityId || '';
  }

  function getPendingTcxExportActivity() {
    return getActivity(getPendingTcxExportActivityId());
  }

  function clearPendingTcxExport() {
    return removeKey(PENDING_TCX_EXPORT_KEY, 'Pending TCX export');
  }

  function saveActiveActivity(activity, checkpointedAt) {
    if (!activity || !activity.id) {
      return false;
    }
    return writeJson(ACTIVE_ACTIVITY_KEY, {
      version: ACTIVE_ACTIVITY_VERSION,
      checkpointedAt: checkpointedAt,
      activity: activity
    }, 'Active activity');
  }

  function quarantineActiveActivity(reason) {
    var raw;
    try {
      raw = storage.getItem(ACTIVE_ACTIVITY_KEY);
      if (raw) {
        storage.setItem(CORRUPT_ACTIVE_ACTIVITY_KEY, raw);
      }
      removeKey(ACTIVE_ACTIVITY_KEY, 'Active activity');
      log('Active activity quarantined: ' + reason);
      return true;
    } catch (e) {
      log('Active activity quarantine failed: ' + e);
      return false;
    }
  }

  function getActiveActivityDraft() {
    var raw;
    var draft;
    try {
      raw = storage.getItem(ACTIVE_ACTIVITY_KEY);
      if (!raw) {
        return null;
      }
      draft = JSON.parse(raw);
      if (!draft || draft.version !== ACTIVE_ACTIVITY_VERSION ||
          typeof draft.checkpointedAt !== 'number' ||
          !draft.activity || !draft.activity.id) {
        quarantineActiveActivity('invalid draft envelope');
        return null;
      }
      return draft;
    } catch (e) {
      quarantineActiveActivity('draft read failed: ' + e);
      return null;
    }
  }

  function clearActiveActivity() {
    return removeKey(ACTIVE_ACTIVITY_KEY, 'Active activity');
  }

  return {
    getSettings: getSettings,
    setSettings: setSettings,
    getActivities: getActivities,
    getActivity: getActivity,
    activitySummaries: activitySummaries,
    saveActivity: saveActivity,
    updateActivity: updateActivity,
    setPendingTcxExport: setPendingTcxExport,
    getPendingTcxExportActivityId: getPendingTcxExportActivityId,
    getPendingTcxExportActivity: getPendingTcxExportActivity,
    clearPendingTcxExport: clearPendingTcxExport,
    saveActiveActivity: saveActiveActivity,
    getActiveActivityDraft: getActiveActivityDraft,
    clearActiveActivity: clearActiveActivity,
    quarantineActiveActivity: quarantineActiveActivity
  };
}

module.exports = {
  SETTINGS_KEY: SETTINGS_KEY,
  ACTIVITIES_KEY: ACTIVITIES_KEY,
  PENDING_TCX_EXPORT_KEY: PENDING_TCX_EXPORT_KEY,
  ACTIVE_ACTIVITY_KEY: ACTIVE_ACTIVITY_KEY,
  CORRUPT_ACTIVE_ACTIVITY_KEY: CORRUPT_ACTIVE_ACTIVITY_KEY,
  ACTIVE_ACTIVITY_VERSION: ACTIVE_ACTIVITY_VERSION,
  MAX_STORED_ACTIVITIES: MAX_STORED_ACTIVITIES,
  createActivityStore: createActivityStore
};
