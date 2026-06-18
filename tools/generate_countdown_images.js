#!/usr/bin/env node
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var OUT_DIR = path.join(ROOT, 'resources', 'images');
var WIDTH = 72;
var HEIGHT = 96;

function crc32(buf) {
  var table = crc32.table;
  if (!table) {
    table = crc32.table = [];
    for (var i = 0; i < 256; i += 1) {
      var c = i;
      for (var k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
  }

  var crc = 0xffffffff;
  for (var j = 0; j < buf.length; j += 1) {
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

function fillRect(mask, x, y, width, height) {
  for (var yy = y; yy < y + height; yy += 1) {
    for (var xx = x; xx < x + width; xx += 1) {
      if (xx >= 0 && yy >= 0 && xx < WIDTH && yy < HEIGHT) {
        mask[yy * WIDTH + xx] = 255;
      }
    }
  }
}

function drawSegment(mask, segment) {
  var segments = {
    top: [14, 6, 44, 12],
    middle: [14, 42, 44, 12],
    bottom: [14, 78, 44, 12],
    upperLeft: [8, 12, 12, 36],
    upperRight: [52, 12, 12, 36],
    lowerLeft: [8, 48, 12, 36],
    lowerRight: [52, 48, 12, 36]
  };
  var rect = segments[segment];
  fillRect(mask, rect[0], rect[1], rect[2], rect[3]);
}

function drawNumber(mask, value) {
  if (value === 1) {
    fillRect(mask, 30, 10, 14, 72);
    fillRect(mask, 20, 16, 12, 12);
    fillRect(mask, 18, 78, 38, 12);
    return;
  }

  var segments = value === 2 ?
    ['top', 'upperRight', 'middle', 'lowerLeft', 'bottom'] :
    ['top', 'upperRight', 'middle', 'lowerRight', 'bottom'];
  for (var i = 0; i < segments.length; i += 1) {
    drawSegment(mask, segments[i]);
  }
}

function rgbaRows(mask, color) {
  var rowStride = WIDTH * 4 + 1;
  var output = Buffer.alloc(HEIGHT * rowStride);
  for (var y = 0; y < HEIGHT; y += 1) {
    output[y * rowStride] = 0;
    for (var x = 0; x < WIDTH; x += 1) {
      var offset = y * rowStride + 1 + x * 4;
      output[offset] = color;
      output[offset + 1] = color;
      output[offset + 2] = color;
      output[offset + 3] = mask[y * WIDTH + x];
    }
  }
  return output;
}

function writeNumber(value, variant, color) {
  var mask = new Uint8Array(WIDTH * HEIGHT);
  var ihdr = Buffer.alloc(13);
  var filename = 'countdown_' + value + '_' + variant + '.png';

  drawNumber(mask, value);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  var png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(rgbaRows(mask, color))),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(path.join(OUT_DIR, filename), png);
  console.log(path.join(OUT_DIR, filename));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (var value = 1; value <= 3; value += 1) {
  writeNumber(value, 'black', 0);
  writeNumber(value, 'white', 255);
}
