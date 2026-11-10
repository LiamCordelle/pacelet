#pragma once

#include "pacelet.h"

void watch_ui_load(Window *window);
void watch_ui_unload(void);
void watch_ui_apply_theme(void);
void watch_ui_mark_dirty(void);
void watch_ui_show_button_guide(void);
void watch_ui_hide_button_guide(void);
void watch_ui_set_focus(bool focused);
