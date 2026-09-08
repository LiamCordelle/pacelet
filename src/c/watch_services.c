#include "watch_services.h"

#include "activity_controller.h"
#include "pacelet_model.h"
#include "watch_ui.h"

#include <string.h>

#define SETTINGS_KEY 1
#define SETTINGS_VERSION 2
#define ACTIVITY_STATE_KEY 2
#define ACTIVITY_STATE_VERSION 1

typedef struct {
  uint8_t version;
  bool dark_mode;
  uint16_t hr_zone_1_bpm;
  uint16_t hr_zone_2_bpm;
  uint16_t hr_zone_3_bpm;
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

static AppTimer *s_retry_timer;
static bool s_initial_state_pending;

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
  g_pacelet.activity_state = ActivityStateRecovery;
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
  g_pacelet.recovery_phone_draft_available = false;
  snprintf(g_pacelet.recovery_message,
           sizeof(g_pacelet.recovery_message), "CHECKING PHONE");
}

static void save_settings(void) {
  AppSettings settings = {
    .version = SETTINGS_VERSION,
    .dark_mode = g_pacelet.dark_mode,
    .hr_zone_1_bpm = (uint16_t)g_pacelet.hr_zone_1_bpm,
    .hr_zone_2_bpm = (uint16_t)g_pacelet.hr_zone_2_bpm,
    .hr_zone_3_bpm = (uint16_t)g_pacelet.hr_zone_3_bpm
  };
  persist_write_data(SETTINGS_KEY, &settings, sizeof(settings));
}

void watch_services_load_settings(void) {
  int settings_size = persist_get_size(SETTINGS_KEY);
  AppSettings settings;

  if (settings_size == (int)sizeof(settings) &&
      persist_read_data(SETTINGS_KEY, &settings, sizeof(settings)) ==
          (int)sizeof(settings) &&
      settings.version == SETTINGS_VERSION) {
    g_pacelet.dark_mode = settings.dark_mode;
    g_pacelet.hr_zone_1_bpm = settings.hr_zone_1_bpm;
    g_pacelet.hr_zone_2_bpm = settings.hr_zone_2_bpm;
    g_pacelet.hr_zone_3_bpm = settings.hr_zone_3_bpm;
    pacelet_normalize_hr_zone_thresholds();
  } else if (settings_size == (int)sizeof(AppSettingsV1)) {
    AppSettingsV1 old_settings;
    if (persist_read_data(SETTINGS_KEY, &old_settings,
                          sizeof(old_settings)) ==
            (int)sizeof(old_settings) &&
        old_settings.version == 1) {
      g_pacelet.dark_mode = old_settings.dark_mode;
      save_settings();
    }
  }
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
  result = app_message_outbox_send();
  return result == APP_MSG_OK;
}

void watch_services_send_command(uint32_t command_key) {
  if (!send_command(command_key, true) &&
      is_reliable_command(command_key)) {
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

  if (!g_pacelet.phone_connected) {
    activity_controller_handle_phone_connection(true);
  }

  Tuple *gps_status = dict_find(iter, MESSAGE_KEY_GPS_STATUS);
  if (gps_status) {
    GpsState previous_gps_state = g_pacelet.gps_state;
    int32_t status = gps_status->value->int32;
    g_pacelet.gps_state = (GpsState)pacelet_clamp_i32(
        status, GpsStateIdle, GpsStateError);
    if (g_pacelet.gps_state == GpsStateLocked &&
        previous_gps_state != GpsStateLocked) {
      vibes_short_pulse();
    }
    if (g_pacelet.activity_state == ActivityStateGps ||
        g_pacelet.activity_state == ActivityStateReady) {
      g_pacelet.activity_state =
          g_pacelet.gps_state == GpsStateLocked ?
              ActivityStateReady : ActivityStateGps;
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
    if ((g_pacelet.pending_command == MESSAGE_KEY_FINISH_ACTIVITY ||
         g_pacelet.pending_command == MESSAGE_KEY_DISCARD_ACTIVITY) &&
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
    g_pacelet.history_count = pacelet_clamp_i32(
        history_count->value->int32, 0, PACELET_HISTORY_MAX);
    g_pacelet.history_loading = false;
  }

  Tuple *history_items = dict_find(iter, MESSAGE_KEY_HISTORY_ITEMS);
  if (history_items) {
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

  if (settings_changed) {
    pacelet_normalize_hr_zone_thresholds();
    save_settings();
  }

  if (phone_activity_state) {
    activity_controller_handle_phone_activity_state(
        (PhoneActivityState)pacelet_clamp_i32(
            phone_activity_state->value->int32,
            PhoneActivityStateNone, PhoneActivityStateRecovery));
  }

  watch_ui_mark_dirty();
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox dropped: %d", reason);
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
  }
}

static void schedule_retry(void) {
  if (!s_retry_timer) {
    s_retry_timer = app_timer_register(750, retry_timer_callback, NULL);
  }
}

static bool sent_command(DictionaryIterator *iter, uint32_t command_key) {
  return command_key != 0 && dict_find(iter, command_key) != NULL;
}

static void outbox_sent_callback(DictionaryIterator *iter, void *context) {
  if (dict_find(iter, MESSAGE_KEY_REQUEST_ACTIVITY_STATE) &&
      dict_find(iter, MESSAGE_KEY_REQUEST_SETTINGS)) {
    s_initial_state_pending = false;
  }

  if (sent_command(iter, g_pacelet.pending_command) &&
      g_pacelet.pending_command != MESSAGE_KEY_FINISH_ACTIVITY &&
      g_pacelet.pending_command != MESSAGE_KEY_DISCARD_ACTIVITY) {
    g_pacelet.pending_command = 0;
    watch_services_save_activity_state();
  }

  if (g_pacelet.pending_command != 0 || s_initial_state_pending) {
    schedule_retry();
  }
}

static void outbox_failed_callback(DictionaryIterator *iter,
                                   AppMessageResult reason,
                                   void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox failed: %d", reason);
  if (g_pacelet.pending_command != 0 || s_initial_state_pending) {
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
  app_message_open(768, 128);
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
