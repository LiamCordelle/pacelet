#!/usr/bin/env node
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var OUT_DIR = path.join(ROOT, 'resources', 'images');
var SIZE = 28;
var SCALE = 4;
var CANVAS = SIZE * SCALE;

function rgba(hex, alpha) {
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16),
    a: alpha == null ? 255 : alpha
  };
}

function canvas() {
  var pixels = [];
  for (var i = 0; i < CANVAS * CANVAS; i++) {
    pixels.push(0);
  }
  return pixels;
}

function plot(pixels, x, y) {
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= CANVAS || y >= CANVAS) {
    return;
  }
  pixels[y * CANVAS + x] = 255;
}

function fillCircle(pixels, cx, cy, radius) {
  cx *= SCALE;
  cy *= SCALE;
  radius *= SCALE;
  var minX = Math.floor(cx - radius);
  var maxX = Math.ceil(cx + radius);
  var minY = Math.floor(cy - radius);
  var maxY = Math.ceil(cy + radius);
  var r2 = radius * radius;

  for (var y = minY; y <= maxY; y++) {
    for (var x = minX; x <= maxX; x++) {
      var dx = x + 0.5 - cx;
      var dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) {
        plot(pixels, x, y);
      }
    }
  }
}

function line(pixels, x1, y1, x2, y2, width) {
  x1 *= SCALE;
  y1 *= SCALE;
  x2 *= SCALE;
  y2 *= SCALE;
  width *= SCALE;

  var minX = Math.floor(Math.min(x1, x2) - width);
  var maxX = Math.ceil(Math.max(x1, x2) + width);
  var minY = Math.floor(Math.min(y1, y2) - width);
  var maxY = Math.ceil(Math.max(y1, y2) + width);
  var vx = x2 - x1;
  var vy = y2 - y1;
  var len2 = vx * vx + vy * vy;
  var radius = width / 2;

  for (var y = minY; y <= maxY; y++) {
    for (var x = minX; x <= maxX; x++) {
      var t = len2 === 0 ? 0 :
        ((x + 0.5 - x1) * vx + (y + 0.5 - y1) * vy) / len2;
      t = Math.max(0, Math.min(1, t));
      var px = x1 + vx * t;
      var py = y1 + vy * t;
      var dx = x + 0.5 - px;
      var dy = y + 0.5 - py;
      if (dx * dx + dy * dy <= radius * radius) {
        plot(pixels, x, y);
      }
    }
  }
}

function strokeCircle(pixels, cx, cy, radius, width) {
  cx *= SCALE;
  cy *= SCALE;
  radius *= SCALE;
  width *= SCALE;
  var minX = Math.floor(cx - radius - width);
  var maxX = Math.ceil(cx + radius + width);
  var minY = Math.floor(cy - radius - width);
  var maxY = Math.ceil(cy + radius + width);
  var outer = radius + width / 2;
  var inner = Math.max(0, radius - width / 2);

  for (var y = minY; y <= maxY; y++) {
    for (var x = minX; x <= maxX; x++) {
      var dx = x + 0.5 - cx;
      var dy = y + 0.5 - cy;
      var dist2 = dx * dx + dy * dy;
      if (dist2 <= outer * outer && dist2 >= inner * inner) {
        plot(pixels, x, y);
      }
    }
  }
}

function downsample(mask, color) {
  var out = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  var rowStride = SIZE * 4 + 1;
  for (var y = 0; y < SIZE; y++) {
    out[y * rowStride] = 0;
    for (var x = 0; x < SIZE; x++) {
      var total = 0;
      for (var yy = 0; yy < SCALE; yy++) {
        for (var xx = 0; xx < SCALE; xx++) {
          total += mask[(y * SCALE + yy) * CANVAS + x * SCALE + xx];
        }
      }
      var alpha = Math.round(total / (SCALE * SCALE));
      var offset = y * rowStride + 1 + x * 4;
      out[offset] = color.r;
      out[offset + 1] = color.g;
      out[offset + 2] = color.b;
      out[offset + 3] = alpha;
    }
  }
  return out;
}

function crc32(buf) {
  var table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
  }

  var crc = 0xffffffff;
  for (var j = 0; j < buf.length; j++) {
    crc = table[(crc ^ buf[j]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  var typeBuf = Buffer.from(type, 'ascii');
  var len = Buffer.alloc(4);
  var crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function writePng(name, draw, colorHex) {
  var mask = canvas();
  draw(mask);
  var color = rgba(colorHex);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  var png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(downsample(mask, color))),
    chunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(path.join(OUT_DIR, name), png);
}

function drawWalking(p) {
  fillCircle(p, 14.0, 4.8, 3.1);
  line(p, 13.8, 8.2, 13.0, 14.8, 3.0);
  line(p, 13.2, 10.5, 8.6, 15.3, 2.5);
  line(p, 13.2, 10.5, 18.0, 10.1, 2.5);
  line(p, 13.0, 14.5, 9.5, 22.4, 3.0);
  line(p, 9.5, 22.4, 5.6, 22.9, 2.4);
  line(p, 13.1, 14.7, 18.3, 21.0, 3.0);
  line(p, 18.3, 21.0, 21.8, 23.4, 2.4);
}

function drawRunning(p) {
  fillCircle(p, 14.6, 4.7, 3.0);
  line(p, 13.6, 8.5, 10.6, 14.4, 3.0);
  line(p, 12.2, 10.3, 6.6, 10.6, 2.6);
  line(p, 12.2, 10.4, 16.9, 14.2, 2.6);
  line(p, 10.8, 14.2, 6.0, 21.0, 3.2);
  line(p, 6.0, 21.0, 2.6, 20.6, 2.4);
  line(p, 10.8, 14.2, 19.0, 16.6, 3.2);
  line(p, 19.0, 16.6, 23.8, 23.2, 2.9);
  line(p, 2.8, 7.8, 7.5, 7.8, 1.4);
  line(p, 2.2, 14.0, 6.1, 14.0, 1.4);
  line(p, 2.5, 25.0, 8.0, 25.0, 1.4);
}

function drawCycling(p) {
  strokeCircle(p, 7.5, 20.8, 5.0, 2.0);
  strokeCircle(p, 21.0, 20.8, 5.0, 2.0);
  line(p, 7.5, 20.8, 13.5, 20.8, 2.0);
  line(p, 13.5, 20.8, 11.8, 13.2, 2.0);
  line(p, 11.8, 13.2, 21.0, 20.8, 2.0);
  line(p, 13.5, 20.8, 18.0, 13.0, 2.0);
  line(p, 18.0, 13.0, 21.0, 20.8, 2.0);
  line(p, 11.0, 12.4, 14.2, 12.4, 2.0);
  line(p, 17.8, 13.0, 22.5, 11.7, 1.8);
  line(p, 22.5, 11.7, 25.0, 13.1, 1.8);
  fillCircle(p, 13.5, 20.8, 2.0);
}

var icons = [
  ['activity_walk_black.png', drawWalking, '000000'],
  ['activity_walk_white.png', drawWalking, 'ffffff'],
  ['activity_run_black.png', drawRunning, '000000'],
  ['activity_run_white.png', drawRunning, 'ffffff'],
  ['activity_cycle_black.png', drawCycling, '000000'],
  ['activity_cycle_white.png', drawCycling, 'ffffff']
];

fs.mkdirSync(OUT_DIR, { recursive: true });
icons.forEach(function(icon) {
  writePng(icon[0], icon[1], icon[2]);
  console.log(path.join(OUT_DIR, icon[0]));
});
