var TrackerCore = require('./tracker_core');
var RESTART_AFTER_MS = 30000;

function createGpsService(options) {
  options = options || {};

  var geolocation = options.geolocation;
  var tracker = options.tracker;
  var sendMessage = options.sendMessage;
  var lockAccuracyM = options.lockAccuracyM;
  var nowMs = options.nowMs || function() {
    return Date.now ? Date.now() : new Date().getTime();
  };
  var setIntervalFn = options.setIntervalFn || setInterval;
  var clearIntervalFn = options.clearIntervalFn || clearInterval;
  var log = options.log || function() {};
  var onPosition = options.onPosition || function() {};

  var gpsWatchId = null;
  var gpsPollTimer = null;
  var latestPosition = null;
  var latestGpsStatus = 0;
  var latestGpsError = '';
  var lastStatusSentAt = 0;
  var running = false;
  var generation = 0;
  var watchGeneration = 0;
  var pollPending = false;
  var lastFreshAt = 0;
  var lastRestartAt = 0;
  var loggedMissingTimestamp = false;
  var lastRejectedLogAt = null;

  function diagnostic(reason, position) {
    if (tracker.recordGpsEvent) {
      tracker.recordGpsEvent(reason, position);
    }
  }

  function gpsAgeSeconds() {
    if (!latestPosition) {
      return -1;
    }
    return Math.max(
      0,
      Math.round((nowMs() - latestPosition.timestamp) / 1000)
    );
  }

  function makeGpsDictionary() {
    var fresh = latestPosition &&
        TrackerCore.freshPosition(latestPosition, nowMs());
    return {
      GPS_STATUS: latestGpsStatus === 2 && !fresh ? 1 : latestGpsStatus,
      GPS_ACCURACY: latestPosition ?
        Math.round(latestPosition.accuracy) : -1,
      GPS_AGE: gpsAgeSeconds(),
      GPS_ERROR: latestGpsError || (latestPosition && !fresh ? 'GPS stale' : '')
    };
  }

  function sendGpsStatus(force) {
    var timestamp = nowMs();
    if (!force && timestamp - lastStatusSentAt < 2000) {
      return;
    }
    lastStatusSentAt = timestamp;
    sendMessage(
      makeGpsDictionary(), null, 'GPS status send failed'
    );
  }

  function sendActivityUpdate(force) {
    var metrics = tracker.getMetrics();
    var dictionary;
    if (!metrics) {
      return;
    }

    dictionary = makeGpsDictionary();
    dictionary.DISTANCE_M = metrics.distanceM;
    dictionary.CURRENT_PACE = metrics.currentPaceSPerKm;
    dictionary.CURRENT_SPEED = metrics.currentSpeedCentiMps;

    sendMessage(
      dictionary,
      force ? 'Activity update sent' : null,
      'Activity update failed'
    );
  }

  function onLocationSuccess(position) {
    var coords = position && position.coords || {};
    var receivedAt = nowMs();
    var timestamp = position && position.timestamp;
    var missingTimestamp = !!position && typeof timestamp === 'undefined';
    var previousStatus = makeGpsDictionary().GPS_STATUS;
    var accuracy =
        typeof coords.accuracy === 'number' ? coords.accuracy : 9999;

    // The current Pebble phone bridge supplies only coords. Use receipt time
    // only when no timestamp is supplied; never refresh a stale/invalid one.
    var candidate = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy: accuracy,
      altitude: coords.altitude,
      timestamp: missingTimestamp ? receivedAt : timestamp
    };
    if (!TrackerCore.freshPosition(candidate, receivedAt)) {
      diagnostic('stale_or_invalid', candidate);
      if (lastRejectedLogAt === null || receivedAt - lastRejectedLogAt >= 30000) {
        lastRejectedLogAt = receivedAt;
        log('GPS fix rejected: stale_or_invalid; timestampType=' +
          typeof timestamp + '; ageMs=' + (receivedAt - candidate.timestamp) +
          '; accuracyM=' + accuracy);
      }
      return;
    }
    if (latestPosition && candidate.timestamp <= latestPosition.timestamp) {
      diagnostic('duplicate', candidate);
      return;
    }
    if (missingTimestamp && !loggedMissingTimestamp) {
      loggedMissingTimestamp = true;
      log('GPS timestamp missing from phone callback; using receipt time');
    }
    latestPosition = candidate;
    lastFreshAt = receivedAt;
    latestGpsError = '';
    latestGpsStatus = accuracy <= lockAccuracyM ? 2 : 1;

    tracker.recordPosition(latestPosition);
    onPosition(latestPosition);
    // Do not throttle the first lock behind the initial searching message.
    if (previousStatus !== latestGpsStatus) {
      log('GPS status=' + latestGpsStatus + '; accuracyM=' + accuracy);
    }
    sendGpsStatus(previousStatus !== latestGpsStatus);
    sendActivityUpdate(false);
  }

  function onLocationError(error) {
    diagnostic('error_' + (error && error.code || 'unknown'));
    // A failed fallback request must not overwrite a fresh watch fix.
    if (latestPosition && TrackerCore.freshPosition(latestPosition, nowMs())) {
      return;
    }
    latestGpsStatus = 3;
    latestGpsError =
        'GPS error ' + (error && error.code ? error.code : '?');
    log(latestGpsError);
    sendGpsStatus(true);
    sendActivityUpdate(false);
  }

  function requestOneLocation() {
    if (!running || pollPending) {
      return;
    }
    var requestGeneration = generation;
    pollPending = true;
    geolocation.getCurrentPosition(
      function(position) {
        if (!running || requestGeneration !== generation) { return; }
        pollPending = false;
        onLocationSuccess(position);
      },
      function(error) {
        if (!running || requestGeneration !== generation) { return; }
        pollPending = false;
        onLocationError(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 1000
      }
    );
  }

  function startWatch() {
    var requestGeneration = generation;
    var requestWatchGeneration = ++watchGeneration;
    if (geolocation.watchPosition) {
      gpsWatchId = geolocation.watchPosition(function(position) {
        if (running && requestGeneration === generation &&
            requestWatchGeneration === watchGeneration) {
          onLocationSuccess(position);
        }
      }, function(error) {
        if (running && requestGeneration === generation &&
            requestWatchGeneration === watchGeneration) {
          onLocationError(error);
        }
      }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 1000 });
    }
  }

  function poll() {
    if (!running) { return; }
    var timestamp = nowMs();
    if (timestamp - lastFreshAt >= RESTART_AFTER_MS &&
        timestamp - lastRestartAt >= RESTART_AFTER_MS) {
      if (gpsWatchId !== null && geolocation.clearWatch) {
        geolocation.clearWatch(gpsWatchId);
      }
      lastRestartAt = timestamp;
      // Invalidate requests that never called back and retry the acquisition.
      generation += 1;
      pollPending = false;
      diagnostic('watch_restart');
      startWatch();
    }
    sendGpsStatus(false);
    sendActivityUpdate(false);
    requestOneLocation();
  }

  function start() {
    latestGpsStatus = latestPosition &&
        latestPosition.accuracy <= lockAccuracyM ? 2 : 1;
    latestGpsError = '';
    sendGpsStatus(true);

    if (!running) {
      running = true;
      generation += 1;
      lastFreshAt = nowMs();
      lastRestartAt = nowMs();
      startWatch();
    }

    if (gpsPollTimer === null) {
      gpsPollTimer = setIntervalFn(poll, 15000);
    }
    requestOneLocation();
  }

  function stopIfIdle() {
    if (tracker.getActiveActivity()) {
      return;
    }

    running = false;
    generation += 1;
    pollPending = false;

    if (gpsWatchId !== null && geolocation.clearWatch) {
      geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
    if (gpsPollTimer !== null) {
      clearIntervalFn(gpsPollTimer);
      gpsPollTimer = null;
    }
  }

  return {
    start: start,
    stopIfIdle: stopIfIdle,
    sendGpsStatus: sendGpsStatus,
    sendActivityUpdate: sendActivityUpdate,
    getLatestPosition: function() {
      return latestPosition && TrackerCore.freshPosition(latestPosition, nowMs()) ?
          latestPosition : null;
    },
    makeGpsDictionary: makeGpsDictionary
  };
}

module.exports = {
  createGpsService: createGpsService
};
