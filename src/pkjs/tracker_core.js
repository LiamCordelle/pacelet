var GpsDiagnostics = require('./gps_diagnostics');

var LOCK_ACCURACY_M = 25;
var TRACK_ACCURACY_M = 60;
var MIN_POINT_INTERVAL_MS = 5000;
var MIN_POINT_DISTANCE_M = 5;
var MAX_WALKING_SPEED_MPS = 3.5;
var MAX_RUNNING_SPEED_MPS = 8;
var MAX_CYCLING_SPEED_MPS = 25;
var SPEED_WINDOW_MS = 10000;
var MAX_FIX_AGE_MS = 15000;
var GPS_GAP_MS = 20000;
var RECOVERY_ACCURACY_M = 35;
var RECOVERY_FIX_COUNT = 3;
var RECOVERY_SPAN_MS = 4000;
var SPEED_EMA_ALPHA = 0.35;
var SPEED_DECEL_EMA_ALPHA = 0.75;
var FOOT_STOP_SPEED_CENTI_MPS = 35;
var CYCLING_STOP_SPEED_CENTI_MPS = 100;
var DEFAULT_HR_ZONE_THRESHOLDS = [100, 130, 160];
var MAX_HR_SAMPLE_GAP_MS = 5000;

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

function activityTypeValue(value) {
  var index = ACTIVITY_TYPES.indexOf(value);
  return index >= 0 ? index : 1;
}

function validPosition(position) {
  return !!position && typeof position.lat === 'number' &&
      isFinite(position.lat) && Math.abs(position.lat) <= 90 &&
      typeof position.lon === 'number' && isFinite(position.lon) &&
      Math.abs(position.lon) <= 180 &&
      typeof position.accuracy === 'number' &&
      isFinite(position.accuracy) && position.accuracy >= 0 &&
      typeof position.timestamp === 'number' && isFinite(position.timestamp);
}

function freshPosition(position, atMs) {
  return validPosition(position) && (typeof atMs !== 'number' ||
      (atMs - position.timestamp <= MAX_FIX_AGE_MS &&
       position.timestamp - atMs <= 1000));
}

function canStartFromPosition(position, atMs) {
  return freshPosition(position, atMs) && position.accuracy <= LOCK_ACCURACY_M;
}

function maxReasonableSpeedMpsForActivity(activity) {
  if (activity.type === 'cycling') {
    return MAX_CYCLING_SPEED_MPS;
  }
  if (activity.type === 'walking') {
    return MAX_WALKING_SPEED_MPS;
  }
  return MAX_RUNNING_SPEED_MPS;
}

function normalizePoint(point, nowFn) {
  return {
    lat: point.lat,
    lon: point.lon,
    accuracy: typeof point.accuracy === 'number' ? point.accuracy : 9999,
    altitude: point.altitude,
    timestamp: typeof point.timestamp === 'number' ? point.timestamp : nowFn()
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

function rawPoint(point) {
  return { lat: typeof point.rawLat === 'number' ? point.rawLat : point.lat,
    lon: typeof point.rawLon === 'number' ? point.rawLon : point.lon };
}

function resetGpsSegment(activity) {
  activity.lastPoint = null;
  activity.speedWindow = [];
  activity.smoothedSpeedCentiMps = 0;
  activity.recoveryPoints = [];
}

function plausibleLeg(activity, previous, point) {
  var dt = point.timestamp - previous.timestamp;
  return dt > 0 && dt < GPS_GAP_MS &&
      haversineMeters(previous, point) / (dt / 1000) <=
      maxReasonableSpeedMpsForActivity(activity);
}

// Quarantine suspect fixes until a coherent short sequence establishes a
// new anchor. The old-to-new jump is deliberately excluded from distance.
function recoverGps(activity, point, currentHrBpm, atMs) {
  var candidates = activity.recoveryPoints;
  if (candidates.length && !plausibleLeg(activity,
      candidates[candidates.length - 1], point)) {
    candidates = [];
  }
  candidates.push(point);
  // Usable but weaker urban fixes can still recover. Give them more time to
  // agree instead of permanently requiring open-sky accuracy after a gap.
  var weak = candidates.some(function(candidate) {
    return candidate.accuracy > RECOVERY_ACCURACY_M;
  });
  var count = weak ? 5 : RECOVERY_FIX_COUNT;
  var span = weak ? 8000 : RECOVERY_SPAN_MS;
  // A bounded window also prevents a burst of callbacks satisfying the
  // confirmation count without covering enough time.
  while (candidates.length > count &&
      point.timestamp - candidates[1].timestamp >= span) {
    candidates.shift();
  }
  if (candidates.length > 12) {
    candidates.splice(1, 1);
  }
  activity.recoveryPoints = candidates;
  if (candidates.length < count ||
      point.timestamp - candidates[0].timestamp < span) {
    GpsDiagnostics.record(activity, 'recovery_wait', atMs, point);
    return false;
  }
  resetGpsSegment(activity);
  for (var i = 0; i < candidates.length; i += 1) {
    appendPoint(activity, candidates[i], currentHrBpm);
  }
  GpsDiagnostics.record(activity, 'recovered', atMs, point);
  return true;
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

  // Net displacement over the window avoids counting every GPS zigzag
  // as extra live speed. Distance still follows the filtered route.
  var distance = haversineMeters(first, last);

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

function appendPoint(activity, point, currentHrBpm) {
  var compressed = compressPoint(point, currentHrBpm);
  var previous = activity.lastPoint;
  if (previous) {
    var dt = (point.timestamp - previous.t) / 1000;
    var movement = haversineMeters(previous, compressed);
    var deadband = Math.max(2, Math.min(8,
        Math.min(previous.acc, point.accuracy) * 0.5));
    if (movement <= deadband) {
      compressed.lat = previous.lat;
      compressed.lon = previous.lon;
    } else if (point.accuracy > 10) {
      // Up to three seconds of position smoothing as uncertainty grows;
      // good fixes and sparse samples retain their responsiveness.
      var tau = Math.min(3, (point.accuracy - 10) / 3);
      var gain = 1 - Math.exp(-dt / tau);
      compressed.lat = previous.lat + gain * (point.lat - previous.lat);
      var dLon = ((point.lon - previous.lon + 540) % 360) - 180;
      compressed.lon = ((previous.lon + gain * dLon + 540) % 360) - 180;
    }
    if (compressed.lat !== point.lat || compressed.lon !== point.lon) {
      compressed.rawLat = point.lat;
      compressed.rawLon = point.lon;
    }
    activity.distanceM += haversineMeters(previous, compressed);
  } else if (activity.points.length) {
    compressed.segmentStart = true;
  }
  compressed.distanceM = activity.distanceM;
  activity.points.push(compressed);
  activity.lastPoint = compressed;
  updateSpeedWindow(activity, compressed);
  GpsDiagnostics.record(activity, 'accepted', point.timestamp);
}

function recordPoint(activity, point, currentHrBpm, atMs) {
  var reason = !validPosition(point) ? 'invalid' :
      (!freshPosition(point, atMs) ? 'stale' :
       (point.accuracy > TRACK_ACCURACY_M ? 'accuracy' : ''));
  if (reason) {
    activity.recoveryPoints = [];
    GpsDiagnostics.record(activity, reason, atMs, point);
    return false;
  }
  if (activity.lastFixAt !== null && point.timestamp <= activity.lastFixAt) {
    GpsDiagnostics.record(activity, 'duplicate', atMs, point);
    return false;
  }
  activity.lastFixAt = point.timestamp;
  var previous = activity.lastPoint;
  if (previous) {
    var dt = point.timestamp - previous.t;
    if (dt >= GPS_GAP_MS) {
      if (!activity.recoveryPoints.length) {
        GpsDiagnostics.record(activity, 'gap', atMs, point);
      }
      return recoverGps(activity, point, currentHrBpm, atMs);
    }
    var distance = haversineMeters(rawPoint(previous), point);
    var maxSpeed = maxReasonableSpeedMpsForActivity(activity);
    var recentSpeed = activity.smoothedSpeedCentiMps / 100;
    if (point.accuracy > LOCK_ACCURACY_M && recentSpeed > 0) {
      maxSpeed = Math.min(maxSpeed, Math.max(recentSpeed * 2, recentSpeed + 2.5));
    }
    if (dt <= 0 || distance / (dt / 1000) > maxSpeed) {
      GpsDiagnostics.record(activity, 'speed', atMs, point);
      return recoverGps(activity, point, currentHrBpm, atMs);
    }
    if (dt < MIN_POINT_INTERVAL_MS &&
        haversineMeters(previous, point) < MIN_POINT_DISTANCE_M) {
      GpsDiagnostics.record(activity, 'interval', atMs, point);
      return false;
    }
  }
  activity.recoveryPoints = [];
  appendPoint(activity, point, currentHrBpm);
  return true;
}

function metricsFromActivity(activity, atMs) {
  var movingS = Math.max(1, Math.round(movingTimeMs(activity, atMs) / 1000));
  var stale = !activity.lastPoint || atMs - activity.lastPoint.t >= GPS_GAP_MS;
  var speedCentiMps = activity.paused || stale ? 0 :
      (activity.smoothedSpeedCentiMps || 0);
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

function normalizeHrZoneThresholds(value) {
  var thresholds = value || DEFAULT_HR_ZONE_THRESHOLDS;
  var zone1 = parseInt(thresholds[0], 10);
  var zone2 = parseInt(thresholds[1], 10);
  var zone3 = parseInt(thresholds[2], 10);

  zone1 = isNaN(zone1) ? DEFAULT_HR_ZONE_THRESHOLDS[0] : zone1;
  zone2 = isNaN(zone2) ? DEFAULT_HR_ZONE_THRESHOLDS[1] : zone2;
  zone3 = isNaN(zone3) ? DEFAULT_HR_ZONE_THRESHOLDS[2] : zone3;

  zone1 = Math.max(40, Math.min(220, zone1));
  zone2 = Math.max(zone1 + 1, Math.min(230, zone2));
  zone3 = Math.max(zone2 + 1, Math.min(240, zone3));
  return [zone1, zone2, zone3];
}

function hrZoneForBpm(bpm, thresholds) {
  thresholds = normalizeHrZoneThresholds(thresholds);
  if (bpm < thresholds[0]) {
    return 0;
  }
  if (bpm < thresholds[1]) {
    return 1;
  }
  if (bpm < thresholds[2]) {
    return 2;
  }
  return 3;
}

function summarizeHeartRate(samples, endMs, thresholds) {
  var zoneTimeMs = [0, 0, 0, 0];
  var sum = 0;
  var count = 0;
  var i;

  samples = samples || [];
  thresholds = normalizeHrZoneThresholds(thresholds);
  for (i = 0; i < samples.length; i += 1) {
    var sample = samples[i];
    var nextTime = i + 1 < samples.length ? samples[i + 1].t : endMs;
    var durationMs = Math.max(0, Math.min(
      MAX_HR_SAMPLE_GAP_MS,
      (nextTime || sample.t) - sample.t
    ));
    var zone = hrZoneForBpm(sample.bpm, thresholds);

    sum += sample.bpm;
    count += 1;
    zoneTimeMs[zone] += durationMs;
  }

  return {
    avgHrBpm: count ? Math.round(sum / count) : 0,
    hrZoneTimeS: zoneTimeMs.map(function(value) {
      return Math.round(value / 1000);
    })
  };
}

function createTrackerCore(options) {
  options = options || {};
  var nowFn = options.nowMs || defaultNowMs;
  var hrZoneThresholds = normalizeHrZoneThresholds(
    options.hrZoneThresholds);
  var currentHrBpm = 0;
  var activeActivity = null;

  function now() {
    return nowFn();
  }

  function startActivity(position, typeValue) {
    if (activeActivity || !canStartFromPosition(position, now())) {
      return null;
    }

    currentHrBpm = 0;
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
      lastFixAt: null,
      recoveryPoints: [],
      gpsDiagnostics: GpsDiagnostics.create(options.appVersion),
      speedWindow: [],
      smoothedSpeedCentiMps: 0,
      hrSamples: [],
      hrZoneThresholds: hrZoneThresholds.slice()
    };

    recordPoint(activeActivity, normalizePoint(position, now), currentHrBpm, now());
    return activeActivity;
  }

  function restoreActivity(snapshot, checkpointedAt) {
    var startedAt;
    var checkpoint;
    var restored;
    var points;
    var hrSamples;

    if (activeActivity || !snapshot || typeof snapshot.id !== 'string' ||
        !snapshot.id || ACTIVITY_TYPES.indexOf(snapshot.type) < 0 ||
        !Array.isArray(snapshot.points) ||
        !Array.isArray(snapshot.hrSamples)) {
      return null;
    }

    startedAt = Number(snapshot.startedAt);
    checkpoint = Number(checkpointedAt);
    if (!isFinite(startedAt) || startedAt <= 0 ||
        !isFinite(checkpoint) || checkpoint < startedAt) {
      return null;
    }

    points = snapshot.points.filter(function(point) {
      return point && isFinite(Number(point.t)) &&
          isFinite(Number(point.lat)) && isFinite(Number(point.lon));
    }).map(function(point) {
      return {
        t: Number(point.t),
        lat: Number(point.lat),
        lon: Number(point.lon),
        acc: isFinite(Number(point.acc)) ? Number(point.acc) : 9999,
        alt: typeof point.alt === 'number' ? point.alt : null,
        hr: typeof point.hr === 'number' ? point.hr : null,
        distanceM: typeof point.distanceM === 'number' ? point.distanceM : undefined,
        segmentStart: !!point.segmentStart,
        rawLat: typeof point.rawLat === 'number' ? point.rawLat : undefined,
        rawLon: typeof point.rawLon === 'number' ? point.rawLon : undefined
      };
    });
    hrSamples = snapshot.hrSamples.filter(function(sample) {
      return sample && isFinite(Number(sample.t)) &&
          isFinite(Number(sample.bpm)) && Number(sample.bpm) > 0 &&
          Number(sample.bpm) <= 250;
    }).map(function(sample) {
      return { t: Number(sample.t), bpm: Number(sample.bpm) };
    });

    restored = {
      id: snapshot.id,
      type: snapshot.type,
      startedAt: startedAt,
      paused: true,
      pausedAt: snapshot.paused && Number(snapshot.pausedAt) >= startedAt ?
        Number(snapshot.pausedAt) : checkpoint,
      pausedMs: Math.max(0, Number(snapshot.pausedMs) || 0),
      distanceM: Math.max(0, Number(snapshot.distanceM) || 0),
      points: points,
      lastPoint: points.length ? points[points.length - 1] : null,
      lastFixAt: null,
      recoveryPoints: [],
      gpsDiagnostics: snapshot.gpsDiagnostics &&
          snapshot.gpsDiagnostics.counts && Array.isArray(snapshot.gpsDiagnostics.events) ?
          JSON.parse(JSON.stringify(snapshot.gpsDiagnostics)) :
          GpsDiagnostics.create(options.appVersion),
      speedWindow: [],
      smoothedSpeedCentiMps: 0,
      hrSamples: hrSamples,
      hrZoneThresholds: normalizeHrZoneThresholds(
        snapshot.hrZoneThresholds || hrZoneThresholds)
    };

    currentHrBpm = 0;
    activeActivity = restored;
    return activeActivity;
  }

  function discardActivity(activityId) {
    if (!activeActivity ||
        (activityId && activeActivity.id !== activityId)) {
      return false;
    }
    activeActivity = null;
    currentHrBpm = 0;
    return true;
  }

  function recordPosition(position) {
    if (!activeActivity || activeActivity.paused) {
      return false;
    }
    return recordPoint(activeActivity, normalizePoint(position, now), currentHrBpm, now());
  }

  function pauseActivity() {
    if (!activeActivity || activeActivity.paused) {
      return false;
    }
    GpsDiagnostics.record(activeActivity, 'pause', now());
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
    GpsDiagnostics.record(activeActivity, 'resume', now());
    resetGpsSegment(activeActivity);
    activeActivity.lastFixAt = null;

    if (position && position.accuracy <= TRACK_ACCURACY_M) {
      recordPoint(activeActivity, normalizePoint(position, now), currentHrBpm, now());
    }
    return true;
  }

  function finishActivity(position) {
    if (!activeActivity) {
      return null;
    }

    if (!activeActivity.paused && position &&
        position.accuracy <= TRACK_ACCURACY_M) {
      recordPoint(activeActivity, normalizePoint(position, now), currentHrBpm, now());
    }

    activeActivity.finishedAt = now();
    activeActivity.movingTimeS = Math.round(
      movingTimeMs(activeActivity, activeActivity.finishedAt) / 1000
    );
    activeActivity.summaryDistanceM = Math.round(activeActivity.distanceM);
    activeActivity.summarySpeedCentiMps = activeActivity.smoothedSpeedCentiMps || 0;
    var hrSummary = summarizeHeartRate(
      activeActivity.hrSamples,
      activeActivity.finishedAt,
      activeActivity.hrZoneThresholds
    );
    activeActivity.avgHrBpm = hrSummary.avgHrBpm;
    activeActivity.hrZoneTimeS = hrSummary.hrZoneTimeS;

    var finished = activeActivity;
    activeActivity = null;
    return finished;
  }

  function recordHr(value) {
    var bpm = parseInt(value, 10);
    if (isNaN(bpm) || bpm < 0 || bpm > 250) {
      return false;
    }

    currentHrBpm = bpm;
    if (bpm === 0) {
      return true;
    }
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
    restoreActivity: restoreActivity,
    discardActivity: discardActivity,
    recordPosition: recordPosition,
    pauseActivity: pauseActivity,
    resumeActivity: resumeActivity,
    finishActivity: finishActivity,
    recordHr: recordHr,
    setHrZoneThresholds: function(value) {
      hrZoneThresholds = normalizeHrZoneThresholds(value);
    },
    getMetrics: getMetrics,
    getActiveActivity: function() {
      return activeActivity;
    },
    canStartFromPosition: function(position) {
      return canStartFromPosition(position, now());
    },
    recordGpsEvent: function(reason, position) {
      GpsDiagnostics.record(activeActivity, reason, now(), position);
    }
  };
}

module.exports = {
  constants: {
    LOCK_ACCURACY_M: LOCK_ACCURACY_M,
    TRACK_ACCURACY_M: TRACK_ACCURACY_M,
    MIN_POINT_INTERVAL_MS: MIN_POINT_INTERVAL_MS,
    MIN_POINT_DISTANCE_M: MIN_POINT_DISTANCE_M,
    MAX_WALKING_SPEED_MPS: MAX_WALKING_SPEED_MPS,
    MAX_RUNNING_SPEED_MPS: MAX_RUNNING_SPEED_MPS,
    MAX_CYCLING_SPEED_MPS: MAX_CYCLING_SPEED_MPS,
    SPEED_WINDOW_MS: SPEED_WINDOW_MS,
    MAX_FIX_AGE_MS: MAX_FIX_AGE_MS,
    GPS_GAP_MS: GPS_GAP_MS,
    DEFAULT_HR_ZONE_THRESHOLDS: DEFAULT_HR_ZONE_THRESHOLDS,
    ACTIVITY_TYPES: ACTIVITY_TYPES
  },
  activityTypeName: activityTypeName,
  activityTypeValue: activityTypeValue,
  canStartFromPosition: canStartFromPosition,
  createTrackerCore: createTrackerCore,
  haversineMeters: haversineMeters,
  freshPosition: freshPosition,
  hrZoneForBpm: hrZoneForBpm,
  metricsFromActivity: metricsFromActivity,
  movingTimeMs: movingTimeMs,
  normalizeHrZoneThresholds: normalizeHrZoneThresholds,
  summarizeHeartRate: summarizeHeartRate
};
