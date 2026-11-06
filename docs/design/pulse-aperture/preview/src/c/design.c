#include "lab.h"
#include <string.h>

// Native Pebble primitives and system fonts, shared fixtures for both layouts.
// This preview is separate from Pacelet's production UI and sensor state.
void lab_data_refresh(LabData *d) { (void)d; }
void lab_release_shared(void) {}
typedef struct { GColor bg, ink, mute, rule, accent, zone, zi, rail, ri; } Palette;
static Palette pal(bool dark, int zone) {
  const uint32_t light[] = {0xAAFFFF,0xAAFF55,0xFFAA00,0xFF0055};
  const uint32_t night[] = {0x005555,0x00AA55,0xFFAA00,0xAA0000};
  return (Palette){dark?GColorBlack:GColorWhite, dark?GColorWhite:GColorBlack,
    GColorFromHEX(dark?0xAAAAAA:0x555555), GColorFromHEX(dark?0x555555:0xAAAAAA),
    GColorFromHEX(dark?0xFF5555:0xAA0055), GColorFromHEX((dark?night:light)[zone]),
    dark && (zone==0 || zone==3)?GColorWhite:GColorBlack,
    dark?GColorWhite:GColorBlack, dark?GColorBlack:GColorWhite};
}
static void fill(GContext *c,int x,int y,int w,int h,GColor col) {
  graphics_context_set_fill_color(c,col); graphics_fill_rect(c,GRect(x,y,w,h),0,GCornerNone);
}
static void text(GContext *c,const char *v,const char *font,int x,int y,int w,int h,GColor col,GTextAlignment a) {
  graphics_context_set_text_color(c,col);
  graphics_draw_text(c,v,fonts_get_system_font(font),GRect(x,y,w,h),GTextOverflowModeTrailingEllipsis,a,NULL);
}
#define LABEL(c,v,x,y,w,col) text(c,v,FONT_KEY_GOTHIC_14_BOLD,x,y,w,18,col,GTextAlignmentLeft)
static void line(GContext *c,int x,int y,int xx,int yy,GColor col,int weight) {
  graphics_context_set_stroke_color(c,col); graphics_context_set_stroke_width(c,weight);
  graphics_draw_line(c,GPoint(x,y),GPoint(xx,yy)); graphics_context_set_stroke_width(c,1);
}
static void chrome(GContext *c,Palette p,const char *mode,const char *state,bool paused) {
  fill(c,0,0,180,22,p.bg);
  LABEL(c,mode,8,1,48,p.mute);
  text(c,"10:45",FONT_KEY_GOTHIC_18_BOLD,53,-3,74,23,p.ink,GTextAlignmentCenter);
  text(c,state,FONT_KEY_GOTHIC_14_BOLD,126,1,48,18,p.mute,GTextAlignmentRight);
  fill(c,0,20,180,2,p.accent); fill(c,180,0,20,228,p.rail);
  if (paused) {
    line(c,186,51,195,57,p.ri,2); line(c,195,57,186,63,p.ri,2); line(c,186,51,186,63,p.ri,2);
    fill(c,185,109,10,10,p.ri);
  } else { fill(c,185,51,3,12,p.ri); fill(c,192,51,3,12,p.ri); }
  for(int i=0;i<3;i++) { graphics_context_set_stroke_color(c,p.ri);graphics_context_set_fill_color(c,p.ri);
    if(i==0)graphics_fill_circle(c,GPoint(190,164+i*7),2);else graphics_draw_circle(c,GPoint(190,164+i*7),2); }
}
static const char *fit(const char *value,int width,const char *large,const char *small) {
  GSize s=graphics_text_layout_get_content_size(value,fonts_get_system_font(large),GRect(0,0,500,70),GTextOverflowModeWordWrap,GTextAlignmentLeft);
  return s.w<=width?large:small;
}
static void metric(GContext *c,Palette p,const char *label,const char *value,int x,int y) {
  LABEL(c,label,x,y,82,p.mute);
  const char *font=fit(value,80,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_20_BOLD_NUMBERS);
  font=fit(value,80,font,FONT_KEY_GOTHIC_18_BOLD);
  text(c,value,font,x-2,y+15,82,32,p.ink,GTextAlignmentLeft);
}
static void heart(GContext *c,int x,int y,GColor ink) {
  // A static icon: the preview never implies knowledge of beat timing.
  const char *rows[]={".##.##.","#######","#######",".#####.","..###..","...#..."};
  for(int j=0;j<6;j++)for(int i=0;i<7;i++)if(rows[j][i]=='#')fill(c,x+i*2,y+j*2,2,2,ink);
}
static void badge(GContext *c,Palette p,int x,int y,int z,bool stale) {
  fill(c,x,y,28,19,p.zi);
  const char *zones[]={"Z0","Z1","Z2","Z3"};
  text(c,stale?"Z-":zones[z],FONT_KEY_GOTHIC_14_BOLD,x,y-1,28,18,p.zone,GTextAlignmentCenter);
  for(int i=0;i<3;i++) {
    if(i<z&&!stale)fill(c,x+i*10,y+23,7,4,p.zi);
    else { graphics_context_set_stroke_color(c,p.zi);graphics_draw_rect(c,GRect(x+i*10,y+23,7,4)); }
  }
}
static void ring(GContext *c,Palette p,int cx,int cy,int r,int progress,const char *km,bool on_field) {
  GColor bg=on_field?p.zone:p.bg, ink=on_field?p.zi:p.ink;
  graphics_context_set_fill_color(c,on_field?p.zi:p.rule);
  graphics_fill_radial(c,GRect(cx-r,cy-r,r*2,r*2),GOvalScaleModeFitCircle,4,0,TRIG_MAX_ANGLE);
  graphics_context_set_fill_color(c,on_field?p.zone:p.accent);
  graphics_fill_radial(c,GRect(cx-r,cy-r,r*2,r*2),GOvalScaleModeFitCircle,4,0,DEG_TO_TRIGANGLE(progress*360/1000));
  for(int i=0;i<10;i++) {
    graphics_context_set_fill_color(c,bg);
    graphics_fill_radial(c,GRect(cx-r-1,cy-r-1,r*2+2,r*2+2),GOvalScaleModeFitCircle,6,DEG_TO_TRIGANGLE(i*36-2),DEG_TO_TRIGANGLE(i*36+2));
  }
  text(c,"KM",FONT_KEY_GOTHIC_14_BOLD,cx-18,cy-20,36,18,ink,GTextAlignmentCenter);
  text(c,km,(r<30 && strlen(km)>2)?FONT_KEY_GOTHIC_18_BOLD:FONT_KEY_LECO_20_BOLD_NUMBERS,cx-r+5,cy-3,r*2-10,25,ink,GTextAlignmentCenter);
}
static void trace(GContext *c,Palette p,int width,bool paused,bool stale) {
  if(stale) { LABEL(c,"MEASURING",10,192,100,p.zi);return; }
  for(int y=185;y<212;y+=13)for(int x=10;x<width;x+=5)fill(c,x,y,2,1,p.zi);
  int previous=201;
  for(int i=1;i<30;i++) {
    int next=paused?201:201-i/3+(i%7<3?-3:2);
    line(c,10+(i-1)*(width-10)/29,previous,10+i*(width-10)/29,next,p.zi,2);previous=next;
  }
}
static void live(GContext *c,bool aperture,bool dark,bool worst,bool walk,bool stale,bool paused) {
  int zone=(dark||worst)?3:2; Palette p=pal(dark,zone);
  if(stale){ p.zone=GColorFromHEX(0xAAAAAA);p.zi=GColorBlack; }
  fill(c,0,0,200,228,p.bg);
  chrome(c,p,walk?"WALK":dark?"RIDE":"RUN",paused?"PAUSED":stale?"OFFLINE":"GPS 8M",paused);
  const char *duration=worst?(walk?"12:59:59":"1:23:45"):"23:14";
  const char *primary=walk?duration:stale?(dark?"--.-":"--:--"):dark?"35.6":worst?"99:59":"5:02";
  LABEL(c,walk?"ELAPSED":dark?"SPEED KM/H":"PACE /KM",8,25,164,p.mute);
  text(c,primary,fit(primary,168,FONT_KEY_LECO_42_NUMBERS,FONT_KEY_LECO_32_BOLD_NUMBERS),4,39,172,47,p.ink,GTextAlignmentLeft);
  metric(c,p,"DISTANCE KM",worst?"128.74":"4.62",8,85);
  metric(c,p,walk?"STEPS":"ELAPSED",walk?"123456":duration,98,85);
  line(c,90,90,90,127,p.rule,1);
  fill(c,aperture?6:0,135,aperture?94:180,aperture?70:93,p.zone);
  heart(c,10,145,p.zi);
  if(aperture) {
    badge(c,p,66,141,zone,stale);
    text(c,stale?"--":worst?"188":dark?"171":"152",FONT_KEY_LECO_32_BOLD_NUMBERS,8,163,90,40,p.zi,GTextAlignmentLeft);
    LABEL(c,"LAST KM",109,139,68,p.mute);
    text(c,worst?"59:59":dark?"1:41":"5:07",FONT_KEY_GOTHIC_24_BOLD,108,164,68,32,p.ink,GTextAlignmentLeft);
    LABEL(c,"-0:09",109,192,68,p.mute);
  } else {
    text(c,stale?"--":worst?"188":dark?"171":"152",FONT_KEY_LECO_32_BOLD_NUMBERS,31,136,88,43,p.zi,GTextAlignmentLeft);
    badge(c,p,140,143,zone,stale);
    trace(c,p,168,paused,stale);
    LABEL(c,worst?"LAST KM 59:59":dark?"LAST KM 1:41":"LAST KM 5:07",8,212,118,p.zi);
    text(c,"10 MIN",FONT_KEY_GOTHIC_14_BOLD,126,212,46,18,p.zi,GTextAlignmentRight);

  }
}
static void split(GContext *c,bool aperture,int radius) {
  Palette p=pal(false,2);GColor plate=aperture?p.accent:p.zone,ink=aperture?GColorWhite:p.zi;
  fill(c,0,22,180,206,plate);
  LABEL(c,"KILOMETRE 5",8,27,110,ink);LABEL(c,"-0:09",128,27,48,ink);
  text(c,"4:58",FONT_KEY_LECO_42_NUMBERS,3,56,174,54,ink,GTextAlignmentCenter);
  if(!aperture){
    int pts[][2]={{8,119},{56,119},{64,113},{71,126},{79,103},{86,136},{94,119},{172,119}};
    for(int i=1;i<8;i++)line(c,pts[i-1][0],pts[i-1][1],pts[i][0],pts[i][1],ink,2);
  }else line(c,8,124,172,124,ink,1);
  LABEL(c,"PACE /KM",8,140,80,ink);heart(c,100,145,ink);
  text(c,"4:58",FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,6,157,82,36,ink,GTextAlignmentLeft);
  text(c,"154",FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,96,157,78,36,ink,GTextAlignmentLeft);
  for(int i=0;i<6;i++)fill(c,55+i*12,210,7,4,ink);
  if(radius>0){graphics_context_set_fill_color(c,p.bg);
    graphics_fill_radial(c,GRect(90-320,180-320,640,640),GOvalScaleModeFitCircle,320-radius,0,TRIG_MAX_ANGLE);}
  chrome(c,p,"RUN","SPLIT",false);
}
#define LIVE(name,a,d,w,k,s,p) static void draw_##name(GContext*c,GRect b,const LabData*x){live(c,a,d,w,k,s,p);} const LabDesign name={#name,NULL,NULL,draw_##name};
LIVE(pulse_live,0,0,0,0,0,0) LIVE(aperture_live,1,0,0,0,0,0)
LIVE(pulse_dark,0,1,0,0,0,0) LIVE(aperture_dark,1,1,0,0,0,0)
LIVE(pulse_long,0,0,1,0,0,0) LIVE(aperture_long,1,0,1,0,0,0)
LIVE(pulse_walk,0,0,1,1,0,0) LIVE(aperture_walk,1,0,1,1,0,0)
LIVE(pulse_stale,0,0,0,0,1,0) LIVE(aperture_stale,1,0,0,0,1,0)
LIVE(pulse_paused,0,0,0,0,0,1) LIVE(aperture_paused,1,0,0,0,0,1)
#define SPLIT(name,a,r) static void draw_##name(GContext*c,GRect b,const LabData*x){split(c,a,r);} const LabDesign name={#name,NULL,NULL,draw_##name};
SPLIT(pulse_split,0,0) SPLIT(aperture_split,1,0)
SPLIT(split_iris1,0,35) SPLIT(split_iris2,0,105) SPLIT(split_iris3,0,190)
static void draw_countdown(GContext*c,GRect b,const LabData*d){
 Palette p=pal(false,2);fill(c,0,0,200,228,p.bg);chrome(c,p,"RUN","READY",false);
 graphics_context_set_fill_color(c,p.rule);
 graphics_fill_radial(c,GRect(25,52,130,130),GOvalScaleModeFitCircle,6,0,TRIG_MAX_ANGLE);
 graphics_context_set_fill_color(c,p.accent);
 graphics_fill_radial(c,GRect(25,52,130,130),GOvalScaleModeFitCircle,6,0,DEG_TO_TRIGANGLE(240));
 text(c,"2",FONT_KEY_LECO_42_NUMBERS,40,87,100,55,p.ink,GTextAlignmentCenter);
 LABEL(c,"STARTING IN",54,187,100,p.mute);
}
const LabDesign countdown={"countdown",NULL,NULL,draw_countdown};
static void draw_saved(GContext*c,GRect b,const LabData*d){
 Palette p=pal(false,2);fill(c,0,0,200,228,p.bg);chrome(c,p,"RUN","SAVED",false);
 text(c,"Nice run.",FONT_KEY_GOTHIC_28_BOLD,8,31,164,38,p.ink,GTextAlignmentLeft);
 text(c,"23:14",FONT_KEY_LECO_42_NUMBERS,4,58,172,50,p.ink,GTextAlignmentLeft);
 metric(c,p,"DISTANCE KM","4.62",8,110);metric(c,p,"PACE /KM","5:02",98,110);
 LABEL(c,"TIME IN ZONES",8,162,160,p.mute);
 const int widths[]={4,30,115,15};const int zones[]={0xAAFFFF,0xAAFF55,0xFFAA00,0xFF0055};int x=8;
 for(int i=0;i<4;i++){fill(c,x,187,widths[i],18,GColorFromHEX(zones[i]));x+=widths[i];}
 LABEL(c,"Z0   Z1       Z2        Z3",8,207,164,p.mute);
}
const LabDesign saved={"saved",NULL,NULL,draw_saved};
static void draw_upload(GContext*c,GRect b,const LabData*d){
 Palette p=pal(false,2);fill(c,0,0,200,228,p.bg);chrome(c,p,"STRAVA","BUSY",false);
 text(c,"Upload in\nprogress",FONT_KEY_GOTHIC_28_BOLD,8,31,164,64,p.ink,GTextAlignmentLeft);
 text(c,"Leave anyway?",FONT_KEY_GOTHIC_24_BOLD,8,105,164,32,p.ink,GTextAlignmentLeft);
 text(c,"Status checks may pause.\nStrava may still finish.",FONT_KEY_GOTHIC_18,8,144,164,55,p.mute,GTextAlignmentLeft);
 LABEL(c,"UP LEAVE  DOWN STAY",8,205,164,p.ink);
}
const LabDesign upload={"upload",NULL,NULL,draw_upload};

// C: original Pacelet study informed by PebbleOS Workout's hierarchy and pages.
// Uses only metrics Pacelet can actually record; no speculative cadence/SpO2.
static void zone_scale(GContext *c,Palette p,int y,int bpm) {
  const int bounds[]={40,100,130,160,200};
  int z=bpm<100?0:bpm<130?1:bpm<160?2:3;
  for(int i=0;i<4;i++){
    graphics_context_set_stroke_color(c,p.zi);
    if(i==z) fill(c,12+i*40,y,36,5,p.zi);
    else graphics_draw_rect(c,GRect(12+i*40,y,36,5));
  }
  int fraction=(bpm-bounds[z])*35/(bounds[z+1]-bounds[z]);
  if(fraction<0)fraction=0;if(fraction>35)fraction=35;
  int x=12+z*40+fraction;
  line(c,x,y-3,x,y-9,p.zi,3);line(c,x-3,y-6,x,y-3,p.zi,2);line(c,x+3,y-6,x,y-3,p.zi,2);
}
static void workout_live(GContext*c,bool dark,bool worst,bool walk,bool stale,bool paused){
  live(c,true,dark,worst,walk,stale,paused);
  Palette p=pal(dark,(dark||worst)?3:2);
  p.accent=GColorFromHEX(walk?0x00AAAA:dark?0xAA55FF:0x0055FF);
  if(stale){p.zone=GColorFromHEX(0xAAAAAA);p.zi=GColorBlack;}
  fill(c,0,132,180,96,p.bg);
  line(c,8,132,172,132,p.rule,1);
  fill(c,0,137,180,72,p.zone);
  heart(c,12,151,p.zi);
  text(c,stale?"--":worst?"188":dark?"171":"152",FONT_KEY_LECO_32_BOLD_NUMBERS,34,139,92,42,p.zi,GTextAlignmentLeft);
  badge(c,p,137,143,(dark||worst)?3:2,stale);
  if(!stale)zone_scale(c,p,194,worst?188:dark?171:152);
  else LABEL(c,"MEASURING",12,186,140,p.zi);
  LABEL(c,worst?"LAST KM 59:59":dark?"LAST KM 1:41":"LAST KM 5:07",8,210,132,p.mute);
  chrome(c,p,walk?"WALK":dark?"RIDE":"RUN",paused?"PAUSED":stale?"OFFLINE":"GPS 8M",paused);
  if(paused){
    fill(c,0,22,180,19,GColorFromHEX(0xFFAA00));
    text(c,"PAUSED  1:08",FONT_KEY_GOTHIC_14_BOLD,8,22,164,18,GColorBlack,GTextAlignmentLeft);
  }
}
#define WORKOUT(name,d,w,k,s,p) static void draw_##name(GContext*c,GRect b,const LabData*x){workout_live(c,d,w,k,s,p);} const LabDesign name={#name,NULL,NULL,draw_##name};
WORKOUT(workout_main,0,0,0,0,0) WORKOUT(workout_dark,1,0,0,0,0)
WORKOUT(workout_long,0,1,0,0,0) WORKOUT(workout_walk,0,1,1,0,0)
WORKOUT(workout_stale,0,0,0,1,0) WORKOUT(workout_paused,0,0,0,0,1)
static void workout_split_draw(GContext*c,GRect b,const LabData*d){split(c,true,0);}
const LabDesign workout_split={"workout_split",NULL,NULL,workout_split_draw};
static void page_chrome(GContext*c,Palette p,const char*title,const char*page){
  fill(c,0,0,200,228,p.bg);chrome(c,p,"RUN",page,false);
  text(c,title,FONT_KEY_GOTHIC_24_BOLD,8,28,164,34,p.ink,GTextAlignmentLeft);
}
static void draw_workout_metrics(GContext*c,GRect b,const LabData*d){
  Palette p=pal(false,2);page_chrome(c,p,"More metrics","2/4");
  const char* labels[]={"PACE /KM","SPEED KM/H","AVG PACE","AVG HR","STEPS","LAST KM"};
  const char* values[]={"5:02","11.9","5:02","146","4128","5:07"};
  for(int i=0;i<6;i++){int x=8+(i%2)*90,y=66+(i/2)*51;
    metric(c,p,labels[i],values[i],x,y);
    if(i%2)line(c,8,y+46,172,y+46,p.rule,1);
  }
}
const LabDesign workout_metrics={"workout_metrics",NULL,NULL,draw_workout_metrics};
static void draw_workout_zones(GContext*c,GRect b,const LabData*d){
  Palette p=pal(false,2);page_chrome(c,p,"Time in zones","3/4");
  const char* names[]={"Z3","Z2","Z1","Z0"};const char*times[]={"2:07","16:21","4:12","0:34"};
  const int widths[]={15,115,30,4};
  for(int i=0;i<4;i++){int y=68+i*37;Palette q=pal(false,3-i);
    LABEL(c,names[i],8,y,32,p.ink);text(c,times[i],FONT_KEY_GOTHIC_18_BOLD,82,y-3,90,24,p.ink,GTextAlignmentRight);
    fill(c,8,y+21,164,9,p.rule);fill(c,8,y+21,widths[i],9,q.zone);
  }
  LABEL(c,"ACTIVE TIME  23:14",8,211,164,p.mute);
}
const LabDesign workout_zones={"workout_zones",NULL,NULL,draw_workout_zones};
static void draw_workout_heart(GContext*c,GRect b,const LabData*d){
  Palette p=pal(false,2);page_chrome(c,p,"Heart rate","4/4");
  text(c,"152",FONT_KEY_LECO_42_NUMBERS,8,56,110,55,p.ink,GTextAlignmentLeft);badge(c,p,139,70,2,false);
  zone_scale(c,p,126,152);LABEL(c,"IN Z2  2:07",8,135,164,p.mute);
  for(int i=0;i<60;i++){int bpm=115+i*2/3+(i%11<5?-3:4);int h=(bpm-90)/2;
    Palette q=pal(false,bpm<130?1:2);fill(c,8+i*164/60,207-h,2,h,q.zone);}
  LABEL(c,"-60S",8,210,60,p.mute);text(c,"NOW",FONT_KEY_GOTHIC_14_BOLD,121,210,51,18,p.mute,GTextAlignmentRight);
}
const LabDesign workout_heart={"workout_heart",NULL,NULL,draw_workout_heart};

// Round 3: three different compositions around the same recorded metrics.
// Pace leads, Last KM stays visible, and every coloured field has a data role.
typedef struct {
  const char *pace, *distance, *elapsed, *last, *delta, *bpm;
  int zone, bpm_value;
} ExploreData;
static ExploreData explore_data(bool stress) {
  return stress ? (ExploreData){"99:59","128.74","12:59:59","59:59","+12:34","188",3,188} :
    (ExploreData){"5:02","4.62","23:14","5:07","-0:09","152",2,152};
}
static void explore_value(GContext *c,const char *value,int x,int y,int width,int height,
                          const char *large,const char *small,GColor ink,GTextAlignment align) {
  const char *font=fit(value,width,large,small);
  font=fit(value,width,font,FONT_KEY_GOTHIC_18_BOLD);
  text(c,value,font,x,y,width,height,ink,align);
}
static void explore_trace(GContext *c,GRect box,GColor ink) {
  // Illustrative ten-minute history; no animated beat or synthetic live data.
  for(int y=box.origin.y+box.size.h/3;y<box.origin.y+box.size.h;y+=box.size.h/3) {
    for(int x=box.origin.x;x<box.origin.x+box.size.w;x+=5)fill(c,x,y,2,1,ink);
  }
  int previous=box.origin.y+box.size.h*3/4;
  for(int i=1;i<30;i++) {
    int next=box.origin.y+box.size.h*(24-i/3+(i%7<3?-3:2))/32;
    line(c,box.origin.x+(i-1)*(box.size.w-1)/29,previous,
         box.origin.x+i*(box.size.w-1)/29,next,ink,2);
    previous=next;
  }
}
static void explore_scale(GContext *c,int x,int y,int width,int bpm,GColor ink) {
  const int bounds[]={40,100,130,160,200};
  int zone=bpm<100?0:bpm<130?1:bpm<160?2:3;
  int segment=(width-9)/4;
  for(int i=0;i<4;i++) {
    GRect rect=GRect(x+i*(segment+3),y,segment,4);
    if(i==zone) fill(c,rect.origin.x,rect.origin.y,rect.size.w,rect.size.h,ink);
    else {graphics_context_set_stroke_color(c,ink);graphics_draw_rect(c,rect);}
  }
  int fraction=(bpm-bounds[zone])*(segment-1)/(bounds[zone+1]-bounds[zone]);
  if(fraction<0)fraction=0;if(fraction>=segment)fraction=segment-1;
  int marker=x+zone*(segment+3)+fraction;
  line(c,marker,y-3,marker,y-8,ink,2);
}

// A: Splitline. Last KM occupies the upper-right pace pocket. A full-width
// effort panel fills the bottom with a large reading and useful history.
static void explore_splitline(GContext*c,bool dark,bool stress) {
  ExploreData d=explore_data(stress);Palette p=pal(dark,d.zone);
  fill(c,0,0,200,228,p.bg);chrome(c,p,"RUN","GPS 8M",false);
  LABEL(c,"PACE /KM",8,27,100,p.mute);
  explore_value(c,d.pace,4,44,106,53,FONT_KEY_LECO_42_NUMBERS,
                FONT_KEY_LECO_32_BOLD_NUMBERS,p.ink,GTextAlignmentLeft);
  line(c,114,29,114,99,p.rule,1);
  LABEL(c,"LAST KM",123,28,55,p.mute);
  explore_value(c,d.last,121,48,57,29,FONT_KEY_LECO_20_BOLD_NUMBERS,
                FONT_KEY_GOTHIC_18_BOLD,p.ink,GTextAlignmentLeft);
  LABEL(c,d.delta,123,79,55,p.mute);
  line(c,8,104,172,104,p.rule,1);
  metric(c,p,"DISTANCE KM",d.distance,8,110);
  metric(c,p,"ELAPSED",d.elapsed,98,110);
  fill(c,0,160,180,68,p.zone);
  heart(c,12,176,p.zi);
  text(c,d.bpm,FONT_KEY_LECO_32_BOLD_NUMBERS,34,164,90,42,p.zi,GTextAlignmentLeft);
  badge(c,p,140,167,d.zone,false);
  explore_trace(c,GRect(10,205,160,21),p.zi);
}

// B: Paceboard. A large inverted pace panel uses the whole upper width. The
// last split gets its own horizontal row, followed by a compact HR instrument.
static void explore_paceboard(GContext*c,bool dark,bool stress) {
  ExploreData d=explore_data(stress);Palette p=pal(dark,d.zone);
  fill(c,0,0,200,228,p.bg);chrome(c,p,"RUN","GPS 8M",false);
  fill(c,0,22,180,88,p.ink);
  LABEL(c,"PACE /KM",8,25,164,p.bg);
  explore_value(c,d.pace,4,35,172,73,FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM,
                FONT_KEY_LECO_42_NUMBERS,p.bg,GTextAlignmentCenter);
  metric(c,p,"DISTANCE KM",d.distance,8,115);
  metric(c,p,"ELAPSED",d.elapsed,98,115);
  line(c,90,119,90,155,p.rule,1);
  line(c,8,160,172,160,p.rule,1);
  LABEL(c,"LAST KM",8,174,59,p.mute);
  explore_value(c,d.last,68,163,68,34,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,
                FONT_KEY_LECO_20_BOLD_NUMBERS,p.ink,GTextAlignmentLeft);
  text(c,d.delta,FONT_KEY_GOTHIC_14_BOLD,132,174,43,18,p.mute,GTextAlignmentRight);
  fill(c,0,199,180,29,p.zone);
  heart(c,10,208,p.zi);
  text(c,d.bpm,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,30,198,54,29,p.zi,GTextAlignmentLeft);
  explore_scale(c,89,218,53,d.bpm_value,p.zi);
  const char *zone=d.zone==3?"Z3":"Z2";
  text(c,zone,FONT_KEY_GOTHIC_18_BOLD,148,202,27,24,p.zi,GTextAlignmentCenter);
}

// C: Sidecar. A continuous HR column makes the upper-right area useful, while
// the left column stacks pace, distance, elapsed and a bottom-anchored split.
static void explore_sidecar(GContext*c,bool dark,bool stress) {
  ExploreData d=explore_data(stress);Palette p=pal(dark,d.zone);
  fill(c,0,0,200,228,p.bg);chrome(c,p,"RUN","GPS 8M",false);
  fill(c,116,22,64,206,p.zone);
  LABEL(c,"PACE /KM",8,27,100,p.mute);
  explore_value(c,d.pace,4,43,106,49,FONT_KEY_LECO_42_NUMBERS,
                FONT_KEY_LECO_32_BOLD_NUMBERS,p.ink,GTextAlignmentLeft);
  line(c,8,96,108,96,p.rule,1);
  LABEL(c,"DISTANCE KM",8,99,100,p.mute);
  explore_value(c,d.distance,6,113,104,32,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,
                FONT_KEY_LECO_20_BOLD_NUMBERS,p.ink,GTextAlignmentLeft);
  LABEL(c,"ELAPSED",8,145,100,p.mute);
  explore_value(c,d.elapsed,6,159,104,29,FONT_KEY_LECO_20_BOLD_NUMBERS,
                FONT_KEY_GOTHIC_18_BOLD,p.ink,GTextAlignmentLeft);
  fill(c,0,190,116,38,p.ink);
  LABEL(c,"LAST KM",8,190,100,p.bg);
  explore_value(c,d.last,7,203,65,25,FONT_KEY_LECO_20_BOLD_NUMBERS,
                FONT_KEY_GOTHIC_18_BOLD,p.bg,GTextAlignmentLeft);
  text(c,d.delta,FONT_KEY_GOTHIC_14_BOLD,70,206,40,18,p.bg,GTextAlignmentRight);
  heart(c,141,38,p.zi);
  explore_value(c,d.bpm,120,57,56,44,FONT_KEY_LECO_32_BOLD_NUMBERS,
                FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,p.zi,GTextAlignmentCenter);
  badge(c,p,134,105,d.zone,false);
  explore_trace(c,GRect(123,153,50,57),p.zi);
}
#define EXPLORE(name,fn,dark,stress) static void draw_##name(GContext*c,GRect b,const LabData*x){fn(c,dark,stress);} const LabDesign name={#name,NULL,NULL,draw_##name};
EXPLORE(splitline_light,explore_splitline,0,0)
EXPLORE(paceboard_light,explore_paceboard,0,0)
EXPLORE(sidecar_light,explore_sidecar,0,0)
EXPLORE(splitline_dark,explore_splitline,1,0)
EXPLORE(paceboard_dark,explore_paceboard,1,0)
EXPLORE(sidecar_dark,explore_sidecar,1,0)
EXPLORE(splitline_stress,explore_splitline,0,1)
EXPLORE(paceboard_stress,explore_paceboard,0,1)
EXPLORE(sidecar_stress,explore_sidecar,0,1)
