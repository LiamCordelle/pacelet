#include <pebble.h>

#include "activity_controller.h"
#include "pacelet.h"
#include "pacelet_model.h"
#include "watch_services.h"
#include "watch_ui.h"

static Window *s_main_window;

static void select_click_handler(ClickRecognizerRef recognizer,
                                 void *context) {
  activity_controller_handle_select();
}

static void up_click_handler(ClickRecognizerRef recognizer, void *context) {
  activity_controller_handle_up();
}

static void down_click_handler(ClickRecognizerRef recognizer,
                               void *context) {
  activity_controller_handle_down();
}

static void click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, select_click_handler);
  window_single_click_subscribe(BUTTON_ID_UP, up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, down_click_handler);
}

static void main_window_load(Window *window) {
  watch_ui_load(window);
}

static void main_window_unload(Window *window) {
  watch_ui_unload();
}

static void tick_handler(struct tm *tick_time, TimeUnits units_changed) {
  activity_controller_handle_tick();
}

static void health_event_handler(HealthEventType event, void *context) {
  activity_controller_handle_health_event(event);
}

static void init(void) {
  pacelet_model_init();
  watch_services_load_settings();

  s_main_window = window_create();
  window_set_click_config_provider(s_main_window, click_config_provider);
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = main_window_load,
    .unload = main_window_unload
  });

  watch_services_init();
  tick_timer_service_subscribe(SECOND_UNIT, tick_handler);
#if defined(PBL_HEALTH)
  health_service_events_subscribe(health_event_handler, NULL);
#endif

  window_stack_push(s_main_window, true);
  watch_services_request_settings();
}

static void deinit(void) {
  activity_controller_deinit();
  tick_timer_service_unsubscribe();
#if defined(PBL_HEALTH)
  health_service_events_unsubscribe();
#endif
  watch_services_deinit();
  window_destroy(s_main_window);
}

int main(void) {
  init();
  app_event_loop();
  deinit();
}
