var assert = require('assert');
var ActivityStore = require('../src/pkjs/activity_store');

function run(name, fn) {
  var originalNow = Date.now;
  var originalTimeout = global.setTimeout;
  try {
    fn();
  } finally {
    Date.now = originalNow;
    global.setTimeout = originalTimeout;
  }
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

function latestMessageWith(messages, key, value) {
  var i;
  for (i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].hasOwnProperty(key) &&
        (typeof value === 'undefined' || messages[i][key] === value)) {
      return messages[i];
    }
  }
  return null;
}

function launchRuntime(storage, options) {
  options = options || {};
  var listeners = {};
  var messages = [];
  var timers = [];
  var failures = options.sendFailures || 0;
  var position = {
    coords: {
      latitude: 51.5074,
      longitude: -0.1278,
      accuracy: 8,
      altitude: 20
    },
    timestamp: Date.now()
  };

  global.localStorage = storage;
  global.navigator = {
    geolocation: {
      watchPosition: function(success) {
        this.watchSuccess = success;
        return 11;
      },
      clearWatch: function() {},
      getCurrentPosition: function(success) {
        if (options.manualGps) {
          this.pollSuccess = success;
          return;
        }
        position.timestamp = Date.now();
        success(position);
      }
    }
  };
  global.XMLHttpRequest = options.XMLHttpRequest || function() {};
  global.setInterval = function() { return 12; };
  global.clearInterval = function() {};
  if (options.sendFailures) {
    global.setTimeout = function(fn) { timers.push(fn); };
  }
  global.Pebble = {
    addEventListener: function(name, callback) {
      listeners[name] = callback;
    },
    sendAppMessage: function(dictionary, success, failure) {
      messages.push(dictionary);
      if (failures > 0) { failures -= 1; failure(); return; }
      if (success) {
        success();
      }
    },
    openURL: function() {}
  };

  delete require.cache[require.resolve('../src/pkjs/index')];
  require('../src/pkjs/index');

  return {
    messages: messages,
    retryNext: function() { timers.shift()(); },
    fix: function(timestamp, source) {
      // Match the phone bridge, whose successful callbacks contain only coords.
      var fix = { coords: position.coords };
      if (typeof timestamp !== 'undefined') { fix.timestamp = timestamp; }
      global.navigator.geolocation[source === 'poll' ?
        'pollSuccess' : 'watchSuccess'](fix);
    },
    ready: function() {
      listeners.ready();
    },
    send: function(payload) {
      listeners.appmessage({ payload: payload });
    }
  };
}

['watch', 'poll'].forEach(function(source) {
  run('runtime starts from a timestamp-less phone ' + source + ' fix', function() {
    var clock = 1800000000000;
    Date.now = function() { return clock; };
    var storage = createMemoryStorage();
    var runtime = launchRuntime(storage, { manualGps: true });
    runtime.ready();
    runtime.send({ REQUEST_GPS: 1 });
    assert.strictEqual(latestMessageWith(runtime.messages, 'GPS_STATUS').GPS_STATUS, 1);
    clock += 100;
    runtime.fix(undefined, source);
    // A quick lock must reach the watch without waiting for another callback.
    assert.strictEqual(latestMessageWith(runtime.messages, 'GPS_STATUS').GPS_STATUS, 2);
    clock += 3000; // Watch countdown.
    runtime.send({ START_ACTIVITY: 1, ACTIVITY_TYPE: 1 });
    assert.ok(latestMessageWith(runtime.messages, 'ACTIVITY_STATE', 1));
    assert.ok(storage.getItem(ActivityStore.ACTIVE_ACTIVITY_KEY));
  });
});

run('runtime refuses to start when a timestamp-less fix has aged out', function() {
  var clock = 1800000000000;
  Date.now = function() { return clock; };
  var storage = createMemoryStorage();
  var runtime = launchRuntime(storage, { manualGps: true });
  runtime.ready();
  runtime.send({ REQUEST_GPS: 1 });
  runtime.fix();
  assert.strictEqual(latestMessageWith(runtime.messages, 'GPS_STATUS').GPS_STATUS, 2);
  clock += 16000;
  runtime.send({ START_ACTIVITY: 1, ACTIVITY_TYPE: 1 });
  assert.strictEqual(latestMessageWith(runtime.messages, 'GPS_STATUS').GPS_STATUS, 1);
  assert.strictEqual(latestMessageWith(runtime.messages, 'ACTIVITY_STATE', 1), null);
  assert.strictEqual(storage.getItem(ActivityStore.ACTIVE_ACTIVITY_KEY), null);
  assert.strictEqual(runtime.messages[runtime.messages.length - 1].RECOVERY_MESSAGE, 'GPS LOST');
  assert.strictEqual(runtime.messages[runtime.messages.length - 1].ACTIVITY_STATE, 0);
});

run('runtime restores, resumes, and idempotently finishes a draft', function() {
  var storage = createMemoryStorage();
  var first = launchRuntime(storage);
  first.ready();
  first.send({ REQUEST_GPS: 1 });
  first.send({ START_ACTIVITY: 1, ACTIVITY_TYPE: 1 });

  var active = latestMessageWith(first.messages, 'ACTIVITY_STATE', 1);
  assert.ok(active);
  assert.ok(active.ACTIVITY_ID.indexOf('pt-') === 0);
  assert.ok(storage.getItem(ActivityStore.ACTIVE_ACTIVITY_KEY));

  var restarted = launchRuntime(storage);
  restarted.ready();
  var recoverable = latestMessageWith(
    restarted.messages, 'ACTIVITY_STATE', 3);
  assert.ok(recoverable);
  assert.strictEqual(recoverable.ACTIVITY_ID, active.ACTIVITY_ID);

  restarted.send({
    RECOVER_ACTIVITY: 1,
    ACTIVITY_ID: active.ACTIVITY_ID
  });
  assert.ok(latestMessageWith(restarted.messages, 'ACTIVITY_STATE', 1));

  restarted.send({ PAUSE_ACTIVITY: 1, ACTIVITY_ID: 'wrong-id' });
  assert.strictEqual(
    restarted.messages[restarted.messages.length - 1].ACTIVITY_STATE,
    1
  );
  assert.strictEqual(
    restarted.messages[restarted.messages.length - 1].RECOVERY_MESSAGE,
    'SESSION CHANGED'
  );
  restarted.send({
    PAUSE_ACTIVITY: 1,
    ACTIVITY_ID: active.ACTIVITY_ID
  });
  assert.strictEqual(
    restarted.messages[restarted.messages.length - 1].ACTIVITY_STATE,
    2
  );
  restarted.send({ RESUME_ACTIVITY: 1, ACTIVITY_ID: 'wrong-id' });
  assert.strictEqual(
    restarted.messages[restarted.messages.length - 1].ACTIVITY_STATE,
    2
  );
  assert.strictEqual(
    restarted.messages[restarted.messages.length - 1].RECOVERY_MESSAGE,
    'SESSION CHANGED'
  );
  restarted.send({
    RESUME_ACTIVITY: 1,
    ACTIVITY_ID: active.ACTIVITY_ID
  });
  assert.strictEqual(
    restarted.messages[restarted.messages.length - 1].ACTIVITY_STATE,
    1
  );

  restarted.send({
    FINISH_ACTIVITY: 1,
    ACTIVITY_ID: active.ACTIVITY_ID
  });
  assert.ok(latestMessageWith(restarted.messages, 'ACTIVITY_STATE', 0));
  assert.strictEqual(storage.getItem(ActivityStore.ACTIVE_ACTIVITY_KEY), null);
  assert.strictEqual(
    JSON.parse(storage.getItem(ActivityStore.ACTIVITIES_KEY)).length,
    1
  );

  restarted.send({
    FINISH_ACTIVITY: 1,
    ACTIVITY_ID: active.ACTIVITY_ID
  });
  assert.strictEqual(
    JSON.parse(storage.getItem(ActivityStore.ACTIVITIES_KEY)).length,
    1
  );
});

run('runtime discards only the matching recovered draft', function() {
  var storage = createMemoryStorage();
  var first = launchRuntime(storage);
  first.ready();
  first.send({ REQUEST_GPS: 1 });
  first.send({ START_ACTIVITY: 1, ACTIVITY_TYPE: 2 });
  var active = latestMessageWith(first.messages, 'ACTIVITY_STATE', 1);

  var restarted = launchRuntime(storage);
  restarted.ready();
  restarted.send({ DISCARD_ACTIVITY: 1, ACTIVITY_ID: 'wrong-id' });
  assert.ok(storage.getItem(ActivityStore.ACTIVE_ACTIVITY_KEY));

  restarted.send({
    DISCARD_ACTIVITY: 1,
    ACTIVITY_ID: active.ACTIVITY_ID
  });
  assert.strictEqual(storage.getItem(ActivityStore.ACTIVE_ACTIVITY_KEY), null);
  assert.ok(latestMessageWith(restarted.messages, 'ACTIVITY_STATE', 0));
});

run('runtime retries failed state sends in order before newer upload state',function(){
  var runtime=launchRuntime(createMemoryStorage(),{sendFailures:2});
  runtime.ready();assert.strictEqual(runtime.messages.length,1);
  runtime.retryNext();assert.strictEqual(runtime.messages.length,2);
  runtime.retryNext();assert.strictEqual(runtime.messages.length,4);
  assert.deepStrictEqual(runtime.messages[0],runtime.messages[2]);
  assert.strictEqual(runtime.messages[3].UPLOAD_PENDING,0);
});

run('runtime echoes pause snapshots, makes target states idempotent, and protects session IDs',function(){
  var clock=1800000000000;Date.now=function(){return clock;};
  var runtime=launchRuntime(createMemoryStorage());runtime.ready();
  runtime.send({REQUEST_GPS:1});runtime.send({START_ACTIVITY:1,ACTIVITY_TYPE:1});
  var started=latestMessageWith(runtime.messages,'ACTIVITY_STATE',1);
  clock+=15000;
  function packet(start,end){var bytes=[];[start,end].forEach(function(stamp){for(var i=0;i<6;i++){bytes.push(stamp%256);stamp=Math.floor(stamp/256);}});return bytes;}
  var paused=packet(clock-10000,0);
  runtime.send({PAUSE_ACTIVITY:1,ACTIVITY_ID:started.ACTIVITY_ID,PAUSE_WINDOWS:paused});
  var reply=runtime.messages[runtime.messages.length-1];
  assert.strictEqual(reply.ACTIVITY_STATE,2);assert.strictEqual(reply.ACTIVITY_MOVING_S,5);assert.deepStrictEqual(reply.PAUSE_WINDOWS,paused);
  var resumed=packet(clock-10000,clock-5000);
  runtime.send({RESUME_ACTIVITY:1,ACTIVITY_ID:started.ACTIVITY_ID,PAUSE_WINDOWS:resumed});
  runtime.send({RESUME_ACTIVITY:1,ACTIVITY_ID:started.ACTIVITY_ID,PAUSE_WINDOWS:resumed});
  reply=runtime.messages[runtime.messages.length-1];assert.strictEqual(reply.ACTIVITY_STATE,1);assert.strictEqual(reply.ACTIVITY_MOVING_S,10);
  runtime.send({RESUME_ACTIVITY:1,ACTIVITY_ID:started.ACTIVITY_ID,PAUSE_WINDOWS:[1,2,3]});
  assert.strictEqual(runtime.messages[runtime.messages.length-1].RECOVERY_MESSAGE,'PAUSE SYNC FAILED');
  assert.strictEqual(runtime.messages[runtime.messages.length-1].PAUSE_WINDOWS,undefined);
  runtime.send({PAUSE_ACTIVITY:1,ACTIVITY_ID:'wrong',PAUSE_WINDOWS:paused});
  assert.strictEqual(runtime.messages[runtime.messages.length-1].RECOVERY_MESSAGE,'SESSION CHANGED');
});

run('a new GPS search rejects cached fixes and stale callbacks', function() {
  var clock = 1800000000000;
  Date.now = function() { return clock; };
  var runtime = launchRuntime(createMemoryStorage(), { manualGps: true });
  runtime.ready();
  runtime.send({ REQUEST_GPS: 1, GPS_REQUEST_ID: 10 });
  runtime.fix();
  var oldCallback = global.navigator.geolocation.watchSuccess;
  assert.strictEqual(latestMessageWith(runtime.messages, 'GPS_STATUS').GPS_STATUS, 2);
  clock += 1000;
  runtime.send({ REQUEST_GPS: 1, GPS_REQUEST_ID: 11 });
  oldCallback({coords: { latitude: 51, longitude: 0, accuracy: 8 }});
  runtime.fix(clock - 500);
  var searching = latestMessageWith(runtime.messages, 'GPS_STATUS');
  assert.strictEqual(searching.GPS_REQUEST_ID, 11);
  assert.strictEqual(searching.GPS_STATUS, 1);
  assert.strictEqual(searching.GPS_ACCURACY, -1);
  runtime.fix();
  runtime.send({ REQUEST_GPS: 1, GPS_REQUEST_ID: 11 });
  assert.strictEqual(latestMessageWith(runtime.messages, 'GPS_STATUS').GPS_STATUS, 2);
});

run('only the current recording can request a bounded route', function() {
  var runtime = launchRuntime(createMemoryStorage());
  runtime.ready();
  runtime.send({ REQUEST_GPS: 1, GPS_REQUEST_ID: 10 });
  runtime.send({ START_ACTIVITY: 1, ACTIVITY_TYPE: 1 });
  var id = latestMessageWith(runtime.messages, 'ACTIVITY_STATE', 1).ACTIVITY_ID;
  runtime.send({ REQUEST_ROUTE: 1, ACTIVITY_ID: 'old' });
  assert.strictEqual(latestMessageWith(runtime.messages, 'ROUTE_POINTS'), null);
  runtime.send({ REQUEST_ROUTE: 1, ACTIVITY_ID: id });
  var reply = latestMessageWith(runtime.messages, 'ROUTE_POINTS');
  assert.strictEqual(reply.ACTIVITY_ID, id);
  assert.deepStrictEqual(reply.ROUTE_POINTS, [1, 75, 190]);
});

run('an offline Strava upload reports failure and keeps the saved activity', function() {
  var storage = createMemoryStorage();
  storage.setItem(ActivityStore.SETTINGS_KEY, JSON.stringify({
    stravaEnabled: true, stravaAutoUpload: true,
    stravaClientId: '42', stravaClientSecret: 'test',
    stravaRefreshToken: 'test-refresh', stravaAccessToken: 'test-access',
    stravaExpiresAt: 9999999999, stravaScope: 'activity:write'
  }));
  function OfflineRequest() {}
  OfflineRequest.prototype.open = function() {};
  OfflineRequest.prototype.setRequestHeader = function() {};
  OfflineRequest.prototype.send = function() { this.onerror(); };
  var runtime = launchRuntime(storage, { XMLHttpRequest: OfflineRequest });
  runtime.ready();
  runtime.send({ REQUEST_GPS: 1, GPS_REQUEST_ID: 1 });
  runtime.send({ START_ACTIVITY: 1, ACTIVITY_TYPE: 1 });
  var id = latestMessageWith(runtime.messages, 'ACTIVITY_STATE', 1).ACTIVITY_ID;
  runtime.send({ FINISH_ACTIVITY: 1, ACTIVITY_ID: id });
  var failure = latestMessageWith(runtime.messages, 'STRAVA_STATUS', 5);
  assert.strictEqual(failure.ACTIVITY_ID, id);
  assert.strictEqual(failure.UPLOAD_PENDING, 0);
  var saved = JSON.parse(storage.getItem(ActivityStore.ACTIVITIES_KEY))[0];
  assert.strictEqual(saved.id, id);
  assert.strictEqual(saved.stravaStatus, 'failed');
  assert.strictEqual(saved.stravaError, 'Network error');
  var history = latestMessageWith(runtime.messages, 'HISTORY_ITEMS');
  assert.strictEqual(history.HISTORY_ITEMS.split(',').pop(), '5');
});
