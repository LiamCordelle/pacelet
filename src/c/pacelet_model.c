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

PaceletModel g_pacelet;

void pacelet_model_init(void) {
  memset(&g_pacelet, 0, sizeof(g_pacelet));
  g_pacelet.activity_state = ActivityStateChoose;
  g_pacelet.gps_state = GpsStateIdle;
  g_pacelet.activity_type = ActivityTypeRunning;
  g_pacelet.gps_accuracy_m = -1;
  g_pacelet.last_hr_sent_elapsed_s = -1;
  g_pacelet.hr_zone_1_bpm = PACELET_DEFAULT_HR_ZONE_1_BPM;
  g_pacelet.hr_zone_2_bpm = PACELET_DEFAULT_HR_ZONE_2_BPM;
  g_pacelet.hr_zone_3_bpm = PACELET_DEFAULT_HR_ZONE_3_BPM;
  g_pacelet.next_split_km = 1;
}

void pacelet_model_reset_activity(bool preserve_hr) {
  g_pacelet.finish_confirm_visible = false;
  g_pacelet.started_at = 0;
  g_pacelet.paused_at = 0;
  g_pacelet.total_paused_s = 0;
  g_pacelet.finished_elapsed_s = 0;
  g_pacelet.last_hr_sent_elapsed_s = -1;
  if (!preserve_hr) {
    g_pacelet.last_hr_bpm = 0;
    g_pacelet.last_hr_update_at = 0;
    g_pacelet.hr_clear_sent = false;
  }
  g_pacelet.distance_m = 0;
  g_pacelet.current_pace_s_per_km = 0;
  g_pacelet.current_speed_centi_mps = 0;
  g_pacelet.summary_distance_m = 0;
  g_pacelet.summary_moving_s = 0;
  g_pacelet.summary_points = 0;
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
