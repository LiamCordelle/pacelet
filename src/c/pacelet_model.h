#pragma once

#include "pacelet.h"

void pacelet_model_init(void);
void pacelet_model_reset_activity(bool preserve_hr);

int32_t pacelet_clamp_i32(int32_t value, int32_t min_value,
                          int32_t max_value);
int32_t pacelet_elapsed_s(void);
bool pacelet_activity_uses_speed(void);

void pacelet_normalize_hr_zone_thresholds(void);
HrZone pacelet_hr_zone_for_bpm(int32_t bpm);
const char *pacelet_hr_zone_label(HrZone zone);

const char *pacelet_activity_label(ActivityType type);
const char *pacelet_activity_short_label(ActivityType type);

