var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ARGS = process.argv.slice(2);
var OUT_DIR = path.join(__dirname, '..', 'screenshots');
var PLATFORMS = {
  basalt: { width: 144, height: 168 },
  chalk: { width: 180, height: 180 },
  diorite: { width: 144, height: 168 },
  emery: { width: 200, height: 228 }
};
var DEFAULT_PLATFORM = 'emery';
var PLATFORM_NAME = optionValue('--platform', DEFAULT_PLATFORM);

if (!Object.prototype.hasOwnProperty.call(PLATFORMS, PLATFORM_NAME)) {
  throw new Error('Unknown platform "' + PLATFORM_NAME + '". Expected one of: ' +
                  Object.keys(PLATFORMS).join(', '));
}

var WIDTH = PLATFORMS[PLATFORM_NAME].width;
var HEIGHT = PLATFORMS[PLATFORM_NAME].height;
var PNG_SCALE = 2;
var ACTION_RAIL_W = 14;
var RIGHT = WIDTH - ACTION_RAIL_W - 2;

var THEME = {
  bg: '#f7fbf8',
  text: '#071014',
  muted: '#3e5459',
  accent: '#007c54',
  onAccent: '#ffffff',
  warning: '#9a6500',
  bad: '#b00020'
};

function optionValue(name, fallback) {
  var prefix = name + '=';
  for (var i = 0; i < ARGS.length; i += 1) {
    if (ARGS[i] === name && i + 1 < ARGS.length) {
      return ARGS[i + 1];
    }
    if (ARGS[i].indexOf(prefix) === 0) {
      return ARGS[i].slice(prefix.length);
    }
  }
  return fallback;
}

var screens = [
  { name: 'choose-running', kind: 'choose', activity: 'RUNNING' },
  {
    name: 'gps-search',
    kind: 'gps',
    activity: 'RUNNING',
    state: 'GPS SEARCH',
    title: 'FINDING GPS',
    accuracy: 'Accuracy 38m',
    hint: 'Need 25m or better',
    color: THEME.warning,
    locked: false
  },
  {
    name: 'gps-ready',
    kind: 'gps',
    activity: 'RUNNING',
    state: 'GPS READY',
    title: 'GPS LOCKED',
    accuracy: 'Accuracy 12m',
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
    hr: '112 bpm',
    gps: 'GPS lock 12m'
  },
  {
    name: 'running',
    kind: 'activity',
    activity: 'RUNNING',
    elapsed: '23:14',
    distance: '4.62 km',
    metricLabel: 'PACE',
    metricValue: '5:02/km',
    hr: '153 bpm',
    gps: 'GPS lock 10m'
  },
  {
    name: 'paused',
    kind: 'paused',
    activity: 'RUNNING',
    elapsed: '23:14',
    distance: '4.62 km'
  },
  {
    name: 'cycling',
    kind: 'activity',
    activity: 'CYCLING',
    elapsed: '41:08',
    distance: '18.74 km',
    metricLabel: 'SPEED',
    metricValue: '27.3 km/h',
    hr: '146 bpm',
    gps: 'GPS lock 14m'
  }
];

function esc(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  return [
    '<rect width="' + RIGHT + '" height="2" fill="' + color + '"/>',
    '<text x="8" y="17" class="status" fill="' + THEME.muted + '">' +
      esc(activity) + '</text>',
    '<text x="' + RIGHT + '" y="17" class="status" fill="' + color +
      '" text-anchor="end">' + esc(state) + '</text>'
  ].join('\n');
}

function actionIcon(type, cx, cy, color) {
  if (!type) {
    return '';
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

  if (type === 'save') {
    return [
      '<g fill="none" stroke="' + color + '" stroke-width="2">',
      '<rect x="' + (cx - 5) + '" y="' + (cy - 6) +
        '" width="11" height="11"/>',
      '<path d="M' + (cx - 3) + ' ' + (cy + 2) + ' L' + (cx + 4) +
        ' ' + (cy + 2) + ' M' + (cx - 3) + ' ' + (cy + 8) + ' L' +
        (cx + 4) + ' ' + (cy + 8) + '"/>',
      '</g>',
      '<rect x="' + (cx - 2) + '" y="' + (cy - 5) +
        '" width="5" height="3" fill="' + color + '"/>'
    ].join('\n');
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

function actionRail(up, select, down) {
  var railX = WIDTH - ACTION_RAIL_W;
  var iconX = railX + Math.round(ACTION_RAIL_W / 2);
  var color = THEME.text;

  if (!up && !select && !down) {
    return '';
  }

  return [
    '<line x1="' + railX + '" y1="20" x2="' + railX +
      '" y2="' + (HEIGHT - 8) + '" stroke="' + color + '" stroke-width="1"/>',
    actionIcon(up, iconX, 42, color),
    actionIcon(select, iconX, 84, color),
    actionIcon(down, iconX, 126, color)
  ].join('\n');
}

function activityIcon(activity, cx, cy, size, color) {
  if (activity === 'CYCLING') {
    var wheelR = Math.round(size / 5);
    var leftX = cx - Math.round(size / 3);
    var rightX = cx + Math.round(size / 3);
    var wheelY = cy + Math.round(size / 5);
    var seatX = cx - Math.round(size / 10);
    var seatY = cy - Math.round(size / 7);
    var barX = cx + Math.round(size / 5);
    var barY = cy - Math.round(size / 5);

    return [
      '<g fill="none" stroke="' + color + '" stroke-width="2">',
      '<circle cx="' + leftX + '" cy="' + wheelY + '" r="' + wheelR + '"/>',
      '<circle cx="' + rightX + '" cy="' + wheelY + '" r="' + wheelR + '"/>',
      '<path d="M' + leftX + ' ' + wheelY + ' L' + cx + ' ' + wheelY +
        ' L' + seatX + ' ' + seatY + ' L' + rightX + ' ' + wheelY +
        ' M' + cx + ' ' + wheelY + ' L' + rightX + ' ' + wheelY +
        ' M' + barX + ' ' + barY + ' L' + rightX + ' ' + wheelY + '"/>',
      '<path d="M' + (seatX - 6) + ' ' + (seatY - 2) + ' L' +
        (seatX + 5) + ' ' + (seatY - 2) + ' M' + barX + ' ' + barY +
        ' L' + (barX + 9) + ' ' + (barY - 3) + '"/>',
      '</g>',
      '<circle cx="' + cx + '" cy="' + wheelY + '" r="3" fill="' +
        color + '"/>'
    ].join('\n');
  }

  if (activity === 'WALKING') {
    var soleW = Math.round(size / 5);
    var soleH = Math.round(size / 2);
    return [
      '<g fill="' + color + '">',
      '<rect x="' + (cx - 7) + '" y="' + (cy - 10) + '" width="' +
        soleW + '" height="' + soleH + '" rx="' + Math.round(soleW / 2) + '"/>',
      '<circle cx="' + (cx - 8) + '" cy="' + (cy - 12) + '" r="2"/>',
      '<rect x="' + (cx + 3) + '" y="' + (cy + 1) + '" width="' +
        soleW + '" height="' + soleH + '" rx="' + Math.round(soleW / 2) + '"/>',
      '<circle cx="' + (cx + 2) + '" cy="' + (cy - 1) + '" r="2"/>',
      '</g>'
    ].join('\n');
  }

  return [
    '<g fill="none" stroke="' + color + '" stroke-width="3" stroke-linecap="round">',
    '<path d="M' + (cx - 11) + ' ' + (cy - 6) + ' L' + (cx - 2) +
      ' ' + (cy - 6) + ' M' + (cx - 13) + ' ' + cy + ' L' + (cx - 5) +
      ' ' + cy + ' M' + (cx - 10) + ' ' + (cy + 6) + ' L' + (cx - 2) +
      ' ' + (cy + 6) + ' M' + (cx + 5) + ' ' + (cy - 12) + ' L' +
      (cx - 1) + ' ' + (cy - 1) + ' L' + (cx + 6) + ' ' + (cy - 1) +
      ' L' + (cx - 3) + ' ' + (cy + 13) + '"/>',
    '</g>'
  ].join('\n');
}

function menuItem(activity, selected, y) {
  var labelColor = selected ? THEME.onAccent : THEME.text;
  var iconColor = selected ? THEME.onAccent : THEME.accent;
  var background = selected ?
    '<rect x="8" y="' + y + '" width="' + (RIGHT - 12) +
      '" height="31" rx="4" fill="' +
      THEME.accent + '"/>' :
    '<line x1="14" y1="' + (y + 30) + '" x2="' + (RIGHT - 4) +
      '" y2="' + (y + 30) +
      '" stroke="' + THEME.muted + '" stroke-width="1" opacity="0.45"/>';

  return [
    background,
    activityIcon(activity, 27, y + 16, 26, iconColor),
    '<text x="46" y="' + (y + 23) + '" class="menu" fill="' + labelColor +
      '">' + esc(activity) + '</text>'
  ].join('\n');
}

function row(y, label, value) {
  return [
    '<text x="8" y="' + y + '" class="label">' + esc(label) + '</text>',
    '<text x="' + RIGHT + '" y="' + (y + 2) +
      '" class="value" text-anchor="end">' +
      esc(value) + '</text>'
  ].join('\n');
}

function renderChoose(screen) {
  return base([
    topBar(screen.activity, 'CHOOSE', THEME.muted),
    '<text x="' + Math.round(RIGHT / 2) +
      '" y="42" class="label" text-anchor="middle">Choose Activity</text>',
    menuItem('WALKING', screen.activity === 'WALKING', 48),
    menuItem('RUNNING', screen.activity === 'RUNNING', 81),
    menuItem('CYCLING', screen.activity === 'CYCLING', 114),
    actionRail(null, 'gps', 'type')
  ].join('\n'));
}

function renderGps(screen) {
  var dotR = screen.locked ? 7 : 5;
  var centerX = Math.round(RIGHT / 2);
  return base([
    topBar(screen.activity, screen.state, screen.color),
    '<g fill="none" stroke="' + THEME.muted + '" stroke-width="1">',
    '<circle cx="' + centerX + '" cy="67" r="21"/>',
    '<circle cx="' + centerX + '" cy="67" r="29"/>',
    '</g>',
    '<g stroke="' + screen.color + '" stroke-width="2">',
    '<path d="M' + centerX + ' 40 L' + centerX + ' 54 M' + centerX +
      ' 80 L' + centerX + ' 94 M' + (centerX - 27) + ' 67 L' +
      (centerX - 13) + ' 67 M' + (centerX + 13) + ' 67 L' +
      (centerX + 27) + ' 67"/>',
    '</g>',
    '<circle cx="' + centerX + '" cy="67" r="' + dotR +
      '" fill="' + screen.color + '"/>',
    '<text x="' + centerX + '" y="119" class="title" fill="' + screen.color +
      '" text-anchor="middle">' + esc(screen.title) + '</text>',
    '<text x="' + centerX + '" y="139" class="label" fill="' + THEME.text +
      '" text-anchor="middle">' + esc(screen.accuracy) + '</text>',
    '<text x="' + centerX + '" y="' + (HEIGHT - 8) +
      '" class="footer" text-anchor="middle">' + esc(screen.hint) + '</text>',
    actionRail('refresh', screen.locked ? 'play' : null, 'type')
  ].join('\n'));
}

function renderCountdown(screen) {
  var centerX = Math.round(RIGHT / 2);
  return base([
    topBar(screen.activity, 'GET READY', THEME.accent),
    '<circle cx="' + centerX + '" cy="80" r="38" fill="none" stroke="' + THEME.accent +
      '" stroke-width="3"/>',
    '<circle cx="' + centerX + '" cy="80" r="46" fill="none" stroke="' + THEME.muted +
      '" stroke-width="1"/>',
    '<text x="' + centerX + '" y="94" class="timer" fill="' + THEME.text +
      '" text-anchor="middle">' + esc(screen.number) + '</text>',
    '<text x="' + centerX + '" y="132" class="label" text-anchor="middle">' +
      esc(screen.activity) + '</text>'
  ].join('\n'));
}

function renderActivity(screen) {
  var centerX = Math.round(RIGHT / 2);
  return base([
    topBar(screen.activity, 'RECORDING', THEME.accent),
    '<text x="' + centerX + '" y="55" class="timer" fill="' + THEME.text +
      '" text-anchor="middle">' + esc(screen.elapsed) + '</text>',
    row(80, 'DIST', screen.distance),
    row(107, screen.metricLabel, screen.metricValue),
    row(134, 'HR', screen.hr),
    '<text x="' + centerX + '" y="' + (HEIGHT - 6) +
      '" class="footer" text-anchor="middle">' + esc(screen.gps) + '</text>',
    actionRail(null, 'pause', 'save')
  ].join('\n'));
}

function renderPaused(screen) {
  var centerX = Math.round(RIGHT / 2);
  return base([
    topBar(screen.activity, 'PAUSED', THEME.warning),
    '<g fill="' + THEME.warning + '">',
    '<rect x="' + (centerX - 12) + '" y="35" width="8" height="25" rx="2"/>',
    '<rect x="' + (centerX + 4) + '" y="35" width="8" height="25" rx="2"/>',
    '</g>',
    '<text x="' + centerX + '" y="84" class="title" fill="' +
      THEME.warning + '" text-anchor="middle">PAUSED</text>',
    row(114, 'TIME', screen.elapsed),
    row(141, 'DIST', screen.distance),
    actionRail(null, 'play', 'save')
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
  return renderActivity(screen);
}

function pixelActionIcon(canvas, type, cx, cy, color) {
  if (!type) {
    return;
  }

  if (type === 'gps') {
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
  } else if (type === 'save') {
    canvas.line(cx - 5, cy - 6, cx + 5, cy - 6, color, 2);
    canvas.line(cx - 5, cy - 6, cx - 5, cy + 5, color, 2);
    canvas.line(cx + 5, cy - 6, cx + 5, cy + 5, color, 2);
    canvas.line(cx - 5, cy + 5, cx + 5, cy + 5, color, 2);
    canvas.fillRect(cx - 2, cy - 5, 5, 3, color);
    canvas.line(cx - 3, cy + 2, cx + 4, cy + 2, color, 2);
    canvas.line(cx - 3, cy + 8, cx + 4, cy + 8, color, 2);
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

function pixelActionRail(canvas, up, select, down) {
  var railX = WIDTH - ACTION_RAIL_W;
  var iconX = railX + Math.round(ACTION_RAIL_W / 2);
  var color = THEME.text;

  if (!up && !select && !down) {
    return;
  }
  canvas.line(railX, 20, railX, HEIGHT - 8, color, 1);
  pixelActionIcon(canvas, up, iconX, 42, color);
  pixelActionIcon(canvas, select, iconX, 84, color);
  pixelActionIcon(canvas, down, iconX, 126, color);
}

function pixelActivityIcon(canvas, activity, cx, cy, size, color) {
  if (activity === 'CYCLING') {
    var wheelR = Math.round(size / 5);
    var leftX = cx - Math.round(size / 3);
    var rightX = cx + Math.round(size / 3);
    var wheelY = cy + Math.round(size / 5);
    var seatX = cx - Math.round(size / 10);
    var seatY = cy - Math.round(size / 7);
    var barX = cx + Math.round(size / 5);
    var barY = cy - Math.round(size / 5);

    canvas.circle(leftX, wheelY, wheelR, color, 2);
    canvas.circle(rightX, wheelY, wheelR, color, 2);
    canvas.line(leftX, wheelY, cx, wheelY, color, 2);
    canvas.line(cx, wheelY, seatX, seatY, color, 2);
    canvas.line(seatX, seatY, rightX, wheelY, color, 2);
    canvas.line(cx, wheelY, rightX, wheelY, color, 2);
    canvas.line(barX, barY, rightX, wheelY, color, 2);
    canvas.line(seatX - 6, seatY - 2, seatX + 5, seatY - 2, color, 2);
    canvas.line(barX, barY, barX + 9, barY - 3, color, 2);
    canvas.fillCircle(cx, wheelY, 3, color);
  } else if (activity === 'WALKING') {
    var soleW = Math.round(size / 5);
    var soleH = Math.round(size / 2);
    canvas.fillRect(cx - 7, cy - 10, soleW, soleH, color);
    canvas.fillCircle(cx - 8, cy - 12, 2, color);
    canvas.fillRect(cx + 3, cy + 1, soleW, soleH, color);
    canvas.fillCircle(cx + 2, cy - 1, 2, color);
  } else {
    canvas.line(cx - 11, cy - 6, cx - 2, cy - 6, color, 3);
    canvas.line(cx - 13, cy, cx - 5, cy, color, 3);
    canvas.line(cx - 10, cy + 6, cx - 2, cy + 6, color, 3);
    canvas.line(cx + 5, cy - 12, cx - 1, cy - 1, color, 3);
    canvas.line(cx - 1, cy - 1, cx + 6, cy - 1, color, 3);
    canvas.line(cx + 6, cy - 1, cx - 3, cy + 13, color, 3);
  }
}

function pixelTopBar(canvas, activity, state, color) {
  canvas.fillRect(0, 0, RIGHT, 2, color);
  canvas.text(activity, 8, 7, 1, THEME.muted, 'left', true);
  canvas.text(state, RIGHT, 7, 1, color, 'right', true);
}

function pixelTextFit(canvas, text, x, y, maxWidth, scale, color, align, bold) {
  var fittedScale = scale;
  while (fittedScale > 1 && textWidth(String(text), fittedScale) > maxWidth) {
    fittedScale -= 1;
  }
  canvas.text(text, x, y, fittedScale, color, align, bold);
}

function pixelMenuItem(canvas, activity, selected, y) {
  var labelColor = selected ? THEME.onAccent : THEME.text;
  var iconColor = selected ? THEME.onAccent : THEME.accent;

  if (selected) {
    canvas.fillRect(8, y, RIGHT - 12, 31, THEME.accent);
  } else {
    canvas.line(14, y + 30, RIGHT - 4, y + 30, THEME.muted, 1);
  }

  pixelActivityIcon(canvas, activity, 27, y + 16, 26, iconColor);
  pixelTextFit(canvas, activity, 46, y + 8, RIGHT - 50, 2, labelColor,
               'left', true);
}

function pixelRow(canvas, y, label, value) {
  pixelTextFit(canvas, label, 8, y + 1, 42, 2, THEME.muted, 'left', false);
  pixelTextFit(canvas, value, RIGHT, y - 1, RIGHT - 50, 2, THEME.text,
               'right', true);
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
    pixelTextFit(canvas, 'CHOOSE ACTIVITY', centerX, 30, RIGHT - 12, 2,
                 THEME.muted, 'center', false);
    pixelMenuItem(canvas, 'WALKING', screen.activity === 'WALKING', 48);
    pixelMenuItem(canvas, 'RUNNING', screen.activity === 'RUNNING', 81);
    pixelMenuItem(canvas, 'CYCLING', screen.activity === 'CYCLING', 114);
    pixelActionRail(canvas, null, 'gps', 'type');
  } else if (screen.kind === 'gps') {
    pixelTopBar(canvas, screen.activity, screen.state, screen.color);
    pixelGpsIcon(canvas, centerX, 67, screen.color, screen.locked);
    pixelTextFit(canvas, screen.title, centerX, 101, RIGHT - 8, 2,
                 screen.color, 'center', true);
    pixelTextFit(canvas, screen.accuracy, centerX, 127, RIGHT - 8, 2,
                 THEME.text, 'center', false);
    canvas.text(screen.hint, centerX, HEIGHT - 15, 1, THEME.muted, 'center',
                false);
    pixelActionRail(canvas, 'refresh', screen.locked ? 'play' : null, 'type');
  } else if (screen.kind === 'countdown') {
    pixelTopBar(canvas, screen.activity, 'GET READY', THEME.accent);
    canvas.circle(centerX, 80, 38, THEME.accent, 3);
    canvas.circle(centerX, 80, 46, THEME.muted, 1);
    canvas.text(screen.number, centerX, 60, 7, THEME.text, 'center', true);
    canvas.text(screen.activity, centerX, 121, 2, THEME.muted, 'center', false);
  } else if (screen.kind === 'paused') {
    pixelTopBar(canvas, screen.activity, 'PAUSED', THEME.warning);
    canvas.fillRect(centerX - 12, 35, 8, 25, THEME.warning);
    canvas.fillRect(centerX + 4, 35, 8, 25, THEME.warning);
    canvas.text('PAUSED', centerX, 70, 3, THEME.warning, 'center', true);
    pixelRow(canvas, 100, 'TIME', screen.elapsed);
    pixelRow(canvas, 127, 'DIST', screen.distance);
    pixelActionRail(canvas, null, 'play', 'save');
  } else {
    pixelTopBar(canvas, screen.activity, 'RECORDING', THEME.accent);
    canvas.text(screen.elapsed, centerX, 27, 5, THEME.text, 'center', true);
    pixelRow(canvas, 66, 'DIST', screen.distance);
    pixelRow(canvas, 93, screen.metricLabel, screen.metricValue);
    pixelRow(canvas, 120, 'HR', screen.hr);
    canvas.text(screen.gps, centerX, HEIGHT - 14, 1, THEME.muted, 'center',
                false);
    pixelActionRail(canvas, null, 'pause', 'save');
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
