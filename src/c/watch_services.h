#pragma once

#include "pacelet.h"

void watch_services_load_settings(void);
void watch_services_load_activity_state(void);
void watch_services_save_activity_state(void);
void watch_services_clear_activity_state(void);
void watch_services_init(void);
void watch_services_deinit(void);

void watch_services_request_settings(void);
void watch_services_request_initial_state(void);
void watch_services_request_activity_state(void);
void watch_services_request_history(void);
void watch_services_send_command(uint32_t command_key);
void watch_services_send_history_action(uint32_t command_key,
                                        int32_t history_index);
bool watch_services_send_hr_bpm(int32_t bpm);
bool watch_services_send_hr_batch(void);
