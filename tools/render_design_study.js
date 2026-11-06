#!/usr/bin/env node
'use strict';

// A visual design study, not the shipping watch renderer. Every watch frame is
// authored at Emery's native 200 x 228 pixels using flat 64-color-palette
// values, text, strokes, circles, and rectangles that map to Pebble primitives.
var fs = require('fs');
var path = require('path');

var OUT = path.join(__dirname, '..', 'docs', 'design', 'route-ribbon');
var W = 200;
var H = 228;
var RAIL_X = 180;
var C = {
  white: '#FFFFFF',
  black: '#000000',
  gray: '#555555',
  lightGray: '#AAAAAA',
  teal: '#005555',
  cyan: '#00AAAA',
  lime: '#AAFF00',
  amber: '#FFAA00',
  amberInk: '#AA5500',
  coral: '#FF5555',
  redInk: '#AA0000'
};

function esc(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function rect(x, y, w, h, fill, radius, stroke, strokeWidth) {
  return '<rect x="' + x + '" y="' + y + '" width="' + w +
    '" height="' + h + '" rx="' + (radius || 0) + '" fill="' + fill +
    '"' + (stroke ? ' stroke="' + stroke + '" stroke-width="' +
      (strokeWidth || 1) + '"' : '') + '/>';
}

function circle(x, y, radius, fill, stroke, strokeWidth) {
  return '<circle cx="' + x + '" cy="' + y + '" r="' + radius +
    '" fill="' + (fill || 'none') + '"' +
    (stroke ? ' stroke="' + stroke + '" stroke-width="' +
      (strokeWidth || 1) + '"' : '') + '/>';
}

function line(x1, y1, x2, y2, color, width) {
  return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 +
    '" y2="' + y2 + '" stroke="' + color + '" stroke-width="' +
    (width || 1) + '" stroke-linecap="round"/>';
}

function curve(d, color, width, fill) {
  return '<path d="' + d + '" stroke="' + color + '" stroke-width="' +
    (width || 1) + '" fill="' + (fill || 'none') +
    '" stroke-linecap="round" stroke-linejoin="round"/>';
}

function text(x, y, value, size, color, weight, anchor, spacing) {
  return '<text x="' + x + '" y="' + y + '" fill="' + color +
    '" font-family="Arial,Helvetica,sans-serif" font-size="' + size +
    '" font-weight="' + (weight || 400) + '"' +
    (anchor ? ' text-anchor="' + anchor + '"' : '') +
    (spacing ? ' letter-spacing="' + spacing + '"' : '') +
    '>' + esc(value) + '</text>';
}

function palette(dark) {
  return {
    bg: dark ? C.black : C.white,
    ink: dark ? C.white : C.black,
    muted: dark ? C.lightGray : C.gray,
    panel: dark ? C.teal : C.white,
    edge: dark ? C.teal : C.lightGray,
    rail: dark ? C.white : C.black,
    railInk: dark ? C.black : C.white
  };
}

function icon(name, x, y, color) {
  if (name === 'up') {
    return curve('M ' + (x - 5) + ' ' + (y + 3) + ' L ' + x + ' ' +
      (y - 3) + ' L ' + (x + 5) + ' ' + (y + 3), color, 2);
  }
  if (name === 'down') {
    return curve('M ' + (x - 5) + ' ' + (y - 3) + ' L ' + x + ' ' +
      (y + 3) + ' L ' + (x + 5) + ' ' + (y - 3), color, 2);
  }
  if (name === 'play') {
    return curve('M ' + (x - 4) + ' ' + (y - 6) + ' L ' +
      (x + 5) + ' ' + y + ' L ' + (x - 4) + ' ' + (y + 6) + ' Z',
      color, 1, color);
  }
  if (name === 'pause') {
    return rect(x - 5, y - 6, 3, 12, color, 1) +
      rect(x + 2, y - 6, 3, 12, color, 1);
  }
  if (name === 'stop') {
    return rect(x - 5, y - 5, 10, 10, color, 2);
  }
  if (name === 'check') {
    return curve('M ' + (x - 6) + ' ' + y + ' L ' + (x - 2) +
      ' ' + (y + 4) + ' L ' + (x + 6) + ' ' + (y - 5), color, 2);
  }
  if (name === 'close') {
    return line(x - 5, y - 5, x + 5, y + 5, color, 2) +
      line(x + 5, y - 5, x - 5, y + 5, color, 2);
  }
  if (name === 'refresh') {
    return curve('M ' + (x + 5) + ' ' + (y - 2) +
      ' A 6 6 0 1 0 ' + (x + 4) + ' ' + (y + 4), color, 2) +
      curve('M ' + (x + 1) + ' ' + (y - 6) + ' L ' +
      (x + 6) + ' ' + (y - 6) + ' L ' + (x + 6) + ' ' +
      (y - 1), color, 2);
  }
  if (name === 'gps') {
    return circle(x, y, 5, 'none', color, 2) +
      circle(x, y, 1.7, color) +
      line(x, y - 8, x, y - 6, color, 2) +
      line(x, y + 6, x, y + 8, color, 2) +
      line(x - 8, y, x - 6, y, color, 2) +
      line(x + 6, y, x + 8, y, color, 2);
  }
  if (name === 'history') {
    return circle(x, y, 6, 'none', color, 2) +
      line(x, y, x, y - 4, color, 2) +
      line(x, y, x + 3, y + 2, color, 2);
  }
  if (name === 'file') {
    return rect(x - 5, y - 7, 10, 14, 'none', 1, color, 1) +
      line(x - 2, y - 2, x + 2, y - 2, color, 1) +
      line(x - 2, y + 2, x + 2, y + 2, color, 1);
  }
  if (name === 'menu') {
    return line(x - 5, y - 4, x + 5, y - 4, color, 2) +
      line(x - 5, y, x + 5, y, color, 2) +
      line(x - 5, y + 4, x + 5, y + 4, color, 2);
  }
  return '';
}

function rail(buttons, dark, highlight) {
  var p = palette(dark);
  var ys = [57, 114, 171];
  var result = rect(RAIL_X, 0, W - RAIL_X, H, p.rail) +
    rect(RAIL_X, 0, 2, H, C.teal);
  for (var i = 0; i < 3; i += 1) {
    if (!buttons[i]) {
      result += line(187, ys[i], 193, ys[i], dark ? C.gray : C.gray, 1);
      continue;
    }
    if (highlight === i) {
      result += circle(190, ys[i], 10, C.lime);
    }
    result += icon(buttons[i], 190, ys[i],
                   highlight === i ? C.black : p.railInk);
  }
  return result;
}

function chrome(mode, dark, buttons, highlight) {
  var p = palette(dark);
  return rect(0, 0, W, H, p.bg) +
    circle(12, 14, 3, C.lime) +
    text(21, 19, mode, 11, p.ink, 700, null, .4) +
    text(171, 19, '10:09', 12, p.ink, 700, 'end') +
    line(8, 27, 172, 27, p.edge, 1) +
    rail(buttons, dark, highlight);
}

function tag(x, y, value, color) {
  return circle(x, y - 4, 3, color) +
    text(x + 8, y, value, 10, color, 700, null, .3);
}

function routeMark(x, y, color) {
  return curve('M ' + x + ' ' + y + ' L ' + (x + 9) + ' ' + y +
    ' L ' + (x + 9) + ' ' + (y - 8) + ' L ' + (x + 23) + ' ' +
    (y - 8), color, 2) +
    circle(x, y, 2, color) + circle(x + 23, y - 8, 3, color);
}

function countdownDigit(number) {
  var points = number === 3 ?
    [[68, 89], [76, 80], [90, 76], [104, 79], [113, 90],
     [115, 103], [110, 113], [99, 119], [86, 120], [101, 120],
     [111, 127], [116, 139], [113, 151], [104, 159],
     [91, 163], [76, 161], [67, 154]] :
    number === 2 ?
    [[68, 89], [76, 80], [90, 76], [104, 79], [113, 90],
     [115, 103], [110, 115], [99, 126], [85, 139],
     [70, 153], [67, 162], [116, 162]] :
    [[72, 99], [91, 78], [91, 163]];
  return curve('M ' + points.map(function(point) {
    return point[0] + ' ' + point[1];
  }).join(' L '), C.white, 6);
}

function metricCard(x, label, value, unit, dark) {
  var p = palette(dark);
  var caption = label === 'DISTANCE' ? 'DIST ' + unit :
    label === 'SPEED' ? 'SPEED ' + unit :
    label === 'STEPS' ? 'STEPS' : 'PACE ' + unit;
  return rect(x, 119, 78, 58, p.panel, 7, p.edge) +
    text(x + 8, 136, caption, label === 'SPEED' ? 10 : 11,
         dark ? C.white : p.muted,
         700, null, .1) +
    text(x + 8, 164, value,
         value.length > 5 ? 17 : value.length > 4 ? 22 : 24,
         p.ink, 700);
}

function heartRow(bpm, zone, dark, measuring) {
  var p = palette(dark);
  var zoneColor = measuring ? p.muted :
    zone === 3 ? C.coral : zone === 2 ? C.amber : C.cyan;
  return rect(8, 185, 164, 34, p.panel, 7, p.edge) +
    rect(8, 185, 4, 34, zoneColor, 2) +
    circle(27, 202, 8, 'none', zoneColor, 1.5) +
    curve('M 23 202 L 25 202 L 27 199 L 29 205 L 31 202',
          zoneColor, 1) +
    text(42, 199, measuring ? 'HR FINDING' : 'HEART Z' + zone,
         10, dark ? C.white : p.muted, 700) +
    text(164, 208, measuring ? '--' : String(bpm), 23, p.ink, 700,
         'end');
}

function choose() {
  var p = palette(false);
  var out = chrome('PACELET', false, ['up', 'gps', 'down'], 1);
  out += text(8, 55, 'Choose activity', 22, p.ink, 700);
  out += text(8, 70, 'ACTIVITY', 10, p.muted, 700, null, 1);
  out += line(28, 82, 28, 178, C.teal, 2);
  var rows = [
    {y: 78, title: 'Walking', icon: '01', chosen: false},
    {y: 117, title: 'Running', icon: '02', chosen: true},
    {y: 156, title: 'Cycling', icon: '03', chosen: false}
  ];
  rows.forEach(function(row) {
    var fill = row.chosen ? C.teal : C.white;
    var ink = row.chosen ? C.white : p.ink;
    out += rect(8, row.y, 164, 34, fill, 7,
                row.chosen ? C.teal : C.lightGray);
    out += circle(28, row.y + 17, 8, row.chosen ? C.lime : C.white,
                  row.chosen ? C.lime : C.teal, 2);
    out += text(28, row.y + 21, row.icon, 8,
                row.chosen ? C.black : C.teal, 700, 'middle');
    out += text(47, row.y + 23, row.title, 17, ink, 700);
    if (row.chosen) {
      out += routeMark(139, row.y + 23, C.lime);
    }
  });
  out += line(8, 198, 172, 198, C.lightGray);
  out += icon('history', 24, 210, C.teal);
  out += text(42, 215, 'Activity history', 13, p.ink, 700);
  return out;
}

function gps(locked, frame) {
  var p = palette(false);
  var state = locked ? 'GPS READY' : 'GPS SEARCH';
  var out = chrome('RUNNING', false,
                   ['refresh', locked ? 'play' : '', 'menu'],
                   locked ? 1 : -1);
  out += tag(12, 49, state, locked ? C.teal : C.gray);
  out += rect(8, 58, 164, 131, C.teal, 8);
  var centerX = 90;
  var centerY = 112;
  out += circle(centerX, centerY, 42, 'none', C.cyan, 1);
  out += circle(centerX, centerY, 29, 'none', C.cyan, 1);
  out += circle(centerX, centerY, locked ? 15 : 9,
                locked ? C.lime : C.white);
  if (locked) {
    out += icon('check', centerX, centerY, C.black);
  } else {
    var dots = [
      [centerX, centerY - 42],
      [centerX + 42, centerY],
      [centerX, centerY + 42],
      [centerX - 42, centerY]
    ];
    if (frame >= 0) {
      out += circle(dots[frame % dots.length][0],
                    dots[frame % dots.length][1], 4, C.lime);
    }
    out += circle(centerX, centerY, 2, C.teal);
  }
  out += text(centerX, 176, locked ? 'GPS locked' : 'Finding GPS',
              20, C.white, 700, 'middle');
  out += text(8, 209, locked ? '12 m' : '38 m',
              23, p.ink, 700);
  out += text(172, 207, locked ? 'PRESS SELECT' : 'TARGET 25 m', 10,
              locked ? C.teal : C.gray, 700, 'end');
  out += rect(8, 215, locked ? 164 : 100, 3,
              locked ? C.lime : C.amber, 1);
  return out;
}

function gpsError() {
  var p = palette(false);
  var out = chrome('RUNNING', false, ['refresh', '', 'menu'], -1);
  out += tag(12, 49, 'GPS ERROR', C.redInk);
  out += rect(8, 58, 164, 131, C.teal, 8);
  out += circle(90, 112, 42, 'none', C.coral, 2);
  out += circle(90, 112, 17, C.coral);
  out += icon('close', 90, 112, C.black);
  out += text(90, 176, 'Signal lost', 20, C.white, 700, 'middle');
  out += text(8, 209, 'Phone GPS unavailable', 13, p.ink, 700);
  out += text(172, 218, 'UP RETRY', 9, C.redInk, 700, 'end');
  return out;
}

function countdown(number) {
  var out = chrome('RUNNING', false, ['', '', ''], -1);
  out += tag(12, 48, 'STARTING', C.teal);
  out += rect(8, 58, 164, 139, C.teal, 8);
  out += circle(90, 123, 55, 'none', C.cyan, 3);
  for (var i = 0; i < 3; i += 1) {
    var x = 54 + i * 36;
    out += rect(x, 181, 24, 4, i < 4 - number ? C.lime : C.cyan, 2);
  }
  out += countdownDigit(number);
  out += text(90, 216, 'RUNNING', 12, C.gray, 700, 'middle', 1);
  return out;
}

function active(mode, opts) {
  var dark = !!opts.dark;
  var p = palette(dark);
  var paused = !!opts.paused;
  var offline = opts.gps === 'PHONE OFFLINE';
  var gpsText = offline ? 'PHONE OFF' : opts.gps || 'GPS 10 m';
  var out = chrome(mode, dark,
                   [paused ? 'play' : 'pause', paused ? 'stop' : '', ''],
                   paused ? 0 : -1);
  out += rect(8, 34, 164, 78, paused ? C.amber : C.teal, 8);
  out += line(18, 47, 18, 99, paused ? C.black : C.lime, 2);
  out += circle(18, 47, 3, paused ? C.black : C.lime);
  out += circle(18, 99, 3, paused ? C.black : C.lime);
  out += text(28, 53, paused ? 'PAUSED' : 'ELAPSED', 11,
              paused ? C.black : C.white, 700, null, .7);
  out += text(161, 53, gpsText, 10,
              paused ? C.black : C.white, 700, 'end');
  if (offline) {
    out += circle(95, 49, 3, C.coral);
  }
  var elapsed = opts.time || '23:14';
  out += text(91, 99, elapsed, elapsed.length > 5 ? 34 : 43,
              paused ? C.black : C.white, 700, 'middle');
  out += metricCard(8, 'DISTANCE', opts.distance || '4.62',
                    opts.distanceUnit || 'KM', dark);
  out += metricCard(94, opts.metricLabel || 'PACE',
                    opts.metric || '5:02',
                    opts.metricUnit || '/KM', dark);
  out += heartRow(opts.hr === undefined ? 153 : opts.hr,
                  opts.zone === undefined ? 2 : opts.zone,
                  dark, !!opts.measuring);
  return out;
}

function split() {
  var p = palette(false);
  var out = chrome('RUNNING', false, ['pause', '', ''], -1);
  out += tag(12, 49, 'KILOMETRE SPLIT', C.teal);
  out += rect(8, 58, 164, 91, C.teal, 8);
  out += routeMark(136, 80, C.lime);
  out += text(20, 85, 'KM 04', 21, C.lime, 700);
  out += text(90, 134, '05:02', 42, C.white, 700, 'middle');
  out += rect(8, 157, 78, 48, p.panel, 7, p.edge);
  out += rect(94, 157, 78, 48, p.panel, 7, p.edge);
  out += text(16, 174, 'SPLIT PACE', 10, p.muted, 700);
  out += text(16, 194, '5:02', 22, p.ink, 700);
  out += text(102, 174, 'HEART · Z2', 10, p.muted, 700);
  out += text(102, 194, '154', 22, p.ink, 700);
  out += text(90, 220, 'BACK TO RUN IN 6 s', 9, p.muted, 700, 'middle');
  return out;
}

function recovery() {
  var p = palette(false);
  var out = chrome('RUNNING', false, ['play', 'stop', 'close'], -1);
  out += tag(12, 47, 'ACTIVITY FOUND', C.amberInk);
  out += rect(8, 56, 164, 62, C.teal, 8);
  out += text(18, 80, 'Ready to resume', 16, C.white, 700);
  out += text(18, 102, 'RUNNING · PARTIAL', 11, C.lime, 700);
  out += rect(8, 127, 78, 49, p.panel, 7, p.edge);
  out += rect(94, 127, 78, 49, p.panel, 7, p.edge);
  out += text(16, 144, 'TIME', 10, p.muted, 700);
  out += text(16, 165, '23:14', 21, p.ink, 700);
  out += text(102, 144, 'DISTANCE', 10, p.muted, 700);
  out += text(102, 165, '4.62', 23, p.ink, 700);
  out += text(8, 196, 'Phone draft available', 11, C.teal, 700);
  out += text(8, 214, 'UP RESUME  ·  SELECT FINISH', 10, p.muted, 700);
  return out;
}

function confirm(discard) {
  var p = palette(false);
  var out = chrome('RUNNING', false, ['check', '', 'close'], -1);
  out += tag(12, 48, discard ? 'PERMANENT ACTION' : 'FINISH ACTIVITY',
             C.redInk);
  out += rect(8, 57, 164, 128, C.teal, 8);
  out += rect(19, 70, 27, 27, C.coral, 5);
  out += icon(discard ? 'close' : 'stop', 32, 83, C.black);
  out += text(18, 124, discard ? 'Discard this' : 'Finish this',
              22, C.white, 700);
  out += text(18, 148, discard ? 'activity?' : 'run?',
              22, C.white, 700);
  out += text(18, 171, discard ? 'Cannot be undone' : '23:14 elapsed',
              12, C.lime, 700);
  out += text(8, 205, 'UP ' + (discard ? 'DELETE' : 'SAVE') +
              '  ·  DOWN BACK', 10, p.ink, 700);
  return out;
}

function saved() {
  var p = palette(false);
  var out = chrome('RUNNING', false, ['play', '', 'menu'], -1);
  out += rect(8, 37, 164, 94, C.teal, 8);
  out += circle(46, 84, 25, C.lime);
  out += icon('check', 46, 84, C.black);
  out += text(82, 81, 'Saved.', 24, C.white, 700);
  out += text(82, 101, 'RUNNING', 11, C.lime, 700, null, .5);
  out += rect(8, 141, 78, 58, p.panel, 7, p.edge);
  out += rect(94, 141, 78, 58, p.panel, 7, p.edge);
  out += text(16, 159, 'TIME', 10, p.muted, 700);
  out += text(16, 183, '23:14', 21, p.ink, 700);
  out += text(102, 159, 'DISTANCE', 10, p.muted, 700);
  out += text(102, 183, '4.62', 23, p.ink, 700);
  out += text(90, 220, '286 GPS POINTS', 10, p.muted, 700, 'middle');
  return out;
}

function historyList() {
  var p = palette(false);
  var out = chrome('HISTORY', false, ['up', 'check', 'down'], -1);
  out += text(8, 51, 'Recent activity', 22, p.ink, 700);
  var items = [
    ['01', 'RUN', '23:14', '4.62 KM · 5:02/KM', 'OK'],
    ['02', 'RUN', '18:56', '3.18 KM · 5:57/KM', 'FAIL'],
    ['03', 'RIDE', '41:08', '18.74 KM · 27.3 KM/H', 'WAIT']
  ];
  items.forEach(function(item, index) {
    var y = 61 + index * 48;
    var selected = index === 1;
    var fill = selected ? C.teal : p.panel;
    var ink = selected ? C.white : p.ink;
    out += rect(8, y, 164, 43, fill, 7,
                selected ? C.teal : p.edge);
    out += text(16, y + 16, item[0], 10,
                selected ? C.lime : C.teal, 700);
    out += text(36, y + 17, item[1] + '  ' + item[2], 13, ink, 700);
    out += text(16, y + 34, item[3], 10,
                selected ? C.white : p.muted, 400);
    out += circle(157, y + 13, 3,
                  item[4] === 'FAIL' ? C.coral :
                    item[4] === 'OK' ? C.lime : C.amber);
  });
  out += icon('down', 14, 217, C.teal);
  out += text(25, 220, 'More activity', 10, p.muted, 700);
  return out;
}

function historyDetail() {
  var p = palette(false);
  var out = chrome('HISTORY', false, ['file', 'refresh', 'close'], -1);
  out += tag(12, 47, 'RUNNING · 02 / 03', C.teal);
  out += rect(8, 56, 164, 67, C.teal, 8);
  out += text(18, 75, 'DISTANCE', 10, C.lime, 700);
  out += text(18, 111, '3.18', 38, C.white, 700);
  out += text(129, 108, 'KM', 12, C.white, 700);
  out += rect(8, 132, 78, 51, p.panel, 7, p.edge);
  out += rect(94, 132, 78, 51, p.panel, 7, p.edge);
  out += text(16, 149, 'TIME', 10, p.muted, 700);
  out += text(16, 172, '18:56', 21, p.ink, 700);
  out += text(102, 149, 'AVG PACE', 10, p.muted, 700);
  out += text(102, 172, '5:57', 23, p.ink, 700);
  out += circle(14, 198, 4, C.coral);
  out += text(24, 202, 'STRAVA FAILED', 11, C.redInk, 700);
  out += text(8, 220, 'UP TCX  ·  SELECT RETRY', 10, p.muted, 700);
  return out;
}

function historyEmpty() {
  var p = palette(false);
  var out = chrome('HISTORY', false, ['refresh', '', 'close'], -1);
  out += text(8, 52, 'Recent activity', 22, p.ink, 700);
  out += rect(8, 68, 164, 111, p.panel, 8, p.edge);
  out += line(43, 103, 87, 103, C.teal, 2);
  out += circle(43, 103, 6, C.lime, C.teal, 2);
  out += circle(87, 103, 6, C.white, C.teal, 2);
  out += text(18, 139, 'No activities yet', 19, p.ink, 700);
  out += text(18, 159, 'Your route starts here.', 12, p.muted, 400);
  out += text(8, 215, 'UP REFRESH  ·  DOWN BACK', 10, p.muted, 700);
  return out;
}

var screens = [
  {name: '01-choose', label: 'Choose', markup: choose()},
  {name: '02-gps-search', label: 'GPS search', markup: gps(false, 0)},
  {name: '03-gps-ready', label: 'GPS ready', markup: gps(true, 0)},
  {name: '04-countdown', label: 'Countdown', markup: countdown(3)},
  {name: '05-walking', label: 'Walking', markup: active('WALKING',
    {time: '18:42', distance: '1.32', metricLabel: 'STEPS',
      metric: '2210', metricUnit: '', hr: 112, zone: 1})},
  {name: '06-running', label: 'Running', markup: active('RUNNING', {})},
  {name: '07-cycling', label: 'Cycling', markup: active('CYCLING',
    {time: '41:08', distance: '18.74', metricLabel: 'SPEED',
      metric: '27.3', metricUnit: 'KM/H', hr: 146, zone: 2})},
  {name: '08-split', label: 'Kilometre split', markup: split()},
  {name: '09-paused', label: 'Paused', markup: active('RUNNING',
    {paused: true})},
  {name: '10-recovery', label: 'Recovery', markup: recovery()},
  {name: '11-finish-confirm', label: 'Finish confirm', markup: confirm(false)},
  {name: '12-discard-confirm', label: 'Discard confirm', markup: confirm(true)},
  {name: '13-saved', label: 'Saved', markup: saved()},
  {name: '14-history-list', label: 'History list', markup: historyList()},
  {name: '15-history-detail', label: 'History detail', markup: historyDetail()},
  {name: '16-dark-running', label: 'Dark mode', markup: active('RUNNING',
    {dark: true})},
  {name: '17-gps-error', label: 'GPS error', markup: gpsError()},
  {name: '18-measuring-hr', label: 'Finding HR', markup: active('RUNNING',
    {time: '00:18', distance: '42', distanceUnit: 'M',
      metric: '--:--', measuring: true, hr: 0, zone: 0})},
  {name: '19-phone-offline', label: 'Phone offline',
    markup: active('RUNNING', {gps: 'PHONE OFFLINE'})},
  {name: '20-history-empty', label: 'Empty history',
    markup: historyEmpty()}
];

function svg(markup) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + W +
    '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
    markup + '</svg>\n';
}

function overview() {
  var cellW = 224;
  var cellH = 263;
  var cols = 4;
  var rows = Math.ceil(screens.length / cols);
  var width = cols * cellW;
  var height = rows * cellH;
  var parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + width +
      '" height="' + height + '" viewBox="0 0 ' + width + ' ' +
      height + '">',
    rect(0, 0, width, height, '#EEEEEE')
  ];
  screens.forEach(function(screen, index) {
    var x = (index % cols) * cellW + 12;
    var y = Math.floor(index / cols) * cellH + 24;
    parts.push(text(x, y - 8, screen.label, 12, C.black, 700));
    parts.push('<g transform="translate(' + x + ' ' + y + ')">');
    parts.push(screen.markup);
    parts.push('</g>');
  });
  parts.push('</svg>\n');
  return parts.join('');
}

function phoneSettings() {
  var out = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="390" height="925" ',
    'viewBox="0 0 390 925">',
    rect(0, 0, 390, 925, C.white),
    rect(0, 0, 390, 193, C.teal),
    routeMark(25, 41, C.lime),
    text(25, 94, 'Pacelet', 38, C.white, 700),
    text(25, 119, 'Your route, your rhythm.', 16, C.white, 400),
    rect(25, 145, 124, 27, C.lime, 8),
    text(87, 163, 'WATCH SETTINGS', 11, C.black, 700, 'middle'),
    text(25, 228, 'Appearance', 22, C.black, 700),
    rect(25, 243, 340, 80, C.white, 8, C.lightGray),
    text(42, 271, 'Watch display', 15, C.black, 700),
    text(42, 295, 'Light mode', 13, C.gray, 400),
    rect(287, 263, 59, 32, C.teal, 8),
    circle(328, 279, 12, C.lime),
    text(25, 357, 'Heart rate zones', 22, C.black, 700),
    rect(25, 372, 340, 123, C.white, 8, C.lightGray),
    text(42, 399, 'ZONE 1', 13, C.gray, 700),
    text(346, 399, '100 bpm', 14, C.black, 700, 'end'),
    line(42, 410, 348, 410, C.lightGray),
    text(42, 435, 'ZONE 2', 13, C.gray, 700),
    text(346, 435, '130 bpm', 14, C.black, 700, 'end'),
    line(42, 446, 348, 446, C.lightGray),
    text(42, 471, 'ZONE 3', 13, C.gray, 700),
    text(346, 471, '160 bpm', 14, C.black, 700, 'end'),
    text(25, 533, 'Recent activities', 22, C.black, 700),
    rect(25, 547, 340, 68, C.teal, 8),
    circle(45, 570, 5, C.lime),
    text(60, 575, 'Running · 23:14', 16, C.white, 700),
    text(60, 599, '4.62 km    5:02/km', 12, C.white, 400),
    text(347, 599, 'UPLOADED', 10, C.lime, 700, 'end'),
    rect(25, 623, 340, 68, C.white, 8, C.lightGray),
    circle(45, 646, 5, C.coral),
    text(60, 651, 'Running · 18:56', 16, C.black, 700),
    text(60, 675, '3.18 km    5:57/km', 12, C.gray, 400),
    text(347, 675, 'RETRY', 10, C.redInk, 700, 'end'),
    text(25, 738, 'Connections', 22, C.black, 700),
    rect(25, 752, 340, 69, C.white, 8, C.lightGray),
    text(42, 778, 'Personal Strava setup', 16, C.black, 700),
    text(42, 801, 'Credentials and upload preferences', 12, C.gray),
    icon('down', 339, 785, C.teal),
    rect(25, 845, 340, 51, C.teal, 8),
    text(195, 877, 'SAVE SETTINGS', 16, C.white, 700, 'middle'),
    '</svg>\n'
  ];
  return out.join('');
}

fs.mkdirSync(OUT, {recursive: true});
screens.forEach(function(screen) {
  fs.writeFileSync(path.join(OUT, screen.name + '.svg'),
                   svg(screen.markup));
});
fs.writeFileSync(path.join(OUT, 'motion-gps-base.svg'),
                 svg(gps(false, -1)));
fs.writeFileSync(path.join(OUT, 'motion-countdown-2.svg'),
                 svg(countdown(2)));
fs.writeFileSync(path.join(OUT, 'motion-countdown-1.svg'),
                 svg(countdown(1)));
fs.writeFileSync(path.join(OUT, 'overview.svg'), overview());
fs.writeFileSync(path.join(OUT, 'phone-settings.svg'), phoneSettings());
console.log('Wrote ' + screens.length + ' native-size Emery studies to ' + OUT);
