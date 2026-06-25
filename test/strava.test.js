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

  assert.ok(tcx.indexOf('<Activity Sport="running">') !== -1);
  assert.ok(tcx.indexOf('<TotalTimeSeconds>10</TotalTimeSeconds>') !== -1);
  assert.ok(tcx.indexOf('<DistanceMeters>30</DistanceMeters>') !== -1);
  assert.ok(tcx.indexOf('<LatitudeDegrees>51.5074</LatitudeDegrees>') !== -1);
  assert.ok(tcx.indexOf('<Value>145</Value>') !== -1);
});

run('cycling maps to biking TCX sport and Strava Ride sport type', function() {
  assert.strictEqual(Strava.sportForActivityType('cycling'), 'biking');
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

run('config page URL embeds settings, actions, OAuth guidance, and notices', function() {
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
  assert.ok(html.indexOf('Open Strava Authorization') !== -1);
  assert.ok(html.indexOf('activity:write') !== -1);
  assert.ok(html.indexOf('stravaAuthorizationCode') !== -1);
  assert.ok(html.indexOf('stravaScope') !== -1);
  assert.ok(html.indexOf('Recent Activities') !== -1);
  assert.ok(html.indexOf('Export TCX') !== -1);
  assert.ok(html.indexOf('Retry Strava') !== -1);
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

run('TCX export opens a readable page with copy and file actions', function() {
  var tcx = Strava.generateTcx(activity);
  var url = ConfigPage.buildExportUrl(activity, tcx);
  var html = decodeURIComponent(url.replace('data:text/html;charset=utf-8,', ''));

  assert.ok(html.indexOf('Export TCX') !== -1);
  assert.ok(html.indexOf('Open TCX File') !== -1);
  assert.ok(html.indexOf('Copy TCX') !== -1);
  assert.ok(html.indexOf('pt-123.tcx') !== -1);
  assert.ok(html.indexOf('&lt;TrainingCenterDatabase') !== -1);
});
