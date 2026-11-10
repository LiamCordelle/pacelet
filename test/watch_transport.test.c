#include <assert.h>
#include <string.h>
#include "../src/c/pacelet_model.c"
#include "../src/c/watch_services.c"
time_t test_time(time_t *out){if(out)*out=1800000000;return 1800000000;}
static DictionaryIterator outbox;
static int busy, states, sends;
static uint8_t persisted[5][256];static int sizes[5];
static Tuple *put(DictionaryIterator *d,uint32_t key){int i=d->count++;assert(i<40);d->tuples[i]=(Tuple){key,4,&d->values[i]};return &d->tuples[i];}
Tuple *dict_find(DictionaryIterator *d,uint32_t key){for(int i=0;i<d->count;i++)if(d->tuples[i].key==key)return &d->tuples[i];return NULL;}
void dict_write_int32(DictionaryIterator*d,uint32_t k,int32_t v){put(d,k)->value->int32=v;}
void dict_write_uint8(DictionaryIterator*d,uint32_t k,uint8_t v){dict_write_int32(d,k,v);}
void dict_write_cstring(DictionaryIterator*d,uint32_t k,const char*v){Tuple*t=put(d,k);t->length=strlen(v)+1;memcpy(t->value->cstring,v,t->length);}
void dict_write_data(DictionaryIterator*d,uint32_t k,const uint8_t*v,uint16_t n){Tuple*t=put(d,k);t->length=n;assert(n<=160);memcpy(t->value->data,v,n);}
AppMessageResult app_message_outbox_begin(DictionaryIterator **d){if(busy)return APP_MSG_BUSY;memset(&outbox,0,sizeof(outbox));*d=&outbox;return APP_MSG_OK;}
AppMessageResult app_message_outbox_send(void){sends++;return APP_MSG_OK;}
void app_message_register_inbox_received(void(*cb)(DictionaryIterator*,void*)){}
void app_message_register_inbox_dropped(void(*cb)(AppMessageResult,void*)){}
void app_message_register_outbox_sent(void(*cb)(DictionaryIterator*,void*)){}
void app_message_register_outbox_failed(void(*cb)(DictionaryIterator*,AppMessageResult,void*)){}
void app_message_deregister_callbacks(void){} void app_message_open(int a,int b){}
int persist_delete(int k){sizes[k]=0;return 0;}int persist_get_size(int k){return sizes[k];}
int persist_write_data(int k,const void*p,size_t n){assert(n<=256);memcpy(persisted[k],p,n);sizes[k]=n;return n;}
int persist_read_data(int k,void*p,size_t n){if(!sizes[k])return -1;n=n<(size_t)sizes[k]?n:(size_t)sizes[k];memcpy(p,persisted[k],n);return n;}
void connection_service_subscribe(ConnectionHandlers h){}void connection_service_unsubscribe(void){}
bool connection_service_peek_pebble_app_connection(void){return true;}
static AppTimer timer;
AppTimer *app_timer_register(uint32_t d,void(*cb)(void*),void*p){timer=(AppTimer){cb,p};return &timer;}
void app_timer_cancel(AppTimer*t){}
void activity_controller_handle_phone_connection(bool b){g_pacelet.phone_connected=b;}
void activity_controller_handle_phone_activity_state(PhoneActivityState s){states++;}
void activity_controller_handle_distance(int32_t d){g_pacelet.distance_m=d;}
void watch_ui_mark_dirty(void){} void watch_ui_apply_theme(void){}void vibes_short_pulse(void){}void light_enable_interaction(void){}
int main(void){
 pacelet_model_init();g_pacelet.phone_connected=true;g_pacelet.activity_state=ActivityStateActive;g_pacelet.started_at=time(NULL);
 watch_services_send_command(MESSAGE_KEY_START_ACTIVITY);outbox_sent_callback(&outbox,NULL);
 assert(g_pacelet.pending_command==MESSAGE_KEY_START_ACTIVITY);assert(s_retry_timer);
 retry_timer_callback(NULL);assert(sends==2);
 puts("ok - START stays pending after transport success and retries until phone acknowledgement");
 strcpy(g_pacelet.activity_id,"test");g_pacelet.pause_windows_size=12;g_pacelet.pause_windows[0]=123;
 watch_services_send_command(MESSAGE_KEY_RESUME_ACTIVITY);outbox_sent_callback(&outbox,NULL);
 assert(g_pacelet.pending_command==MESSAGE_KEY_RESUME_ACTIVITY);
 DictionaryIterator reply={0};dict_write_int32(&reply,MESSAGE_KEY_ACTIVITY_STATE,PhoneActivityStateActive);
 dict_write_cstring(&reply,MESSAGE_KEY_ACTIVITY_ID,"test");
 inbox_received_callback(&reply,NULL);assert(states==0);
 dict_write_data(&reply,MESSAGE_KEY_PAUSE_WINDOWS,g_pacelet.pause_windows,12);
 inbox_received_callback(&reply,NULL);assert(states==1);
 puts("ok - an older state reply cannot acknowledge a different pause snapshot");
 watch_services_save_activity_state();g_pacelet.pause_windows_size=0;
 watch_services_load_activity_state();assert(g_pacelet.pause_windows_size==12);assert(g_pacelet.pause_windows[0]==123);
 puts("ok - unacknowledged pause intervals survive watch persistence");
 g_pacelet.hr_batch_size=25;memset(g_pacelet.hr_batch,1,25);assert(watch_services_send_hr_batch());
 outbox_failed_callback(&outbox,APP_MSG_BUSY,NULL);assert(g_pacelet.hr_batch_size==25);
 memset(g_pacelet.hr_batch+25,2,5);g_pacelet.hr_batch_size=30;
 outbox_sent_callback(&outbox,NULL);assert(g_pacelet.hr_batch_size==5);assert(g_pacelet.hr_batch[0]==2);
 puts("ok - HR send failure keeps samples and ACK removes only the transmitted prefix");
 g_pacelet.pending_command=0;s_initial_state_pending=false;s_retry_timer=NULL;busy=1;
 watch_services_request_history();assert(s_history_pending);assert(s_retry_timer);
 busy=0;retry_timer_callback(NULL);assert(dict_find(&outbox,MESSAGE_KEY_REQUEST_HISTORY));
 reply=(DictionaryIterator){0};dict_write_int32(&reply,MESSAGE_KEY_HISTORY_COUNT,0);inbox_received_callback(&reply,NULL);assert(!s_history_pending);
 puts("ok - busy history requests retry and retire on the phone response");
 g_pacelet.recent_splits[0]=301;g_pacelet.zone_s[2]=70;watch_services_save_activity_state();
 g_pacelet.recent_splits[0]=0;g_pacelet.zone_s[2]=0;watch_services_load_activity_state();
 assert(g_pacelet.recent_splits[0]==301);assert(g_pacelet.zone_s[2]==70);
 puts("ok - compact split and zone checkpoint survives a watch restart");
 AppSettingsV2 old={.version=2,.dark_mode=true,.hr_zone_1_bpm=105,.hr_zone_2_bpm=135,.hr_zone_3_bpm=165};
 persist_write_data(SETTINGS_KEY,&old,sizeof(old));pacelet_model_init();watch_services_load_settings();
 assert(g_pacelet.hr_zone_1_bpm==105);assert(g_pacelet.hr_zone_3_bpm==165);assert(g_pacelet.motion_mode==MotionFull);
 g_pacelet.motion_mode=MotionOff;save_settings();pacelet_model_init();watch_services_load_settings();assert(g_pacelet.motion_mode==MotionOff);
 puts("ok - old thresholds migrate and motion preference persists without a theme reset");
 reply=(DictionaryIterator){0};dict_write_cstring(&reply,MESSAGE_KEY_SUMMARY_HR,"145,1,20,30,4");
 inbox_received_callback(&reply,NULL);assert(g_pacelet.summary_avg_hr==145);assert(g_pacelet.zone_s[2]==30);
 reply=(DictionaryIterator){0};dict_write_int32(&reply,MESSAGE_KEY_HISTORY_COUNT,1);dict_write_cstring(&reply,MESSAGE_KEY_HISTORY_HR,"150,2,3,4,5");
 inbox_received_callback(&reply,NULL);assert(g_pacelet.history_items[0].avg_hr==150);assert(g_pacelet.history_items[0].zone_s[3]==5);
 puts("ok - recap and history consume authoritative phone HR summaries");
 watch_services_clear_activity_state();assert(!sizes[ACTIVITY_PAUSES_KEY]);assert(!sizes[METRICS_KEY]);
 pacelet_model_init();
 g_pacelet.activity_state=ActivityStateGps;g_pacelet.gps_request_id=15;
 reply=(DictionaryIterator){0};
 dict_write_int32(&reply,MESSAGE_KEY_GPS_STATUS,GpsStateLocked);
 dict_write_int32(&reply,MESSAGE_KEY_GPS_REQUEST_ID,14);
 inbox_received_callback(&reply,NULL);assert(g_pacelet.activity_state==ActivityStateGps);
 dict_find(&reply,MESSAGE_KEY_GPS_REQUEST_ID)->value->int32=15;
 inbox_received_callback(&reply,NULL);assert(g_pacelet.activity_state==ActivityStateReady);
 puts("ok - GPS acquisition ignores a lock from the preceding request");

 g_pacelet.activity_state=ActivityStateFinished;
 strcpy(g_pacelet.finished_activity_id,"finished");
 reply=(DictionaryIterator){0};dict_write_cstring(&reply,MESSAGE_KEY_ACTIVITY_ID,"other");
 dict_write_int32(&reply,MESSAGE_KEY_STRAVA_STATUS,HistoryStravaFailed);
 inbox_received_callback(&reply,NULL);assert(g_pacelet.finished_strava_status==HistoryStravaUnknown);
 assert(!g_pacelet.activity_id[0]);
 reply=(DictionaryIterator){0};dict_write_cstring(&reply,MESSAGE_KEY_ACTIVITY_ID,"finished");
 dict_write_int32(&reply,MESSAGE_KEY_STRAVA_STATUS,HistoryStravaFailed);
 inbox_received_callback(&reply,NULL);assert(g_pacelet.finished_strava_status==HistoryStravaFailed);
 puts("ok - upload feedback applies only to the matching saved activity");

 g_pacelet.activity_state=ActivityStateRecovery;
 g_pacelet.pending_command=MESSAGE_KEY_FINISH_ACTIVITY;
 strcpy(g_pacelet.activity_id,"restored");
 int prior_states=states;
 reply=(DictionaryIterator){0};
 dict_write_int32(&reply,MESSAGE_KEY_ACTIVITY_STATE,PhoneActivityStateNone);
 inbox_received_callback(&reply,NULL);
 assert(states==prior_states);assert(g_pacelet.pending_command==MESSAGE_KEY_FINISH_ACTIVITY);
 dict_write_int32(&reply,MESSAGE_KEY_SUMMARY_POINTS,5);
 dict_write_cstring(&reply,MESSAGE_KEY_ACTIVITY_ID,"old");
 inbox_received_callback(&reply,NULL);assert(states==prior_states);assert(g_pacelet.summary_points==0);
 reply=(DictionaryIterator){0};
 dict_write_int32(&reply,MESSAGE_KEY_ACTIVITY_STATE,PhoneActivityStateNone);
 dict_write_int32(&reply,MESSAGE_KEY_SUMMARY_POINTS,42);
 dict_write_cstring(&reply,MESSAGE_KEY_ACTIVITY_ID,"restored");
 dict_write_int32(&reply,MESSAGE_KEY_STRAVA_STATUS,HistoryStravaFailed);
 inbox_received_callback(&reply,NULL);assert(states==prior_states+1);
 assert(g_pacelet.summary_points==42);
 assert(strcmp(g_pacelet.finished_activity_id,"restored")==0);
 assert(g_pacelet.finished_strava_status==HistoryStravaFailed);
 g_pacelet.pending_command=0;
 puts("ok - recovery waits for the matching finish acknowledgement and restores its upload status");

 g_pacelet.activity_state=ActivityStateActive;g_pacelet.page=PageRoute;
 strcpy(g_pacelet.activity_id,"track");
 busy=1;assert(!watch_services_request_route());
 busy=0;assert(watch_services_request_route());
 assert(dict_find(&outbox,MESSAGE_KEY_REQUEST_ROUTE));
 assert(strcmp(dict_find(&outbox,MESSAGE_KEY_ACTIVITY_ID)->value->cstring,"track")==0);
 assert(!g_pacelet.pending_command);
 uint8_t route[]={1,20,140,42,60};
 reply=(DictionaryIterator){0};dict_write_cstring(&reply,MESSAGE_KEY_ACTIVITY_ID,"old");
 dict_write_data(&reply,MESSAGE_KEY_ROUTE_POINTS,route,sizeof(route));
 inbox_received_callback(&reply,NULL);assert(!g_pacelet.route_received);
 reply=(DictionaryIterator){0};dict_write_cstring(&reply,MESSAGE_KEY_ACTIVITY_ID,"track");
 dict_write_data(&reply,MESSAGE_KEY_ROUTE_POINTS,route,sizeof(route));
 inbox_received_callback(&reply,NULL);assert(g_pacelet.route_size==4);
 assert(memcmp(g_pacelet.route_points,route+1,4)==0);
 puts("ok - route snapshots are bounded and scoped to the current activity");
 return 0;
}
