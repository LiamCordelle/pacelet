var ActivityStore = require('./activity_store');
var ConfigPage = require('./config_page');
var GpsService = require('./gps_service');
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
  hrZoneThresholds:
      hrZoneThresholdsFromSettings(store.getSettings())
});

var gps = GpsService.createGpsService({
  geolocation: navigator.geolocation,
  tracker: tracker,
  sendMessage: sendMessage,
  lockAccuracyM: TrackerCore.constants.LOCK_ACCURACY_M,
  nowMs: nowMs,
  log: log
});

var strava = StravaService.createStravaService({
  store: store,
  request: StravaService.createHttpRequest(XMLHttpRequest),
  log: log
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

function startActivity(typeValue) {
  var position = gps.getLatestPosition();
  if (!tracker.canStartFromPosition(position)) {
    gps.start();
    gps.sendGpsStatus(true);
    return;
  }

  tracker.startActivity(position, typeValue);
  gps.start();
  gps.sendActivityUpdate(true);
}

function pauseActivity() {
  if (tracker.pauseActivity()) {
    gps.sendActivityUpdate(true);
  }
}

function resumeActivity() {
  if (tracker.resumeActivity(gps.getLatestPosition())) {
    gps.sendActivityUpdate(true);
  }
}

function finishActivity() {
  var finishedActivity =
      tracker.finishActivity(gps.getLatestPosition());
  var saved;
  if (!finishedActivity) {
    return;
  }

  saved = store.saveActivity(finishedActivity);
  sendMessage({
    SUMMARY_DISTANCE_M: finishedActivity.summaryDistanceM,
    SUMMARY_MOVING_S: finishedActivity.movingTimeS,
    SUMMARY_POINTS: finishedActivity.points.length,
    ACTIVITY_ID: finishedActivity.id
  },
  saved ? 'Activity saved' : 'Activity summary sent',
  'Activity summary send failed');

  if (saved) {
    strava.maybeUpload(finishedActivity);
  }
  gps.stopIfIdle();
}

function openConfiguration(notice) {
  Pebble.openURL(ConfigPage.buildConfigUrl(
    store.getSettings(),
    store.activitySummaries(),
    notice || ''
  ));
}

function openAfterConfigClose(url) {
  setTimeout(function() {
    Pebble.openURL(url);
  }, 250);
}

function reopenConfiguration(notice) {
  setTimeout(function() {
    openConfiguration(notice);
  }, 250);
}

function exportActivityTcx(activityId) {
  var activity = store.getActivity(activityId);
  var tcx;
  if (!activity) {
    log('TCX export failed: activity not found');
    return {
      ok: false,
      message: 'TCX export failed: activity not found.'
    };
  }

  tcx = Strava.generateTcx(activity);
  openAfterConfigClose(ConfigPage.buildExportUrl(activity, tcx));
  return {
    ok: true,
    message: 'TCX export opened.'
  };
}

function retryStravaUpload(activityId) {
  var activity = store.getActivity(activityId);
  var result = strava.retryActivity(activity);
  if (!activity) {
    log(result.message);
  }
  return result;
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
        reopenConfiguration(
          authErr.message +
          '. Authorization codes are short-lived and single-use; generate a fresh code and try again.'
        );
      }
    } else if (hadAuthorizationCode &&
        currentSettings.stravaRefreshToken) {
      log('Strava authorization ready');
      reopenConfiguration(
        'Strava connected. The refresh token was saved and the one-time authorization code was cleared.'
      );
    }
  });
}

function handleConfigPayload(payload) {
  var actionResult;

  if (payload.action === 'export_tcx') {
    actionResult = exportActivityTcx(payload.activityId);
    if (!actionResult.ok) {
      reopenConfiguration(actionResult.message);
    }
    return;
  }
  if (payload.action === 'retry_strava') {
    actionResult = retryStravaUpload(payload.activityId);
    reopenConfiguration(actionResult.message);
    return;
  }
  if (payload.action && payload.action !== 'save_settings') {
    reopenConfiguration(
      'Unknown configuration action: ' + payload.action
    );
    return;
  }
  if (!hasSettingsPayload(payload)) {
    reopenConfiguration(
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
  if (payload.REQUEST_SETTINGS) {
    sendSettingsToWatch();
  }
  if (payload.START_ACTIVITY) {
    startActivity(payload.ACTIVITY_TYPE);
  }
  if (payload.PAUSE_ACTIVITY) {
    pauseActivity();
  }
  if (payload.RESUME_ACTIVITY) {
    resumeActivity();
  }
  if (payload.FINISH_ACTIVITY) {
    finishActivity();
  }
  if (typeof payload.HR_BPM !== 'undefined') {
    tracker.recordHr(payload.HR_BPM);
  }
}

Pebble.addEventListener('ready', function() {
  log('Pacelet ready');
  sendSettingsToWatch();
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
    handleConfigPayload(payload);
  } catch (err) {
    log('Config parse failed: ' + err);
  }
});

Pebble.addEventListener('appmessage', function(event) {
  handleAppMessage(event.payload || {});
});
