var Strava = require('./strava');

function parseJson(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function stravaHttpError(prefix, response, json) {
  var detail = '';
  var firstError;
  var parts = [];
  json = json || {};

  if (json.message) {
    detail = json.message;
  } else if (json.error) {
    detail = json.error;
  } else if (json.errors && json.errors.length) {
    firstError = json.errors[0] || {};
    if (firstError.resource) {
      parts.push(firstError.resource);
    }
    if (firstError.field) {
      parts.push(firstError.field);
    }
    if (firstError.code) {
      parts.push(firstError.code);
    }
    detail = parts.join(' ');
  }

  return prefix + ': HTTP ' + response.status +
      (detail ? ' - ' + detail : '');
}

function createHttpRequest(XMLHttpRequestConstructor) {
  return function request(options, callback) {
    var xhr = new XMLHttpRequestConstructor();
    var headers = options.headers || {};
    var key;

    xhr.onload = function() {
      callback(null, {
        status: xhr.status,
        text: xhr.responseText || ''
      });
    };
    xhr.onerror = function() {
      callback(new Error('Network error'));
    };
    xhr.open(options.method || 'GET', options.url);
    for (key in headers) {
      if (headers.hasOwnProperty(key)) {
        xhr.setRequestHeader(key, headers[key]);
      }
    }
    xhr.send(options.body || null);
  };
}

function createStravaService(options) {
  options = options || {};

  var store = options.store;
  var request = options.request;
  var setTimeoutFn = options.setTimeoutFn || setTimeout;
  var log = options.log || function() {};

  function refreshToken(callback) {
    var settings = store.getSettings();
    if (!settings.stravaRefreshToken) {
      callback(new Error('Missing Strava refresh token'));
      return;
    }

    request({
      method: 'POST',
      url: Strava.TOKEN_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: Strava.refreshTokenBody(settings)
    }, function(err, response) {
      var json;
      if (err) {
        callback(err);
        return;
      }
      json = parseJson(response.text, {});
      if (response.status < 200 || response.status >= 300) {
        callback(new Error(stravaHttpError(
          'Strava token refresh failed', response, json)));
        return;
      }
      settings = store.setSettings(
        Strava.applyTokenResponse(settings, json)
      );
      callback(null, settings.stravaAccessToken);
    });
  }

  function exchangeAuthorizationCode(callback) {
    var settings = store.getSettings();
    if (!settings.stravaAuthorizationCode) {
      callback(null);
      return;
    }
    if (!settings.stravaClientId || !settings.stravaClientSecret) {
      callback(new Error('Missing Strava client ID or secret'));
      return;
    }

    request({
      method: 'POST',
      url: Strava.TOKEN_URL,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: Strava.authorizationCodeBody(settings)
    }, function(err, response) {
      var json;
      if (err) {
        callback(err);
        return;
      }
      json = parseJson(response.text, {});
      if (response.status < 200 || response.status >= 300) {
        callback(new Error(stravaHttpError(
          'Strava authorization failed', response, json)));
        return;
      }
      store.setSettings(Strava.applyTokenResponse(settings, json));
      callback(null);
    });
  }

  function getAccessToken(callback) {
    var settings = store.getSettings();
    if (!Strava.isConfigured(settings)) {
      callback(new Error('Strava is not configured'));
      return;
    }
    if (!Strava.tokenNeedsRefresh(settings)) {
      callback(null, settings.stravaAccessToken);
      return;
    }
    refreshToken(callback);
  }

  function pollUpload(activityId, uploadId, attempt) {
    if (attempt > 10) {
      store.updateActivity(activityId, {
        stravaStatus: 'processing',
        stravaUploadStatus: 'Timed out waiting for Strava'
      });
      return;
    }

    setTimeoutFn(function() {
      request({
        method: 'GET',
        url: Strava.pollUrl(uploadId),
        headers: {
          Authorization:
              'Bearer ' + store.getSettings().stravaAccessToken
        }
      }, function(err, response) {
        var json;
        if (err) {
          store.updateActivity(activityId, {
            stravaStatus: 'processing',
            stravaUploadStatus: err.message
          });
          return;
        }

        json = parseJson(response.text, {});
        if (response.status < 200 || response.status >= 300) {
          store.updateActivity(activityId, {
            stravaStatus: 'processing',
            stravaUploadStatus: 'Poll HTTP ' + response.status
          });
          return;
        }
        if (json.error) {
          store.updateActivity(activityId, {
            stravaStatus: 'failed',
            stravaError: json.error,
            stravaUploadStatus: json.status || ''
          });
          return;
        }
        if (json.activity_id) {
          store.updateActivity(activityId, {
            stravaStatus: 'uploaded',
            stravaActivityId: json.activity_id,
            stravaUploadStatus: json.status || ''
          });
          log('Strava activity ready: ' + json.activity_id);
          return;
        }

        store.updateActivity(activityId, {
          stravaStatus: 'processing',
          stravaUploadStatus: json.status || 'Processing'
        });
        pollUpload(activityId, uploadId, attempt + 1);
      });
    }, 5000);
  }

  function uploadActivity(activity) {
    var settings = store.getSettings();
    if (!Strava.hasActivityWrite(settings)) {
      store.updateActivity(activity.id, {
        stravaStatus: 'failed',
        stravaError: 'Missing Strava activity:write scope'
      });
      log('Strava upload skipped: missing activity:write scope');
      return;
    }

    store.updateActivity(activity.id, {
      stravaStatus: 'uploading',
      stravaError: ''
    });

    getAccessToken(function(tokenErr) {
      var upload;
      if (tokenErr) {
        log('Strava token error: ' + tokenErr.message);
        store.updateActivity(activity.id, {
          stravaStatus: 'failed',
          stravaError: tokenErr.message
        });
        return;
      }

      settings = store.getSettings();
      upload = Strava.uploadRequest(activity, settings);
      request({
        method: 'POST',
        url: upload.url,
        headers: upload.headers,
        body: upload.body
      }, function(uploadErr, response) {
        var json;
        var uploadId;
        if (uploadErr) {
          log('Strava upload error: ' + uploadErr.message);
          store.updateActivity(activity.id, {
            stravaStatus: 'failed',
            stravaError: uploadErr.message
          });
          return;
        }

        json = parseJson(response.text, {});
        if (response.status < 200 || response.status >= 300) {
          store.updateActivity(activity.id, {
            stravaStatus: 'failed',
            stravaError: stravaHttpError(
              'Strava upload failed', response, json
            )
          });
          return;
        }

        uploadId = json.id || json.id_str || '';
        store.updateActivity(activity.id, {
          stravaStatus: 'processing',
          stravaUploadId: uploadId,
          stravaUploadStatus: json.status || ''
        });
        log('Strava upload queued: ' + (uploadId || '?'));
        if (uploadId) {
          pollUpload(activity.id, uploadId, 1);
        }
      });
    });
  }

  function maybeUpload(activity) {
    var settings = store.getSettings();
    if (!settings.stravaAutoUpload) {
      return;
    }
    if (!Strava.isConfigured(settings)) {
      log('Strava auto-upload skipped: not configured');
      store.updateActivity(activity.id, {
        stravaStatus: 'skipped',
        stravaError: 'Strava not configured'
      });
      return;
    }
    uploadActivity(activity);
  }

  function retryActivity(activity) {
    var settings = store.getSettings();
    if (!activity) {
      return {
        ok: false,
        message: 'Strava retry failed: activity not found.'
      };
    }
    if (!settings.stravaEnabled) {
      return {
        ok: false,
        message: 'Enable Strava and save settings before retrying.'
      };
    }
    if (!Strava.isConfigured(settings)) {
      return {
        ok: false,
        message:
            'Strava is not connected. Save a fresh authorization code or refresh token first.'
      };
    }
    if (!Strava.hasActivityWrite(settings)) {
      return {
        ok: false,
        message:
            'Strava did not grant activity:write. Authorize again with that scope.'
      };
    }
    uploadActivity(activity);
    return {
      ok: true,
      message:
          'Strava retry started. The activity status is now uploading.'
    };
  }

  return {
    refreshToken: refreshToken,
    exchangeAuthorizationCode: exchangeAuthorizationCode,
    uploadActivity: uploadActivity,
    maybeUpload: maybeUpload,
    retryActivity: retryActivity
  };
}

module.exports = {
  createHttpRequest: createHttpRequest,
  createStravaService: createStravaService,
  parseJson: parseJson,
  stravaHttpError: stravaHttpError
};

