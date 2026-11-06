var assert = require('assert');
var ActivityStore = require('../src/pkjs/activity_store');
var GpsService = require('../src/pkjs/gps_service');
var HistoryMessages = require('../src/pkjs/history_messages');
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
    },
    removeItem: function(key) {
      delete values[key];
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

run('activity store tracks pending TCX export activity', function() {
  var store = createStore(createMemoryStorage());
  store.saveActivity(sampleActivity('export-me'));

  assert.strictEqual(store.getPendingTcxExportActivity(), null);
  assert.strictEqual(store.setPendingTcxExport('export-me'), true);
  assert.strictEqual(store.getPendingTcxExportActivityId(), 'export-me');
  assert.strictEqual(store.getPendingTcxExportActivity().id, 'export-me');
  assert.strictEqual(store.clearPendingTcxExport(), true);
  assert.strictEqual(store.getPendingTcxExportActivityId(), '');
});

run('activity store persists, loads, and clears active drafts', function() {
  var storage = createMemoryStorage();
  var store = createStore(storage);
  var activity = sampleActivity('draft');
  delete activity.finishedAt;

  assert.strictEqual(store.saveActiveActivity(activity, 12345), true);
  assert.strictEqual(store.getActiveActivityDraft().activity.id, 'draft');
  assert.strictEqual(store.getActiveActivityDraft().checkpointedAt, 12345);
  assert.strictEqual(store.clearActiveActivity(), true);
  assert.strictEqual(store.getActiveActivityDraft(), null);
});

run('activity store quarantines corrupt active drafts', function() {
  var storage = createMemoryStorage();
  var store = createStore(storage);
  storage.setItem(ActivityStore.ACTIVE_ACTIVITY_KEY, '{broken');

  assert.strictEqual(store.getActiveActivityDraft(), null);
  assert.strictEqual(storage.getItem(ActivityStore.ACTIVE_ACTIVITY_KEY), null);
  assert.strictEqual(
    storage.getItem(ActivityStore.CORRUPT_ACTIVE_ACTIVITY_KEY),
    '{broken'
  );
});

run('saving an activity again replaces its prior copy', function() {
  var store = createStore(createMemoryStorage());
  var activity = sampleActivity('same-id');
  store.saveActivity(activity);
  activity.summaryDistanceM = 999;
  store.saveActivity(activity);

  assert.strictEqual(store.getActivities().length, 1);
  assert.strictEqual(store.getActivity('same-id').distanceM, 999);
});

run('history messages compact saved activities for the watch', function() {
  var activities = [
    {
      id: 'uploaded',
      type: 'walking',
      distanceM: 1234,
      movingTimeS: 654,
      stravaActivityId: 9001
    },
    {
      id: 'failed',
      type: 'cycling',
      distanceM: 4321,
      movingTimeS: 765,
      stravaStatus: 'failed',
      stravaError: 'Forbidden'
    }
  ];
  var payload = HistoryMessages.buildHistoryPayload(activities);

  assert.strictEqual(payload.count, 2);
  assert.strictEqual(
    payload.items,
    '0,1234,654,' + HistoryMessages.STATUS_UPLOADED +
        ';2,4321,765,' + HistoryMessages.STATUS_FAILED
  );
  assert.strictEqual(payload.message, 'Strava uploaded #9001');
  assert.strictEqual(
    HistoryMessages.selectedActivity(activities, 1).id,
    'failed'
  );
  assert.strictEqual(
    HistoryMessages.selectedActivity(activities, 10),
    null
  );
  assert.strictEqual(
    HistoryMessages.activityStatusMessage({
      stravaStatus: 'processing',
      stravaError: 'Strava upload failed: HTTP 403 - Forbidden',
      stravaUploadStatus: 'Your activity is still being processed.'
    }),
    'Your activity is still being processed.'
  );
  assert.strictEqual(
    HistoryMessages.activityStatusMessage({
      stravaStatus: 'failed',
      stravaError: 'Strava upload failed: HTTP 403 - Forbidden',
      stravaUploadStatus: 'Your activity is still being processed.'
    }),
    'Strava upload failed: HTTP 403 - Forbidden'
  );
});

run('GPS service owns watch, polling, position, and metric messages',
    function() {
  var clock = 10000;
  var messages = [];
  var recorded = [];
  var positionNotifications = [];
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
    },
    onPosition: function(position) {
      positionNotifications.push(position);
    }
  });

  gps.start();

  assert.strictEqual(recorded.length, 1);
  assert.strictEqual(positionNotifications.length, 1);
  assert.strictEqual(gps.getLatestPosition().accuracy, 8);
  assert.strictEqual(messages[0].GPS_STATUS, 1);
  assert.strictEqual(messages[1].GPS_STATUS, 2);
  assert.strictEqual(messages[messages.length - 1].DISTANCE_M, 25);

  gps.stopIfIdle();
  assert.strictEqual(clearedWatch, 7);
  assert.strictEqual(clearedTimer, 9);
});

function gpsHarness() {
  var clock = 100000;
  var watches = [];
  var polls = [];
  var cleared = [];
  var messages = [];
  var logs = [];
  var tick;
  var tracker = require('../src/pkjs/tracker_core').createTrackerCore({
    nowMs: function() { return clock; }
  });
  var gps = GpsService.createGpsService({
    geolocation: {
      watchPosition: function(success, error) {
        watches.push({ success: success, error: error });
        return watches.length;
      },
      clearWatch: function(id) { cleared.push(id); },
      getCurrentPosition: function(success, error) {
        polls.push({ success: success, error: error });
      }
    },
    tracker: tracker, lockAccuracyM: 25,
    nowMs: function() { return clock; },
    sendMessage: function(message) { messages.push(message); },
    log: function(message) { logs.push(message); },
    setIntervalFn: function(callback) { tick = callback; return 1; },
    clearIntervalFn: function() {},
  });
  function fix(timestamp, lon) {
    return { timestamp: timestamp, coords: {
      latitude: 51.5, longitude: lon || -0.1, accuracy: 8 } };
  }
  gps.start();
  return { gps: gps, tracker: tracker, watches: watches, polls: polls,
    cleared: cleared, messages: messages, logs: logs, fix: fix,
    setClock: function(value) { clock = value; },
    tick: function() { tick(); } };
}

run('GPS timestamp fallback preserves validation and expires from receipt time', function() {
  var h = gpsHarness();
  var suppliedTimestamps = [null, NaN, Infinity, -Infinity, '100000', {}, 0, 80000, 102000];
  suppliedTimestamps.forEach(function(timestamp) {
    h.watches[0].success(h.fix(timestamp));
    assert.strictEqual(h.gps.getLatestPosition(), null);
  });
  assert.strictEqual(h.logs.length, 1, 'rejected callbacks are logged without flooding');
  assert.ok(h.logs[0].indexOf('GPS fix rejected:') === 0);
  var invalid = h.fix();
  delete invalid.timestamp;
  invalid.coords.latitude = NaN;
  h.watches[0].success(invalid);
  assert.strictEqual(h.gps.getLatestPosition(), null);
  var missing = h.fix();
  delete missing.timestamp;
  h.watches[0].success(missing);
  assert.strictEqual(h.gps.getLatestPosition().timestamp, 100000);
  assert.strictEqual(h.messages[h.messages.length - 1].GPS_STATUS, 2);
  h.setClock(116000);
  assert.strictEqual(h.gps.getLatestPosition(), null);
  h.tick();
  assert.strictEqual(h.messages[h.messages.length - 1].GPS_STATUS, 1);
  h.watches[0].success(missing);
  assert.strictEqual(h.gps.getLatestPosition().timestamp, 116000);
  assert.strictEqual(h.messages[h.messages.length - 1].GPS_STATUS, 2);
  assert.strictEqual(h.logs.filter(function(message) {
    return message.indexOf('GPS timestamp missing') === 0;
  }).length, 1);
});

run('GPS lock transitions bypass throttling for numeric timestamps too', function() {
  var h = gpsHarness();
  h.setClock(100100);
  h.watches[0].success(h.fix(100100));
  assert.strictEqual(h.messages[h.messages.length - 1].GPS_STATUS, 2);
  var poor = h.fix(100200);
  poor.coords.accuracy = 40;
  h.setClock(100200);
  h.watches[0].success(poor);
  assert.strictEqual(h.messages[h.messages.length - 1].GPS_STATUS, 1);
  h.setClock(100300);
  h.watches[0].success(h.fix(100300));
  assert.strictEqual(h.messages[h.messages.length - 1].GPS_STATUS, 2);
});

run('GPS service ignores cached, invalid and out-of-order callback results', function() {
  var h = gpsHarness();
  h.watches[0].success(h.fix(100000));
  h.polls[0].success(h.fix(99000, -0.2));
  h.watches[0].success(h.fix(80000, -0.3));
  h.watches[0].success(h.fix(160000, -0.4));
  var invalid = h.fix(100001);
  invalid.coords.latitude = NaN;
  h.watches[0].success(invalid);
  assert.strictEqual(h.gps.getLatestPosition().lon, -0.1);
  h.setClock(116000);
  assert.strictEqual(h.gps.getLatestPosition(), null);
  assert.strictEqual(h.gps.makeGpsDictionary().GPS_STATUS, 1);
});

run('GPS polling cannot overlap or replace fresh watch lock with a timeout', function() {
  var h = gpsHarness();
  h.tick();
  assert.strictEqual(h.polls.length, 1);
  h.watches[0].success(h.fix(100000));
  h.polls[0].error({ code: 3 });
  assert.strictEqual(h.gps.makeGpsDictionary().GPS_STATUS, 2);
  h.tick();
  assert.strictEqual(h.polls.length, 2);
});

run('silent GPS watchdog restarts acquisition, clears stale pace and rejects late callbacks', function() {
  var h = gpsHarness();
  h.watches[0].success(h.fix(100000));
  h.tracker.startActivity(h.gps.getLatestPosition(), 1);
  h.setClock(105000);
  h.watches[0].success(h.fix(105000, -0.0998));
  assert.ok(h.tracker.getMetrics().currentSpeedCentiMps > 0);
  h.setClock(135000);
  h.tick();
  assert.deepStrictEqual(h.cleared, [1]);
  assert.strictEqual(h.watches.length, 2);
  assert.strictEqual(h.polls.length, 2);
  assert.strictEqual(h.messages[h.messages.length - 1].CURRENT_SPEED, 0);
  h.watches[0].success(h.fix(135000, -0.3));
  h.polls[0].success(h.fix(135000, -0.4));
  assert.strictEqual(h.gps.getLatestPosition(), null);
  h.watches[1].success(h.fix(135000, -0.099));
  assert.strictEqual(h.gps.getLatestPosition().lon, -0.099);
  h.tracker.finishActivity();
  h.gps.stopIfIdle();
  var count = h.messages.length;
  h.watches[1].success(h.fix(135001, -0.5));
  h.polls[1].error({ code: 3 });
  assert.strictEqual(h.messages.length, count);
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
  var updates = [];
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
  store.updateActivity(activity.id, {
    stravaStatus: 'failed',
    stravaError: 'Strava upload failed: HTTP 403 - Forbidden',
    stravaUploadStatus: 'Forbidden',
    stravaUploadId: 'old-upload',
    stravaActivityId: 1234
  });
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
    },
    onActivityUpdate: function(activityId, patch) {
      updates.push({
        activityId: activityId,
        patch: patch
      });
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
  assert.strictEqual(store.getActivity(activity.id).stravaError, '');
  assert.strictEqual(
    HistoryMessages.activityStatusMessage(store.getActivity(activity.id)),
    'Strava uploaded #9001'
  );
  assert.deepStrictEqual(updates.map(function(update) {
    return update.activityId;
  }), ['upload-me', 'upload-me', 'upload-me']);
  assert.strictEqual(updates[0].patch.stravaStatus, 'uploading');
  assert.strictEqual(updates[0].patch.stravaError, '');
  assert.strictEqual(updates[0].patch.stravaUploadStatus, '');
  assert.strictEqual(updates[1].patch.stravaStatus, 'processing');
  assert.strictEqual(updates[1].patch.stravaError, '');
  assert.strictEqual(updates[2].patch.stravaStatus, 'uploaded');
  assert.strictEqual(updates[2].patch.stravaError, '');
});

run('Strava service logs upload HTTP failures', function() {
  var store = createStore(createMemoryStorage());
  var logs = [];
  var updates = [];
  var activity = sampleActivity('upload-403');

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
      callback(null, {
        status: 403,
        text: JSON.stringify({
          message: 'Forbidden',
          errors: [{
            resource: 'Application',
            field: 'Status',
            code: 'Inactive'
          }]
        })
      });
    },
    log: function(message) {
      logs.push(message);
    },
    onActivityUpdate: function(activityId, patch) {
      updates.push({
        activityId: activityId,
        patch: patch
      });
    }
  });

  service.uploadActivity(activity);

  assert.strictEqual(
    store.getActivity(activity.id).stravaError,
    'Strava upload failed: HTTP 403 - Forbidden - Strava API app inactive; check Strava API dashboard/subscription.'
  );
  assert.strictEqual(
    logs[0],
    'Strava upload starting for upload-403: 1 points, scope=read activity:write'
  );
  assert.ok(
    logs[1].indexOf('Strava upload request ready for upload-403: POST ') === 0
  );
  assert.strictEqual(
    logs[2],
    'Strava upload response: {"message":"Forbidden","errors":[{"resource":"Application","field":"Status","code":"Inactive"}]}'
  );
  assert.strictEqual(
    logs[3],
    'Strava upload failed: HTTP 403 - Forbidden - Strava API app inactive; check Strava API dashboard/subscription.'
  );
  assert.strictEqual(updates.length, 2);
  assert.strictEqual(updates[1].activityId, 'upload-403');
  assert.strictEqual(updates[1].patch.stravaStatus, 'failed');
});

run('saved diagnostics survive storage and both export paths', function() {
  var store = createStore(createMemoryStorage());
  var a = sampleActivity('diagnostics');
  a.gpsDiagnostics = { version: 1, counters: { accepted: 2 }, events: [] };
  assert.strictEqual(store.saveActivity(a), true);
  var saved = store.getActivity(a.id);
  assert.deepStrictEqual(saved.gpsDiagnostics, a.gpsDiagnostics);
  var ConfigPage = require('../src/pkjs/config_page');
  var tcx = require('../src/pkjs/tcx');
  assert.ok(tcx.generateTcx(saved).indexOf('<pacelet:Diagnostics>') >= 0);
  assert.ok(ConfigPage.buildExportHtml(saved).indexOf(JSON.stringify(a.gpsDiagnostics)) >= 0);
});

run('HR storage is compact and old object samples still load', function() {
  var storage = createMemoryStorage();
  var store = createStore(storage);
  var a = sampleActivity('compact');
  store.saveActivity(a);
  assert.deepStrictEqual(JSON.parse(storage.getItem(ActivityStore.ACTIVITIES_KEY))[0].hrSamples[0], [a.hrSamples[0].t, 140]);
  assert.deepStrictEqual(store.getActivity(a.id).hrSamples, a.hrSamples);
  store.saveActiveActivity(a, 123);
  assert.deepStrictEqual(store.getActiveActivityDraft().activity.hrSamples, a.hrSamples);
  storage.setItem(ActivityStore.ACTIVITIES_KEY, JSON.stringify([a]));
  assert.deepStrictEqual(store.getActivity(a.id).hrSamples, a.hrSamples);
});

run('quota recovery frees oldest uploaded raw data and preserves unsynced tracks', function() {
  var storage = createMemoryStorage();
  var limit = Infinity;
  var set = storage.setItem;
  storage.setItem = function(key, value) {
    if (String(value).length > limit) { throw new Error('QuotaExceededError'); }
    set(key, value);
  };
  var store = createStore(storage);
  var a = sampleActivity('uploaded');
  a.points = Array(40).fill(a.points[0]);
  store.saveActivity(a);
  store.updateActivity(a.id, { stravaStatus: 'uploaded', stravaActivityId: 42 });
  store.saveActivity(sampleActivity('unsynced'));
  limit = 1900;
  assert.strictEqual(store.saveActivity(sampleActivity('new')), true);
  assert.strictEqual(store.getActivity('uploaded').rawDataPruned, true);
  assert.strictEqual(store.getActivity('uploaded').distanceM, 200);
  assert.strictEqual(store.getActivity('uploaded').stravaActivityId, 42);
  assert.strictEqual(store.getActivity('unsynced').points.length, 1);
  assert.strictEqual(store.getActivity('new').points.length, 1);
});

function configuredUploadStore() {
  var store = createStore(createMemoryStorage());
  store.setSettings({stravaEnabled:true,stravaClientId:'123',stravaClientSecret:'secret',stravaAccessToken:'access',stravaRefreshToken:'refresh',stravaExpiresAt:9999999999,stravaScope:'activity:write'});
  store.saveActivity(sampleActivity('pending'));
  return store;
}

run('polling resumes a stored upload, survives a network failure, and never reposts it', function() {
  var store = configuredUploadStore();
  store.updateActivity('pending', {stravaStatus:'processing',stravaUploadId:42});
  var timers = [], requests = [];
  var service = StravaService.createStravaService({
    store:store,
    setTimeoutFn:function(fn){timers.push(fn);},
    request:function(options,cb){
      requests.push(options);
      if(requests.length===1){cb(new Error('offline'));}
      else {cb(null,{status:200,text:JSON.stringify({activity_id:9001})});}
    }
  });
  service.resumePendingUploads();service.resumePendingUploads();
  service.retryActivity(store.getActivity('pending'));
  assert.strictEqual(timers.length,1);
  timers.shift()();assert.strictEqual(timers.length,1);
  timers.shift()();
  assert.deepStrictEqual(requests.map(function(r){return r.method;}),['GET','GET']);
  assert.strictEqual(store.getActivity('pending').stravaActivityId,9001);
});

run('polling stays bounded and restart can continue processing', function() {
  var store=configuredUploadStore(), count=0;
  store.updateActivity('pending',{stravaStatus:'processing',stravaUploadId:42});
  var service=StravaService.createStravaService({store:store,setTimeoutFn:function(fn){fn();},request:function(o,cb){count++;cb(new Error('offline'));}});
  service.resumePendingUploads();assert.strictEqual(count,10);
  assert.strictEqual(store.getActivity('pending').stravaStatus,'processing');
  service.resumePendingUploads();assert.strictEqual(count,20);
});

run('Strava duplicate response retires pending uploads without another POST', function() {
  var store=configuredUploadStore();
  store.updateActivity('pending',{stravaStatus:'processing',stravaUploadId:42});
  var service=StravaService.createStravaService({store:store,setTimeoutFn:function(fn){fn();},request:function(o,cb){
    assert.strictEqual(o.method,'GET');cb(null,{status:200,text:JSON.stringify({error:'duplicate of activity 9001',activity_id:9001})});
  }});
  service.resumePendingUploads();assert.strictEqual(store.getActivity('pending').stravaStatus,'uploaded');
  assert.strictEqual(store.getActivity('pending').stravaActivityId,9001);
});

run('token response preserves settings saved during the request', function() {
  var store=configuredUploadStore(), respond;
  var service=StravaService.createStravaService({store:store,request:function(o,cb){respond=cb;}});
  service.refreshToken(function(err){assert.ifError(err);});
  store.setSettings(Object.assign({},store.getSettings(),{darkMode:true,stravaAutoUpload:false,hrZone2Bpm:145}));
  respond(null,{status:200,text:JSON.stringify({access_token:'new',refresh_token:'new-refresh',expires_at:9999999999})});
  assert.strictEqual(store.getSettings().darkMode,true);assert.strictEqual(store.getSettings().hrZone2Bpm,145);
  assert.strictEqual(store.getSettings().stravaAccessToken,'new');
});
