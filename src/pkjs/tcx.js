// Self-contained so the phone export page can execute this same generator.
// Keep this function compatible with both PebbleKit JS and the config webview.
function generateTcx(activity) {
  function number(value) { return typeof value === 'number' && isFinite(value); }
  function esc(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }
  function iso(value) { return new Date(value).toISOString(); }
  function time(point) { return number(point.t) ? point.t : point.timestamp || 0; }
  function positioned(point) { return number(point.lat) && number(point.lon); }
  function distance(a, b) {
    if (!positioned(a) || !positioned(b)) { return 0; }
    var rad = Math.PI / 180;
    var h = Math.pow(Math.sin((b.lat - a.lat) * rad / 2), 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) *
      Math.pow(Math.sin((b.lon - a.lon) * rad / 2), 2);
    h = Math.max(0, Math.min(1, h));
    return 12742000 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function element(tag, value, indent) {
    lines.push(indent + '<' + tag + '>' + esc(value) + '</' + tag + '>');
  }
  var points = activity.points || [];
  var start = number(activity.startedAt) ? activity.startedAt :
      (points.length ? time(points[0]) : 0);
  var sport = activity.type === 'cycling' ? 'Biking' :
      (activity.type === 'walking' ? 'Other' : 'Running');
  var total = 0;
  var diagnostics = activity.gpsDiagnostics;
  var lines = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:pacelet="urn:pacelet:tcx:1">',
    '  <Activities>', '    <Activity Sport="' + sport + '">'];
  element('Id', iso(start), '      ');
  lines.push('      <Lap StartTime="' + iso(start) + '">');
  element('TotalTimeSeconds', activity.movingTimeS || 0, '        ');
  element('DistanceMeters', Math.round(number(activity.distanceM) ?
      activity.distanceM : activity.summaryDistanceM || 0), '        ');
  // Required by the TCX v2 schema, even when no calorie estimate is available.
  element('Calories', 0, '        ');
  element('Intensity', 'Active', '        ');
  element('TriggerMethod', 'Manual', '        ');
  for (var i = 0; i < points.length; i += 1) {
    var point = points[i];
    if (i === 0 || point.segmentStart) {
      if (i > 0) { lines.push('        </Track>'); }
      lines.push('        <Track>');
    } else {
      total += distance(points[i - 1], point);
    }
    if (number(point.distanceM)) { total = point.distanceM; }
    lines.push('          <Trackpoint>');
    element('Time', iso(time(point)), '            ');
    if (positioned(point)) {
      lines.push('            <Position>');
      element('LatitudeDegrees', point.lat, '              ');
      element('LongitudeDegrees', point.lon, '              ');
      lines.push('            </Position>');
    }
    var altitude = number(point.alt) ? point.alt : point.altitude;
    if (number(altitude)) { element('AltitudeMeters', altitude, '            '); }
    element('DistanceMeters', Math.round(total), '            ');
    if (number(point.hr) && point.hr > 0) {
      lines.push('            <HeartRateBpm>');
      element('Value', point.hr, '              ');
      lines.push('            </HeartRateBpm>');
    }
    if (number(point.acc) || number(point.rawLat)) {
      lines.push('            <Extensions>');
      if (number(point.acc)) {
        element('pacelet:AccuracyMeters', point.acc, '              ');
      }
      if (number(point.rawLat) && number(point.rawLon)) {
        element('pacelet:RawLatitudeDegrees', point.rawLat, '              ');
        element('pacelet:RawLongitudeDegrees', point.rawLon, '              ');
      }
      lines.push('            </Extensions>');
    }
    lines.push('          </Trackpoint>');
  }
  if (points.length) { lines.push('        </Track>'); }
  lines.push('      </Lap>');
  if (diagnostics) {
    element('Notes', 'Pacelet ' + (diagnostics.appVersion || 'unknown version') +
      '; GPS filter ' + diagnostics.filterVersion +
      '. GPS gaps are separate tracks; missing distance is not estimated. ' +
      'Diagnostics contain counters and a bounded event history.', '      ');
    lines.push('      <Extensions>');
    element('pacelet:Diagnostics', JSON.stringify(diagnostics), '        ');
    lines.push('      </Extensions>');
  }
  lines.push('    </Activity>', '  </Activities>', '</TrainingCenterDatabase>');
  return lines.join('\n');
}

module.exports = { generateTcx: generateTcx };
