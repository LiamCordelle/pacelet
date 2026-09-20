// Keep all-time counters and a bounded trail of decisions, never credentials.
var MAX_EVENTS = 64;
var FILTER_VERSION = 2;

function create(version) {
  return { filterVersion: FILTER_VERSION, appVersion: version || '',
    counts: {}, events: [], droppedEvents: 0 };
}

function record(activity, reason, at, point) {
  if (!activity || activity.paused || !activity.gpsDiagnostics) {
    return;
  }
  var diagnostics = activity.gpsDiagnostics;
  diagnostics.counts[reason] = (diagnostics.counts[reason] || 0) + 1;
  // Routine accepted/thinned points already have per-point metadata.
  if (reason === 'accepted' || reason === 'interval' || reason === 'duplicate') {
    return;
  }
  var event = { t: at, reason: reason };
  if (point) {
    if (isFinite(point.lat) && isFinite(point.lon)) {
      event.lat = Math.round(point.lat * 1000000) / 1000000;
      event.lon = Math.round(point.lon * 1000000) / 1000000;
    }
    if (isFinite(point.accuracy)) {
      event.acc = Math.round(point.accuracy);
    }
    if (isFinite(point.timestamp)) {
      event.ageMs = Math.round(at - point.timestamp);
    }
  }
  var previous = diagnostics.events[diagnostics.events.length - 1];
  if (previous && previous.reason === reason) {
    event.firstAt = previous.firstAt || previous.t;
    event.n = (previous.n || 1) + 1;
    diagnostics.events[diagnostics.events.length - 1] = event;
  } else {
    diagnostics.events.push(event);
    if (diagnostics.events.length > MAX_EVENTS) {
      diagnostics.events.shift();
      diagnostics.droppedEvents += 1;
    }
  }
}

module.exports = { create: create, record: record, MAX_EVENTS: MAX_EVENTS };
