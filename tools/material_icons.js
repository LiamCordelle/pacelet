'use strict';

var fs = require('fs');
var path = require('path');

var SOURCE_DIR = path.resolve(
  __dirname, '..', 'resources', 'icon-sources', 'material-symbols-rounded'
);

var ICON_FILES = {
  WALKING: 'directions_walk_fill1_40px.svg',
  RUNNING: 'directions_run_fill1_40px.svg',
  CYCLING: 'directions_bike_fill1_40px.svg',
  HEART: 'favorite_fill1_40px.svg'
};

function readIcon(name) {
  var svg = fs.readFileSync(path.join(SOURCE_DIR, ICON_FILES[name]), 'utf8');
  var viewBox = svg.match(/viewBox="([^"]+)"/);
  var pathData = svg.match(/<path d="([^"]+)"/);
  if (!viewBox || !pathData) {
    throw new Error('Invalid Material Symbol source for ' + name);
  }

  var box = viewBox[1].trim().split(/\s+/).map(Number);
  return {
    path: pathData[1],
    viewBox: {
      x: box[0],
      y: box[1],
      width: box[2],
      height: box[3]
    }
  };
}

function tokenize(pathData) {
  return pathData.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/g);
}

function flattenPath(pathData) {
  var tokens = tokenize(pathData);
  var index = 0;
  var command = '';
  var x = 0;
  var y = 0;
  var startX = 0;
  var startY = 0;
  var controlX = 0;
  var controlY = 0;
  var previousCommand = '';
  var contours = [];
  var contour = null;

  function isCommand(token) {
    return /^[a-zA-Z]$/.test(token || '');
  }

  function number() {
    return Number(tokens[index++]);
  }

  function point(px, py) {
    if (!contour) {
      contour = [];
      contours.push(contour);
    }
    contour.push({ x: px, y: py });
  }

  function curvePoint(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    return mt * mt * mt * p0 +
      3 * mt * mt * t * p1 +
      3 * mt * t * t * p2 +
      t * t * t * p3;
  }

  function cubic(x1, y1, x2, y2, endX, endY) {
    var fromX = x;
    var fromY = y;
    for (var step = 1; step <= 12; step++) {
      var t = step / 12;
      point(
        curvePoint(fromX, x1, x2, endX, t),
        curvePoint(fromY, y1, y2, endY, t)
      );
    }
    x = endX;
    y = endY;
    controlX = x2;
    controlY = y2;
  }

  function quadratic(x1, y1, endX, endY) {
    var fromX = x;
    var fromY = y;
    for (var step = 1; step <= 10; step++) {
      var t = step / 10;
      var mt = 1 - t;
      point(
        mt * mt * fromX + 2 * mt * t * x1 + t * t * endX,
        mt * mt * fromY + 2 * mt * t * y1 + t * t * endY
      );
    }
    x = endX;
    y = endY;
    controlX = x1;
    controlY = y1;
  }

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    }

    var relative = command === command.toLowerCase();
    var upper = command.toUpperCase();
    var nextX;
    var nextY;

    if (upper === 'M') {
      nextX = number();
      nextY = number();
      if (relative) {
        nextX += x;
        nextY += y;
      }
      x = nextX;
      y = nextY;
      startX = x;
      startY = y;
      contour = [];
      contours.push(contour);
      point(x, y);
      command = relative ? 'l' : 'L';
    } else if (upper === 'L') {
      nextX = number();
      nextY = number();
      x = relative ? x + nextX : nextX;
      y = relative ? y + nextY : nextY;
      point(x, y);
    } else if (upper === 'H') {
      nextX = number();
      x = relative ? x + nextX : nextX;
      point(x, y);
    } else if (upper === 'V') {
      nextY = number();
      y = relative ? y + nextY : nextY;
      point(x, y);
    } else if (upper === 'C') {
      var x1 = number();
      var y1 = number();
      var x2 = number();
      var y2 = number();
      nextX = number();
      nextY = number();
      if (relative) {
        x1 += x;
        y1 += y;
        x2 += x;
        y2 += y;
        nextX += x;
        nextY += y;
      }
      cubic(x1, y1, x2, y2, nextX, nextY);
    } else if (upper === 'S') {
      var reflectedX = x;
      var reflectedY = y;
      if (previousCommand === 'C' || previousCommand === 'S') {
        reflectedX = 2 * x - controlX;
        reflectedY = 2 * y - controlY;
      }
      var smoothX2 = number();
      var smoothY2 = number();
      nextX = number();
      nextY = number();
      if (relative) {
        smoothX2 += x;
        smoothY2 += y;
        nextX += x;
        nextY += y;
      }
      cubic(reflectedX, reflectedY, smoothX2, smoothY2, nextX, nextY);
    } else if (upper === 'Q') {
      var qx = number();
      var qy = number();
      nextX = number();
      nextY = number();
      if (relative) {
        qx += x;
        qy += y;
        nextX += x;
        nextY += y;
      }
      quadratic(qx, qy, nextX, nextY);
    } else if (upper === 'T') {
      var reflectedQX = x;
      var reflectedQY = y;
      if (previousCommand === 'Q' || previousCommand === 'T') {
        reflectedQX = 2 * x - controlX;
        reflectedQY = 2 * y - controlY;
      }
      nextX = number();
      nextY = number();
      if (relative) {
        nextX += x;
        nextY += y;
      }
      quadratic(reflectedQX, reflectedQY, nextX, nextY);
    } else if (upper === 'Z') {
      point(startX, startY);
      x = startX;
      y = startY;
      contour = null;
      previousCommand = 'Z';
      command = '';
      continue;
    } else {
      throw new Error('Unsupported SVG path command: ' + command);
    }

    previousCommand = upper;
  }

  return contours.filter(function(points) {
    return points.length >= 3;
  });
}

function transformedContours(icon, width, height, padding) {
  var availableW = width - padding * 2;
  var availableH = height - padding * 2;
  var scale = Math.min(
    availableW / icon.viewBox.width,
    availableH / icon.viewBox.height
  );
  var offsetX = (width - icon.viewBox.width * scale) / 2 -
    icon.viewBox.x * scale;
  var offsetY = (height - icon.viewBox.height * scale) / 2 -
    icon.viewBox.y * scale;

  return flattenPath(icon.path).map(function(contour) {
    return contour.map(function(point) {
      return {
        x: point.x * scale + offsetX,
        y: point.y * scale + offsetY
      };
    });
  });
}

function windingNumber(contours, x, y) {
  var winding = 0;
  contours.forEach(function(contour) {
    for (var i = 0; i < contour.length - 1; i++) {
      var a = contour[i];
      var b = contour[i + 1];
      var cross = (b.x - a.x) * (y - a.y) -
        (x - a.x) * (b.y - a.y);
      if (a.y <= y && b.y > y && cross > 0) {
        winding++;
      } else if (a.y > y && b.y <= y && cross < 0) {
        winding--;
      }
    }
  });
  return winding;
}

function rasterize(icon, width, height, padding, supersample) {
  var contours = transformedContours(icon, width, height, padding || 0);
  var samples = supersample || 4;
  var alpha = new Uint8Array(width * height);

  for (var py = 0; py < height; py++) {
    for (var px = 0; px < width; px++) {
      var inside = 0;
      for (var sy = 0; sy < samples; sy++) {
        for (var sx = 0; sx < samples; sx++) {
          var sampleX = px + (sx + 0.5) / samples;
          var sampleY = py + (sy + 0.5) / samples;
          if (windingNumber(contours, sampleX, sampleY) !== 0) {
            inside++;
          }
        }
      }
      alpha[py * width + px] = Math.round(
        inside * 255 / (samples * samples)
      );
    }
  }

  return alpha;
}

module.exports = {
  readIcon: readIcon,
  rasterize: rasterize,
  transformedContours: transformedContours
};
