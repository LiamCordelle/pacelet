var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var materialIcons = require('./material_icons');

var ARGS = process.argv.slice(2);
var OUT_DIR = path.join(__dirname, '..', 'screenshots');
var WIDTH = 200;
var HEIGHT = 228;
var PNG_SCALE = 2;
var ACTION_RAIL_W = 20;
var RIGHT = WIDTH - ACTION_RAIL_W;
var MATERIAL_ICON_CACHE = {};

var THEME = {
  bg: '#f7fbf8',
  text: '#071014',
  muted: '#3e5459',
  accent: '#007c54',
  onAccent: '#ffffff',
  warning: '#9a6500',
  pauseBg: '#ffdc00',
  bad: '#b00020',
  hrZone1: '#ffaaa9',
  hrZone2: '#ffdc00',
  hrZone3: '#ff5500'
};

function railIconY(index) {
  return Math.round((HEIGHT * (index + 1)) / 4);
}

function chooseRowY(index) {
  return 38 + index * 54;
}

function gpsIconY() {
  return 78;
}

function gpsTitleY() {
  return 114;
}

function gpsAccuracyY() {
  return 145;
}

function countdownBandY() {
  return 38;
}

function countdownBandHeight() {
  return 120;
}

function durationBandY() {
  return 27;
}

function durationBandHeight() {
  return 58;
}

function metricRowHeight() {
  return 39;
}

function metricRowY(index) {
  return durationBandY() + durationBandHeight() + 1 +
    index * metricRowHeight();
}

function splitBandHeight() {
  return 96;
}

function splitRowHeight() {
  return 44;
}

var screens = [
  { name: 'choose-running', kind: 'choose', activity: 'RUNNING' },
  {
    name: 'gps-search',
    kind: 'gps',
    activity: 'RUNNING',
    state: 'GPS SEARCH',
    title: 'FINDING GPS',
    accuracy: '38 m accuracy',
    hint: '25 m required',
    color: THEME.warning,
    locked: false
  },
  {
    name: 'gps-ready',
    kind: 'gps',
    activity: 'RUNNING',
    state: 'GPS READY',
    title: 'GPS LOCKED',
    accuracy: '12 m accuracy',
    hint: 'Ready to start',
    color: THEME.accent,
    locked: true
  },
  {
    name: 'countdown',
    kind: 'countdown',
    activity: 'RUNNING',
    number: '3'
  },
  {
    name: 'walking',
    kind: 'activity',
    activity: 'WALKING',
    elapsed: '18:42',
    distance: '1.32 km',
    metricLabel: 'PACE',
    metricValue: '11:06/km',
    hrBpm: 112,
    hrZone: 1,
    gps: 'GPS 12 M'
  },
  {
    name: 'running',
    kind: 'activity',
    activity: 'RUNNING',
    elapsed: '23:14',
    distance: '4.62 km',
    metricLabel: 'PACE',
    metricValue: '5:02/km',
    hrBpm: 153,
    hrZone: 2,
    gps: 'GPS 10 M'
  },
  {
    name: 'measuring-hr',
    kind: 'activity',
    activity: 'RUNNING',
    elapsed: '00:18',
    distance: '42 m',
    metricLabel: 'PACE',
    metricValue: '--:--',
    hrBpm: 0,
    hrZone: 0,
    hrMeasuring: true,
    gps: 'GPS 11 M'
  },
  {
    name: 'split-running',
    kind: 'split',
    activity: 'RUNNING',
    splitNumber: '4',
    splitTime: '05:02',
    metricLabel: 'PACE',
    metricValue: '5:02/km',
    hrBpm: 154,
    hrZone: 2
  },
  {
    name: 'paused',
    kind: 'paused',
    activity: 'RUNNING',
    elapsed: '23:14',
    distance: '4.62 km',
    metricLabel: 'PACE',
    metricValue: '5:02/km',
    hrBpm: 153,
    hrZone: 2,
    gps: 'GPS 10 M'
  },
  {
    name: 'end-confirm',
    kind: 'confirm',
    activity: 'RUNNING',
    elapsed: '23:14'
  },
  {
    name: 'finished',
    kind: 'finished',
    activity: 'RUNNING',
    elapsed: '23:14',
    distance: '4.62 km',
    points: '286 GPS PTS'
  },
  {
    name: 'cycling',
    kind: 'activity',
    activity: 'CYCLING',
    elapsed: '41:08',
    distance: '18.74 km',
    metricLabel: 'SPEED',
    metricValue: '27.3 km/h',
    hrBpm: 146,
    hrZone: 2,
    gps: 'GPS 14 M'
  }
];

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function shortActivity(activity) {
  if (activity === 'WALKING') {
    return 'WALK';
  }
  if (activity === 'CYCLING') {
    return 'RIDE';
  }
  return 'RUN';
}

function shortState(state) {
  var states = {
    CHOOSE: 'PICK',
    'GPS SEARCH': 'GPS',
    'GPS READY': 'READY',
    'GET READY': '3-2-1',
    RECORDING: 'REC',
    PAUSED: 'PAUSE',
    'END ACTIVITY': 'END?',
    SAVED: 'SAVED',
    SPLIT: 'SPLIT'
  };
  return states[state] || state;
}

function hexToRgb(value) {
  var hex = value.charAt(0) === '#' ? value.slice(1) : value;
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

var FONT = {
  ' ': ['000', '000', '000', '000', '000', '000', '000'],
  '-': ['000', '000', '000', '111', '000', '000', '000'],
  '.': ['0', '0', '0', '0', '0', '0', '1'],
  ':': ['0', '1', '0', '0', '0', '1', '0'],
  '/': ['00001', '00010', '00100', '00100', '01000', '10000', '10000'],
  '0': ['111', '101', '101', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '010', '010', '111'],
  '2': ['111', '001', '001', '111', '100', '100', '111'],
  '3': ['111', '001', '001', '111', '001', '001', '111'],
  '4': ['101', '101', '101', '111', '001', '001', '001'],
  '5': ['111', '100', '100', '111', '001', '001', '111'],
  '6': ['111', '100', '100', '111', '101', '101', '111'],
  '7': ['111', '001', '001', '010', '010', '100', '100'],
  '8': ['111', '101', '101', '111', '101', '101', '111'],
  '9': ['111', '101', '101', '111', '001', '001', '111'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  'C': ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'G': ['01111', '10000', '10000', '10011', '10001', '10001', '01111'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['111', '010', '010', '010', '010', '010', '111'],
  'J': ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  'Y': ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111']
};

function glyphFor(ch) {
  var upper = String(ch).toUpperCase();
  return FONT[upper] || FONT[' '];
}

function textWidth(text, scale) {
  var width = 0;
  for (var i = 0; i < text.length; i += 1) {
    var glyph = glyphFor(text.charAt(i));
    width += glyph[0].length * scale;
    if (i < text.length - 1) {
      width += scale;
    }
  }
  return width;
}

function crc32(buffer) {
  var table = crc32.table;
  if (!table) {
    table = [];
    for (var i = 0; i < 256; i += 1) {
      var c = i;
      for (var k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[i] = c >>> 0;
    }
    crc32.table = table;
  }

  var crc = 0xffffffff;
  for (var j = 0; j < buffer.length; j += 1) {
    crc = table[(crc ^ buffer[j]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  var typeBuffer = Buffer.from(type, 'ascii');
  var lengthBuffer = Buffer.alloc(4);
  var crcBuffer = Buffer.alloc(4);
  lengthBuffer.writeUInt32BE(data.length, 0);
  crcBuffer.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([lengthBuffer, typeBuffer, data, crcBuffer]);
}

function encodePng(width, height, rgba) {
  var header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  var ihdr = Buffer.alloc(13);
  var rowBytes = width * 4;
  var raw = Buffer.alloc((rowBytes + 1) * height);

  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  for (var y = 0; y < height; y += 1) {
    var rawOffset = y * (rowBytes + 1);
    raw[rawOffset] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * rowBytes, rowBytes)
      .copy(raw, rawOffset + 1);
  }

  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function PixelCanvas(width, height) {
  this.width = width;
  this.height = height;
  this.rgba = new Uint8Array(width * height * 4);
}

PixelCanvas.prototype.clear = function(color) {
  var rgb = hexToRgb(color);
  for (var i = 0; i < this.width * this.height; i += 1) {
    var offset = i * 4;
    this.rgba[offset] = rgb.r;
    this.rgba[offset + 1] = rgb.g;
    this.rgba[offset + 2] = rgb.b;
    this.rgba[offset + 3] = 255;
  }
};

PixelCanvas.prototype.setPixel = function(x, y, color) {
  if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
    return;
  }
  var rgb = hexToRgb(color);
  var offset = (Math.round(y) * this.width + Math.round(x)) * 4;
  this.rgba[offset] = rgb.r;
  this.rgba[offset + 1] = rgb.g;
  this.rgba[offset + 2] = rgb.b;
  this.rgba[offset + 3] = 255;
};

PixelCanvas.prototype.fillRect = function(x, y, w, h, color) {
  for (var yy = Math.round(y); yy < Math.round(y + h); yy += 1) {
    for (var xx = Math.round(x); xx < Math.round(x + w); xx += 1) {
      this.setPixel(xx, yy, color);
    }
  }
};

PixelCanvas.prototype.line = function(x0, y0, x1, y1, color, width) {
  var dx = Math.abs(x1 - x0);
  var sx = x0 < x1 ? 1 : -1;
  var dy = -Math.abs(y1 - y0);
  var sy = y0 < y1 ? 1 : -1;
  var err = dx + dy;
  var half = Math.max(0, Math.floor((width || 1) / 2));

  while (true) {
    for (var yy = -half; yy <= half; yy += 1) {
      for (var xx = -half; xx <= half; xx += 1) {
        this.setPixel(x0 + xx, y0 + yy, color);
      }
    }
    if (x0 === x1 && y0 === y1) {
      break;
    }
    var e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
};

PixelCanvas.prototype.circle = function(cx, cy, r, color, width) {
  var stroke = width || 1;
  var outer = r + stroke / 2;
  var inner = Math.max(0, r - stroke / 2);
  for (var y = Math.floor(cy - outer); y <= Math.ceil(cy + outer); y += 1) {
    for (var x = Math.floor(cx - outer); x <= Math.ceil(cx + outer); x += 1) {
      var d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      if (d >= inner && d <= outer) {
        this.setPixel(x, y, color);
      }
    }
  }
};

PixelCanvas.prototype.fillCircle = function(cx, cy, r, color) {
  for (var y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    for (var x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
      if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r) {
        this.setPixel(x, y, color);
      }
    }
  }
};

PixelCanvas.prototype.text = function(text, x, y, scale, color, align, bold) {
  var value = String(text);
  var drawX = Math.round(x);
  if (align === 'center') {
    drawX -= Math.round(textWidth(value, scale) / 2);
  } else if (align === 'right') {
    drawX -= textWidth(value, scale);
  }

  for (var i = 0; i < value.length; i += 1) {
    var glyph = glyphFor(value.charAt(i));
    for (var gy = 0; gy < glyph.length; gy += 1) {
      for (var gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy].charAt(gx) !== '1') {
          continue;
        }
        this.fillRect(drawX + gx * scale, y + gy * scale, scale, scale, color);
        if (bold) {
          this.fillRect(drawX + gx * scale + 1, y + gy * scale,
                        scale, scale, color);
        }
      }
    }
    drawX += (glyph[0].length + 1) * scale;
  }
};

PixelCanvas.prototype.scaledRgba = function(scale) {
  var targetWidth = this.width * scale;
  var targetHeight = this.height * scale;
  var target = new Uint8Array(targetWidth * targetHeight * 4);

  for (var y = 0; y < targetHeight; y += 1) {
    for (var x = 0; x < targetWidth; x += 1) {
      var srcX = Math.floor(x / scale);
      var srcY = Math.floor(y / scale);
      var src = (srcY * this.width + srcX) * 4;
      var dst = (y * targetWidth + x) * 4;
      target[dst] = this.rgba[src];
      target[dst + 1] = this.rgba[src + 1];
      target[dst + 2] = this.rgba[src + 2];
      target[dst + 3] = this.rgba[src + 3];
    }
  }
  return target;
};

PixelCanvas.prototype.writePng = function(filename, scale) {
  var outputScale = scale || 1;
  var rgba = outputScale === 1 ? this.rgba : this.scaledRgba(outputScale);
  fs.writeFileSync(filename, encodePng(this.width * outputScale,
                                       this.height * outputScale, rgba));
};

function base(content) {
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + (WIDTH * 2) +
      '" height="' + (HEIGHT * 2) + '" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT + '">',
    '<style>',
    '  .status { font: 700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }',
    '  .timer { font: 800 31px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }',
    '  .label { font: 500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ' + THEME.muted + '; letter-spacing: 0; }',
    '  .value { font: 750 19px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ' + THEME.text + '; letter-spacing: 0; }',
    '  .menu { font: 750 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }',
    '  .footer { font: 500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ' + THEME.muted + '; letter-spacing: 0; }',
    '  .title { font: 750 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }',
    '</style>',
    '<rect width="' + WIDTH + '" height="' + HEIGHT + '" fill="' + THEME.bg + '"/>',
    content,
    '</svg>',
    ''
  ].join('\n');
}

function topBar(activity, state, color) {
  var third = Math.floor(RIGHT / 3);
  return [
    '<rect width="' + RIGHT + '" height="2" fill="' + color + '"/>',
    '<text x="8" y="17" class="status" fill="' + THEME.muted + '">' +
      esc(shortActivity(activity)) + '</text>',
    '<text x="' + (third + Math.floor(third / 2)) +
      '" y="17" class="status" fill="' + THEME.text +
      '" text-anchor="middle">10:09</text>',
    '<text x="' + RIGHT + '" y="17" class="status" fill="' + color +
      '" text-anchor="end">' + esc(shortState(state)) + '</text>'
  ].join('\n');
}

function actionIcon(type, cx, cy, color) {
  if (!type) {
    return '';
  }

  if (type === 'up') {
    return '<path d="M' + (cx - 5) + ' ' + (cy + 3) + ' L' + cx + ' ' +
      (cy - 3) + ' L' + (cx + 5) + ' ' + (cy + 3) +
      '" fill="none" stroke="' + color + '" stroke-width="2"/>';
  }

  if (type === 'down') {
    return '<path d="M' + (cx - 5) + ' ' + (cy - 3) + ' L' + cx + ' ' +
      (cy + 3) + ' L' + (cx + 5) + ' ' + (cy - 3) +
      '" fill="none" stroke="' + color + '" stroke-width="2"/>';
  }

  if (type === 'gps') {
    return [
      '<g fill="none" stroke="' + color + '" stroke-width="2">',
      '<circle cx="' + cx + '" cy="' + cy + '" r="5"/>',
      '<path d="M' + cx + ' ' + (cy - 8) + ' L' + cx + ' ' + (cy - 5) +
        ' M' + cx + ' ' + (cy + 5) + ' L' + cx + ' ' + (cy + 8) +
        ' M' + (cx - 8) + ' ' + cy + ' L' + (cx - 5) + ' ' + cy +
        ' M' + (cx + 5) + ' ' + cy + ' L' + (cx + 8) + ' ' + cy + '"/>',
      '</g>',
      '<circle cx="' + cx + '" cy="' + cy + '" r="2" fill="' + color + '"/>'
    ].join('\n');
  }

  if (type === 'refresh') {
    return [
      '<g fill="none" stroke="' + color + '" stroke-width="2">',
      '<circle cx="' + cx + '" cy="' + cy + '" r="5"/>',
      '<path d="M' + (cx + 2) + ' ' + (cy - 6) + ' L' + (cx + 6) +
        ' ' + (cy - 6) + ' L' + (cx + 6) + ' ' + (cy - 2) + '"/>',
      '</g>'
    ].join('\n');
  }

  if (type === 'play') {
    return '<path d="M' + (cx - 3) + ' ' + (cy - 6) + ' L' + (cx + 5) +
      ' ' + cy + ' L' + (cx - 3) + ' ' + (cy + 6) + ' Z" fill="none" stroke="' +
      color + '" stroke-width="2"/>';
  }

  if (type === 'pause') {
    return '<g fill="' + color + '"><rect x="' + (cx - 5) + '" y="' +
      (cy - 6) + '" width="3" height="12" rx="1"/><rect x="' +
      (cx + 2) + '" y="' + (cy - 6) +
      '" width="3" height="12" rx="1"/></g>';
  }

  if (type === 'stop') {
    return '<rect x="' + (cx - 5) + '" y="' + (cy - 5) +
      '" width="10" height="10" rx="1" fill="' + color + '"/>';
  }

  if (type === 'check') {
    return '<path d="M' + (cx - 6) + ' ' + cy + ' L' + (cx - 2) +
      ' ' + (cy + 5) + ' L' + (cx + 7) + ' ' + (cy - 5) +
      '" fill="none" stroke="' + color + '" stroke-width="2"/>';
  }

  if (type === 'close') {
    return '<path d="M' + (cx - 5) + ' ' + (cy - 5) + ' L' + (cx + 5) +
      ' ' + (cy + 5) + ' M' + (cx + 5) + ' ' + (cy - 5) + ' L' +
      (cx - 5) + ' ' + (cy + 5) +
      '" fill="none" stroke="' + color + '" stroke-width="2"/>';
  }

  if (type === 'type') {
    return [
      '<g stroke="' + color + '" stroke-width="2">',
      '<path d="M' + (cx - 5) + ' ' + (cy - 5) + ' L' + (cx + 4) +
        ' ' + (cy - 5) + ' M' + (cx - 5) + ' ' + cy + ' L' + (cx + 4) +
        ' ' + cy + ' M' + (cx - 5) + ' ' + (cy + 5) + ' L' + (cx + 4) +
        ' ' + (cy + 5) + '"/>',
      '</g>',
      '<g fill="' + color + '"><circle cx="' + (cx + 6) + '" cy="' +
        (cy - 5) + '" r="1.2"/><circle cx="' + (cx + 6) + '" cy="' +
        cy + '" r="1.2"/><circle cx="' + (cx + 6) + '" cy="' +
        (cy + 5) + '" r="1.2"/></g>'
    ].join('\n');
  }

  if (type === 'new') {
    return '<path d="M' + cx + ' ' + (cy - 6) + ' L' + cx + ' ' +
      (cy + 6) + ' M' + (cx - 6) + ' ' + cy + ' L' + (cx + 6) + ' ' +
      cy + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
  }

  return '';
}

function actionRail(up, select, down, requestedRailColor, requestedIconColor) {
  var railX = WIDTH - ACTION_RAIL_W;
  var iconX = railX + Math.round(ACTION_RAIL_W / 2);
  var railColor = requestedRailColor || THEME.text;
  var iconColor = requestedIconColor || THEME.bg;

  return [
    '<rect x="' + railX + '" y="0" width="' + ACTION_RAIL_W +
      '" height="' + HEIGHT + '" fill="' + railColor + '"/>',
    actionIcon(up, iconX, railIconY(0), iconColor),
    actionIcon(select, iconX, railIconY(1), iconColor),
    actionIcon(down, iconX, railIconY(2), iconColor)
  ].join('\n');
}

function materialIcon(name) {
  if (!MATERIAL_ICON_CACHE[name]) {
    MATERIAL_ICON_CACHE[name] = materialIcons.readIcon(name);
  }
  return MATERIAL_ICON_CACHE[name];
}

function materialIconSvg(name, cx, cy, size, color, padding) {
  var icon = materialIcon(name);
  var available = size - (padding || 0) * 2;
  var scale = Math.min(
    available / icon.viewBox.width,
    available / icon.viewBox.height
  );
  var x = cx - icon.viewBox.width * scale / 2 -
    icon.viewBox.x * scale;
  var y = cy - icon.viewBox.height * scale / 2 -
    icon.viewBox.y * scale;
  return '<path d="' + icon.path + '" transform="translate(' +
    x + ' ' + y + ') scale(' + scale + ')" fill="' + color + '"/>';
}

function activityIcon(activity, cx, cy, size, color) {
  return materialIconSvg(activity, cx, cy, size, color,
                         activity === 'CYCLING' ? 0 : 1);
}

function menuItem(activity, selected, y) {
  var rowH = 48;
  var iconSize = 34;
  var labelColor = selected ? THEME.onAccent : THEME.text;
  var iconColor = selected ? THEME.onAccent : THEME.text;
  var background = selected ?
    '<rect x="0" y="' + y + '" width="' + RIGHT +
      '" height="' + rowH + '" fill="' +
      THEME.accent + '"/>' :
    '<line x1="8" y1="' + (y + rowH - 1) + '" x2="' + (RIGHT - 4) +
      '" y2="' + (y + rowH - 1) +
      '" stroke="' + THEME.muted +
      '" stroke-width="1" stroke-dasharray="1 3" opacity="0.65"/>';

  return [
    background,
    activityIcon(activity, 29, y + rowH / 2, iconSize, iconColor),
    '<text x="52" y="' + (y + rowH / 2 + 6) +
      '" class="menu" fill="' + labelColor +
      '">' + esc(activity) + '</text>'
  ].join('\n');
}

function metricParts(text) {
  var value = String(text).toUpperCase();
  var spaceIndex = value.lastIndexOf(' ');
  if (spaceIndex >= 0) {
    return {
      value: value.slice(0, spaceIndex),
      unit: value.slice(spaceIndex + 1)
    };
  }

  var slashIndex = value.indexOf('/');
  if (slashIndex >= 0) {
    return {
      value: value.slice(0, slashIndex),
      unit: value.slice(slashIndex)
    };
  }

  return { value: value, unit: '' };
}

function dottedSeparator(y, color) {
  return '<line x1="8" y1="' + y + '" x2="' + (RIGHT - 4) +
    '" y2="' + y + '" stroke="' + color +
    '" stroke-width="1" stroke-dasharray="1 3" opacity="0.65"/>';
}

function durationBand(elapsed, paused) {
  var y = durationBandY();
  var height = durationBandHeight();
  var bg = paused ? THEME.pauseBg : THEME.accent;
  var ink = paused ? '#000000' : THEME.onAccent;
  var pausedLabel = paused ?
    '<text x="7" y="' + (y + 14) +
      '" class="status" fill="' + ink + '">PAUSED</text>' : '';

  return [
    '<rect x="0" y="' + y + '" width="' + RIGHT +
      '" height="' + height + '" fill="' + bg + '"/>',
    pausedLabel,
    '<text x="' + Math.round(RIGHT / 2) + '" y="' +
      (y + Math.round(height / 2) + 14) +
      '" class="timer" fill="' + ink +
      '" text-anchor="middle">' + esc(elapsed) + '</text>'
  ].join('\n');
}

function metricRow(y, height, label, text) {
  var parts = metricParts(text);
  return [
    dottedSeparator(y, THEME.muted),
    '<text x="8" y="' + (y + Math.round(height / 2) + 5) +
      '" class="status" fill="' + THEME.muted + '">' + esc(label) + '</text>',
    '<text x="' + (RIGHT - 40) + '" y="' +
      (y + Math.round(height / 2) + 9) +
      '" class="value" text-anchor="end">' + esc(parts.value) + '</text>',
    '<text x="' + (RIGHT - 37) + '" y="' +
      (y + Math.round(height / 2) + 5) +
      '" class="status" fill="' + THEME.text + '">' +
      esc(parts.unit) + '</text>'
  ].join('\n');
}

function countdownNumberRects(value) {
  if (String(value) === '1') {
    return [
      [30, 10, 14, 72],
      [20, 16, 12, 12],
      [18, 78, 38, 12]
    ];
  }

  var segmentRects = {
    top: [14, 6, 44, 12],
    middle: [14, 42, 44, 12],
    bottom: [14, 78, 44, 12],
    upperRight: [52, 12, 12, 36],
    lowerLeft: [8, 48, 12, 36],
    lowerRight: [52, 48, 12, 36]
  };
  var segments = String(value) === '2' ?
    ['top', 'upperRight', 'middle', 'lowerLeft', 'bottom'] :
    ['top', 'upperRight', 'middle', 'lowerRight', 'bottom'];
  return segments.map(function(segment) {
    return segmentRects[segment];
  });
}

function countdownNumberSvg(value, x, y) {
  return countdownNumberRects(value).map(function(rect) {
    return '<rect x="' + (x + rect[0]) + '" y="' + (y + rect[1]) +
      '" width="' + rect[2] + '" height="' + rect[3] +
      '" fill="' + THEME.onAccent + '"/>';
  }).join('\n');
}

function hrZoneLabel(zone) {
  if (zone === 1) {
    return 'FAT BURN';
  }
  if (zone === 2) {
    return 'ENDURANCE';
  }
  return 'PERFORMANCE';
}

function hrZoneColor(zone) {
  return THEME['hrZone' + zone];
}

function measuringHeart(cx, cy) {
  return [
    '<circle cx="' + cx + '" cy="' + cy + '" r="11" fill="none" stroke="' +
      THEME.muted + '" stroke-width="1"/>',
    materialIconSvg('HEART', cx, cy, 16, THEME.text, 1)
  ].join('\n');
}

function heartIcon(cx, cy, color) {
  return materialIconSvg('HEART', cx, cy, 24, color, 1);
}

function hrRow(y, height, bpm, zone, measuring) {
  var centerY = y + Math.round(height / 2);
  if (measuring) {
    return [
      dottedSeparator(y, THEME.muted),
      measuringHeart(20, centerY),
      '<text x="40" y="' + (centerY + 4) + '" class="status" fill="' +
        THEME.muted + '">MEASURING</text>'
    ].join('\n');
  }

  var bg = zone > 0 ? hrZoneColor(zone) : THEME.bg;
  var ink = zone > 0 ? '#000000' : THEME.text;
  var label = zone > 0 ? hrZoneLabel(zone) : 'HEART RATE';
  var content = [
    '<rect x="0" y="' + y + '" width="' + RIGHT +
      '" height="' + height + '" fill="' + bg + '"/>',
    dottedSeparator(y, zone > 0 ? ink : THEME.muted),
    '<text x="8" y="' + (y + 14) +
      '" class="status" fill="' + ink + '">' + esc(label) + '</text>',
    RIGHT >= 150 ? heartIcon(RIGHT - 66, centerY + 1, ink) : '',
    '<text x="' + (RIGHT - 4) + '" y="' + (centerY + 9) +
      '" class="value" fill="' + ink + '" text-anchor="end">' +
      esc(bpm || '--') + '</text>'
  ];
  for (var i = 1; zone > 0 && i <= 3; i += 1) {
    content.push('<rect x="' + (8 + (i - 1) * 15) +
      '" y="' + (y + height - 8) + '" width="12" height="4" ' +
      (i <= zone ? 'fill="#000000"' :
        'fill="none" stroke="#000000" stroke-width="1"') + '/>');
  }
  return content.join('\n');
}

function renderChoose(screen) {
  return base([
    topBar(screen.activity, 'CHOOSE', THEME.muted),
    menuItem('WALKING', screen.activity === 'WALKING', chooseRowY(0)),
    menuItem('RUNNING', screen.activity === 'RUNNING', chooseRowY(1)),
    menuItem('CYCLING', screen.activity === 'CYCLING', chooseRowY(2)),
    actionRail('up', 'gps', 'down')
  ].join('\n'));
}

function renderGps(screen) {
  var dotR = screen.locked ? 7 : 5;
  var centerX = Math.round(RIGHT / 2);
  return base([
    topBar(screen.activity, screen.state, screen.color),
    '<g fill="none" stroke="' + THEME.muted + '" stroke-width="1">',
    '<circle cx="' + centerX + '" cy="' + gpsIconY() + '" r="21"/>',
    '<circle cx="' + centerX + '" cy="' + gpsIconY() + '" r="29"/>',
    '</g>',
    '<g stroke="' + screen.color + '" stroke-width="2">',
    '<path d="M' + centerX + ' ' + (gpsIconY() - 27) + ' L' + centerX +
      ' ' + (gpsIconY() - 13) + ' M' + centerX + ' ' + (gpsIconY() + 13) +
      ' L' + centerX + ' ' + (gpsIconY() + 27) + ' M' + (centerX - 27) +
      ' ' + gpsIconY() + ' L' + (centerX - 13) + ' ' + gpsIconY() +
      ' M' + (centerX + 13) + ' ' + gpsIconY() + ' L' + (centerX + 27) +
      ' ' + gpsIconY() + '"/>',
    '</g>',
    '<circle cx="' + centerX + '" cy="' + gpsIconY() + '" r="' + dotR +
      '" fill="' + screen.color + '"/>',
    '<text x="' + centerX + '" y="' + (gpsTitleY() + 21) +
      '" class="title" fill="' + screen.color +
      '" text-anchor="middle">' + esc(screen.title) + '</text>',
    '<text x="' + centerX + '" y="' + (gpsAccuracyY() + 13) +
      '" class="label" fill="' + THEME.text +
      '" text-anchor="middle">' + esc(screen.accuracy) + '</text>',
    '<text x="' + centerX + '" y="' + (HEIGHT - 8) +
      '" class="footer" text-anchor="middle">' + esc(screen.hint) + '</text>',
    actionRail('refresh', screen.locked ? 'play' : null, 'type')
  ].join('\n'));
}

function renderCountdown(screen) {
  var centerX = Math.round(RIGHT / 2);
  var bandY = countdownBandY();
  var bandH = countdownBandHeight();
  var numberY = bandY + Math.floor((bandH - 96) / 2);
  return base([
    topBar(screen.activity, 'GET READY', THEME.accent),
    '<rect x="0" y="' + bandY + '" width="' + RIGHT +
      '" height="' + bandH + '" fill="' + THEME.accent + '"/>',
    countdownNumberSvg(screen.number, centerX - 36, numberY),
    '<text x="' + centerX + '" y="' + (bandY + bandH + 23) +
      '" class="label" text-anchor="middle">' +
      esc(screen.activity) + '</text>',
    actionRail(null, null, null)
  ].join('\n'));
}

function renderActivity(screen, paused) {
  var centerX = Math.round(RIGHT / 2);
  var rowHeight = metricRowHeight();
  return base([
    topBar(screen.activity, paused ? 'PAUSED' : 'RECORDING',
           paused ? THEME.warning : THEME.accent),
    durationBand(screen.elapsed, paused),
    metricRow(metricRowY(0), rowHeight, 'DIST', screen.distance),
    metricRow(metricRowY(1), rowHeight,
              screen.metricLabel, screen.metricValue),
    hrRow(metricRowY(2), rowHeight,
          screen.hrBpm, screen.hrZone, screen.hrMeasuring),
    '<text x="' + centerX + '" y="' + (HEIGHT - 6) +
      '" class="footer" text-anchor="middle">' + esc(screen.gps) + '</text>',
    actionRail(paused ? 'play' : 'pause',
               paused ? 'stop' : null, null)
  ].join('\n'));
}

function renderSplit(screen) {
  var centerX = Math.round(RIGHT / 2);
  var bandY = durationBandY();
  var bandHeight = splitBandHeight();
  var rowHeight = splitRowHeight();
  var movementY = bandY + bandHeight + 1;
  var hrY = movementY + rowHeight;
  return base([
    topBar(screen.activity, 'SPLIT', THEME.accent),
    '<rect x="0" y="' + bandY + '" width="' + RIGHT +
      '" height="' + bandHeight + '" fill="' + THEME.accent + '"/>',
    '<text x="8" y="' + (bandY + 23) +
      '" class="title" fill="' + THEME.onAccent +
      '">KM ' + esc(screen.splitNumber) + '</text>',
    '<text x="' + centerX + '" y="' + (bandY + bandHeight - 13) +
      '" class="timer" fill="' + THEME.onAccent +
      '" text-anchor="middle">' + esc(screen.splitTime) + '</text>',
    metricRow(movementY, rowHeight, screen.metricLabel, screen.metricValue),
    hrRow(hrY, rowHeight, screen.hrBpm, screen.hrZone, screen.hrMeasuring),
    actionRail('pause', null, null)
  ].join('\n'));
}

function renderPaused(screen) {
  return renderActivity(screen, true);
}

function renderConfirm(screen) {
  var third = Math.floor(RIGHT / 3);
  var centerX = Math.round(RIGHT / 2);
  var stopSize = 34;
  var stopY = 47;
  var titleY = 91;
  var activityY = 126;
  var elapsedY = 146;
  return base([
    '<rect x="0" y="0" width="' + RIGHT + '" height="' + HEIGHT +
      '" fill="' + THEME.pauseBg + '"/>',
    '<text x="8" y="17" class="status" fill="#000000">' +
      esc(shortActivity(screen.activity)) + '</text>',
    '<text x="' + (third + Math.floor(third / 2)) +
      '" y="17" class="status" fill="#000000" text-anchor="middle">10:09</text>',
    '<text x="' + RIGHT +
      '" y="17" class="status" fill="#000000" text-anchor="end">END?</text>',
    '<rect x="' + (centerX - Math.floor(stopSize / 2)) +
      '" y="' + stopY + '" width="' + stopSize + '" height="' + stopSize +
      '" rx="2" fill="#000000"/>',
    '<text x="' + centerX + '" y="' + (titleY + 22) +
      '" class="title" fill="#000000" text-anchor="middle">END ACTIVITY?</text>',
    '<text x="' + centerX + '" y="' + (activityY + 14) +
      '" class="status" fill="#000000" text-anchor="middle">' +
      esc(screen.activity) + '</text>',
    '<text x="' + centerX + '" y="' + (elapsedY + 34) +
      '" class="timer" fill="#000000" text-anchor="middle">' +
      esc(screen.elapsed) + '</text>',
    actionRail('check', null, 'close', '#000000', '#ffffff')
  ].join('\n'));
}

function renderFinished(screen) {
  var bandY = durationBandY();
  var bandHeight = 84;
  var rowHeight = 45;
  var timeY = bandY + bandHeight + 1;
  var distanceY = timeY + rowHeight;
  var checkX1 = 22;
  var checkX2 = 34;
  var checkX3 = 53;
  var checkY = bandY + Math.round(bandHeight / 2);
  return base([
    topBar(screen.activity, 'SAVED', THEME.accent),
    '<rect x="0" y="' + bandY + '" width="' + RIGHT +
      '" height="' + bandHeight + '" fill="' + THEME.accent + '"/>',
    '<path d="M' + checkX1 + ' ' + checkY + ' L' + checkX2 + ' ' +
      (checkY + 12) + ' L' + checkX3 + ' ' + (checkY - 12) +
      '" fill="none" stroke="' + THEME.onAccent + '" stroke-width="3"/>',
    '<text x="62" y="' + (bandY + 32) +
      '" class="title" fill="' + THEME.onAccent + '">SAVED</text>',
    '<text x="62" y="' +
      (bandY + bandHeight - 12) +
      '" class="status" fill="' + THEME.onAccent + '">' +
      esc(screen.activity) + '</text>',
    metricRow(timeY, rowHeight, 'TIME', screen.elapsed),
    metricRow(distanceY, rowHeight, 'DIST', screen.distance),
    '<text x="' + Math.round(RIGHT / 2) + '" y="' + (HEIGHT - 6) +
      '" class="footer" text-anchor="middle">' + esc(screen.points) +
      '</text>',
    actionRail('play', null, 'type')
  ].join('\n'));
}

function render(screen) {
  if (screen.kind === 'choose') {
    return renderChoose(screen);
  }
  if (screen.kind === 'gps') {
    return renderGps(screen);
  }
  if (screen.kind === 'countdown') {
    return renderCountdown(screen);
  }
  if (screen.kind === 'paused') {
    return renderPaused(screen);
  }
  if (screen.kind === 'split') {
    return renderSplit(screen);
  }
  if (screen.kind === 'confirm') {
    return renderConfirm(screen);
  }
  if (screen.kind === 'finished') {
    return renderFinished(screen);
  }
  return renderActivity(screen, false);
}

function pixelActionIcon(canvas, type, cx, cy, color) {
  if (!type) {
    return;
  }

  if (type === 'up') {
    canvas.line(cx - 5, cy + 3, cx, cy - 3, color, 2);
    canvas.line(cx, cy - 3, cx + 5, cy + 3, color, 2);
  } else if (type === 'down') {
    canvas.line(cx - 5, cy - 3, cx, cy + 3, color, 2);
    canvas.line(cx, cy + 3, cx + 5, cy - 3, color, 2);
  } else if (type === 'gps') {
    canvas.circle(cx, cy, 5, color, 2);
    canvas.line(cx, cy - 8, cx, cy - 5, color, 2);
    canvas.line(cx, cy + 5, cx, cy + 8, color, 2);
    canvas.line(cx - 8, cy, cx - 5, cy, color, 2);
    canvas.line(cx + 5, cy, cx + 8, cy, color, 2);
    canvas.fillCircle(cx, cy, 2, color);
  } else if (type === 'refresh') {
    canvas.circle(cx, cy, 5, color, 2);
    canvas.line(cx + 2, cy - 6, cx + 6, cy - 6, color, 2);
    canvas.line(cx + 6, cy - 6, cx + 6, cy - 2, color, 2);
  } else if (type === 'play') {
    canvas.line(cx - 3, cy - 6, cx + 5, cy, color, 2);
    canvas.line(cx + 5, cy, cx - 3, cy + 6, color, 2);
    canvas.line(cx - 3, cy + 6, cx - 3, cy - 6, color, 2);
  } else if (type === 'pause') {
    canvas.fillRect(cx - 5, cy - 6, 3, 12, color);
    canvas.fillRect(cx + 2, cy - 6, 3, 12, color);
  } else if (type === 'stop') {
    canvas.fillRect(cx - 5, cy - 5, 10, 10, color);
  } else if (type === 'check') {
    canvas.line(cx - 6, cy, cx - 2, cy + 5, color, 2);
    canvas.line(cx - 2, cy + 5, cx + 7, cy - 5, color, 2);
  } else if (type === 'close') {
    canvas.line(cx - 5, cy - 5, cx + 5, cy + 5, color, 2);
    canvas.line(cx + 5, cy - 5, cx - 5, cy + 5, color, 2);
  } else if (type === 'type') {
    canvas.line(cx - 5, cy - 5, cx + 4, cy - 5, color, 2);
    canvas.line(cx - 5, cy, cx + 4, cy, color, 2);
    canvas.line(cx - 5, cy + 5, cx + 4, cy + 5, color, 2);
    canvas.fillCircle(cx + 6, cy - 5, 1, color);
    canvas.fillCircle(cx + 6, cy, 1, color);
    canvas.fillCircle(cx + 6, cy + 5, 1, color);
  } else if (type === 'new') {
    canvas.line(cx, cy - 6, cx, cy + 6, color, 2);
    canvas.line(cx - 6, cy, cx + 6, cy, color, 2);
  }
}

function pixelActionRail(canvas, up, select, down,
                         requestedRailColor, requestedIconColor) {
  var railX = WIDTH - ACTION_RAIL_W;
  var iconX = railX + Math.round(ACTION_RAIL_W / 2);
  var railColor = requestedRailColor || THEME.text;
  var iconColor = requestedIconColor || THEME.bg;

  canvas.fillRect(railX, 0, ACTION_RAIL_W, HEIGHT, railColor);
  pixelActionIcon(canvas, up, iconX, railIconY(0), iconColor);
  pixelActionIcon(canvas, select, iconX, railIconY(1), iconColor);
  pixelActionIcon(canvas, down, iconX, railIconY(2), iconColor);
}

function pixelActivityIcon(canvas, activity, cx, cy, size, color) {
  pixelMaterialIcon(canvas, activity, cx, cy, size, color,
                    activity === 'CYCLING' ? 0 : 1);
}

function pixelMaterialIcon(canvas, name, cx, cy, size, color, padding) {
  var alpha = materialIcons.rasterize(
    materialIcon(name), size, size, padding || 0, 4
  );
  var originX = Math.round(cx - size / 2);
  var originY = Math.round(cy - size / 2);
  for (var y = 0; y < size; y++) {
    for (var x = 0; x < size; x++) {
      if (alpha[y * size + x] >= 128) {
        canvas.setPixel(originX + x, originY + y, color);
      }
    }
  }
}

function pixelTopBar(canvas, activity, state, color) {
  var third = Math.floor(RIGHT / 3);
  canvas.fillRect(0, 0, RIGHT, 2, color);
  canvas.text(shortActivity(activity), 8, 7, 1, THEME.muted, 'left', true);
  canvas.text('10:09', third + Math.floor(third / 2), 7, 1, THEME.text,
              'center', true);
  canvas.text(shortState(state), RIGHT, 7, 1, color, 'right', true);
}

function pixelTextFit(canvas, text, x, y, maxWidth, scale, color, align, bold) {
  var fittedScale = scale;
  while (fittedScale > 1 && textWidth(String(text), fittedScale) > maxWidth) {
    fittedScale -= 1;
  }
  canvas.text(text, x, y, fittedScale, color, align, bold);
}

function pixelMenuItem(canvas, activity, selected, y) {
  var rowH = 48;
  var iconSize = 34;
  var labelColor = selected ? THEME.onAccent : THEME.text;
  var iconColor = selected ? THEME.onAccent : THEME.text;

  if (selected) {
    canvas.fillRect(0, y, RIGHT, rowH, THEME.accent);
  } else {
    for (var x = 8; x < RIGHT - 4; x += 4) {
      canvas.fillRect(x, y + rowH - 1, 1, 1, THEME.muted);
    }
  }

  pixelActivityIcon(canvas, activity, 29, y + Math.round(rowH / 2),
                    iconSize, iconColor);
  pixelTextFit(canvas, activity, 52, y + Math.round((rowH - 16) / 2),
               RIGHT - 56, 2, labelColor,
               'left', true);
}

function pixelDottedSeparator(canvas, y, color) {
  for (var x = 8; x < RIGHT - 4; x += 4) {
    canvas.fillRect(x, y, 1, 1, color);
  }
}

function pixelDurationBand(canvas, elapsed, paused) {
  var y = durationBandY();
  var height = durationBandHeight();
  var bg = paused ? THEME.pauseBg : THEME.accent;
  var ink = paused ? '#000000' : THEME.onAccent;
  canvas.fillRect(0, y, RIGHT, height, bg);
  if (paused) {
    canvas.text('PAUSED', 7, y + 3, 1, ink, 'left', true);
  }
  pixelTextFit(canvas, elapsed, Math.round(RIGHT / 2),
               y + Math.round((height - 35) / 2), RIGHT - 8, 5, ink,
               'center', true);
}

function pixelMetricRow(canvas, y, height, label, text) {
  var parts = metricParts(text);
  pixelDottedSeparator(canvas, y, THEME.muted);
  pixelTextFit(canvas, label, 8, y + Math.round((height - 7) / 2),
               42, 1, THEME.muted, 'left', true);
  pixelTextFit(canvas, parts.value, RIGHT - 40,
               y + Math.round((height - 21) / 2),
               RIGHT - 82, 3, THEME.text, 'right', true);
  pixelTextFit(canvas, parts.unit, RIGHT - 37,
               y + Math.round((height - 7) / 2),
               37, 1, THEME.text, 'left', true);
}

function pixelHeartIcon(canvas, cx, cy, color) {
  pixelMaterialIcon(canvas, 'HEART', cx, cy, 24, color, 1);
}

function pixelHrRow(canvas, y, height, bpm, zone) {
  var ink = zone > 0 ? '#000000' : THEME.text;
  var bg = zone > 0 ? hrZoneColor(zone) : THEME.bg;
  canvas.fillRect(0, y, RIGHT, height, bg);
  pixelDottedSeparator(canvas, y, zone > 0 ? ink : THEME.muted);
  pixelTextFit(canvas, zone > 0 ? hrZoneLabel(zone) : 'HEART RATE',
               8, y + 4, 78, 1, ink,
               'left', true);
  if (RIGHT >= 150) {
    pixelHeartIcon(canvas, RIGHT - 66, y + Math.round(height / 2) + 1, ink);
  }
  pixelTextFit(canvas, bpm || '--', RIGHT - 4,
               y + Math.round((height - 21) / 2),
               53, 3, ink,
               'right', true);
  for (var i = 1; zone > 0 && i <= 3; i += 1) {
    var x = 8 + (i - 1) * 15;
    if (i <= zone) {
      canvas.fillRect(x, y + height - 8, 12, 4, ink);
    } else {
      canvas.line(x, y + height - 8, x + 11, y + height - 8, ink, 1);
      canvas.line(x, y + height - 5, x + 11, y + height - 5, ink, 1);
      canvas.line(x, y + height - 8, x, y + height - 5, ink, 1);
      canvas.line(x + 11, y + height - 8,
                  x + 11, y + height - 5, ink, 1);
    }
  }
}

function pixelMeasuringHeart(canvas, cx, cy) {
  canvas.circle(cx, cy, 11, THEME.muted, 1);
  pixelMaterialIcon(canvas, 'HEART', cx, cy, 16, THEME.text, 1);
}

function pixelHrDisplay(canvas, y, height, screen) {
  if (screen.hrMeasuring) {
    var centerY = y + Math.round(height / 2);
    pixelDottedSeparator(canvas, y, THEME.muted);
    pixelMeasuringHeart(canvas, 20, centerY);
    pixelTextFit(canvas, 'MEASURING', 40, centerY - 4, RIGHT - 46, 1,
                 THEME.muted, 'left', true);
    return;
  }
  pixelHrRow(canvas, y, height, screen.hrBpm, screen.hrZone);
}

function pixelGpsIcon(canvas, centerX, centerY, color, locked) {
  canvas.circle(centerX, centerY, 21, THEME.muted, 1);
  canvas.circle(centerX, centerY, 29, THEME.muted, 1);
  canvas.line(centerX, centerY - 27, centerX, centerY - 13, color, 2);
  canvas.line(centerX, centerY + 13, centerX, centerY + 27, color, 2);
  canvas.line(centerX - 27, centerY, centerX - 13, centerY, color, 2);
  canvas.line(centerX + 13, centerY, centerX + 27, centerY, color, 2);
  canvas.fillCircle(centerX, centerY, locked ? 7 : 5, color);
}

function renderPixel(screen) {
  var canvas = new PixelCanvas(WIDTH, HEIGHT);
  var centerX = Math.round(RIGHT / 2);
  canvas.clear(THEME.bg);

  if (screen.kind === 'choose') {
    pixelTopBar(canvas, screen.activity, 'CHOOSE', THEME.muted);
    pixelMenuItem(canvas, 'WALKING', screen.activity === 'WALKING',
                  chooseRowY(0));
    pixelMenuItem(canvas, 'RUNNING', screen.activity === 'RUNNING',
                  chooseRowY(1));
    pixelMenuItem(canvas, 'CYCLING', screen.activity === 'CYCLING',
                  chooseRowY(2));
    pixelActionRail(canvas, 'up', 'gps', 'down');
  } else if (screen.kind === 'gps') {
    pixelTopBar(canvas, screen.activity, screen.state, screen.color);
    pixelGpsIcon(canvas, centerX, gpsIconY(), screen.color, screen.locked);
    pixelTextFit(canvas, screen.title, centerX, gpsTitleY() + 3, RIGHT - 8, 2,
                 screen.color, 'center', true);
    pixelTextFit(canvas, screen.accuracy, centerX, gpsAccuracyY() + 1,
                 RIGHT - 8, 2,
                 THEME.text, 'center', false);
    canvas.text(screen.hint, centerX, HEIGHT - 15, 1, THEME.muted, 'center',
                false);
    pixelActionRail(canvas, 'refresh', screen.locked ? 'play' : null, 'type');
  } else if (screen.kind === 'countdown') {
    centerX = Math.round(RIGHT / 2);
    var bandY = countdownBandY();
    var bandH = countdownBandHeight();
    var numberY = bandY + Math.floor((bandH - 96) / 2);
    pixelTopBar(canvas, screen.activity, 'GET READY', THEME.accent);
    canvas.fillRect(0, bandY, RIGHT, bandH, THEME.accent);
    countdownNumberRects(screen.number).forEach(function(rect) {
      canvas.fillRect(centerX - 36 + rect[0], numberY + rect[1],
                      rect[2], rect[3], THEME.onAccent);
    });
    canvas.text(screen.activity, centerX, bandY + bandH + 12, 2, THEME.muted,
                'center', false);
    pixelActionRail(canvas, null, null, null);
  } else if (screen.kind === 'paused') {
    var pausedRowHeight = metricRowHeight();
    pixelTopBar(canvas, screen.activity, 'PAUSED', THEME.warning);
    pixelDurationBand(canvas, screen.elapsed, true);
    pixelMetricRow(canvas, metricRowY(0), pausedRowHeight,
                   'DIST', screen.distance);
    pixelMetricRow(canvas, metricRowY(1), pausedRowHeight,
                   screen.metricLabel, screen.metricValue);
    pixelHrDisplay(canvas, metricRowY(2), pausedRowHeight, screen);
    canvas.text(screen.gps, centerX, HEIGHT - 14, 1, THEME.muted, 'center',
                false);
    pixelActionRail(canvas, 'play', 'stop', null);
  } else if (screen.kind === 'split') {
    var splitBandY = durationBandY();
    var splitBandH = splitBandHeight();
    var splitMetricH = splitRowHeight();
    var splitMetricY = splitBandY + splitBandH + 1;
    var splitHrY = splitMetricY + splitMetricH;
    pixelTopBar(canvas, screen.activity, 'SPLIT', THEME.accent);
    canvas.fillRect(0, splitBandY, RIGHT, splitBandH, THEME.accent);
    canvas.text('KM ' + screen.splitNumber, 8, splitBandY + 5, 3,
                THEME.onAccent, 'left', true);
    canvas.text(screen.splitTime, centerX,
                splitBandY + splitBandH - 40, 5, THEME.onAccent,
                'center', true);
    pixelMetricRow(canvas, splitMetricY, splitMetricH,
                   screen.metricLabel, screen.metricValue);
    pixelHrDisplay(canvas, splitHrY, splitMetricH, screen);
    pixelActionRail(canvas, 'pause', null, null);
  } else if (screen.kind === 'confirm') {
    var confirmThird = Math.floor(RIGHT / 3);
    var stopSize = 34;
    var stopY = 47;
    var titleY = 91;
    var activityY = 126;
    var elapsedY = 146;
    canvas.fillRect(0, 0, RIGHT, HEIGHT, THEME.pauseBg);
    canvas.text(shortActivity(screen.activity), 8, 7, 1,
                '#000000', 'left', true);
    canvas.text('10:09', confirmThird + Math.floor(confirmThird / 2), 7, 1,
                '#000000', 'center', true);
    canvas.text('END?', RIGHT, 7, 1, '#000000', 'right', true);
    canvas.fillRect(centerX - Math.floor(stopSize / 2), stopY,
                    stopSize, stopSize, '#000000');
    pixelTextFit(canvas, 'END ACTIVITY?', centerX, titleY + 4,
                 RIGHT - 10, 2, '#000000', 'center', true);
    canvas.text(screen.activity, centerX, activityY + 3, 1,
                '#000000', 'center', true);
    pixelTextFit(canvas, screen.elapsed, centerX, elapsedY,
                 RIGHT - 8, 5,
                 '#000000', 'center', true);
    pixelActionRail(canvas, 'check', null, 'close',
                    '#000000', '#ffffff');
  } else if (screen.kind === 'finished') {
    var finishedBandY = durationBandY();
    var finishedBandH = 84;
    var finishedRowH = 45;
    var finishedTimeY = finishedBandY + finishedBandH + 1;
    var finishedDistanceY = finishedTimeY + finishedRowH;
    var checkX1 = 22;
    var checkX2 = 34;
    var checkX3 = 53;
    var checkY = finishedBandY + Math.round(finishedBandH / 2);
    pixelTopBar(canvas, screen.activity, 'SAVED', THEME.accent);
    canvas.fillRect(0, finishedBandY, RIGHT, finishedBandH, THEME.accent);
    canvas.line(checkX1, checkY, checkX2, checkY + 12,
                THEME.onAccent, 3);
    canvas.line(checkX2, checkY + 12, checkX3, checkY - 12,
                THEME.onAccent, 3);
    canvas.text('SAVED', 62, finishedBandY + 10,
                3, THEME.onAccent, 'left', true);
    canvas.text(screen.activity, 62,
                finishedBandY + finishedBandH - 19, 1,
                THEME.onAccent, 'left', true);
    pixelMetricRow(canvas, finishedTimeY, finishedRowH,
                   'TIME', screen.elapsed);
    pixelMetricRow(canvas, finishedDistanceY, finishedRowH,
                   'DIST', screen.distance);
    canvas.text(screen.points, centerX, HEIGHT - 14, 1,
                THEME.muted, 'center', false);
    pixelActionRail(canvas, 'play', null, 'type');
  } else {
    var activeRowHeight = metricRowHeight();
    pixelTopBar(canvas, screen.activity, 'RECORDING', THEME.accent);
    pixelDurationBand(canvas, screen.elapsed, false);
    pixelMetricRow(canvas, metricRowY(0), activeRowHeight,
                   'DIST', screen.distance);
    pixelMetricRow(canvas, metricRowY(1), activeRowHeight,
                   screen.metricLabel, screen.metricValue);
    pixelHrDisplay(canvas, metricRowY(2), activeRowHeight, screen);
    canvas.text(screen.gps, centerX, HEIGHT - 14, 1, THEME.muted, 'center',
                false);
    pixelActionRail(canvas, 'pause', null, null);
  }

  return canvas;
}

function renderPngs() {
  screens.forEach(function(screen) {
    var filename = path.join(OUT_DIR, screen.name + '.png');
    renderPixel(screen).writePng(filename, PNG_SCALE);
    console.log(filename);
  });
}

function main() {
  var renderPng = ARGS.indexOf('--png') !== -1;

  if (!fs.existsSync(OUT_DIR)) {
    fs.mkdirSync(OUT_DIR);
  }

  if (renderPng) {
    renderPngs();
    return;
  }

  screens.forEach(function(screen) {
    var filename = path.join(OUT_DIR, screen.name + '.svg');
    fs.writeFileSync(filename, render(screen));
    console.log(filename);
  });
}

main();
