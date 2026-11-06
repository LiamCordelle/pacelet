#include "watch_services.h"

#include "activity_controller.h"
#include "pacelet_model.h"
#include "watch_ui.h"

#include <string.h>

#define SETTINGS_KEY 1
#define SETTINGS_VERSION 3
#define METRICS_KEY 4
#define ACTIVITY_STATE_KEY 2
#define ACTIVITY_STATE_VERSION 1
#define ACTIVITY_PAUSES_KEY 3

typedef struct {
  uint8_t version;
  uint8_t size;
  uint8_t windows[60];
  char activity_id[24];
} PersistedPauses;

typedef struct {
  uint8_t version;
  bool dark_mode;
  uint16_t hr_zone_1_bpm;
  uint16_t hr_zone_2_bpm;
  uint16_t hr_zone_3_bpm;
} AppSettingsV2;

typedef struct {
  AppSettingsV2 legacy;
  uint8_t motion_mode;
} AppSettings;

typedef struct {
  uint8_t version;
  bool dark_mode;
} AppSettingsV1;

typedef struct {
  uint8_t version;
  uint8_t phone_state;
  uint8_t activity_type;
  uint8_t reserved;
  int32_t moving_s;
  int32_t distance_m;
  int32_t checkpointed_at;
  int32_t next_split_km;
  int32_t last_split_elapsed_s;
  int32_t activity_start_steps_today;
  int32_t total_paused_steps;
  int32_t current_steps;
  uint32_t pending_command;
  char activity_id[24];
} PersistedActivityState;

typedef struct {
  uint8_t version;
  char activity_id[24];
  int32_t splits[PACELET_RECENT_SPLITS];
  int32_t previous_split_s, best_split_s, split_number;
  int32_t zone_s[4];
  uint32_t hr_sum, hr_count;
} PersistedMetrics;

static AppTimer *s_retry_timer;
static bool s_initial_state_pending;
static bool s_gps_pending;
static bool s_history_pending;
static uint8_t s_request_retries;

static bool send_command(uint32_t command_key, bool mark_pending);
static void schedule_retry(void);

static bool is_reliable_command(uint32_t command_key) {
  return command_key == MESSAGE_KEY_START_ACTIVITY ||
      command_key == MESSAGE_KEY_PAUSE_ACTIVITY ||
      command_key == MESSAGE_KEY_RESUME_ACTIVITY ||
      command_key == MESSAGE_KEY_FINISH_ACTIVITY ||
      command_key == MESSAGE_KEY_RECOVER_ACTIVITY ||
      command_key == MESSAGE_KEY_DISCARD_ACTIVITY;
}

static PhoneActivityState current_phone_activity_state(void) {
  if (g_pacelet.activity_state == ActivityStateActive) {
    return PhoneActivityStateActive;
  }
  if (g_pacelet.activity_state == ActivityStatePaused) {
    return PhoneActivityStatePaused;
  }
  return PhoneActivityStateRecovery;
}

void watch_services_clear_activity_state(void) {
  persist_delete(ACTIVITY_STATE_KEY);
  persist_delete(ACTIVITY_PAUSES_KEY);
  persist_delete(METRICS_KEY);
  g_pacelet.pause_windows_size = 0;
  g_pacelet.pending_command = 0;
  g_pacelet.activity_id[0] = '\0';
}

void watch_services_save_activity_state(void) {
  bool has_activity =
      g_pacelet.activity_state == ActivityStateActive ||
      g_pacelet.activity_state == ActivityStatePaused ||
      g_pacelet.activity_state == ActivityStateRecovery ||
      g_pacelet.pending_command != 0;
  PersistedActivityState state;

  if (!has_activity) {
    watch_services_clear_activity_state();
    return;
  }

  memset(&state, 0, sizeof(state));
  state.version = ACTIVITY_STATE_VERSION;
  state.phone_state = (uint8_t)current_phone_activity_state();
  state.activity_type = (uint8_t)g_pacelet.activity_type;
  state.moving_s = pacelet_elapsed_s();
  state.distance_m = g_pacelet.distance_m;
  state.checkpointed_at = g_pacelet.activity_checkpointed_at;
  state.next_split_km = g_pacelet.next_split_km;
  state.last_split_elapsed_s = g_pacelet.last_split_elapsed_s;
  state.activity_start_steps_today =
      g_pacelet.activity_start_steps_today;
  state.total_paused_steps = g_pacelet.total_paused_steps;
  state.current_steps = g_pacelet.current_steps;
  state.pending_command = g_pacelet.pending_command;
  snprintf(state.activity_id, sizeof(state.activity_id), "%s",
           g_pacelet.activity_id);
  persist_write_data(ACTIVITY_STATE_KEY, &state, sizeof(state));
  PersistedPauses pauses = {.version = 1, .size = g_pacelet.pause_windows_size};
  memcpy(pauses.windows, g_pacelet.pause_windows, sizeof(pauses.windows));
  snprintf(pauses.activity_id, sizeof(pauses.activity_id), "%s", g_pacelet.activity_id);
  persist_write_data(ACTIVITY_PAUSES_KEY, &pauses, sizeof(pauses));
  PersistedMetrics metrics = {.version = 1,
    .previous_split_s = g_pacelet.previous_split_s,
    .best_split_s = g_pacelet.best_split_s, .split_number = g_pacelet.split_number,
    .hr_sum = g_pacelet.hr_sum, .hr_count = g_pacelet.hr_count};
  memcpy(metrics.activity_id, state.activity_id, sizeof(metrics.activity_id));
  memcpy(metrics.splits, g_pacelet.recent_splits, sizeof(metrics.splits));
  memcpy(metrics.zone_s, g_pacelet.zone_s, sizeof(metrics.zone_s));
  persist_write_data(METRICS_KEY, &metrics, sizeof(metrics));
}

void watch_services_load_activity_state(void) {
  PersistedActivityState state;
  int state_size = persist_get_size(ACTIVITY_STATE_KEY);

  if (state_size != (int)sizeof(state) ||
      persist_read_data(ACTIVITY_STATE_KEY, &state, sizeof(state)) !=
          (int)sizeof(state) ||
      state.version != ACTIVITY_STATE_VERSION ||
      state.phone_state < PhoneActivityStateActive ||
      state.phone_state > PhoneActivityStateRecovery ||
      state.activity_type > ActivityTypeCycling || state.moving_s < 0 ||
      state.distance_m < 0) {
    if (state_size > 0) {
      persist_delete(ACTIVITY_STATE_KEY);
    }
    return;
  }

  g_pacelet.activity_type = (ActivityType)state.activity_type;
  g_pacelet.choose_index = state.activity_type;
  pacelet_set_state(ActivityStateRecovery);
  g_pacelet.recovery_moving_s = state.moving_s;
  g_pacelet.finished_elapsed_s = state.moving_s;
  g_pacelet.distance_m = state.distance_m;
  g_pacelet.activity_checkpointed_at = state.checkpointed_at;
  g_pacelet.next_split_km = state.next_split_km > 0 ?
      state.next_split_km : state.distance_m / 1000 + 1;
  g_pacelet.last_split_elapsed_s = state.last_split_elapsed_s;
  g_pacelet.activity_start_steps_today =
      state.activity_start_steps_today;
  g_pacelet.total_paused_steps = state.total_paused_steps;
  g_pacelet.current_steps = state.current_steps;
  g_pacelet.current_steps_available =
      state.activity_start_steps_today >= 0;
  g_pacelet.pending_command = state.pending_command;
  state.activity_id[sizeof(state.activity_id) - 1] = '\0';
  snprintf(g_pacelet.activity_id, sizeof(g_pacelet.activity_id), "%s",
           state.activity_id);
  PersistedPauses pauses;
  if (persist_read_data(ACTIVITY_PAUSES_KEY, &pauses, sizeof(pauses)) == sizeof(pauses) &&
      pauses.version == 1 && pauses.size <= sizeof(pauses.windows) &&
      pauses.size % 12 == 0 &&
      memcmp(pauses.activity_id, state.activity_id, sizeof(state.activity_id)) == 0) {
    g_pacelet.pause_windows_size = pauses.size;
    memcpy(g_pacelet.pause_windows, pauses.windows, sizeof(pauses.windows));
  }
  PersistedMetrics metrics;
  if (persist_read_data(METRICS_KEY, &metrics, sizeof(metrics)) == sizeof(metrics) &&
      metrics.version == 1 && memcmp(metrics.activity_id, state.activity_id, sizeof(state.activity_id)) == 0) {
    memcpy(g_pacelet.recent_splits, metrics.splits, sizeof(metrics.splits));
    memcpy(g_pacelet.zone_s, metrics.zone_s, sizeof(metrics.zone_s));
    g_pacelet.previous_split_s = metrics.previous_split_s;
    g_pacelet.best_split_s = metrics.best_split_s;
    g_pacelet.split_number = metrics.split_number;
    g_pacelet.hr_sum = metrics.hr_sum; g_pacelet.hr_count = metrics.hr_count;
  }
  g_pacelet.recovery_phone_draft_available = false;
  snprintf(g_pacelet.recovery_message,
           sizeof(g_pacelet.recovery_message), "CHECKING PHONE");
}

static void save_settings(void) {
  AppSettings settings = {
    .legacy = { .version = SETTINGS_VERSION, .dark_mode = false,
      .hr_zone_1_bpm = g_pacelet.hr_zone_1_bpm,
      .hr_zone_2_bpm = g_pacelet.hr_zone_2_bpm,
      .hr_zone_3_bpm = g_pacelet.hr_zone_3_bpm },
    .motion_mode = g_pacelet.motion_mode
  };
  persist_write_data(SETTINGS_KEY, &settings, sizeof(settings));
}

void watch_services_load_settings(void) {
  int size = persist_get_size(SETTINGS_KEY);
  AppSettings settings = {0};
  if (size == sizeof(settings) &&
      persist_read_data(SETTINGS_KEY, &settings, sizeof(settings)) == sizeof(settings) &&
      settings.legacy.version == SETTINGS_VERSION) {
    g_pacelet.motion_mode = pacelet_clamp_i32(settings.motion_mode, MotionFull, MotionOff);
  } else if (size == sizeof(AppSettingsV2) &&
      persist_read_data(SETTINGS_KEY, &settings.legacy, sizeof(AppSettingsV2)) == sizeof(AppSettingsV2) &&
      settings.legacy.version == 2) {
    // Thresholds survive removal of the old display preference.
  } else { return; } // V1 has no thresholds; the model defaults are correct.
  g_pacelet.hr_zone_1_bpm = settings.legacy.hr_zone_1_bpm;
  g_pacelet.hr_zone_2_bpm = settings.legacy.hr_zone_2_bpm;
  g_pacelet.hr_zone_3_bpm = settings.legacy.hr_zone_3_bpm;
  pacelet_normalize_hr_zone_thresholds();
}

static bool send_command(uint32_t command_key, bool mark_pending) {
  DictionaryIterator *iter;
  AppMessageResult result;

  if (mark_pending && is_reliable_command(command_key)) {
    g_pacelet.pending_command = command_key;
    watch_services_save_activity_state();
  }
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return false;
  }

  dict_write_uint8(iter, command_key, 1);
  if (command_key == MESSAGE_KEY_START_ACTIVITY) {
    dict_write_uint8(iter, MESSAGE_KEY_ACTIVITY_TYPE,
                     (uint8_t)g_pacelet.activity_type);
  }
  if (is_reliable_command(command_key) &&
      g_pacelet.activity_id[0] != '\0') {
    dict_write_cstring(iter, MESSAGE_KEY_ACTIVITY_ID,
                       g_pacelet.activity_id);
  }
  if (command_key == MESSAGE_KEY_PAUSE_ACTIVITY ||
      command_key == MESSAGE_KEY_RESUME_ACTIVITY ||
      command_key == MESSAGE_KEY_FINISH_ACTIVITY) {
    dict_write_data(iter, MESSAGE_KEY_PAUSE_WINDOWS, g_pacelet.pause_windows,
                    g_pacelet.pause_windows_size);
  }
  result = app_message_outbox_send();
  return result == APP_MSG_OK;
}

void watch_services_send_command(uint32_t command_key) {
  if (g_pacelet.pending_command == MESSAGE_KEY_START_ACTIVITY &&
      !g_pacelet.activity_id[0] && command_key != MESSAGE_KEY_START_ACTIVITY &&
      is_reliable_command(command_key)) {
    // Keep retrying START; the controller sends the current target on its ACK.
    watch_services_save_activity_state();
    schedule_retry();
    return;
  }
  if (command_key == MESSAGE_KEY_REQUEST_GPS) {
    s_gps_pending = true;
    s_request_retries = 0;
  } else if (command_key == MESSAGE_KEY_REQUEST_HISTORY) {
    s_history_pending = true;
    s_request_retries = 0;
  }
  if (!send_command(command_key, true) &&
      (is_reliable_command(command_key) || s_gps_pending || s_history_pending)) {
    schedule_retry();
  }
}

void watch_services_send_history_action(uint32_t command_key,
                                        int32_t history_index) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }

  dict_write_uint8(iter, command_key, 1);
  dict_write_int32(iter, MESSAGE_KEY_HISTORY_SELECTED_INDEX, history_index);
  APP_LOG(APP_LOG_LEVEL_INFO, "History action %lu for index %ld",
          (unsigned long)command_key, (long)history_index);
  app_message_outbox_send();
}

bool watch_services_send_hr_bpm(int32_t bpm) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return false;
  }

  dict_write_int32(iter, MESSAGE_KEY_HR_BPM, bpm);
  return app_message_outbox_send() == APP_MSG_OK;
}

bool watch_services_send_hr_batch(void) {
  DictionaryIterator *iter;
  if (!g_pacelet.hr_batch_size) { return true; }
  if (!g_pacelet.activity_id[0] ||
      app_message_outbox_begin(&iter) != APP_MSG_OK) { return false; }
  dict_write_data(iter, MESSAGE_KEY_HR_BPM_BATCH, g_pacelet.hr_batch,
                  g_pacelet.hr_batch_size);
  dict_write_cstring(iter, MESSAGE_KEY_ACTIVITY_ID, g_pacelet.activity_id);
  return app_message_outbox_send() == APP_MSG_OK;
}

void watch_services_request_settings(void) {
  watch_services_send_command(MESSAGE_KEY_REQUEST_SETTINGS);
}

void watch_services_request_activity_state(void) {
  watch_services_send_command(MESSAGE_KEY_REQUEST_ACTIVITY_STATE);
}

void watch_services_request_initial_state(void) {
  DictionaryIterator *iter;
  s_initial_state_pending = true;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    schedule_retry();
    return;
  }
  dict_write_uint8(iter, MESSAGE_KEY_REQUEST_SETTINGS, 1);
  dict_write_uint8(iter, MESSAGE_KEY_REQUEST_ACTIVITY_STATE, 1);
  if (app_message_outbox_send() != APP_MSG_OK) {
    schedule_retry();
  }
}

void watch_services_request_history(void) {
  watch_services_send_command(MESSAGE_KEY_REQUEST_HISTORY);
}

static bool parse_history_number(const char **cursor, int32_t *value_out,
                                 char separator) {
  const char *p = *cursor;
  int32_t value = 0;

  if (!p || *p < '0' || *p > '9') {
    return false;
  }

  while (*p >= '0' && *p <= '9') {
    int digit = *p - '0';
    if (value > 214748364 ||
        (value == 214748364 && digit > 7)) {
      value = 2147483647;
    } else {
      value = value * 10 + digit;
    }
    p++;
  }

  if (separator) {
    if (*p != separator) {
      return false;
    }
    p++;
  } else if (*p != '\0' && *p != ';') {
    return false;
  }

  *cursor = p;
  *value_out = value;
  return true;
}

static void parse_history_items(const char *items_text) {
  char buffer[320];
  const char *cursor;
  int32_t parsed = 0;

  if (!items_text) {
    return;
  }

  snprintf(buffer, sizeof(buffer), "%s", items_text);
  cursor = buffer;
  memset(g_pacelet.history_items, 0, sizeof(g_pacelet.history_items));

  while (*cursor && parsed < PACELET_HISTORY_MAX) {
    int32_t type_value;
    int32_t distance_value;
    int32_t moving_value;
    int32_t status_value;

    if (!parse_history_number(&cursor, &type_value, ',')) {
      break;
    }
    if (!parse_history_number(&cursor, &distance_value, ',')) {
      break;
    }
    if (!parse_history_number(&cursor, &moving_value, ',')) {
      break;
    }
    if (!parse_history_number(&cursor, &status_value, '\0')) {
      break;
    }

    g_pacelet.history_items[parsed].activity_type = (ActivityType)
        pacelet_clamp_i32(type_value, ActivityTypeWalking,
                          ActivityTypeCycling);
    g_pacelet.history_items[parsed].distance_m = (int32_t)distance_value;
    g_pacelet.history_items[parsed].moving_s = (int32_t)moving_value;
    g_pacelet.history_items[parsed].strava_status = (HistoryStravaStatus)
        pacelet_clamp_i32(status_value, HistoryStravaUnknown,
                          HistoryStravaSkipped);
    parsed++;

    if (*cursor == ';') {
      cursor++;
    } else {
      break;
    }
  }

  g_pacelet.history_count = parsed;
  if (g_pacelet.history_selected_index > parsed) {
    g_pacelet.history_selected_index = parsed;
  }
}

static void inbox_received_callback(DictionaryIterator *iter, void *context) {
  bool settings_changed = false;
  Tuple *phone_activity_state =
      dict_find(iter, MESSAGE_KEY_ACTIVITY_STATE);
  Tuple *pause_ack = dict_find(iter, MESSAGE_KEY_PAUSE_WINDOWS);
  Tuple *reply_id = dict_find(iter, MESSAGE_KEY_ACTIVITY_ID);
  if (phone_activity_state &&
      (phone_activity_state->value->int32 == PhoneActivityStateActive ||
       phone_activity_state->value->int32 == PhoneActivityStatePaused) &&
      (g_pacelet.pending_command == MESSAGE_KEY_PAUSE_ACTIVITY ||
       g_pacelet.pending_command == MESSAGE_KEY_RESUME_ACTIVITY) &&
      (!reply_id || strcmp(reply_id->value->cstring, g_pacelet.activity_id) == 0) &&
      (!pause_ack || pause_ack->length != g_pacelet.pause_windows_size ||
       memcmp(pause_ack->value->data, g_pacelet.pause_windows,
              g_pacelet.pause_windows_size) != 0)) {
    // Wait for the ACK of this target snapshot, not an older state reply.
    return;
  }

  if (!g_pacelet.phone_connected) {
    activity_controller_handle_phone_connection(true);
  }

  Tuple *gps_status = dict_find(iter, MESSAGE_KEY_GPS_STATUS);
  if (gps_status) {
    s_gps_pending = false;
    GpsState previous_gps_state = g_pacelet.gps_state;
    int32_t status = gps_status->value->int32;
    g_pacelet.gps_state = (GpsState)pacelet_clamp_i32(
        status, GpsStateIdle, GpsStateError);
    if (g_pacelet.gps_state == GpsStateLocked &&
        previous_gps_state != GpsStateLocked) {
      vibes_short_pulse();
      light_enable_interaction();
    }
    if (g_pacelet.activity_state == ActivityStateGps ||
        g_pacelet.activity_state == ActivityStateReady) {
      pacelet_set_state(g_pacelet.gps_state == GpsStateLocked ?
              ActivityStateReady : ActivityStateGps);
    }
  }

  Tuple *gps_accuracy = dict_find(iter, MESSAGE_KEY_GPS_ACCURACY);
  if (gps_accuracy) {
    g_pacelet.gps_accuracy_m = gps_accuracy->value->int32;
  }

  Tuple *gps_error = dict_find(iter, MESSAGE_KEY_GPS_ERROR);
  if (gps_error) {
    snprintf(g_pacelet.gps_error, sizeof(g_pacelet.gps_error), "%s",
             gps_error->value->cstring);
  }

  Tuple *distance = dict_find(iter, MESSAGE_KEY_DISTANCE_M);
  if (distance) {
    if (phone_activity_state &&
        phone_activity_state->value->int32 ==
            PhoneActivityStateRecovery) {
      g_pacelet.distance_m = distance->value->int32;
    } else {
      activity_controller_handle_distance(distance->value->int32);
    }
  }

  Tuple *pace = dict_find(iter, MESSAGE_KEY_CURRENT_PACE);
  if (pace) {
    g_pacelet.current_pace_s_per_km = pace->value->int32;
  }

  Tuple *speed = dict_find(iter, MESSAGE_KEY_CURRENT_SPEED);
  if (speed) {
    g_pacelet.current_speed_centi_mps = speed->value->int32;
  }

  Tuple *summary_distance =
      dict_find(iter, MESSAGE_KEY_SUMMARY_DISTANCE_M);
  if (summary_distance) {
    g_pacelet.summary_distance_m = summary_distance->value->int32;
    g_pacelet.distance_m = g_pacelet.summary_distance_m;
  }

  Tuple *summary_moving = dict_find(iter, MESSAGE_KEY_SUMMARY_MOVING_S);
  if (summary_moving) {
    g_pacelet.summary_moving_s = summary_moving->value->int32;
    g_pacelet.finished_elapsed_s = g_pacelet.summary_moving_s;
  }

  Tuple *summary_points = dict_find(iter, MESSAGE_KEY_SUMMARY_POINTS);
  if (summary_points) {
    g_pacelet.summary_points = summary_points->value->int32;
  }

  Tuple *activity_id = dict_find(iter, MESSAGE_KEY_ACTIVITY_ID);
  if (activity_id) {
    if (g_pacelet.pending_command != 0 &&
        g_pacelet.pending_command != MESSAGE_KEY_START_ACTIVITY &&
        g_pacelet.activity_id[0] != '\0' &&
        strcmp(g_pacelet.activity_id, activity_id->value->cstring) != 0) {
      // The phone is reporting a different current activity. Retire the old
      // destructive command before adopting the authoritative session ID.
      g_pacelet.pending_command = 0;
    }
    snprintf(g_pacelet.activity_id, sizeof(g_pacelet.activity_id), "%s",
             activity_id->value->cstring);
  }

  Tuple *activity_type = dict_find(iter, MESSAGE_KEY_ACTIVITY_TYPE);
  if (activity_type) {
    g_pacelet.activity_type = (ActivityType)pacelet_clamp_i32(
        activity_type->value->int32, ActivityTypeWalking,
        ActivityTypeCycling);
  }

  Tuple *activity_started_at =
      dict_find(iter, MESSAGE_KEY_ACTIVITY_STARTED_AT);
  if (activity_started_at) {
    g_pacelet.started_at = activity_started_at->value->int32;
  }

  Tuple *activity_moving =
      dict_find(iter, MESSAGE_KEY_ACTIVITY_MOVING_S);
  if (activity_moving) {
    g_pacelet.recovery_moving_s =
        activity_moving->value->int32 < 0 ? 0 :
            activity_moving->value->int32;
  }

  Tuple *activity_checkpointed =
      dict_find(iter, MESSAGE_KEY_ACTIVITY_CHECKPOINTED_AT);
  if (activity_checkpointed) {
    g_pacelet.activity_checkpointed_at =
        activity_checkpointed->value->int32;
  }

  Tuple *recovery_message =
      dict_find(iter, MESSAGE_KEY_RECOVERY_MESSAGE);
  if (recovery_message) {
    snprintf(g_pacelet.recovery_message,
             sizeof(g_pacelet.recovery_message), "%s",
             recovery_message->value->cstring);
  }

  Tuple *motion_mode = dict_find(iter, MESSAGE_KEY_MOTION_MODE);
  if (motion_mode) {
    g_pacelet.motion_mode = pacelet_clamp_i32(motion_mode->value->int32, MotionFull, MotionOff);
    settings_changed = true;
  }
  Tuple *summary_hr = dict_find(iter, MESSAGE_KEY_SUMMARY_HR);
  if (summary_hr) {
    const char *cursor = summary_hr->value->cstring;
    int32_t value;
    if (parse_history_number(&cursor, &value, ',')) {
      g_pacelet.summary_avg_hr = pacelet_clamp_i32(value, 0, 250);
      for (int i = 0; i < 4; i++) {
        if (!parse_history_number(&cursor, &value, i == 3 ? '\0' : ',')) break;
        g_pacelet.zone_s[i] = pacelet_clamp_i32(value, 0, 999999);
      }
    }
  }
  Tuple *dark_mode = dict_find(iter, MESSAGE_KEY_DARK_MODE);
  if (dark_mode) {
    g_pacelet.dark_mode = dark_mode->value->int32 ? true : false;
    settings_changed = true;
    watch_ui_apply_theme();
  }

  Tuple *hr_zone_1 = dict_find(iter, MESSAGE_KEY_HR_ZONE_1_BPM);
  if (hr_zone_1) {
    g_pacelet.hr_zone_1_bpm = hr_zone_1->value->int32;
    settings_changed = true;
  }

  Tuple *hr_zone_2 = dict_find(iter, MESSAGE_KEY_HR_ZONE_2_BPM);
  if (hr_zone_2) {
    g_pacelet.hr_zone_2_bpm = hr_zone_2->value->int32;
    settings_changed = true;
  }

  Tuple *hr_zone_3 = dict_find(iter, MESSAGE_KEY_HR_ZONE_3_BPM);
  if (hr_zone_3) {
    g_pacelet.hr_zone_3_bpm = hr_zone_3->value->int32;
    settings_changed = true;
  }

  Tuple *history_count = dict_find(iter, MESSAGE_KEY_HISTORY_COUNT);
  if (history_count) {
    s_history_pending = false;
    g_pacelet.history_count = pacelet_clamp_i32(
        history_count->value->int32, 0, PACELET_HISTORY_MAX);
    g_pacelet.history_loading = false;
  }

  Tuple *history_items = dict_find(iter, MESSAGE_KEY_HISTORY_ITEMS);
  if (history_items) {
    s_history_pending = false;
    APP_LOG(APP_LOG_LEVEL_INFO, "History items received: %s",
            history_items->value->cstring);
    parse_history_items(history_items->value->cstring);
    APP_LOG(APP_LOG_LEVEL_INFO, "Parsed %ld history items",
            (long)g_pacelet.history_count);
    g_pacelet.history_loading = false;
  }

  Tuple *history_selected =
      dict_find(iter, MESSAGE_KEY_HISTORY_SELECTED_INDEX);
  if (history_selected) {
    g_pacelet.history_selected_index = pacelet_clamp_i32(
        history_selected->value->int32, 0,
        g_pacelet.history_count);
  }

  Tuple *history_message = dict_find(iter, MESSAGE_KEY_HISTORY_MESSAGE);
  if (history_message) {
    snprintf(g_pacelet.history_message,
             sizeof(g_pacelet.history_message), "%s",
             history_message->value->cstring);
    g_pacelet.history_loading = false;
  }

  Tuple *history_hr = dict_find(iter, MESSAGE_KEY_HISTORY_HR);
  if (history_hr) {
    const char *cursor = history_hr->value->cstring;
    for (int i = 0; i < g_pacelet.history_count && *cursor; i++) {
      int32_t value;
      if (!parse_history_number(&cursor, &value, ',')) break;
      g_pacelet.history_items[i].avg_hr = pacelet_clamp_i32(value, 0, 250);
      for (int z = 0; z < 4; z++) {
        if (!parse_history_number(&cursor, &value, z == 3 ? '\0' : ',')) break;
        g_pacelet.history_items[i].zone_s[z] = pacelet_clamp_i32(value, 0, 999999);
      }
      if (*cursor == ';') cursor++;
    }
  }

  if (settings_changed) {
    pacelet_normalize_hr_zone_thresholds();
    save_settings();
  }

  if (phone_activity_state) {
    s_initial_state_pending = false;
    activity_controller_handle_phone_activity_state(
        (PhoneActivityState)pacelet_clamp_i32(
            phone_activity_state->value->int32,
            PhoneActivityStateNone, PhoneActivityStateRecovery));
  }

  Tuple *upload_pending = dict_find(iter, MESSAGE_KEY_UPLOAD_PENDING);
  if (upload_pending) {
    g_pacelet.upload_pending = upload_pending->value->int32 != 0;
    if (!g_pacelet.upload_pending &&
        g_pacelet.pending_command != MESSAGE_KEY_FINISH_ACTIVITY) {
      if (g_pacelet.overlay == OverlayExit) pacelet_set_overlay(OverlayNone);
    }
  }

  watch_ui_mark_dirty();
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox dropped: %d", reason);
  s_initial_state_pending = true;
  schedule_retry();
}

static void retry_timer_callback(void *context) {
  s_retry_timer = NULL;
  if (!g_pacelet.phone_connected) {
    return;
  }
  if (g_pacelet.pending_command != 0) {
    if (!send_command(g_pacelet.pending_command, false)) {
      schedule_retry();
    }
  } else if (s_initial_state_pending) {
    watch_services_request_initial_state();
  } else if ((s_gps_pending || s_history_pending) && s_request_retries < 5) {
    s_request_retries++;
    send_command(s_history_pending ? MESSAGE_KEY_REQUEST_HISTORY :
                   MESSAGE_KEY_REQUEST_GPS, false);
    schedule_retry();
  } else if (s_history_pending) {
    s_history_pending = false;
    g_pacelet.history_loading = false;
    snprintf(g_pacelet.history_message, sizeof(g_pacelet.history_message),
             "Phone unavailable. Try again.");
    watch_ui_mark_dirty();
  }
}

static void schedule_retry(void) {
  if (!s_retry_timer) {
    s_retry_timer = app_timer_register(1500, retry_timer_callback, NULL);
  }
}

static void outbox_sent_callback(DictionaryIterator *iter, void *context) {
  Tuple *batch = dict_find(iter, MESSAGE_KEY_HR_BPM_BATCH);
  if (batch && batch->length <= g_pacelet.hr_batch_size &&
      memcmp(batch->value->data, g_pacelet.hr_batch, batch->length) == 0) {
    g_pacelet.hr_batch_size -= batch->length;
    memmove(g_pacelet.hr_batch, g_pacelet.hr_batch + batch->length,
            g_pacelet.hr_batch_size);
  }
  if (g_pacelet.pending_command != 0 || s_initial_state_pending ||
      s_gps_pending || s_history_pending) {
    schedule_retry();
  }
}

static void outbox_failed_callback(DictionaryIterator *iter,
                                   AppMessageResult reason,
                                   void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox failed: %d", reason);
  if (g_pacelet.pending_command != 0 || s_initial_state_pending ||
      s_gps_pending || s_history_pending) {
    schedule_retry();
  }
  if (!connection_service_peek_pebble_app_connection()) {
    activity_controller_handle_phone_connection(false);
  }
}

static void app_connection_handler(bool connected) {
  activity_controller_handle_phone_connection(connected);
  if (!connected) {
    return;
  }
  if (g_pacelet.pending_command != 0) {
    if (!send_command(g_pacelet.pending_command, false)) {
      schedule_retry();
    }
  } else {
    watch_services_request_initial_state();
  }
}

void watch_services_init(void) {
  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_sent(outbox_sent_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(1280, 128);
  connection_service_subscribe((ConnectionHandlers) {
    .pebble_app_connection_handler = app_connection_handler
  });
  activity_controller_handle_phone_connection(
      connection_service_peek_pebble_app_connection());
}

void watch_services_deinit(void) {
  if (s_retry_timer) {
    app_timer_cancel(s_retry_timer);
    s_retry_timer = NULL;
  }
  watch_services_save_activity_state();
  connection_service_unsubscribe();
  app_message_deregister_callbacks();
}
