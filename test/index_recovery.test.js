var assert = require('assert');
var ActivityStore = require('../src/pkjs/activity_store');

function run(name, fn) {
  var originalNow = Date.now;
  try {
    fn();
  } finally {
    Date.now = originalNow;
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
  global.XMLHttpRequest = function() {};
  global.setInterval = function() { return 12; };
  global.clearInterval = function() {};
  global.Pebble = {
    addEventListener: function(name, callback) {
      listeners[name] = callback;
    },
    sendAppMessage: function(dictionary, success) {
      messages.push(dictionary);
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
