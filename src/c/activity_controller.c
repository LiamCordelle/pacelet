#include "activity_controller.h"

#include "pacelet_model.h"
#include "watch_services.h"
#include "watch_ui.h"

#define HR_SAMPLE_PERIOD_S 1
#define HR_SEND_INTERVAL_S 1
#define HR_READING_STALE_S 60
#define SPLIT_DISTANCE_M 1000
#define SPLIT_SUMMARY_MS 6000

static AppTimer *s_countdown_timer;
static AppTimer *s_split_timer;
static bool s_hr_sample_period_requested;

static void update_hr(bool fresh_event);

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
  if (g_pacelet.activity_state != ActivityStateActive ||
      g_pacelet.last_hr_bpm <= 0) {
    return;
  }

  int32_t current_elapsed_s = pacelet_elapsed_s();
  if (current_elapsed_s <= 0 ||
      current_elapsed_s == g_pacelet.last_hr_sent_elapsed_s) {
    return;
  }

  if (watch_services_send_hr_bpm(g_pacelet.last_hr_bpm)) {
    g_pacelet.last_hr_sent_elapsed_s = current_elapsed_s;
  }
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
  g_pacelet.split_visible = false;
}

static void split_timer_callback(void *data) {
  s_split_timer = NULL;
  g_pacelet.split_visible = false;
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
  g_pacelet.last_split_elapsed_s = current_elapsed_s;
  g_pacelet.next_split_km = completed_km + 1;

  hide_split_summary();
  g_pacelet.split_visible = true;
  vibes_double_pulse();
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
  g_pacelet.activity_state = ActivityStateGps;
  g_pacelet.gps_state = GpsStateSearching;
  g_pacelet.gps_accuracy_m = -1;
  g_pacelet.gps_error[0] = '\0';
  watch_services_send_command(MESSAGE_KEY_REQUEST_GPS);
  watch_ui_mark_dirty();
}

static void return_to_choose(void) {
  cancel_countdown();
  set_activity_hr_sampling(false);
  reset_activity_metrics(false);
  g_pacelet.activity_state = ActivityStateChoose;
  g_pacelet.gps_state = GpsStateIdle;
  g_pacelet.gps_accuracy_m = -1;
  g_pacelet.gps_error[0] = '\0';
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
  g_pacelet.activity_state = ActivityStateActive;
  set_activity_hr_sampling(true);
  update_hr(false);
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
  g_pacelet.activity_state = ActivityStateCountdown;
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

  hide_split_summary();
  g_pacelet.finish_confirm_visible = false;
  g_pacelet.paused_at = time(NULL);
  g_pacelet.activity_state = ActivityStatePaused;
  watch_services_send_command(MESSAGE_KEY_PAUSE_ACTIVITY);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void resume_activity(void) {
  if (g_pacelet.activity_state != ActivityStatePaused ||
      g_pacelet.finish_confirm_visible) {
    return;
  }

  g_pacelet.total_paused_s +=
      (int32_t)(time(NULL) - g_pacelet.paused_at);
  g_pacelet.paused_at = 0;
  g_pacelet.activity_state = ActivityStateActive;
  set_activity_hr_sampling(true);
  update_hr(false);
  watch_services_send_command(MESSAGE_KEY_RESUME_ACTIVITY);
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void show_finish_confirmation(void) {
  if (g_pacelet.activity_state != ActivityStatePaused ||
      g_pacelet.finish_confirm_visible) {
    return;
  }

  g_pacelet.finish_confirm_visible = true;
  vibes_short_pulse();
  watch_ui_mark_dirty();
}

static void hide_finish_confirmation(void) {
  if (!g_pacelet.finish_confirm_visible) {
    return;
  }

  g_pacelet.finish_confirm_visible = false;
  watch_ui_mark_dirty();
}

static void finish_activity(void) {
  if (g_pacelet.activity_state != ActivityStatePaused ||
      !g_pacelet.finish_confirm_visible) {
    return;
  }

  hide_split_summary();
  g_pacelet.finish_confirm_visible = false;
  g_pacelet.finished_elapsed_s = pacelet_elapsed_s();
  send_hr_sample();
  set_activity_hr_sampling(false);
  g_pacelet.activity_state = ActivityStateFinished;
  watch_services_send_command(MESSAGE_KEY_FINISH_ACTIVITY);
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
  int32_t current_elapsed_s = pacelet_elapsed_s();
  if (current_elapsed_s > 0 &&
      current_elapsed_s % HR_SEND_INTERVAL_S == 0) {
    send_hr_sample();
  }
}

void activity_controller_handle_select(void) {
  if (g_pacelet.finish_confirm_visible) {
    return;
  }

  switch (g_pacelet.activity_state) {
    case ActivityStateChoose:
      request_gps();
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
    case ActivityStateCountdown:
    case ActivityStateActive:
    case ActivityStateFinished:
    default:
      break;
  }
}

void activity_controller_handle_up(void) {
  if (g_pacelet.finish_confirm_visible) {
    finish_activity();
  } else if (g_pacelet.activity_state == ActivityStateChoose) {
    cycle_activity_type(-1);
  } else if (g_pacelet.activity_state == ActivityStateActive) {
    pause_activity();
  } else if (g_pacelet.activity_state == ActivityStatePaused) {
    resume_activity();
  } else if (g_pacelet.activity_state == ActivityStateGps ||
             g_pacelet.activity_state == ActivityStateReady ||
             g_pacelet.activity_state == ActivityStateFinished) {
    request_gps();
  }
}

void activity_controller_handle_down(void) {
  if (g_pacelet.finish_confirm_visible) {
    hide_finish_confirmation();
  } else if (g_pacelet.activity_state == ActivityStateFinished) {
    return_to_choose();
  } else {
    cycle_activity_type(1);
  }
}

void activity_controller_handle_tick(void) {
  g_pacelet.anim_tick++;
  update_hr(false);
  expire_stale_hr();
  maybe_send_hr_clear();
  maybe_send_periodic_hr();
  watch_ui_mark_dirty();
}

void activity_controller_handle_health_event(HealthEventType event) {
  if (event == HealthEventHeartRateUpdate) {
    update_hr(true);
    maybe_send_hr_clear();
    send_hr_sample();
  }
  watch_ui_mark_dirty();
}

void activity_controller_handle_distance(int32_t distance_m) {
  g_pacelet.distance_m = distance_m;
  maybe_show_split_summary(distance_m);
}

void activity_controller_deinit(void) {
  cancel_countdown();
  hide_split_summary();
  set_activity_hr_sampling(false);
}
