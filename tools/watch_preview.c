// Native visual fixtures for the shipping renderer. Never linked into the PBW.
#include "lab.h"
#include <assert.h>
#define time_ms preview_time_ms
uint16_t preview_time_ms(time_t*,uint16_t*);
#include "pacelet_model.c"
#include "watch_ui.c"
static uint32_t preview_ms;
uint16_t time_ms(time_t *seconds,uint16_t *ms) {
  if(seconds)*seconds=1800000000+preview_ms/1000;
  if(ms)*ms=preview_ms%1000;
  return preview_ms%1000;
}
bool clock_is_24h_style(void){return true;}
static int timer_started, timer_cancelled;
static uint8_t timer_storage;
AppTimer *app_timer_register(uint32_t ms,AppTimerCallback callback,void *data){timer_started++;return (AppTimer*)&timer_storage;}
void app_timer_cancel(AppTimer*t){timer_cancelled++;}
void layer_mark_dirty(Layer*l){}
void layer_destroy(Layer*l){}
static void verify_motion_lifecycle(void) {
  memset(&s_ui,0,sizeof(s_ui));s_ui.focused=true;s_ui.loaded=true;
  s_ui.view.model.motion_mode=MotionFull;
  begin_motion(FxOrbit,15000);assert(s_ui.timer);assert(timer_started==1);
  watch_ui_set_focus(false);assert(!s_ui.timer);assert(s_ui.effect==FxNone);assert(timer_cancelled==1);
  s_ui.focused=true;s_ui.view.model.motion_mode=MotionKeyMoments;
  begin_motion(FxOrbit,15000);assert(!s_ui.timer);
  begin_motion(FxLock,480);assert(s_ui.timer);
  s_ui.view.model.motion_mode=MotionOff;begin_motion(FxCount,280);assert(!s_ui.timer);
  s_ui.view.model.motion_mode=MotionFull;s_ui.view.model.low_battery=true;
  begin_motion(FxHr,120);assert(!s_ui.timer);
  s_ui.view.model.low_battery=false;begin_motion(FxPause,200);preview_ms=500;frame(NULL);assert(!s_ui.timer);assert(s_ui.effect==FxNone);
  pacelet_model_init();s_ui.view.model.motion_mode=MotionFull;
  begin_motion(FxOrbit,15000);g_pacelet.motion_mode=MotionOff;watch_ui_mark_dirty();assert(!s_ui.timer);
  s_ui.view.model.motion_mode=MotionFull;s_ui.view.model.low_battery=false;
  begin_motion(FxHr,120);g_pacelet.motion_mode=MotionFull;g_pacelet.low_battery=true;watch_ui_mark_dirty();assert(!s_ui.timer);
  s_ui.view.model.low_battery=false;s_ui.view.model.motion_mode=MotionFull;
  g_pacelet.low_battery=false;g_pacelet.activity_state=ActivityStateGps;g_pacelet.gps_state=GpsStateSearching;
  s_ui.view.scene=SceneGps;s_ui.view.model.activity_state=ActivityStateGps;s_ui.view.model.gps_state=GpsStateError;
  watch_ui_mark_dirty();assert(s_ui.effect==FxOrbit);assert(s_ui.timer);
  begin_motion(FxSave,760);watch_ui_unload();assert(!s_ui.timer);assert(!s_ui.loaded);
  timer_started=timer_cancelled=0;preview_ms=0;
}
void lab_data_refresh(LabData*d){verify_motion_lifecycle();}
void lab_release_shared(void){}
static void fixture(int index,GContext*c,int effect,int progress) {
  pacelet_model_init();
  PaceletModel*m=&g_pacelet;
  m->activity_state=ActivityStateActive;m->phone_connected=true;
  m->gps_state=GpsStateLocked;m->gps_accuracy_m=8;
  m->distance_m=4620;m->current_pace_s_per_km=302;
  m->current_speed_centi_mps=989;m->current_steps=2841;m->current_steps_available=true;
  m->last_hr_bpm=152;m->display_zone=2;
  m->last_split_elapsed_s=1208;m->split_elapsed_s=307;m->split_number=4;
  m->recent_splits[0]=307;m->recent_splits[1]=316;m->recent_splits[2]=299;m->recent_splits[3]=286;
  m->previous_split_s=316;m->best_split_s=286;
  m->zone_s[0]=34;m->zone_s[1]=252;m->zone_s[2]=981;m->zone_s[3]=127;
  m->zone_stint_s=127;m->summary_avg_hr=146;
  for(int i=0;i<60;i++)m->hr_history[i]=112+i*2/3+(i%11<5?-3:4);
  memset(&s_ui,0,sizeof(s_ui));s_ui.progress=progress;s_ui.effect=effect;
  WatchView*v=&s_ui.view;v->now=1800000300;v->elapsed=1394;
  switch(index) {
    case 0:m->activity_state=ActivityStateChoose;break;
    case 1:m->activity_state=ActivityStateGps;m->gps_state=GpsStateSearching;m->gps_accuracy_m=58;break;
    case 2:m->activity_state=ActivityStateReady;break;
    case 3:m->activity_state=ActivityStateGps;m->gps_state=GpsStateError;strcpy(m->gps_error,"Location unavailable");break;
    case 4:m->activity_state=ActivityStateCountdown;m->countdown_value=3;break;
    case 5:break;
    case 6:m->activity_type=ActivityTypeWalking;v->elapsed=1458;m->distance_m=2120;m->recent_splits[0]=694;m->last_hr_bpm=122;m->display_zone=1;break;
    case 7:m->activity_type=ActivityTypeCycling;v->elapsed=1896;m->distance_m=18740;m->recent_splits[0]=101;break;
    case 8:m->overlay=OverlaySplit;m->split_number=5;m->split_elapsed_s=298;m->previous_split_s=307;break;
    case 9:m->page=1;break;
    case 10:m->page=2;break;
    case 11:m->page=3;break;
    case 12:m->activity_state=ActivityStatePaused;m->paused_at=v->now-68;break;
    case 13:m->activity_state=ActivityStatePaused;m->overlay=OverlayFinish;break;
    case 14:m->activity_state=ActivityStateFinished;m->summary_distance_m=4620;m->summary_moving_s=1394;break;
    case 15:m->activity_state=ActivityStateFinished;m->upload_pending=true;m->finished_strava_status=HistoryStravaUploading;break;
    case 16:m->activity_state=ActivityStateFinished;m->upload_pending=true;m->overlay=OverlayExit;break;
    case 17:m->activity_state=ActivityStateHistoryList;m->history_count=3;break;
    case 18:m->activity_state=ActivityStateHistoryDetail;m->history_count=3;break;
    case 19:m->activity_state=ActivityStateRecovery;m->recovery_moving_s=1394;m->recovery_phone_draft_available=true;strcpy(m->recovery_message,"Choose how to continue");break;
    case 20:m->activity_state=ActivityStateRecovery;m->overlay=OverlayDiscard;break;
    case 21:m->last_hr_bpm=0;break;
    case 22:m->phone_connected=false;break;
    case 23:v->elapsed=46799;m->current_pace_s_per_km=5999;m->distance_m=128740;m->recent_splits[0]=3599;m->previous_split_s=2845;m->last_hr_bpm=188;m->display_zone=3;break;
    case 24:memset(m->recent_splits,0,sizeof(m->recent_splits));m->previous_split_s=0;m->last_split_elapsed_s=0;m->split_number=0;break;
    case 25:m->low_battery=true;break;
    case 27: {
      static const uint8_t route[] = {22, 212, 19, 51, 35, 22, 70, 12,
        105, 25, 127, 53, 130, 87, 110, 110, 77, 113, 58, 94, 67, 70,
        81, 183, 108, 59, 118, 77};
      m->page = PageRoute;
      m->route_size = sizeof(route);
      memcpy(m->route_points, route, sizeof(route));
      break;
    }
    case 28:
      m->activity_state = ActivityStateFinished;
      m->finished_strava_status = HistoryStravaFailed;
      break;
    case 29:
      m->activity_state = ActivityStateFinished;
      m->finished_strava_status = HistoryStravaUnconfirmed;
      break;
    case 30:
      m->activity_state = ActivityStateChoose;
      s_ui.button_guide_timer = (AppTimer *)&timer_storage;
      break;
    case 31:
      m->activity_state = ActivityStateHistoryDetail;
      m->history_count = 3;
      s_ui.button_guide_timer = (AppTimer *)&timer_storage;
      break;
    case 32:
      m->back_pause_armed = true;
      break;
    case 33:
      s_ui.button_guide_timer = (AppTimer *)&timer_storage;
      break;
    case 26:m->activity_state=ActivityStatePaused;m->paused_at=v->now-68;strcpy(m->recovery_message,"SYNC PHONE TO RESUME");break;
  }
  for(int i=0;i<3;i++){HistoryItem*item=&m->history_items[i];item->activity_type=(i+1)%3;item->distance_m=i==0?4620:i==1?18740:2120;item->moving_s=i==0?1394:i==1?1896:1458;item->avg_hr=146;memcpy(item->zone_s,m->zone_s,sizeof(item->zone_s));item->strava_status=i==0?HistoryStravaUploaded:i==1?HistoryStravaFailed:HistoryStravaProcessing;}
  strcpy(m->history_message,"Strava uploaded");
  v->model=*m;v->scene=scene_for(m);s_ui.from=*v;
  s_ui.radius_from=38;s_ui.radius_to=38;s_ui.gps_began=0;s_ui.picker_from_y=37;
  s_ui.from.model.choose_index=0;
  s_ui.from.model.page=0;s_ui.from.scene=SceneLive;
  s_ui.from.model.overlay=OverlaySplit;
  s_ui.from.model.display_zone=1;
  preview_ms=effect==FxOrbit?progress*3400/1000:0;
  pb_dy=0;render_content(c,0);render_overlay(c,0);draw_header(NULL,c);draw_rail(NULL,c);
}
#define WATCH_FRAME(name,index,effect,progress) static void draw_##name(GContext*c,GRect b,const LabData*d){fixture(index,c,effect,progress);} const LabDesign name={#name,NULL,NULL,draw_##name};
#include "watch_frames.h"
