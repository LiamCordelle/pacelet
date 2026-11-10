#pragma once

#include <pebble.h>

#define PACELET_GPS_LOCK_ACCURACY_M 25
#define PACELET_DEFAULT_HR_ZONE_1_BPM 100
#define PACELET_DEFAULT_HR_ZONE_2_BPM 130
#define PACELET_DEFAULT_HR_ZONE_3_BPM 160
#define PACELET_HISTORY_MAX 10
#define PACELET_ROUTE_BYTES 128
#define PACELET_ROUTE_WIDTH 150
#define PACELET_ROUTE_HEIGHT 124

typedef enum { PageDashboard, PageLaps, PageZones, PageHeart, PageRoute, PageCount } ActivityPage;

typedef enum {
  ActivityStateChoose = 0,
  ActivityStateGps = 1,
  ActivityStateReady = 2,
  ActivityStateCountdown = 3,
  ActivityStateActive = 4,
  ActivityStatePaused = 5,
  ActivityStateFinished = 6,
  ActivityStateHistoryList = 7,
  ActivityStateHistoryDetail = 8,
  ActivityStateRecovery = 9
} ActivityState;

typedef enum {
  PhoneActivityStateNone = 0,
  PhoneActivityStateActive = 1,
  PhoneActivityStatePaused = 2,
  PhoneActivityStateRecovery = 3
} PhoneActivityState;

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
  HistoryStravaSkipped = 6,
  HistoryStravaUnconfirmed = 7
} HistoryStravaStatus;

typedef enum { OverlayNone, OverlaySplit, OverlayFinish, OverlayDiscard, OverlayExit } PaceletOverlay;
typedef enum { MotionFull, MotionKeyMoments, MotionOff } MotionMode;
#define PACELET_RECENT_SPLITS 8

typedef struct {
  ActivityType activity_type;
  int32_t distance_m;
  int32_t moving_s;
  HistoryStravaStatus strava_status;
  uint16_t avg_hr;
  int32_t zone_s[4];
} HistoryItem;

typedef struct {
  bool dark_mode; // Legacy storage/protocol slot, ignored by Paceboard.
  MotionMode motion_mode;
  PaceletOverlay overlay;
  bool back_pause_armed;
  ActivityPage page;
  time_t page_opened_at;
  int32_t recent_splits[PACELET_RECENT_SPLITS]; // Newest first, seconds per km.
  int32_t previous_split_s;
  int32_t best_split_s;
  int32_t zone_s[4];
  uint32_t hr_sum, hr_count;
  uint16_t summary_avg_hr;
  uint8_t hr_history[60]; // Timestamp-indexed rolling minute; zero means no sample.
  time_t metrics_at;
  bool metrics_was_active;
  int8_t metrics_zone;
  int32_t zone_stint_s;
  int8_t display_zone;
  int8_t zone_candidate;
  uint8_t zone_candidate_ticks;

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
  int32_t last_steps_today;
  int32_t pause_start_steps_today;
  int32_t total_paused_steps;
  int32_t finished_elapsed_s;

  int32_t distance_m;
  int32_t current_pace_s_per_km;
  int32_t current_speed_centi_mps;
  int32_t paused_pace_s_per_km;
  int32_t paused_speed_centi_mps;
  int32_t current_steps;
  bool current_steps_available;
  int32_t gps_accuracy_m;
  int32_t gps_request_id;

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

  bool phone_connected;
  bool upload_pending;
  HistoryStravaStatus finished_strava_status;
  char finished_activity_id[24];
  uint8_t route_points[PACELET_ROUTE_BYTES];
  uint8_t route_size;
  bool route_received;
  time_t route_requested_at;
  bool low_battery;
  uint8_t hr_batch[50];
  uint8_t hr_batch_size;
  time_t hr_batch_sampled_at;
  // Five unacknowledged pause intervals: uint48 UTC milliseconds per endpoint.
  uint8_t pause_windows[60];
  uint8_t pause_windows_size;
  bool recovery_phone_draft_available;
  int32_t recovery_moving_s;
  int32_t activity_checkpointed_at;
  uint32_t pending_command;
  char activity_id[24];
  char recovery_message[32];

  char gps_error[32];
} PaceletModel;

extern PaceletModel g_pacelet;
