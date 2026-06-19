#include "watch_ui.h"

#include "pacelet_model.h"

#include <string.h>

#define ACTION_RAIL_W 20

typedef enum {
  ActionIconNone = 0,
  ActionIconUp,
  ActionIconDown,
  ActionIconGps,
  ActionIconRefresh,
  ActionIconPlay,
  ActionIconPause,
  ActionIconStop,
  ActionIconCheck,
  ActionIconClose,
  ActionIconType
} ActionIcon;

static Window *s_window;
static Layer *s_canvas_layer;
static GBitmap *s_activity_icons[3][2];
static GBitmap *s_countdown_icons[3][2];
static GBitmap *s_heart_icons[2];
static GBitmap *s_measuring_heart_icons[2];

static const uint32_t ACTIVITY_ICON_RESOURCE_IDS[3][2] = {
  {
    RESOURCE_ID_IMAGE_ACTIVITY_WALK_BLACK,
    RESOURCE_ID_IMAGE_ACTIVITY_WALK_WHITE
  },
  {
    RESOURCE_ID_IMAGE_ACTIVITY_RUN_BLACK,
    RESOURCE_ID_IMAGE_ACTIVITY_RUN_WHITE
  },
  {
    RESOURCE_ID_IMAGE_ACTIVITY_CYCLE_BLACK,
    RESOURCE_ID_IMAGE_ACTIVITY_CYCLE_WHITE
  }
};

static const uint32_t COUNTDOWN_ICON_RESOURCE_IDS[3][2] = {
  {
    RESOURCE_ID_IMAGE_COUNTDOWN_1_BLACK,
    RESOURCE_ID_IMAGE_COUNTDOWN_1_WHITE
  },
  {
    RESOURCE_ID_IMAGE_COUNTDOWN_2_BLACK,
    RESOURCE_ID_IMAGE_COUNTDOWN_2_WHITE
  },
  {
    RESOURCE_ID_IMAGE_COUNTDOWN_3_BLACK,
    RESOURCE_ID_IMAGE_COUNTDOWN_3_WHITE
  }
};

static const uint32_t HEART_ICON_RESOURCE_IDS[2] = {
  RESOURCE_ID_IMAGE_HEART_BLACK,
  RESOURCE_ID_IMAGE_HEART_WHITE
};

static const uint32_t MEASURING_HEART_ICON_RESOURCE_IDS[2] = {
  RESOURCE_ID_IMAGE_HEART_MEASURING_BLACK,
  RESOURCE_ID_IMAGE_HEART_MEASURING_WHITE
};

static GColor color_bg(void) {
  return PBL_IF_COLOR_ELSE(
      g_pacelet.dark_mode ? GColorFromHEX(0x071014)
                          : GColorFromHEX(0xf7fbf8),
      GColorWhite);
}

static GColor color_text(void) {
  return PBL_IF_COLOR_ELSE(
      g_pacelet.dark_mode ? GColorWhite : GColorBlack, GColorBlack);
}

static GColor color_muted(void) {
  return PBL_IF_COLOR_ELSE(
      g_pacelet.dark_mode ? GColorFromHEX(0xa9b5ad)
                          : GColorFromHEX(0x3e5459),
      GColorBlack);
}

static GColor color_accent(void) {
  return PBL_IF_COLOR_ELSE(
      g_pacelet.dark_mode ? GColorFromHEX(0x00d084)
                          : GColorFromHEX(0x007c54),
      GColorBlack);
}

static GColor color_on_accent(void) {
  return PBL_IF_COLOR_ELSE(
      g_pacelet.dark_mode ? GColorBlack : GColorWhite, GColorWhite);
}

static GColor color_warning(void) {
  return PBL_IF_COLOR_ELSE(
      g_pacelet.dark_mode ? GColorFromHEX(0xffc400)
                          : GColorFromHEX(0x9a6500),
      GColorBlack);
}

static GColor color_pause_bg(void) {
  return PBL_IF_COLOR_ELSE(GColorYellow, GColorWhite);
}

static GColor color_bad(void) {
  return PBL_IF_COLOR_ELSE(
      g_pacelet.dark_mode ? GColorFromHEX(0xff4b4b)
                          : GColorFromHEX(0xb00020),
      GColorBlack);
}

static GFont font_status(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
}

static GFont font_label(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_14);
}

static GFont font_metric_label(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
}

static GFont font_value(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
}

static GFont font_metric_value(void) {
  return fonts_get_system_font(FONT_KEY_LECO_26_BOLD_NUMBERS_AM_PM);
}

static GFont font_metric_unit(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
}

static GFont font_menu(void) {
  return fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
}

static GFont font_timer(void) {
  return fonts_get_system_font(FONT_KEY_LECO_42_NUMBERS);
}

static void format_elapsed(int32_t total_s, char *buffer,
                           size_t buffer_size) {
  int32_t hours = total_s / 3600;
  int32_t minutes = (total_s % 3600) / 60;
  int32_t seconds = total_s % 60;

  if (hours > 0) {
    snprintf(buffer, buffer_size, "%ld:%02ld:%02ld",
             (long)hours, (long)minutes, (long)seconds);
  } else {
    snprintf(buffer, buffer_size, "%02ld:%02ld",
             (long)minutes, (long)seconds);
  }
}

static void format_clock(char *buffer, size_t buffer_size) {
  time_t now = time(NULL);
  struct tm *time_now = localtime(&now);

  if (!time_now) {
    snprintf(buffer, buffer_size, "--:--");
    return;
  }

  if (clock_is_24h_style()) {
    strftime(buffer, buffer_size, "%H:%M", time_now);
  } else {
    strftime(buffer, buffer_size, "%I:%M", time_now);
    if (buffer[0] == '0') {
      memmove(buffer, buffer + 1, strlen(buffer));
    }
  }
}

static void format_distance_parts(int32_t meters,
                                  char *value, size_t value_size,
                                  char *unit, size_t unit_size) {
  if (meters >= 1000) {
    snprintf(value, value_size, "%ld.%02ld",
             (long)(meters / 1000), (long)((meters % 1000) / 10));
    snprintf(unit, unit_size, "KM");
  } else {
    snprintf(value, value_size, "%ld", (long)meters);
    snprintf(unit, unit_size, "M");
  }
}

static void format_pace_parts(int32_t pace_s_per_km,
                              char *value, size_t value_size,
                              char *unit, size_t unit_size) {
  if (pace_s_per_km <= 0 || pace_s_per_km > 5999) {
    snprintf(value, value_size, "--:--");
  } else {
    snprintf(value, value_size, "%ld:%02ld",
             (long)(pace_s_per_km / 60), (long)(pace_s_per_km % 60));
  }
  snprintf(unit, unit_size, "/KM");
}

static void format_speed_parts(int32_t centi_mps,
                               char *value, size_t value_size,
                               char *unit, size_t unit_size) {
  if (centi_mps <= 0) {
    snprintf(value, value_size, "--.-");
  } else {
    int32_t kmh_x10 = (centi_mps * 36) / 100;
    snprintf(value, value_size, "%ld.%ld",
             (long)(kmh_x10 / 10), (long)(kmh_x10 % 10));
  }
  snprintf(unit, unit_size, "KM/H");
}

static const char *state_short_label(void) {
  if (g_pacelet.finish_confirm_visible) {
    return "END?";
  }

  switch (g_pacelet.activity_state) {
    case ActivityStateChoose:
      return "PICK";
    case ActivityStateGps:
      return g_pacelet.gps_state == GpsStateError ? "ERROR" : "GPS";
    case ActivityStateReady:
      return "READY";
    case ActivityStateCountdown:
      return "3-2-1";
    case ActivityStateActive:
      return g_pacelet.split_visible ? "SPLIT" : "REC";
    case ActivityStatePaused:
      return "PAUSE";
    case ActivityStateFinished:
      return "SAVED";
    default:
      return "";
  }
}

static GColor state_color(void) {
  if (g_pacelet.finish_confirm_visible) {
    return color_warning();
  }

  if (g_pacelet.activity_state == ActivityStateActive ||
      g_pacelet.activity_state == ActivityStateReady ||
      g_pacelet.activity_state == ActivityStateCountdown ||
      g_pacelet.gps_state == GpsStateLocked) {
    return color_accent();
  }
  if (g_pacelet.activity_state == ActivityStatePaused ||
      g_pacelet.gps_state == GpsStateSearching) {
    return color_warning();
  }
  if (g_pacelet.gps_state == GpsStateError) {
    return color_bad();
  }
  return color_muted();
}

static GColor hr_zone_color(HrZone zone) {
  switch (zone) {
    case HrZoneOne:
      return PBL_IF_COLOR_ELSE(GColorMelon, GColorWhite);
    case HrZoneTwo:
      return PBL_IF_COLOR_ELSE(GColorChromeYellow, GColorWhite);
    case HrZoneThree:
      return PBL_IF_COLOR_ELSE(GColorOrange, GColorWhite);
    case HrZoneBelow:
    default:
      return color_bg();
  }
}

static int content_right(GRect bounds) {
  return bounds.size.w - ACTION_RAIL_W;
}

static int action_rail_x(GRect bounds) {
  return bounds.size.w - ACTION_RAIL_W;
}

static int rail_icon_y(GRect bounds, int index) {
  return (bounds.size.h * (index + 1)) / 4;
}

static int choose_row_y(int index) {
  return 38 + index * 54;
}

static void draw_dotted_separator(GContext *ctx, int right, int y,
                                  GColor color) {
  graphics_context_set_stroke_color(ctx, color);
  for (int x = 8; x < right - 4; x += 4) {
    graphics_draw_pixel(ctx, GPoint(x, y));
  }
}

static void draw_duration_band(GContext *ctx, GRect bounds, int y,
                               int height, const char *elapsed_text,
                               bool paused) {
  int right = content_right(bounds);
  GColor bg = paused ? color_pause_bg() : color_accent();
  GColor ink = paused ? GColorBlack : color_on_accent();
  int text_y = y + (height - 45) / 2;

  graphics_context_set_fill_color(ctx, bg);
  graphics_fill_rect(ctx, GRect(0, y, right, height), 0, GCornerNone);

  if (paused) {
    graphics_context_set_text_color(ctx, ink);
    graphics_draw_text(ctx, "PAUSED", font_status(),
                       GRect(7, y + 2, right - 14, 18),
                       GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentLeft, NULL);
  }

  graphics_context_set_text_color(ctx, ink);
  graphics_draw_text(ctx, elapsed_text, font_timer(),
                     GRect(0, text_y, right, 45),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);
}

static void draw_metric_row(GContext *ctx, GRect bounds, int y, int height,
                            const char *label, const char *value,
                            const char *unit) {
  int right = content_right(bounds);
  int unit_width = 40;

  draw_dotted_separator(ctx, right, y, color_muted());

  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(ctx, label, font_metric_label(),
                     GRect(8, y + (height - 18) / 2, 44, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);

  graphics_context_set_text_color(ctx, color_text());
  graphics_draw_text(ctx, value, font_metric_value(),
                     GRect(42, y + (height - 30) / 2,
                           right - 42 - unit_width, 30),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentRight, NULL);

  graphics_draw_text(ctx, unit, font_metric_unit(),
                     GRect(right - unit_width + 3,
                           y + (height - 18) / 2 + 2,
                           unit_width - 3, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
}

static void draw_heart_icon(GContext *ctx, GPoint center, GColor color) {
  int variant = gcolor_equal(color, GColorWhite) ? 1 : 0;
  GBitmap *icon = s_heart_icons[variant];
  if (icon) {
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(
        ctx, icon, GRect(center.x - 12, center.y - 12, 24, 24));
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
  }
}

static void draw_measuring_heart(GContext *ctx, GPoint center) {
  int pulse = g_pacelet.anim_tick % 2;
  int variant = g_pacelet.dark_mode ? 1 : 0;
  GBitmap *icon = s_measuring_heart_icons[variant];

  graphics_context_set_stroke_color(ctx, color_muted());
  graphics_draw_circle(ctx, center, pulse ? 11 : 9);

  if (icon) {
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(
        ctx, icon, GRect(center.x - 8, center.y - 8, 16, 16));
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
  }
}

static void draw_measuring_hr_row(GContext *ctx, GRect bounds, int y,
                                  int height) {
  int right = content_right(bounds);
  int center_y = y + height / 2;

  draw_dotted_separator(ctx, right, y, color_muted());
  draw_measuring_heart(ctx, GPoint(20, center_y));
  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(ctx, "MEASURING", font_status(),
                     GRect(40, center_y - 9, right - 46, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
}

static void draw_hr_row(GContext *ctx, GRect bounds, int y, int height,
                        int32_t bpm) {
  int right = content_right(bounds);
  HrZone zone = bpm > 0 ? pacelet_hr_zone_for_bpm(bpm) : HrZoneBelow;
  GColor ink = zone == HrZoneBelow ? color_text() : GColorBlack;
  char value[16];

  if (bpm <= 0 && g_pacelet.activity_state == ActivityStateActive) {
    draw_measuring_hr_row(ctx, bounds, y, height);
    return;
  }

  graphics_context_set_fill_color(ctx, hr_zone_color(zone));
  graphics_fill_rect(ctx, GRect(0, y, right, height), 0, GCornerNone);
  draw_dotted_separator(ctx, right, y,
                        zone == HrZoneBelow ? color_muted() : ink);

  graphics_context_set_text_color(ctx, ink);
  graphics_draw_text(
      ctx,
      zone == HrZoneBelow ? "HEART RATE" : pacelet_hr_zone_label(zone),
      font_metric_label(), GRect(8, y + 3, 92, 18),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  if (zone != HrZoneBelow) {
    graphics_context_set_fill_color(ctx, ink);
    graphics_context_set_stroke_color(ctx, ink);
    for (int i = 1; i <= 3; i++) {
      GRect bar = GRect(8 + (i - 1) * 15, y + height - 8, 12, 4);
      if (i <= (int)zone) {
        graphics_fill_rect(ctx, bar, 0, GCornerNone);
      } else {
        graphics_draw_rect(ctx, bar);
      }
    }
  }

  if (bpm > 0) {
    snprintf(value, sizeof(value), "%ld", (long)bpm);
  } else {
    snprintf(value, sizeof(value), "--");
  }
  if (right >= 150) {
    draw_heart_icon(ctx, GPoint(right - 66, y + height / 2 + 1), ink);
  }
  graphics_draw_text(ctx, value, font_metric_value(),
                     GRect(right - 57, y + (height - 30) / 2, 53, 30),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentRight, NULL);
}

static void draw_top_bar(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  int third = right / 3;
  char clock_text[8];

  graphics_context_set_fill_color(ctx, state_color());
  graphics_fill_rect(ctx, GRect(0, 0, right, 2), 0, GCornerNone);

  format_clock(clock_text, sizeof(clock_text));

  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(
      ctx, pacelet_activity_short_label(g_pacelet.activity_type),
      font_status(), GRect(8, 5, third - 8, 18),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  graphics_context_set_text_color(ctx, color_text());
  graphics_draw_text(ctx, clock_text, font_status(),
                     GRect(third, 5, third, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);

  graphics_context_set_text_color(ctx, state_color());
  graphics_draw_text(ctx, state_short_label(), font_status(),
                     GRect(third * 2, 5, right - third * 2 - 4, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentRight, NULL);
}

static void draw_action_icon(GContext *ctx, GPoint center, ActionIcon icon,
                             GColor color) {
  int x = center.x;
  int y = center.y;

  if (icon == ActionIconNone) {
    return;
  }

  graphics_context_set_stroke_width(ctx, 2);
  graphics_context_set_stroke_color(ctx, color);
  graphics_context_set_fill_color(ctx, color);

  switch (icon) {
    case ActionIconUp:
      graphics_draw_line(ctx, GPoint(x - 5, y + 3), GPoint(x, y - 3));
      graphics_draw_line(ctx, GPoint(x, y - 3), GPoint(x + 5, y + 3));
      break;
    case ActionIconDown:
      graphics_draw_line(ctx, GPoint(x - 5, y - 3), GPoint(x, y + 3));
      graphics_draw_line(ctx, GPoint(x, y + 3), GPoint(x + 5, y - 3));
      break;
    case ActionIconGps:
      graphics_draw_circle(ctx, center, 5);
      graphics_draw_line(ctx, GPoint(x, y - 8), GPoint(x, y - 5));
      graphics_draw_line(ctx, GPoint(x, y + 5), GPoint(x, y + 8));
      graphics_draw_line(ctx, GPoint(x - 8, y), GPoint(x - 5, y));
      graphics_draw_line(ctx, GPoint(x + 5, y), GPoint(x + 8, y));
      graphics_fill_circle(ctx, center, 2);
      break;
    case ActionIconRefresh:
      graphics_draw_circle(ctx, center, 5);
      graphics_draw_line(ctx, GPoint(x + 2, y - 6), GPoint(x + 6, y - 6));
      graphics_draw_line(ctx, GPoint(x + 6, y - 6), GPoint(x + 6, y - 2));
      break;
    case ActionIconPlay:
      graphics_draw_line(ctx, GPoint(x - 3, y - 6), GPoint(x + 5, y));
      graphics_draw_line(ctx, GPoint(x + 5, y), GPoint(x - 3, y + 6));
      graphics_draw_line(ctx, GPoint(x - 3, y + 6),
                         GPoint(x - 3, y - 6));
      break;
    case ActionIconPause:
      graphics_fill_rect(ctx, GRect(x - 5, y - 6, 3, 12),
                         1, GCornersAll);
      graphics_fill_rect(ctx, GRect(x + 2, y - 6, 3, 12),
                         1, GCornersAll);
      break;
    case ActionIconStop:
      graphics_fill_rect(ctx, GRect(x - 5, y - 5, 10, 10),
                         1, GCornersAll);
      break;
    case ActionIconCheck:
      graphics_draw_line(ctx, GPoint(x - 6, y), GPoint(x - 2, y + 5));
      graphics_draw_line(ctx, GPoint(x - 2, y + 5),
                         GPoint(x + 7, y - 5));
      break;
    case ActionIconClose:
      graphics_draw_line(ctx, GPoint(x - 5, y - 5),
                         GPoint(x + 5, y + 5));
      graphics_draw_line(ctx, GPoint(x + 5, y - 5),
                         GPoint(x - 5, y + 5));
      break;
    case ActionIconType:
      graphics_draw_line(ctx, GPoint(x - 5, y - 5),
                         GPoint(x + 4, y - 5));
      graphics_draw_line(ctx, GPoint(x - 5, y), GPoint(x + 4, y));
      graphics_draw_line(ctx, GPoint(x - 5, y + 5),
                         GPoint(x + 4, y + 5));
      graphics_fill_circle(ctx, GPoint(x + 6, y - 5), 1);
      graphics_fill_circle(ctx, GPoint(x + 6, y), 1);
      graphics_fill_circle(ctx, GPoint(x + 6, y + 5), 1);
      break;
    case ActionIconNone:
    default:
      break;
  }
}

static void draw_action_rail_colors(GContext *ctx, GRect bounds,
                                    ActionIcon up, ActionIcon select,
                                    ActionIcon down, GColor rail_color,
                                    GColor icon_color) {
  int rail_x = action_rail_x(bounds);
  int icon_x = rail_x + ACTION_RAIL_W / 2;

  graphics_context_set_fill_color(ctx, rail_color);
  graphics_fill_rect(ctx, GRect(rail_x, 0, ACTION_RAIL_W, bounds.size.h),
                     0, GCornerNone);

  draw_action_icon(ctx, GPoint(icon_x, rail_icon_y(bounds, 0)),
                   up, icon_color);
  draw_action_icon(ctx, GPoint(icon_x, rail_icon_y(bounds, 1)),
                   select, icon_color);
  draw_action_icon(ctx, GPoint(icon_x, rail_icon_y(bounds, 2)),
                   down, icon_color);
}

static void draw_action_rail(GContext *ctx, GRect bounds, ActionIcon up,
                             ActionIcon select, ActionIcon down) {
  draw_action_rail_colors(ctx, bounds, up, select, down,
                          color_text(), color_bg());
}

static void draw_activity_icon_for_type(GContext *ctx, ActivityType type,
                                        GPoint center, int size,
                                        GColor icon_color) {
  int variant = gcolor_equal(icon_color, GColorWhite) ? 1 : 0;
  GBitmap *icon = s_activity_icons[type][variant];
  GRect icon_rect =
      GRect(center.x - size / 2, center.y - size / 2, size, size);

  if (!icon) {
    graphics_context_set_fill_color(ctx, icon_color);
    graphics_fill_circle(ctx, center, size / 3);
    return;
  }

  graphics_context_set_compositing_mode(ctx, GCompOpSet);
  graphics_draw_bitmap_in_rect(ctx, icon, icon_rect);
  graphics_context_set_compositing_mode(ctx, GCompOpAssign);
}

static void draw_choose_menu_item(GContext *ctx, GRect bounds,
                                  ActivityType type, int y) {
  bool selected = g_pacelet.activity_type == type;
  int right = content_right(bounds);
  int row_h = 48;
  int icon_size = 34;
  GRect row_bounds = GRect(0, y, right, row_h);
  GColor item_text = selected ? color_on_accent() : color_text();
  GColor item_icon = selected ? color_on_accent() : color_text();

  if (selected) {
    graphics_context_set_fill_color(ctx, color_accent());
    graphics_fill_rect(ctx, row_bounds, 0, GCornerNone);
  } else {
    graphics_context_set_stroke_color(ctx, color_muted());
    for (int x = 8; x < right - 4; x += 4) {
      graphics_draw_pixel(ctx, GPoint(x, y + row_h - 1));
    }
  }

  draw_activity_icon_for_type(
      ctx, type, GPoint(29, y + row_h / 2), icon_size, item_icon);

  graphics_context_set_text_color(ctx, item_text);
  graphics_draw_text(ctx, pacelet_activity_label(type), font_menu(),
                     GRect(52, y + (row_h - 24) / 2, right - 56, 24),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
}

static void draw_gps_icon(GContext *ctx, GPoint center) {
  int pulse = g_pacelet.anim_tick % 3;
  int outer_r = 18 + pulse * 3;

  graphics_context_set_stroke_width(ctx, 1);
  graphics_context_set_stroke_color(ctx, color_muted());
  graphics_draw_circle(ctx, center, outer_r);
  graphics_draw_circle(ctx, center, outer_r + 8);

  graphics_context_set_stroke_width(ctx, 2);
  graphics_context_set_stroke_color(ctx, state_color());
  graphics_draw_line(ctx, GPoint(center.x, center.y - 27),
                     GPoint(center.x, center.y - 13));
  graphics_draw_line(ctx, GPoint(center.x, center.y + 13),
                     GPoint(center.x, center.y + 27));
  graphics_draw_line(ctx, GPoint(center.x - 27, center.y),
                     GPoint(center.x - 13, center.y));
  graphics_draw_line(ctx, GPoint(center.x + 13, center.y),
                     GPoint(center.x + 27, center.y));

  graphics_context_set_fill_color(ctx, state_color());
  graphics_fill_circle(
      ctx, center, g_pacelet.gps_state == GpsStateLocked ? 7 : 5);
}

static void draw_choose_screen(GContext *ctx, GRect bounds) {
  draw_top_bar(ctx, bounds);

  draw_choose_menu_item(
      ctx, bounds, ActivityTypeWalking, choose_row_y(0));
  draw_choose_menu_item(
      ctx, bounds, ActivityTypeRunning, choose_row_y(1));
  draw_choose_menu_item(
      ctx, bounds, ActivityTypeCycling, choose_row_y(2));
  draw_action_rail(
      ctx, bounds, ActionIconUp, ActionIconGps, ActionIconDown);
}

static void draw_gps_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  int icon_y = 78;
  int title_y = 114;
  int accuracy_y = 145;
  char accuracy_text[32];
  char detail_text[32];

  draw_top_bar(ctx, bounds);
  draw_gps_icon(ctx, GPoint(right / 2, icon_y));

  graphics_context_set_text_color(ctx, state_color());
  graphics_draw_text(
      ctx,
      g_pacelet.gps_state == GpsStateLocked ? "GPS LOCKED" :
          g_pacelet.gps_state == GpsStateError ? "GPS PROBLEM" :
                                                "FINDING GPS",
      font_value(), GRect(8, title_y, right - 8, 28),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  graphics_context_set_text_color(ctx, color_text());
  if (g_pacelet.gps_state == GpsStateError &&
      g_pacelet.gps_error[0] != '\0') {
    snprintf(accuracy_text, sizeof(accuracy_text), "%s",
             g_pacelet.gps_error);
  } else if (g_pacelet.gps_accuracy_m >= 0) {
    snprintf(accuracy_text, sizeof(accuracy_text), "%ld m accuracy",
             (long)g_pacelet.gps_accuracy_m);
  } else {
    snprintf(accuracy_text, sizeof(accuracy_text),
             "Waiting for phone GPS");
  }
  graphics_draw_text(ctx, accuracy_text, font_label(),
                     GRect(8, accuracy_y, right - 8, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);

  if (g_pacelet.gps_state == GpsStateLocked) {
    snprintf(detail_text, sizeof(detail_text), "Ready to start");
  } else if (g_pacelet.gps_accuracy_m >= 0) {
    snprintf(detail_text, sizeof(detail_text), "%d m required",
             PACELET_GPS_LOCK_ACCURACY_M);
  } else {
    snprintf(detail_text, sizeof(detail_text), "Keep phone nearby");
  }
  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(ctx, detail_text, font_label(),
                     GRect(8, bounds.size.h - 25, right - 8, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);
  draw_action_rail(
      ctx, bounds, ActionIconRefresh,
      g_pacelet.gps_state == GpsStateLocked ?
          ActionIconPlay : ActionIconNone,
      ActionIconType);
}

static void draw_countdown_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  int visible_count =
      (int)pacelet_clamp_i32(g_pacelet.countdown_value, 1, 3);
  int band_y = 38;
  int band_h = 120;
  int variant = gcolor_equal(color_on_accent(), GColorWhite) ? 1 : 0;
  GBitmap *number_icon =
      s_countdown_icons[visible_count - 1][variant];

  draw_top_bar(ctx, bounds);

  graphics_context_set_fill_color(ctx, color_accent());
  graphics_fill_rect(ctx, GRect(0, band_y, right, band_h),
                     0, GCornerNone);

  if (number_icon) {
    GRect icon_bounds = gbitmap_get_bounds(number_icon);
    icon_bounds.origin.x = (right - icon_bounds.size.w) / 2;
    icon_bounds.origin.y =
        band_y + (band_h - icon_bounds.size.h) / 2;
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(ctx, number_icon, icon_bounds);
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
  }

  graphics_context_set_text_color(ctx, color_muted());
  graphics_draw_text(
      ctx, pacelet_activity_label(g_pacelet.activity_type), font_label(),
      GRect(8, band_y + band_h + 10, right - 16, 18),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  draw_action_rail(
      ctx, bounds, ActionIconNone, ActionIconNone, ActionIconNone);
}

static void draw_split_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  int band_y = 27;
  int band_h = 96;
  int row_h = 44;
  int movement_y = band_y + band_h + 1;
  int hr_y = movement_y + row_h;
  char title_text[20];
  char split_time_text[16];
  char movement_value[16];
  char movement_unit[8];

  draw_top_bar(ctx, bounds);

  snprintf(title_text, sizeof(title_text), "KM %ld",
           (long)g_pacelet.split_number);
  graphics_context_set_fill_color(ctx, color_accent());
  graphics_fill_rect(ctx, GRect(0, band_y, right, band_h),
                     0, GCornerNone);
  graphics_context_set_text_color(ctx, color_on_accent());
  graphics_draw_text(ctx, title_text, font_value(),
                     GRect(8, band_y + 3, right - 16, 28),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);

  format_elapsed(
      g_pacelet.split_elapsed_s, split_time_text, sizeof(split_time_text));
  graphics_context_set_text_color(ctx, color_on_accent());
  graphics_draw_text(ctx, split_time_text, font_timer(),
                     GRect(0, band_y + band_h - 49, right, 45),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);

  if (pacelet_activity_uses_speed()) {
    format_speed_parts(
        100000 / g_pacelet.split_elapsed_s,
        movement_value, sizeof(movement_value),
        movement_unit, sizeof(movement_unit));
  } else {
    format_pace_parts(
        g_pacelet.split_elapsed_s,
        movement_value, sizeof(movement_value),
        movement_unit, sizeof(movement_unit));
  }
  draw_metric_row(
      ctx, bounds, movement_y, row_h,
      pacelet_activity_uses_speed() ? "AVG" : "PACE",
      movement_value, movement_unit);
  draw_hr_row(
      ctx, bounds, hr_y, row_h, g_pacelet.last_hr_bpm);

  draw_action_rail(
      ctx, bounds, ActionIconPause, ActionIconNone, ActionIconNone);
}

static void draw_activity_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  int duration_y = 27;
  int duration_h = 58;
  int row_h = 39;
  int distance_y = duration_y + duration_h + 1;
  int movement_y = distance_y + row_h;
  int hr_y = movement_y + row_h;
  char elapsed_text[16];
  char distance_value[16];
  char distance_unit[8];
  char movement_value[16];
  char movement_unit[8];
  char gps_text[32];
  bool paused = g_pacelet.activity_state == ActivityStatePaused;

  draw_top_bar(ctx, bounds);

  format_elapsed(
      pacelet_elapsed_s(), elapsed_text, sizeof(elapsed_text));
  draw_duration_band(
      ctx, bounds, duration_y, duration_h, elapsed_text, paused);

  format_distance_parts(
      g_pacelet.distance_m,
      distance_value, sizeof(distance_value),
      distance_unit, sizeof(distance_unit));
  if (pacelet_activity_uses_speed()) {
    format_speed_parts(
        g_pacelet.current_speed_centi_mps,
        movement_value, sizeof(movement_value),
        movement_unit, sizeof(movement_unit));
  } else {
    format_pace_parts(
        g_pacelet.current_pace_s_per_km,
        movement_value, sizeof(movement_value),
        movement_unit, sizeof(movement_unit));
  }

  draw_metric_row(
      ctx, bounds, distance_y, row_h,
      "DIST", distance_value, distance_unit);
  draw_metric_row(
      ctx, bounds, movement_y, row_h,
      pacelet_activity_uses_speed() ? "SPEED" : "PACE",
      movement_value, movement_unit);
  draw_hr_row(
      ctx, bounds, hr_y, row_h, g_pacelet.last_hr_bpm);

  graphics_context_set_text_color(ctx, color_muted());
  if (g_pacelet.gps_state == GpsStateLocked &&
      g_pacelet.gps_accuracy_m >= 0) {
    snprintf(gps_text, sizeof(gps_text), "GPS %ld M",
             (long)g_pacelet.gps_accuracy_m);
  } else if (g_pacelet.gps_state == GpsStateSearching &&
             g_pacelet.gps_accuracy_m >= 0) {
    snprintf(gps_text, sizeof(gps_text), "GPS %ld M / NEED %d M",
             (long)g_pacelet.gps_accuracy_m,
             PACELET_GPS_LOCK_ACCURACY_M);
  } else if (g_pacelet.gps_state == GpsStateError &&
             g_pacelet.gps_error[0] != '\0') {
    snprintf(gps_text, sizeof(gps_text), "%s", g_pacelet.gps_error);
  } else {
    snprintf(gps_text, sizeof(gps_text), "GPS --");
  }

  graphics_draw_text(ctx, gps_text, font_label(),
                     GRect(8, bounds.size.h - 23, right - 8, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);

  if (paused) {
    draw_action_rail(
        ctx, bounds, ActionIconPlay, ActionIconStop, ActionIconNone);
  } else {
    draw_action_rail(
        ctx, bounds, ActionIconPause, ActionIconNone, ActionIconNone);
  }
}

static void draw_finish_confirm_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  int third = right / 3;
  int stop_size = 34;
  int stop_y = 47;
  int title_y = 91;
  int activity_y = 126;
  int elapsed_y = 146;
  char clock_text[8];
  char elapsed_text[16];

  graphics_context_set_fill_color(ctx, color_pause_bg());
  graphics_fill_rect(ctx, GRect(0, 0, right, bounds.size.h),
                     0, GCornerNone);

  format_clock(clock_text, sizeof(clock_text));
  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(
      ctx, pacelet_activity_short_label(g_pacelet.activity_type),
      font_status(), GRect(8, 5, third - 8, 18),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);
  graphics_draw_text(ctx, clock_text, font_status(),
                     GRect(third, 5, third, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);
  graphics_draw_text(ctx, "END?", font_status(),
                     GRect(third * 2, 5, right - third * 2 - 4, 18),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentRight, NULL);

  graphics_context_set_fill_color(ctx, GColorBlack);
  graphics_fill_rect(
      ctx,
      GRect(right / 2 - stop_size / 2, stop_y, stop_size, stop_size),
      2, GCornersAll);

  graphics_context_set_text_color(ctx, GColorBlack);
  graphics_draw_text(ctx, "END ACTIVITY?", font_value(),
                     GRect(5, title_y, right - 10, 30),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);
  graphics_draw_text(
      ctx, pacelet_activity_label(g_pacelet.activity_type),
      font_metric_label(), GRect(5, activity_y, right - 10, 20),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentCenter, NULL);

  format_elapsed(
      pacelet_elapsed_s(), elapsed_text, sizeof(elapsed_text));
  graphics_draw_text(ctx, elapsed_text, font_timer(),
                     GRect(0, elapsed_y, right, 45),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentCenter, NULL);

  draw_action_rail_colors(
      ctx, bounds, ActionIconCheck, ActionIconNone, ActionIconClose,
      GColorBlack, GColorWhite);
}

static void draw_finished_screen(GContext *ctx, GRect bounds) {
  int right = content_right(bounds);
  int band_y = 27;
  int band_h = 84;
  int row_h = 45;
  int time_y = band_y + band_h + 1;
  int distance_y = time_y + row_h;
  int32_t distance_m =
      g_pacelet.summary_distance_m > 0 ?
          g_pacelet.summary_distance_m : g_pacelet.distance_m;
  char elapsed_text[16];
  char distance_value[16];
  char distance_unit[8];
  char points_text[24];

  draw_top_bar(ctx, bounds);

  graphics_context_set_fill_color(ctx, color_accent());
  graphics_fill_rect(ctx, GRect(0, band_y, right, band_h),
                     0, GCornerNone);

  graphics_context_set_stroke_width(ctx, 3);
  graphics_context_set_stroke_color(ctx, color_on_accent());
  graphics_draw_line(ctx, GPoint(22, band_y + band_h / 2),
                     GPoint(34, band_y + band_h / 2 + 12));
  graphics_draw_line(ctx, GPoint(34, band_y + band_h / 2 + 12),
                     GPoint(53, band_y + band_h / 2 - 12));

  graphics_context_set_text_color(ctx, color_on_accent());
  graphics_draw_text(ctx, "SAVED", font_value(),
                     GRect(62, band_y + 11, right - 68, 30),
                     GTextOverflowModeTrailingEllipsis,
                     GTextAlignmentLeft, NULL);
  graphics_draw_text(
      ctx, pacelet_activity_label(g_pacelet.activity_type),
      font_metric_label(),
      GRect(62, band_y + band_h - 29, right - 68, 20),
      GTextOverflowModeTrailingEllipsis, GTextAlignmentLeft, NULL);

  format_elapsed(
      pacelet_elapsed_s(), elapsed_text, sizeof(elapsed_text));
  format_distance_parts(
      distance_m, distance_value, sizeof(distance_value),
      distance_unit, sizeof(distance_unit));
  draw_metric_row(
      ctx, bounds, time_y, row_h, "TIME", elapsed_text, "");
  draw_metric_row(
      ctx, bounds, distance_y, row_h,
      "DIST", distance_value, distance_unit);

  if (g_pacelet.summary_points > 0) {
    snprintf(points_text, sizeof(points_text), "%ld GPS PTS",
             (long)g_pacelet.summary_points);
    graphics_context_set_text_color(ctx, color_muted());
    graphics_draw_text(ctx, points_text, font_label(),
                       GRect(8, bounds.size.h - 23, right - 8, 18),
                       GTextOverflowModeTrailingEllipsis,
                       GTextAlignmentCenter, NULL);
  }

  draw_action_rail(
      ctx, bounds, ActionIconPlay, ActionIconNone, ActionIconType);
}

static void canvas_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);

  graphics_context_set_fill_color(ctx, color_bg());
  graphics_fill_rect(ctx, bounds, 0, GCornerNone);

  switch (g_pacelet.activity_state) {
    case ActivityStateChoose:
      draw_choose_screen(ctx, bounds);
      break;
    case ActivityStateGps:
    case ActivityStateReady:
      draw_gps_screen(ctx, bounds);
      break;
    case ActivityStateCountdown:
      draw_countdown_screen(ctx, bounds);
      break;
    case ActivityStateActive:
      if (g_pacelet.split_visible) {
        draw_split_screen(ctx, bounds);
      } else {
        draw_activity_screen(ctx, bounds);
      }
      break;
    case ActivityStateFinished:
      draw_finished_screen(ctx, bounds);
      break;
    case ActivityStatePaused:
    default:
      if (g_pacelet.finish_confirm_visible) {
        draw_finish_confirm_screen(ctx, bounds);
      } else {
        draw_activity_screen(ctx, bounds);
      }
      break;
  }
}

static void load_activity_icons(void) {
  for (int variant = 0; variant < 2; variant++) {
    s_heart_icons[variant] =
        gbitmap_create_with_resource(HEART_ICON_RESOURCE_IDS[variant]);
    s_measuring_heart_icons[variant] = gbitmap_create_with_resource(
        MEASURING_HEART_ICON_RESOURCE_IDS[variant]);
  }

  for (int type = 0; type < 3; type++) {
    for (int variant = 0; variant < 2; variant++) {
      s_activity_icons[type][variant] = gbitmap_create_with_resource(
          ACTIVITY_ICON_RESOURCE_IDS[type][variant]);
      s_countdown_icons[type][variant] = gbitmap_create_with_resource(
          COUNTDOWN_ICON_RESOURCE_IDS[type][variant]);
    }
  }
}

static void unload_activity_icons(void) {
  for (int variant = 0; variant < 2; variant++) {
    if (s_heart_icons[variant]) {
      gbitmap_destroy(s_heart_icons[variant]);
      s_heart_icons[variant] = NULL;
    }
    if (s_measuring_heart_icons[variant]) {
      gbitmap_destroy(s_measuring_heart_icons[variant]);
      s_measuring_heart_icons[variant] = NULL;
    }
  }

  for (int type = 0; type < 3; type++) {
    for (int variant = 0; variant < 2; variant++) {
      if (s_activity_icons[type][variant]) {
        gbitmap_destroy(s_activity_icons[type][variant]);
        s_activity_icons[type][variant] = NULL;
      }
      if (s_countdown_icons[type][variant]) {
        gbitmap_destroy(s_countdown_icons[type][variant]);
        s_countdown_icons[type][variant] = NULL;
      }
    }
  }
}

void watch_ui_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_window = window;
  watch_ui_apply_theme();
  load_activity_icons();

  s_canvas_layer = layer_create(bounds);
  layer_set_update_proc(s_canvas_layer, canvas_update_proc);
  layer_add_child(window_layer, s_canvas_layer);
}

void watch_ui_unload(void) {
  if (s_canvas_layer) {
    layer_destroy(s_canvas_layer);
    s_canvas_layer = NULL;
  }
  unload_activity_icons();
  s_window = NULL;
}

void watch_ui_apply_theme(void) {
  if (s_window) {
    window_set_background_color(s_window, color_bg());
  }
}

void watch_ui_mark_dirty(void) {
  if (s_canvas_layer) {
    layer_mark_dirty(s_canvas_layer);
  }
}
