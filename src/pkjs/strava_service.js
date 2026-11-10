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

function responseSnippet(text) {
  text = String(text || '').replace(/\s+/g, ' ');
  if (text.length > 180) {
    return text.slice(0, 177) + '...';
  }
  return text;
}

function activityPointCount(activity) {
  return activity && activity.points ? activity.points.length : 0;
}

function isInactiveApplicationError(json) {
  var firstError;
  json = json || {};
  firstError = json.errors && json.errors.length ? json.errors[0] : null;
  return firstError &&
      firstError.resource === 'Application' &&
      firstError.field === 'Status' &&
      firstError.code === 'Inactive';
}

function uploadForbiddenHint(settings, json) {
  if (isInactiveApplicationError(json)) {
    return 'Strava API app inactive; check Strava API dashboard/subscription.';
  }
  if (!settings || !settings.stravaScope) {
    return 'Stored Strava scope is unknown; reauthorize with activity:write.';
  }
  return 'Strava rejected the upload despite stored activity:write scope; reauthorize if this persists.';
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
    xhr.ontimeout = function() {
      callback(new Error('Network request timed out'));
    };
    xhr.open(options.method || 'GET', options.url);
    xhr.timeout = 20000;
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
  var onActivityUpdate = options.onActivityUpdate || function() {};
  var polls = {};

  function isUploadPending(activity) {
    return !!activity && !!activity.stravaUploadId &&
      (activity.stravaStatus === 'uploading' ||
       activity.stravaStatus === 'processing' ||
       activity.stravaStatus === 'unconfirmed');
  }

  function updateActivity(activityId, patch) {
    var updated = store.updateActivity(activityId, patch);
    if (updated) {
      onActivityUpdate(activityId, patch);
    }
    return updated;
  }

  function handleDuplicate(activityId, json) {
    if (!json.error || !/duplicate/i.test(json.error)) { return false; }
    delete polls[activityId];
    updateActivity(activityId, {
      stravaStatus: 'uploaded',
      stravaActivityId: json.activity_id || '',
      stravaError: '',
      stravaUploadStatus: 'Already uploaded to Strava'
    });
    return true;
  }

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
        log('Strava token refresh response: ' +
            responseSnippet(response.text));
        callback(new Error(stravaHttpError(
          'Strava token refresh failed', response, json)));
        return;
      }
      settings = store.setSettings(
        Strava.applyTokenResponse(store.getSettings(), json)
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
        log('Strava authorization response: ' +
            responseSnippet(response.text));
        callback(new Error(stravaHttpError(
          'Strava authorization failed', response, json)));
        return;
      }
      store.setSettings(Strava.applyTokenResponse(store.getSettings(), json));
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
      delete polls[activityId];
      updateActivity(activityId, {
        stravaStatus: 'unconfirmed',
        stravaUploadStatus: 'Timed out waiting for Strava',
        stravaError: ''
      });
      log('Strava upload poll timed out');
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
        var errorMessage;
        if (err) {
          updateActivity(activityId, {
            stravaStatus: 'processing',
            stravaUploadStatus: err.message,
            stravaError: ''
          });
          log('Strava upload poll error: ' + err.message);
          pollUpload(activityId, uploadId, attempt + 1);
          return;
        }

        json = parseJson(response.text, {});
        if (handleDuplicate(activityId, json)) { return; }
        if (response.status < 200 || response.status >= 300) {
          errorMessage = stravaHttpError(
            'Strava upload poll failed', response, json
          );
          updateActivity(activityId, {
            stravaStatus: 'processing',
            stravaUploadStatus: errorMessage,
            stravaError: ''
          });
          log(errorMessage);
          pollUpload(activityId, uploadId, attempt + 1);
          return;
        }
        if (json.error) {
          delete polls[activityId];
          updateActivity(activityId, {
            stravaStatus: 'failed',
            stravaError: json.error,
            stravaUploadStatus: json.status || ''
          });
          log('Strava upload failed: ' + json.error);
          return;
        }
        if (json.activity_id) {
          delete polls[activityId];
          updateActivity(activityId, {
            stravaStatus: 'uploaded',
            stravaActivityId: json.activity_id,
            stravaUploadStatus: json.status || '',
            stravaError: ''
          });
          log('Strava activity ready: ' + json.activity_id);
          return;
        }

        updateActivity(activityId, {
          stravaStatus: 'processing',
          stravaUploadStatus: json.status || 'Processing',
          stravaError: ''
        });
        pollUpload(activityId, uploadId, attempt + 1);
      });
    }, 5000);
  }

  function uploadActivity(activity) {
    var settings = store.getSettings();
    var saved = store.getActivity(activity.id);
    if (isUploadPending(saved)) {
      resumeUpload(saved);
      return;
    }
    if (saved && (saved.stravaStatus === 'uploading' || saved.stravaStatus === 'uploaded')) {
      return;
    }
    if (!Strava.hasActivityWrite(settings)) {
      updateActivity(activity.id, {
        stravaStatus: 'failed',
        stravaError: 'Missing Strava activity:write scope'
      });
      log('Strava upload skipped: missing activity:write scope');
      return;
    }

    updateActivity(activity.id, {
      stravaStatus: 'uploading',
      stravaError: '',
      stravaUploadStatus: '',
      stravaUploadId: '',
      stravaActivityId: ''
    });
    log('Strava upload starting for ' + activity.id + ': ' +
        activityPointCount(activity) + ' points, scope=' +
        (settings.stravaScope || 'unknown'));

    getAccessToken(function(tokenErr) {
      var upload;
      if (tokenErr) {
        log('Strava token error: ' + tokenErr.message);
        updateActivity(activity.id, {
          stravaStatus: 'failed',
          stravaError: tokenErr.message,
          stravaUploadStatus: ''
        });
        return;
      }

      settings = store.getSettings();
      upload = Strava.uploadRequest(activity, settings);
      log('Strava upload request ready for ' + activity.id + ': POST ' +
          upload.url + ', multipart body ' + upload.body.length + ' chars');
      request({
        method: 'POST',
        url: upload.url,
        headers: upload.headers,
        body: upload.body
      }, function(uploadErr, response) {
        var json;
        var errorMessage;
        var uploadId;
        if (uploadErr) {
          log('Strava upload error: ' + uploadErr.message);
          updateActivity(activity.id, {
            stravaStatus: 'failed',
            stravaError: uploadErr.message,
            stravaUploadStatus: ''
          });
          return;
        }

        json = parseJson(response.text, {});
        if (handleDuplicate(activity.id, json)) { return; }
        if (response.status < 200 || response.status >= 300) {
          errorMessage = stravaHttpError(
            'Strava upload failed', response, json
          );
          if (response.status === 403) {
            errorMessage += ' - ' + uploadForbiddenHint(settings, json);
          }
          log('Strava upload response: ' + responseSnippet(response.text));
          updateActivity(activity.id, {
            stravaStatus: 'failed',
            stravaError: errorMessage,
            stravaUploadStatus: ''
          });
          log(errorMessage);
          return;
        }

        uploadId = json.id || json.id_str || '';
        if (!uploadId) {
          updateActivity(activity.id, {
            stravaStatus: json.activity_id ? 'uploaded' : 'failed',
            stravaActivityId: json.activity_id || '',
            stravaError: json.activity_id ? '' : 'Strava did not return an upload ID'
          });
          return;
        }
        updateActivity(activity.id, {
          stravaStatus: 'processing',
          stravaUploadId: uploadId,
          stravaUploadStatus: json.status || '',
          stravaError: ''
        });
        log('Strava upload queued: ' + (uploadId || '?'));
        if (uploadId) {
          polls[activity.id] = true;
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
      updateActivity(activity.id, {
        stravaStatus: 'skipped',
        stravaError: 'Strava not configured'
      });
      return;
    }
    uploadActivity(activity);
  }

  function resumeUpload(activity) {
    if (!isUploadPending(activity) || polls[activity.id]) {
      return;
    }
    polls[activity.id] = true;
    getAccessToken(function(err) {
      if (err) {
        delete polls[activity.id];
        updateActivity(activity.id, {
          stravaStatus: 'unconfirmed',
          stravaUploadStatus: err.message
        });
        log('Strava polling deferred: ' + err.message);
        return;
      }
      if (activity.stravaStatus === 'unconfirmed') {
        updateActivity(activity.id, { stravaStatus: 'processing' });
      }
      pollUpload(activity.id, activity.stravaUploadId, 1);
    });
  }

  function resumePendingUploads() {
    store.getActivities().forEach(function(activity) {
      if ((activity.stravaStatus === 'uploading' ||
           activity.stravaStatus === 'processing') && !activity.stravaUploadId) {
        updateActivity(activity.id, {
          stravaStatus: 'failed',
          stravaError: 'Upload interrupted before Strava confirmed receipt. Retry to check.',
          stravaUploadStatus: ''
        });
      } else { resumeUpload(activity); }
    });
  }

  function retryActivity(activity) {
    var settings = store.getSettings();
    if (!activity) {
      return {
        ok: false,
        message: 'Strava retry failed: activity not found.'
      };
    }
    if (activity.stravaActivityId || activity.stravaStatus === 'uploaded') {
      return { ok: false, message: 'Already uploaded to Strava.' };
    }
    if (activity.stravaStatus === 'uploading' && !activity.stravaUploadId) {
      return { ok: false, message: 'Strava upload is already in progress.' };
    }
    if (activity.rawDataPruned) {
      return { ok: false, message: 'Track archived to Strava; local raw data was freed to save storage.' };
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
    retryActivity: retryActivity,
    resumePendingUploads: resumePendingUploads
  };
}

module.exports = {
  createHttpRequest: createHttpRequest,
  createStravaService: createStravaService,
  parseJson: parseJson,
  stravaHttpError: stravaHttpError
};
