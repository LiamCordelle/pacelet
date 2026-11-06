#pragma once
#include <pebble.h>
typedef struct { int unused; } LabData;
typedef struct {
 const char *name; void (*load)(void); void (*unload)(void);
 void (*draw)(GContext *, GRect, const LabData *);
} LabDesign;
void lab_data_refresh(LabData *d);
void lab_release_shared(void);
