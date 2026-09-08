#pragma once

#include "pacelet.h"

void activity_controller_deinit(void);

void activity_controller_handle_select(void);
void activity_controller_handle_up(void);
void activity_controller_handle_down(void);
void activity_controller_handle_tick(void);
void activity_controller_handle_health_event(HealthEventType event);
void activity_controller_handle_distance(int32_t distance_m);
void activity_controller_handle_phone_activity_state(
    PhoneActivityState phone_state);
void activity_controller_handle_phone_connection(bool connected);
