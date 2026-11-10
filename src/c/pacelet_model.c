#include "pacelet_model.h"

#include <string.h>

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

static const char *HISTORY_STATUS_LABELS[] = {
  "UNKNOWN",
  "NOT SENT",
  "UPLOADING",
  "PROCESSING",
  "UPLOADED",
  "FAILED",
  "SKIPPED",
  "UNCONFIRMED"
};

PaceletModel g_pacelet;

void pacelet_model_init(void) {
  memset(&g_pacelet, 0, sizeof(g_pacelet));
  g_pacelet.activity_state = ActivityStateChoose;
  g_pacelet.gps_state = GpsStateIdle;
  g_pacelet.activity_type = ActivityTypeRunning;
  g_pacelet.choose_index = ActivityTypeRunning;
  g_pacelet.gps_accuracy_m = -1;
  g_pacelet.last_hr_sent_elapsed_s = -1;
  g_pacelet.hr_batch_size = 0;
  g_pacelet.hr_batch_sampled_at = 0;
  g_pacelet.pause_windows_size = 0;
  g_pacelet.hr_zone_1_bpm = PACELET_DEFAULT_HR_ZONE_1_BPM;
  g_pacelet.hr_zone_2_bpm = PACELET_DEFAULT_HR_ZONE_2_BPM;
  g_pacelet.hr_zone_3_bpm = PACELET_DEFAULT_HR_ZONE_3_BPM;
  g_pacelet.history_selected_index = 0;
  g_pacelet.recovery_phone_draft_available = false;
  for (int i = 0; i < PACELET_HISTORY_MAX; i++) {
    g_pacelet.history_items[i].activity_type = ActivityTypeRunning;
    g_pacelet.history_items[i].strava_status = HistoryStravaUnknown;
  }
  g_pacelet.next_split_km = 1;
  g_pacelet.display_zone = -1;
  g_pacelet.zone_candidate = -1;
}

void pacelet_model_reset_activity(bool preserve_hr) {
  g_pacelet.page = 0;
  g_pacelet.overlay = OverlayNone;
  memset(g_pacelet.recent_splits, 0, sizeof(g_pacelet.recent_splits));
  memset(g_pacelet.zone_s, 0, sizeof(g_pacelet.zone_s));
  memset(g_pacelet.hr_history, 0, sizeof(g_pacelet.hr_history));
  g_pacelet.previous_split_s = g_pacelet.best_split_s = 0;
  g_pacelet.hr_sum = g_pacelet.hr_count = g_pacelet.summary_avg_hr = 0;
  g_pacelet.metrics_at = 0;
  g_pacelet.metrics_was_active = false;
  g_pacelet.metrics_zone = -1;
  g_pacelet.display_zone = g_pacelet.zone_candidate = -1;
  g_pacelet.zone_candidate_ticks = 0;
  g_pacelet.zone_stint_s = 0;
  g_pacelet.pause_windows_size = 0;
  g_pacelet.low_battery = false;
  g_pacelet.started_at = 0;
  g_pacelet.paused_at = 0;
  g_pacelet.total_paused_s = 0;
  g_pacelet.activity_start_steps_today = -1;
  g_pacelet.pause_start_steps_today = -1;
  g_pacelet.total_paused_steps = 0;
  g_pacelet.finished_elapsed_s = 0;
  g_pacelet.last_hr_sent_elapsed_s = -1;
  g_pacelet.hr_batch_size = 0;
  g_pacelet.hr_batch_sampled_at = 0;
  if (!preserve_hr) {
    g_pacelet.last_hr_bpm = 0;
    g_pacelet.last_hr_update_at = 0;
    g_pacelet.hr_clear_sent = false;
  }
  g_pacelet.distance_m = 0;
  g_pacelet.current_pace_s_per_km = 0;
  g_pacelet.current_speed_centi_mps = 0;
  g_pacelet.paused_pace_s_per_km = 0;
  g_pacelet.paused_speed_centi_mps = 0;
  g_pacelet.current_steps = 0;
  g_pacelet.current_steps_available = false;
  g_pacelet.summary_distance_m = 0;
  g_pacelet.summary_moving_s = 0;
  g_pacelet.summary_points = 0;
  g_pacelet.finished_activity_id[0] = '\0';
  g_pacelet.finished_strava_status = HistoryStravaUnknown;
  g_pacelet.route_size = 0;
  g_pacelet.route_received = false;
  g_pacelet.recovery_moving_s = 0;
  g_pacelet.activity_checkpointed_at = 0;
  g_pacelet.pending_command = 0;
  g_pacelet.activity_id[0] = '\0';
  g_pacelet.recovery_message[0] = '\0';
  g_pacelet.recovery_phone_draft_available = false;
  g_pacelet.next_split_km = 1;
  g_pacelet.last_split_elapsed_s = 0;
  g_pacelet.split_elapsed_s = 0;
  g_pacelet.split_number = 0;
}

int32_t pacelet_clamp_i32(int32_t value, int32_t min_value,
                          int32_t max_value) {
  if (value < min_value) {
    return min_value;
  }
  if (value > max_value) {
    return max_value;
  }
  return value;
}

int32_t pacelet_elapsed_s(void) {
  if (g_pacelet.activity_state == ActivityStateFinished) {
    return g_pacelet.finished_elapsed_s;
  }
  if (g_pacelet.activity_state == ActivityStateRecovery) {
    return g_pacelet.recovery_moving_s;
  }
  if (g_pacelet.activity_state != ActivityStateActive &&
      g_pacelet.activity_state != ActivityStatePaused) {
    return 0;
  }

  time_t now = time(NULL);
  if (g_pacelet.activity_state == ActivityStatePaused) {
    now = g_pacelet.paused_at;
  }

  int32_t elapsed =
      (int32_t)(now - g_pacelet.started_at) - g_pacelet.total_paused_s;
  return elapsed < 0 ? 0 : elapsed;
}

bool pacelet_activity_uses_speed(void) {
  return g_pacelet.activity_type == ActivityTypeCycling;
}

void pacelet_normalize_hr_zone_thresholds(void) {
  g_pacelet.hr_zone_1_bpm =
      pacelet_clamp_i32(g_pacelet.hr_zone_1_bpm, 40, 220);
  g_pacelet.hr_zone_2_bpm = pacelet_clamp_i32(
      g_pacelet.hr_zone_2_bpm, g_pacelet.hr_zone_1_bpm + 1, 230);
  g_pacelet.hr_zone_3_bpm = pacelet_clamp_i32(
      g_pacelet.hr_zone_3_bpm, g_pacelet.hr_zone_2_bpm + 1, 240);
}

HrZone pacelet_hr_zone_for_bpm(int32_t bpm) {
  if (bpm < g_pacelet.hr_zone_1_bpm) {
    return HrZoneBelow;
  }
  if (bpm < g_pacelet.hr_zone_2_bpm) {
    return HrZoneOne;
  }
  if (bpm < g_pacelet.hr_zone_3_bpm) {
    return HrZoneTwo;
  }
  return HrZoneThree;
}

const char *pacelet_hr_zone_label(HrZone zone) {
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

const char *pacelet_activity_label(ActivityType type) {
  return ACTIVITY_LABELS[pacelet_clamp_i32(type, ActivityTypeWalking,
                                           ActivityTypeCycling)];
}

const char *pacelet_activity_short_label(ActivityType type) {
  return ACTIVITY_SHORT_LABELS[pacelet_clamp_i32(
      type, ActivityTypeWalking, ActivityTypeCycling)];
}

const char *pacelet_history_status_label(HistoryStravaStatus status) {
  return HISTORY_STATUS_LABELS[pacelet_clamp_i32(
      status, HistoryStravaUnknown, HistoryStravaUnconfirmed)];
}

void pacelet_set_state(ActivityState state) {
  if (g_pacelet.activity_state == state) return;
  g_pacelet.activity_state = state;
  g_pacelet.page = 0;
  g_pacelet.overlay = OverlayNone;
  g_pacelet.metrics_was_active = false;
}

void pacelet_set_overlay(PaceletOverlay overlay) {
  g_pacelet.overlay = overlay;
  if (overlay != OverlayNone) g_pacelet.page = 0;
}

void pacelet_record_metrics(time_t now) {
  if (g_pacelet.metrics_at == now) return;
  time_t previous = g_pacelet.metrics_at;
  g_pacelet.metrics_at = now;
  // Clear missed seconds too, so stale columns cannot look like fresh data.
  int gap = previous > 0 && now > previous ? now - previous : 60;
  if (gap > 60) gap = 60;
  for (int i = 0; i < gap; i++) g_pacelet.hr_history[(now - i) % 60] = 0;
  if (g_pacelet.activity_state != ActivityStateActive) {
    g_pacelet.metrics_was_active = false;
    g_pacelet.zone_stint_s = 0;
    return;
  }
  int bpm = g_pacelet.last_hr_bpm;
  if (bpm <= 0 || bpm > 250 || now - g_pacelet.last_hr_update_at >= 60) {
    g_pacelet.metrics_was_active = false;
    g_pacelet.zone_stint_s = 0;
    return;
  }
  int zone = pacelet_hr_zone_for_bpm(bpm);
  // Totals use exact thresholds; visual colour changes wait for three ticks.
  if (g_pacelet.display_zone < 0) g_pacelet.display_zone = zone;
  if (zone != g_pacelet.display_zone) {
    if (zone != g_pacelet.zone_candidate) {
      g_pacelet.zone_candidate = zone;
      g_pacelet.zone_candidate_ticks = 0;
    }
    if (++g_pacelet.zone_candidate_ticks >= 3) {
      g_pacelet.display_zone = zone;
      g_pacelet.zone_candidate_ticks = 0;
    }
  } else { g_pacelet.zone_candidate = zone; g_pacelet.zone_candidate_ticks = 0; }
  g_pacelet.hr_history[now % 60] = bpm;
  if (zone != g_pacelet.metrics_zone) g_pacelet.zone_stint_s = 0;
  g_pacelet.metrics_zone = zone;
  if (g_pacelet.metrics_was_active && previous > 0 && now - previous == 1) {
    g_pacelet.zone_s[zone]++;
    g_pacelet.hr_sum += bpm;
    g_pacelet.hr_count++;
    g_pacelet.zone_stint_s++;
  }
  g_pacelet.metrics_was_active = true;
}
