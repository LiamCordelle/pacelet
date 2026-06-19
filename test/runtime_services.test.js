var assert = require('assert');
var ActivityStore = require('../src/pkjs/activity_store');
var GpsService = require('../src/pkjs/gps_service');
var Strava = require('../src/pkjs/strava');
var StravaService = require('../src/pkjs/strava_service');

function run(name, fn) {
  fn();
  console.log('ok - ' + name);
}

function createMemoryStorage() {
  var values = {};
  return {
    getItem: function(key) {
      return values.hasOwnProperty(key) ? values[key] : null;
    },
    setItem: function(key, value) {
      values[key] = String(value);
    }
  };
}

function createStore(storage, maxActivities) {
  return ActivityStore.createActivityStore({
    storage: storage,
    normalizeSettings: Strava.copyDefaults,
    maxActivities: maxActivities
  });
}

function sampleActivity(id) {
  return {
    id: id,
    type: 'running',
    startedAt: Date.UTC(2026, 5, 19, 10, 0, 0),
    finishedAt: Date.UTC(2026, 5, 19, 10, 1, 0),
    movingTimeS: 60,
    summaryDistanceM: 200,
    summarySpeedCentiMps: 333,
    points: [
      {
        t: Date.UTC(2026, 5, 19, 10, 0, 0),
        lat: 51.5,
        lon: -0.1,
        alt: 20,
        hr: 140
      }
    ],
    hrSamples: [{ t: Date.UTC(2026, 5, 19, 10, 0, 10), bpm: 140 }],
    avgHrBpm: 140,
    hrZoneTimeS: [0, 0, 60, 0],
    hrZoneThresholds: [100, 130, 160]
  };
}

run('activity store persists settings and caps saved history', function() {
  var storage = createMemoryStorage();
  var store = createStore(storage, 2);

  store.setSettings({
    darkMode: 'on',
    hrZone1Bpm: '110',
    hrZone2Bpm: '145',
    hrZone3Bpm: '175'
  });
  assert.strictEqual(store.getSettings().darkMode, true);
  assert.deepStrictEqual([
    store.getSettings().hrZone1Bpm,
    store.getSettings().hrZone2Bpm,
    store.getSettings().hrZone3Bpm
  ], [110, 145, 175]);

  store.saveActivity(sampleActivity('one'));
  store.saveActivity(sampleActivity('two'));
  store.saveActivity(sampleActivity('three'));

  assert.deepStrictEqual(
    store.getActivities().map(function(activity) {
      return activity.id;
    }),
    ['three', 'two']
  );
  assert.strictEqual(store.activitySummaries()[0].points, 1);
});

run('activity store updates upload state without replacing activity data',
    function() {
  var store = createStore(createMemoryStorage());
  store.saveActivity(sampleActivity('stored'));

  assert.strictEqual(store.updateActivity('stored', {
    stravaStatus: 'uploaded',
    stravaActivityId: 123
  }), true);

  assert.strictEqual(store.getActivity('stored').distanceM, 200);
  assert.strictEqual(store.getActivity('stored').stravaStatus, 'uploaded');
  assert.strictEqual(store.getActivity('stored').stravaActivityId, 123);
});

run('GPS service owns watch, polling, position, and metric messages',
    function() {
  var clock = 10000;
  var messages = [];
  var recorded = [];
  var clearedWatch = null;
  var clearedTimer = null;
  var tracker = {
    recordPosition: function(position) {
      recorded.push(position);
    },
    getMetrics: function() {
      return {
        distanceM: 25,
        currentPaceSPerKm: 300,
        currentSpeedCentiMps: 333
      };
    },
    getActiveActivity: function() {
      return null;
    }
  };
  var geolocation = {
    watchPosition: function() {
      return 7;
    },
    clearWatch: function(id) {
      clearedWatch = id;
    },
    getCurrentPosition: function(success) {
      success({
        coords: {
          latitude: 51.5,
          longitude: -0.1,
          accuracy: 8,
          altitude: 20
        },
        timestamp: 9000
      });
    }
  };
  var gps = GpsService.createGpsService({
    geolocation: geolocation,
    tracker: tracker,
    lockAccuracyM: 25,
    nowMs: function() {
      return clock;
    },
    sendMessage: function(dictionary) {
      messages.push(dictionary);
    },
    setIntervalFn: function() {
      return 9;
    },
    clearIntervalFn: function(id) {
      clearedTimer = id;
    }
  });

  gps.start();

  assert.strictEqual(recorded.length, 1);
  assert.strictEqual(gps.getLatestPosition().accuracy, 8);
  assert.strictEqual(messages[0].GPS_STATUS, 1);
  assert.strictEqual(messages[1].GPS_STATUS, 2);
  assert.strictEqual(messages[1].DISTANCE_M, 25);

  gps.stopIfIdle();
  assert.strictEqual(clearedWatch, 7);
  assert.strictEqual(clearedTimer, 9);
});

run('Strava service exchanges authorization codes and persists tokens',
    function() {
  var store = createStore(createMemoryStorage());
  var called = false;
  store.setSettings({
    stravaEnabled: true,
    stravaClientId: '123',
    stravaClientSecret: 'secret',
    stravaAuthorizationCode: 'one-time'
  });

  var service = StravaService.createStravaService({
    store: store,
    request: function(options, callback) {
      assert.strictEqual(options.url, Strava.TOKEN_URL);
      callback(null, {
        status: 200,
        text: JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_at: 9999999999,
          scope: 'read activity:write'
        })
      });
    }
  });

  service.exchangeAuthorizationCode(function(err) {
    assert.ifError(err);
    called = true;
  });

  assert.strictEqual(called, true);
  assert.strictEqual(store.getSettings().stravaAccessToken, 'access');
  assert.strictEqual(store.getSettings().stravaRefreshToken, 'refresh');
  assert.strictEqual(store.getSettings().stravaAuthorizationCode, '');
});

run('Strava service uploads and polls activity status', function() {
  var store = createStore(createMemoryStorage());
  var requests = [];
  var activity = sampleActivity('upload-me');

  store.setSettings({
    stravaEnabled: true,
    stravaClientId: '123',
    stravaClientSecret: 'secret',
    stravaAccessToken: 'access',
    stravaRefreshToken: 'refresh',
    stravaExpiresAt: 9999999999,
    stravaScope: 'read activity:write'
  });
  store.saveActivity(activity);
  activity = store.getActivity(activity.id);

  var service = StravaService.createStravaService({
    store: store,
    request: function(options, callback) {
      requests.push(options);
      if (options.method === 'POST') {
        callback(null, {
          status: 201,
          text: JSON.stringify({ id: 42, status: 'processing' })
        });
      } else {
        callback(null, {
          status: 200,
          text: JSON.stringify({
            activity_id: 9001,
            status: 'ready'
          })
        });
      }
    },
    setTimeoutFn: function(callback) {
      callback();
    }
  });

  service.uploadActivity(activity);

  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].method, 'POST');
  assert.strictEqual(requests[1].method, 'GET');
  assert.strictEqual(
    store.getActivity(activity.id).stravaStatus,
    'uploaded'
  );
  assert.strictEqual(
    store.getActivity(activity.id).stravaActivityId,
    9001
  );
});

