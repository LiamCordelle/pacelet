var TrackerCore = require('./tracker_core');
var Strava = require('./strava');
var ConfigPage = require('./config_page');

var LOCK_ACCURACY_M = TrackerCore.constants.LOCK_ACCURACY_M;
var STORAGE_KEY = 'pebbleTrackerActivities';
var SETTINGS_KEY = 'pebbleTrackerSettings';
var MAX_STORED_ACTIVITIES = 10;

var gpsWatchId = null;
var gpsPollTimer = null;
var latestPosition = null;
var latestGpsStatus = 0;
var latestGpsError = '';
var lastStatusSentAt = 0;
var settings = loadSettings();
var tracker = TrackerCore.createTrackerCore({
  hrZoneThresholds: hrZoneThresholdsFromSettings(settings)
});

function nowMs() {
  return Date.now ? Date.now() : new Date().getTime();
}

function gpsAgeSeconds() {
  if (!latestPosition) {
    return -1;
  }
  return Math.max(0, Math.round((nowMs() - latestPosition.timestamp) / 1000));
}

function makeGpsDictionary() {
  var accuracy = latestPosition ? Math.round(latestPosition.accuracy) : -1;
  return {
    GPS_STATUS: latestGpsStatus,
    GPS_ACCURACY: accuracy,
    GPS_AGE: gpsAgeSeconds(),
    GPS_ERROR: latestGpsError
  };
}

function sendMessage(dictionary, successMessage, failureMessage) {
  Pebble.sendAppMessage(dictionary,
    function() {
      if (successMessage) {
        console.log(successMessage);
      }
    },
    function() {
      if (failureMessage) {
        console.log(failureMessage);
      }
    }
  );
}

function sendSettingsToWatch() {
  sendMessage({
    DARK_MODE: settings.darkMode ? 1 : 0,
    HR_ZONE_1_BPM: settings.hrZone1Bpm,
    HR_ZONE_2_BPM: settings.hrZone2Bpm,
    HR_ZONE_3_BPM: settings.hrZone3Bpm
  }, null, 'Settings send failed');
}

function hrZoneThresholdsFromSettings(value) {
  return [
    value.hrZone1Bpm,
    value.hrZone2Bpm,
    value.hrZone3Bpm
  ];
}

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function loadSettings() {
  try {
    var raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return Strava.copyDefaults(JSON.parse(raw));
    }
  } catch (e) {
    console.log('Settings load failed: ' + e);
  }
  return Strava.copyDefaults(null);
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (e) {
    console.log('Settings save failed: ' + e);
    return false;
  }
}

function getStoredActivities() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') || [];
  } catch (e) {
    console.log('Activity history read failed: ' + e);
    return [];
  }
}

function getStoredActivity(activityId) {
  var history = getStoredActivities();
  var i;
  for (i = 0; i < history.length; i += 1) {
    if (history[i].id === activityId) {
      return history[i];
    }
  }
  return null;
}

function activitySummaries() {
  var history = getStoredActivities();
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

function request(options, callback) {
  var xhr = new XMLHttpRequest();
  var headers = options.headers || {};
  var key;

  xhr.onload = function() {
    callback(null, {
      status: xhr.status,
      text: xhr.responseText || ''
    });
  };
  xhr.onerror = function() {
    callback(new Error('Network error'));
  };
  xhr.open(options.method || 'GET', options.url);
  for (key in headers) {
    if (headers.hasOwnProperty(key)) {
      xhr.setRequestHeader(key, headers[key]);
    }
  }
  xhr.send(options.body || null);
}

function stravaHttpError(prefix, response, json) {
  var detail = '';
  var firstError;
  var parts = [];
  json = json || {};

  if (json.message) {
    detail = json.message;
  } else if (json.error) {
    detail = json.error;
  } else if (json.errors && json.errors.length) {
    firstError = json.errors[0] || {};
    if (firstError.resource) {
      parts.push(firstError.resource);
    }
    if (firstError.field) {
      parts.push(firstError.field);
    }
    if (firstError.code) {
      parts.push(firstError.code);
    }
    detail = parts.join(' ');
  }

  return prefix + ': HTTP ' + response.status +
      (detail ? ' - ' + detail : '');
}

function sendGpsStatus(force) {
  var t = nowMs();
  if (!force && t - lastStatusSentAt < 2000) {
    return;
  }
  lastStatusSentAt = t;
  sendMessage(makeGpsDictionary(), null, 'GPS status send failed');
}

function sendActivityUpdate(force) {
  var metrics = tracker.getMetrics();
  if (!metrics) {
    return;
  }

  var dictionary = makeGpsDictionary();
  dictionary.DISTANCE_M = metrics.distanceM;
  dictionary.CURRENT_PACE = metrics.currentPaceSPerKm;
  dictionary.CURRENT_SPEED = metrics.currentSpeedCentiMps;

  sendMessage(dictionary, force ? 'Activity update sent' : null,
    'Activity update failed');
}

function onLocationSuccess(position) {
  var coords = position.coords || {};
  var accuracy = typeof coords.accuracy === 'number' ? coords.accuracy : 9999;

  latestPosition = {
    lat: coords.latitude,
    lon: coords.longitude,
    accuracy: accuracy,
    altitude: coords.altitude,
    timestamp: position.timestamp || nowMs()
  };
  latestGpsError = '';
  latestGpsStatus = accuracy <= LOCK_ACCURACY_M ? 2 : 1;

  tracker.recordPosition(latestPosition);

  sendGpsStatus(false);
  sendActivityUpdate(false);
}

function onLocationError(error) {
  latestGpsStatus = 3;
  latestGpsError = 'GPS error ' + (error && error.code ? error.code : '?');
  console.log(latestGpsError);
  sendGpsStatus(true);
}

function requestOneLocation() {
  navigator.geolocation.getCurrentPosition(
    onLocationSuccess,
    onLocationError,
    {
      enableHighAccuracy: true,
      timeout: 20000,
      maximumAge: 1000
    }
  );
}

function startGpsWatch() {
  latestGpsStatus = latestPosition &&
      latestPosition.accuracy <= LOCK_ACCURACY_M ? 2 : 1;
  latestGpsError = '';
  sendGpsStatus(true);

  if (gpsWatchId === null && navigator.geolocation.watchPosition) {
    gpsWatchId = navigator.geolocation.watchPosition(
      onLocationSuccess,
      onLocationError,
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 1000
      }
    );
  }

  if (!gpsPollTimer) {
    gpsPollTimer = setInterval(requestOneLocation, 15000);
  }

  requestOneLocation();
}

function stopGpsWatchIfIdle() {
  if (tracker.getActiveActivity()) {
    return;
  }

  if (gpsWatchId !== null && navigator.geolocation.clearWatch) {
    navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
  }
  if (gpsPollTimer) {
    clearInterval(gpsPollTimer);
    gpsPollTimer = null;
  }
}

function startActivity(typeValue) {
  if (!tracker.canStartFromPosition(latestPosition)) {
    startGpsWatch();
    sendGpsStatus(true);
    return;
  }

  tracker.startActivity(latestPosition, typeValue);
  startGpsWatch();
  sendActivityUpdate(true);
}

function pauseActivity() {
  if (tracker.pauseActivity()) {
    sendActivityUpdate(true);
  }
}

function resumeActivity() {
  if (tracker.resumeActivity(latestPosition)) {
    sendActivityUpdate(true);
  }
}

function finishActivity() {
  var finishedActivity = tracker.finishActivity(latestPosition);

  if (!finishedActivity) {
    return;
  }

  var saved = saveActivity(finishedActivity);
  var dictionary = {
    SUMMARY_DISTANCE_M: finishedActivity.summaryDistanceM,
    SUMMARY_MOVING_S: finishedActivity.movingTimeS,
    SUMMARY_POINTS: finishedActivity.points.length,
    ACTIVITY_ID: finishedActivity.id
  };
  sendMessage(dictionary,
    saved ? 'Activity saved' : 'Activity summary sent',
    'Activity summary send failed');

  if (saved) {
    maybeUploadToStrava(finishedActivity);
  }

  stopGpsWatchIfIdle();
}

function saveActivity(activity) {
  var history = getStoredActivities();
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

  history.unshift(storedActivity);
  if (history.length > MAX_STORED_ACTIVITIES) {
    history = history.slice(0, MAX_STORED_ACTIVITIES);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch (e2) {
    console.log('Activity history write failed: ' + e2);
    return false;
  }
}

function updateStoredActivity(activityId, patch) {
  var history = getStoredActivities();
  var i;
  var key;

  for (i = 0; i < history.length; i += 1) {
    if (history[i].id === activityId) {
      for (key in patch) {
        if (patch.hasOwnProperty(key)) {
          history[i][key] = patch[key];
        }
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        return true;
      } catch (e2) {
        console.log('Activity history update write failed: ' + e2);
        return false;
      }
    }
  }
  return false;
}

function refreshStravaToken(callback) {
  if (!settings.stravaRefreshToken) {
    callback(new Error('Missing Strava refresh token'));
    return;
  }

  request({
    method: 'POST',
    url: Strava.TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: Strava.refreshTokenBody(settings)
  }, function(err, response) {
    var json;
    if (err) {
      callback(err);
      return;
    }
    json = parseJson(response.text, {});
    if (response.status < 200 || response.status >= 300) {
      callback(new Error(stravaHttpError(
        'Strava token refresh failed', response, json)));
      return;
    }
    settings = Strava.applyTokenResponse(settings, json);
    saveSettings();
    callback(null, settings.stravaAccessToken);
  });
}

function exchangeStravaAuthorizationCode(callback) {
  if (!settings.stravaAuthorizationCode) {
    callback(null);
    return;
  }
  if (!settings.stravaClientId || !settings.stravaClientSecret) {
    callback(new Error('Missing Strava client ID or secret'));
    return;
  }

  request({
    method: 'POST',
    url: Strava.TOKEN_URL,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: Strava.authorizationCodeBody(settings)
  }, function(err, response) {
    var json;
    if (err) {
      callback(err);
      return;
    }
    json = parseJson(response.text, {});
    if (response.status < 200 || response.status >= 300) {
      callback(new Error(stravaHttpError(
        'Strava authorization failed', response, json)));
      return;
    }
    settings = Strava.applyTokenResponse(settings, json);
    saveSettings();
    callback(null);
  });
}

function getStravaAccessToken(callback) {
  if (!Strava.isConfigured(settings)) {
    callback(new Error('Strava is not configured'));
    return;
  }
  if (!Strava.tokenNeedsRefresh(settings)) {
    callback(null, settings.stravaAccessToken);
    return;
  }
  refreshStravaToken(callback);
}

function uploadActivityToStrava(activity) {
  if (!Strava.hasActivityWrite(settings)) {
    updateStoredActivity(activity.id, {
      stravaStatus: 'failed',
      stravaError: 'Missing Strava activity:write scope'
    });
    console.log('Strava upload skipped: missing activity:write scope');
    return;
  }

  updateStoredActivity(activity.id, {
    stravaStatus: 'uploading',
    stravaError: ''
  });

  getStravaAccessToken(function(tokenErr) {
    var upload;
    if (tokenErr) {
      console.log('Strava token error: ' + tokenErr.message);
      updateStoredActivity(activity.id, {
        stravaStatus: 'failed',
        stravaError: tokenErr.message
      });
      return;
    }

    upload = Strava.uploadRequest(activity, settings);
    request({
      method: 'POST',
      url: upload.url,
      headers: upload.headers,
      body: upload.body
    }, function(uploadErr, response) {
      var json;
      if (uploadErr) {
        console.log('Strava upload error: ' + uploadErr.message);
        updateStoredActivity(activity.id, {
          stravaStatus: 'failed',
          stravaError: uploadErr.message
        });
        return;
      }

      json = parseJson(response.text, {});
      if (response.status < 200 || response.status >= 300) {
        updateStoredActivity(activity.id, {
          stravaStatus: 'failed',
          stravaError: stravaHttpError(
            'Strava upload failed', response, json)
        });
        return;
      }

      updateStoredActivity(activity.id, {
        stravaStatus: 'processing',
        stravaUploadId: json.id || json.id_str || '',
        stravaUploadStatus: json.status || ''
      });
      console.log('Strava upload queued: ' + (json.id || json.id_str || '?'));
      if (json.id || json.id_str) {
        pollStravaUpload(activity.id, json.id || json.id_str, 1);
      }
    });
  });
}

function pollStravaUpload(activityId, uploadId, attempt) {
  if (attempt > 10) {
    updateStoredActivity(activityId, {
      stravaStatus: 'processing',
      stravaUploadStatus: 'Timed out waiting for Strava'
    });
    return;
  }

  setTimeout(function() {
    request({
      method: 'GET',
      url: Strava.pollUrl(uploadId),
      headers: {
        Authorization: 'Bearer ' + settings.stravaAccessToken
      }
    }, function(err, response) {
      var json;
      if (err) {
        updateStoredActivity(activityId, {
          stravaStatus: 'processing',
          stravaUploadStatus: err.message
        });
        return;
      }

      json = parseJson(response.text, {});
      if (response.status < 200 || response.status >= 300) {
        updateStoredActivity(activityId, {
          stravaStatus: 'processing',
          stravaUploadStatus: 'Poll HTTP ' + response.status
        });
        return;
      }

      if (json.error) {
        updateStoredActivity(activityId, {
          stravaStatus: 'failed',
          stravaError: json.error,
          stravaUploadStatus: json.status || ''
        });
        return;
      }

      if (json.activity_id) {
        updateStoredActivity(activityId, {
          stravaStatus: 'uploaded',
          stravaActivityId: json.activity_id,
          stravaUploadStatus: json.status || ''
        });
        console.log('Strava activity ready: ' + json.activity_id);
        return;
      }

      updateStoredActivity(activityId, {
        stravaStatus: 'processing',
        stravaUploadStatus: json.status || 'Processing'
      });
      pollStravaUpload(activityId, uploadId, attempt + 1);
    });
  }, 5000);
}

function maybeUploadToStrava(activity) {
  if (!settings.stravaAutoUpload) {
    return;
  }
  if (!Strava.isConfigured(settings)) {
    console.log('Strava auto-upload skipped: not configured');
    updateStoredActivity(activity.id, {
      stravaStatus: 'skipped',
      stravaError: 'Strava not configured'
    });
    return;
  }
  uploadActivityToStrava(activity);
}

function openConfiguration(notice) {
  Pebble.openURL(ConfigPage.buildConfigUrl(
    settings,
    activitySummaries(),
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
  var activity = getStoredActivity(activityId);
  var tcx;
  if (!activity) {
    console.log('TCX export failed: activity not found');
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
  var activity = getStoredActivity(activityId);
  if (!activity) {
    console.log('Strava retry failed: activity not found');
    return {
      ok: false,
      message: 'Strava retry failed: activity not found.'
    };
  }
  if (!settings.stravaEnabled) {
    return {
      ok: false,
      message: 'Enable Strava and save settings before retrying.'
    };
  }
  if (!Strava.isConfigured(settings)) {
    return {
      ok: false,
      message: 'Strava is not connected. Save a fresh authorization code or refresh token first.'
    };
  }
  if (!Strava.hasActivityWrite(settings)) {
    return {
      ok: false,
      message: 'Strava did not grant activity:write. Authorize again with that scope.'
    };
  }
  uploadActivityToStrava(activity);
  return {
    ok: true,
    message: 'Strava retry started. The activity status is now uploading.'
  };
}

function handleConfigPayload(payload) {
  var actionResult;
  var hadAuthorizationCode;
  var hasSettingsPayload;

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
    reopenConfiguration('Unknown configuration action: ' + payload.action);
    return;
  }

  hasSettingsPayload =
      typeof payload.darkMode !== 'undefined' ||
      typeof payload.hrZone1Bpm !== 'undefined' ||
      typeof payload.stravaEnabled !== 'undefined' ||
      typeof payload.stravaClientId !== 'undefined';
  if (!hasSettingsPayload) {
    reopenConfiguration('No settings or activity action was received.');
    return;
  }

  settings = Strava.copyDefaults(payload);
  tracker.setHrZoneThresholds(hrZoneThresholdsFromSettings(settings));
  hadAuthorizationCode = !!settings.stravaAuthorizationCode;
  saveSettings();
  sendSettingsToWatch();
  console.log('Settings saved');
  exchangeStravaAuthorizationCode(function(authErr) {
    if (authErr) {
      console.log(authErr.message);
      if (hadAuthorizationCode) {
        reopenConfiguration(authErr.message +
          '. Authorization codes are short-lived and single-use; generate a fresh code and try again.');
      }
    } else if (hadAuthorizationCode && settings.stravaRefreshToken) {
      console.log('Strava authorization ready');
      reopenConfiguration(
        'Strava connected. The refresh token was saved and the one-time authorization code was cleared.');
    }
  });
}

function recordHr(value) {
  tracker.recordHr(value);
}

Pebble.addEventListener('ready', function() {
  console.log('Pacelet ready');
  sendSettingsToWatch();
});

Pebble.addEventListener('showConfiguration', function() {
  openConfiguration('');
});

Pebble.addEventListener('webviewclosed', function(e) {
  var payload;
  if (!e || !e.response) {
    return;
  }
  try {
    payload = ConfigPage.parseResponse(e.response);
    handleConfigPayload(payload);
  } catch (err) {
    console.log('Config parse failed: ' + err);
  }
});

Pebble.addEventListener('appmessage', function(e) {
  var payload = e.payload || {};

  if (payload.REQUEST_GPS) {
    startGpsWatch();
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
    recordHr(payload.HR_BPM);
  }
});
