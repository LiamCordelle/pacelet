#include <pebble.h>
#include <stdio.h>
#include <string.h>

// Isolated rendering proof. It deliberately contains sample data and does
// not communicate with the Pacelet phone app or use its production UUID.

#define SCREEN_COUNT 21
#define TEAL GColorFromHEX(0x005555)
#define CYAN GColorFromHEX(0x00AAAA)
#define LIME GColorFromHEX(0xAAFF00)
#define AMBER GColorFromHEX(0xFFAA00)
#define AMBER_INK GColorFromHEX(0xAA5500)
#define CORAL GColorFromHEX(0xFF5555)
#define RED_INK GColorFromHEX(0xAA0000)
#define GRAY GColorFromHEX(0x555555)
#define LIGHT_GRAY GColorFromHEX(0xAAAAAA)

typedef enum {
  IconNone, IconUp, IconDown, IconGps, IconPlay, IconPause, IconStop,
  IconCheck, IconClose, IconRefresh, IconHistory, IconMenu, IconFile
} PreviewIcon;

static Window *s_window;
static Layer *s_layer;
static int s_screen;
static int s_anim_frame = -1;
static bool s_animating;
static AppTimer *s_anim_timer;
static GFont s_tiny;
static GFont s_small;
static GFont s_small_bold;
static GFont s_menu;
static GFont s_title;
static GFont s_value;
static GFont s_hero;
static GFont s_long_hero;

static GColor paper(bool dark) { return dark ? GColorBlack : GColorWhite; }
static GColor ink(bool dark) { return dark ? GColorWhite : GColorBlack; }
static GColor muted(bool dark) { return dark ? GColorWhite : GRAY; }
static GColor panel(bool dark) { return dark ? TEAL : GColorWhite; }
static GColor edge(bool dark) { return dark ? TEAL : LIGHT_GRAY; }

static void box(GContext *ctx, int x, int y, int w, int h,
                int radius, GColor color) {
  graphics_context_set_fill_color(ctx, color);
  graphics_fill_rect(ctx, GRect(x, y, w, h), radius, GCornersAll);
}

static void outline(GContext *ctx, int x, int y, int w, int h,
                    int radius, GColor color) {
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, 1);
  graphics_draw_round_rect(ctx, GRect(x, y, w, h), radius);
}

static void dot(GContext *ctx, int x, int y, int radius, GColor color) {
  graphics_context_set_fill_color(ctx, color);
  graphics_fill_circle(ctx, GPoint(x, y), radius);
}

static void ring(GContext *ctx, int x, int y, int radius,
                 int width, GColor color) {
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, width);
  graphics_draw_circle(ctx, GPoint(x, y), radius);
}

static void segment(GContext *ctx, int x1, int y1, int x2, int y2,
                    int width, GColor color) {
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_stroke_width(ctx, width);
  graphics_draw_line(ctx, GPoint(x1, y1), GPoint(x2, y2));
}

static void label(GContext *ctx, const char *value, GFont font,
                  int x, int y, int w, int h, GColor color,
                  GTextAlignment align) {
  graphics_context_set_text_color(ctx, color);
  graphics_draw_text(ctx, value, font, GRect(x, y, w, h),
                     GTextOverflowModeTrailingEllipsis, align, NULL);
}

static void draw_icon(GContext *ctx, PreviewIcon icon, int x, int y,
                      GColor color) {
  if (icon == IconNone) return;
  switch (icon) {
    case IconUp:
      segment(ctx, x - 5, y + 3, x, y - 3, 2, color);
      segment(ctx, x, y - 3, x + 5, y + 3, 2, color);
      break;
    case IconDown:
      segment(ctx, x - 5, y - 3, x, y + 3, 2, color);
      segment(ctx, x, y + 3, x + 5, y - 3, 2, color);
      break;
    case IconGps:
      ring(ctx, x, y, 5, 2, color);
      dot(ctx, x, y, 2, color);
      segment(ctx, x, y - 8, x, y - 6, 2, color);
      segment(ctx, x, y + 6, x, y + 8, 2, color);
      segment(ctx, x - 8, y, x - 6, y, 2, color);
      segment(ctx, x + 6, y, x + 8, y, 2, color);
      break;
    case IconPlay:
      segment(ctx, x - 4, y - 6, x + 5, y, 2, color);
      segment(ctx, x + 5, y, x - 4, y + 6, 2, color);
      segment(ctx, x - 4, y + 6, x - 4, y - 6, 2, color);
      break;
    case IconPause:
      box(ctx, x - 5, y - 6, 3, 12, 1, color);
      box(ctx, x + 2, y - 6, 3, 12, 1, color);
      break;
    case IconStop:
      box(ctx, x - 5, y - 5, 10, 10, 2, color);
      break;
    case IconCheck:
      segment(ctx, x - 6, y, x - 2, y + 4, 2, color);
      segment(ctx, x - 2, y + 4, x + 6, y - 5, 2, color);
      break;
    case IconClose:
      segment(ctx, x - 5, y - 5, x + 5, y + 5, 2, color);
      segment(ctx, x + 5, y - 5, x - 5, y + 5, 2, color);
      break;
    case IconRefresh:
      ring(ctx, x, y, 6, 2, color);
      segment(ctx, x + 1, y - 6, x + 6, y - 6, 2, color);
      segment(ctx, x + 6, y - 6, x + 6, y - 1, 2, color);
      break;
    case IconHistory:
      ring(ctx, x, y, 6, 2, color);
      segment(ctx, x, y, x, y - 4, 2, color);
      segment(ctx, x, y, x + 3, y + 2, 2, color);
      break;
    case IconMenu:
      segment(ctx, x - 5, y - 4, x + 5, y - 4, 2, color);
      segment(ctx, x - 5, y, x + 5, y, 2, color);
      segment(ctx, x - 5, y + 4, x + 5, y + 4, 2, color);
      break;
    case IconFile:
      outline(ctx, x - 5, y - 7, 10, 14, 1, color);
      segment(ctx, x - 2, y - 2, x + 2, y - 2, 1, color);
      segment(ctx, x - 2, y + 2, x + 2, y + 2, 1, color);
      break;
    default:
      break;
  }
}

static void rail(GContext *ctx, bool dark,
                 PreviewIcon up, PreviewIcon select, PreviewIcon down,
                 int highlighted) {
  PreviewIcon icons[3] = {up, select, down};
  int ys[3] = {57, 114, 171};
  GColor rail_color = dark ? GColorWhite : GColorBlack;
  GColor icon_color = dark ? GColorBlack : GColorWhite;
  box(ctx, 180, 0, 20, 228, 0, rail_color);
  box(ctx, 180, 0, 2, 228, 0, TEAL);
  for (int i = 0; i < 3; i++) {
    if (icons[i] == IconNone) {
      segment(ctx, 187, ys[i], 193, ys[i], 1, GRAY);
    } else {
      if (highlighted == i) dot(ctx, 190, ys[i], 10, LIME);
      draw_icon(ctx, icons[i], 190, ys[i],
                highlighted == i ? GColorBlack : icon_color);
    }
  }
}

static void chrome(GContext *ctx, const char *mode, bool dark,
                   PreviewIcon up, PreviewIcon select, PreviewIcon down,
                   int highlighted) {
  box(ctx, 0, 0, 200, 228, 0, paper(dark));
  dot(ctx, 12, 14, 3, LIME);
  label(ctx, mode, s_small_bold, 21, 4, 110, 20, ink(dark),
        GTextAlignmentLeft);
  label(ctx, "10:09", s_small_bold, 130, 4, 41, 20, ink(dark),
        GTextAlignmentRight);
  segment(ctx, 8, 27, 172, 27, 1, edge(dark));
  rail(ctx, dark, up, select, down, highlighted);
}

static void tag(GContext *ctx, const char *value, GColor color, int y) {
  dot(ctx, 12, y + 8, 3, color);
  label(ctx, value, s_small_bold, 21, y, 150, 20, color,
        GTextAlignmentLeft);
}

static void route_mark(GContext *ctx, int x, int y, GColor color) {
  segment(ctx, x, y, x + 9, y, 2, color);
  segment(ctx, x + 9, y, x + 9, y - 8, 2, color);
  segment(ctx, x + 9, y - 8, x + 23, y - 8, 2, color);
  dot(ctx, x, y, 2, color);
  dot(ctx, x + 23, y - 8, 3, color);
}

static void metric_card(GContext *ctx, int x, const char *caption,
                        const char *value, bool dark) {
  box(ctx, x, 119, 78, 58, 7, panel(dark));
  if (!dark) outline(ctx, x, 119, 78, 58, 7, edge(dark));
  label(ctx, caption, s_tiny, x + 8, 123, 67, 18, muted(dark),
        GTextAlignmentLeft);
  // Five-character values such as 18.74 otherwise cross the card gutter.
  size_t value_length = strlen(value);
  GFont value_font = value_length >= 6 ? s_menu :
                     value_length >= 5 ? s_title : s_value;
  label(ctx, value, value_font, x + 7,
        value_length >= 6 ? 145 : 139, 68, 34, ink(dark),
        GTextAlignmentLeft);
}

static void heart_row(GContext *ctx, const char *bpm,
                      const char *description, GColor zone,
                      bool dark) {
  box(ctx, 8, 185, 164, 34, 7, panel(dark));
  if (!dark) outline(ctx, 8, 185, 164, 34, 7, edge(dark));
  box(ctx, 8, 185, 4, 34, 2, zone);
  ring(ctx, 27, 202, 8, 2, zone);
  segment(ctx, 23, 202, 25, 202, 1, zone);
  segment(ctx, 25, 202, 27, 199, 1, zone);
  segment(ctx, 27, 199, 29, 205, 1, zone);
  segment(ctx, 29, 205, 31, 202, 1, zone);
  label(ctx, description, s_tiny, 42, 189, 93, 19, muted(dark),
        GTextAlignmentLeft);
  label(ctx, bpm, s_value, 131, 185, 34, 31, ink(dark),
        GTextAlignmentRight);
}

static void choose_screen(GContext *ctx) {
  chrome(ctx, "PACELET", false, IconUp, IconGps, IconDown, 1);
  label(ctx, "Choose activity", s_title, 8, 35, 164, 29,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "ACTIVITY", s_tiny, 8, 57, 90, 17,
        GRAY, GTextAlignmentLeft);
  segment(ctx, 28, 82, 28, 178, 2, TEAL);
  const char *names[] = {"Walking", "Running", "Cycling"};
  for (int i = 0; i < 3; i++) {
    int y = 78 + i * 39;
    bool selected = i == 1;
    GColor bg = selected ? TEAL : GColorWhite;
    GColor fg = selected ? GColorWhite : GColorBlack;
    box(ctx, 8, y, 164, 34, 7, bg);
    if (!selected) outline(ctx, 8, y, 164, 34, 7, LIGHT_GRAY);
    dot(ctx, 28, y + 17, 8, selected ? LIME : GColorWhite);
    if (!selected) ring(ctx, 28, y + 17, 8, 2, TEAL);
    char number[3];
    snprintf(number, sizeof(number), "%02d", i + 1);
    label(ctx, number, s_tiny, 19, y + 9, 18, 16,
          selected ? GColorBlack : TEAL, GTextAlignmentCenter);
    label(ctx, names[i], s_menu, 47, y + 6, 103, 24,
          fg, GTextAlignmentLeft);
    if (selected) route_mark(ctx, 139, y + 23, LIME);
  }
  segment(ctx, 8, 198, 172, 198, 1, LIGHT_GRAY);
  draw_icon(ctx, IconHistory, 24, 210, TEAL);
  label(ctx, "Activity history", s_small_bold, 42, 201, 128, 24,
        GColorBlack, GTextAlignmentLeft);
}

static void gps_screen(GContext *ctx, bool locked, bool error) {
  chrome(ctx, "RUNNING", false, IconRefresh,
         locked ? IconPlay : IconNone, IconMenu, locked ? 1 : -1);
  tag(ctx, error ? "GPS ERROR" : locked ? "GPS READY" : "GPS SEARCH",
      error ? RED_INK : locked ? TEAL : GRAY, 35);
  box(ctx, 8, 58, 164, 131, 8, TEAL);
  ring(ctx, 90, 112, 42, error ? 2 : 1, error ? CORAL : CYAN);
  if (!error) ring(ctx, 90, 112, 29, 1, CYAN);
  if (error) {
    dot(ctx, 90, 112, 17, CORAL);
    draw_icon(ctx, IconClose, 90, 112, GColorBlack);
  } else if (locked) {
    dot(ctx, 90, 112, 15, LIME);
    draw_icon(ctx, IconCheck, 90, 112, GColorBlack);
  } else {
    dot(ctx, 90, 112, 9, GColorWhite);
    dot(ctx, 90, 112, 2, TEAL);
    const GPoint orbit[] = {
      {90, 70}, {120, 82}, {132, 112}, {120, 142},
      {90, 154}, {60, 142}, {48, 112}, {60, 82}
    };
    int frame = s_screen == 1 && s_anim_frame >= 0 ?
                s_anim_frame % ARRAY_LENGTH(orbit) : 0;
    dot(ctx, orbit[frame].x, orbit[frame].y, 4, LIME);
  }
  label(ctx, error ? "Signal lost" :
        locked ? "GPS locked" : "Finding GPS", s_title,
        16, 153, 148, 30, GColorWhite, GTextAlignmentCenter);
  if (error) {
    label(ctx, "Phone GPS unavailable", s_small_bold, 8, 194, 164, 22,
          GColorBlack, GTextAlignmentLeft);
    label(ctx, "UP RETRY", s_tiny, 104, 209, 68, 17,
          RED_INK, GTextAlignmentRight);
  } else {
    label(ctx, locked ? "12 m" : "38 m", s_title, 8, 190, 67, 34,
          GColorBlack, GTextAlignmentLeft);
    label(ctx, locked ? "PRESS SELECT" : "TARGET 25 m", s_tiny,
          83, 198, 89, 18, locked ? TEAL : GRAY,
          GTextAlignmentRight);
    box(ctx, 8, 215, locked ? 164 : 100, 3, 1,
        locked ? LIME : AMBER);
  }
}

static void countdown_screen(GContext *ctx) {
  int number = s_anim_frame >= 0 && s_screen == 3 ?
               3 - s_anim_frame / 10 : 3;
  if (number < 1) number = 1;
  chrome(ctx, "RUNNING", false, IconNone, IconNone, IconNone, -1);
  tag(ctx, "STARTING", TEAL, 34);
  box(ctx, 8, 58, 164, 139, 8, TEAL);
  ring(ctx, 90, 123, 55, 3, CYAN);
  if (s_anim_frame >= 0 && s_screen == 3) {
    graphics_context_set_stroke_color(ctx, LIME);
    graphics_context_set_stroke_width(ctx, 3);
    graphics_draw_arc(ctx, GRect(35, 68, 110, 110),
                      GOvalScaleModeFitCircle, 0,
                      DEG_TO_TRIGANGLE((s_anim_frame % 10 + 1) * 36));
  }
  // The numeral follows the same rounded route stroke used across the UI.
  // Fixed point paths keep it large without a bitmap or font resource.
  const GPoint three[] = {
    {68, 89}, {76, 80}, {90, 76}, {104, 79}, {113, 90},
    {115, 103}, {110, 113}, {99, 119}, {86, 120},
    {101, 120}, {111, 127}, {116, 139}, {113, 151},
    {104, 159}, {91, 163}, {76, 161}, {67, 154}
  };
  const GPoint two[] = {
    {68, 89}, {76, 80}, {90, 76}, {104, 79}, {113, 90},
    {115, 103}, {110, 115}, {99, 126}, {85, 139},
    {70, 153}, {67, 162}, {116, 162}
  };
  const GPoint one[] = {
    {72, 99}, {91, 78}, {91, 163}
  };
  const GPoint *points = number == 3 ? three : number == 2 ? two : one;
  unsigned count = number == 3 ? ARRAY_LENGTH(three) :
                   number == 2 ? ARRAY_LENGTH(two) : ARRAY_LENGTH(one);
  for (unsigned i = 1; i < count; i++) {
    segment(ctx, points[i - 1].x, points[i - 1].y,
            points[i].x, points[i].y, 6, GColorWhite);
  }
  for (unsigned i = 0; i < count; i++) {
    dot(ctx, points[i].x, points[i].y, 3, GColorWhite);
  }
  for (int i = 0; i < 3; i++) {
    box(ctx, 54 + i * 36, 181, 24, 4, 2,
        i < 4 - number ? LIME : CYAN);
  }
  label(ctx, "RUNNING", s_small_bold, 8, 199, 164, 24,
        GRAY, GTextAlignmentCenter);
}

static void activity_screen(GContext *ctx, const char *mode,
                            const char *elapsed, const char *distance,
                            const char *movement_label,
                            const char *movement, const char *bpm,
                            const char *hr_label, GColor hr_color,
                            bool paused, bool dark, bool offline) {
  chrome(ctx, mode, dark, paused ? IconPlay : IconPause,
         paused ? IconStop : IconNone, IconNone, paused ? 0 : -1);
  box(ctx, 8, 34, 164, 78, 8, paused ? AMBER : TEAL);
  GColor hero_ink = paused ? GColorBlack : GColorWhite;
  GColor route_color = paused ? GColorBlack : LIME;
  segment(ctx, 18, 47, 18, 99, 2, route_color);
  dot(ctx, 18, 47, 3, route_color);
  dot(ctx, 18, 99, 3, route_color);
  label(ctx, paused ? "PAUSED" : "ELAPSED", s_small_bold,
        28, 39, 71, 19, hero_ink, GTextAlignmentLeft);
  if (offline) dot(ctx, 95, 49, 3, CORAL);
  label(ctx, offline ? "PHONE OFF" : "GPS 10 m",
        s_tiny, offline ? 102 : 111, 39,
        offline ? 59 : 50, 20, hero_ink, GTextAlignmentRight);
  bool long_elapsed = strlen(elapsed) > 5;
  label(ctx, elapsed, long_elapsed ? s_long_hero : s_hero,
        27, long_elapsed ? 62 : 59, 140, 53,
        hero_ink, GTextAlignmentCenter);
  metric_card(ctx, 8, distance[0] == '4' || distance[0] == '1' ?
              "DIST KM" : "DIST M", distance, dark);
  metric_card(ctx, 94, movement_label, movement, dark);
  heart_row(ctx, bpm, hr_label, hr_color, dark);
}

static void split_screen(GContext *ctx) {
  chrome(ctx, "RUNNING", false, IconPause, IconNone, IconNone, -1);
  tag(ctx, "KILOMETRE SPLIT", TEAL, 35);
  box(ctx, 8, 58, 164, 91, 8, TEAL);
  route_mark(ctx, 136, 80, LIME);
  label(ctx, "KM 04", s_title, 20, 63, 96, 28,
        LIME, GTextAlignmentLeft);
  label(ctx, "05:02", s_hero, 16, 89, 148, 55,
        GColorWhite, GTextAlignmentCenter);
  box(ctx, 8, 157, 78, 48, 7, GColorWhite);
  box(ctx, 94, 157, 78, 48, 7, GColorWhite);
  outline(ctx, 8, 157, 78, 48, 7, LIGHT_GRAY);
  outline(ctx, 94, 157, 78, 48, 7, LIGHT_GRAY);
  label(ctx, "SPLIT PACE", s_tiny, 16, 160, 66, 18,
        GRAY, GTextAlignmentLeft);
  label(ctx, "5:02", s_value, 16, 170, 67, 30,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "HEART Z2", s_tiny, 102, 160, 66, 18,
        GRAY, GTextAlignmentLeft);
  label(ctx, "154", s_value, 102, 170, 64, 30,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "BACK TO RUN IN 6 s", s_tiny, 8, 207, 164, 18,
        GRAY, GTextAlignmentCenter);
}

static void recovery_screen(GContext *ctx) {
  chrome(ctx, "RUNNING", false, IconPlay, IconStop, IconClose, -1);
  tag(ctx, "ACTIVITY FOUND", AMBER_INK, 33);
  box(ctx, 8, 56, 164, 62, 8, TEAL);
  label(ctx, "Ready to resume", s_menu, 18, 65, 150, 28,
        GColorWhite, GTextAlignmentLeft);
  label(ctx, "RUNNING · PARTIAL", s_small_bold, 18, 89, 150, 23,
        LIME, GTextAlignmentLeft);
  box(ctx, 8, 127, 78, 49, 7, GColorWhite);
  box(ctx, 94, 127, 78, 49, 7, GColorWhite);
  outline(ctx, 8, 127, 78, 49, 7, LIGHT_GRAY);
  outline(ctx, 94, 127, 78, 49, 7, LIGHT_GRAY);
  label(ctx, "TIME", s_tiny, 16, 132, 66, 18, GRAY, GTextAlignmentLeft);
  label(ctx, "23:14", s_title, 16, 143, 67, 29,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "DISTANCE", s_tiny, 102, 132, 66, 18, GRAY,
        GTextAlignmentLeft);
  label(ctx, "4.62", s_value, 102, 143, 65, 29,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "Phone draft available", s_small_bold, 8, 182, 164, 21,
        TEAL, GTextAlignmentLeft);
  label(ctx, "UP RESUME · SEL FINISH", s_tiny, 8, 201, 164, 23,
        GRAY, GTextAlignmentLeft);
}

static void confirm_screen(GContext *ctx, bool discard) {
  chrome(ctx, "RUNNING", false, IconCheck, IconNone, IconClose, -1);
  tag(ctx, discard ? "PERMANENT ACTION" : "FINISH ACTIVITY",
      RED_INK, 34);
  box(ctx, 8, 57, 164, 128, 8, TEAL);
  box(ctx, 19, 70, 27, 27, 5, CORAL);
  draw_icon(ctx, discard ? IconClose : IconStop, 32, 83, GColorBlack);
  label(ctx, discard ? "Discard this" : "Finish this", s_title,
        18, 104, 146, 28, GColorWhite, GTextAlignmentLeft);
  label(ctx, discard ? "activity?" : "run?", s_title,
        18, 128, 146, 28, GColorWhite, GTextAlignmentLeft);
  label(ctx, discard ? "Cannot be undone" : "23:14 elapsed",
        s_small_bold, 18, 157, 146, 22, LIME, GTextAlignmentLeft);
  label(ctx, discard ? "UP DELETE · DOWN BACK" :
        "UP SAVE · DOWN BACK", s_small_bold,
        8, 190, 164, 27, GColorBlack, GTextAlignmentLeft);
}

static void saved_screen(GContext *ctx) {
  chrome(ctx, "RUNNING", false, IconPlay, IconNone, IconMenu, -1);
  box(ctx, 8, 37, 164, 94, 8, TEAL);
  dot(ctx, 46, 84, 25, LIME);
  draw_icon(ctx, IconCheck, 46, 84, GColorBlack);
  label(ctx, "Saved.", s_title, 82, 61, 88, 33,
        GColorWhite, GTextAlignmentLeft);
  label(ctx, "RUNNING", s_small_bold, 82, 86, 86, 22,
        LIME, GTextAlignmentLeft);
  box(ctx, 8, 141, 78, 58, 7, GColorWhite);
  box(ctx, 94, 141, 78, 58, 7, GColorWhite);
  outline(ctx, 8, 141, 78, 58, 7, LIGHT_GRAY);
  outline(ctx, 94, 141, 78, 58, 7, LIGHT_GRAY);
  label(ctx, "TIME", s_tiny, 16, 146, 66, 18, GRAY, GTextAlignmentLeft);
  label(ctx, "23:14", s_title, 16, 160, 68, 32,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "DISTANCE", s_tiny, 102, 146, 66, 18, GRAY,
        GTextAlignmentLeft);
  label(ctx, "4.62", s_value, 102, 160, 65, 32,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "286 GPS POINTS", s_tiny, 8, 205, 164, 20,
        GRAY, GTextAlignmentCenter);
}

static void history_list_screen(GContext *ctx) {
  chrome(ctx, "HISTORY", false, IconUp, IconCheck, IconDown, -1);
  label(ctx, "Recent activity", s_title, 8, 34, 164, 29,
        GColorBlack, GTextAlignmentLeft);
  const char *titles[] = {"01  RUN  23:14", "02  RUN  18:56",
                          "03  RIDE  41:08"};
  const char *details[] = {"4.62 KM · 5:02/KM", "3.18 KM · 5:57/KM",
                           "18.74 KM · 27.3 KM/H"};
  GColor marks[] = {LIME, CORAL, AMBER};
  for (int i = 0; i < 3; i++) {
    int y = 61 + 48 * i;
    bool selected = i == 1;
    box(ctx, 8, y, 164, 43, 7, selected ? TEAL : GColorWhite);
    if (!selected) outline(ctx, 8, y, 164, 43, 7, LIGHT_GRAY);
    label(ctx, titles[i], s_small_bold, 16, y + 2, 140, 21,
          selected ? GColorWhite : GColorBlack, GTextAlignmentLeft);
    label(ctx, details[i], s_tiny, 16, y + 20, 146, 19,
          selected ? GColorWhite : GRAY, GTextAlignmentLeft);
    dot(ctx, 157, y + 13, 3, marks[i]);
  }
  draw_icon(ctx, IconDown, 14, 217, TEAL);
  label(ctx, "More activity", s_tiny, 25, 205, 145, 20,
        GRAY, GTextAlignmentLeft);
}

static void history_detail_screen(GContext *ctx) {
  chrome(ctx, "HISTORY", false, IconFile, IconRefresh, IconClose, -1);
  tag(ctx, "RUNNING · 02 / 03", TEAL, 33);
  box(ctx, 8, 56, 164, 67, 8, TEAL);
  label(ctx, "DISTANCE", s_small_bold, 18, 61, 88, 19,
        LIME, GTextAlignmentLeft);
  label(ctx, "3.18", s_hero, 18, 70, 114, 51,
        GColorWhite, GTextAlignmentLeft);
  label(ctx, "KM", s_small_bold, 129, 92, 33, 21,
        GColorWhite, GTextAlignmentLeft);
  box(ctx, 8, 132, 78, 51, 7, GColorWhite);
  box(ctx, 94, 132, 78, 51, 7, GColorWhite);
  outline(ctx, 8, 132, 78, 51, 7, LIGHT_GRAY);
  outline(ctx, 94, 132, 78, 51, 7, LIGHT_GRAY);
  label(ctx, "TIME", s_tiny, 16, 136, 67, 18, GRAY,
        GTextAlignmentLeft);
  label(ctx, "18:56", s_title, 16, 150, 68, 29,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "AVG PACE", s_tiny, 102, 136, 66, 18, GRAY,
        GTextAlignmentLeft);
  label(ctx, "5:57", s_value, 102, 150, 65, 29,
        GColorBlack, GTextAlignmentLeft);
  dot(ctx, 14, 198, 4, CORAL);
  label(ctx, "STRAVA FAILED", s_small_bold, 24, 186, 145, 23,
        RED_INK, GTextAlignmentLeft);
  label(ctx, "UP TCX · SELECT RETRY", s_tiny, 8, 205, 164, 20,
        GRAY, GTextAlignmentLeft);
}

static void history_empty_screen(GContext *ctx) {
  chrome(ctx, "HISTORY", false, IconRefresh, IconNone, IconClose, -1);
  label(ctx, "Recent activity", s_title, 8, 34, 164, 30,
        GColorBlack, GTextAlignmentLeft);
  box(ctx, 8, 68, 164, 111, 8, GColorWhite);
  outline(ctx, 8, 68, 164, 111, 8, LIGHT_GRAY);
  segment(ctx, 43, 103, 87, 103, 2, TEAL);
  dot(ctx, 43, 103, 6, LIME);
  dot(ctx, 87, 103, 6, GColorWhite);
  ring(ctx, 87, 103, 6, 2, TEAL);
  label(ctx, "No activities yet", s_menu, 18, 115, 148, 29,
        GColorBlack, GTextAlignmentLeft);
  label(ctx, "Your route starts here.", s_small, 18, 141, 148, 22,
        GRAY, GTextAlignmentLeft);
  label(ctx, "UP REFRESH · DOWN BACK", s_tiny, 8, 201, 164, 21,
        GRAY, GTextAlignmentLeft);
}

static void update_proc(Layer *layer, GContext *ctx) {
  switch (s_screen) {
    case 0: choose_screen(ctx); break;
    case 1: gps_screen(ctx, false, false); break;
    case 2: gps_screen(ctx, true, false); break;
    case 3: countdown_screen(ctx); break;
    case 4:
      activity_screen(ctx, "WALKING", "18:42", "1.32",
                      "STEPS", "2210", "112", "HEART Z1",
                      CYAN, false, false, false);
      break;
    case 5:
      activity_screen(ctx, "RUNNING", "23:14", "4.62",
                      "PACE /KM", "5:02", "153", "HEART Z2",
                      AMBER, false, false, false);
      break;
    case 6:
      activity_screen(ctx, "CYCLING", "41:08", "18.74",
                      "SPEED KM/H", "27.3", "146", "HEART Z2",
                      AMBER, false, false, false);
      break;
    case 7: split_screen(ctx); break;
    case 8:
      activity_screen(ctx, "RUNNING", "23:14", "4.62",
                      "PACE /KM", "5:02", "153", "HEART Z2",
                      AMBER, true, false, false);
      break;
    case 9: recovery_screen(ctx); break;
    case 10: confirm_screen(ctx, false); break;
    case 11: confirm_screen(ctx, true); break;
    case 12: saved_screen(ctx); break;
    case 13: history_list_screen(ctx); break;
    case 14: history_detail_screen(ctx); break;
    case 15:
      activity_screen(ctx, "RUNNING", "23:14", "4.62",
                      "PACE /KM", "5:02", "153", "HEART Z2",
                      AMBER, false, true, false);
      break;
    case 16: gps_screen(ctx, false, true); break;
    case 17:
      activity_screen(ctx, "RUNNING", "00:18", "42",
                      "PACE /KM", "--:--", "--", "HR FINDING",
                      GRAY, false, false, false);
      break;
    case 18:
      activity_screen(ctx, "RUNNING", "23:14", "4.62",
                      "PACE /KM", "5:02", "153", "HEART Z2",
                      AMBER, false, false, true);
      break;
    case 19: history_empty_screen(ctx); break;
    case 20:
      activity_screen(ctx, "RUNNING", "1:23:45", "128.74",
                      "PACE /KM", "12:34", "179", "HEART Z3",
                      CORAL, false, false, false);
      break;
    default: choose_screen(ctx); break;
  }
}

static void stop_animation(void) {
  if (s_anim_timer) {
    app_timer_cancel(s_anim_timer);
    s_anim_timer = NULL;
  }
  s_animating = false;
  s_anim_frame = -1;
}

static void animation_tick(void *context) {
  s_anim_timer = NULL;
  if (!s_animating) return;
  s_anim_frame++;
  if (s_screen == 3 && s_anim_frame >= 30) {
    s_anim_frame = 29;
    s_animating = false;
    layer_mark_dirty(s_layer);
    return;
  }
  layer_mark_dirty(s_layer);
  s_anim_timer = app_timer_register(s_screen == 1 ? 125 : 100,
                                    animation_tick, NULL);
}

static void start_animation(void) {
  stop_animation();
  s_anim_frame = 0;
  s_animating = true;
  layer_mark_dirty(s_layer);
  s_anim_timer = app_timer_register(s_screen == 1 ? 125 : 100,
                                    animation_tick, NULL);
}

static void up_click(ClickRecognizerRef recognizer, void *context) {
  stop_animation();
  s_screen = (s_screen + SCREEN_COUNT - 1) % SCREEN_COUNT;
  layer_mark_dirty(s_layer);
}

static void down_click(ClickRecognizerRef recognizer, void *context) {
  stop_animation();
  s_screen = (s_screen + 1) % SCREEN_COUNT;
  layer_mark_dirty(s_layer);
}

static void select_click(ClickRecognizerRef recognizer, void *context) {
  if (s_screen == 1 || s_screen == 3) {
    start_animation();
    return;
  }
  stop_animation();
  s_screen = 0;
  layer_mark_dirty(s_layer);
}

static void click_config(void *context) {
  window_single_click_subscribe(BUTTON_ID_UP, up_click);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click);
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click);
}

static void window_load(Window *window) {
  s_tiny = fonts_get_system_font(FONT_KEY_GOTHIC_14);
  s_small = fonts_get_system_font(FONT_KEY_GOTHIC_18);
  s_small_bold = fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
  s_menu = fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
  s_title = fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
  s_value = fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD);
  s_hero = fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD);
  s_long_hero = fonts_get_system_font(FONT_KEY_BITHAM_34_MEDIUM_NUMBERS);
  Layer *root = window_get_root_layer(window);
  s_layer = layer_create(layer_get_bounds(root));
  layer_set_update_proc(s_layer, update_proc);
  layer_add_child(root, s_layer);
}

static void window_unload(Window *window) {
  stop_animation();
  layer_destroy(s_layer);
  s_layer = NULL;
}

int main(void) {
  s_window = window_create();
  window_set_click_config_provider(s_window, click_config);
  window_set_window_handlers(s_window, (WindowHandlers) {
    .load = window_load,
    .unload = window_unload
  });
  window_stack_push(s_window, true);
  app_event_loop();
  window_destroy(s_window);
}
