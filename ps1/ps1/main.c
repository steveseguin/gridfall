#include "burger.h"
extern Word PadAttack, PadUse, PadSpeed;
#define NUMWEAPONS 8
#include "host.h"
#include <stdio.h>
#include <psxgpu.h>
#include <psxapi.h>
#include <psxpad.h>
#include <psxcd.h>
#include <psxspu.h>
static DISPENV display[2];
static DRAWENV drawing[2];
static uint8_t pad1[34],pad2[34];
static uint32_t directory_buffer[4096];
static int disc_sector,frame;
volatile unsigned ps1_frame_counter;
void ps1_fatal(const char *message,int value) {
    printf("FATAL %s %d\n",message,value);
    for(;;) {FntPrint(-1,"FATAL: %s %d\n",message,value);FntFlush(-1);VSync(0);}
}
unsigned ps1_ticks(void){return VSync(-1);}
static unsigned sound_addr[128],sound_pitch[128],voice_sound[16],next_voice;
static void load_sound(void) {
    CdlFILE file;CdlLOC pos;
    if(!CdSearchFile(&file,"\\SOUND.BNK;1"))ps1_fatal("SOUND FILE",0);
    unsigned size=(file.size+2047)&~2047;
    uint32_t *bank=malloc(size);
    if(!bank)ps1_fatal("SOUND RAM",size);
    pos=file.pos;
    if(!CdControl(CdlSetloc,(uint8_t *)&pos,0)||!CdRead(size/2048,bank,CdlModeSpeed)||CdReadSync(0,0)<0)ps1_fatal("SOUND READ",0);
    for(unsigned i=0;i<bank[0];i++) {
        uint32_t *entry=bank+1+i*4;
        if(entry[0]>=128 || entry[1]+entry[2]>size-4096)ps1_fatal("SOUND HEADER",i);
        sound_addr[entry[0]]=0x1010+entry[1];sound_pitch[entry[0]]=entry[3];
    }
    SpuInit();SpuSetCommonMasterVolume(0x3fff,0x3fff);
    SpuSetTransferStartAddr(0x1010);SpuWrite(bank+1024,size-4096);SpuIsTransferCompleted(1);free(bank);
}
void ps1_stop_sound(unsigned id){for(int i=0;i<16;i++)if(voice_sound[i]==id)SpuSetKey(0,1<<i);}
void ps1_sound(unsigned id){
    if(id>=128 || !sound_addr[id])return;
    unsigned voice=next_voice++%16;
    SpuSetKey(0,1<<voice);voice_sound[voice]=id;
    SpuSetVoiceVolume(voice,0x2800,0x2800);SpuSetVoicePitch(voice,sound_pitch[id]);
    SpuSetVoiceStartAddr(voice,sound_addr[id]);SPU_CH_ADSR1(voice)=0x00ff;SPU_CH_ADSR2(voice)=0x0000;SpuSetKey(1,1<<voice);
}
void ps1_read(unsigned offset,void *buffer,unsigned size) {
    CdlLOC pos;
    if(offset&2047)ps1_fatal("UNALIGNED CD",offset);
    CdIntToPos(disc_sector+offset/2048,&pos);
    if(!CdControl(CdlSetloc,(uint8_t *)&pos,0) || !CdRead((size+2047)/2048,buffer,CdlModeSpeed) || CdReadSync(0,0)<0)
        ps1_fatal("CD READ",offset);
}
int main(void) {
    CdlFILE file;
    unsigned last,previous=0,pause_pending=0;
    ResetGraph(0);SetVideoMode(MODE_NTSC);
    for(int i=0;i<2;i++) {
        SetDefDispEnv(&display[i],0,i*256,320,240);
        SetDefDrawEnv(&drawing[i],0,i*256,320,240);
        drawing[i].isbg=1;setRGB0(&drawing[i],12,16,20);
    }
    PutDispEnv(&display[0]);PutDrawEnv(&drawing[0]);SetDispMask(1);
    FntLoad(960,256);FntOpen(8,204,304,32,0,128);
    FntPrint(-1,"GRIDFALL / PS1\nLOADING...\n");FntFlush(-1);
    InitPAD(pad1,sizeof(pad1),pad2,sizeof(pad2));StartPAD();ChangeClearPAD(0);
    if(!CdInit() || !CdSearchFile(&file,"\\GRIDFALL.DAT;1"))ps1_fatal("DATA FILE",0);
    disc_sector=CdPosToInt(&file.pos);
    ps1_read(0,directory_buffer,sizeof(directory_buffer));
    load_sound();
    printf("GRIDFALL initializing\n");
    if(!doom_init((uint8_t *)directory_buffer,sizeof(directory_buffer)))ps1_fatal("DATA HEADER",0);
    printf("GRIDFALL ready\n");last=ps1_ticks();
    for(;;) {
        PADTYPE *pad=(PADTYPE *)pad1;
        unsigned held=pad->stat==0 ? (uint16_t)~pad->btn : 0;
        unsigned pressed=held&~previous,buttons=0;previous=held;
        int intro=doom_intro();
        if(held&PAD_UP)buttons|=PadUp;if(held&PAD_DOWN)buttons|=PadDown;
        if(held&PAD_LEFT)buttons|=PadLeft;if(held&PAD_RIGHT)buttons|=PadRight;
        if(held&PAD_CROSS)buttons|=PadAttack;if(held&PAD_CIRCLE)buttons|=PadUse;
        if(held&PAD_SQUARE)buttons|=PadSpeed;
        if(held&PAD_L1)buttons|=PadLeftShift;if(held&PAD_R1)buttons|=PadRightShift;
        if(intro) { buttons=held; pause_pending=0; }
        else {
            if(pressed&PAD_START)pause_pending=1;
            if(pressed&PAD_SELECT){doom_start(1,2);pause_pending=0;}
            if(pressed&PAD_TRIANGLE){int *s=doom_state();for(int i=1;i<=NUMWEAPONS;i++){int w=(s[3]+i)%NUMWEAPONS;if(s[16]&(1<<w)){doom_weapon(w);break;}}}
        }
        unsigned now=ps1_ticks();
        if(now-last>16)last=now-16;
        while(now-last>=4){doom_step(buttons|(pause_pending?PadStart:0));pause_pending=0;last+=4;}
        uint16_t *pixels=doom_render_lerp(65536);
        PutDrawEnv(&drawing[frame]);
        RECT area={0,frame*256,320,240};
        DrawSync(0);LoadImage(&area,(uint32_t *)pixels);DrawSync(0);
        doom_state();
        DrawSync(0);VSync(0);PutDispEnv(&display[frame]);frame^=1;ps1_frame_counter++;
    }
}
