#pragma once

#include <pebble.h>

#define PACELET_GPS_LOCK_ACCURACY_M 25
#define PACELET_DEFAULT_HR_ZONE_1_BPM 100
#define PACELET_DEFAULT_HR_ZONE_2_BPM 130
#define PACELET_DEFAULT_HR_ZONE_3_BPM 160
#define PACELET_HISTORY_MAX 10

typedef enum {
  ActivityStateChoose = 0,
  ActivityStateGps = 1,
  ActivityStateReady = 2,
  ActivityStateCountdown = 3,
  ActivityStateActive = 4,
  ActivityStatePaused = 5,
  ActivityStateFinished = 6,
  ActivityStateHistoryList = 7,
  ActivityStateHistoryDetail = 8
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
  HrZoneBelow = 0,
  HrZoneOne = 1,
  HrZoneTwo = 2,
  HrZoneThree = 3
} HrZone;

typedef enum {
  HistoryStravaUnknown = 0,
  HistoryStravaNotUploaded = 1,
  HistoryStravaUploading = 2,
  HistoryStravaProcessing = 3,
  HistoryStravaUploaded = 4,
  HistoryStravaFailed = 5,
  HistoryStravaSkipped = 6
} HistoryStravaStatus;

typedef struct {
  ActivityType activity_type;
  int32_t distance_m;
  int32_t moving_s;
  HistoryStravaStatus strava_status;
} HistoryItem;

typedef struct {
  bool dark_mode;

  ActivityState activity_state;
  GpsState gps_state;
  ActivityType activity_type;
  int32_t choose_index;
  int countdown_value;
  int anim_tick;

  time_t started_at;
  time_t paused_at;
  int32_t total_paused_s;
  int32_t activity_start_steps_today;
  int32_t pause_start_steps_today;
  int32_t total_paused_steps;
  int32_t finished_elapsed_s;

  int32_t distance_m;
  int32_t current_pace_s_per_km;
  int32_t current_speed_centi_mps;
  int32_t current_steps;
  bool current_steps_available;
  int32_t gps_accuracy_m;

  int32_t last_hr_bpm;
  int32_t last_hr_sent_elapsed_s;
  time_t last_hr_update_at;
  bool hr_clear_sent;
  int32_t hr_zone_1_bpm;
  int32_t hr_zone_2_bpm;
  int32_t hr_zone_3_bpm;

  int32_t summary_distance_m;
  int32_t summary_moving_s;
  int32_t summary_points;

  bool history_loading;
  int32_t history_count;
  int32_t history_selected_index;
  HistoryItem history_items[PACELET_HISTORY_MAX];
  char history_message[64];

  int32_t next_split_km;
  int32_t last_split_elapsed_s;
  int32_t split_elapsed_s;
  int32_t split_number;
  bool split_visible;
  bool finish_confirm_visible;

  char gps_error[32];
} PaceletModel;

extern PaceletModel g_pacelet;
