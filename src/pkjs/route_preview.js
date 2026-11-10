// Two bytes per vertex in the watch's 150 × 124 plot. The high bit of Y
// starts a new segment. A version byte also represents an empty route.
var MAX_VERTICES = 64;
var WIDTH = 150;
var HEIGHT = 124;

function projectRoute(points) {
  var payload = [1];
  if (!points.length) { return payload; }

  var origin = points[0];
  var longitudeScale = Math.cos(origin.lat * Math.PI / 180);
  var minX = 0;
  var maxX = 0;
  var minY = 0;
  var maxY = 0;
  var samples = [];
  var count = Math.min(MAX_VERTICES, points.length);
  var next = 0;
  var segmentStart = true;
  var longitude = 0;
  var previousLon = origin.lon;

  points.forEach(function(point, index) {
    longitude += ((point.lon - previousLon + 540) % 360) - 180;
    previousLon = point.lon;
    var x = longitude * longitudeScale;
    var y = origin.lat - point.lat;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    segmentStart = segmentStart || !!point.segmentStart;
    if (index === (count === 1 ? 0 :
        Math.round(next * (points.length - 1) / (count - 1)))) {
      samples.push({ x: x, y: y, segmentStart: segmentStart });
      next += 1;
      segmentStart = false;
    }
  });

  var scale = 1 / Math.max((maxX - minX) / WIDTH,
      (maxY - minY) / HEIGHT, 0.000001);
  var centreX = (maxX + minX) / 2;
  var centreY = (maxY + minY) / 2;
  samples.forEach(function(point) {
    var x = Math.round(WIDTH / 2 + (point.x - centreX) * scale);
    var y = Math.round(HEIGHT / 2 + (point.y - centreY) * scale);
    payload.push(x, y | (point.segmentStart ? 128 : 0));
  });
  return payload;
}

module.exports = projectRoute;
