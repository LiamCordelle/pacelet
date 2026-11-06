#include "lab.h"
#include "lab_designs.h"
#define EXTERN(n) extern const LabDesign n;
LAB_DESIGNS(EXTERN)
static Window *window;
static void draw(Layer *l, GContext *c) { pulse_live.draw(c, layer_get_bounds(l), NULL); }
int main(void) {
 window = window_create();
 Layer *l = layer_create(GRect(0,0,200,228));
 layer_set_update_proc(l, draw); layer_add_child(window_get_root_layer(window), l);
 window_stack_push(window, false); app_event_loop();
 layer_destroy(l); window_destroy(window);
}
