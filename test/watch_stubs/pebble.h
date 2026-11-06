#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <time.h>
#include "message_keys.h"
#define PBL_HEALTH 1
#define ARRAY_LENGTH(a) (sizeof(a) / sizeof((a)[0]))
#define APP_LOG(...)
#define APP_LOG_LEVEL_INFO 1
#define APP_LOG_LEVEL_WARNING 2
typedef struct { int unused; } Window;
typedef struct AppTimer { void (*callback)(void *); void *data; } AppTimer;
typedef int HealthServiceAccessibilityMask;
typedef int32_t HealthValue;
typedef enum { HealthEventHeartRateUpdate, HealthEventMovementUpdate, HealthEventSignificantUpdate } HealthEventType;
enum { HealthMetricStepCount, HealthMetricHeartRateRawBPM, HealthAggregationAvg, HealthServiceTimeScopeOnce };
enum { HealthServiceAccessibilityMaskAvailable = 1, HealthServiceAccessibilityMaskNoPermission = 2, HealthServiceAccessibilityMaskNotSupported = 4 };
typedef struct { const uint32_t *durations; size_t num_segments; } VibePattern;
typedef struct { uint8_t charge_percent; bool is_charging; } BatteryChargeState;
BatteryChargeState battery_state_service_peek(void);
time_t test_time(time_t *out);
uint16_t time_ms(time_t *seconds, uint16_t *milliseconds);
#define time test_time
AppTimer *app_timer_register(uint32_t delay, void (*callback)(void *), void *data);
void app_timer_cancel(AppTimer *timer);
HealthServiceAccessibilityMask health_service_metric_accessible(int metric, time_t start, time_t end);
HealthServiceAccessibilityMask health_service_metric_aggregate_averaged_accessible(int metric, time_t start, time_t end, int aggregation, int scope);
HealthValue health_service_sum_today(int metric);
HealthValue health_service_peek_current_value(int metric);
bool health_service_set_heart_rate_sample_period(int period);
void vibes_short_pulse(void);
void vibes_long_pulse(void);
void vibes_double_pulse(void);
void vibes_enqueue_custom_pattern(VibePattern pattern);
void light_enable_interaction(void);
void window_stack_pop_all(bool animated);

typedef int AppMessageResult;
enum { APP_MSG_OK=0, APP_MSG_BUSY=1 };
typedef union { int32_t int32; char cstring[160]; uint8_t data[160]; } TestTupleValue;
typedef struct { uint32_t key; uint16_t length; TestTupleValue *value; } Tuple;
typedef struct DictionaryIterator { Tuple tuples[40]; TestTupleValue values[40]; int count; } DictionaryIterator;
Tuple *dict_find(DictionaryIterator *iter,uint32_t key);
void dict_write_uint8(DictionaryIterator *iter,uint32_t key,uint8_t value);
void dict_write_int32(DictionaryIterator *iter,uint32_t key,int32_t value);
void dict_write_cstring(DictionaryIterator *iter,uint32_t key,const char *value);
void dict_write_data(DictionaryIterator *iter,uint32_t key,const uint8_t *value,uint16_t length);
AppMessageResult app_message_outbox_begin(DictionaryIterator **iter);
AppMessageResult app_message_outbox_send(void);
void app_message_register_inbox_received(void (*callback)(DictionaryIterator *,void *));
void app_message_register_inbox_dropped(void (*callback)(AppMessageResult,void *));
void app_message_register_outbox_sent(void (*callback)(DictionaryIterator *,void *));
void app_message_register_outbox_failed(void (*callback)(DictionaryIterator *,AppMessageResult,void *));
void app_message_deregister_callbacks(void);
void app_message_open(int inbox,int outbox);
int persist_delete(int key);
int persist_get_size(int key);
int persist_write_data(int key,const void *data,size_t size);
int persist_read_data(int key,void *data,size_t size);
typedef struct { void (*pebble_app_connection_handler)(bool); } ConnectionHandlers;
void connection_service_subscribe(ConnectionHandlers handlers);
void connection_service_unsubscribe(void);
bool connection_service_peek_pebble_app_connection(void);
