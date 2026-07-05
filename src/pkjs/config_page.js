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
  if (activity.stravaUploadStatus) {
    return status + ': ' + activity.stravaUploadStatus;
  }
  return status;
}

function formatHrSummary(activity) {
  var parts = [];
  var zoneTime = activity.hrZoneTimeS || [];
  var i;

  if (activity.avgHrBpm) {
    parts.push(activity.avgHrBpm + ' bpm avg');
  }
  for (i = 1; i <= 3; i += 1) {
    if (zoneTime[i]) {
      parts.push('Z' + i + ' ' + formatDuration(zoneTime[i]));
    }
  }
  return parts.join(' · ');
}

function numericValue(value, fallback) {
  return typeof value === 'number' && isFinite(value) ? value : fallback;
}

function compactTypeCode(type) {
  if (type === 'walking') {
    return 'w';
  }
  if (type === 'cycling') {
    return 'c';
  }
  return 'r';
}

function numericPointValue(point, primary, secondary, fallback) {
  point = point || {};
  return numericValue(point[primary], numericValue(point[secondary], fallback));
}

function compactField(value) {
  var rounded;
  if (typeof value !== 'number' || !isFinite(value)) {
    return '';
  }
  rounded = Math.round(value);
  if (rounded < 0) {
    return '-' + (-rounded).toString(36);
  }
  return rounded.toString(36);
}

function scaledCoordinate(value) {
  return typeof value === 'number' && isFinite(value) ?
    Math.round(value * 100000) : null;
}

function compactBaseCoordinates(points) {
  var lat;
  var lon;
  var i;

  points = points || [];
  for (i = 0; i < points.length; i += 1) {
    lat = scaledCoordinate(numericValue(points[i] && points[i].lat, null));
    lon = scaledCoordinate(numericValue(points[i] && points[i].lon, null));
    if (lat !== null && lon !== null) {
      return {
        lat: lat,
        lon: lon
      };
    }
  }
  return {
    lat: 0,
    lon: 0
  };
}

function compactPointRows(points, startedAt, baseLat, baseLon) {
  var rows = [];
  var prevLat = baseLat;
  var prevLon = baseLon;
  var point;
  var timestamp;
  var lat;
  var lon;
  var fields;
  var i;

  for (i = 0; i < points.length; i += 1) {
    point = points[i] || {};
    timestamp = numericPointValue(point, 't', 'timestamp', startedAt);
    lat = scaledCoordinate(numericValue(point.lat, null));
    lon = scaledCoordinate(numericValue(point.lon, null));
    fields = [
      compactField(Math.max(0, Math.round((timestamp - startedAt) / 1000))),
      '',
      '',
      compactField(numericPointValue(point, 'alt', 'altitude', null)),
      compactField(numericValue(point.hr, null)),
      compactField(numericValue(point.distanceM, null))
    ];

    if (lat !== null && lon !== null) {
      fields[1] = compactField(lat - prevLat);
      fields[2] = compactField(lon - prevLon);
      prevLat = lat;
      prevLon = lon;
    }
    while (fields.length && fields[fields.length - 1] === '') {
      fields.pop();
    }
    rows.push(fields.join(','));
  }
  return rows.join(';');
}

function compactExportPayload(activity) {
  var points = activity && activity.points || [];
  var base = compactBaseCoordinates(points);
  var startedAt;

  startedAt = numericValue(
    activity && activity.startedAt,
    points.length ? numericPointValue(points[0], 't', 'timestamp', 0) : 0
  );
  return {
    t: compactTypeCode(activity && activity.type),
    s: startedAt,
    m: numericValue(activity && activity.movingTimeS, 0),
    d: numericValue(
      activity && activity.distanceM,
      numericValue(activity && activity.summaryDistanceM, 0)
    ),
    a: base.lat,
    o: base.lon,
    p: compactPointRows(points, startedAt, base.lat, base.lon)
  };
}

function escapeJsString(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function encodeDataHtml(html) {
  return encodeURI(html).replace(/#/g, '%23');
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
    if (formatHrSummary(activities[i])) {
      output.push('<p>' + escapeHtml(formatHrSummary(activities[i])) + '</p>');
    }
    output.push('<p>Strava: ' + escapeHtml(activityStatus(activities[i])) + '</p>');
    output.push('</article>');
  }

  return output.join('');
}

function buildConfigHtml(settings, activities, notice) {
  settings = settings || {};
  var settingsJson = JSON.stringify(settings || {});
  var activitiesJson = JSON.stringify(activities || []);
  var noticeHtml = notice ?
    '<p class="notice">' + escapeHtml(notice) + '</p>' : '';
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Pacelet Settings</title>',
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
    '.notice{background:#173b35;border:1px solid #00d084;border-radius:7px;color:#f5fbf8;padding:10px;}',
    'p{color:#a9b5ad;font-size:13px;line-height:1.4;}',
    'button{width:100%;border:0;border-radius:7px;background:#00d084;color:#061014;font-size:17px;font-weight:800;padding:12px;margin-top:10px;}',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<h1>Pacelet</h1>',
    noticeHtml,
    '<p>Pacelet has no shared Strava backend. Each user supplies their own Strava API app credentials, which are stored in Pebble app settings on this phone. Never share the client secret or tokens.</p>',
    '<form id="settings">',
    '<fieldset>',
    '<legend>Appearance</legend>',
    '<label class="check"><input id="darkMode" type="checkbox"' + checked(settings.darkMode) + '> Dark mode on watch</label>',
    '</fieldset>',
    '<fieldset>',
    '<legend>Heart Rate Zones</legend>',
    '<label for="hrZone1Bpm">Zone 1 starts (bpm)</label>',
    '<input id="hrZone1Bpm" type="number" inputmode="numeric" min="40" max="220" value="' + escapeHtml(settings.hrZone1Bpm || 100) + '">',
    '<label for="hrZone2Bpm">Zone 2 starts (bpm)</label>',
    '<input id="hrZone2Bpm" type="number" inputmode="numeric" min="41" max="230" value="' + escapeHtml(settings.hrZone2Bpm || 130) + '">',
    '<label for="hrZone3Bpm">Zone 3 starts (bpm)</label>',
    '<input id="hrZone3Bpm" type="number" inputmode="numeric" min="42" max="240" value="' + escapeHtml(settings.hrZone3Bpm || 160) + '">',
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
    '<p>Authorize with <code>activity:write</code>, then copy the <code>code</code> from the redirected URL and paste it below. Authorization codes are short-lived and can only be exchanged once. Generate a fresh code after reinstalling if no refresh token was preserved.</p>',
    '<label for="stravaAuthorizationCode">Authorization Code (short-lived, one-time)</label>',
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
    '<p>Use Activity History on the watch to export TCX files or retry Strava uploads. TCX export opens a phone page with a file download/share action.</p>',
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
    'hrZone1Bpm:value("hrZone1Bpm"),',
    'hrZone2Bpm:value("hrZone2Bpm"),',
    'hrZone3Bpm:value("hrZone3Bpm"),',
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
    '</script>',
    '</body>',
    '</html>'
  ].join('');
}

function buildConfigUrl(settings, activities, notice) {
  return 'data:text/html;charset=utf-8,' +
      encodeDataHtml(buildConfigHtml(settings, activities, notice));
}

function exportFileName(activity) {
  var id = String(activity && activity.id || 'pacelet-activity')
    .replace(/[^A-Za-z0-9._-]/g, '-');
  return id + '.tcx';
}

function buildExportHtml(activity) {
  var fileName = exportFileName(activity);
  var title = activityTitle(activity || {});
  var payload = compactExportPayload(activity || {});
  return [
    '<!doctype html>',
    '<html><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Export TCX</title>',
    '<style>',
    'body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;margin:0;background:#071014;color:#f5fbf8;}',
    'main{max-width:720px;margin:0 auto;padding:20px;}',
    'h1{font-size:24px;margin:0 0 8px;}',
    'p{color:#a9b5ad;font-size:13px;line-height:1.4;}',
    'textarea{box-sizing:border-box;width:100%;height:48vh;background:#101e22;color:#fff;border:1px solid #496267;border-radius:6px;padding:10px;font:12px monospace;}',
    '.actions{display:grid;gap:8px;margin-top:12px;}',
    'button,.button{box-sizing:border-box;width:100%;border:0;border-radius:7px;background:#00d084;color:#061014;font-size:16px;font-weight:800;padding:12px;text-align:center;text-decoration:none;}',
    '.secondary{background:#294247;color:#fff;}',
    '</style>',
    '</head><body><main>',
    '<h1>Export TCX</h1>',
    '<p>' + escapeHtml(title) + '</p>',
    '<p>Use Open TCX File to hand the file to your phone browser. Android commonly saves this to Downloads; iOS may offer Files or sharing. Copy TCX is the fallback.</p>',
    '<textarea id="tcx" readonly>Preparing TCX...</textarea>',
    '<div class="actions">',
    '<a class="button" id="openFile" download="' +
      escapeHtml(fileName) + '" href="#">Open TCX File</a>',
    '<button type="button" id="copy">Copy TCX</button>',
    '<a class="button secondary" href="pebblejs://close">Done</a>',
    '</div>',
    '<script>',
    'var payload={t:"' + escapeJsString(payload.t) + '",s:' +
      payload.s + ',m:' + payload.m + ',d:' + payload.d +
      ',a:' + payload.a + ',o:' + payload.o + ',p:"' +
      escapeJsString(payload.p) + '"};',
    'function esc(value){return String(value===null||typeof value==="undefined"?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/\'/g,"&apos;");}',
    'function iso(value){var date=new Date(value||0);return date.toISOString?date.toISOString():date.toUTCString();}',
    'function sport(type){return type==="c"||type==="cycling"?"biking":(type==="w"||type==="walking"?"walking":"running");}',
    'function num(value){var sign=1;var parsed;value=String(value||"");if(!value){return null;}if(value.charAt(0)==="-"){sign=-1;value=value.slice(1);}parsed=parseInt(value,36);return isNaN(parsed)?null:sign*parsed;}',
    'function decodePoints(activity){var rows=String(activity.p||"").split(";");var points=[];var lat=activity.a||0;var lon=activity.o||0;var i;var fields;var point;var dLat;var dLon;for(i=0;i<rows.length;i+=1){if(!rows[i]){continue;}fields=rows[i].split(",");point=[];point[0]=(activity.s||0)+(num(fields[0])||0)*1000;dLat=num(fields[1]);dLon=num(fields[2]);if(dLat!==null&&dLon!==null){lat+=dLat;lon+=dLon;point[1]=lat/100000;point[2]=lon/100000;}point[3]=num(fields[3]);point[4]=num(fields[4]);point[5]=num(fields[5]);points.push(point);}return points;}',
    'function hasPos(point){return typeof point[1]==="number"&&typeof point[2]==="number";}',
    'function hav(a,b){if(!hasPos(a)||!hasPos(b)){return 0;}var earth=6371000;var dLat=(b[1]-a[1])*Math.PI/180;var dLon=(b[2]-a[2])*Math.PI/180;var rLat1=a[1]*Math.PI/180;var rLat2=b[1]*Math.PI/180;var h=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(rLat1)*Math.cos(rLat2)*Math.sin(dLon/2)*Math.sin(dLon/2);return earth*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}',
    'function distances(points){var out=[];var total=0;var i;for(i=0;i<points.length;i+=1){if(i>0){total+=hav(points[i-1],points[i]);}out.push(total);}return out;}',
    'function generateTcx(activity){var points=activity.p||[];var dists=distances(points);var lines=[];var i;var point;lines.push("<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?>");lines.push("<TrainingCenterDatabase xmlns=\\"http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2\\">");lines.push("  <Activities>");lines.push("    <Activity Sport=\\""+esc(sport(activity.t))+"\\">");lines.push("      <Id>"+esc(iso(activity.s))+"</Id>");lines.push("      <Lap StartTime=\\""+esc(iso(activity.s))+"\\">");lines.push("        <TotalTimeSeconds>"+esc(activity.m||0)+"</TotalTimeSeconds>");lines.push("        <DistanceMeters>"+esc(Math.round(activity.d||0))+"</DistanceMeters>");lines.push("        <Intensity>Active</Intensity>");lines.push("        <TriggerMethod>Manual</TriggerMethod>");lines.push("        <Track>");for(i=0;i<points.length;i+=1){point=points[i];lines.push("          <Trackpoint>");lines.push("            <Time>"+esc(iso(point[0]))+"</Time>");if(hasPos(point)){lines.push("            <Position>");lines.push("              <LatitudeDegrees>"+esc(point[1])+"</LatitudeDegrees>");lines.push("              <LongitudeDegrees>"+esc(point[2])+"</LongitudeDegrees>");lines.push("            </Position>");}if(typeof point[3]==="number"){lines.push("            <AltitudeMeters>"+esc(point[3])+"</AltitudeMeters>");}lines.push("            <DistanceMeters>"+esc(Math.round(typeof point[5]==="number"?point[5]:dists[i]))+"</DistanceMeters>");if(typeof point[4]==="number"){lines.push("            <HeartRateBpm>");lines.push("              <Value>"+esc(point[4])+"</Value>");lines.push("            </HeartRateBpm>");}lines.push("          </Trackpoint>");}lines.push("        </Track>");lines.push("      </Lap>");lines.push("    </Activity>");lines.push("  </Activities>");lines.push("</TrainingCenterDatabase>");return lines.join("\\n");}',
    'function configureFile(tcx){var link=document.getElementById("openFile");var urlApi=window.URL||window.webkitURL;try{if(window.Blob&&urlApi&&urlApi.createObjectURL){link.href=urlApi.createObjectURL(new Blob([tcx],{type:"application/vnd.garmin.tcx+xml"}));return;}}catch(e){}link.href="data:application/vnd.garmin.tcx+xml;charset=utf-8,"+encodeURIComponent(tcx);}',
    'function prepare(){payload.p=decodePoints(payload);var tcx=generateTcx(payload);document.getElementById("tcx").value=tcx;configureFile(tcx);}',
    'function selectTcx(){var el=document.getElementById("tcx");el.focus();el.select();if(el.setSelectionRange){el.setSelectionRange(0,el.value.length);}}',
    'document.getElementById("copy").addEventListener("click",function(){',
    'selectTcx();',
    'var copied=false;',
    'try{copied=document.execCommand("copy");}catch(e){}',
    'this.textContent=copied?"Copied":"Selected - use Copy";',
    '});',
    'prepare();',
    '</script>',
    '</main></body></html>'
  ].join('');
}

function buildExportUrl(activity) {
  return 'data:text/html;charset=utf-8,' +
      encodeDataHtml(buildExportHtml(activity));
}

function parseResponse(response) {
  var value = String(response || '');
  var closePrefix = 'pebblejs://close';
  var hashIndex;

  if (value.indexOf(closePrefix) === 0) {
    hashIndex = value.indexOf('#');
    value = hashIndex === -1 ? '' : value.slice(hashIndex + 1);
  } else if (value.charAt(0) === '#') {
    value = value.slice(1);
  }
  try {
    value = decodeURIComponent(value);
  } catch (decodeErr) {
    // Some Pebble clients already decode the close payload.
  }
  if (value.charAt(0) === '#') {
    value = value.slice(1);
  }
  if (!value) {
    return null;
  }
  return JSON.parse(value);
}

module.exports = {
  buildExportHtml: buildExportHtml,
  buildExportUrl: buildExportUrl,
  buildConfigHtml: buildConfigHtml,
  buildConfigUrl: buildConfigUrl,
  parseResponse: parseResponse
};
