var MAX_WATCH_HISTORY_ITEMS = 10;

var STATUS_UNKNOWN = 0;
var STATUS_NOT_UPLOADED = 1;
var STATUS_UPLOADING = 2;
var STATUS_PROCESSING = 3;
var STATUS_UPLOADED = 4;
var STATUS_FAILED = 5;
var STATUS_SKIPPED = 6;
var MAX_WATCH_DISTANCE_M = 999999;
var MAX_WATCH_MOVING_S = 999999;

function intValue(value, fallback) {
  var parsed = parseInt(value, 10);
  return isNaN(parsed) ? fallback : parsed;
}

function activityTypeCode(type) {
  if (type === 'walking') {
    return 0;
  }
  if (type === 'cycling') {
    return 2;
  }
  return 1;
}

function stravaStatusCode(activity) {
  var status = activity && activity.stravaStatus || 'not_uploaded';
  if (activity && activity.stravaActivityId) {
    return STATUS_UPLOADED;
  }
  if (status === 'uploaded') {
    return STATUS_UPLOADED;
  }
  if (status === 'uploading') {
    return STATUS_UPLOADING;
  }
  if (status === 'processing') {
    return STATUS_PROCESSING;
  }
  if (status === 'failed') {
    return STATUS_FAILED;
  }
  if (status === 'skipped') {
    return STATUS_SKIPPED;
  }
  if (status === 'not_uploaded') {
    return STATUS_NOT_UPLOADED;
  }
  return STATUS_UNKNOWN;
}

function shortMessage(value) {
  value = String(value || '').replace(/\s+/g, ' ');
  if (value.length > 60) {
    return value.slice(0, 57) + '...';
  }
  return value;
}

function boundedHistoryValue(value, maxValue) {
  return Math.min(maxValue, Math.max(0, intValue(value, 0)));
}

function activityStatusMessage(activity) {
  var status;
  if (!activity) {
    return 'No saved activities';
  }
  status = activity.stravaStatus || 'not_uploaded';
  if (activity.stravaActivityId) {
    return 'Strava uploaded #' + activity.stravaActivityId;
  }
  switch (status) {
    case 'uploading':
      if (activity.stravaUploadStatus) {
        return shortMessage(activity.stravaUploadStatus);
      }
      return 'Strava upload started';
    case 'processing':
      if (activity.stravaUploadStatus) {
        return shortMessage(activity.stravaUploadStatus);
      }
      return 'Strava is processing';
    case 'failed':
      if (activity.stravaError) {
        return shortMessage(activity.stravaError);
      }
      return 'Strava upload failed';
    case 'skipped':
      if (activity.stravaError) {
        return shortMessage(activity.stravaError);
      }
      return 'Strava upload skipped';
    case 'uploaded':
      return 'Strava uploaded';
    case 'not_uploaded':
    default:
      if (activity.stravaError) {
        return shortMessage(activity.stravaError);
      }
      if (activity.stravaUploadStatus) {
        return shortMessage(activity.stravaUploadStatus);
      }
      return 'Not uploaded to Strava';
  }
}

function historyItemsString(activities, limit) {
  var rows = [];
  var count;
  var i;
  var activity;

  activities = activities || [];
  count = Math.min(activities.length, limit || MAX_WATCH_HISTORY_ITEMS);
  for (i = 0; i < count; i += 1) {
    activity = activities[i] || {};
    rows.push([
      activityTypeCode(activity.type),
      boundedHistoryValue(activity.distanceM, MAX_WATCH_DISTANCE_M),
      boundedHistoryValue(activity.movingTimeS, MAX_WATCH_MOVING_S),
      stravaStatusCode(activity)
    ].join(','));
  }
  return rows.join(';');
}

function selectedActivity(activities, index) {
  activities = activities || [];
  index = intValue(index, -1);
  if (index < 0 || index >= activities.length ||
      index >= MAX_WATCH_HISTORY_ITEMS) {
    return null;
  }
  return activities[index];
}

function buildHistoryPayload(activities, notice) {
  activities = activities || [];
  var count = Math.min(activities.length, MAX_WATCH_HISTORY_ITEMS);
  return {
    count: count,
    items: historyItemsString(activities, MAX_WATCH_HISTORY_ITEMS),
    message: shortMessage(notice || (
      count ? activityStatusMessage(activities[0]) : 'No saved activities'
    ))
  };
}

module.exports = {
  MAX_WATCH_HISTORY_ITEMS: MAX_WATCH_HISTORY_ITEMS,
  STATUS_UNKNOWN: STATUS_UNKNOWN,
  STATUS_NOT_UPLOADED: STATUS_NOT_UPLOADED,
  STATUS_UPLOADING: STATUS_UPLOADING,
  STATUS_PROCESSING: STATUS_PROCESSING,
  STATUS_UPLOADED: STATUS_UPLOADED,
  STATUS_FAILED: STATUS_FAILED,
  STATUS_SKIPPED: STATUS_SKIPPED,
  MAX_WATCH_DISTANCE_M: MAX_WATCH_DISTANCE_M,
  MAX_WATCH_MOVING_S: MAX_WATCH_MOVING_S,
  activityStatusMessage: activityStatusMessage,
  buildHistoryPayload: buildHistoryPayload,
  historyItemsString: historyItemsString,
  selectedActivity: selectedActivity,
  stravaStatusCode: stravaStatusCode
};
