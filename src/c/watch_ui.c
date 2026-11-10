#include "watch_ui.h"
#include "pacelet_model.h"
#include <string.h>
#include "paceboard_icons.h"

// One fixed Emery palette. Drawn in native Pebble primitives; no frame copies.
#define PB_PAPER GColorWhite
#define PB_MIST GColorFromHEX(0xAAFFFF)
#define PB_INK GColorFromHEX(0x005555)
#define PB_MUTED GColorFromHEX(0x555555)
#define PB_RULE GColorFromHEX(0xAAAAAA)
#define PB_TEAL GColorFromHEX(0x00AAAA)
#define PB_AMBER GColorFromHEX(0xFFAA00)
#define PB_CORAL GColorFromHEX(0xFFAAAA)
#define PB_RED GColorFromHEX(0xAA0000)

// All animations consume view snapshots. Sensor data and controller timers are
// authoritative; frame callbacks never mutate recording state.
typedef enum { ScenePicker, SceneGps, SceneCountdown, SceneLive, SceneLaps,
  SceneZones, SceneHeart, SceneRoute, SceneRecap, SceneUpload, SceneHistory, SceneDetail, SceneRecovery } Scene;
typedef struct {
  PaceletModel model;
  int32_t elapsed;
  time_t now;
  Scene scene;
} WatchView;
typedef enum { FxNone, FxPick, FxOrbit, FxFix, FxLock, FxCount, FxStart,
  FxPush, FxSheet, FxSplitOut, FxPause, FxSave, FxZone, FxHr, FxUpload } Effect;
static struct {
  Window *window;
  Layer *content, *overlay, *header, *rail;
  AppTimer *timer;
  WatchView view, from, pending, previous;
  Effect effect;
  uint32_t began, duration, gps_began;
  int progress, radius_from, radius_to, orbit_angle, picker_from_y;
  bool loaded, focused;
} s_ui;
enum { I_NONE,I_UP,I_DOWN,I_PLAY,I_PAUSE,I_STOP,I_CHECK,I_BACK,I_DELETE,I_PAGES,I_FILE,I_RETRY };
static int pb_dy;
static int pb_clamp(int v,int low,int high){return v<low?low:v>high?high:v;}
static int pb_lerp(int a,int b,int p){return a+(b-a)*p/1000;}
static int pb_ease(int p){int q=1000-p;return 1000-q*q/1000*q/1000;}
static void pb_fill(GContext*c,int x,int y,int w,int h,GColor color,int radius){
 graphics_context_set_fill_color(c,color);graphics_fill_rect(c,GRect(x,y+pb_dy,w,h),radius,radius?GCornersAll:GCornerNone);
}
static void pb_line(GContext*c,int x,int y,int xx,int yy,GColor color,int weight){
 graphics_context_set_stroke_color(c,color);graphics_context_set_stroke_width(c,weight);
 graphics_draw_line(c,GPoint(x,y+pb_dy),GPoint(xx,yy+pb_dy));graphics_context_set_stroke_width(c,1);
}
static const char *pb_fit(const char*v,int width,const char*large,const char*small){
 GSize size=graphics_text_layout_get_content_size(v,fonts_get_system_font(large),GRect(0,0,500,100),GTextOverflowModeWordWrap,GTextAlignmentLeft);
 return size.w<=width?large:small;
}
static void pb_text(GContext*c,const char*v,const char*font,int x,int y,int w,int h,GColor color,GTextAlignment align){
 graphics_context_set_text_color(c,color);graphics_draw_text(c,v,fonts_get_system_font(font),GRect(x,y+pb_dy,w,h),GTextOverflowModeTrailingEllipsis,align,NULL);
}
#define PB_LABEL(c,v,x,y,w,col) pb_text(c,v,FONT_KEY_GOTHIC_14_BOLD,x,y,w,18,col,GTextAlignmentLeft)
static void pb_number(GContext*c,const char*v,int x,int y,int w,int h,const char*large,const char*small,GColor col,GTextAlignment align){
 const char*f=pb_fit(v,w,large,small);f=pb_fit(v,w,f,FONT_KEY_GOTHIC_18_BOLD);pb_text(c,v,f,x,y,w,h,col,align);
}
static GColor pb_zone(int zone){const uint32_t colors[]={0xAAFFFF,0xAAFFAA,0xFFAA00,0xFFAAAA};return GColorFromHEX(colors[pb_clamp(zone,0,3)]);}
static void pb_heart(GContext*c,int x,int y,GColor ink,int scale){
 const char*rows[]={".##.##.","#######","#######",".#####.","..###..","...#..."};
 for(int j=0;j<6;j++)for(int i=0;i<7;i++)if(rows[j][i]=='#')pb_fill(c,x+i*scale,y+j*scale,scale,scale,ink,0);
}
static void pb_activity_icon(GContext*c,int type,int x,int y,GColor ink,int percent){
 const uint8_t(*runs)[3]=type==0?pb_icon_walk:type==1?pb_icon_run:pb_icon_cycle;
 int count=type==0?ARRAY_LENGTH(pb_icon_walk):type==1?ARRAY_LENGTH(pb_icon_run):ARRAY_LENGTH(pb_icon_cycle);
 for(int i=0;i<count;i++){
  int xx=x-17*percent/1000+runs[i][0]*percent/1000;
  int yy=y-17*percent/1000+runs[i][1]*percent/1000;
  int w=(runs[i][0]+runs[i][2])*percent/1000-runs[i][0]*percent/1000;
  int h=(runs[i][1]+1)*percent/1000-runs[i][1]*percent/1000;
  if(w>0)pb_fill(c,xx,yy,w,h>0?h:1,ink,0);
 }
}
static void pb_icon(GContext*c,int icon,int cy,GColor ink){
 switch(icon){
 case I_UP:pb_line(c,185,cy+3,190,cy-3,ink,2);pb_line(c,190,cy-3,195,cy+3,ink,2);break;
 case I_DOWN:pb_line(c,185,cy-3,190,cy+3,ink,2);pb_line(c,190,cy+3,195,cy-3,ink,2);break;
 case I_PLAY:pb_line(c,186,cy-6,195,cy,ink,2);pb_line(c,195,cy,186,cy+6,ink,2);pb_line(c,186,cy-6,186,cy+6,ink,2);break;
 case I_PAUSE:pb_fill(c,185,cy-6,3,12,ink,0);pb_fill(c,192,cy-6,3,12,ink,0);break;
 case I_STOP:pb_fill(c,185,cy-5,10,10,ink,1);break;
 case I_CHECK:pb_line(c,184,cy,188,cy+4,ink,2);pb_line(c,188,cy+4,196,cy-5,ink,2);break;
 case I_BACK:pb_line(c,193,cy-5,187,cy,ink,2);pb_line(c,187,cy,193,cy+5,ink,2);break;
 case I_DELETE:pb_line(c,185,cy-5,195,cy+5,ink,2);pb_line(c,195,cy-5,185,cy+5,ink,2);break;
 case I_PAGES:
   for (int i = 0; i < PageCount; i++) {
     int y = cy - 11 + i * 5;
     if (i == s_ui.view.model.page) pb_fill(c, 185, y, 10, 4, ink, 0);
     else {
       graphics_context_set_stroke_color(c, ink);
       graphics_draw_rect(c, GRect(185, y + pb_dy, 10, 4));
     }
   }
   break;
 case I_FILE:pb_line(c,186,cy-7,194,cy-7,ink,1);pb_line(c,194,cy-7,194,cy+7,ink,1);pb_line(c,194,cy+7,186,cy+7,ink,1);pb_line(c,186,cy+7,186,cy-7,ink,1);pb_line(c,188,cy-2,192,cy-2,ink,1);pb_line(c,188,cy+2,192,cy+2,ink,1);break;
 case I_RETRY:graphics_context_set_stroke_color(c,ink);graphics_context_set_stroke_width(c,2);graphics_draw_arc(c,GRect(185,cy-5,11,11),GOvalScaleModeFitCircle,DEG_TO_TRIGANGLE(45),DEG_TO_TRIGANGLE(320));pb_line(c,194,cy-5,194,cy,ink,2);pb_line(c,194,cy-5,189,cy-5,ink,2);break;
 default:break;
 }
}

static void duration_text(char *out, size_t size, int32_t seconds) {
  seconds = pb_clamp(seconds, 0, 999999);
  if (seconds >= 3600) snprintf(out,size,"%ld:%02ld:%02ld",(long)seconds/3600,(long)seconds/60%60,(long)seconds%60);
  else snprintf(out,size,"%ld:%02ld",(long)seconds/60,(long)seconds%60);
}
static void distance_text(char *out,size_t size,int32_t metres) {
  metres = pb_clamp(metres,0,999999);
  snprintf(out,size,"%ld.%02ld",(long)metres/1000,(long)metres%1000/10);
}
static void speed_text(char*out,size_t size,int32_t centi_mps) {
  int32_t tenths=pb_clamp(centi_mps,0,99999)*36/100;
  snprintf(out,size,"%ld.%ld",(long)tenths/10,(long)tenths%10);
}
static bool live_state(ActivityState state) { return state==ActivityStateActive||state==ActivityStatePaused; }
static Scene scene_for(const PaceletModel*m) {
  switch(m->activity_state) {
    case ActivityStateChoose:return ScenePicker;
    case ActivityStateGps:case ActivityStateReady:return SceneGps;
    case ActivityStateCountdown:return SceneCountdown;
    case ActivityStateActive:case ActivityStatePaused:
      switch (m->page) {
        case PageLaps: return SceneLaps;
        case PageZones: return SceneZones;
        case PageHeart: return SceneHeart;
        case PageRoute: return SceneRoute;
        default: return SceneLive;
      }
    case ActivityStateFinished:
      return (m->finished_strava_status == HistoryStravaUploading ||
              m->finished_strava_status == HistoryStravaProcessing) &&
              !m->pending_command ? SceneUpload : SceneRecap;
    case ActivityStateHistoryList:return SceneHistory;
    case ActivityStateHistoryDetail:return SceneDetail;
    default:return SceneRecovery;
  }
}
static void capture_view(WatchView *view) {
  view->model=g_pacelet;view->elapsed=pacelet_elapsed_s();view->now=time(NULL);
  view->scene=scene_for(&view->model);
}
static uint32_t clock_ms(void) { time_t seconds;uint16_t ms;time_ms(&seconds,&ms);return (uint32_t)seconds*1000+ms; }
static int zone_for(const WatchView*v,int bpm) {
  return bpm<v->model.hr_zone_1_bpm?0:bpm<v->model.hr_zone_2_bpm?1:bpm<v->model.hr_zone_3_bpm?2:3;
}
static void scale(GContext*c,const WatchView*v,int x,int y,int width,int bpm) {
  int bounds[]={40,v->model.hr_zone_1_bpm,v->model.hr_zone_2_bpm,v->model.hr_zone_3_bpm,250};
  int z=zone_for(v,bpm),segment=(width-9)/4;
  for(int i=0;i<4;i++) {
    int xx=x+i*(segment+3);
    if(i==z)pb_fill(c,xx,y,segment,4,PB_INK,0);
    else{graphics_context_set_stroke_color(c,PB_INK);graphics_draw_rect(c,GRect(xx,y+pb_dy,segment,4));}
  }
  int f=pb_clamp((bpm-bounds[z])*(segment-1)/(bounds[z+1]-bounds[z]),0,segment-1);
  int marker=x+z*(segment+3)+f;pb_line(c,marker,y-3,marker,y-7,PB_INK,2);
}
static void hr_band(GContext*c,const WatchView*v,bool average) {
  const PaceletModel*m=&v->model;
  int bpm=average?(m->summary_avg_hr?m->summary_avg_hr:m->hr_count?(int)(m->hr_sum/m->hr_count):0):(int)m->last_hr_bpm;
  int z=average?zone_for(v,bpm):m->display_zone>=0?m->display_zone:zone_for(v,bpm);
  bool missing=bpm<=0;
  GColor fill=missing?PB_RULE:pb_zone(z);
  if(s_ui.effect==FxZone&&!average) {
    int old=s_ui.from.model.display_zone;
    pb_fill(c,0,199,180,29,old<0?PB_RULE:pb_zone(old),0);
    pb_fill(c,0,228-29*pb_ease(s_ui.progress)/1000,180,29*pb_ease(s_ui.progress)/1000,fill,0);
  }else pb_fill(c,0,199,180,29,fill,0);
  int pop=s_ui.effect==FxHr&&s_ui.progress<500&&!average?1:0;
  pb_heart(c,10-pop,208-pop,PB_INK,2);
  char value[8];snprintf(value,sizeof(value),"%d",bpm);
  pb_text(c,missing?"--":value,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,30,198,54,29,PB_INK,GTextAlignmentLeft);
  if(missing){PB_LABEL(c,average?"NO HR DATA":"MEASURING",87,204,88,PB_INK);return;}
  if(average)PB_LABEL(c,"AVG",92,204,42,PB_INK);else scale(c,v,89,218,53,bpm);
  char label[8];snprintf(label,sizeof(label),"Z%d",zone_for(v,bpm));
  pb_text(c,label,FONT_KEY_GOTHIC_18_BOLD,148,202,27,24,PB_INK,GTextAlignmentCenter);
}
static void pb_pair(GContext*c,const char*distance,const char*second,const char*label){
 PB_LABEL(c,"DIST. KM",8,115,82,PB_MUTED);PB_LABEL(c,label,98,115,76,PB_MUTED);
 pb_number(c,distance,6,129,82,31,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_20_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
 pb_number(c,second,96,129,80,31,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_20_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
 pb_line(c,90,119,90,155,PB_RULE,1);
}
static void pb_picker(GContext*c,int selected,int old,int progress){
 int y=pb_lerp(s_ui.effect==FxPick?s_ui.picker_from_y:37+old*44,37+selected*44,progress);
 pb_fill(c,0,y,180,42,PB_MIST,0);pb_fill(c,0,y,3,42,PB_TEAL,0);
 const char*names[]={"Walking","Running","Cycling","History"};
 for(int i=0;i<4;i++){
  if(i<3)pb_activity_icon(c,i,26,58+i*44,PB_INK,1000);
  else{graphics_context_set_stroke_color(c,PB_INK);graphics_context_set_stroke_width(c,2);graphics_draw_circle(c,GPoint(26,58+i*44+pb_dy),11);pb_line(c,26,51+i*44,26,58+i*44,PB_INK,2);pb_line(c,26,58+i*44,32,61+i*44,PB_INK,2);}
  pb_text(c,names[i],FONT_KEY_GOTHIC_24_BOLD,51,41+i*44,122,32,PB_INK,GTextAlignmentLeft);
 }
}

static const char *hero_value(const WatchView*v,bool recap,char*hero,size_t size) {
  const PaceletModel*m=&v->model;
  bool walk=m->activity_type==ActivityTypeWalking,ride=m->activity_type==ActivityTypeCycling;
  bool paused=m->activity_state==ActivityStatePaused;
  int32_t metres=recap?(m->summary_distance_m?m->summary_distance_m:m->distance_m):m->distance_m;
  int32_t elapsed=recap?(m->summary_moving_s?m->summary_moving_s:v->elapsed):v->elapsed;
  if(walk)duration_text(hero,size,elapsed);
  else if(ride) {
    int speed=recap?(elapsed>0?(int64_t)metres*100/elapsed:0):paused&&m->paused_speed_centi_mps>0?m->paused_speed_centi_mps:m->current_speed_centi_mps;
    if(speed>0)speed_text(hero,size,speed);else snprintf(hero,size,"--.-");
  } else {
    int pace=recap?(metres>0?(int64_t)elapsed*1000/metres:0):paused&&m->paused_pace_s_per_km>0?m->paused_pace_s_per_km:m->current_pace_s_per_km;
    if(pace>0)snprintf(hero,size,"%ld:%02ld",(long)pace/60,(long)pace%60);else snprintf(hero,size,"--:--");
  }
  if(!recap&&!paused&&!walk&&(!m->phone_connected||m->gps_state!=GpsStateLocked))snprintf(hero,size,ride?"--.-":"--:--");
  return walk?"ELAPSED":ride?(recap?"AVG SPEED KM/H":"SPEED KM/H"):(recap?"AVG PACE /KM":"PACE /KM");
}
static void live(GContext*c,const WatchView*v,bool recap) {
  const PaceletModel*m=&v->model;bool walk=m->activity_type==ActivityTypeWalking;
  bool paused=m->activity_state==ActivityStatePaused;
  char hero[20],distance[16],second[20],last[20],delta[20];
  int32_t metres=recap?(m->summary_distance_m?m->summary_distance_m:m->distance_m):m->distance_m;
  int32_t elapsed=recap?(m->summary_moving_s?m->summary_moving_s:v->elapsed):v->elapsed;
  const char *label=hero_value(v,recap,hero,sizeof(hero));
  distance_text(distance,sizeof(distance),metres);
  if(walk&&!recap)snprintf(second,sizeof(second),m->current_steps_available?"%ld":"--",(long)m->current_steps);
  else duration_text(second,sizeof(second),elapsed);
  pb_fill(c,0,22,180,88,PB_MIST,0);
  PB_LABEL(c,label,8,25,164,PB_INK);
  if(paused){char pause[24],time[16];duration_text(time,sizeof(time),v->now-m->paused_at);snprintf(pause,sizeof(pause),"FOR %s",time);pb_text(c,pause,FONT_KEY_GOTHIC_14_BOLD,100,25,73,18,PB_INK,GTextAlignmentRight);}
  pb_number(c,hero,4,35,172,73,FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_42_NUMBERS,paused?PB_MUTED:PB_INK,GTextAlignmentCenter);
  pb_pair(c,distance,second,walk&&!recap?"STEPS":"ELAPSED");
  pb_line(c,8,161,172,161,PB_RULE,1);
  if (recap && m->finished_strava_status == HistoryStravaFailed) {
    PB_LABEL(c, "STRAVA UPLOAD FAILED", 8, 162, 164, PB_RED);
    PB_LABEL(c, "RETRY IN HISTORY", 8, 180, 164, PB_MUTED);
  } else if (recap && m->finished_strava_status == HistoryStravaUnconfirmed) {
    PB_LABEL(c, "STRAVA NOT CONFIRMED", 8, 162, 164, PB_INK);
    PB_LABEL(c, "CHECK IN HISTORY", 8, 180, 164, PB_MUTED);
  } else if (recap && m->finished_strava_status == HistoryStravaSkipped) {
    PB_LABEL(c, "STRAVA UPLOAD SKIPPED", 8, 162, 164, PB_INK);
    PB_LABEL(c, "CHECK STRAVA SETTINGS", 8, 180, 164, PB_MUTED);
  } else if(recap) {
    int32_t total=0;for(int i=0;i<4;i++)total+=m->zone_s[i];
    if(total) {
      for(int i=0;i<4;i++){char z[3];snprintf(z,sizeof(z),"Z%d",i);pb_fill(c,8+i*42,170,7,7,pb_zone(i),0);PB_LABEL(c,z,18+i*42,164,25,PB_MUTED);}
      int x=8;for(int i=0;i<4;i++){int w=(int64_t)164*m->zone_s[i]/total;pb_fill(c,x,186,w,7,pb_zone(i),0);x+=w;}
    }else PB_LABEL(c,"NO ZONE DATA",8,174,164,PB_MUTED);
  }else if(paused&&m->recovery_message[0]) {
    pb_text(c,m->recovery_message,FONT_KEY_GOTHIC_14_BOLD,8,174,164,24,PB_MUTED,GTextAlignmentLeft);
  }else {
    PB_LABEL(c,"LAST KM",8,175,59,PB_MUTED);
    int value=m->recent_splits[0];
    if(value>0)duration_text(last,sizeof(last),value);else snprintf(last,sizeof(last),"--:--");
    pb_number(c,last,68,164,68,34,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_20_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
    if(m->previous_split_s>0&&value>0) {
      int d=value-m->previous_split_s;char time[16];duration_text(time,sizeof(time),d<0?-d:d);snprintf(delta,sizeof(delta),"%c%s",d<0?'-':'+',time);
      pb_text(c,delta,FONT_KEY_GOTHIC_14_BOLD,133,176,43,18,PB_MUTED,GTextAlignmentRight);
    }
  }
  hr_band(c,v,recap);
}
static int gps_radius(int accuracy) {
  if (accuracy < 0) return 60;
  // Show improvement earlier in acquisition and meet the inner ring at 25 m.
  return 30 + pb_clamp(accuracy - PACELET_GPS_LOCK_ACCURACY_M, 0, 75) * 30 / 75;
}
static int visible_gps_radius(const WatchView *view) {
  if (s_ui.effect == FxFix) {
    return pb_lerp(s_ui.radius_from, s_ui.radius_to, pb_ease(s_ui.progress));
  }
  return gps_radius(view->model.gps_accuracy_m);
}
static void gps(GContext*c,const WatchView*v) {
  const PaceletModel*m=&v->model;bool ready=m->gps_state==GpsStateLocked,error=m->gps_state==GpsStateError;
  int p=s_ui.effect==FxLock?s_ui.progress:1000;
  int radius=ready?pb_lerp(s_ui.radius_from,0,pb_ease(p)):s_ui.effect==FxFix?pb_lerp(s_ui.radius_from,s_ui.radius_to,pb_ease(s_ui.progress)):gps_radius(m->gps_accuracy_m);
  int angle=s_ui.orbit_angle;
  if(s_ui.effect==FxOrbit||(s_ui.effect==FxFix&&clock_ms()-s_ui.gps_began<15000))
    angle=(clock_ms()-s_ui.gps_began)%10200*360/10200;
  graphics_context_set_fill_color(c,error?PB_PAPER:PB_MIST);graphics_fill_circle(c,GPoint(90,85+pb_dy),30);
  for(int i=0;i<24;i++){int a=DEG_TO_TRIGANGLE(i*15);graphics_context_set_fill_color(c,PB_RULE);graphics_fill_circle(c,GPoint(90+sin_lookup(a)*60/TRIG_MAX_RATIO,85+pb_dy-cos_lookup(a)*60/TRIG_MAX_RATIO),1);}
  graphics_context_set_stroke_color(c,error?PB_RULE:PB_TEAL);graphics_context_set_stroke_width(c,2);graphics_draw_circle(c,GPoint(90,85+pb_dy),30);
  if(!ready&&!error){pb_line(c,85,85,95,85,PB_TEAL,1);pb_line(c,90,80,90,90,PB_TEAL,1);}
  if(error){graphics_context_set_fill_color(c,PB_RED);graphics_fill_circle(c,GPoint(140,52+pb_dy),4);}
  else if(!ready||p<850)for(int i=0;i<3;i++) {int a=DEG_TO_TRIGANGLE(15+angle+i*120);graphics_context_set_fill_color(c,PB_AMBER);graphics_fill_circle(c,GPoint(90+sin_lookup(a)*radius/TRIG_MAX_RATIO,85+pb_dy-cos_lookup(a)*radius/TRIG_MAX_RATIO),3);}
  if(ready) {
    graphics_context_set_fill_color(c,PB_TEAL);graphics_fill_radial(c,GRect(59,54+pb_dy,62,62),GOvalScaleModeFitCircle,3,0,TRIG_MAX_ANGLE*p/1000);
    int check=pb_clamp((p-450)*1000/550,0,1000),first=pb_clamp(check,0,350);
    if(check>0)pb_line(c,78,85,78+10*first/350,85+10*first/350,PB_INK,3);
    if(check>350)pb_line(c,88,95,88+17*(check-350)/650,95-22*(check-350)/650,PB_INK,3);
  }
  const char*title=error?"GPS unavailable":ready?(m->activity_type==ActivityTypeWalking?"Ready to walk":m->activity_type==ActivityTypeCycling?"Ready to ride":"Ready to run"):"Finding GPS";
  pb_text(c,title,FONT_KEY_GOTHIC_24_BOLD,8,148,164,33,error?PB_RED:PB_INK,GTextAlignmentCenter);
  char detail[40];if(m->gps_accuracy_m>=0)snprintf(detail,sizeof(detail),"%ld m / need 25 m",(long)m->gps_accuracy_m);else snprintf(detail,sizeof(detail),"Waiting for phone fix");
  pb_text(c,error?(m->gps_error[0]?m->gps_error:"Check phone location"):detail,FONT_KEY_GOTHIC_18,8,183,164,27,PB_MUTED,GTextAlignmentCenter);
  PB_LABEL(c,error?"UP TO RETRY":ready?"SELECT TO START":"KEEP PHONE NEARBY",28,211,148,PB_MUTED);
}
// Centre within the body between the status header and the bottom edge.
#define COUNTDOWN_CENTRE_Y 125
#define COUNTDOWN_RADIUS 60
static void countdown(GContext *c, const WatchView *v) {
  int centre_y = COUNTDOWN_CENTRE_Y + pb_dy;
  GRect disc = GRect(30, centre_y - COUNTDOWN_RADIUS, 120, 120);
  graphics_context_set_fill_color(c, PB_MIST);
  graphics_fill_circle(c, GPoint(90, centre_y), COUNTDOWN_RADIUS);
  if (s_ui.effect == FxCount && s_ui.progress < 1000) {
    graphics_context_set_fill_color(c, PB_TEAL);
    int remaining = TRIG_MAX_ANGLE * (1000 - s_ui.progress) / 1000;
    graphics_fill_radial(c, disc, GOvalScaleModeFitCircle, 5,
                         TRIG_MAX_ANGLE - remaining, TRIG_MAX_ANGLE);
  }
  char numeral[4];
  snprintf(numeral, sizeof(numeral), "%d", v->model.countdown_value);
  pb_text(c, numeral, FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM, 30,
          COUNTDOWN_CENTRE_Y - 38, 120, 90, PB_INK, GTextAlignmentCenter);
  pb_text(c, "STARTING", FONT_KEY_GOTHIC_14_BOLD, 0, 201, 180, 18,
          PB_MUTED, GTextAlignmentCenter);
}
static void laps(GContext*c,const WatchView*v) {
  pb_text(c,"Kilometres",FONT_KEY_GOTHIC_24_BOLD,8,27,164,35,PB_INK,GTextAlignmentLeft);
  for(int i=0;i<5;i++) {
    int y=68+i*29;char label[20],value[20];
    if(i==0){pb_fill(c,0,y-1,180,28,PB_MIST,0);snprintf(label,sizeof(label),"NOW");duration_text(value,sizeof(value),v->elapsed-v->model.last_split_elapsed_s);}
    else {
      int index=i-1;if(v->model.recent_splits[index]<=0)continue;
      snprintf(label,sizeof(label),"KM %ld",(long)v->model.split_number-index);duration_text(value,sizeof(value),v->model.recent_splits[index]);
      if(v->model.recent_splits[index]==v->model.best_split_s)pb_fill(c,159,y+9,5,5,PB_TEAL,2);
    }
    PB_LABEL(c,label,8,y+1,68,PB_MUTED);pb_number(c,value,80,y-4,68,28,FONT_KEY_LECO_20_BOLD_NUMBERS,FONT_KEY_GOTHIC_18_BOLD,PB_INK,GTextAlignmentRight);
  }
}
static void zones(GContext*c,const WatchView*v) {
  pb_text(c,"Time in zones",FONT_KEY_GOTHIC_24_BOLD,8,27,164,35,PB_INK,GTextAlignmentLeft);
  int32_t max=1;for(int i=0;i<4;i++)if(v->model.zone_s[i]>max)max=v->model.zone_s[i];
  for(int i=0;i<4;i++){int z=3-i,y=68+i*37;char label[4],value[20];snprintf(label,sizeof(label),"Z%d",z);duration_text(value,sizeof(value),v->model.zone_s[z]);PB_LABEL(c,label,8,y,32,PB_INK);pb_text(c,value,FONT_KEY_GOTHIC_18_BOLD,82,y-3,90,24,PB_INK,GTextAlignmentRight);pb_fill(c,8,y+21,164,8,PB_RULE,0);pb_fill(c,8,y+21,(int64_t)164*v->model.zone_s[z]/max,8,pb_zone(z),0);}
  char elapsed[20],label[40];duration_text(elapsed,sizeof(elapsed),v->elapsed);snprintf(label,sizeof(label),"ACTIVE TIME %s",elapsed);PB_LABEL(c,label,8,213,164,PB_MUTED);
}
static void heart_page(GContext*c,const WatchView*v) {
  pb_text(c,"Heart rate",FONT_KEY_GOTHIC_24_BOLD,8,27,164,35,PB_INK,GTextAlignmentLeft);
  int bpm=v->model.last_hr_bpm;char value[20];if(bpm>0)snprintf(value,sizeof(value),"%d",bpm);else snprintf(value,sizeof(value),"--");
  pb_number(c,value,8,55,108,55,FONT_KEY_LECO_42_NUMBERS,FONT_KEY_LECO_32_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
  if(bpm>0){int z=zone_for(v,bpm);char zone[4];snprintf(zone,sizeof(zone),"Z%d",z);pb_fill(c,137,73,35,24,pb_zone(z),0);pb_text(c,zone,FONT_KEY_GOTHIC_18_BOLD,137,71,35,26,PB_INK,GTextAlignmentCenter);scale(c,v,12,123,156,bpm);}
  char stint[20],label[40];duration_text(stint,sizeof(stint),v->model.zone_stint_s);snprintf(label,sizeof(label),"THIS STINT %s",stint);PB_LABEL(c,bpm>0?label:"WAITING FOR SENSOR",8,135,164,PB_MUTED);
  for(int i=0;i<60;i++){int b=v->model.hr_history[(v->now-59+i)%60];if(b<=0)continue;int h=pb_clamp((b-40)*47/180,2,47);pb_fill(c,8+i*164/60,206-h,2,h,pb_zone(zone_for(v,b)),0);}
  PB_LABEL(c,"-60S",8,211,60,PB_MUTED);pb_text(c,"NOW",FONT_KEY_GOTHIC_14_BOLD,120,211,52,18,PB_MUTED,GTextAlignmentRight);
}
static void route_page(GContext *c, const WatchView *v) {
  const PaceletModel *model = &v->model;
  pb_text(c, "Route", FONT_KEY_GOTHIC_24_BOLD, 8, 27, 164, 35,
          PB_INK, GTextAlignmentLeft);
  if (!model->route_size) {
    const char *message = !model->phone_connected ? "Phone disconnected" :
        model->route_received ? "Waiting for GPS points" : "Loading route";
    pb_text(c, message, FONT_KEY_GOTHIC_18, 8, 115, 164, 30,
            PB_MUTED, GTextAlignmentCenter);
    return;
  }

  GPoint previous = GPointZero;
  for (unsigned i = 0; i < model->route_size; i += 2) {
    int x = 15 + model->route_points[i];
    uint8_t encoded_y = model->route_points[i + 1];
    int y = 70 + (encoded_y & 127);
    if (i && !(encoded_y & 128)) {
      pb_line(c, previous.x, previous.y, x, y, PB_TEAL, 3);
    }
    previous = GPoint(x, y);
  }
  graphics_context_set_fill_color(c, PB_INK);
  graphics_fill_circle(c, GPoint(previous.x, previous.y + pb_dy), 4);
  PB_LABEL(c, model->phone_connected ? "RECORDED GPS TRACK" : "LAST RECEIVED ROUTE",
           8, 207, 164, PB_MUTED);
}

static void history_status_icon(GContext *c, HistoryStravaStatus status, int y) {
  if (status == HistoryStravaUploaded) {
    pb_line(c, 9, y, 13, y + 4, PB_INK, 2);
    pb_line(c, 13, y + 4, 21, y - 5, PB_INK, 2);
  } else if (status == HistoryStravaUploading || status == HistoryStravaProcessing) {
    for (int x = 9; x <= 19; x += 5) pb_fill(c, x, y, 2, 2, PB_MUTED, 0);
  } else {
    GColor ink = status == HistoryStravaFailed ? PB_RED : PB_MUTED;
    pb_line(c, 10, y - 5, 20, y + 5, ink, 2);
    pb_line(c, 20, y - 5, 10, y + 5, ink, 2);
  }
}
static void history(GContext*c,const WatchView*v) {
  const PaceletModel*m=&v->model;
  if(m->history_loading){pb_text(c,"Loading history",FONT_KEY_GOTHIC_24_BOLD,8,60,164,70,PB_INK,GTextAlignmentCenter);return;}
  if(!m->history_count){pb_text(c,"No saved activities",FONT_KEY_GOTHIC_24_BOLD,8,60,164,70,PB_INK,GTextAlignmentCenter);PB_LABEL(c,m->history_message,8,151,164,PB_MUTED);return;}
  int first=m->history_selected_index>2?m->history_selected_index-2:0;
  for(int row=0;row<3;row++){int i=first+row,y=35+row*61;if(i>m->history_count)break;
    if(i==m->history_selected_index)pb_fill(c,0,y,180,58,PB_MIST,0);
    if(i==m->history_count){pb_text(c,"Back",FONT_KEY_GOTHIC_24_BOLD,8,y,164,32,PB_INK,GTextAlignmentLeft);continue;}
    const HistoryItem*item=&m->history_items[i];char dist[16],time[20],line[48];distance_text(dist,sizeof(dist),item->distance_m);duration_text(time,sizeof(time),item->moving_s);snprintf(line,sizeof(line),"%s KM   %s",dist,time);
    history_status_icon(c, item->strava_status, y + 21);
    pb_text(c, pacelet_activity_label(item->activity_type), FONT_KEY_GOTHIC_24_BOLD,
            29, y, 143, 32, PB_INK, GTextAlignmentLeft);
    PB_LABEL(c, line, 29, y + 34, 143, PB_MUTED);
    if(i!=m->history_selected_index)pb_line(c,8,y+58,172,y+58,PB_RULE,1);
  }
}
static void recovery(GContext*c,const WatchView*v) {
  pb_text(c,"Activity interrupted",FONT_KEY_GOTHIC_24_BOLD,8,34,164,38,PB_INK,GTextAlignmentLeft);pb_fill(c,0,82,180,69,PB_MIST,0);PB_LABEL(c,"RECORDED",8,84,164,PB_INK);
  char time[20],distance[16],line[50];duration_text(time,sizeof(time),v->model.recovery_moving_s);distance_text(distance,sizeof(distance),v->model.distance_m);
  pb_number(c,time,6,100,168,48,FONT_KEY_LECO_36_BOLD_NUMBERS,FONT_KEY_LECO_32_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
  snprintf(line,sizeof(line),"%s km on phone",distance);pb_text(c,line,FONT_KEY_GOTHIC_18,8,157,164,27,PB_MUTED,GTextAlignmentLeft);
  pb_text(c,v->model.recovery_message,FONT_KEY_GOTHIC_14_BOLD,8,183,164,38,PB_MUTED,GTextAlignmentLeft);
}
static void upload(GContext*c) {
  pb_fill(c,24,57,132,67,PB_MIST,5);
  pb_line(c,60,105,60,77,PB_INK,3);pb_line(c,60,77,52,85,PB_INK,3);pb_line(c,60,77,68,85,PB_INK,3);
  pb_text(c,"Sending\nto Strava",FONT_KEY_GOTHIC_24_BOLD,81,63,75,59,PB_INK,GTextAlignmentLeft);
  if(s_ui.effect==FxUpload&&s_ui.progress<1000){pb_fill(c,24,143,132,4,PB_RULE,0);pb_fill(c,24+pb_ease(s_ui.progress)*92/1000,143,40,4,PB_TEAL,0);}
  else for(int i=0;i<3;i++)pb_fill(c,76+i*12,143,5,5,PB_TEAL,2);
  pb_text(c,"Your activity is saved.",FONT_KEY_GOTHIC_18,8,170,164,27,PB_MUTED,GTextAlignmentCenter);
}
static void content(GContext*c,const WatchView*v) {
  pb_fill(c,0,22,180,206,PB_PAPER,0);
  switch(v->scene) {
    case ScenePicker:pb_picker(c,v->model.choose_index,s_ui.effect==FxPick?s_ui.from.model.choose_index:v->model.choose_index,s_ui.effect==FxPick?pb_ease(s_ui.progress):1000);break;
    case SceneGps:gps(c,v);break;
    case SceneCountdown:countdown(c,v);break;
    case SceneLive:live(c,v,false);break;
    case SceneLaps:laps(c,v);break;
    case SceneZones:zones(c,v);break;
    case SceneHeart:heart_page(c,v);break;
    case SceneRoute:route_page(c,v);break;
    case SceneRecap:live(c,v,true);break;
    case SceneUpload:upload(c);break;
    case SceneHistory:history(c,v);break;
    case SceneDetail:{
      if(v->model.history_selected_index>=v->model.history_count)break;
      WatchView *detail=&s_ui.pending;*detail=*v;const HistoryItem*item=&v->model.history_items[v->model.history_selected_index];
      detail->model.activity_type=item->activity_type;detail->model.summary_distance_m=item->distance_m;detail->model.distance_m=item->distance_m;detail->model.summary_moving_s=item->moving_s;detail->elapsed=item->moving_s;detail->model.summary_avg_hr=item->avg_hr;detail->model.hr_count=0;memcpy(detail->model.zone_s,item->zone_s,sizeof(item->zone_s));live(c,detail,true);
      pb_fill(c,0,161,180,38,PB_PAPER,0);PB_LABEL(c,pacelet_history_status_label(item->strava_status),8,162,164,PB_INK);PB_LABEL(c,v->model.history_message,8,178,164,PB_MUTED);break;
    }
    default:recovery(c,v);break;
  }
}
static void split(GContext*c,const WatchView*v) {
  pb_fill(c,0,22,180,177,PB_MIST,0);char label[32],value[20];snprintf(label,sizeof(label),"KILOMETRE %ld",(long)v->model.split_number);PB_LABEL(c,label,8,28,164,PB_INK);
  duration_text(value,sizeof(value),v->model.split_elapsed_s);pb_number(c,value,4,49,172,73,FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_42_NUMBERS,PB_INK,GTextAlignmentCenter);
  if(v->model.activity_type==ActivityTypeCycling){char speed[16];speed_text(speed,sizeof(speed),v->model.split_elapsed_s>0?100000/v->model.split_elapsed_s:0);snprintf(label,sizeof(label),"%s KM/H AVERAGE",speed);}
  else if(v->model.previous_split_s>0){int delta=v->model.split_elapsed_s-v->model.previous_split_s;snprintf(label,sizeof(label),"%d SEC %s",delta<0?-delta:delta,delta<0?"FASTER":delta>0?"SLOWER":"CHANGE");}
  else snprintf(label,sizeof(label),"FIRST KILOMETRE");
  pb_text(c,label,FONT_KEY_GOTHIC_18_BOLD,8,132,164,27,PB_INK,GTextAlignmentCenter);
  if(v->model.previous_split_s>0&&v->model.activity_type!=ActivityTypeCycling)PB_LABEL(c,"THAN THE PREVIOUS KM",19,158,150,PB_MUTED);
  hr_band(c,v,false);
}
static void sheet(GContext*c,const WatchView*v) {
  PaceletOverlay overlay=v->model.overlay;if(overlay==OverlayNone)return;
  if(overlay==OverlaySplit){split(c,v);return;}
  bool leave=overlay==OverlayExit,discard=overlay==OverlayDiscard;
  pb_fill(c,0,22,180,206,PB_PAPER,0);pb_fill(c,8,39,164,4,leave?PB_MIST:PB_CORAL,0);
  pb_text(c,leave?(v->model.upload_pending?"Upload in\nprogress":"Saving on\nphone"):discard?"Delete activity?":"Finish activity?",FONT_KEY_GOTHIC_28_BOLD,8,57,164,68,PB_INK,GTextAlignmentLeft);
  pb_text(c,leave?"Leaving may pause\nstatus checks. Strava\nmay still finish.":discard?"This cannot be undone.":"Save this activity.",FONT_KEY_GOTHIC_18,8,135,164,64,PB_MUTED,GTextAlignmentLeft);
  PB_LABEL(c,leave?"UP LEAVE / DOWN STAY":discard?"UP DELETE / DOWN KEEP":"UP SAVE / DOWN KEEP",8,207,164,PB_INK);
}
static void render_content(GContext*c,int origin) {
  pb_dy=origin;int e=pb_ease(s_ui.progress);
  if(s_ui.effect==FxPush){pb_dy=origin-206*e/1000;content(c,&s_ui.from);pb_dy=origin+206*(1000-e)/1000;content(c,&s_ui.view);}
  else if(s_ui.effect==FxStart){
    pb_dy=origin+(1000-e)*90/1000;content(c,&s_ui.view);pb_dy=origin;
    pb_fill(c,0,22,180,88,PB_PAPER,0);int x=pb_lerp(30,0,e),y=pb_lerp(COUNTDOWN_CENTRE_Y-COUNTDOWN_RADIUS,22,e),w=pb_lerp(120,180,e),h=pb_lerp(120,88,e);
    pb_fill(c,x,y,w,h,PB_MIST,pb_lerp(60,0,e));
    if(s_ui.progress<500)pb_text(c,"GO",FONT_KEY_BITHAM_42_BOLD,x,y+h/2-26,w,60,PB_INK,GTextAlignmentCenter);
    else {
      char hero[20];const char*label=hero_value(&s_ui.view,false,hero,sizeof(hero));
      PB_LABEL(c,label,8,25,164,PB_INK);
      pb_number(c,hero,4,35,172,73,FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_42_NUMBERS,PB_INK,GTextAlignmentCenter);
    }
  }else if(s_ui.effect==FxSave&&s_ui.progress<450){
    pb_fill(c,0,22,180,206,PB_PAPER,0);pb_fill(c,48,42,84,84,PB_MIST,42);
    int a=pb_clamp(s_ui.progress*1000/450,0,1000);pb_line(c,65,83,65+18*a/1000,83+18*a/1000,PB_INK,4);if(a>450)pb_line(c,83,101,83+(a-450)*35/550,101-(a-450)*45/550,PB_INK,4);
    pb_text(c,"Saved",FONT_KEY_GOTHIC_28_BOLD,8,146,164,38,PB_INK,GTextAlignmentCenter);
  }else if(s_ui.effect==FxSave){
    pb_fill(c,0,22,180,206,PB_PAPER,0);pb_fill(c,48,42,84,84,PB_MIST,42);
    pb_line(c,65,83,83,101,PB_INK,4);pb_line(c,83,101,118,56,PB_INK,4);
    pb_text(c,"Saved",FONT_KEY_GOTHIC_28_BOLD,8,146,164,38,PB_INK,GTextAlignmentCenter);
    int q=pb_clamp((s_ui.progress-450)*1000/550,0,1000);
    pb_dy=origin+(1000-pb_ease(q))*206/1000;content(c,&s_ui.view);
  }else content(c,&s_ui.view);
  pb_dy=origin;
  if(s_ui.effect==FxPause&&s_ui.progress<1000)pb_fill(c,0,110,180*(1000-e)/1000,2,PB_AMBER,0);
  if(s_ui.effect==FxSave&&s_ui.progress>200&&s_ui.progress<850)for(int i=0;i<12;i++){int p=s_ui.progress;pb_fill(c,90+((i*37)%151-75)*p/1000,38+((i*17)%41)*p/1000+p*p/24000,3,4,i%2?PB_TEAL:PB_AMBER,0);}
}
static void render_overlay(GContext*c,int origin) {
  pb_dy=origin;
  if(s_ui.effect==FxSheet)pb_dy+=206*(1000-pb_ease(s_ui.progress))/1000;
  if(s_ui.effect==FxSplitOut){pb_dy+=206*pb_ease(s_ui.progress)/1000;sheet(c,&s_ui.from);}else sheet(c,&s_ui.view);
  pb_dy=0;
}
static void draw_content(Layer*layer,GContext*c){render_content(c,-22);}
static void draw_overlay(Layer*layer,GContext*c){render_overlay(c,-22);}
static void draw_header(Layer*layer,GContext*c) {
  const WatchView*v=&s_ui.view;const PaceletModel*m=&v->model;pb_dy=0;pb_fill(c,0,0,180,22,PB_PAPER,0);
  const char*mode=v->scene==ScenePicker?"PACELET":v->scene==SceneHistory||v->scene==SceneDetail?"HIST":pacelet_activity_short_label(m->activity_type);
  char clock[12],status[16];struct tm*tm=localtime(&v->now);strftime(clock,sizeof(clock),clock_is_24h_style()?"%H:%M":"%I:%M",tm);
  snprintf(status,sizeof(status),"%s",m->low_battery?"LOW BAT":!m->phone_connected?"OFFLINE":m->activity_state==ActivityStatePaused?"PAUSED":m->activity_state==ActivityStateFinished?(m->pending_command?"SAVING":v->scene==SceneUpload?"STRAVA":"SAVED"):v->scene==SceneLaps?"LAPS":v->scene==SceneZones?"ZONES":v->scene==SceneHeart?"TRACE":v->scene==SceneRoute?"ROUTE":v->scene==SceneGps?(m->gps_state==GpsStateLocked?"READY":m->gps_state==GpsStateError?"GPS ERR":"GPS"):v->scene==SceneRecovery?"RECOVER":"");
  if(m->overlay==OverlayFinish)snprintf(status,sizeof(status),"FINISH?");
  if(m->overlay==OverlayDiscard)snprintf(status,sizeof(status),"DELETE?");
  if(m->overlay==OverlaySplit)snprintf(status,sizeof(status),"SPLIT");
  PB_LABEL(c,mode,7,1,54,PB_INK);pb_text(c,clock,FONT_KEY_GOTHIC_18_BOLD,55,-3,70,23,PB_INK,GTextAlignmentCenter);pb_text(c,status,FONT_KEY_GOTHIC_14_BOLD,120,1,54,18,PB_MUTED,GTextAlignmentRight);
  pb_fill(c,0,20,180,2,m->overlay==OverlayFinish||m->overlay==OverlayDiscard?PB_CORAL:m->activity_state==ActivityStatePaused?PB_AMBER:PB_TEAL,0);
}
static void draw_rail(Layer*layer,GContext*c) {
  // This layer's bounds use native screen coordinates.
  const WatchView*v=&s_ui.view;const PaceletModel*m=&v->model;int up=I_NONE,sel=I_NONE,down=I_NONE;pb_dy=0;
  if(m->overlay==OverlayFinish||m->overlay==OverlayDiscard){up=I_CHECK;down=I_BACK;}
  else if(m->overlay==OverlayExit){up=I_DELETE;down=I_BACK;}
  else if(m->activity_state==ActivityStateFinished&&m->pending_command==MESSAGE_KEY_FINISH_ACTIVITY){}
  else if(v->scene==ScenePicker||v->scene==SceneHistory){up=I_UP;sel=I_PLAY;down=I_DOWN;}
  else if(v->scene==SceneGps){up=I_RETRY;sel=m->gps_state==GpsStateLocked?I_PLAY:I_RETRY;down=I_DOWN;}
  else if(live_state(m->activity_state)){up=m->activity_state==ActivityStatePaused?I_PLAY:I_PAUSE;sel=m->page||m->overlay==OverlaySplit?I_BACK:m->activity_state==ActivityStatePaused?I_STOP:I_NONE;down=I_PAGES;}
  else if(v->scene==SceneRecap||v->scene==SceneUpload){up=I_PLAY;sel=I_FILE;down=I_BACK;}
  else if(v->scene==SceneDetail){up=I_FILE;sel=I_RETRY;down=I_BACK;}
  else if(v->scene==SceneRecovery){up=m->recovery_phone_draft_available?I_PLAY:I_NONE;sel=m->recovery_phone_draft_available?I_STOP:I_NONE;down=I_DELETE;}
  pb_fill(c,180,0,20,228,PB_INK,0);pb_icon(c,up,57,PB_PAPER);pb_icon(c,sel,114,PB_PAPER);pb_icon(c,down,171,PB_PAPER);
}
static void cancel_motion(void) {
  if(s_ui.timer){app_timer_cancel(s_ui.timer);s_ui.timer=NULL;}
  s_ui.effect=FxNone;s_ui.progress=1000;
}
static bool optional_motion(void){return s_ui.view.model.motion_mode==MotionFull&&!s_ui.view.model.low_battery;}
static void dirty_layers(void){layer_mark_dirty(s_ui.content);layer_mark_dirty(s_ui.overlay);}
static void frame(void*data) {
  s_ui.timer=NULL;if(!s_ui.loaded||!s_ui.focused)return;
  uint32_t elapsed=clock_ms()-s_ui.began;
  s_ui.progress=elapsed>=s_ui.duration?1000:elapsed*1000/s_ui.duration;
  if(s_ui.effect==FxOrbit||(s_ui.effect==FxFix&&clock_ms()-s_ui.gps_began<15000))
    s_ui.orbit_angle=(clock_ms()-s_ui.gps_began)%10200*360/10200;
  if(s_ui.progress==1000){s_ui.effect=FxNone;
    if(s_ui.view.scene==SceneGps&&s_ui.view.model.gps_state==GpsStateSearching&&optional_motion()&&clock_ms()-s_ui.gps_began<15000){s_ui.effect=FxOrbit;s_ui.began=clock_ms();s_ui.duration=15000-(clock_ms()-s_ui.gps_began);s_ui.progress=0;}
  }
  dirty_layers();
  if(s_ui.effect!=FxNone)s_ui.timer=app_timer_register(33,frame,NULL);
}
static void begin_motion(Effect effect,uint32_t duration) {
  cancel_motion();if(effect==FxNone)return;
  if(!s_ui.focused||s_ui.view.model.motion_mode==MotionOff)return;
  if(s_ui.view.model.low_battery||s_ui.view.model.motion_mode==MotionKeyMoments) {
    if(effect!=FxLock&&effect!=FxCount&&effect!=FxStart&&effect!=FxSheet&&effect!=FxSplitOut&&effect!=FxSave)return;
  }
  s_ui.effect=effect;s_ui.duration=duration;s_ui.began=clock_ms();s_ui.progress=0;s_ui.timer=app_timer_register(33,frame,NULL);
}
void watch_ui_mark_dirty(void) {
  if(!s_ui.loaded)return;
  WatchView *next=&s_ui.pending;capture_view(next);
  s_ui.previous=s_ui.view;
  const WatchView *previous=&s_ui.previous;
  if(next->model.motion_mode!=previous->model.motion_mode ||
     (next->model.low_battery&&!previous->model.low_battery)) cancel_motion();
  Effect effect=FxNone;uint32_t duration=240;
  bool state_change=next->model.activity_state!=previous->model.activity_state;
  bool overlay_change=next->model.overlay!=previous->model.overlay;
  if(state_change||next->scene!=previous->scene||overlay_change||next->model.choose_index!=previous->model.choose_index||next->model.countdown_value!=previous->model.countdown_value) {
    int picker_y=s_ui.effect==FxPick?pb_lerp(s_ui.picker_from_y,37+previous->model.choose_index*44,pb_ease(s_ui.progress)):37+previous->model.choose_index*44;
    if(s_ui.effect==FxOrbit||(s_ui.effect==FxFix&&clock_ms()-s_ui.gps_began<15000))s_ui.orbit_angle=(clock_ms()-s_ui.gps_began)%10200*360/10200;
    s_ui.from=*previous;s_ui.picker_from_y=picker_y;
    if(next->scene==SceneGps&&previous->scene!=SceneGps){s_ui.gps_began=clock_ms();effect=next->model.gps_state==GpsStateLocked?FxLock:FxOrbit;duration=next->model.gps_state==GpsStateLocked?480:15000;}
    else if(next->scene==SceneGps&&next->model.gps_state==GpsStateSearching&&previous->model.gps_state!=GpsStateSearching){s_ui.gps_began=clock_ms();effect=FxOrbit;duration=15000;}
    else if(next->scene==SceneGps&&next->model.gps_state==GpsStateLocked&&previous->model.gps_state!=GpsStateLocked){effect=FxLock;duration=480;}
    else if(next->model.overlay!=OverlayNone){effect=FxSheet;duration=next->model.overlay==OverlaySplit?280:240;}
    else if(previous->model.overlay==OverlaySplit&&!state_change){effect=FxSplitOut;duration=240;}
    else if(next->scene==SceneUpload){effect=FxUpload;duration=720;}
    else if(next->scene==SceneCountdown){effect=FxCount;duration=1000;}
    else if(next->model.activity_state==ActivityStateActive&&previous->scene==SceneCountdown){effect=FxStart;duration=440;}
    else if(next->scene==SceneRecap&&next->model.pending_command==0&&previous->model.pending_command!=0){effect=FxSave;duration=760;}
    else if(next->scene==ScenePicker&&previous->scene==ScenePicker){effect=FxPick;duration=240;}
    else if(live_state(next->model.activity_state)&&live_state(previous->model.activity_state)&&state_change){effect=FxPause;duration=200;}
    else if(next->scene!=previous->scene){effect=FxPush;duration=240;}
    s_ui.view=*next;s_ui.radius_from=visible_gps_radius(previous);s_ui.radius_to=gps_radius(next->model.gps_accuracy_m);begin_motion(effect,duration);
  }else {
    s_ui.view=*next;
    if(next->scene==SceneGps&&next->model.gps_state!=previous->model.gps_state){s_ui.from=*previous;s_ui.radius_from=visible_gps_radius(previous);if(next->model.gps_state==GpsStateSearching){s_ui.gps_began=clock_ms();begin_motion(FxOrbit,15000);}
      else begin_motion(next->model.gps_state==GpsStateLocked?FxLock:FxNone,480);}
    else if(next->scene==SceneGps&&next->model.gps_state==GpsStateSearching&&next->model.gps_accuracy_m!=previous->model.gps_accuracy_m&&optional_motion()){s_ui.radius_from=visible_gps_radius(previous);s_ui.radius_to=gps_radius(next->model.gps_accuracy_m);begin_motion(FxFix,320);}
    else if(next->scene==SceneRecap&&previous->model.pending_command&&!next->model.pending_command){s_ui.from=*previous;begin_motion(FxSave,760);}
    else if(s_ui.effect==FxNone&&next->scene==SceneLive&&next->model.display_zone!=previous->model.display_zone){s_ui.from=*previous;begin_motion(FxZone,320);}
    else if(s_ui.effect==FxNone&&next->scene==SceneLive&&next->model.last_hr_update_at!=previous->model.last_hr_update_at&&next->model.last_hr_bpm>0)begin_motion(FxHr,120);
  }
  dirty_layers();layer_mark_dirty(s_ui.header);layer_mark_dirty(s_ui.rail);
}
void watch_ui_set_focus(bool focused) {
  s_ui.focused=focused;cancel_motion();if(focused&&s_ui.loaded){capture_view(&s_ui.view);dirty_layers();}
}
void watch_ui_apply_theme(void){if(s_ui.window)window_set_background_color(s_ui.window,PB_PAPER);watch_ui_mark_dirty();}
void watch_ui_load(Window*window) {
  memset(&s_ui,0,sizeof(s_ui));s_ui.window=window;s_ui.focused=true;s_ui.progress=1000;capture_view(&s_ui.view);
  Layer*root=window_get_root_layer(window);
  s_ui.content=layer_create(GRect(0,22,180,206));layer_set_update_proc(s_ui.content,draw_content);layer_add_child(root,s_ui.content);
  s_ui.overlay=layer_create(GRect(0,22,180,206));layer_set_update_proc(s_ui.overlay,draw_overlay);layer_add_child(root,s_ui.overlay);
  s_ui.header=layer_create(GRect(0,0,180,22));layer_set_update_proc(s_ui.header,draw_header);layer_add_child(root,s_ui.header);
  s_ui.rail=layer_create(GRect(0,0,200,228));layer_set_update_proc(s_ui.rail,draw_rail);layer_add_child(root,s_ui.rail);
  s_ui.loaded=true;watch_ui_apply_theme();
}
void watch_ui_unload(void) {
  s_ui.loaded=false;cancel_motion();layer_destroy(s_ui.rail);layer_destroy(s_ui.header);layer_destroy(s_ui.overlay);layer_destroy(s_ui.content);s_ui.window=NULL;
}
