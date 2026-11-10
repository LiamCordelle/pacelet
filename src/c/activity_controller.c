#include "activity_controller.h"

#include "pacelet_model.h"
#include "watch_services.h"
#include "watch_ui.h"

#include <string.h>

#define HR_SAMPLE_PERIOD_S 1
#define HR_SEND_INTERVAL_S 5
#define HR_READING_STALE_S 60
#define SPLIT_DISTANCE_M 1000
#define SPLIT_SUMMARY_MS 6000
#define CHOOSE_ITEM_COUNT 4
#define ACTIVITY_PERSIST_INTERVAL_S 30

static AppTimer *s_countdown_timer;
static AppTimer *s_split_timer;
static bool s_hr_sample_period_requested;
static int32_t s_last_persist_elapsed_s;

static void update_hr(bool fresh_event);

static void write_pause_time(uint8_t *bytes) {
  time_t seconds;
  uint16_t milliseconds;
  time_ms(&seconds, &milliseconds);
  uint64_t stamp = (uint64_t)seconds * 1000 + milliseconds;
  for (int i = 0; i < 6; i++) { bytes[i] = (stamp >> (8 * i)) & 0xff; }
}

static bool pause_is_open(void) {
  if (g_pacelet.pause_windows_size < 12) { return false; }
  for (int i = g_pacelet.pause_windows_size - 6;
       i < g_pacelet.pause_windows_size; i++) {
    if (g_pacelet.pause_windows[i]) { return false; }
  }
  return true;
}

static void acknowledge_pause_windows(void) {
  if (pause_is_open()) {
    memmove(g_pacelet.pause_windows,
            g_pacelet.pause_windows + g_pacelet.pause_windows_size - 12, 12);
    g_pacelet.pause_windows_size = 12;
  } else { g_pacelet.pause_windows_size = 0; }
}

static bool read_today_steps(int32_t *steps_out) {
#if defined(PBL_HEALTH)
  time_t now = time(NULL);
  struct tm *local_now = localtime(&now);
  if (!local_now) {
    return false;
  }

  struct tm day_start = *local_now;
  day_start.tm_hour = 0;
  day_start.tm_min = 0;
  day_start.tm_sec = 0;
  time_t day_start_time = mktime(&day_start);
  if (day_start_time == (time_t)-1) {
    return false;
  }

  HealthServiceAccessibilityMask steps_access =
      health_service_metric_accessible(
          HealthMetricStepCount, day_start_time, now);
  if (steps_access & (HealthServiceAccessibilityMaskNoPermission |
                      HealthServiceAccessibilityMaskNotSupported)) {
    return false;
  }

  HealthValue steps = health_service_sum_today(HealthMetricStepCount);
  *steps_out = steps > 0 ? (int32_t)steps : 0;
  return true;
#else
  (void)steps_out;
  return false;
#endif
}

static void rebase_steps_after_recovery(bool paused) {
  int32_t today_steps = 0;
  if (!read_today_steps(&today_steps)) {
    g_pacelet.current_steps_available = false;
    g_pacelet.pause_start_steps_today = -1;
    return;
  }

  if (g_pacelet.current_steps < 0) {
    g_pacelet.current_steps = 0;
  }
  g_pacelet.activity_start_steps_today =
      today_steps - g_pacelet.current_steps;
  g_pacelet.total_paused_steps = 0;
  g_pacelet.last_steps_today = today_steps;
  g_pacelet.pause_start_steps_today = paused ? today_steps : -1;
  g_pacelet.current_steps_available = true;
}

static void update_steps(void) {
  if (g_pacelet.activity_state != ActivityStateActive &&
      g_pacelet.activity_state != ActivityStatePaused) {
    g_pacelet.current_steps_available = false;
    return;
  }

  if (g_pacelet.activity_state == ActivityStatePaused) {
    return;
  }

  int32_t today_steps = 0;
  if (!read_today_steps(&today_steps)) {
    g_pacelet.current_steps_available = false;
    return;
  }

  // A negative baseline carries yesterday's activity steps into the new day.
  // Compare consecutive daily totals, since the baseline may be below zero.
  if (!g_pacelet.current_steps_available) {
    g_pacelet.activity_start_steps_today = today_steps - g_pacelet.current_steps;
  } else if (today_steps < g_pacelet.last_steps_today) {
    g_pacelet.activity_start_steps_today = -g_pacelet.current_steps;
    g_pacelet.total_paused_steps = 0;
  }
  g_pacelet.last_steps_today = today_steps;
  int32_t steps = today_steps - g_pacelet.activity_start_steps_today -
      g_pacelet.total_paused_steps;
  g_pacelet.current_steps = steps > 0 ? steps : 0;
  g_pacelet.current_steps_available = true;
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
  if (g_pacelet.hr_batch_size >= HR_SEND_INTERVAL_S * 5 ||
      g_pacelet.activity_state != ActivityStateActive) {
    watch_services_send_hr_batch();
  }
}

static void buffer_hr_sample(void) {
  time_t now = time(NULL);
  if (g_pacelet.activity_state != ActivityStateActive ||
      g_pacelet.last_hr_bpm <= 0 || g_pacelet.last_hr_bpm > 250 ||
      now == g_pacelet.hr_batch_sampled_at ||
      g_pacelet.hr_batch_size > sizeof(g_pacelet.hr_batch) - 5) {
    return;
  }
  g_pacelet.hr_batch_sampled_at = now;
  uint32_t stamp = (uint32_t)now;
  uint8_t *sample = &g_pacelet.hr_batch[g_pacelet.hr_batch_size];
  for (int i = 0; i < 4; i++) { sample[i] = (stamp >> (i * 8)) & 0xff; }
  sample[4] = (uint8_t)g_pacelet.last_hr_bpm;
  g_pacelet.hr_batch_size += 5;
}

static void maybe_send_hr_clear(void) {
  if ((g_pacelet.activity_state != ActivityStateActive &&
       g_pacelet.activity_state != ActivityStatePaused) ||
      g_pacelet.last_hr_bpm > 0 || g_pacelet.hr_clear_sent) {
    return;
  }

  if (watch_services_send_hr_bpm(0)) {
    g_pacelet.hr_clear_sent = true;
  }
}

static void cancel_countdown(void) {
  if (s_countdown_timer) {
    app_timer_cancel(s_countdown_timer);
    s_countdown_timer = NULL;
  }
  g_pacelet.countdown_value = 0;
}

static void hide_split_summary(void) {
  if (s_split_timer) {
    app_timer_cancel(s_split_timer);
    s_split_timer = NULL;
  }
  if (g_pacelet.overlay == OverlaySplit) pacelet_set_overlay(OverlayNone);
}

static void split_timer_callback(void *data) {
  s_split_timer = NULL;
  if (g_pacelet.overlay == OverlaySplit) pacelet_set_overlay(OverlayNone);
  watch_ui_mark_dirty();
}

static void maybe_show_split_summary(int32_t distance_m) {
  if (g_pacelet.activity_state != ActivityStateActive ||
      distance_m < g_pacelet.next_split_km * SPLIT_DISTANCE_M) {
    return;
  }

  int32_t completed_km = distance_m / SPLIT_DISTANCE_M;
  int32_t current_elapsed_s = pacelet_elapsed_s();
  g_pacelet.split_number = completed_km;
  g_pacelet.split_elapsed_s =
      current_elapsed_s - g_pacelet.last_split_elapsed_s;
  if (g_pacelet.split_elapsed_s < 1) {
    g_pacelet.split_elapsed_s = 1;
  }
  g_pacelet.previous_split_s = g_pacelet.recent_splits[0];
  memmove(g_pacelet.recent_splits + 1, g_pacelet.recent_splits,
          sizeof(g_pacelet.recent_splits) - sizeof(int32_t));
  g_pacelet.recent_splits[0] = g_pacelet.split_elapsed_s;
  if (!g_pacelet.best_split_s || g_pacelet.split_elapsed_s < g_pacelet.best_split_s)
    g_pacelet.best_split_s = g_pacelet.split_elapsed_s;
  g_pacelet.last_split_elapsed_s = current_elapsed_s;
  g_pacelet.next_split_km = completed_km + 1;

  hide_split_summary();
  pacelet_set_overlay(OverlaySplit);
  static const uint32_t split_segments[] = {60, 90, 40};
  vibes_enqueue_custom_pattern((VibePattern) {
    .durations = split_segments, .num_segments = ARRAY_LENGTH(split_segments)
  });
  light_enable_interaction();
  s_split_timer =
      app_timer_register(SPLIT_SUMMARY_MS, split_timer_callback, NULL);
}

static void reset_activity_metrics(bool preserve_hr) {
  hide_split_summary();
  pacelet_model_reset_activity(preserve_hr);
}

static void request_gps(void) {
  if (g_pacelet.activity_state == ActivityStateCountdown) {
    cancel_countdown();
  }

  if (g_pacelet.activity_state == ActivityStateChoose ||
      g_pacelet.activity_state == ActivityStateFinished) {
    reset_activity_metrics(false);
  }

  set_activity_hr_sampling(true);
  update_hr(false);
  pacelet_set_state(ActivityStateGps);
  g_pacelet.gps_state = GpsStateSearching;
  time_t seconds;
  uint16_t milliseconds;
  time_ms(&seconds, &milliseconds);
  uint32_t request_id = g_pacelet.gps_request_id ?
      (uint32_t)g_pacelet.gps_request_id + 1 : (uint32_t)seconds * 1000 + milliseconds;
  if (!request_id) request_id = 1;
  g_pacelet.gps_request_id = (int32_t)request_id;
  g_pacelet.gps_accuracy_m = -1;
  g_pacelet.gps_error[0] = '\0';
  watch_services_send_command(MESSAGE_KEY_REQUEST_GPS);
  watch_ui_mark_dirty();
}

static void return_to_choose(void) {
  cancel_countdown();
  set_activity_hr_sampling(false);
  reset_activity_metrics(false);
  pacelet_set_state(ActivityStateChoose);
  g_pacelet.gps_state = GpsStateIdle;
  g_pacelet.gps_accuracy_m = -1;
  g_pacelet.gps_error[0] = '\0';
  watch_services_clear_activity_state();
  watch_ui_mark_dirty();
}

static void open_history_list(void) {
  cancel_countdown();
  pacelet_set_state(ActivityStateHistoryList);
  g_pacelet.history_loading = true;
  g_pacelet.history_count = 0;
  g_pacelet.history_selected_index = 0;
  snprintf(g_pacelet.history_message, sizeof(g_pacelet.history_message),
           "Loading history");
  watch_services_request_history();
  watch_ui_mark_dirty();
}

static void select_history_item(void) {
  if (g_pacelet.activity_state != ActivityStateHistoryList) {
    return;
  }

  if (g_pacelet.history_selected_index >= g_pacelet.history_count) {
    return_to_choose();
    return;
  }

  pacelet_set_state(ActivityStateHistoryDetail);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static bool selected_history_activity_available(void) {
  return g_pacelet.history_count > 0 &&
      g_pacelet.history_selected_index >= 0 &&
      g_pacelet.history_selected_index < g_pacelet.history_count;
}

static void request_selected_history_export(void) {
  if (!selected_history_activity_available()) {
    return;
  }
  snprintf(g_pacelet.history_message, sizeof(g_pacelet.history_message),
           "Opening TCX on phone");
  APP_LOG(APP_LOG_LEVEL_INFO, "Requesting TCX export for history index %ld",
          (long)g_pacelet.history_selected_index);
  watch_services_send_history_action(
      MESSAGE_KEY_EXPORT_HISTORY_TCX, g_pacelet.history_selected_index);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void request_selected_history_retry(void) {
  if (!selected_history_activity_available()) {
    return;
  }
  snprintf(g_pacelet.history_message, sizeof(g_pacelet.history_message),
           "Retrying Strava");
  APP_LOG(APP_LOG_LEVEL_INFO, "Requesting Strava retry for history index %ld",
          (long)g_pacelet.history_selected_index);
  watch_services_send_history_action(
      MESSAGE_KEY_RETRY_HISTORY_STRAVA, g_pacelet.history_selected_index);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void start_activity_recording(void) {
  cancel_countdown();

  if (g_pacelet.gps_state != GpsStateLocked) {
    request_gps();
    return;
  }

  reset_activity_metrics(true);
  g_pacelet.started_at = time(NULL);
  pacelet_set_state(ActivityStateActive);
  g_pacelet.recovery_phone_draft_available = true;
  s_last_persist_elapsed_s = 0;
  set_activity_hr_sampling(true);
  update_hr(false);
  update_steps();
  watch_services_send_command(MESSAGE_KEY_START_ACTIVITY);
  watch_ui_mark_dirty();
}

static void countdown_timer_callback(void *data) {
  s_countdown_timer = NULL;
  if (g_pacelet.activity_state != ActivityStateCountdown) {
    return;
  }

  if (g_pacelet.countdown_value > 1) {
    g_pacelet.countdown_value--;
    vibes_short_pulse();
    s_countdown_timer =
        app_timer_register(1000, countdown_timer_callback, NULL);
    watch_ui_mark_dirty();
    return;
  }

  start_activity_recording();
  if (g_pacelet.activity_state == ActivityStateActive) {
    vibes_long_pulse();
  }
}

static void begin_countdown(void) {
  if (g_pacelet.gps_state != GpsStateLocked) {
    request_gps();
    return;
  }

  cancel_countdown();
  pacelet_set_state(ActivityStateCountdown);
  g_pacelet.countdown_value = 3;
  vibes_short_pulse();
  s_countdown_timer =
      app_timer_register(1000, countdown_timer_callback, NULL);
  watch_ui_mark_dirty();
}

static void pause_activity(void) {
  if (g_pacelet.activity_state != ActivityStateActive) {
    return;
  }

  if (g_pacelet.pause_windows_size > sizeof(g_pacelet.pause_windows) - 12) {
    return;
  }
  uint8_t *window = g_pacelet.pause_windows + g_pacelet.pause_windows_size;
  write_pause_time(window);
  memset(window + 6, 0, 6);
  g_pacelet.pause_windows_size += 12;

  hide_split_summary();
  if (g_pacelet.overlay == OverlayFinish) pacelet_set_overlay(OverlayNone);
  update_steps();
  int32_t today_steps = 0;
  if (read_today_steps(&today_steps)) {
    g_pacelet.pause_start_steps_today = today_steps;
  } else {
    g_pacelet.pause_start_steps_today = -1;
  }
  g_pacelet.paused_pace_s_per_km = g_pacelet.current_pace_s_per_km;
  g_pacelet.paused_speed_centi_mps = g_pacelet.current_speed_centi_mps;
  g_pacelet.paused_at = time(NULL);
  pacelet_set_state(ActivityStatePaused);
  send_hr_sample();
  watch_services_send_command(MESSAGE_KEY_PAUSE_ACTIVITY);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void resume_activity(void) {
  if (g_pacelet.activity_state != ActivityStatePaused ||
      (g_pacelet.overlay == OverlayFinish)) {
    return;
  }

  // Leave room for the next pause while offline. ACKs retire closed intervals.
  if (g_pacelet.pause_windows_size >= sizeof(g_pacelet.pause_windows)) {
    snprintf(g_pacelet.recovery_message, sizeof(g_pacelet.recovery_message),
             "SYNC PHONE TO RESUME");
    vibes_short_pulse();
    watch_ui_mark_dirty();
    return;
  }
  if (pause_is_open()) {
    write_pause_time(g_pacelet.pause_windows + g_pacelet.pause_windows_size - 6);
  }

  time_t now = time(NULL);
  int32_t today_steps = 0;
  if (g_pacelet.pause_start_steps_today >= 0 &&
      read_today_steps(&today_steps)) {
    if (today_steps < g_pacelet.pause_start_steps_today) {
      g_pacelet.activity_start_steps_today = today_steps - g_pacelet.current_steps;
      g_pacelet.total_paused_steps = 0;
      g_pacelet.last_steps_today = today_steps;
      g_pacelet.pause_start_steps_today = today_steps;
    }
    int32_t paused_steps = today_steps - g_pacelet.pause_start_steps_today;
    if (paused_steps > 0) {
      g_pacelet.total_paused_steps += paused_steps;
    }
  }
  g_pacelet.total_paused_s +=
      (int32_t)(now - g_pacelet.paused_at);
  g_pacelet.paused_at = 0;
  g_pacelet.pause_start_steps_today = -1;
  pacelet_set_state(ActivityStateActive);
  set_activity_hr_sampling(true);
  update_hr(false);
  update_steps();
  watch_services_send_command(MESSAGE_KEY_RESUME_ACTIVITY);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void show_finish_confirmation(void) {
  if (g_pacelet.activity_state != ActivityStatePaused ||
      (g_pacelet.overlay == OverlayFinish)) {
    return;
  }

  pacelet_set_overlay(OverlayFinish);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void hide_finish_confirmation(void) {
  if (!(g_pacelet.overlay == OverlayFinish)) {
    return;
  }

  if (g_pacelet.overlay == OverlayFinish) pacelet_set_overlay(OverlayNone);
  watch_ui_mark_dirty();
}

static void finish_activity(void) {
  if (g_pacelet.activity_state != ActivityStatePaused ||
      !(g_pacelet.overlay == OverlayFinish)) {
    return;
  }

  hide_split_summary();
  if (g_pacelet.overlay == OverlayFinish) pacelet_set_overlay(OverlayNone);
  g_pacelet.finished_elapsed_s = pacelet_elapsed_s();
  send_hr_sample();
  set_activity_hr_sampling(false);
  pacelet_set_state(ActivityStateFinished);
  watch_services_send_command(MESSAGE_KEY_FINISH_ACTIVITY);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void request_recovery_resume(void) {
  if (g_pacelet.activity_state != ActivityStateRecovery ||
      !g_pacelet.recovery_phone_draft_available ||
      (g_pacelet.overlay == OverlayDiscard)) {
    return;
  }
  snprintf(g_pacelet.recovery_message,
           sizeof(g_pacelet.recovery_message), "WAITING FOR GPS");
  watch_services_send_command(MESSAGE_KEY_RECOVER_ACTIVITY);
  watch_ui_mark_dirty();
}

static void finish_recovered_activity(void) {
  if (g_pacelet.activity_state != ActivityStateRecovery ||
      !g_pacelet.recovery_phone_draft_available ||
      (g_pacelet.overlay == OverlayDiscard)) {
    return;
  }
  g_pacelet.finished_elapsed_s = g_pacelet.recovery_moving_s;
  g_pacelet.summary_distance_m = g_pacelet.distance_m;
  g_pacelet.summary_moving_s = g_pacelet.recovery_moving_s;
  pacelet_set_state(ActivityStateFinished);
  set_activity_hr_sampling(false);
  watch_services_send_command(MESSAGE_KEY_FINISH_ACTIVITY);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void show_discard_confirmation(void) {
  if (g_pacelet.activity_state != ActivityStateRecovery ||
      (g_pacelet.overlay == OverlayDiscard)) {
    return;
  }
  pacelet_set_overlay(OverlayDiscard);
  vibes_short_pulse();
  watch_services_save_activity_state();
  watch_ui_mark_dirty();
}

static void hide_discard_confirmation(void) {
  if (!(g_pacelet.overlay == OverlayDiscard)) {
    return;
  }
  if (g_pacelet.overlay == OverlayDiscard) pacelet_set_overlay(OverlayNone);
  watch_services_save_activity_state();
  watch_ui_mark_dirty();
}

static void discard_recovered_activity(void) {
  if (g_pacelet.activity_state != ActivityStateRecovery ||
      !(g_pacelet.overlay == OverlayDiscard)) {
    return;
  }
  if (g_pacelet.overlay == OverlayDiscard) pacelet_set_overlay(OverlayNone);
  snprintf(g_pacelet.recovery_message,
           sizeof(g_pacelet.recovery_message), "DISCARDING");
  watch_services_send_command(MESSAGE_KEY_DISCARD_ACTIVITY);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void cycle_activity_type(int direction) {
  if (g_pacelet.activity_state != ActivityStateChoose &&
      g_pacelet.activity_state != ActivityStateGps &&
      g_pacelet.activity_state != ActivityStateReady) {
    return;
  }

  g_pacelet.activity_type = (ActivityType)(
      ((int)g_pacelet.activity_type + direction + 3) % 3);
  g_pacelet.choose_index = g_pacelet.activity_type;
  watch_ui_mark_dirty();
}

static void cycle_choose_index(int direction) {
  if (g_pacelet.activity_state != ActivityStateChoose) {
    return;
  }

  g_pacelet.choose_index =
      (g_pacelet.choose_index + direction + CHOOSE_ITEM_COUNT) %
      CHOOSE_ITEM_COUNT;
  if (g_pacelet.choose_index <= ActivityTypeCycling) {
    g_pacelet.activity_type = (ActivityType)g_pacelet.choose_index;
  }
  watch_ui_mark_dirty();
}

static void cycle_history_index(int direction) {
  if (g_pacelet.activity_state != ActivityStateHistoryList) {
    return;
  }

  int32_t item_count = g_pacelet.history_count + 1;
  g_pacelet.history_selected_index =
      (g_pacelet.history_selected_index + direction + item_count) %
      item_count;
  watch_ui_mark_dirty();
}

static void clear_hr_reading(void) {
  g_pacelet.last_hr_bpm = 0;
  g_pacelet.last_hr_update_at = 0;
}

static void update_hr(bool fresh_event) {
#if defined(PBL_HEALTH)
  time_t now = time(NULL);
  HealthServiceAccessibilityMask hr_access =
      health_service_metric_aggregate_averaged_accessible(
          HealthMetricHeartRateRawBPM, now, now, HealthAggregationAvg,
          HealthServiceTimeScopeOnce);

  if (hr_access & HealthServiceAccessibilityMaskAvailable) {
    HealthValue bpm =
        health_service_peek_current_value(HealthMetricHeartRateRawBPM);
    if (bpm > 0 && bpm < 1000) {
      if (fresh_event || g_pacelet.last_hr_update_at > 0) {
        g_pacelet.last_hr_bpm = (int32_t)bpm;
      }
      if (fresh_event) {
        g_pacelet.last_hr_update_at = now;
        g_pacelet.hr_clear_sent = false;
      }
      return;
    }
  }
#else
  (void)fresh_event;
#endif
  clear_hr_reading();
}

static void expire_stale_hr(void) {
  if (g_pacelet.last_hr_bpm <= 0 ||
      g_pacelet.last_hr_update_at <= 0) {
    return;
  }
  if (time(NULL) - g_pacelet.last_hr_update_at >= HR_READING_STALE_S) {
    clear_hr_reading();
  }
}

static void maybe_send_periodic_hr(void) {
  buffer_hr_sample();
  send_hr_sample();
}

static bool saving_on_phone(void) {
  return g_pacelet.activity_state == ActivityStateFinished &&
      g_pacelet.pending_command == MESSAGE_KEY_FINISH_ACTIVITY;
}

void activity_controller_handle_select(void) {
  if (saving_on_phone()) { vibes_short_pulse(); return; }
  if (g_pacelet.overlay == OverlayExit) { return; }
  if ((g_pacelet.overlay == OverlayFinish) ||
      (g_pacelet.overlay == OverlayDiscard)) {
    return;
  }

  if ((g_pacelet.activity_state == ActivityStateActive ||
       g_pacelet.activity_state == ActivityStatePaused) && g_pacelet.page) {
    g_pacelet.page = 0; watch_ui_mark_dirty(); return;
  }
  if (g_pacelet.overlay == OverlaySplit) {
    hide_split_summary(); watch_ui_mark_dirty(); return;
  }
  switch (g_pacelet.activity_state) {
    case ActivityStateChoose:
      if (g_pacelet.choose_index == ActivityTypeWalking ||
          g_pacelet.choose_index == ActivityTypeRunning ||
          g_pacelet.choose_index == ActivityTypeCycling) {
        g_pacelet.activity_type = (ActivityType)g_pacelet.choose_index;
        request_gps();
      } else {
        open_history_list();
      }
      break;
    case ActivityStateGps:
      if (g_pacelet.gps_state == GpsStateLocked) {
        begin_countdown();
      } else {
        request_gps();
      }
      break;
    case ActivityStateReady:
      begin_countdown();
      break;
    case ActivityStatePaused:
      show_finish_confirmation();
      break;
    case ActivityStateHistoryList:
      select_history_item();
      break;
    case ActivityStateHistoryDetail:
      request_selected_history_retry();
      break;
    case ActivityStateRecovery:
      finish_recovered_activity();
      break;
    case ActivityStateFinished:
      open_history_list();
      break;
    case ActivityStateCountdown:
    case ActivityStateActive:
    default:
      break;
  }
}

void activity_controller_handle_up(void) {
  if (g_pacelet.overlay == OverlayExit) { pacelet_set_overlay(OverlayNone); window_stack_pop_all(true); return; }
  if (saving_on_phone()) { vibes_short_pulse(); return; }
  if (g_pacelet.overlay == OverlayDiscard) {
    discard_recovered_activity();
  } else if (g_pacelet.overlay == OverlayFinish) {
    finish_activity();
  } else if (g_pacelet.activity_state == ActivityStateChoose) {
    cycle_choose_index(-1);
  } else if (g_pacelet.activity_state == ActivityStateActive) {
    pause_activity();
  } else if (g_pacelet.activity_state == ActivityStatePaused) {
    resume_activity();
  } else if (g_pacelet.activity_state == ActivityStateHistoryList) {
    cycle_history_index(-1);
  } else if (g_pacelet.activity_state == ActivityStateHistoryDetail) {
    request_selected_history_export();
  } else if (g_pacelet.activity_state == ActivityStateRecovery) {
    request_recovery_resume();
  } else if (g_pacelet.activity_state == ActivityStateGps ||
             g_pacelet.activity_state == ActivityStateReady ||
             g_pacelet.activity_state == ActivityStateFinished) {
    request_gps();
  }
}

void activity_controller_handle_down(void) {
  if (g_pacelet.overlay == OverlayExit) { pacelet_set_overlay(OverlayNone); watch_ui_mark_dirty(); return; }
  if (saving_on_phone()) { vibes_short_pulse(); return; }
  if (g_pacelet.overlay == OverlayDiscard) {
    hide_discard_confirmation();
  } else if (g_pacelet.overlay == OverlayFinish) {
    hide_finish_confirmation();
  } else if (g_pacelet.activity_state == ActivityStateActive ||
             g_pacelet.activity_state == ActivityStatePaused) {
    hide_split_summary();
    g_pacelet.page = (g_pacelet.page + 1) % PageCount;
    g_pacelet.page_opened_at = time(NULL);
    if (g_pacelet.page == PageRoute) {
      g_pacelet.route_requested_at = watch_services_request_route() ?
          g_pacelet.page_opened_at : 0;
    }
    watch_ui_mark_dirty();
  } else if (g_pacelet.activity_state == ActivityStateFinished) {
    return_to_choose();
  } else if (g_pacelet.activity_state == ActivityStateChoose) {
    cycle_choose_index(1);
  } else if (g_pacelet.activity_state == ActivityStateHistoryList) {
    cycle_history_index(1);
  } else if (g_pacelet.activity_state == ActivityStateHistoryDetail) {
    pacelet_set_state(ActivityStateHistoryList);
    watch_ui_mark_dirty();
  } else if (g_pacelet.activity_state == ActivityStateRecovery) {
    show_discard_confirmation();
  } else {
    cycle_activity_type(1);
  }
}

void activity_controller_handle_tick(void) {
  g_pacelet.anim_tick++;
  update_hr(false);
  update_steps();
  expire_stale_hr();
  maybe_send_hr_clear();
  maybe_send_periodic_hr();
  pacelet_record_metrics(time(NULL));
  time_t now = time(NULL);
  if (g_pacelet.page && now - g_pacelet.page_opened_at >= 20) {
    g_pacelet.page = PageDashboard;
  }
  if (g_pacelet.page == PageRoute &&
      now - g_pacelet.route_requested_at >= 5 && watch_services_request_route()) {
    g_pacelet.route_requested_at = now;
  }
  BatteryChargeState battery = battery_state_service_peek();
  bool low_battery = battery.charge_percent <= 10 && !battery.is_charging;
  if (low_battery && !g_pacelet.low_battery &&
      (g_pacelet.activity_state == ActivityStateActive ||
       g_pacelet.activity_state == ActivityStatePaused)) {
    watch_services_save_activity_state();
    // The state request checkpoints the phone draft too; never auto-finish.
    watch_services_request_initial_state();
    vibes_double_pulse();
  }
  g_pacelet.low_battery = low_battery;
  if (g_pacelet.activity_state == ActivityStateActive) {
    int32_t elapsed_s = pacelet_elapsed_s();
    if (elapsed_s - s_last_persist_elapsed_s >=
        ACTIVITY_PERSIST_INTERVAL_S) {
      s_last_persist_elapsed_s = elapsed_s;
      watch_services_save_activity_state();
    }
  }
  watch_ui_mark_dirty();
}

void activity_controller_handle_health_event(HealthEventType event) {
  if (event == HealthEventHeartRateUpdate) {
    update_hr(true);
    maybe_send_hr_clear();
  } else if (event == HealthEventMovementUpdate ||
             event == HealthEventSignificantUpdate) {
    update_steps();
  }
  watch_ui_mark_dirty();
}

void activity_controller_handle_distance(int32_t distance_m) {
  g_pacelet.distance_m = distance_m;
  maybe_show_split_summary(distance_m);
}

void activity_controller_handle_phone_connection(bool connected) {
  g_pacelet.phone_connected = connected;
  if (!connected && g_pacelet.activity_state == ActivityStateRecovery) {
    snprintf(g_pacelet.recovery_message,
             sizeof(g_pacelet.recovery_message), "PHONE DISCONNECTED");
  }
  watch_ui_mark_dirty();
}

void activity_controller_handle_phone_activity_state(
    PhoneActivityState phone_state) {
  time_t now = time(NULL);
  ActivityState previous_state = g_pacelet.activity_state;

  if (phone_state == PhoneActivityStateActive &&
      g_pacelet.pending_command == MESSAGE_KEY_START_ACTIVITY &&
      g_pacelet.activity_id[0] &&
      (previous_state == ActivityStatePaused || previous_state == ActivityStateFinished ||
       g_pacelet.pause_windows_size > 0)) {
    g_pacelet.pending_command = 0;
    watch_services_send_command(previous_state == ActivityStatePaused ?
        MESSAGE_KEY_PAUSE_ACTIVITY : previous_state == ActivityStateFinished ?
        MESSAGE_KEY_FINISH_ACTIVITY : MESSAGE_KEY_RESUME_ACTIVITY);
    return;
  }

  // An older acknowledgement must not undo a newer local pause/resume/finish.
  if ((g_pacelet.pending_command == MESSAGE_KEY_PAUSE_ACTIVITY &&
       phone_state == PhoneActivityStateActive) ||
      (g_pacelet.pending_command == MESSAGE_KEY_RESUME_ACTIVITY &&
       phone_state == PhoneActivityStatePaused) ||
      ((g_pacelet.pending_command == MESSAGE_KEY_FINISH_ACTIVITY ||
        g_pacelet.pending_command == MESSAGE_KEY_DISCARD_ACTIVITY) &&
       (phone_state == PhoneActivityStateActive ||
        phone_state == PhoneActivityStatePaused))) {
    return;
  }

  if (phone_state == PhoneActivityStateNone &&
      g_pacelet.pending_command == MESSAGE_KEY_START_ACTIVITY) {
    if (strcmp(g_pacelet.recovery_message, "GPS LOST") == 0) {
      watch_services_clear_activity_state();
      request_gps();
    }
    return;
  }

  if (phone_state == PhoneActivityStateActive) {
    bool sync_recovered_pauses = previous_state == ActivityStateRecovery &&
        g_pacelet.pause_windows_size > 0;
    if (previous_state == ActivityStateRecovery && pause_is_open()) {
      write_pause_time(g_pacelet.pause_windows + g_pacelet.pause_windows_size - 6);
    }
    if (!sync_recovered_pauses) { acknowledge_pause_windows(); }
    if (previous_state == ActivityStateRecovery) {
      rebase_steps_after_recovery(false);
    }
    pacelet_set_state(ActivityStateActive);
    g_pacelet.started_at = now - g_pacelet.recovery_moving_s;
    g_pacelet.paused_at = 0;
    g_pacelet.total_paused_s = 0;
    g_pacelet.finished_elapsed_s = 0;
    g_pacelet.recovery_phone_draft_available = true;
    if (g_pacelet.overlay == OverlayDiscard) pacelet_set_overlay(OverlayNone);
    g_pacelet.recovery_message[0] = '\0';
    g_pacelet.pending_command = 0;
    s_last_persist_elapsed_s = g_pacelet.recovery_moving_s;
    set_activity_hr_sampling(true);
    update_hr(false);
    update_steps();
    watch_services_save_activity_state();
    if (sync_recovered_pauses) {
      watch_services_send_command(MESSAGE_KEY_RESUME_ACTIVITY);
    }
    return;
  }

  if (phone_state == PhoneActivityStatePaused) {
    acknowledge_pause_windows();
    if (previous_state == ActivityStateRecovery) {
      rebase_steps_after_recovery(true);
    }
    pacelet_set_state(ActivityStatePaused);
    g_pacelet.started_at = now - g_pacelet.recovery_moving_s;
    g_pacelet.paused_at = now;
    g_pacelet.total_paused_s = 0;
    g_pacelet.finished_elapsed_s = 0;
    g_pacelet.recovery_phone_draft_available = true;
    if (g_pacelet.overlay == OverlayDiscard) pacelet_set_overlay(OverlayNone);
    g_pacelet.recovery_message[0] = '\0';
    g_pacelet.pending_command = 0;
    set_activity_hr_sampling(true);
    update_hr(false);
    update_steps();
    watch_services_save_activity_state();
    return;
  }

  if (phone_state == PhoneActivityStateRecovery) {
    cancel_countdown();
    hide_split_summary();
    pacelet_set_state(ActivityStateRecovery);
    g_pacelet.finished_elapsed_s = g_pacelet.recovery_moving_s;
    g_pacelet.recovery_phone_draft_available = true;
    if (g_pacelet.overlay == OverlayFinish) pacelet_set_overlay(OverlayNone);
    if (g_pacelet.overlay == OverlayDiscard) pacelet_set_overlay(OverlayNone);
    if (g_pacelet.pending_command != MESSAGE_KEY_FINISH_ACTIVITY &&
        g_pacelet.pending_command != MESSAGE_KEY_DISCARD_ACTIVITY) {
      g_pacelet.pending_command = 0;
    } else if (strcmp(g_pacelet.recovery_message, "SAVE FAILED") == 0 ||
               strcmp(g_pacelet.recovery_message, "SESSION CHANGED") == 0 ||
               strcmp(g_pacelet.recovery_message, "DISCARD FAILED") == 0) {
      // The phone handled the destructive command but kept its draft. Stop
      // automatic retries and let the user explicitly choose the next action.
      g_pacelet.pending_command = 0;
    }
    set_activity_hr_sampling(false);
    watch_services_save_activity_state();
    return;
  }

  if (g_pacelet.pending_command == MESSAGE_KEY_FINISH_ACTIVITY &&
      strcmp(g_pacelet.recovery_message, "NO ACTIVE ACTIVITY") == 0) {
    pacelet_set_state(ActivityStateRecovery);
    g_pacelet.recovery_phone_draft_available = false;
    g_pacelet.pending_command = 0;
    set_activity_hr_sampling(false);
    watch_services_save_activity_state();
    return;
  }

  if (g_pacelet.pending_command == MESSAGE_KEY_DISCARD_ACTIVITY) {
    return_to_choose();
    return;
  }

  if (g_pacelet.pending_command == MESSAGE_KEY_FINISH_ACTIVITY ||
      g_pacelet.activity_state == ActivityStateFinished) {
    pacelet_set_state(ActivityStateFinished);
    g_pacelet.finished_elapsed_s =
        g_pacelet.summary_moving_s > 0 ?
            g_pacelet.summary_moving_s : g_pacelet.recovery_moving_s;
    g_pacelet.recovery_phone_draft_available = false;
    g_pacelet.pending_command = 0;
    watch_services_clear_activity_state();
    return;
  }

  if (g_pacelet.activity_state == ActivityStateActive ||
      g_pacelet.activity_state == ActivityStatePaused ||
      g_pacelet.activity_state == ActivityStateRecovery) {
    cancel_countdown();
    hide_split_summary();
    pacelet_set_state(ActivityStateRecovery);
    g_pacelet.recovery_phone_draft_available = false;
    g_pacelet.pending_command = 0;
    snprintf(g_pacelet.recovery_message,
             sizeof(g_pacelet.recovery_message), "PHONE DATA MISSING");
    set_activity_hr_sampling(false);
    watch_services_save_activity_state();
  }
}

void activity_controller_deinit(void) {
  cancel_countdown();
  hide_split_summary();
  set_activity_hr_sampling(false);
}

void activity_controller_handle_back(void) {
  if (g_pacelet.overlay == OverlayExit) {
    if (g_pacelet.overlay == OverlayExit) pacelet_set_overlay(OverlayNone);
  } else if (g_pacelet.overlay == OverlayFinish) {
    hide_finish_confirmation();
  } else if (g_pacelet.overlay == OverlayDiscard) {
    hide_discard_confirmation();
  } else if (g_pacelet.activity_state == ActivityStateActive) {
    pause_activity();
  } else if (g_pacelet.activity_state == ActivityStatePaused ||
             g_pacelet.activity_state == ActivityStateRecovery) {
    // A live or interrupted recording needs an explicit finish/discard action.
    vibes_short_pulse();
  } else if (g_pacelet.activity_state == ActivityStateCountdown) {
    cancel_countdown();
    pacelet_set_state(g_pacelet.gps_state == GpsStateLocked ?
        ActivityStateReady : ActivityStateGps);
  } else if (g_pacelet.activity_state == ActivityStateHistoryDetail) {
    pacelet_set_state(ActivityStateHistoryList);
  } else if (g_pacelet.activity_state == ActivityStateGps ||
             g_pacelet.activity_state == ActivityStateReady ||
             g_pacelet.activity_state == ActivityStateHistoryList) {
    return_to_choose();
  } else if (g_pacelet.upload_pending ||
             g_pacelet.pending_command == MESSAGE_KEY_FINISH_ACTIVITY) {
    pacelet_set_overlay(OverlayExit);
  } else {
    window_stack_pop_all(true);
  }
  watch_ui_mark_dirty();
}
