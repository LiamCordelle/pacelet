var ActivityStore = require('./activity_store');
var ActivityRecovery = require('./activity_recovery');
var ConfigPage = require('./config_page');
var GpsService = require('./gps_service');
var HistoryMessages = require('./history_messages');
var Strava = require('./strava');
var StravaService = require('./strava_service');
var TrackerCore = require('./tracker_core');

function log(message) {
  console.log(message);
}

function nowMs() {
  return Date.now ? Date.now() : new Date().getTime();
}

function hrZoneThresholdsFromSettings(settings) {
  return [
    settings.hrZone1Bpm,
    settings.hrZone2Bpm,
    settings.hrZone3Bpm
  ];
}

function sendMessage(dictionary, successMessage, failureMessage) {
  Pebble.sendAppMessage(
    dictionary,
    function() {
      if (successMessage) {
        log(successMessage);
      }
    },
    function() {
      if (failureMessage) {
        log(failureMessage);
      }
    }
  );
}

var store = ActivityStore.createActivityStore({
  storage: localStorage,
  normalizeSettings: Strava.copyDefaults,
  log: log
});

var tracker = TrackerCore.createTrackerCore({
  appVersion: require('../../package.json').version,
  hrZoneThresholds:
      hrZoneThresholdsFromSettings(store.getSettings())
});

var recovery;

function handleRecoveryPosition(position) {
  if (recovery && recovery.tryPendingResume(position)) {
    log('Recovered activity resumed after GPS lock');
    sendActivityStateToWatch('ACTIVITY RESUMED');
  }
}

var gps = GpsService.createGpsService({
  geolocation: navigator.geolocation,
  tracker: tracker,
  sendMessage: sendMessage,
  lockAccuracyM: TrackerCore.constants.LOCK_ACCURACY_M,
  nowMs: nowMs,
  log: log,
  onPosition: handleRecoveryPosition
});

recovery = ActivityRecovery.createActivityRecovery({
  tracker: tracker,
  store: store,
  nowMs: nowMs,
  log: log
});

var restoredActivity = recovery.restore();

var strava = StravaService.createStravaService({
  store: store,
  request: StravaService.createHttpRequest(XMLHttpRequest),
  log: log,
  onActivityUpdate: function(activityId) {
    var activity = store.getActivity(activityId);
    log('Strava activity updated: ' + activityId);
    sendHistoryToWatch(HistoryMessages.activityStatusMessage(activity));
  }
});

function sendSettingsToWatch() {
  var settings = store.getSettings();
  sendMessage({
    DARK_MODE: settings.darkMode ? 1 : 0,
    HR_ZONE_1_BPM: settings.hrZone1Bpm,
    HR_ZONE_2_BPM: settings.hrZone2Bpm,
    HR_ZONE_3_BPM: settings.hrZone3Bpm
  }, null, 'Settings send failed');
}

function addSettingsToDictionary(dictionary) {
  var settings = store.getSettings();
  dictionary.DARK_MODE = settings.darkMode ? 1 : 0;
  dictionary.HR_ZONE_1_BPM = settings.hrZone1Bpm;
  dictionary.HR_ZONE_2_BPM = settings.hrZone2Bpm;
  dictionary.HR_ZONE_3_BPM = settings.hrZone3Bpm;
  return dictionary;
}

function sendActivityStateToWatch(message, includeSettings) {
  var dictionary = recovery.stateDictionary(message);
  if (includeSettings) {
    addSettingsToDictionary(dictionary);
  }
  sendMessage(dictionary, null, 'Activity state send failed');
}

function startActivity(typeValue) {
  var position = gps.getLatestPosition();
  var started;
  if (tracker.getActiveActivity()) {
    sendActivityStateToWatch('RECOVERY REQUIRED');
    return;
  }
  if (!tracker.canStartFromPosition(position)) {
    gps.start();
    gps.sendGpsStatus(true);
    return;
  }

  started = tracker.startActivity(position, typeValue);
  if (!started) {
    return;
  }
  recovery.recordStarted();
  gps.start();
  gps.sendActivityUpdate(true);
  sendActivityStateToWatch('');
}

function pauseActivity(activityId) {
  if (!recovery.matchesActivity(activityId)) {
    sendActivityStateToWatch('SESSION CHANGED');
    return;
  }
  if (tracker.pauseActivity()) {
    recovery.recordPaused();
    gps.sendActivityUpdate(true);
    sendActivityStateToWatch('');
  }
}

function resumeActivity(activityId) {
  if (!recovery.matchesActivity(activityId)) {
    sendActivityStateToWatch('SESSION CHANGED');
    return;
  }
  if (tracker.resumeActivity(gps.getLatestPosition())) {
    recovery.recordResumed();
    gps.sendActivityUpdate(true);
    sendActivityStateToWatch('');
  }
}

function resumeRecoveredActivity(activityId) {
  var result = recovery.requestResume(
    activityId, gps.getLatestPosition());
  if (result === 'waiting') {
    gps.start();
    sendActivityStateToWatch('WAITING FOR GPS');
    return;
  }
  if (result === 'resumed') {
    gps.start();
    gps.sendActivityUpdate(true);
    sendActivityStateToWatch('ACTIVITY RESUMED');
    return;
  }
  sendActivityStateToWatch('RECOVERY UNAVAILABLE');
}

function discardRecoveredActivity(activityId) {
  if (!recovery.matchesActivity(activityId)) {
    sendActivityStateToWatch('SESSION CHANGED');
    return;
  }
  if (recovery.discard(activityId)) {
    gps.stopIfIdle();
    sendActivityStateToWatch('ACTIVITY DISCARDED');
  } else {
    sendActivityStateToWatch('DISCARD FAILED');
  }
}

function sendFinishedSummary(finishedActivity, saved) {
  sendMessage({
    ACTIVITY_STATE: ActivityRecovery.STATE_NONE,
    SUMMARY_DISTANCE_M: finishedActivity.summaryDistanceM ||
      finishedActivity.distanceM || 0,
    SUMMARY_MOVING_S: finishedActivity.movingTimeS || 0,
    SUMMARY_POINTS: finishedActivity.points ?
      finishedActivity.points.length : 0,
    ACTIVITY_ID: finishedActivity.id,
    RECOVERY_MESSAGE: saved ? '' : 'SAVE FAILED'
  },
  saved ? 'Activity saved' : 'Activity summary sent',
  'Activity summary send failed');
}

function finishActivity(activityId) {
  var finishedActivity =
      tracker.getActiveActivity();
  var saved;
  var alreadySaved;
  if (!finishedActivity) {
    alreadySaved = activityId ? store.getActivity(activityId) : null;
    if (alreadySaved) {
      sendFinishedSummary(alreadySaved, true);
    } else {
      sendActivityStateToWatch('NO ACTIVE ACTIVITY');
    }
    return;
  }
  if (activityId && finishedActivity.id !== activityId) {
    sendActivityStateToWatch('SESSION CHANGED');
    return;
  }

  recovery.checkpoint();
  finishedActivity = tracker.finishActivity(gps.getLatestPosition());
  saved = store.saveActivity(finishedActivity);
  recovery.recordFinished(saved);
  if (!saved) {
    recovery.restore();
    sendActivityStateToWatch('SAVE FAILED');
    return;
  }
  sendFinishedSummary(finishedActivity, saved);

  if (saved) {
    strava.maybeUpload(finishedActivity);
  }
  gps.stopIfIdle();
}

function sendHistoryToWatch(notice) {
  var payload = HistoryMessages.buildHistoryPayload(
    store.getActivities(), notice
  );
  log('Sending history to watch: ' + payload.count + ' items' +
      (payload.message ? ' - ' + payload.message : ''));
  sendMessage({
    HISTORY_COUNT: payload.count,
    HISTORY_ITEMS: payload.items,
    HISTORY_MESSAGE: payload.message
  }, null, 'History send failed');
}

function openConfiguration(notice) {
  var pendingExport = store.getPendingTcxExportActivity();
  var url;
  var pendingId = store.getPendingTcxExportActivityId();

  if (pendingExport) {
    url = ConfigPage.buildExportUrl(pendingExport);
    log('Opening pending TCX export page for ' + pendingExport.id +
        ' from configuration (' + url.length + ' chars)');
    Pebble.openURL(url);
    return;
  }
  if (pendingId) {
    log('Clearing stale pending TCX export for missing activity ' + pendingId);
    store.clearPendingTcxExport();
    notice = notice || 'Pending TCX export was not found.';
  }

  url = ConfigPage.buildConfigUrl(
    store.getSettings(),
    store.activitySummaries(),
    notice || ''
  );
  log('Opening Pacelet config page (' + url.length + ' chars)');
  Pebble.openURL(url);
}

function prepareActivityTcx(activity, source) {
  if (!activity) {
    log('TCX export failed: activity not found');
    return {
      ok: false,
      message: 'TCX export failed: activity not found.'
    };
  }

  store.setPendingTcxExport(activity.id);
  log('Prepared TCX export from ' + source + ' (' + activity.id + ')');
  return {
    ok: true,
    message: 'TCX ready. Open settings on phone.'
  };
}

function exportActivityTcx(activityId) {
  return prepareActivityTcx(store.getActivity(activityId), 'config');
}

function exportHistoryTcx(index) {
  var activity = HistoryMessages.selectedActivity(store.getActivities(), index);
  var result = prepareActivityTcx(activity, 'watch history index ' + index);
  sendHistoryToWatch(result.message);
}

function retryStravaUpload(activityId) {
  var activity = store.getActivity(activityId);
  var result = strava.retryActivity(activity);
  log(result.message);
  return result;
}

function retryHistoryStrava(index) {
  var activity = HistoryMessages.selectedActivity(store.getActivities(), index);
  var result;
  if (!activity) {
    log('Watch history Strava retry failed: activity index ' + index +
        ' not found');
    sendHistoryToWatch('Activity not found.');
    return;
  }

  log('Watch requested Strava retry for history index ' + index +
      ' (' + activity.id + ')');
  result = strava.retryActivity(activity);
  log(result.message);
  sendHistoryToWatch(result.message);
}

function hasSettingsPayload(payload) {
  return typeof payload.darkMode !== 'undefined' ||
      typeof payload.hrZone1Bpm !== 'undefined' ||
      typeof payload.stravaEnabled !== 'undefined' ||
      typeof payload.stravaClientId !== 'undefined';
}

function saveConfiguration(payload) {
  var settings = store.setSettings(payload);
  var hadAuthorizationCode = !!settings.stravaAuthorizationCode;

  tracker.setHrZoneThresholds(
    hrZoneThresholdsFromSettings(settings)
  );
  sendSettingsToWatch();
  log('Settings saved');

  strava.exchangeAuthorizationCode(function(authErr) {
    var currentSettings = store.getSettings();
    if (authErr) {
      log(authErr.message);
      if (hadAuthorizationCode) {
        log(
          authErr.message +
          '. Authorization codes are short-lived and single-use; generate a fresh code and try again.'
        );
      }
    } else if (hadAuthorizationCode &&
        currentSettings.stravaRefreshToken) {
      log('Strava connected. The refresh token was saved and the one-time authorization code was cleared.');
    }
  });
}

function handleConfigPayload(payload) {
  var actionResult;

  log('Config action received: ' + (payload.action || 'save_settings'));
  if (payload.action === 'export_tcx') {
    actionResult = exportActivityTcx(payload.activityId);
    if (!actionResult.ok) {
      log(actionResult.message);
    }
    return;
  }
  if (payload.action === 'retry_strava') {
    actionResult = retryStravaUpload(payload.activityId);
    log(actionResult.message);
    return;
  }
  if (payload.action === 'clear_pending_tcx_export') {
    store.clearPendingTcxExport();
    log('Pending TCX export cleared.');
    return;
  }
  if (payload.action && payload.action !== 'save_settings') {
    log(
      'Unknown configuration action: ' + payload.action
    );
    return;
  }
  if (!hasSettingsPayload(payload)) {
    log(
      'No settings or activity action was received.'
    );
    return;
  }

  saveConfiguration(payload);
}

function handleAppMessage(payload) {
  if (payload.REQUEST_GPS) {
    gps.start();
  }
  if (payload.REQUEST_SETTINGS && !payload.REQUEST_ACTIVITY_STATE) {
    sendSettingsToWatch();
  }
  if (payload.REQUEST_ACTIVITY_STATE) {
    sendActivityStateToWatch('', !!payload.REQUEST_SETTINGS);
  }
  if (payload.REQUEST_HISTORY) {
    log('Watch requested activity history');
    sendHistoryToWatch('History refreshed.');
  }
  if (payload.START_ACTIVITY) {
    startActivity(payload.ACTIVITY_TYPE);
  }
  if (payload.PAUSE_ACTIVITY) {
    pauseActivity(payload.ACTIVITY_ID);
  }
  if (payload.RESUME_ACTIVITY) {
    resumeActivity(payload.ACTIVITY_ID);
  }
  if (payload.FINISH_ACTIVITY) {
    finishActivity(payload.ACTIVITY_ID);
  }
  if (payload.RECOVER_ACTIVITY) {
    resumeRecoveredActivity(payload.ACTIVITY_ID);
  }
  if (payload.DISCARD_ACTIVITY) {
    discardRecoveredActivity(payload.ACTIVITY_ID);
  }
  if (payload.EXPORT_HISTORY_TCX) {
    exportHistoryTcx(payload.HISTORY_SELECTED_INDEX);
  }
  if (payload.RETRY_HISTORY_STRAVA) {
    retryHistoryStrava(payload.HISTORY_SELECTED_INDEX);
  }
  if (typeof payload.HR_BPM !== 'undefined') {
    tracker.recordHr(payload.HR_BPM);
  }
}

Pebble.addEventListener('ready', function() {
  log('Pacelet ready');
  if (restoredActivity) {
    gps.start();
  }
  sendActivityStateToWatch('', true);
});

Pebble.addEventListener('showConfiguration', function() {
  openConfiguration('');
});

Pebble.addEventListener('webviewclosed', function(event) {
  var payload;
  if (!event || !event.response) {
    return;
  }

  try {
    payload = ConfigPage.parseResponse(event.response);
    if (!payload) {
      return;
    }
    handleConfigPayload(payload);
  } catch (err) {
    log('Config parse failed: ' + err);
  }
});

Pebble.addEventListener('appmessage', function(event) {
  handleAppMessage(event.payload || {});
});
