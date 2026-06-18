#include <pebble.h>
#include <string.h>

#define GPS_LOCK_ACCURACY_M 25
#define HR_SAMPLE_PERIOD_S 1
#define HR_SEND_INTERVAL_S 1
#define HR_READING_STALE_S 60
#define SPLIT_DISTANCE_M 1000
#define SPLIT_SUMMARY_MS 6000
#define SETTINGS_KEY 1
#define SETTINGS_VERSION 2
#define DEFAULT_HR_ZONE_1_BPM 100
#define DEFAULT_HR_ZONE_2_BPM 130
#define DEFAULT_HR_ZONE_3_BPM 160

typedef enum {
  ActivityStateChoose = 0,
  ActivityStateGps = 1,
  ActivityStateReady = 2,
  ActivityStateCountdown = 3,
  ActivityStateActive = 4,
  ActivityStatePaused = 5,
  ActivityStateFinished = 6
} ActivityState;

typedef enum {
  GpsStateIdle = 0,
  GpsStateSearching = 1,
  GpsStateLocked = 2,
  GpsStateError = 3
} GpsState;

typedef enum {
  ActivityTypeWalking = 0,
  ActivityTypeRunning = 1,
  ActivityTypeCycling = 2
} ActivityType;

typedef enum {
  ActionIconNone = 0,
  ActionIconUp,
  ActionIconDown,
  ActionIconGps,
  ActionIconRefresh,
  ActionIconPlay,
  ActionIconPause,
  ActionIconStop,
  ActionIconType,
  ActionIconNew
} ActionIcon;

typedef enum {
  HrZoneBelow = 0,
  HrZoneOne = 1,
  HrZoneTwo = 2,
  HrZoneThree = 3
} HrZone;

#define ACTION_RAIL_W 18

static Window *s_main_window;
static Layer *s_canvas_layer;
static AppTimer *s_countdown_timer;
static AppTimer *s_split_timer;
static bool s_dark_mode;

static ActivityState s_activity_state = ActivityStateChoose;
static GpsState s_gps_state = GpsStateIdle;
static ActivityType s_activity_type = ActivityTypeRunning;
static int s_countdown_value;
static int s_anim_tick;

static time_t s_started_at;
static time_t s_paused_at;
static int32_t s_total_paused_s;
static int32_t s_finished_elapsed_s;

static int32_t s_distance_m;
static int32_t s_current_pace_s_per_km;
static int32_t s_current_speed_centi_mps;
static int32_t s_gps_accuracy_m = -1;
static int32_t s_gps_age_s = -1;
static int32_t s_last_hr_bpm;
static int32_t s_last_hr_sent_elapsed_s = -1;
static time_t s_last_hr_update_at;
static bool s_hr_clear_sent;
static int32_t s_hr_zone_1_bpm = DEFAULT_HR_ZONE_1_BPM;
static int32_t s_hr_zone_2_bpm = DEFAULT_HR_ZONE_2_BPM;
static int32_t s_hr_zone_3_bpm = DEFAULT_HR_ZONE_3_BPM;
static int32_t s_summary_distance_m;
static int32_t s_summary_moving_s;
static int32_t s_summary_points;
static int32_t s_next_split_km = 1;
static int32_t s_last_split_elapsed_s;
static int32_t s_split_elapsed_s;
static int32_t s_split_number;
static bool s_split_visible;
static char s_gps_error[32] = "";
static char s_activity_id[32] = "";
static bool s_hr_sample_period_requested;
static GBitmap *s_activity_icons[3][2];
static GBitmap *s_countdown_icons[3][2];

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

static void update_hr(bool fresh_event);

static const char *ACTIVITY_LABELS[] = {
  "WALKING",
  "RUNNING",
  "CYCLING"
};

static const char *ACTIVITY_SHORT_LABELS[] = {
  "WALK",
  "RUN",
  "RIDE"
};

static const uint32_t ACTIVITY_ICON_RESOURCE_IDS[3][2] = {
  {
    RESOURCE_ID_IMAGE_ACTIVITY_WALK_BLACK,
    RESOURCE_ID_IMAGE_ACTIVITY_WALK_WHITE
  },
  {
    RESOURCE_ID_IMAGE_ACTIVITY_RUN_BLACK,
    RESOURCE_ID_IMAGE_ACTIVITY_RUN_WHITE
  },
  {
    RESOURCE_ID_IMAGE_ACTIVITY_CYCLE_BLACK,
    RESOURCE_ID_IMAGE_ACTIVITY_CYCLE_WHITE
  }
};

static const uint32_t COUNTDOWN_ICON_RESOURCE_IDS[3][2] = {
  {
    RESOURCE_ID_IMAGE_COUNTDOWN_1_BLACK,
    RESOURCE_ID_IMAGE_COUNTDOWN_1_WHITE
  },
  {
    RESOURCE_ID_IMAGE_COUNTDOWN_2_BLACK,
    RESOURCE_ID_IMAGE_COUNTDOWN_2_WHITE
  },
  {
    RESOURCE_ID_IMAGE_COUNTDOWN_3_BLACK,
    RESOURCE_ID_IMAGE_COUNTDOWN_3_WHITE
  }
};

static int32_t clamp_i32(int32_t value, int32_t min_value, int32_t max_value) {
  if (value < min_value) {
    return min_value;
  }
  if (value > max_value) {
    return max_value;
  }
  return value;
}

static GColor color_bg(void) {
  return PBL_IF_COLOR_ELSE(s_dark_mode ? GColorFromHEX(0x071014)
                                       : GColorFromHEX(0xf7fbf8),
                           GColorWhite);
}

static GColor color_text(void) {
  return PBL_IF_COLOR_ELSE(s_dark_mode ? GColorWhite : GColorBlack,
                           GColorBlack);
}

static GColor color_muted(void) {
  return PBL_IF_COLOR_ELSE(s_dark_mode ? GColorFromHEX(0xa9b5ad)
                                       : GColorFromHEX(0x3e5459),
                           GColorBlack);
}

static GColor color_accent(void) {
  return PBL_IF_COLOR_ELSE(s_dark_mode ? GColorFromHEX(0x00d084)
                                       : GColorFromHEX(0x007c54),
                           GColorBlack);
}

static GColor color_on_accent(void) {
  return PBL_IF_COLOR_ELSE(s_dark_mode ? GColorBlack : GColorWhite,
                           GColorWhite);
}

static GColor color_warning(void) {
  return PBL_IF_COLOR_ELSE(s_dark_mode ? GColorFromHEX(0xffc400)
                                       : GColorFromHEX(0x9a6500),
                           GColorBlack);
}

static GColor color_pause_bg(void) {
  return PBL_IF_COLOR_ELSE(GColorChromeYellow, GColorWhite);
}

static GColor color_bad(void) {
  return PBL_IF_COLOR_ELSE(s_dark_mode ? GColorFromHEX(0xff4b4b)
                                       : GColorFromHEX(0xb00020),
                           GColorBlack);
}

static GFont font_status(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
}

static GFont font_label(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_14);
}

static GFont font_metric_label(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
}

static GFont font_value(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
}

static GFont font_metric_value(void) {
  return fonts_get_system_font(FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM);
}

static GFont font_metric_unit(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
}

static GFont font_menu(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
}

static GFont font_timer(void) {
  return fonts_get_system_font(FONT_KEY_LECO_42_NUMBERS);
}

static void mark_dirty(void) {
  if (s_canvas_layer) {
    layer_mark_dirty(s_canvas_layer);
  }
}

static void save_settings(void) {
  AppSettings settings = {
    .version = SETTINGS_VERSION,
    .dark_mode = s_dark_mode,
    .hr_zone_1_bpm = (uint16_t)s_hr_zone_1_bpm,
    .hr_zone_2_bpm = (uint16_t)s_hr_zone_2_bpm,
    .hr_zone_3_bpm = (uint16_t)s_hr_zone_3_bpm
  };
  persist_write_data(SETTINGS_KEY, &settings, sizeof(settings));
}

static void normalize_hr_zone_thresholds(void) {
  s_hr_zone_1_bpm = clamp_i32(s_hr_zone_1_bpm, 40, 220);
  s_hr_zone_2_bpm = clamp_i32(
      s_hr_zone_2_bpm, s_hr_zone_1_bpm + 1, 230);
  s_hr_zone_3_bpm = clamp_i32(
      s_hr_zone_3_bpm, s_hr_zone_2_bpm + 1, 240);
}

static void load_settings(void) {
  int settings_size = persist_get_size(SETTINGS_KEY);
  AppSettings settings;

  if (settings_size == (int)sizeof(settings) &&
      persist_read_data(SETTINGS_KEY, &settings, sizeof(settings)) ==
          (int)sizeof(settings) &&
      settings.version == SETTINGS_VERSION) {
    s_dark_mode = settings.dark_mode;
    s_hr_zone_1_bpm = settings.hr_zone_1_bpm;
    s_hr_zone_2_bpm = settings.hr_zone_2_bpm;
    s_hr_zone_3_bpm = settings.hr_zone_3_bpm;
    normalize_hr_zone_thresholds();
  } else if (settings_size == (int)sizeof(AppSettingsV1)) {
    AppSettingsV1 old_settings;
    if (persist_read_data(SETTINGS_KEY, &old_settings, sizeof(old_settings)) ==
            (int)sizeof(old_settings) &&
        old_settings.version == 1) {
      s_dark_mode = old_settings.dark_mode;
      save_settings();
    }
  }
}

static HrZone hr_zone_for_bpm(int32_t bpm) {
  if (bpm < s_hr_zone_1_bpm) {
    return HrZoneBelow;
  }
  if (bpm < s_hr_zone_2_bpm) {
    return HrZoneOne;
  }
  if (bpm < s_hr_zone_3_bpm) {
    return HrZoneTwo;
  }
  return HrZoneThree;
}

static const char *hr_zone_label(HrZone zone) {
  switch (zone) {
    case HrZoneOne:
      return "FAT BURN";
    case HrZoneTwo:
      return "ENDURANCE";
    case HrZoneThree:
      return "PERFORMANCE";
    case HrZoneBelow:
    default:
      return "HR";
  }
}

static GColor hr_zone_color(HrZone zone) {
  switch (zone) {
    case HrZoneOne:
      return PBL_IF_COLOR_ELSE(GColorMelon, GColorWhite);
    case HrZoneTwo:
      return PBL_IF_COLOR_ELSE(GColorChromeYellow, GColorWhite);
    case HrZoneThree:
      return PBL_IF_COLOR_ELSE(GColorOrange, GColorWhite);
    case HrZoneBelow:
    default:
      return color_bg();
  }
}

static int32_t elapsed_s(void) {
  if (s_activity_state == ActivityStateFinished) {
    return s_finished_elapsed_s;
  }
  if (s_activity_state != ActivityStateActive &&
      s_activity_state != ActivityStatePaused) {
    return 0;
  }

  time_t now = time(NULL);
  if (s_activity_state == ActivityStatePaused) {
    now = s_paused_at;
  }

  int32_t elapsed = (int32_t)(now - s_started_at) - s_total_paused_s;
  return elapsed < 0 ? 0 : elapsed;
}

static void format_elapsed(int32_t total_s, char *buffer, size_t buffer_size) {
  int32_t hours = total_s / 3600;
  int32_t minutes = (total_s % 3600) / 60;
  int32_t seconds = total_s % 60;

  if (hours > 0) {
    snprintf(buffer, buffer_size, "%ld:%02ld:%02ld",
             (long)hours, (long)minutes, (long)seconds);
  } else {
    snprintf(buffer, buffer_size, "%02ld:%02ld",
             (long)minutes, (long)seconds);
  }
}

static void format_clock(char *buffer, size_t buffer_size) {
  time_t now = time(NULL);
  struct tm *time_now = localtime(&now);

  if (!time_now) {
    snprintf(buffer, buffer_size, "--:--");
    return;
  }

  if (clock_is_24h_style()) {
    strftime(buffer, buffer_size, "%H:%M", time_now);
  } else {
    strftime(buffer, buffer_size, "%I:%M", time_now);
    if (buffer[0] == '0') {
      memmove(buffer, buffer + 1, strlen(buffer));
    }
  }
}

static void format_distance_parts(int32_t meters,
                                  char *value, size_t value_size,
                                  char *unit, size_t unit_size) {
  if (meters >= 1000) {
    snprintf(value, value_size, "%ld.%02ld",
             (long)(meters / 1000), (long)((meters % 1000) / 10));
    snprintf(unit, unit_size, "KM");
  } else {
    snprintf(value, value_size, "%ld", (long)meters);
    snprintf(unit, unit_size, "M");
  }
}

static void format_pace_parts(int32_t pace_s_per_km,
                              char *value, size_t value_size,
                              char *unit, size_t unit_size) {
  if (pace_s_per_km <= 0 || pace_s_per_km > 5999) {
    snprintf(value, value_size, "--:--");
  } else {
    snprintf(value, value_size, "%ld:%02ld",
             (long)(pace_s_per_km / 60), (long)(pace_s_per_km % 60));
  }
  snprintf(unit, unit_size, "/KM");
}

static void format_speed_parts(int32_t centi_mps,
                               char *value, size_t value_size,
                               char *unit, size_t unit_size) {
  if (centi_mps <= 0) {
    snprintf(value, value_size, "--.-");
  } else {
    int32_t kmh_x10 = (centi_mps * 36) / 100;
    snprintf(value, value_size, "%ld.%ld",
             (long)(kmh_x10 / 10), (long)(kmh_x10 % 10));
  }
  snprintf(unit, unit_size, "KM/H");
}

static bool activity_uses_speed(void) {
  return s_activity_type == ActivityTypeCycling;
}

static const char *state_short_label(void) {
  switch (s_activity_state) {
    case ActivityStateChoose:
      return "PICK";
    case ActivityStateGps:
      return s_gps_state == GpsStateError ? "ERROR" : "GPS";
    case ActivityStateReady:
      return "READY";
    case ActivityStateCountdown:
      return "3-2-1";
    case ActivityStateActive:
      return s_split_visible ? "SPLIT" : "REC";
    case ActivityStatePaused:
      return "PAUSE";
    case ActivityStateFinished:
      return "SAVED";
    default:
      return "";
  }
}

static GColor state_color(void) {
  if (s_activity_state == ActivityStateActive ||
      s_activity_state == ActivityStateReady ||
      s_activity_state == ActivityStateCountdown ||
      s_gps_state == GpsStateLocked) {
    return color_accent();
  }
  if (s_activity_state == ActivityStatePaused ||
      s_gps_state == GpsStateSearching) {
    return color_warning();
  }
  if (s_gps_state == GpsStateError) {
    return color_bad();
  }
  return color_muted();
}

static int content_right(GRect bounds) {
  return bounds.size.w - ACTION_RAIL_W - 2;
}

static int action_rail_x(GRect bounds) {
  return bounds.size.w - ACTION_RAIL_W;
}

static bool layout_is_tall(GRect bounds) {
  return bounds.size.h >= 200;
}

static int rail_icon_y(GRect bounds, int index) {
  return (bounds.size.h * (index + 1)) / 4;
}

static int choose_row_y(GRect bounds, int index) {
  return (layout_is_tall(bounds) ? 38 : 30) +
         index * (layout_is_tall(bounds) ? 54 : 42);
}

static void send_simple_command(uint32_t command_key) {
  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }

  dict_write_uint8(iter, command_key, 1);
  if (command_key == MESSAGE_KEY_START_ACTIVITY) {
    dict_write_uint8(iter, MESSAGE_KEY_ACTIVITY_TYPE, (uint8_t)s_activity_type);
  }
  app_message_outbox_send();
}

static void request_settings(void) {
  send_simple_command(MESSAGE_KEY_REQUEST_SETTINGS);
}

static void set_activity_hr_sampling(bool enabled) {
#if defined(PBL_HEALTH)
  if (enabled) {
    if (!s_hr_sample_period_requested &&
        health_service_set_heart_rate_sample_period(HR_SAMPLE_PERIOD_S)) {
      s_hr_sample_period_requested = true;
    }
  } else if (s_hr_sample_period_requested) {
    health_service_set_heart_rate_sample_period(0);
    s_hr_sample_period_requested = false;
  }
#else
  (void)enabled;
#endif
}

static void send_hr_sample(void) {
  if (s_activity_state != ActivityStateActive || s_last_hr_bpm <= 0) {
    return;
  }

  int32_t current_elapsed_s = elapsed_s();
  if (current_elapsed_s <= 0 ||
      current_elapsed_s == s_last_hr_sent_elapsed_s) {
    return;
  }

  DictionaryIterator *iter;
  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }

  dict_write_int32(iter, MESSAGE_KEY_HR_BPM, s_last_hr_bpm);
  if (app_message_outbox_send() == APP_MSG_OK) {
    s_last_hr_sent_elapsed_s = current_elapsed_s;
  }
}

static void maybe_send_hr_clear(void) {
  DictionaryIterator *iter;

  if ((s_activity_state != ActivityStateActive &&
       s_activity_state != ActivityStatePaused) ||
      s_last_hr_bpm > 0 || s_hr_clear_sent) {
    return;
  }

  if (app_message_outbox_begin(&iter) != APP_MSG_OK) {
    return;
  }
  dict_write_int32(iter, MESSAGE_KEY_HR_BPM, 0);
  if (app_message_outbox_send() == APP_MSG_OK) {
    s_hr_clear_sent = true;
  }
}

static void cancel_countdown(void) {
  if (s_countdown_timer) {
    app_timer_cancel(s_countdown_timer);
    s_countdown_timer = NULL;
  }
  s_countdown_value = 0;
}

static void hide_split_summary(void) {
  if (s_split_timer) {
    app_timer_cancel(s_split_timer);
    s_split_timer = NULL;
  }
  s_split_visible = false;
}

static void split_timer_callback(void *data) {
  s_split_timer = NULL;
  s_split_visible = false;
  mark_dirty();
}

static void maybe_show_split_summary(int32_t distance_m) {
  int32_t completed_km;
  int32_t current_elapsed_s;

  if (s_activity_state != ActivityStateActive ||
      distance_m < s_next_split_km * SPLIT_DISTANCE_M) {
    return;
  }

  completed_km = distance_m / SPLIT_DISTANCE_M;
  current_elapsed_s = elapsed_s();
  s_split_number = completed_km;
  s_split_elapsed_s = current_elapsed_s - s_last_split_elapsed_s;
  if (s_split_elapsed_s < 1) {
    s_split_elapsed_s = 1;
  }
  s_last_split_elapsed_s = current_elapsed_s;
  s_next_split_km = completed_km + 1;

  hide_split_summary();
  s_split_visible = true;
  vibes_double_pulse();
  s_split_timer = app_timer_register(
      SPLIT_SUMMARY_MS, split_timer_callback, NULL);
}

static void reset_activity_metrics(void) {
  hide_split_summary();
  s_started_at = 0;
  s_paused_at = 0;
  s_total_paused_s = 0;
  s_finished_elapsed_s = 0;
  s_last_hr_sent_elapsed_s = -1;
  s_last_hr_bpm = 0;
  s_last_hr_update_at = 0;
  s_hr_clear_sent = false;
  s_distance_m = 0;
  s_current_pace_s_per_km = 0;
  s_current_speed_centi_mps = 0;
  s_summary_distance_m = 0;
  s_summary_moving_s = 0;
  s_summary_points = 0;
  s_next_split_km = 1;
  s_last_split_elapsed_s = 0;
  s_split_elapsed_s = 0;
  s_split_number = 0;
  s_activity_id[0] = '\0';
}

static void request_gps(void) {
  if (s_activity_state == ActivityStateCountdown) {
    cancel_countdown();
  }

  if (s_activity_state == ActivityStateChoose ||
      s_activity_state == ActivityStateFinished) {
    reset_activity_metrics();
  }

  s_activity_state = ActivityStateGps;
  s_gps_state = GpsStateSearching;
  s_gps_accuracy_m = -1;
  s_gps_age_s = -1;
  s_gps_error[0] = '\0';
  send_simple_command(MESSAGE_KEY_REQUEST_GPS);
  mark_dirty();
}

static void return_to_choose(void) {
  cancel_countdown();
  reset_activity_metrics();
  s_activity_state = ActivityStateChoose;
  s_gps_state = GpsStateIdle;
  s_gps_accuracy_m = -1;
  s_gps_age_s = -1;
  s_gps_error[0] = '\0';
  mark_dirty();
}

static void start_activity_recording(void) {
  cancel_countdown();

  if (s_gps_state != GpsStateLocked) {
    request_gps();
    return;
  }

  reset_activity_metrics();
  s_started_at = time(NULL);
  s_activity_state = ActivityStateActive;
  set_activity_hr_sampling(true);
  update_hr(false);
  send_simple_command(MESSAGE_KEY_START_ACTIVITY);
  mark_dirty();
}

static void countdown_timer_callback(void *data) {
  s_countdown_timer = NULL;
  if (s_activity_state != ActivityStateCountdown) {
    return;
  }

  if (s_countdown_value > 1) {
    s_countdown_value--;
    vibes_short_pulse();
    s_countdown_timer = app_timer_register(1000, countdown_timer_callback, NULL);
    mark_dirty();
    return;
  }

  start_activity_recording();
  if (s_activity_state == ActivityStateActive) {
    vibes_long_pulse();
  }
}

static void begin_countdown(void) {
  if (s_gps_state != GpsStateLocked) {
    request_gps();
    return;
  }

  cancel_countdown();
  s_activity_state = ActivityStateCountdown;
  s_countdown_value = 3;
  vibes_short_pulse();
  s_countdown_timer = app_timer_register(1000, countdown_timer_callback, NULL);
  mark_dirty();
}

static void pause_activity(void) {
  if (s_activity_state != ActivityStateActive) {
    return;
  }

  hide_split_summary();
  s_paused_at = time(NULL);
  s_activity_state = ActivityStatePaused;
  send_simple_command(MESSAGE_KEY_PAUSE_ACTIVITY);
  mark_dirty();
}

static void resume_activity(void) {
  if (s_activity_state != ActivityStatePaused) {
    return;
  }

  s_total_paused_s += (int32_t)(time(NULL) - s_paused_at);
  s_paused_at = 0;
  s_activity_state = ActivityStateActive;
  set_activity_hr_sampling(true);
  update_hr(false);
  send_simple_command(MESSAGE_KEY_RESUME_ACTIVITY);
  mark_dirty();
}

static void finish_activity(void) {
  if (s_activity_state != ActivityStateActive &&
      s_activity_state != ActivityStatePaused) {
    return;
  }

  hide_split_summary();
  s_finished_elapsed_s = elapsed_s();
  send_hr_sample();
  set_activity_hr_sampling(false);
  s_activity_state = ActivityStateFinished;
  send_simple_command(MESSAGE_KEY_FINISH_ACTIVITY);
  mark_dirty();
}

static void cycle_activity_type(int direction) {
  if (s_activity_state != ActivityStateChoose &&
      s_activity_state != ActivityStateGps &&
      s_activity_state != ActivityStateReady) {
    return;
  }

  s_activity_type = (ActivityType)(((int)s_activity_type + direction + 3) % 3);
  mark_dirty();
}

static void clear_hr_reading(void) {
  s_last_hr_bpm = 0;
  s_last_hr_update_at = 0;
}

static void update_hr(bool fresh_event) {
#if defined(PBL_HEALTH)
  time_t now = time(NULL);
  HealthServiceAccessibilityMask hr_access =
      health_service_metric_aggregate_averaged_accessible(
          HealthMetricHeartRateBPM, now, now, HealthAggregationAvg,
          HealthServiceTimeScopeOnce);

  if (hr_access & HealthServiceAccessibilityMaskAvailable) {
    HealthValue bpm = health_service_peek_current_value(HealthMetricHeartRateBPM);
    if (bpm > 0 && bpm < 1000) {
      if (fresh_event || s_last_hr_update_at > 0) {
        s_last_hr_bpm = (int32_t)bpm;
      }
      if (fresh_event) {
        s_last_hr_update_at = now;
        s_hr_clear_sent = false;
      }
      return;
    }
  }
#endif
  clear_hr_reading();
}

static void expire_stale_hr(void) {
  if (s_last_hr_bpm <= 0 || s_last_hr_update_at <= 0) {
    return;
  }
  if (time(NULL) - s_last_hr_update_at >= HR_READING_STALE_S) {
    clear_hr_reading();
  }
}

static void maybe_send_periodic_hr(void) {
  int32_t current_elapsed_s = elapsed_s();
  if (current_elapsed_s > 0 && current_elapsed_s % HR_SEND_INTERVAL_S == 0) {
    send_hr_sample();
  }
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  s_anim_tick++;
  update_hr(false);
  expire_stale_hr();
  maybe_send_hr_clear();
  maybe_send_periodic_hr();
  mark_dirty();
}

static void health_event_handler(HealthEventType event, void *context) {
  if (event == HealthEventHeartRateUpdate) {
    update_hr(true);
    maybe_send_hr_clear();
    send_hr_sample();
  }
  mark_dirty();
}

static void draw_dotted_separator(GContext *ctx, int right, int y,
                                  GColor color) {
  graphics_context_set_stroke_color(ctx, color);
  for (int x = 8; x < right - 4; x += 4) {
    graphics_draw_pixel(ctx, GPoint(x, y));
  }
}

static void draw_duration_band(GContext *ctx, GRect bounds, int y, int height,
                               const char *elapsed_text, bool paused) {
  int right = content_right(bounds);
  GColor bg = paused ? color_pause_bg() : color_accent();
  GColor ink = paused ? GColorBlack : color_on_accent();
  int text_y = y + (height - 45) / 2;

  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, GRect(0, y, right, height), 0, GCornerNone);

  if (paused && layout_is_tall(bounds)) {
    graphics_context_set_text_color(ctx, ink);
    graphics_draw_text(ctx, "PAUSED", font_status(),
                       GRect(7, y + 2, right - 14, 18),
                       GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
  }

  graphics_context_set_text_color(ctx, ink);
  graphics_draw_text(ctx, elapsed_text, font_timer(),
                     GRect(0, text_y, right, 45),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);
}

static void draw_metric_row(GContext *ctx, GRect bounds, int y, int height,
                            const char *label, const char *value,
                            const char *unit) {
  int right = content_right(bounds);
  int unit_width = 40;

  draw_dotted_separator(ctx, right, y, color_muted());

  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(ctx, label, font_metric_label(),
                     GRect(8, y + (height - 18) / 2, 44, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);

  graphics_context_set_text_color(ctx, color_text());
  graphics_draw_text(ctx, value, font_metric_value(),
                     GRect(42, y + (height - 30) / 2,
                           right - 42 - unit_width, 30),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentRight, NULL);

  graphics_draw_text(ctx, unit, font_metric_unit(),
                     GRect(right - unit_width + 3,
                           y + (height - 18) / 2 + 2,
                           unit_width - 3, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
}

static void draw_heart_icon(GContext *ctx, GPoint center, GColor color) {
  graphics_context_set_fill_color(ctx, color);
  graphics_fill_circle(ctx, GPoint(center.x - 3, center.y - 3), 4);
  graphics_fill_circle(ctx, GPoint(center.x + 3, center.y - 3), 4);
  graphics_context_set_stroke_color(ctx, color);
  for (int row = 0; row < 8; row++) {
    int half_width = 7 - row;
    graphics_draw_line(ctx,
                       GPoint(center.x - half_width, center.y - 1 + row),
                       GPoint(center.x + half_width, center.y - 1 + row));
  }
}

static void draw_measuring_heart(GContext *ctx, GPoint center) {
  int pulse = s_anim_tick % 2;
  int radius = pulse ? 4 : 3;
  int half_width = radius * 2;

  graphics_context_set_stroke_color(ctx, color_muted());
  graphics_draw_circle(ctx, center, pulse ? 11 : 9);

  graphics_context_set_fill_color(ctx, color_accent());
  graphics_fill_circle(
      ctx, GPoint(center.x - radius + 1, center.y - radius + 1), radius);
  graphics_fill_circle(
      ctx, GPoint(center.x + radius - 1, center.y - radius + 1), radius);
  graphics_context_set_stroke_color(ctx, color_accent());
  for (int row = 0; row <= half_width; row++) {
    graphics_draw_line(
        ctx,
        GPoint(center.x - half_width + row, center.y - 1 + row),
        GPoint(center.x + half_width - row, center.y - 1 + row));
  }
}

static void draw_measuring_hr_row(GContext *ctx, GRect bounds, int y,
                                  int height) {
  int right = content_right(bounds);
  int center_y = y + height / 2;

  draw_dotted_separator(ctx, right, y, color_muted());
  draw_measuring_heart(ctx, GPoint(20, center_y));
  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(ctx, "MEASURING", font_status(),
                     GRect(40, center_y - 9, right - 46, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
}

static void draw_hr_row(GContext *ctx, GRect bounds, int y, int height,
                        int32_t bpm) {
  int right = content_right(bounds);
  HrZone zone = bpm > 0 ? hr_zone_for_bpm(bpm) : HrZoneBelow;
  GColor ink = zone == HrZoneBelow ? color_text() : GColorBlack;
  char value[16];

  if (bpm <= 0 && s_activity_state == ActivityStateActive) {
    draw_measuring_hr_row(ctx, bounds, y, height);
    return;
  }

  graphics_context_set_fill_color(ctx, hr_zone_color(zone));
  graphics_fill_rect(ctx, GRect(0, y, right, height), 0, GCornerNone);
  draw_dotted_separator(ctx, right, y,
                        zone == HrZoneBelow ? color_muted() : ink);

  graphics_context_set_text_color(ctx, ink);
  graphics_draw_text(ctx,
                     zone == HrZoneBelow ? "HEART RATE" :
                         hr_zone_label(zone),
                     font_metric_label(),
                     GRect(8, y + 3, 92, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);

  if (zone != HrZoneBelow) {
    graphics_context_set_fill_color(ctx, ink);
    graphics_context_set_stroke_color(ctx, ink);
    for (int i = 1; i <= 3; i++) {
      GRect bar = GRect(8 + (i - 1) * 15, y + height - 8, 12, 4);
      if (i <= (int)zone) {
        graphics_fill_rect(ctx, bar, 0, GCornerNone);
      } else {
        graphics_draw_rect(ctx, bar);
      }
    }
  }

  if (bpm > 0) {
    snprintf(value, sizeof(value), "%ld", (long)bpm);
  } else {
    snprintf(value, sizeof(value), "--");
  }
  if (right >= 150) {
    draw_heart_icon(ctx, GPoint(right - 66, y + height / 2 + 1), ink);
  }
  graphics_draw_text(ctx, value, font_metric_value(),
                     GRect(right - 57, y + (height - 30) / 2,
                           53, 30),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentRight, NULL);
}

static void draw_top_bar(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  int third = right / 3;
  char clock_text[8];

  graphics_context_set_fill_color(ctx, state_color());
  graphics_fill_rect(ctx, GRect(0, 0, right, 2), 0, GCornerNone);

  format_clock(clock_text, sizeof(clock_text));

  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(ctx, ACTIVITY_SHORT_LABELS[s_activity_type], font_status(),
                     GRect(8, 5, third - 8, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);

  graphics_context_set_text_color(ctx, color_text());
  graphics_draw_text(ctx, clock_text, font_status(),
                     GRect(third, 5, third, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);

  graphics_context_set_text_color(ctx, state_color());
  graphics_draw_text(ctx, state_short_label(), font_status(),
                     GRect(third * 2, 5, right - third * 2 - 4, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentRight, NULL);
}

static void draw_action_icon(GContext *ctx, GPoint center, ActionIcon icon,
                             GColor color) {
  int x = center.x;
  int y = center.y;

  if (icon == ActionIconNone) {
    return;
  }

  graphics_context_set_stroke_width(ctx, 2);
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_fill_color(ctx, color);

  switch (icon) {
    case ActionIconUp:
      graphics_draw_line(ctx, GPoint(x - 5, y + 3), GPoint(x, y - 3));
      graphics_draw_line(ctx, GPoint(x, y - 3), GPoint(x + 5, y + 3));
      break;
    case ActionIconDown:
      graphics_draw_line(ctx, GPoint(x - 5, y - 3), GPoint(x, y + 3));
      graphics_draw_line(ctx, GPoint(x, y + 3), GPoint(x + 5, y - 3));
      break;
    case ActionIconGps:
      graphics_draw_circle(ctx, center, 5);
      graphics_draw_line(ctx, GPoint(x, y - 8), GPoint(x, y - 5));
      graphics_draw_line(ctx, GPoint(x, y + 5), GPoint(x, y + 8));
      graphics_draw_line(ctx, GPoint(x - 8, y), GPoint(x - 5, y));
      graphics_draw_line(ctx, GPoint(x + 5, y), GPoint(x + 8, y));
      graphics_fill_circle(ctx, center, 2);
      break;
    case ActionIconRefresh:
      graphics_draw_circle(ctx, center, 5);
      graphics_draw_line(ctx, GPoint(x + 2, y - 6), GPoint(x + 6, y - 6));
      graphics_draw_line(ctx, GPoint(x + 6, y - 6), GPoint(x + 6, y - 2));
      break;
    case ActionIconPlay:
      graphics_draw_line(ctx, GPoint(x - 3, y - 6), GPoint(x + 5, y));
      graphics_draw_line(ctx, GPoint(x + 5, y), GPoint(x - 3, y + 6));
      graphics_draw_line(ctx, GPoint(x - 3, y + 6), GPoint(x - 3, y - 6));
      break;
    case ActionIconPause:
      graphics_fill_rect(ctx, GRect(x - 5, y - 6, 3, 12), 1, GCornersAll);
      graphics_fill_rect(ctx, GRect(x + 2, y - 6, 3, 12), 1, GCornersAll);
      break;
    case ActionIconStop:
      graphics_fill_rect(ctx, GRect(x - 5, y - 5, 10, 10),
                         1, GCornersAll);
      break;
    case ActionIconType:
      graphics_draw_line(ctx, GPoint(x - 5, y - 5), GPoint(x + 4, y - 5));
      graphics_draw_line(ctx, GPoint(x - 5, y), GPoint(x + 4, y));
      graphics_draw_line(ctx, GPoint(x - 5, y + 5), GPoint(x + 4, y + 5));
      graphics_fill_circle(ctx, GPoint(x + 6, y - 5), 1);
      graphics_fill_circle(ctx, GPoint(x + 6, y), 1);
      graphics_fill_circle(ctx, GPoint(x + 6, y + 5), 1);
      break;
    case ActionIconNew:
      graphics_draw_line(ctx, GPoint(x, y - 6), GPoint(x, y + 6));
      graphics_draw_line(ctx, GPoint(x - 6, y), GPoint(x + 6, y));
      break;
    case ActionIconNone:
    default:
      break;
  }
}

static void draw_action_rail(GContext *ctx, GRect bounds, ActionIcon up,
                             ActionIcon select, ActionIcon down) {
  int rail_x = action_rail_x(bounds);
  int icon_x = rail_x + ACTION_RAIL_W / 2;
  GColor rail_color = color_text();
  GColor icon_color = color_bg();

  if (up == ActionIconNone && select == ActionIconNone &&
      down == ActionIconNone) {
    return;
  }

  graphics_context_set_fill_color(ctx, rail_color);
  graphics_fill_rect(ctx, GRect(rail_x, 0, ACTION_RAIL_W, bounds.size.h),
                     0, GCornerNone);

  draw_action_icon(ctx, GPoint(icon_x, rail_icon_y(bounds, 0)), up, icon_color);
  draw_action_icon(ctx, GPoint(icon_x, rail_icon_y(bounds, 1)), select,
                   icon_color);
  draw_action_icon(ctx, GPoint(icon_x, rail_icon_y(bounds, 2)), down,
                   icon_color);
}

static void draw_activity_icon_for_type(GContext *ctx, ActivityType type,
                                        GPoint center, int size,
                                        GColor icon_color) {
  int variant = gcolor_equal(icon_color, GColorWhite) ? 1 : 0;
  GBitmap *icon = s_activity_icons[type][variant];
  GRect icon_rect = GRect(center.x - size / 2, center.y - size / 2,
                         size, size);

  if (!icon) {
    graphics_context_set_fill_color(ctx, icon_color);
    graphics_fill_circle(ctx, center, size / 3);
    return;
  }

  graphics_context_set_compositing_mode(ctx, GCompOpSet);
  graphics_draw_bitmap_in_rect(ctx, icon, icon_rect);
  graphics_context_set_compositing_mode(ctx, GCompOpAssign);
}

static void draw_choose_menu_item(GContext *ctx, GRect bounds,
                                  ActivityType type, int y) {
  bool selected = s_activity_type == type;
  bool tall = layout_is_tall(bounds);
  int right = content_right(bounds);
  int row_h = tall ? 48 : 38;
  int icon_size = tall ? 34 : 28;
  GRect row_bounds = GRect(0, y, right, row_h);
  GColor item_text = selected ? color_on_accent() : color_text();
  GColor item_icon = selected ? color_on_accent() : color_text();

  if (selected) {
    graphics_context_set_fill_color(ctx, color_accent());
    graphics_fill_rect(ctx, row_bounds, 0, GCornerNone);
  } else {
    graphics_context_set_stroke_color(ctx, color_muted());
    for (int x = 8; x < right - 4; x += 4) {
      graphics_draw_pixel(ctx, GPoint(x, y + row_h - 1));
    }
  }

  draw_activity_icon_for_type(
      ctx, type, GPoint(29, y + row_h / 2), icon_size, item_icon);

  graphics_context_set_text_color(ctx, item_text);
  graphics_draw_text(ctx, ACTIVITY_LABELS[type], font_menu(),
                     GRect(52, y + (row_h - 24) / 2, right - 56, 24),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
}

static void draw_gps_icon(GContext *ctx, GPoint center) {
  int pulse = s_anim_tick % 3;
  int outer_r = 18 + pulse * 3;

  graphics_context_set_stroke_width(ctx, 1);
  graphics_context_set_stroke_color(ctx, color_muted());
  graphics_draw_circle(ctx, center, outer_r);
  graphics_draw_circle(ctx, center, outer_r + 8);

  graphics_context_set_stroke_width(ctx, 2);
  graphics_context_set_stroke_color(ctx, state_color());
  graphics_draw_line(ctx, GPoint(center.x, center.y - 27),
                     GPoint(center.x, center.y - 13));
  graphics_draw_line(ctx, GPoint(center.x, center.y + 13),
                     GPoint(center.x, center.y + 27));
  graphics_draw_line(ctx, GPoint(center.x - 27, center.y),
                     GPoint(center.x - 13, center.y));
  graphics_draw_line(ctx, GPoint(center.x + 13, center.y),
                     GPoint(center.x + 27, center.y));

  graphics_context_set_fill_color(ctx, state_color());
  graphics_fill_circle(ctx, center, s_gps_state == GpsStateLocked ? 7 : 5);
}

static void draw_choose_screen(GContext *ctx, GRect bounds) {
  draw_top_bar(ctx, bounds);

  draw_choose_menu_item(ctx, bounds, ActivityTypeWalking, choose_row_y(bounds, 0));
  draw_choose_menu_item(ctx, bounds, ActivityTypeRunning, choose_row_y(bounds, 1));
  draw_choose_menu_item(ctx, bounds, ActivityTypeCycling, choose_row_y(bounds, 2));
  draw_action_rail(ctx, bounds, ActionIconUp, ActionIconGps, ActionIconDown);
}

static void draw_gps_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  bool tall = layout_is_tall(bounds);
  int icon_y = tall ? 78 : 67;
  int title_y = tall ? 114 : 98;
  int accuracy_y = tall ? 145 : 126;
  char accuracy_text[32];
  char detail_text[32];

  draw_top_bar(ctx, bounds);
  draw_gps_icon(ctx, GPoint(right / 2, icon_y));

  graphics_context_set_text_color(ctx, state_color());
  graphics_draw_text(ctx,
                     s_gps_state == GpsStateLocked ? "GPS LOCKED" :
	                     s_gps_state == GpsStateError ? "GPS PROBLEM" :
	                     "FINDING GPS",
                     font_value(), GRect(8, title_y, right - 8, 28),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  graphics_context_set_text_color(ctx, color_text());
  if (s_gps_state == GpsStateError && s_gps_error[0] != '\0') {
    snprintf(accuracy_text, sizeof(accuracy_text), "%s", s_gps_error);
  } else if (s_gps_accuracy_m >= 0) {
    snprintf(accuracy_text, sizeof(accuracy_text), "%ld m accuracy",
             (long)s_gps_accuracy_m);
  } else {
    snprintf(accuracy_text, sizeof(accuracy_text), "Waiting for phone GPS");
  }
  graphics_draw_text(ctx, accuracy_text, font_label(),
                     GRect(8, accuracy_y, right - 8, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  if (s_gps_state == GpsStateLocked) {
    snprintf(detail_text, sizeof(detail_text), "Ready to start");
  } else if (s_gps_accuracy_m >= 0) {
    snprintf(detail_text, sizeof(detail_text), "%d m required",
             GPS_LOCK_ACCURACY_M);
  } else {
    snprintf(detail_text, sizeof(detail_text), "Keep phone nearby");
  }
  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(ctx, detail_text, font_label(),
                     GRect(8, bounds.size.h - 25, right - 8, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  draw_action_rail(ctx, bounds, ActionIconRefresh,
                   s_gps_state == GpsStateLocked ? ActionIconPlay : ActionIconNone,
                   ActionIconType);
}

static void draw_countdown_screen(GContext *ctx, GRect bounds) {
  int width = bounds.size.w;
  int visible_count = (int)clamp_i32(s_countdown_value, 1, 3);
  bool tall = layout_is_tall(bounds);
  int band_y = tall ? 38 : 28;
  int band_h = tall ? 120 : 106;
  int variant = gcolor_equal(color_on_accent(), GColorWhite) ? 1 : 0;
  GBitmap *number_icon = s_countdown_icons[visible_count - 1][variant];

  draw_top_bar(ctx, bounds);

  graphics_context_set_fill_color(ctx, color_accent());
  graphics_fill_rect(ctx, GRect(0, band_y, width, band_h),
                     0, GCornerNone);

  if (number_icon) {
    GRect icon_bounds = gbitmap_get_bounds(number_icon);
    icon_bounds.origin.x = (width - icon_bounds.size.w) / 2;
    icon_bounds.origin.y = band_y + (band_h - icon_bounds.size.h) / 2;
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(ctx, number_icon, icon_bounds);
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
  }

  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(ctx, ACTIVITY_LABELS[s_activity_type], font_label(),
                     GRect(8, band_y + band_h + 10, width - 16, 18),
                     GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
}

static void draw_split_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  bool tall = layout_is_tall(bounds);
  int band_y = tall ? 27 : 22;
  int band_h = tall ? 96 : 70;
  int row_h = tall ? 44 : 30;
  int movement_y = band_y + band_h + 1;
  int hr_y = movement_y + row_h;
  char title_text[20];
  char split_time_text[16];
  char movement_value[16];
  char movement_unit[8];

  draw_top_bar(ctx, bounds);

  snprintf(title_text, sizeof(title_text), "KM %ld",
           (long)s_split_number);
  graphics_context_set_fill_color(ctx, color_accent());
  graphics_fill_rect(ctx, GRect(0, band_y, right, band_h),
                     0, GCornerNone);
  graphics_context_set_text_color(ctx, color_on_accent());
  graphics_draw_text(ctx, title_text, font_value(),
                     GRect(8, band_y + 3, right - 16, 28),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);

  format_elapsed(s_split_elapsed_s, split_time_text, sizeof(split_time_text));
  graphics_context_set_text_color(ctx, color_on_accent());
  graphics_draw_text(ctx, split_time_text, font_timer(),
                     GRect(0, band_y + band_h - 49, right, 45),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);

  if (activity_uses_speed()) {
    format_speed_parts(100000 / s_split_elapsed_s,
                       movement_value, sizeof(movement_value),
                       movement_unit, sizeof(movement_unit));
  } else {
    format_pace_parts(s_split_elapsed_s,
                      movement_value, sizeof(movement_value),
                      movement_unit, sizeof(movement_unit));
  }
  draw_metric_row(ctx, bounds, movement_y, row_h,
                  activity_uses_speed() ? "AVG" : "PACE",
                  movement_value, movement_unit);
  draw_hr_row(ctx, bounds, hr_y, row_h, s_last_hr_bpm);

  draw_action_rail(ctx, bounds, ActionIconNone,
                   ActionIconPause, ActionIconStop);
}

static void draw_activity_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  bool tall = layout_is_tall(bounds);
  int duration_y = tall ? 27 : 22;
  int duration_h = tall ? 58 : 44;
  int row_h = tall ? 39 : 30;
  int distance_y = duration_y + duration_h + 1;
  int movement_y = distance_y + row_h;
  int hr_y = movement_y + row_h;
  char elapsed_text[16];
  char distance_value[16];
  char distance_unit[8];
  char movement_value[16];
  char movement_unit[8];
  char gps_text[32];
  char summary_text[32];
  bool paused = s_activity_state == ActivityStatePaused;

  draw_top_bar(ctx, bounds);

  format_elapsed(elapsed_s(), elapsed_text, sizeof(elapsed_text));
  draw_duration_band(ctx, bounds, duration_y, duration_h,
                     elapsed_text, paused);

  format_distance_parts(s_distance_m,
                        distance_value, sizeof(distance_value),
                        distance_unit, sizeof(distance_unit));
  if (activity_uses_speed()) {
    format_speed_parts(s_current_speed_centi_mps,
                       movement_value, sizeof(movement_value),
                       movement_unit, sizeof(movement_unit));
  } else {
    format_pace_parts(s_current_pace_s_per_km,
                      movement_value, sizeof(movement_value),
                      movement_unit, sizeof(movement_unit));
  }

  draw_metric_row(ctx, bounds, distance_y, row_h,
                  "DIST", distance_value, distance_unit);
  draw_metric_row(ctx, bounds, movement_y, row_h,
                  activity_uses_speed() ? "SPEED" : "PACE",
                  movement_value, movement_unit);
  draw_hr_row(ctx, bounds, hr_y, row_h, s_last_hr_bpm);

  graphics_context_set_text_color(ctx, color_muted());
  if (s_gps_state == GpsStateLocked && s_gps_accuracy_m >= 0) {
    snprintf(gps_text, sizeof(gps_text), "GPS %ld M", (long)s_gps_accuracy_m);
  } else if (s_gps_state == GpsStateSearching && s_gps_accuracy_m >= 0) {
    snprintf(gps_text, sizeof(gps_text), "GPS %ld M / NEED %d M",
             (long)s_gps_accuracy_m, GPS_LOCK_ACCURACY_M);
  } else if (s_gps_state == GpsStateError && s_gps_error[0] != '\0') {
    snprintf(gps_text, sizeof(gps_text), "%s", s_gps_error);
  } else {
    snprintf(gps_text, sizeof(gps_text), "GPS --");
  }

  if (tall) {
    graphics_draw_text(ctx, gps_text, font_label(),
                       GRect(8, bounds.size.h - 23, right - 8, 18),
                       GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentCenter, NULL);
  }

  if (s_activity_state == ActivityStateFinished && s_summary_points > 0) {
    snprintf(summary_text, sizeof(summary_text), "%ld pts saved",
             (long)s_summary_points);
    graphics_draw_text(ctx, summary_text, font_label(),
                       GRect(8, bounds.size.h - 41, right - 8, 18),
                       GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);
  }

  draw_action_rail(ctx, bounds, ActionIconNone,
                   s_activity_state == ActivityStateFinished ? ActionIconNew :
                       paused ? ActionIconPlay : ActionIconPause,
                   s_activity_state == ActivityStateFinished ?
                       ActionIconNone : ActionIconStop);
}

static void canvas_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  graphics_context_set_fill_color(ctx, color_bg());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  switch (s_activity_state) {
    case ActivityStateChoose:
      draw_choose_screen(ctx, bounds);
      break;
    case ActivityStateGps:
    case ActivityStateReady:
      draw_gps_screen(ctx, bounds);
      break;
    case ActivityStateCountdown:
      draw_countdown_screen(ctx, bounds);
      break;
    case ActivityStateActive:
      if (s_split_visible) {
        draw_split_screen(ctx, bounds);
        break;
      }
      draw_activity_screen(ctx, bounds);
      break;
    case ActivityStateFinished:
      draw_activity_screen(ctx, bounds);
      break;
    case ActivityStatePaused:
    default:
      draw_activity_screen(ctx, bounds);
      break;
  }
}

static void inbox_received_callback(DictionaryIterator *iter, void *context) {
  bool settings_changed = false;
  Tuple *gps_status = dict_find(iter, MESSAGE_KEY_GPS_STATUS);
  if (gps_status) {
    int32_t status = gps_status->value->int32;
    s_gps_state = (GpsState)clamp_i32(status, GpsStateIdle, GpsStateError);
    if (s_activity_state == ActivityStateGps ||
        s_activity_state == ActivityStateReady) {
      s_activity_state = s_gps_state == GpsStateLocked ?
          ActivityStateReady : ActivityStateGps;
    }
  }

  Tuple *gps_accuracy = dict_find(iter, MESSAGE_KEY_GPS_ACCURACY);
  if (gps_accuracy) {
    s_gps_accuracy_m = gps_accuracy->value->int32;
  }

  Tuple *gps_age = dict_find(iter, MESSAGE_KEY_GPS_AGE);
  if (gps_age) {
    s_gps_age_s = gps_age->value->int32;
  }

  Tuple *gps_error = dict_find(iter, MESSAGE_KEY_GPS_ERROR);
  if (gps_error) {
    snprintf(s_gps_error, sizeof(s_gps_error), "%s",
             gps_error->value->cstring);
  }

  Tuple *distance = dict_find(iter, MESSAGE_KEY_DISTANCE_M);
  if (distance) {
    s_distance_m = distance->value->int32;
    maybe_show_split_summary(s_distance_m);
  }

  Tuple *pace = dict_find(iter, MESSAGE_KEY_CURRENT_PACE);
  if (pace) {
    s_current_pace_s_per_km = pace->value->int32;
  }

  Tuple *speed = dict_find(iter, MESSAGE_KEY_CURRENT_SPEED);
  if (speed) {
    s_current_speed_centi_mps = speed->value->int32;
  }

  Tuple *summary_distance = dict_find(iter, MESSAGE_KEY_SUMMARY_DISTANCE_M);
  if (summary_distance) {
    s_summary_distance_m = summary_distance->value->int32;
    s_distance_m = s_summary_distance_m;
  }

  Tuple *summary_moving = dict_find(iter, MESSAGE_KEY_SUMMARY_MOVING_S);
  if (summary_moving) {
    s_summary_moving_s = summary_moving->value->int32;
    s_finished_elapsed_s = s_summary_moving_s;
  }

  Tuple *summary_points = dict_find(iter, MESSAGE_KEY_SUMMARY_POINTS);
  if (summary_points) {
    s_summary_points = summary_points->value->int32;
  }

  Tuple *activity_id = dict_find(iter, MESSAGE_KEY_ACTIVITY_ID);
  if (activity_id) {
    snprintf(s_activity_id, sizeof(s_activity_id), "%s",
             activity_id->value->cstring);
  }

  Tuple *dark_mode = dict_find(iter, MESSAGE_KEY_DARK_MODE);
  if (dark_mode) {
    s_dark_mode = dark_mode->value->int32 ? true : false;
    settings_changed = true;
    if (s_main_window) {
      window_set_background_color(s_main_window, color_bg());
    }
  }

  Tuple *hr_zone_1 = dict_find(iter, MESSAGE_KEY_HR_ZONE_1_BPM);
  if (hr_zone_1) {
    s_hr_zone_1_bpm = hr_zone_1->value->int32;
    settings_changed = true;
  }

  Tuple *hr_zone_2 = dict_find(iter, MESSAGE_KEY_HR_ZONE_2_BPM);
  if (hr_zone_2) {
    s_hr_zone_2_bpm = hr_zone_2->value->int32;
    settings_changed = true;
  }

  Tuple *hr_zone_3 = dict_find(iter, MESSAGE_KEY_HR_ZONE_3_BPM);
  if (hr_zone_3) {
    s_hr_zone_3_bpm = hr_zone_3->value->int32;
    settings_changed = true;
  }

  if (settings_changed) {
    normalize_hr_zone_thresholds();
    save_settings();
  }

  mark_dirty();
}

static void inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Inbox dropped: %d", reason);
}

static void outbox_failed_callback(DictionaryIterator *iter,
                                   AppMessageResult reason,
                                   void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox failed: %d", reason);
}

static void select_click_handler(ClickRecognizerRef recognizer, void *context) {
  switch (s_activity_state) {
    case ActivityStateChoose:
      request_gps();
      break;
    case ActivityStateGps:
      if (s_gps_state == GpsStateLocked) {
        begin_countdown();
      } else {
        request_gps();
      }
      break;
    case ActivityStateReady:
      begin_countdown();
      break;
    case ActivityStateCountdown:
      break;
    case ActivityStateActive:
      pause_activity();
      break;
    case ActivityStatePaused:
      resume_activity();
      break;
    case ActivityStateFinished:
      return_to_choose();
      break;
    default:
      request_gps();
      break;
  }
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_activity_state == ActivityStateChoose) {
    cycle_activity_type(-1);
  } else if (s_activity_state == ActivityStateGps ||
      s_activity_state == ActivityStateReady ||
      s_activity_state == ActivityStateFinished) {
    request_gps();
  }
}

static void down_click_handler(ClickRecognizerRef recognizer, void *context) {
  cycle_activity_type(1);
}

static void down_long_click_handler(ClickRecognizerRef recognizer,
                                    void *context) {
  finish_activity();
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
  window_long_click_subscribe(BUTTON_ID_DOWN, 700, down_long_click_handler, NULL);
}

static void load_activity_icons(void) {
  for (int type = 0; type < 3; type++) {
    for (int variant = 0; variant < 2; variant++) {
      s_activity_icons[type][variant] =
          gbitmap_create_with_resource(ACTIVITY_ICON_RESOURCE_IDS[type][variant]);
      s_countdown_icons[type][variant] =
          gbitmap_create_with_resource(COUNTDOWN_ICON_RESOURCE_IDS[type][variant]);
    }
  }
}

static void unload_activity_icons(void) {
  for (int type = 0; type < 3; type++) {
    for (int variant = 0; variant < 2; variant++) {
      if (s_activity_icons[type][variant]) {
        gbitmap_destroy(s_activity_icons[type][variant]);
        s_activity_icons[type][variant] = NULL;
      }
      if (s_countdown_icons[type][variant]) {
        gbitmap_destroy(s_countdown_icons[type][variant]);
        s_countdown_icons[type][variant] = NULL;
      }
    }
  }
}

static void main_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  load_activity_icons();

  s_canvas_layer = layer_create(bounds);
  layer_set_update_proc(s_canvas_layer, canvas_update_proc);
  layer_add_child(window_layer, s_canvas_layer);

  update_hr(false);
}

static void main_window_unload(Window *window) {
  layer_destroy(s_canvas_layer);
  s_canvas_layer = NULL;
  unload_activity_icons();
}

static void init(void) {
  load_settings();
  s_main_window = window_create();
  window_set_background_color(s_main_window, color_bg());
  window_set_click_config_provider(s_main_window, click_config_provider);
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload
  });

  app_message_register_inbox_received(inbox_received_callback);
  app_message_register_inbox_dropped(inbox_dropped_callback);
  app_message_register_outbox_failed(outbox_failed_callback);
  app_message_open(512, 128);

  tick_timer_service_subscribe(SECOND_UNIT, tick_handler);
#if defined(PBL_HEALTH)
  health_service_events_subscribe(health_event_handler, NULL);
#endif

  window_stack_push(s_main_window, true);
  request_settings();
}

static void deinit(void) {
  cancel_countdown();
  hide_split_summary();
  set_activity_hr_sampling(false);
  tick_timer_service_unsubscribe();
#if defined(PBL_HEALTH)
  health_service_events_unsubscribe();
#endif
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
