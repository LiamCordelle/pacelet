var TOKEN_URL = 'https://www.strava.com/oauth/token';
var UPLOAD_URL = 'https://www.strava.com/api/v3/uploads';
var AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
var TOKEN_REFRESH_MARGIN_S = 3600;

var DEFAULT_SETTINGS = {
  darkMode: false,
  stravaEnabled: false,
  stravaAutoUpload: false,
  stravaClientId: '',
  stravaClientSecret: '',
  stravaAuthorizationCode: '',
  stravaRefreshToken: '',
  stravaAccessToken: '',
  stravaExpiresAt: 0,
  stravaScope: '',
  stravaDescription: 'Uploaded from Pebble Activity Tracker'
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
    return 'biking';
  }
  if (type === 'walking') {
    return 'walking';
  }
  return 'running';
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
  return 'Pebble ' + label + ' ' + isoTime(activity.startedAt).slice(0, 16);
}

function pointTime(point) {
  return point.t || point.timestamp || 0;
}

function pointLat(point) {
  return typeof point.lat === 'number' ? point.lat : null;
}

function pointLon(point) {
  return typeof point.lon === 'number' ? point.lon : null;
}

function pointAlt(point) {
  return typeof point.alt === 'number' ? point.alt :
      (typeof point.altitude === 'number' ? point.altitude : null);
}

function pointHr(point) {
  return typeof point.hr === 'number' ? point.hr : null;
}

function pointDistance(point, fallback) {
  return typeof point.distanceM === 'number' ? point.distanceM : fallback;
}

function haversineMeters(a, b) {
  var earthM = 6371000;
  var lat1 = pointLat(a);
  var lat2 = pointLat(b);
  var lon1 = pointLon(a);
  var lon2 = pointLon(b);
  if (lat1 === null || lat2 === null || lon1 === null || lon2 === null) {
    return 0;
  }
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var rLat1 = lat1 * Math.PI / 180;
  var rLat2 = lat2 * Math.PI / 180;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(rLat1) * Math.cos(rLat2) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function cumulativeDistances(points) {
  var distances = [];
  var total = 0;
  var i;
  for (i = 0; i < points.length; i += 1) {
    if (i > 0) {
      total += haversineMeters(points[i - 1], points[i]);
    }
    distances.push(total);
  }
  return distances;
}

function generateTcx(activity) {
  var points = activity.points || [];
  var startedAt = activity.startedAt || (points[0] ? pointTime(points[0]) : 0);
  var movingTimeS = activity.movingTimeS || 0;
  var distanceM = activity.distanceM || activity.summaryDistanceM || 0;
  var sport = sportForActivityType(activity.type);
  var distances = cumulativeDistances(points);
  var lines = [];
  var i;

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">');
  lines.push('  <Activities>');
  lines.push('    <Activity Sport="' + escapeXml(sport) + '">');
  lines.push('      <Id>' + escapeXml(isoTime(startedAt)) + '</Id>');
  lines.push('      <Lap StartTime="' + escapeXml(isoTime(startedAt)) + '">');
  lines.push('        <TotalTimeSeconds>' + escapeXml(movingTimeS) + '</TotalTimeSeconds>');
  lines.push('        <DistanceMeters>' + escapeXml(Math.round(distanceM)) + '</DistanceMeters>');
  lines.push('        <Intensity>Active</Intensity>');
  lines.push('        <TriggerMethod>Manual</TriggerMethod>');
  lines.push('        <Track>');

  for (i = 0; i < points.length; i += 1) {
    lines.push('          <Trackpoint>');
    lines.push('            <Time>' + escapeXml(isoTime(pointTime(points[i]))) + '</Time>');
    if (pointLat(points[i]) !== null && pointLon(points[i]) !== null) {
      lines.push('            <Position>');
      lines.push('              <LatitudeDegrees>' + escapeXml(pointLat(points[i])) + '</LatitudeDegrees>');
      lines.push('              <LongitudeDegrees>' + escapeXml(pointLon(points[i])) + '</LongitudeDegrees>');
      lines.push('            </Position>');
    }
    if (pointAlt(points[i]) !== null) {
      lines.push('            <AltitudeMeters>' + escapeXml(pointAlt(points[i])) + '</AltitudeMeters>');
    }
    lines.push('            <DistanceMeters>' +
        escapeXml(Math.round(pointDistance(points[i], distances[i]))) +
        '</DistanceMeters>');
    if (pointHr(points[i]) !== null) {
      lines.push('            <HeartRateBpm>');
      lines.push('              <Value>' + escapeXml(pointHr(points[i])) + '</Value>');
      lines.push('            </HeartRateBpm>');
    }
    lines.push('          </Trackpoint>');
  }

  lines.push('        </Track>');
  lines.push('      </Lap>');
  lines.push('    </Activity>');
  lines.push('  </Activities>');
  lines.push('</TrainingCenterDatabase>');
  return lines.join('\n');
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
