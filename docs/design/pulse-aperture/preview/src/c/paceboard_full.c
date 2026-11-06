#include "lab.h"
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

enum { PB_CHOOSE_WALK,PB_CHOOSE_RUN,PB_CHOOSE_RIDE,PB_CHOOSE_HISTORY,
 PB_GPS,PB_READY,PB_GPS_ERROR,PB_THREE,PB_TWO,PB_ONE,PB_GO,
 PB_RUN,PB_WALK,PB_RIDE,PB_FIRST,PB_OFFLINE,PB_NO_HR,PB_LONG,PB_SPLIT,
 PB_LAPS,PB_ZONES,PB_HEART,PB_PAUSED,PB_CONFIRM,PB_SAVED,PB_UPLOAD,
 PB_EXIT,PB_HISTORY,PB_DETAIL,PB_RECOVERY,PB_DISCARD,PB_ZONE_HIGH,PB_AFTER_SPLIT,PB_GPS_CLOSE };
enum { FX_NONE,FX_PICK,FX_LOCK,FX_BEAT,FX_START,FX_SPLIT_IN,FX_SPLIT_OUT,
 FX_PAUSE,FX_RESUME,FX_LAPS,FX_ZONES,FX_HEART,FX_CONFIRM,FX_SAVED,FX_ZONE,FX_UPLOAD,FX_PUSH,FX_HR,FX_ORBIT,FX_GPS_FIX };
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
 case I_PAGES:for(int i=0;i<3;i++)pb_fill(c,187,cy-7+i*6,6,3,ink,0);break;
 case I_FILE:pb_line(c,186,cy-7,194,cy-7,ink,1);pb_line(c,194,cy-7,194,cy+7,ink,1);pb_line(c,194,cy+7,186,cy+7,ink,1);pb_line(c,186,cy+7,186,cy-7,ink,1);pb_line(c,188,cy-2,192,cy-2,ink,1);pb_line(c,188,cy+2,192,cy+2,ink,1);break;
 case I_RETRY:graphics_context_set_stroke_color(c,ink);graphics_context_set_stroke_width(c,2);graphics_draw_arc(c,GRect(185,cy-5,11,11),GOvalScaleModeFitCircle,DEG_TO_TRIGANGLE(45),DEG_TO_TRIGANGLE(320));pb_line(c,194,cy-5,194,cy,ink,2);pb_line(c,194,cy-5,189,cy-5,ink,2);break;
 default:break;
 }
}
static void pb_chrome(GContext*c,int scene){
 int old=pb_dy;pb_dy=0;pb_fill(c,0,0,180,22,PB_PAPER,0);
 const char *mode=scene==PB_WALK?"WALK":scene==PB_RIDE?"RIDE":scene==PB_HISTORY||scene==PB_DETAIL?"HIST":"RUN";
 const char *status="GPS 8M";GColor signal=PB_MUTED;int up=I_NONE,sel=I_NONE,down=I_NONE;
 if(scene<=PB_CHOOSE_HISTORY){mode="PACELET";status="";up=I_UP;sel=I_PLAY;down=I_DOWN;}
 else if(scene<=PB_GPS_ERROR||scene==PB_GPS_CLOSE){status=scene==PB_READY?"READY":scene==PB_GPS_ERROR?"GPS ERR":"GPS";up=I_RETRY;sel=scene==PB_READY?I_PLAY:I_NONE;down=I_PAGES;}
 else if(scene<=PB_GO){status="READY";}
 else if(scene==PB_PAUSED){status="PAUSED";signal=PB_INK;up=I_PLAY;sel=I_STOP;down=I_PAGES;}
 else if(scene==PB_CONFIRM||scene==PB_DISCARD){status=scene==PB_CONFIRM?"FINISH?":"DELETE?";signal=PB_RED;up=I_CHECK;down=I_BACK;}
 else if(scene==PB_SAVED){status="SAVED";up=I_PLAY;sel=I_PAGES;down=I_BACK;}
 else if(scene==PB_UPLOAD){status="STRAVA";down=I_BACK;}
 else if(scene==PB_EXIT){status="STRAVA";up=I_DELETE;down=I_BACK;}
 else if(scene==PB_HISTORY){status="";up=I_UP;sel=I_PLAY;down=I_DOWN;}
 else if(scene==PB_DETAIL){status="SAVED";up=I_FILE;sel=I_RETRY;down=I_BACK;}
 else if(scene==PB_RECOVERY){status="RECOVER";up=I_PLAY;sel=I_STOP;down=I_DELETE;}
 else {status=scene==PB_OFFLINE?"OFFLINE":scene==PB_SPLIT?"SPLIT":scene==PB_LAPS?"LAPS":scene==PB_ZONES?"ZONES":scene==PB_HEART?"TRACE":"GPS 8M";up=I_PAUSE;down=I_PAGES;sel=scene==PB_LAPS||scene==PB_ZONES||scene==PB_HEART?I_BACK:I_NONE;}
 PB_LABEL(c,mode,7,1,54,PB_INK);
 pb_text(c,"10:45",FONT_KEY_GOTHIC_18_BOLD,55,-3,70,23,PB_INK,GTextAlignmentCenter);
 pb_text(c,status,FONT_KEY_GOTHIC_14_BOLD,120,1,54,18,signal,GTextAlignmentRight);
 pb_fill(c,0,20,180,2,scene==PB_PAUSED?PB_AMBER:scene==PB_CONFIRM||scene==PB_DISCARD?PB_CORAL:PB_TEAL,0);
 pb_fill(c,180,0,20,228,PB_INK,0);pb_icon(c,up,57,PB_PAPER);pb_icon(c,sel,114,PB_PAPER);pb_icon(c,down,171,PB_PAPER);pb_dy=old;
}
static void pb_pair(GContext*c,const char*distance,const char*second,const char*label){
 PB_LABEL(c,"DIST. KM",8,115,82,PB_MUTED);PB_LABEL(c,label,98,115,76,PB_MUTED);
 pb_number(c,distance,6,129,82,31,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_20_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
 pb_number(c,second,96,129,80,31,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_20_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
 pb_line(c,90,119,90,155,PB_RULE,1);
}
static void pb_scale(GContext*c,int x,int y,int width,int bpm,GColor ink){
 const int bounds[]={40,100,130,160,200};int z=bpm<100?0:bpm<130?1:bpm<160?2:3;
 int segment=(width-9)/4;
 for(int i=0;i<4;i++){
  GRect r=GRect(x+i*(segment+3),y,segment,4);
  if(i==z)pb_fill(c,r.origin.x,r.origin.y,r.size.w,r.size.h,ink,0);
  else{graphics_context_set_stroke_color(c,ink);graphics_draw_rect(c,GRect(r.origin.x,r.origin.y+pb_dy,r.size.w,r.size.h));}
 }
 int f=pb_clamp((bpm-bounds[z])*(segment-1)/(bounds[z+1]-bounds[z]),0,segment-1);
 int marker=x+z*(segment+3)+f;pb_line(c,marker,y-3,marker,y-7,ink,2);
}
static void pb_hr_band(GContext*c,int scene,int zone_progress){
 bool missing=scene==PB_NO_HR;int z=scene==PB_WALK?1:scene==PB_ZONE_HIGH||scene==PB_LONG?3:2;
 int bpm=scene==PB_WALK?122:scene==PB_RIDE?154:scene==PB_ZONE_HIGH?168:scene==PB_LONG?188:scene==PB_SAVED?146:152;
 GColor bg=missing?GColorFromHEX(0xAAAAAA):pb_zone(z);
 if(zone_progress>=0){pb_fill(c,0,199,180,29,pb_zone(2),0);pb_fill(c,0,228-29*zone_progress/1000,180,29*zone_progress/1000,bg,0);}
 else pb_fill(c,0,199,180,29,bg,0);
 pb_heart(c,10,208,PB_INK,2);char value[4];snprintf(value,sizeof(value),"%d",bpm);
 pb_text(c,missing?"--":value,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,30,198,54,29,PB_INK,GTextAlignmentLeft);
 if(missing){PB_LABEL(c,"MEASURING",87,204,88,PB_INK);return;}
 if(scene==PB_SAVED){PB_LABEL(c,"AVG",92,204,42,PB_INK);}else pb_scale(c,89,218,53,bpm,PB_INK);
 char zone[4];snprintf(zone,sizeof(zone),"Z%d",z);pb_text(c,zone,FONT_KEY_GOTHIC_18_BOLD,148,202,27,24,PB_INK,GTextAlignmentCenter);
}
static void pb_live(GContext*c,int scene,int zone_progress){
 bool walking=scene==PB_WALK,ride=scene==PB_RIDE,worst=scene==PB_LONG,paused=scene==PB_PAUSED;
 const char*pace=walking?"24:18":ride?"35.6":scene==PB_OFFLINE?"--:--":worst?"99:59":"5:02";
 const char*distance=walking?"2.12":ride?"18.74":worst?"128.74":scene==PB_AFTER_SPLIT||scene==PB_SPLIT?"5.00":"4.62";
 const char*elapsed=walking?"2841":ride?"31:36":worst?"12:59:59":scene==PB_AFTER_SPLIT||scene==PB_SPLIT?"25:06":"23:14";
 pb_fill(c,0,22,180,88,PB_MIST,0);
 PB_LABEL(c,walking?"ELAPSED":ride?"SPEED KM/H":scene==PB_SAVED||scene==PB_DETAIL?"AVG PACE /KM":"PACE /KM",8,25,164,PB_INK);
 if(paused)pb_text(c,"FOR 1:08",FONT_KEY_GOTHIC_14_BOLD,100,25,73,18,PB_INK,GTextAlignmentRight);
 pb_number(c,pace,4,35,172,73,FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_42_NUMBERS,paused?PB_MUTED:PB_INK,GTextAlignmentCenter);
 pb_pair(c,distance,elapsed,walking?"STEPS":"ELAPSED");
 pb_line(c,8,161,172,161,PB_RULE,1);
 if(scene==PB_SAVED||scene==PB_DETAIL){
  if(scene==PB_DETAIL)PB_LABEL(c,"STRAVA UPLOADED",8,164,164,PB_MUTED);
  else for(int i=0;i<4;i++){
   pb_fill(c,8+i*42,170,7,7,pb_zone(i),0);char label[3];snprintf(label,sizeof(label),"Z%d",i);
   PB_LABEL(c,label,18+i*42,164,25,PB_MUTED);
  }
  int widths[]={4,30,115,15};int x=8;
  for(int i=0;i<4;i++){pb_fill(c,x,186,widths[i],7,pb_zone(i),0);x+=widths[i];}
 }else{
  PB_LABEL(c,"LAST KM",8,175,59,PB_MUTED);
  pb_number(c,scene==PB_FIRST?"--:--":walking?"11:34":ride?"1:41":worst?"59:59":scene==PB_AFTER_SPLIT?"4:58":"5:07",68,164,68,34,FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_20_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
  pb_text(c,scene==PB_FIRST?"":worst?"+12:34":"-0:09",FONT_KEY_GOTHIC_14_BOLD,133,176,43,18,PB_MUTED,GTextAlignmentRight);
 }
 pb_hr_band(c,scene==PB_DETAIL?PB_SAVED:scene,zone_progress);
}
static void pb_picker(GContext*c,int selected,int old,int progress){
 int y=pb_lerp(37+old*44,37+selected*44,progress);
 pb_fill(c,0,y,180,42,PB_MIST,0);pb_fill(c,0,y,3,42,PB_TEAL,0);
 const char*names[]={"Walking","Running","Cycling","History"};
 for(int i=0;i<4;i++){
  if(i<3)pb_activity_icon(c,i,26,58+i*44,PB_INK,1000);
  else{graphics_context_set_stroke_color(c,PB_INK);graphics_context_set_stroke_width(c,2);graphics_draw_circle(c,GPoint(26,58+i*44+pb_dy),11);pb_line(c,26,51+i*44,26,58+i*44,PB_INK,2);pb_line(c,26,58+i*44,32,61+i*44,PB_INK,2);}
  pb_text(c,names[i],FONT_KEY_GOTHIC_24_BOLD,51,41+i*44,122,32,PB_INK,GTextAlignmentLeft);
 }
}
static void pb_gps(GContext*c,int scene,int progress,int accuracy,int orbit_angle){
 bool ready=scene==PB_READY,error=scene==PB_GPS_ERROR;
 int radius=ready?pb_lerp(38,0,pb_ease(progress)):pb_lerp(60,pb_clamp(accuracy*12/10,0,60),pb_ease(progress));
 graphics_context_set_fill_color(c,ready||!error?PB_MIST:PB_PAPER);
 graphics_fill_circle(c,GPoint(90,85+pb_dy),30);
 for(int i=0;i<24;i++){
  int a=DEG_TO_TRIGANGLE(i*15);graphics_context_set_fill_color(c,PB_RULE);
  graphics_fill_circle(c,GPoint(90+sin_lookup(a)*60/TRIG_MAX_RATIO,85+pb_dy-cos_lookup(a)*60/TRIG_MAX_RATIO),1);
 }
 graphics_context_set_stroke_color(c,error?PB_RULE:PB_TEAL);graphics_context_set_stroke_width(c,2);
 graphics_draw_circle(c,GPoint(90,85+pb_dy),30);
 if(!ready&&!error){pb_line(c,85,85,95,85,PB_TEAL,1);pb_line(c,90,80,90,90,PB_TEAL,1);}
 if(error){graphics_context_set_fill_color(c,PB_RED);graphics_fill_circle(c,GPoint(140,52+pb_dy),4);}
 else if(!ready||progress<850)for(int i=0;i<3;i++){
  int a=DEG_TO_TRIGANGLE(15+orbit_angle+i*120);graphics_context_set_fill_color(c,PB_AMBER);
  graphics_fill_circle(c,GPoint(90+sin_lookup(a)*radius/TRIG_MAX_RATIO,85+pb_dy-cos_lookup(a)*radius/TRIG_MAX_RATIO),3);
 }
 if(ready){
  graphics_context_set_fill_color(c,PB_TEAL);
  graphics_fill_radial(c,GRect(59,54+pb_dy,62,62),GOvalScaleModeFitCircle,3,0,TRIG_MAX_ANGLE*progress/1000);
  int check=pb_clamp((progress-450)*1000/550,0,1000),first=pb_clamp(check,0,350);
  if(check>0)pb_line(c,78,85,78+10*first/350,85+10*first/350,PB_INK,3);
  if(check>350)pb_line(c,88,95,88+17*(check-350)/650,95-22*(check-350)/650,PB_INK,3);
 }
 pb_text(c,error?"GPS unavailable":ready?"Ready to run":"Finding GPS",FONT_KEY_GOTHIC_24_BOLD,8,148,164,33,error?PB_RED:PB_INK,GTextAlignmentCenter);
 char detail[28];snprintf(detail,sizeof(detail),"%d m / need 25 m",accuracy);
 pb_text(c,error?"Check phone location":detail,FONT_KEY_GOTHIC_18,8,183,164,25,PB_MUTED,GTextAlignmentCenter);
 PB_LABEL(c,error?"UP TO RETRY":ready?"SELECT TO START":"KEEP PHONE NEARBY",28,211,148,PB_MUTED);
}
static void pb_countdown(GContext*c,int scene,int pulse){
 int r=60;if(pulse>=0&&pulse<1000){const int radii[]={60,66,60,63,60};int segment=pb_clamp(pulse/250,0,3);r=pb_lerp(radii[segment],radii[segment+1],pulse%250*4);}
 graphics_context_set_fill_color(c,PB_MIST);graphics_fill_circle(c,GPoint(90,112+pb_dy),r);
 const char*n=scene==PB_THREE?"3":scene==PB_TWO?"2":scene==PB_ONE?"1":"GO";
 pb_text(c,n,scene==PB_GO?FONT_KEY_BITHAM_42_BOLD:FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM,30,scene==PB_GO?86:68,120,90,PB_INK,GTextAlignmentCenter);
 PB_LABEL(c,"STARTING",60,195,95,PB_MUTED);
}
static void pb_trace(GContext*c,int x,int y,int w,int h){
 for(int i=0;i<60;i++){int bpm=112+i*2/3+(i%11<5?-3:4);int height=(bpm-90)*h/85;
  pb_fill(c,x+i*w/60,y+h-height,2,height,pb_zone(bpm<130?1:2),0);}
}
static void pb_split(GContext*c,int remaining){
 pb_fill(c,0,22,180,177,PB_MIST,0);PB_LABEL(c,"KILOMETRE 5",8,28,164,PB_INK);
 pb_number(c,"4:58",4,49,172,73,FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_42_NUMBERS,PB_INK,GTextAlignmentCenter);
 pb_text(c,"9 SEC FASTER",FONT_KEY_GOTHIC_18_BOLD,8,132,164,27,PB_INK,GTextAlignmentCenter);
 PB_LABEL(c,"THAN THE PREVIOUS KM",19,158,150,PB_MUTED);
 pb_fill(c,8,190,164,2,PB_PAPER,0);pb_fill(c,8,190,164*remaining/1000,2,PB_TEAL,0);
 pb_hr_band(c,PB_RUN,-1);
}
static void pb_laps(GContext*c){
 pb_text(c,"Kilometres",FONT_KEY_GOTHIC_24_BOLD,8,27,164,35,PB_INK,GTextAlignmentLeft);
 const char*labels[]={"NOW","KM 4","KM 3","KM 2","KM 1"};const char*values[]={"3:06","5:07","5:16","4:59","4:46"};
 for(int i=0;i<5;i++){int y=68+i*29;if(i==0)pb_fill(c,0,y-1,180,28,PB_MIST,0);PB_LABEL(c,labels[i],8,y+1,68,PB_MUTED);
 pb_number(c,values[i],80,y-4,68,28,FONT_KEY_LECO_20_BOLD_NUMBERS,FONT_KEY_GOTHIC_18_BOLD,PB_INK,GTextAlignmentRight);if(i==4)pb_fill(c,159,y+9,5,5,PB_TEAL,2);}
}
static void pb_zones(GContext*c){
 pb_text(c,"Time in zones",FONT_KEY_GOTHIC_24_BOLD,8,27,164,35,PB_INK,GTextAlignmentLeft);
 const char*times[]={"2:07","16:21","4:12","0:34"};const int widths[]={15,115,30,4};
 for(int i=0;i<4;i++){int y=68+i*37;char zone[3];snprintf(zone,sizeof(zone),"Z%d",3-i);
 PB_LABEL(c,zone,8,y,32,PB_INK);pb_text(c,times[i],FONT_KEY_GOTHIC_18_BOLD,82,y-3,90,24,PB_INK,GTextAlignmentRight);
 pb_fill(c,8,y+21,164,8,GColorFromHEX(0xAAAAAA),0);pb_fill(c,8,y+21,widths[i],8,pb_zone(3-i),0);}
 PB_LABEL(c,"ACTIVE TIME 23:14",8,213,164,PB_MUTED);
}
static void pb_heart_page(GContext*c){
 pb_text(c,"Heart rate",FONT_KEY_GOTHIC_24_BOLD,8,27,164,35,PB_INK,GTextAlignmentLeft);
 pb_number(c,"152",8,55,108,55,FONT_KEY_LECO_42_NUMBERS,FONT_KEY_LECO_32_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
 pb_fill(c,137,73,35,24,pb_zone(2),0);pb_text(c,"Z2",FONT_KEY_GOTHIC_18_BOLD,137,71,35,26,PB_INK,GTextAlignmentCenter);
 pb_scale(c,12,123,156,152,PB_INK);PB_LABEL(c,"THIS STINT 2:07",8,135,164,PB_MUTED);
 pb_trace(c,8,159,164,47);PB_LABEL(c,"-60S",8,211,60,PB_MUTED);pb_text(c,"NOW",FONT_KEY_GOTHIC_14_BOLD,120,211,52,18,PB_MUTED,GTextAlignmentRight);
}
static void pb_confirmation(GContext*c,int scene,int progress){
 bool discard=scene==PB_DISCARD,leave=scene==PB_EXIT;
 pb_fill(c,0,22,180,206,PB_PAPER,0);pb_fill(c,8,39,164,4,leave?PB_MIST:PB_CORAL,0);
 pb_text(c,leave?"Upload in\nprogress":discard?"Delete run?":"Finish run?",FONT_KEY_GOTHIC_28_BOLD,8,57,164,68,PB_INK,GTextAlignmentLeft);
 pb_text(c,leave?"Leaving may pause\nstatus checks. Strava\nmay still finish.":discard?"This cannot be undone.":"Save this activity.",FONT_KEY_GOTHIC_18,8,135,164,64,PB_MUTED,GTextAlignmentLeft);
 PB_LABEL(c,leave?"UP LEAVE / DOWN STAY":discard?"UP DELETE / DOWN KEEP":"UP SAVE / DOWN KEEP",8,207,164,PB_INK);
}
static void pb_upload(GContext*c,int progress){
 pb_fill(c,24,57,132,67,PB_MIST,5);pb_line(c,60,105,60,77,PB_INK,3);pb_line(c,60,77,52,85,PB_INK,3);pb_line(c,60,77,68,85,PB_INK,3);
 pb_text(c,"Sending\nto Strava",FONT_KEY_GOTHIC_24_BOLD,81,63,75,59,PB_INK,GTextAlignmentLeft);
 if(progress>=0){pb_fill(c,24,143,132,4,GColorFromHEX(0xAAAAAA),0);pb_fill(c,24+progress*92/1000,143,40,4,PB_TEAL,0);}
 else for(int i=0;i<3;i++)pb_fill(c,76+i*12,143,5,5,PB_TEAL,2);
 pb_text(c,"Your activity is saved.",FONT_KEY_GOTHIC_18,8,170,164,27,PB_MUTED,GTextAlignmentCenter);
}
static void pb_history(GContext*c){
 const char*types[]={"Running","Cycling","Walking"};const char*metrics[]={"4.62 KM   23:14","18.74 KM  31:36","2.12 KM   24:18"};
 for(int i=0;i<3;i++){int y=35+i*61;if(i==0)pb_fill(c,0,y,180,58,PB_MIST,0);
 pb_text(c,types[i],FONT_KEY_GOTHIC_24_BOLD,8,y,164,32,PB_INK,GTextAlignmentLeft);
 PB_LABEL(c,metrics[i],8,y+34,164,PB_MUTED);if(i>0)pb_line(c,8,y+58,172,y+58,PB_RULE,1);}
}
static void pb_recovery(GContext*c){
 pb_text(c,"Run interrupted",FONT_KEY_GOTHIC_24_BOLD,8,34,164,35,PB_INK,GTextAlignmentLeft);
 pb_fill(c,0,82,180,69,PB_MIST,0);PB_LABEL(c,"RECORDED",8,84,164,PB_INK);
 pb_number(c,"23:14",6,100,168,48,FONT_KEY_LECO_36_BOLD_NUMBERS,FONT_KEY_LECO_32_BOLD_NUMBERS,PB_INK,GTextAlignmentLeft);
 pb_text(c,"4.62 km saved on phone",FONT_KEY_GOTHIC_18,8,168,164,29,PB_MUTED,GTextAlignmentLeft);
 PB_LABEL(c,"RESUME / FINISH / DELETE",8,208,164,PB_INK);
}
static void pb_content(GContext*c,int scene){
 pb_fill(c,0,22,180,206,PB_PAPER,0);
 if(scene<=PB_CHOOSE_HISTORY)pb_picker(c,scene,scene,1000);
 else if(scene<=PB_GPS_ERROR||scene==PB_GPS_CLOSE)pb_gps(c,scene,1000,scene==PB_READY?8:scene==PB_GPS_CLOSE?32:58,0);
 else if(scene<=PB_GO)pb_countdown(c,scene,-1);
 else if(scene==PB_SPLIT)pb_split(c,1000);
 else if(scene==PB_LAPS)pb_laps(c);
 else if(scene==PB_ZONES)pb_zones(c);
 else if(scene==PB_HEART)pb_heart_page(c);
 else if(scene==PB_CONFIRM||scene==PB_DISCARD||scene==PB_EXIT)pb_confirmation(c,scene,1000);
 else if(scene==PB_UPLOAD)pb_upload(c,-1);
 else if(scene==PB_HISTORY)pb_history(c);
 else if(scene==PB_RECOVERY)pb_recovery(c);
 else pb_live(c,scene,-1);
}
static void pb_draw(GContext*c,int scene,int effect,int progress){
 int p=pb_clamp(progress,0,1000),e=pb_ease(p);pb_dy=0;pb_fill(c,0,0,200,228,PB_PAPER,0);
 if(effect==FX_PICK){pb_picker(c,scene,(scene+3)%4,e);}
 else if(effect==FX_LOCK){pb_gps(c,PB_READY,e,8,0);}
 else if(effect==FX_ORBIT){pb_gps(c,scene,1000,scene==PB_GPS_CLOSE?32:58,p*120/1000);}
 else if(effect==FX_GPS_FIX){pb_gps(c,PB_GPS_CLOSE,p,32,0);}
 else if(effect==FX_BEAT){pb_countdown(c,scene,p);}
 else if(effect==FX_START){
  int old_dy=pb_dy;pb_dy=(1000-e)*90/1000;pb_content(c,PB_RUN);pb_dy=old_dy;
  pb_fill(c,0,22,180,88,PB_PAPER,0);
  int x=pb_lerp(30,0,e),y=pb_lerp(52,22,e),w=pb_lerp(120,180,e),h=pb_lerp(120,88,e);
  pb_fill(c,x,y,w,h,PB_MIST,pb_lerp(60,0,e));
  if(p<500)pb_text(c,"GO",FONT_KEY_BITHAM_42_BOLD,x,y+h/2-26,w,60,PB_INK,GTextAlignmentCenter);
  else{PB_LABEL(c,"PACE /KM",8,25,164,PB_INK);pb_number(c,"5:02",4,35,172,73,FONT_KEY_LECO_60_BOLD_NUMBERS_AM_PM,FONT_KEY_LECO_42_NUMBERS,PB_INK,GTextAlignmentCenter);}
 }
 else if(effect==FX_SPLIT_IN||effect==FX_SPLIT_OUT){
  pb_content(c,effect==FX_SPLIT_IN?PB_RUN:PB_AFTER_SPLIT);pb_dy=effect==FX_SPLIT_IN?(1000-e)*206/1000:e*206/1000;pb_split(c,1000);pb_dy=0;
 }
 else if(effect==FX_LAPS||effect==FX_ZONES||effect==FX_HEART||effect==FX_PUSH){
  int from=effect==FX_LAPS?PB_RUN:effect==FX_ZONES?PB_LAPS:effect==FX_HEART?PB_ZONES:PB_CHOOSE_RUN;
  pb_dy=-206*e/1000;pb_content(c,from);pb_dy=206*(1000-e)/1000;pb_content(c,scene);pb_dy=0;
 }
 else if(effect==FX_PAUSE||effect==FX_RESUME){
  pb_content(c,scene);int cover=29*(1000-e)/1000;
  if(cover)pb_fill(c,0,199,180,cover,PB_MIST,0);
  if(p<1000)pb_fill(c,0,110,180*(1000-e)/1000,2,PB_AMBER,0);
 }
 else if(effect==FX_CONFIRM){pb_content(c,PB_PAUSED);pb_dy=206*(1000-e)/1000;pb_content(c,scene);pb_dy=0;}
 else if(effect==FX_ZONE){pb_live(c,PB_ZONE_HIGH,e);}
 else if(effect==FX_UPLOAD){pb_upload(c,p<1000?e:-1);}
 else if(effect==FX_HR){pb_live(c,PB_RUN,-1);if(p<500)pb_heart(c,7,205,PB_INK,3);}
 else if(effect==FX_SAVED){
  if(p<450){pb_fill(c,0,22,180,206,PB_PAPER,0);int a=pb_clamp(p*1000/450,0,1000);
   pb_fill(c,48,42,84,84,PB_MIST,42);pb_line(c,65,83,65+18*a/1000,83+18*a/1000,PB_INK,4);
   if(a>450)pb_line(c,83,101,83+(a-450)*35/550,101-(a-450)*45/550,PB_INK,4);
   pb_text(c,"Saved",FONT_KEY_GOTHIC_28_BOLD,8,146,164,38,PB_INK,GTextAlignmentCenter);
  }else{
   pb_fill(c,48,42,84,84,PB_MIST,42);pb_line(c,65,83,83,101,PB_INK,4);pb_line(c,83,101,118,56,PB_INK,4);
   pb_text(c,"Saved",FONT_KEY_GOTHIC_28_BOLD,8,146,164,38,PB_INK,GTextAlignmentCenter);
   int q=pb_clamp((p-450)*1000/550,0,1000);pb_dy=(1000-pb_ease(q))*206/1000;pb_content(c,PB_SAVED);pb_dy=0;
  }
  if(p>200&&p<850)for(int i=0;i<12;i++){
   int x=90+((i*37)%151-75)*p/1000,y=38+((i*17)%41)*p/1000+p*p/24000;
   pb_fill(c,x,y,3,4,i%2?PB_TEAL:PB_AMBER,0);
  }
 }
 else pb_content(c,scene);
 pb_dy=0;pb_chrome(c,scene);
}
#define PB_FRAME(name,scene,effect,progress) static void draw_##name(GContext*c,GRect b,const LabData*d){pb_draw(c,scene,effect,progress);} const LabDesign name={#name,NULL,NULL,draw_##name};
#include "paceboard_frames.h"
#undef PB_FRAME
