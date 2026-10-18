#ifndef DOOM_BROWSER_BURGER_H
#define DOOM_BROWSER_BURGER_H
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
typedef unsigned int Word;
typedef uint8_t Byte;
typedef uint32_t LongWord;
typedef uint16_t Short;
typedef int32_t Fixed;
typedef int32_t Frac;
typedef unsigned char Boolean;
#define TRUE 1
#define FALSE 0
#define TICKSPERSEC 60
#define PadDown 0x80000000u
#define PadUp 0x40000000u
#define PadRight 0x20000000u
#define PadLeft 0x10000000u
#define PadA 0x08000000u
#define PadB 0x04000000u
#define PadC 0x02000000u
#define PadD 0u
#define PadStart 0x01000000u
#define PadX 0x00800000u
#define PadRightShift 0x00400000u
#define PadLeftShift 0x00200000u
#define PadXLeft 0x00100000u
#define PadXRight 0x00080000u
#define BLACK 0
#define DARKGREY 0x39ce
#define BROWN 0x4102
#define PURPLE 0x3898
#define BLUE 0x001e
#define DARKGREEN 0x0200
#define ORANGE 0x79c0
#define RED 0x6800
#define BEIGE 0x7a92
#define YELLOW 0x7bc0
#define GREEN 0x0380
#define LIGHTBLUE 0x235e
#define LILAC 0x6a9e
#define PERIWINKLE 0x3a1e
#define LIGHTGREY 0x6318
#define WHITE 0x7fff
extern Word ScreenWidth, ScreenHeight;
void *AllocAPointer(LongWord size);
void DeallocAPointer(void *ptr);
void **AllocAHandle(LongWord size);
void DeallocAHandle(void **handle);
void *LockAHandle(void **handle);
void UnlockAHandle(void **handle);
LongWord GetAHandleSize(void **handle);
void SetHandlePurgeFlag(void **handle, Word flag);
void PurgeHandles(Word priority);
void CompactHandles(void);
void SetAPixel(Word x, Word y, Word color);
void LongWordToAscii(LongWord value, Byte *text);
extern Word LeftVolume, RightVolume;
void PlaySound(Word id);
void StopSound(Word id);
void PlaySong(Word id);
void PauseMusic(void);
void ResumeMusic(void);
void *LoadAResource(Word id);
void **LoadAResourceHandle(Word id);
void ReleaseAResource(Word id);
void KillAResource(Word id);
void *GetShapeIndexPtr(void *group, Word index);
Word GetShapeWidth(void *shape);
Word GetShapeHeight(void *shape);
void DrawShape(Word x, Word y, void *shape);
void DrawMShape(Word x, Word y, void *shape);
void DrawRezShape(Word x, Word y, Word id);
void DrawARect(Word x, Word y, Word w, Word h, Word color);
void Randomize(void);
Word GetRandom(Word max);
LongWord ReadTick(void);
Word ReadJoyButtons(Word pad);
void Halt(void);
#endif
