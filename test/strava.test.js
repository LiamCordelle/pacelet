var assert = require('assert');
var Strava = require('../src/pkjs/strava');
var ConfigPage = require('../src/pkjs/config_page');

function run(name, fn) {
  fn();
  console.log('ok - ' + name);
}

var activity = {
  id: 'pt-123',
  type: 'running',
  startedAt: Date.UTC(2026, 5, 16, 13, 0, 0),
  movingTimeS: 10,
  summaryDistanceM: 30,
  distanceM: 30,
  points: [
    {
      t: Date.UTC(2026, 5, 16, 13, 0, 0),
      lat: 51.5074,
      lon: -0.1278,
      alt: 20,
      hr: 140
    },
    {
      t: Date.UTC(2026, 5, 16, 13, 0, 10),
      lat: 51.5074,
      lon: -0.1274,
      alt: 22,
      hr: 145
    }
  ]
};

function longActivity(pointCount) {
  var start = Date.UTC(2026, 5, 16, 13, 0, 0);
  var points = [];
  var i;

  for (i = 0; i < pointCount; i += 1) {
    points.push({
      t: start + i * 5000,
      lat: 51.5074,
      lon: -0.1278 + i * 0.00005,
      alt: 20 + (i % 7),
      hr: 130 + (i % 20)
    });
  }
  return {
    id: 'pt-long',
    type: 'running',
    startedAt: start,
    movingTimeS: pointCount * 5,
    summaryDistanceM: pointCount * 6,
    distanceM: pointCount * 6,
    points: points
  };
}

function renderExportPage(activity) {
  var url = ConfigPage.buildExportUrl(activity);
  var html = decodeURIComponent(url.replace('data:text/html;charset=utf-8,', ''));
  var script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  var elements = {
    tcx: {
      value: '',
      focus: function() {},
      select: function() {},
      setSelectionRange: function() {}
    },
    copy: {
      addEventListener: function(name, listener) {
        this.listener = listener;
      }
    }
  };
  var document = {
    getElementById: function(id) {
      return elements[id];
    },
    execCommand: function() {
      return true;
    }
  };

  eval(script);
  elements.copy.listener.call(elements.copy);
  return {
    url: url,
    html: html,
    tcx: elements.tcx.value,
    copyText: elements.copy.textContent
  };
}

run('settings normalize booleans and token expiry', function() {
  assert.strictEqual(Strava.copyDefaults({}).darkMode, false);

  var settings = Strava.copyDefaults({
    darkMode: 'false',
    stravaEnabled: 'on',
    stravaAutoUpload: '1',
    stravaClientId: 123,
    stravaExpiresAt: '456'
  });

  assert.strictEqual(settings.darkMode, false);
  assert.strictEqual(settings.stravaEnabled, true);
  assert.strictEqual(settings.stravaAutoUpload, true);
  assert.strictEqual(settings.stravaClientId, '123');
  assert.strictEqual(settings.stravaExpiresAt, 456);
  assert.strictEqual(settings.hrZone1Bpm, 100);
  assert.strictEqual(settings.hrZone2Bpm, 130);
  assert.strictEqual(settings.hrZone3Bpm, 160);

  settings = Strava.copyDefaults({
    darkMode: 'on',
    hrZone1Bpm: '110',
    hrZone2Bpm: '150',
    hrZone3Bpm: '175'
  });
  assert.strictEqual(settings.darkMode, true);
  assert.strictEqual(settings.hrZone1Bpm, 110);
  assert.strictEqual(settings.hrZone2Bpm, 150);
  assert.strictEqual(settings.hrZone3Bpm, 175);
});

run('configuration requires enabled credentials and a token', function() {
  assert.strictEqual(Strava.isConfigured({
    stravaEnabled: true,
    stravaClientId: '1',
    stravaClientSecret: 'secret',
    stravaRefreshToken: 'refresh'
  }), true);

  assert.strictEqual(Strava.isConfigured({
    stravaEnabled: true,
    stravaClientId: '1',
    stravaClientSecret: 'secret'
  }), false);
});

run('activity write scope is required when scope is known', function() {
  assert.strictEqual(Strava.hasActivityWrite({ stravaScope: '' }), true);
  assert.strictEqual(Strava.hasActivityWrite({ stravaScope: 'read activity:write' }), true);
  assert.strictEqual(Strava.hasActivityWrite({ stravaScope: 'read' }), false);
});

run('token refresh body uses Strava OAuth fields', function() {
  var body = Strava.refreshTokenBody({
    stravaClientId: '123',
    stravaClientSecret: 'sec ret',
    stravaRefreshToken: 'ref/resh'
  });

  assert.ok(body.indexOf('client_id=123') !== -1);
  assert.ok(body.indexOf('client_secret=sec%20ret') !== -1);
  assert.ok(body.indexOf('grant_type=refresh_token') !== -1);
  assert.ok(body.indexOf('refresh_token=ref%2Fresh') !== -1);
});

run('authorization code body uses Strava OAuth fields', function() {
  var body = Strava.authorizationCodeBody({
    stravaClientId: '123',
    stravaClientSecret: 'secret',
    stravaAuthorizationCode: 'abc def'
  });

  assert.ok(body.indexOf('client_id=123') !== -1);
  assert.ok(body.indexOf('client_secret=secret') !== -1);
  assert.ok(body.indexOf('grant_type=authorization_code') !== -1);
  assert.ok(body.indexOf('code=abc%20def') !== -1);
});

run('authorization URL requests activity write scope', function() {
  var url = Strava.authorizationUrl('123', 'http://localhost');

  assert.ok(url.indexOf(Strava.AUTHORIZE_URL + '?') === 0);
  assert.ok(url.indexOf('client_id=123') !== -1);
  assert.ok(url.indexOf('redirect_uri=http%3A%2F%2Flocalhost') !== -1);
  assert.ok(url.indexOf('response_type=code') !== -1);
  assert.ok(url.indexOf('approval_prompt=force') !== -1);
  assert.ok(url.indexOf('scope=read%2Cactivity%3Awrite') !== -1);
});

run('token response persists replacement access and refresh tokens', function() {
  var settings = Strava.applyTokenResponse({
    stravaClientId: '123',
    stravaClientSecret: 'secret',
    stravaAuthorizationCode: 'used-once',
    stravaRefreshToken: 'old'
  }, {
    access_token: 'access',
    refresh_token: 'new',
    expires_at: 1770000000,
    scope: 'read activity:write'
  });

  assert.strictEqual(settings.stravaAccessToken, 'access');
  assert.strictEqual(settings.stravaRefreshToken, 'new');
  assert.strictEqual(settings.stravaExpiresAt, 1770000000);
  assert.strictEqual(settings.stravaScope, 'read activity:write');
  assert.strictEqual(settings.stravaAuthorizationCode, '');
});

run('TCX includes sport, trackpoints, coordinates, distance, and HR', function() {
  var tcx = Strava.generateTcx(activity);

  assert.ok(tcx.indexOf('<Activity Sport="Running">') !== -1);
  assert.ok(tcx.indexOf('<TotalTimeSeconds>10</TotalTimeSeconds>') !== -1);
  assert.ok(tcx.indexOf('<DistanceMeters>30</DistanceMeters>') !== -1);
  assert.ok(tcx.indexOf('<LatitudeDegrees>51.5074</LatitudeDegrees>') !== -1);
  assert.ok(tcx.indexOf('<Value>145</Value>') !== -1);
});

run('cycling maps to biking TCX sport and Strava Ride sport type', function() {
  assert.strictEqual(Strava.sportForActivityType('cycling'), 'Biking');
  assert.strictEqual(Strava.stravaSportType('cycling'), 'Ride');
});

run('activity titles use the Pacelet name', function() {
  assert.ok(Strava.titleForActivity(activity).indexOf('Pacelet Running ') === 0);
});

run('upload request builds a multipart TCX upload', function() {
  var upload = Strava.uploadRequest(activity, {
    stravaAccessToken: 'access',
    stravaDescription: 'test upload'
  });

  assert.strictEqual(upload.url, Strava.UPLOAD_URL);
  assert.strictEqual(upload.headers.Authorization, 'Bearer access');
  assert.ok(upload.headers['Content-Type'].indexOf('multipart/form-data; boundary=') === 0);
  assert.ok(upload.body.indexOf('name="data_type"') !== -1);
  assert.ok(upload.body.indexOf('tcx') !== -1);
  assert.ok(upload.body.indexOf('filename="pt-123.tcx"') !== -1);
  assert.ok(upload.body.indexOf('<TrainingCenterDatabase') !== -1);
});

run('config page URL embeds settings, history status, OAuth guidance, and notices', function() {
  var url = ConfigPage.buildConfigUrl({
    darkMode: true,
    stravaEnabled: true,
    stravaClientId: '123',
    stravaClientSecret: 'secret',
    stravaRefreshToken: 'refresh',
    stravaDescription: 'hello'
  }, [
    {
      id: 'pt-123',
      type: 'running',
      startedAt: activity.startedAt,
      movingTimeS: 10,
      distanceM: 30,
      avgHrBpm: 145,
      hrZoneTimeS: [0, 0, 6, 4],
      points: 2,
      stravaStatus: 'not_uploaded'
    }
  ], 'Strava retry started.');
  var html = decodeURIComponent(url.replace('data:text/html;charset=utf-8,', ''));

  assert.ok(url.indexOf('data:text/html;charset=utf-8,') === 0);
  assert.ok(html.indexOf('Pacelet') !== -1);
  assert.ok(html.indexOf('darkMode') !== -1);
  assert.ok(html.indexOf('hrZone1Bpm') !== -1);
  assert.ok(html.indexOf('145 bpm avg') !== -1);
  assert.ok(html.indexOf('Z2 0:06') !== -1);
  assert.ok(html.indexOf('stravaClientId') !== -1);
  assert.strictEqual(html.indexOf('Open Strava Authorization'), -1);
  assert.ok(html.indexOf('Desktop auth URL format') !== -1);
  assert.ok(html.indexOf('activity:write') !== -1);
  assert.ok(html.indexOf('stravaAuthorizationCode') !== -1);
  assert.ok(html.indexOf('stravaScope') !== -1);
  assert.ok(html.indexOf('Recent Activities') !== -1);
  assert.ok(html.indexOf('Activity History on the watch') !== -1);
  assert.ok(html.indexOf('open Pacelet settings from the phone app') !== -1);
  assert.strictEqual(html.indexOf('Open TCX Export'), -1);
  assert.strictEqual(html.indexOf('data-action'), -1);
  assert.ok(html.indexOf('pt-123') !== -1);
  assert.ok(html.indexOf('short-lived') !== -1);
  assert.ok(html.indexOf('Strava retry started.') !== -1);
  assert.ok(html.indexOf('pebblejs://close#') !== -1);
});

run('config close responses preserve activity actions', function() {
  var payload = {
    action: 'retry_strava',
    activityId: 'pt-123'
  };
  var encoded = encodeURIComponent(JSON.stringify(payload));

  assert.deepStrictEqual(ConfigPage.parseResponse(encoded), payload);
  assert.deepStrictEqual(ConfigPage.parseResponse('#' + encoded), payload);
  assert.deepStrictEqual(
    ConfigPage.parseResponse('pebblejs://close#' + encoded),
    payload
  );
  assert.deepStrictEqual(ConfigPage.parseResponse(JSON.stringify(payload)), payload);
  assert.strictEqual(ConfigPage.parseResponse('pebblejs://close'), null);
});

run('TCX export opens a readable page with copy fallback', function() {
  var exportPage = renderExportPage(activity);

  assert.ok(exportPage.html.indexOf('Export TCX') !== -1);
  assert.strictEqual(exportPage.html.indexOf('Share TCX File'), -1);
  assert.strictEqual(exportPage.html.indexOf('Open TCX File'), -1);
  assert.ok(exportPage.html.indexOf('Copy TCX') !== -1);
  assert.ok(exportPage.html.indexOf('Pebble config browser') !== -1);
  assert.ok(exportPage.html.indexOf('pt-123.tcx') !== -1);
  assert.ok(exportPage.html.indexOf('clear_pending_tcx_export') !== -1);
  assert.strictEqual(exportPage.copyText, 'Copied');
  assert.strictEqual(exportPage.tcx, Strava.generateTcx(activity));
});

run('TCX export URL stays compact for long activity history', function() {
  var exported = renderExportPage(longActivity(1500));

  assert.ok(exported.url.length < 30000, 'URL length was ' + exported.url.length);
  assert.ok(exported.tcx.indexOf('<TrainingCenterDatabase') !== -1);
});

run('TCX export preserves milliseconds, diagnostics and pause boundaries', function() {
  var diagnosticActivity = JSON.parse(JSON.stringify(activity));
  diagnosticActivity.gpsDiagnostics = { appVersion: '0.6.0', filterVersion: 2,
    counts: { accuracy: 2 }, events: [{ t: activity.startedAt, reason: 'accuracy' }],
    droppedEvents: 0 };
  diagnosticActivity.points[0].t += 123;
  diagnosticActivity.points[0].acc = 8;
  diagnosticActivity.points[0].distanceM = 0;
  diagnosticActivity.points[1].t = diagnosticActivity.points[0].t + 751;
  diagnosticActivity.points[1].lat = 51.508123;
  diagnosticActivity.points[1].rawLat = 51.508128;
  diagnosticActivity.points[1].rawLon = diagnosticActivity.points[1].lon;
  diagnosticActivity.points[1].acc = 20;
  diagnosticActivity.points[1].segmentStart = true;
  diagnosticActivity.points[1].distanceM = 0;
  var direct = Strava.generateTcx(diagnosticActivity);
  var exported = renderExportPage(diagnosticActivity).tcx;
  assert.strictEqual(exported, direct);
  assert.strictEqual((exported.match(/<Track>/g) || []).length, 2);
  assert.ok(exported.indexOf('13:00:00.123Z') !== -1);
  assert.ok(exported.indexOf('13:00:00.874Z') !== -1);
  assert.ok(exported.indexOf('<pacelet:AccuracyMeters>20</pacelet:AccuracyMeters>') !== -1);
  assert.ok(exported.indexOf('<pacelet:RawLatitudeDegrees>51.508128') !== -1);
  assert.ok(exported.indexOf('<Notes>Pacelet 0.6.0; GPS filter 2.') !== -1);
  assert.ok(exported.indexOf('<pacelet:Diagnostics>') !== -1);
  assert.ok(exported.indexOf('<Calories>0</Calories>') !== -1);
});

run('diagnostic text is safe in XML and the export page script', function() {
  var recorded = JSON.parse(JSON.stringify(activity));
  recorded.gpsDiagnostics = { appVersion: '</script><script>throw 123;</script>',
    filterVersion: 2, counts: {}, events: [], droppedEvents: 0 };
  var page = renderExportPage(recorded);
  assert.ok(page.tcx.indexOf('&lt;/script&gt;') !== -1);
  assert.strictEqual((page.html.match(/<script>/g) || []).length, 1);
});

run('segment distance fallback never joins separate tracks and walking uses TCX Other', function() {
  var recorded = JSON.parse(JSON.stringify(activity));
  recorded.type = 'walking';
  recorded.points[1].segmentStart = true;
  var tcx = renderExportPage(recorded).tcx;
  assert.ok(tcx.indexOf('<Activity Sport="Other">') !== -1);
  assert.ok(tcx.indexOf('<DistanceMeters>0</DistanceMeters>') !== -1);
  assert.strictEqual((tcx.match(/<DistanceMeters>0<\/DistanceMeters>/g) || []).length, 2);
  assert.strictEqual(Strava.stravaSportType('walking'), 'Walk');
});

run('a long diagnostic export remains bounded without dropping recorded metadata', function() {
  var recorded = longActivity(1500);
  recorded.gpsDiagnostics = { filterVersion: 2, appVersion: '0.6.0',
    counts: { accuracy: 100 }, events: [], droppedEvents: 36 };
  recorded.points.forEach(function(point, i) {
    point.acc = 20;
    point.distanceM = i * 6;
    point.rawLat = point.lat + 0.000005;
    point.rawLon = point.lon - 0.000002;
    point.segmentStart = i % 100 === 0;
  });
  for (var i = 0; i < 64; i += 1) {
    recorded.gpsDiagnostics.events.push({ t: recorded.startedAt + i * 5000,
      reason: 'accuracy', lat: 51.5074, lon: -0.1278, acc: 80, ageMs: 1000 });
  }
  var page = renderExportPage(recorded);
  assert.ok(page.url.length < 60000, 'URL length was ' + page.url.length);
  assert.strictEqual((page.tcx.match(/<pacelet:AccuracyMeters>/g) || []).length, 1500);
  assert.strictEqual((page.tcx.match(/<Track>/g) || []).length, 15);
});
