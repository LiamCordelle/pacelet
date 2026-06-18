#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var materialIcons = require('./material_icons');

var ROOT = path.resolve(__dirname, '..');
var OUT_DIR = path.join(ROOT, 'resources', 'images');

function rgba(hex) {
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  };
}

function pngRows(alpha, width, height, color) {
  var rowStride = width * 4 + 1;
  var out = Buffer.alloc(height * rowStride);
  for (var y = 0; y < height; y++) {
    out[y * rowStride] = 0;
    for (var x = 0; x < width; x++) {
      var offset = y * rowStride + 1 + x * 4;
      out[offset] = color.r;
      out[offset + 1] = color.g;
      out[offset + 2] = color.b;
      out[offset + 3] = alpha[y * width + x];
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

function writePng(name, iconName, size, padding, colorHex) {
  var alpha = materialIcons.rasterize(
    materialIcons.readIcon(iconName),
    size,
    size,
    padding,
    4
  );
  var color = rgba(colorHex);
  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  var png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(
      pngRows(alpha, size, size, color)
    )),
    chunk('IEND', Buffer.alloc(0))
  ]);

  fs.writeFileSync(path.join(OUT_DIR, name), png);
}

var icons = [
  ['activity_walk', 'WALKING', 34, 1],
  ['activity_run', 'RUNNING', 34, 1],
  ['activity_cycle', 'CYCLING', 34, 0],
  ['heart', 'HEART', 24, 1],
  ['heart_measuring', 'HEART', 16, 1]
];

fs.mkdirSync(OUT_DIR, { recursive: true });
icons.forEach(function(icon) {
  [
    ['black', '000000'],
    ['white', 'ffffff']
  ].forEach(function(variant) {
    var name = icon[0] + '_' + variant[0] + '.png';
    writePng(name, icon[1], icon[2], icon[3], variant[1]);
    console.log(path.join(OUT_DIR, name));
  });
});
