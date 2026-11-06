#include <assert.h>
#include <string.h>
#include "../src/c/pacelet_model.c"
#include "../src/c/activity_controller.c"

static time_t clock_s = 1800000000;
static int steps_today, bpm = 140, exits, lights, hr_sends;
static uint32_t last_command;
static int state_requests;
static BatteryChargeState battery = {100, false};
BatteryChargeState battery_state_service_peek(void){return battery;}
static AppTimer timer;
time_t test_time(time_t *out) { if(out)*out=clock_s;return clock_s; }
uint16_t time_ms(time_t *s,uint16_t *ms){*s=clock_s;*ms=123;return 123;}
AppTimer *app_timer_register(uint32_t delay, void (*cb)(void *), void *data) { timer=(AppTimer){cb,data};return &timer; }
void app_timer_cancel(AppTimer *t) {}
HealthServiceAccessibilityMask health_service_metric_accessible(int m,time_t a,time_t b){return 1;}
HealthServiceAccessibilityMask health_service_metric_aggregate_averaged_accessible(int m,time_t a,time_t b,int c,int d){return 1;}
HealthValue health_service_sum_today(int m){return steps_today;}
HealthValue health_service_peek_current_value(int m){return bpm;}
bool health_service_set_heart_rate_sample_period(int p){return true;}
void vibes_short_pulse(void){} void vibes_long_pulse(void){} void vibes_double_pulse(void){}
void vibes_enqueue_custom_pattern(VibePattern p){assert(p.num_segments==3);}
void light_enable_interaction(void){lights++;}
void window_stack_pop_all(bool a){exits++;}
void watch_ui_mark_dirty(void){} void watch_ui_apply_theme(void){}
void watch_services_clear_activity_state(void){g_pacelet.pending_command=0;g_pacelet.activity_id[0]=0;}
void watch_services_save_activity_state(void){}
void watch_services_send_command(uint32_t command){last_command=command;g_pacelet.pending_command=command;}
void watch_services_request_history(void){}
void watch_services_request_initial_state(void){state_requests++;}
void watch_services_send_history_action(uint32_t command,int32_t index){}
bool watch_services_send_hr_bpm(int32_t value){return true;}
bool watch_services_send_hr_batch(void){if(g_pacelet.hr_batch_size){hr_sends++;g_pacelet.hr_batch_size=0;}return true;}

static void fresh_activity(void){
 activity_controller_deinit();pacelet_model_init();steps_today=10000;
 g_pacelet.gps_state=GpsStateLocked;start_activity_recording();
 g_pacelet.pending_command=0;snprintf(g_pacelet.activity_id,sizeof(g_pacelet.activity_id),"test-id");
}
int main(void){
 fresh_activity();g_pacelet.pending_command=MESSAGE_KEY_START_ACTIVITY;
 snprintf(g_pacelet.recovery_message,sizeof(g_pacelet.recovery_message),"GPS LOST");
 activity_controller_handle_phone_activity_state(PhoneActivityStateNone);
 assert(g_pacelet.activity_state==ActivityStateGps);assert(g_pacelet.activity_id[0]==0);
 puts("ok - rejected start returns to GPS instead of recording a ghost activity");
 fresh_activity();clock_s+=10;activity_controller_handle_back();assert(g_pacelet.activity_state==ActivityStatePaused);
 activity_controller_handle_back();assert(exits==0);activity_controller_handle_select();assert((g_pacelet.overlay == OverlayFinish));
 activity_controller_handle_back();assert(!(g_pacelet.overlay == OverlayFinish));assert(exits==0);
 puts("ok - BACK pauses and cancels sheets without exiting a recording");
 fresh_activity();g_pacelet.current_pace_s_per_km=305;g_pacelet.current_speed_centi_mps=330;
 pause_activity();assert(g_pacelet.paused_pace_s_per_km==305);assert(g_pacelet.paused_speed_centi_mps==330);
 show_finish_confirmation();finish_activity();assert(g_pacelet.pending_command==MESSAGE_KEY_FINISH_ACTIVITY);
 activity_controller_handle_up();activity_controller_handle_down();activity_controller_handle_select();
 assert(g_pacelet.activity_state==ActivityStateFinished);assert(g_pacelet.pending_command==MESSAGE_KEY_FINISH_ACTIVITY);
 activity_controller_handle_back();assert(g_pacelet.overlay==OverlayExit);activity_controller_handle_down();assert(g_pacelet.overlay==OverlayNone);
 puts("ok - paused hero is captured and pending save cannot be reset by navigation");
 fresh_activity();g_pacelet.activity_state=ActivityStateCountdown;g_pacelet.countdown_value=2;
 activity_controller_handle_back();assert(g_pacelet.activity_state==ActivityStateReady);assert(g_pacelet.countdown_value==0);
 puts("ok - BACK cancels countdown");
 pacelet_model_init();g_pacelet.upload_pending=true;activity_controller_handle_back();assert((g_pacelet.overlay == OverlayExit));assert(exits==0);
 activity_controller_handle_down();assert(!(g_pacelet.overlay == OverlayExit));assert(exits==0);
 activity_controller_handle_back();activity_controller_handle_up();assert(exits==1);
 puts("ok - upload exit requires explicit confirmation and offers stay");
 fresh_activity();steps_today=10080;update_steps();assert(g_pacelet.current_steps==80);
 steps_today=4;update_steps();assert(g_pacelet.current_steps==84);steps_today=7;update_steps();assert(g_pacelet.current_steps==87);
 puts("ok - walking steps carry over midnight");
 fresh_activity();steps_today=10100;update_steps();activity_controller_handle_up();steps_today=20;
 activity_controller_handle_up();assert(g_pacelet.current_steps==100);steps_today=25;update_steps();assert(g_pacelet.current_steps==105);
 puts("ok - midnight while paused preserves steps and excludes paused walking");
 fresh_activity();g_pacelet.last_hr_bpm=140;g_pacelet.last_hr_update_at=clock_s;hr_sends=0;
 for(int i=0;i<5;i++){clock_s++;maybe_send_periodic_hr();}assert(hr_sends==1);
 for(int i=0;i<2;i++){clock_s++;maybe_send_periodic_hr();}assert(hr_sends==1);
 pause_activity();assert(hr_sends==2);
 puts("ok - HR batches five timestamped samples and flushes before pausing");
 fresh_activity();activity_controller_handle_distance(1000);assert(lights==1);assert((g_pacelet.overlay == OverlaySplit));
 puts("ok - split turns on backlight");
 fresh_activity();
 for(int i=0;i<5;i++){
   clock_s+=2;pause_activity();clock_s+=2;resume_activity();
 }
 assert(g_pacelet.pause_windows_size==60);assert(g_pacelet.activity_state==ActivityStatePaused);
 activity_controller_handle_phone_activity_state(PhoneActivityStateActive);
 assert(g_pacelet.activity_state==ActivityStatePaused);
 activity_controller_handle_phone_activity_state(PhoneActivityStatePaused);
 assert(g_pacelet.pause_windows_size==12);
 resume_activity();assert(g_pacelet.activity_state==ActivityStateActive);
 puts("ok - offline pause history is bounded, ignores stale ACKs, and resumes after sync");
 fresh_activity();battery.charge_percent=10;activity_controller_handle_tick();
 assert(g_pacelet.low_battery);assert(state_requests==1);
 activity_controller_handle_tick();assert(state_requests==1);
 assert(g_pacelet.activity_state==ActivityStateActive);
 puts("ok - low battery requests a checkpoint once and keeps recording");
 fresh_activity();
 activity_controller_handle_down();assert(g_pacelet.page==1);
 activity_controller_handle_down();assert(g_pacelet.page==2);
 activity_controller_handle_down();assert(g_pacelet.page==3);
 activity_controller_handle_select();assert(g_pacelet.page==0);assert(g_pacelet.activity_state==ActivityStateActive);
 activity_controller_handle_down();clock_s+=21;activity_controller_handle_tick();assert(g_pacelet.page==0);
 activity_controller_handle_down();activity_controller_handle_up();assert(g_pacelet.page==0);assert(g_pacelet.activity_state==ActivityStatePaused);
 puts("ok - focused pages cycle, SELECT returns, timeout returns, and pause clears navigation");
 fresh_activity();clock_s+=300;activity_controller_handle_distance(1000);
 assert(g_pacelet.recent_splits[0]==300);assert(g_pacelet.previous_split_s==0);
 clock_s+=291;activity_controller_handle_distance(2000);
 assert(g_pacelet.recent_splits[0]==291);assert(g_pacelet.recent_splits[1]==300);assert(g_pacelet.previous_split_s==300);assert(g_pacelet.best_split_s==291);
 puts("ok - last kilometre, prior split and best use completed real intervals");
 fresh_activity();g_pacelet.last_hr_bpm=140;g_pacelet.last_hr_update_at=clock_s;
 pacelet_record_metrics(clock_s);clock_s++;pacelet_record_metrics(clock_s);
 assert(g_pacelet.zone_s[2]==1);assert(g_pacelet.hr_count==1);
 pacelet_record_metrics(clock_s);assert(g_pacelet.zone_s[2]==1);
 g_pacelet.last_hr_bpm=165;clock_s++;pacelet_record_metrics(clock_s);assert(g_pacelet.display_zone==2);
 clock_s++;pacelet_record_metrics(clock_s);assert(g_pacelet.display_zone==2);
 clock_s++;pacelet_record_metrics(clock_s);assert(g_pacelet.display_zone==3);assert(g_pacelet.zone_s[3]==3);
 time_t last=clock_s;pacelet_set_state(ActivityStatePaused);clock_s++;pacelet_record_metrics(clock_s);
 assert(g_pacelet.hr_history[last%60]==165);assert(g_pacelet.hr_history[clock_s%60]==0);assert(g_pacelet.zone_s[3]==3);
 clock_s+=61;pacelet_record_metrics(clock_s);for(int i=0;i<60;i++)assert(g_pacelet.hr_history[i]==0);
 pacelet_set_state(ActivityStateActive);g_pacelet.last_hr_update_at=clock_s;clock_s++;pacelet_record_metrics(clock_s);assert(g_pacelet.zone_s[3]==3);
 puts("ok - HR totals count active seconds once, preserve pause gaps, expire columns, and debounce colour");
 activity_controller_deinit();
 return 0;
}
