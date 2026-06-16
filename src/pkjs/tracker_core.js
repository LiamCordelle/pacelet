var LOCK_ACCURACY_M = 25;
var TRACK_ACCURACY_M = 60;
var MIN_POINT_INTERVAL_MS = 5000;
var MIN_POINT_DISTANCE_M = 5;
var SPEED_WINDOW_MS = 10000;
var SPEED_EMA_ALPHA = 0.35;
var SPEED_DECEL_EMA_ALPHA = 0.75;
var FOOT_STOP_SPEED_CENTI_MPS = 35;
var CYCLING_STOP_SPEED_CENTI_MPS = 100;

var ACTIVITY_TYPES = ['walking', 'running', 'cycling'];

function defaultNowMs() {
  return Date.now ? Date.now() : new Date().getTime();
}

function toRad(value) {
  return value * Math.PI / 180;
}

function haversineMeters(a, b) {
  var earthM = 6371000;
  var dLat = toRad(b.lat - a.lat);
  var dLon = toRad(b.lon - a.lon);
  var lat1 = toRad(a.lat);
  var lat2 = toRad(b.lat);
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function activityTypeName(value) {
  var index = parseInt(value, 10);
  if (isNaN(index) || index < 0 || index >= ACTIVITY_TYPES.length) {
    return 'running';
  }
  return ACTIVITY_TYPES[index];
}

function canStartFromPosition(position) {
  return !!position && position.accuracy <= LOCK_ACCURACY_M;
}

function normalizePoint(point, nowFn) {
  return {
    lat: point.lat,
    lon: point.lon,
    accuracy: typeof point.accuracy === 'number' ? point.accuracy : 9999,
    altitude: point.altitude,
    timestamp: point.timestamp || nowFn()
  };
}

function movingTimeMs(activity, atMs) {
  var end = activity.finishedAt || atMs || defaultNowMs();
  var pausedMs = activity.pausedMs;
  if (activity.paused && activity.pausedAt) {
    pausedMs += end - activity.pausedAt;
  }
  return Math.max(0, end - activity.startedAt - pausedMs);
}

function shouldAcceptPoint(activity, point) {
  if (point.accuracy > TRACK_ACCURACY_M) {
    return false;
  }
  if (!activity.lastPoint) {
    return true;
  }

  var dt = point.timestamp - activity.lastPoint.t;
  var distance = haversineMeters(activity.lastPoint, point);
  return dt >= MIN_POINT_INTERVAL_MS || distance >= MIN_POINT_DISTANCE_M;
}

function speedFromWindow(points) {
  if (points.length < 2) {
    return null;
  }

  var first = points[0];
  var last = points[points.length - 1];
  var seconds = (last.t - first.t) / 1000;
  if (seconds < 3) {
    return null;
  }

  var distance = 0;
  for (var i = 1; i < points.length; i += 1) {
    distance += haversineMeters(points[i - 1], points[i]);
  }

  if (distance < 1) {
    return 0;
  }
  return distance / seconds;
}

function recentLegSpeedCentiMps(points) {
  if (points.length < 2) {
    return null;
  }

  var previous = points[points.length - 2];
  var latest = points[points.length - 1];
  var seconds = (latest.t - previous.t) / 1000;
  if (seconds <= 0) {
    return null;
  }

  var distance = haversineMeters(previous, latest);
  if (distance < 1) {
    return 0;
  }
  return Math.round((distance / seconds) * 100);
}

function stopSpeedCentiMpsForActivity(activity) {
  return activity.type === 'cycling' ?
      CYCLING_STOP_SPEED_CENTI_MPS : FOOT_STOP_SPEED_CENTI_MPS;
}

function updateSpeedWindow(activity, point) {
  activity.speedWindow.push(point);

  var cutoff = point.t - SPEED_WINDOW_MS;
  while (activity.speedWindow.length > 2 &&
      activity.speedWindow[1].t < cutoff) {
    activity.speedWindow.shift();
  }

  var rawMps = speedFromWindow(activity.speedWindow);
  if (rawMps === null) {
    return;
  }

  var rawCentiMps = Math.round(rawMps * 100);
  var recentCentiMps = recentLegSpeedCentiMps(activity.speedWindow);
  var stopSpeedCentiMps = stopSpeedCentiMpsForActivity(activity);
  if (rawCentiMps <= stopSpeedCentiMps ||
      (recentCentiMps !== null && recentCentiMps <= stopSpeedCentiMps)) {
    activity.smoothedSpeedCentiMps = 0;
    return;
  }

  if (activity.smoothedSpeedCentiMps <= 0) {
    activity.smoothedSpeedCentiMps = rawCentiMps;
  } else {
    var alpha = rawCentiMps < activity.smoothedSpeedCentiMps ?
        SPEED_DECEL_EMA_ALPHA : SPEED_EMA_ALPHA;
    activity.smoothedSpeedCentiMps = Math.round(
      (activity.smoothedSpeedCentiMps * (1 - alpha)) +
      (rawCentiMps * alpha)
    );
  }
}

function compressPoint(point, currentHrBpm) {
  return {
    t: point.timestamp,
    lat: point.lat,
    lon: point.lon,
    acc: Math.round(point.accuracy),
    alt: typeof point.altitude === 'number' ? Math.round(point.altitude) : null,
    hr: currentHrBpm || null
  };
}

function recordPoint(activity, point, currentHrBpm) {
  if (!shouldAcceptPoint(activity, point)) {
    return false;
  }

  var compressed = compressPoint(point, currentHrBpm);
  if (activity.lastPoint) {
    activity.distanceM += haversineMeters(activity.lastPoint, compressed);
  }
  activity.points.push(compressed);
  activity.lastPoint = compressed;
  updateSpeedWindow(activity, compressed);
  return true;
}

function metricsFromActivity(activity, atMs) {
  var movingS = Math.max(1, Math.round(movingTimeMs(activity, atMs) / 1000));
  var speedCentiMps = activity.smoothedSpeedCentiMps || 0;
  var paceSPerKm = speedCentiMps > 0 ?
      Math.round(100000 / speedCentiMps) : 0;

  return {
    distanceM: Math.round(activity.distanceM),
    movingS: movingS,
    currentPaceSPerKm: paceSPerKm,
    currentSpeedCentiMps: speedCentiMps,
    points: activity.points.length
  };
}

function createTrackerCore(options) {
  options = options || {};
  var nowFn = options.nowMs || defaultNowMs;
  var currentHrBpm = 0;
  var activeActivity = null;

  function now() {
    return nowFn();
  }

  function startActivity(position, typeValue) {
    if (!canStartFromPosition(position)) {
      return null;
    }

    activeActivity = {
      id: 'pt-' + now(),
      type: activityTypeName(typeValue),
      startedAt: now(),
      paused: false,
      pausedAt: 0,
      pausedMs: 0,
      distanceM: 0,
      points: [],
      lastPoint: null,
      speedWindow: [],
      smoothedSpeedCentiMps: 0,
      hrSamples: []
    };

    recordPoint(activeActivity, normalizePoint(position, now), currentHrBpm);
    return activeActivity;
  }

  function recordPosition(position) {
    if (!activeActivity || activeActivity.paused) {
      return false;
    }
    return recordPoint(activeActivity, normalizePoint(position, now), currentHrBpm);
  }

  function pauseActivity() {
    if (!activeActivity || activeActivity.paused) {
      return false;
    }
    activeActivity.paused = true;
    activeActivity.pausedAt = now();
    return true;
  }

  function resumeActivity(position) {
    if (!activeActivity || !activeActivity.paused) {
      return false;
    }
    activeActivity.pausedMs += now() - activeActivity.pausedAt;
    activeActivity.paused = false;
    activeActivity.pausedAt = 0;
    activeActivity.lastPoint = null;
    activeActivity.speedWindow = [];
    activeActivity.smoothedSpeedCentiMps = 0;

    if (position && position.accuracy <= TRACK_ACCURACY_M) {
      recordPoint(activeActivity, normalizePoint(position, now), currentHrBpm);
    }
    return true;
  }

  function finishActivity(position) {
    if (!activeActivity) {
      return null;
    }

    if (!activeActivity.paused && position &&
        position.accuracy <= TRACK_ACCURACY_M) {
      recordPoint(activeActivity, normalizePoint(position, now), currentHrBpm);
    }

    activeActivity.finishedAt = now();
    activeActivity.movingTimeS = Math.round(
      movingTimeMs(activeActivity, activeActivity.finishedAt) / 1000
    );
    activeActivity.summaryDistanceM = Math.round(activeActivity.distanceM);
    activeActivity.summarySpeedCentiMps = activeActivity.smoothedSpeedCentiMps || 0;

    var finished = activeActivity;
    activeActivity = null;
    return finished;
  }

  function recordHr(value) {
    var bpm = parseInt(value, 10);
    if (isNaN(bpm) || bpm <= 0 || bpm > 250) {
      return false;
    }

    currentHrBpm = bpm;
    if (activeActivity && !activeActivity.paused) {
      activeActivity.hrSamples.push({
        t: now(),
        bpm: bpm
      });

      if (activeActivity.lastPoint) {
        activeActivity.lastPoint.hr = bpm;
      }
    }
    return true;
  }

  function getMetrics() {
    if (!activeActivity) {
      return null;
    }
    return metricsFromActivity(activeActivity, now());
  }

  return {
    startActivity: startActivity,
    recordPosition: recordPosition,
    pauseActivity: pauseActivity,
    resumeActivity: resumeActivity,
    finishActivity: finishActivity,
    recordHr: recordHr,
    getMetrics: getMetrics,
    getActiveActivity: function() {
      return activeActivity;
    },
    canStartFromPosition: canStartFromPosition
  };
}

module.exports = {
  constants: {
    LOCK_ACCURACY_M: LOCK_ACCURACY_M,
    TRACK_ACCURACY_M: TRACK_ACCURACY_M,
    MIN_POINT_INTERVAL_MS: MIN_POINT_INTERVAL_MS,
    MIN_POINT_DISTANCE_M: MIN_POINT_DISTANCE_M,
    SPEED_WINDOW_MS: SPEED_WINDOW_MS,
    ACTIVITY_TYPES: ACTIVITY_TYPES
  },
  activityTypeName: activityTypeName,
  canStartFromPosition: canStartFromPosition,
  createTrackerCore: createTrackerCore,
  haversineMeters: haversineMeters,
  metricsFromActivity: metricsFromActivity,
  movingTimeMs: movingTimeMs
};
