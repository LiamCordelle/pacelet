#include "watch_services.h"

#include "activity_controller.h"
#include "pacelet_model.h"
#include "watch_ui.h"

#define SETTINGS_KEY 1
#define SETTINGS_VERSION 2

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

void watch_services_send_command(uint32_t command_key) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }

  dict_write_uint8(iter, command_key, 1);
  if (command_key == MESSAGE_KEY_START_ACTIVITY) {
    dict_write_uint8(iter, MESSAGE_KEY_ACTIVITY_TYPE,
                     (uint8_t)g_pacelet.activity_type);
  }
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

static void inbox_received_callback(DictionaryIterator *iter, void *context) {
  bool settings_changed = false;
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
    activity_controller_handle_distance(distance->value->int32);
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

  if (settings_changed) {
    pacelet_normalize_hr_zone_thresholds();
    save_settings();
  }

  watch_ui_mark_dirty();
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox dropped: %d", reason);
}

static void outbox_failed_callback(DictionaryIterator *iter,
                                   AppMessageResult reason,
                                   void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox failed: %d", reason);
}

void watch_services_init(void) {
  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(512, 128);
}

void watch_services_deinit(void) {
  app_message_deregister_callbacks();
}
