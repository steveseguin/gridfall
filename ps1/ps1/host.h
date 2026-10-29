#pragma once
#include <stdint.h>
void ps1_fatal(const char *message,int value);
void ps1_read(unsigned offset,void *buffer,unsigned size);
unsigned ps1_ticks(void);
void ps1_sound(unsigned id);
void ps1_stop_sound(unsigned id);
int doom_init(uint8_t *data,unsigned size);
void doom_start(int map,int skill);
int doom_step(unsigned buttons);
uint16_t *doom_render(int smooth);
uint16_t *doom_render_lerp(unsigned fraction);
int *doom_state(void);
void doom_weapon(int weapon);
int doom_intro(void);
