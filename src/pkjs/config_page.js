function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function checked(value) {
  return value ? ' checked' : '';
}

function formatDate(value) {
  if (!value) {
    return 'Unknown time';
  }
  try {
    return new Date(value).toLocaleString();
  } catch (e) {
    return String(value);
  }
}

function formatDistance(meters) {
  meters = parseInt(meters, 10) || 0;
  if (meters >= 1000) {
    return (meters / 1000).toFixed(2) + ' km';
  }
  return meters + ' m';
}

function formatDuration(seconds) {
  seconds = parseInt(seconds, 10) || 0;
  var mins = Math.floor(seconds / 60);
  var secs = seconds % 60;
  return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

function activityTitle(activity) {
  var type = activity.type || 'activity';
  return type.charAt(0).toUpperCase() + type.slice(1) + ' · ' +
      formatDate(activity.startedAt);
}

function activityStatus(activity) {
  var status = activity.stravaStatus || 'not_uploaded';
  if (activity.stravaActivityId) {
    return status + ' #' + activity.stravaActivityId;
  }
  if (activity.stravaError) {
    return status + ': ' + activity.stravaError;
  }
  return status;
}

function renderActivities(activities) {
  var output = [];
  var i;
  activities = activities || [];

  if (!activities.length) {
    return '<p>No saved activities yet.</p>';
  }

  for (i = 0; i < activities.length; i += 1) {
    output.push('<article class="activity">');
    output.push('<h3>' + escapeHtml(activityTitle(activities[i])) + '</h3>');
    output.push('<p>' + escapeHtml(formatDistance(activities[i].distanceM)) +
        ' · ' + escapeHtml(formatDuration(activities[i].movingTimeS)) +
        ' · ' + escapeHtml((activities[i].points || 0) + ' points') + '</p>');
    output.push('<p>Strava: ' + escapeHtml(activityStatus(activities[i])) + '</p>');
    output.push('<div class="actions">');
    output.push('<button type="button" data-action="export_tcx" data-id="' +
        escapeHtml(activities[i].id) + '">Export TCX</button>');
    output.push('<button type="button" data-action="retry_strava" data-id="' +
        escapeHtml(activities[i].id) + '">Retry Strava</button>');
    output.push('</div>');
    output.push('</article>');
  }

  return output.join('');
}

function buildConfigHtml(settings, activities) {
  settings = settings || {};
  var settingsJson = JSON.stringify(settings || {});
  var activitiesJson = JSON.stringify(activities || []);
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Pebble Tracker Settings</title>',
    '<style>',
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#071014;color:#f5fbf8;}',
    'main{max-width:560px;margin:0 auto;padding:20px;}',
    'h1{font-size:24px;margin:0 0 16px;}',
    'fieldset{border:1px solid #294247;border-radius:8px;margin:0 0 16px;padding:14px;}',
    'legend{color:#00d084;font-weight:700;padding:0 6px;}',
    'label{display:block;margin:13px 0 5px;color:#a9b5ad;font-size:13px;}',
    'input,textarea{box-sizing:border-box;width:100%;font-size:16px;border:1px solid #496267;border-radius:6px;background:#101e22;color:#fff;padding:10px;}',
    'input[type=checkbox]{width:auto;margin-right:8px;}',
    '.check{display:flex;align-items:center;color:#fff;margin:12px 0;}',
    '.activity{border-top:1px solid #294247;padding:12px 0;}',
    '.activity:first-child{border-top:0;}',
    '.activity h3{font-size:15px;margin:0 0 6px;}',
    '.activity p{margin:5px 0;}',
    '.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;}',
    'p{color:#a9b5ad;font-size:13px;line-height:1.4;}',
    'button{width:100%;border:0;border-radius:7px;background:#00d084;color:#061014;font-size:17px;font-weight:800;padding:12px;margin-top:10px;}',
    '.actions button{font-size:14px;margin-top:4px;padding:9px;}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>Pebble Tracker</h1>',
    '<p>Personal Strava upload stores these credentials only in the Pebble app settings on this phone. Do not use this for a public app build.</p>',
    '<form id="settings">',
    '<fieldset>',
    '<legend>Appearance</legend>',
    '<label class="check"><input id="darkMode" type="checkbox"' + checked(settings.darkMode) + '> Dark mode on watch</label>',
    '</fieldset>',
    '<fieldset>',
    '<legend>Strava</legend>',
    '<label class="check"><input id="stravaEnabled" type="checkbox"' + checked(settings.stravaEnabled) + '> Enable Strava</label>',
    '<label class="check"><input id="stravaAutoUpload" type="checkbox"' + checked(settings.stravaAutoUpload) + '> Upload when an activity is saved</label>',
    '<label for="stravaClientId">Client ID</label>',
    '<input id="stravaClientId" inputmode="numeric" value="' + escapeHtml(settings.stravaClientId) + '">',
    '<label for="stravaClientSecret">Client Secret</label>',
    '<input id="stravaClientSecret" value="' + escapeHtml(settings.stravaClientSecret) + '">',
    '<button type="button" id="openStravaAuth">Open Strava Authorization</button>',
    '<p>Authorize with <code>activity:write</code>, then copy the <code>code</code> from the redirected URL and paste it below.</p>',
    '<label for="stravaAuthorizationCode">Authorization Code (optional, one-time)</label>',
    '<input id="stravaAuthorizationCode" value="' + escapeHtml(settings.stravaAuthorizationCode) + '">',
    '<label for="stravaRefreshToken">Refresh Token</label>',
    '<input id="stravaRefreshToken" value="' + escapeHtml(settings.stravaRefreshToken) + '">',
    '<label for="stravaAccessToken">Access Token (optional)</label>',
    '<input id="stravaAccessToken" value="' + escapeHtml(settings.stravaAccessToken) + '">',
    '<label for="stravaExpiresAt">Access Token Expiry (Unix seconds, optional)</label>',
    '<input id="stravaExpiresAt" inputmode="numeric" value="' + escapeHtml(settings.stravaExpiresAt || '') + '">',
    '<label for="stravaScope">Granted Scope (filled after auth)</label>',
    '<input id="stravaScope" value="' + escapeHtml(settings.stravaScope) + '">',
    '<label for="stravaDescription">Upload Description</label>',
    '<textarea id="stravaDescription" rows="3">' + escapeHtml(settings.stravaDescription) + '</textarea>',
    '</fieldset>',
    '<button type="submit">Save Settings</button>',
    '</form>',
    '<fieldset>',
    '<legend>Recent Activities</legend>',
    renderActivities(activities),
    '</fieldset>',
    '</main>',
    '<script>',
    'var initial=' + settingsJson + ';',
    'var activities=' + activitiesJson + ';',
    'function value(id){return document.getElementById(id).value;}',
    'function enabled(id){return document.getElementById(id).checked;}',
    'function closeWith(data){document.location="pebblejs://close#"+encodeURIComponent(JSON.stringify(data));}',
    'document.getElementById("settings").addEventListener("submit",function(e){',
    'e.preventDefault();',
    'var data={',
    'action:"save_settings",',
    'darkMode:enabled("darkMode"),',
    'stravaEnabled:enabled("stravaEnabled"),',
    'stravaAutoUpload:enabled("stravaAutoUpload"),',
    'stravaClientId:value("stravaClientId"),',
    'stravaClientSecret:value("stravaClientSecret"),',
    'stravaAuthorizationCode:value("stravaAuthorizationCode"),',
    'stravaRefreshToken:value("stravaRefreshToken"),',
    'stravaAccessToken:value("stravaAccessToken"),',
    'stravaExpiresAt:value("stravaExpiresAt"),',
    'stravaScope:value("stravaScope"),',
    'stravaDescription:value("stravaDescription")',
    '};',
    'closeWith(data);',
    '});',
    'document.getElementById("openStravaAuth").addEventListener("click",function(){',
    'var clientId=value("stravaClientId");',
    'if(!clientId){alert("Enter your Strava Client ID first.");return;}',
    'var query="client_id="+encodeURIComponent(clientId)+"&redirect_uri="+encodeURIComponent("http://localhost")+"&response_type=code&approval_prompt=force&scope="+encodeURIComponent("read,activity:write");',
    'document.location="https://www.strava.com/oauth/authorize?"+query;',
    '});',
    'document.addEventListener("click",function(e){',
    'var target=e.target;',
    'if(!target || !target.getAttribute){return;}',
    'var action=target.getAttribute("data-action");',
    'if(!action){return;}',
    'closeWith({action:action,activityId:target.getAttribute("data-id")});',
    '});',
    '</script>',
    '</body>',
    '</html>'
  ].join('');
}

function buildConfigUrl(settings, activities) {
  return 'data:text/html;charset=utf-8,' +
      encodeURIComponent(buildConfigHtml(settings, activities));
}

module.exports = {
  buildConfigHtml: buildConfigHtml,
  buildConfigUrl: buildConfigUrl
};
