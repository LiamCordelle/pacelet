#!/usr/bin/env node
'use strict';

var fs = require('fs');
var path = require('path');
var zlib = require('zlib');

var ROOT = path.resolve(__dirname, '..');
var IMAGE_DIR = path.join(ROOT, 'resources', 'images');
var STORE_DIR = path.join(ROOT, 'store-assets');
var GRID_SIZE = 16;

var COLORS = {
  green: '#007c54',
  white: '#ffffff',
  yellow: '#ffdc00',
  black: '#000000'
};

var STEM = [
  [3, 2, 2, 12],
  [5, 2, 5, 2],
  [10, 3, 2, 5],
  [9, 7, 2, 2],
  [7, 8, 3, 2]
];

var ENDPOINT = [
  [5, 8, 2, 2]
];

function hexToRgb(hex) {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16)
  };
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

function createCanvas(size, background) {
  var rgba = Buffer.alloc(size * size * 4);
  if (!background) {
    return rgba;
  }

  var color = hexToRgb(background);
  for (var i = 0; i < size * size; i++) {
    var offset = i * 4;
    rgba[offset] = color.r;
    rgba[offset + 1] = color.g;
    rgba[offset + 2] = color.b;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

function fillGridRect(rgba, size, rect, hex) {
  var color = hexToRgb(hex);
  var startX = Math.round(rect[0] * size / GRID_SIZE);
  var startY = Math.round(rect[1] * size / GRID_SIZE);
  var endX = Math.round((rect[0] + rect[2]) * size / GRID_SIZE);
  var endY = Math.round((rect[1] + rect[3]) * size / GRID_SIZE);

  for (var y = startY; y < endY; y++) {
    for (var x = startX; x < endX; x++) {
      var offset = (y * size + x) * 4;
      rgba[offset] = color.r;
      rgba[offset + 1] = color.g;
      rgba[offset + 2] = color.b;
      rgba[offset + 3] = 255;
    }
  }
}

function pngRows(rgba, size) {
  var rowStride = size * 4 + 1;
  var rows = Buffer.alloc(size * rowStride);
  for (var y = 0; y < size; y++) {
    rows[y * rowStride] = 0;
    rgba.copy(rows, y * rowStride + 1, y * size * 4, (y + 1) * size * 4);
  }
  return rows;
}

function writePng(filename, size, background, markColor, endpointColor) {
  var rgba = createCanvas(size, background);
  STEM.forEach(function(rect) {
    fillGridRect(rgba, size, rect, markColor);
  });
  ENDPOINT.forEach(function(rect) {
    fillGridRect(rgba, size, rect, endpointColor);
  });

  var ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  var png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(pngRows(rgba, size))),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(filename, png);
  console.log(filename);
}

function svgRects(rects, color) {
  return rects.map(function(rect) {
    return '<rect x="' + rect[0] + '" y="' + rect[1] +
      '" width="' + rect[2] + '" height="' + rect[3] +
      '" fill="' + color + '"/>';
  }).join('');
}

function writeSvg(filename) {
  var svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" ',
    'shape-rendering="crispEdges">',
    '<rect width="16" height="16" fill="' + COLORS.green + '"/>',
    svgRects(STEM, COLORS.white),
    svgRects(ENDPOINT, COLORS.yellow),
    '</svg>\n'
  ].join('');
  fs.writeFileSync(filename, svg);
  console.log(filename);
}

fs.mkdirSync(IMAGE_DIR, { recursive: true });
fs.mkdirSync(STORE_DIR, { recursive: true });

writePng(
  path.join(IMAGE_DIR, 'app_menu_icon.png'),
  25,
  null,
  COLORS.black,
  COLORS.black
);
writePng(
  path.join(STORE_DIR, 'pacelet-app-icon-144.png'),
  144,
  COLORS.green,
  COLORS.white,
  COLORS.yellow
);
writePng(
  path.join(STORE_DIR, 'pacelet-app-icon-512.png'),
  512,
  COLORS.green,
  COLORS.white,
  COLORS.yellow
);
writeSvg(path.join(STORE_DIR, 'pacelet-app-icon.svg'));
