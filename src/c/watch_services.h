#pragma once

#include "pacelet.h"

void watch_services_load_settings(void);
void watch_services_init(void);
void watch_services_deinit(void);

void watch_services_request_settings(void);
void watch_services_send_command(uint32_t command_key);
bool watch_services_send_hr_bpm(int32_t bpm);

