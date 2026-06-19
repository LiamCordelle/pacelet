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

  var gpsWatchId = null;
  var gpsPollTimer = null;
  var latestPosition = null;
  var latestGpsStatus = 0;
  var latestGpsError = '';
  var lastStatusSentAt = 0;

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
    return {
      GPS_STATUS: latestGpsStatus,
      GPS_ACCURACY: latestPosition ?
        Math.round(latestPosition.accuracy) : -1,
      GPS_AGE: gpsAgeSeconds(),
      GPS_ERROR: latestGpsError
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
    var coords = position.coords || {};
    var accuracy =
        typeof coords.accuracy === 'number' ? coords.accuracy : 9999;

    latestPosition = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy: accuracy,
      altitude: coords.altitude,
      timestamp: position.timestamp || nowMs()
    };
    latestGpsError = '';
    latestGpsStatus = accuracy <= lockAccuracyM ? 2 : 1;

    tracker.recordPosition(latestPosition);
    sendGpsStatus(false);
    sendActivityUpdate(false);
  }

  function onLocationError(error) {
    latestGpsStatus = 3;
    latestGpsError =
        'GPS error ' + (error && error.code ? error.code : '?');
    log(latestGpsError);
    sendGpsStatus(true);
  }

  function requestOneLocation() {
    geolocation.getCurrentPosition(
      onLocationSuccess,
      onLocationError,
      {
        enableHighAccuracy: true,
        timeout: 20000,
        maximumAge: 1000
      }
    );
  }

  function start() {
    latestGpsStatus = latestPosition &&
        latestPosition.accuracy <= lockAccuracyM ? 2 : 1;
    latestGpsError = '';
    sendGpsStatus(true);

    if (gpsWatchId === null && geolocation.watchPosition) {
      gpsWatchId = geolocation.watchPosition(
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
      gpsPollTimer = setIntervalFn(requestOneLocation, 15000);
    }
    requestOneLocation();
  }

  function stopIfIdle() {
    if (tracker.getActiveActivity()) {
      return;
    }

    if (gpsWatchId !== null && geolocation.clearWatch) {
      geolocation.clearWatch(gpsWatchId);
      gpsWatchId = null;
    }
    if (gpsPollTimer) {
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
      return latestPosition;
    },
    makeGpsDictionary: makeGpsDictionary
  };
}

module.exports = {
  createGpsService: createGpsService
};

