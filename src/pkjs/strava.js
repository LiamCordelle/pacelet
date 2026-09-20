var generateTcx = require('./tcx').generateTcx;

var TOKEN_URL = 'https://www.strava.com/oauth/token';
var UPLOAD_URL = 'https://www.strava.com/api/v3/uploads';
var AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
var TOKEN_REFRESH_MARGIN_S = 3600;
var DEFAULT_HR_ZONE_1_BPM = 100;
var DEFAULT_HR_ZONE_2_BPM = 130;
var DEFAULT_HR_ZONE_3_BPM = 160;

var DEFAULT_SETTINGS = {
  darkMode: false,
  hrZone1Bpm: DEFAULT_HR_ZONE_1_BPM,
  hrZone2Bpm: DEFAULT_HR_ZONE_2_BPM,
  hrZone3Bpm: DEFAULT_HR_ZONE_3_BPM,
  stravaEnabled: false,
  stravaAutoUpload: false,
  stravaClientId: '',
  stravaClientSecret: '',
  stravaAuthorizationCode: '',
  stravaRefreshToken: '',
  stravaAccessToken: '',
  stravaExpiresAt: 0,
  stravaScope: '',
  stravaDescription: 'Uploaded from Pacelet'
};

function copyDefaults(value) {
  var output = {};
  var key;
  value = value || {};
  for (key in DEFAULT_SETTINGS) {
    if (DEFAULT_SETTINGS.hasOwnProperty(key)) {
      output[key] = DEFAULT_SETTINGS[key];
    }
  }
  for (key in value) {
    if (value.hasOwnProperty(key) && output.hasOwnProperty(key)) {
      output[key] = value[key];
    }
  }
  return normalizeSettings(output);
}

function normalizeSettings(value) {
  value.darkMode = value.darkMode === true ||
      value.darkMode === 'true' || value.darkMode === 1 ||
      value.darkMode === '1' || value.darkMode === 'on';
  value.stravaEnabled = value.stravaEnabled === true ||
      value.stravaEnabled === 'true' || value.stravaEnabled === 1 ||
      value.stravaEnabled === '1' || value.stravaEnabled === 'on';
  value.stravaAutoUpload = value.stravaAutoUpload === true ||
      value.stravaAutoUpload === 'true' || value.stravaAutoUpload === 1 ||
      value.stravaAutoUpload === '1' || value.stravaAutoUpload === 'on';
  value.hrZone1Bpm = clampInt(
    value.hrZone1Bpm, 40, 220, DEFAULT_HR_ZONE_1_BPM);
  value.hrZone2Bpm = clampInt(
    value.hrZone2Bpm, value.hrZone1Bpm + 1, 230,
    Math.max(DEFAULT_HR_ZONE_2_BPM, value.hrZone1Bpm + 1));
  value.hrZone3Bpm = clampInt(
    value.hrZone3Bpm, value.hrZone2Bpm + 1, 240,
    Math.max(DEFAULT_HR_ZONE_3_BPM, value.hrZone2Bpm + 1));
  value.stravaClientId = stringValue(value.stravaClientId);
  value.stravaClientSecret = stringValue(value.stravaClientSecret);
  value.stravaAuthorizationCode = stringValue(value.stravaAuthorizationCode);
  value.stravaRefreshToken = stringValue(value.stravaRefreshToken);
  value.stravaAccessToken = stringValue(value.stravaAccessToken);
  value.stravaExpiresAt = intValue(value.stravaExpiresAt, 0);
  value.stravaScope = stringValue(value.stravaScope);
  value.stravaDescription = stringValue(value.stravaDescription) ||
      DEFAULT_SETTINGS.stravaDescription;
  return value;
}

function stringValue(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }
  return String(value).replace(/^\s+|\s+$/g, '');
}

function intValue(value, fallback) {
  var parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function clampInt(value, minValue, maxValue, fallback) {
  var parsed = intValue(value, fallback);
  return Math.max(minValue, Math.min(maxValue, parsed));
}

function isConfigured(settings) {
  settings = copyDefaults(settings);
  return settings.stravaEnabled &&
      !!settings.stravaClientId &&
      !!settings.stravaClientSecret &&
      (!!settings.stravaRefreshToken || !!settings.stravaAccessToken);
}

function tokenNeedsRefresh(settings, nowSeconds) {
  settings = copyDefaults(settings);
  nowSeconds = typeof nowSeconds === 'number' ?
      nowSeconds : Math.floor(new Date().getTime() / 1000);
  if (!settings.stravaAccessToken) {
    return true;
  }
  return settings.stravaExpiresAt <= nowSeconds + TOKEN_REFRESH_MARGIN_S;
}

function hasActivityWrite(settings) {
  settings = copyDefaults(settings);
  if (!settings.stravaScope) {
    return true;
  }
  return (' ' + settings.stravaScope.replace(/,/g, ' ') + ' ')
    .indexOf(' activity:write ') !== -1;
}

function formEncode(fields) {
  var parts = [];
  var key;
  for (key in fields) {
    if (fields.hasOwnProperty(key) &&
        fields[key] !== null &&
        typeof fields[key] !== 'undefined') {
      parts.push(encodeURIComponent(key) + '=' +
          encodeURIComponent(String(fields[key])));
    }
  }
  return parts.join('&');
}

function refreshTokenBody(settings) {
  settings = copyDefaults(settings);
  return formEncode({
    client_id: settings.stravaClientId,
    client_secret: settings.stravaClientSecret,
    grant_type: 'refresh_token',
    refresh_token: settings.stravaRefreshToken
  });
}

function authorizationCodeBody(settings) {
  settings = copyDefaults(settings);
  return formEncode({
    client_id: settings.stravaClientId,
    client_secret: settings.stravaClientSecret,
    code: settings.stravaAuthorizationCode,
    grant_type: 'authorization_code'
  });
}

function authorizationUrl(clientId, redirectUri) {
  return AUTHORIZE_URL + '?' + formEncode({
    client_id: clientId,
    redirect_uri: redirectUri || 'http://localhost',
    response_type: 'code',
    approval_prompt: 'force',
    scope: 'read,activity:write'
  });
}

function applyTokenResponse(settings, response) {
  settings = copyDefaults(settings);
  if (response.access_token) {
    settings.stravaAccessToken = response.access_token;
  }
  if (response.refresh_token) {
    settings.stravaRefreshToken = response.refresh_token;
  }
  if (response.expires_at) {
    settings.stravaExpiresAt = intValue(response.expires_at, 0);
  }
  if (response.scope) {
    settings.stravaScope = stringValue(response.scope);
  }
  settings.stravaAuthorizationCode = '';
  return settings;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function isoTime(ms) {
  return new Date(ms).toISOString();
}

function sportForActivityType(type) {
  if (type === 'cycling') {
    return 'Biking';
  }
  if (type === 'walking') {
    return 'Other';
  }
  return 'Running';
}

function stravaSportType(type) {
  if (type === 'cycling') {
    return 'Ride';
  }
  if (type === 'walking') {
    return 'Walk';
  }
  return 'Run';
}

function titleForActivity(activity) {
  var type = activity.type || 'running';
  var label = type.charAt(0).toUpperCase() + type.slice(1);
  return 'Pacelet ' + label + ' ' + isoTime(activity.startedAt).slice(0, 16);
}

function makeBoundary() {
  return '----PebbleTracker' + Math.floor(Math.random() * 1000000000);
}

function multipartBody(fields, fileField, fileName, fileContent, boundary) {
  var lines = [];
  var key;
  boundary = boundary || makeBoundary();

  for (key in fields) {
    if (fields.hasOwnProperty(key) &&
        fields[key] !== null &&
        typeof fields[key] !== 'undefined') {
      lines.push('--' + boundary);
      lines.push('Content-Disposition: form-data; name="' + key + '"');
      lines.push('');
      lines.push(String(fields[key]));
    }
  }

  lines.push('--' + boundary);
  lines.push('Content-Disposition: form-data; name="' + fileField +
      '"; filename="' + fileName + '"');
  lines.push('Content-Type: application/vnd.garmin.tcx+xml');
  lines.push('');
  lines.push(fileContent);
  lines.push('--' + boundary + '--');
  lines.push('');

  return {
    boundary: boundary,
    body: lines.join('\r\n')
  };
}

function uploadFileName(activity) {
  return (activity.id || 'pebble-activity') + '.tcx';
}

function uploadRequest(activity, settings) {
  var tcx = generateTcx(activity);
  var multi = multipartBody({
    data_type: 'tcx',
    name: titleForActivity(activity),
    description: copyDefaults(settings).stravaDescription,
    external_id: uploadFileName(activity)
  }, 'file', uploadFileName(activity), tcx);

  return {
    url: UPLOAD_URL,
    headers: {
      Authorization: 'Bearer ' + copyDefaults(settings).stravaAccessToken,
      'Content-Type': 'multipart/form-data; boundary=' + multi.boundary
    },
    body: multi.body
  };
}

function pollUrl(uploadId) {
  return UPLOAD_URL + '/' + encodeURIComponent(uploadId);
}

module.exports = {
  AUTHORIZE_URL: AUTHORIZE_URL,
  TOKEN_URL: TOKEN_URL,
  UPLOAD_URL: UPLOAD_URL,
  DEFAULT_SETTINGS: DEFAULT_SETTINGS,
  applyTokenResponse: applyTokenResponse,
  authorizationCodeBody: authorizationCodeBody,
  authorizationUrl: authorizationUrl,
  copyDefaults: copyDefaults,
  formEncode: formEncode,
  generateTcx: generateTcx,
  hasActivityWrite: hasActivityWrite,
  isConfigured: isConfigured,
  multipartBody: multipartBody,
  pollUrl: pollUrl,
  refreshTokenBody: refreshTokenBody,
  sportForActivityType: sportForActivityType,
  stravaSportType: stravaSportType,
  titleForActivity: titleForActivity,
  tokenNeedsRefresh: tokenNeedsRefresh,
  uploadRequest: uploadRequest
};
