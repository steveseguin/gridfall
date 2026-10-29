#pragma once
#include <stdint.h>
void intro_begin(void);
void intro_end(void);
int intro_state(void);
int intro_step(unsigned buttons);
void intro_draw(uint16_t *pixels);
