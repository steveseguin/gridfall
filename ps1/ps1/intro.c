#include "intro.h"
#include "intro_art.h"

static unsigned age, previous;
static int active;
static const unsigned char glyphs[59][7] = {
    ['A'-32]={14,17,17,31,17,17,17}, ['B'-32]={30,17,17,30,17,17,30},
    ['C'-32]={14,17,16,16,16,17,14}, ['D'-32]={30,17,17,17,17,17,30},
    ['E'-32]={31,16,16,30,16,16,31}, ['F'-32]={31,16,16,30,16,16,16},
    ['G'-32]={14,17,16,23,17,17,15}, ['H'-32]={17,17,17,31,17,17,17},
    ['I'-32]={14,4,4,4,4,4,14}, ['J'-32]={7,2,2,2,18,18,12},
    ['K'-32]={17,18,20,24,20,18,17}, ['L'-32]={16,16,16,16,16,16,31},
    ['M'-32]={17,27,21,21,17,17,17}, ['N'-32]={17,25,25,21,19,19,17},
    ['O'-32]={14,17,17,17,17,17,14}, ['P'-32]={30,17,17,30,16,16,16},
    ['Q'-32]={14,17,17,17,21,18,13}, ['R'-32]={30,17,17,30,20,18,17},
    ['S'-32]={15,16,16,14,1,1,30}, ['T'-32]={31,4,4,4,4,4,4},
    ['U'-32]={17,17,17,17,17,17,14}, ['V'-32]={17,17,17,17,17,10,4},
    ['W'-32]={17,17,17,21,21,21,10}, ['X'-32]={17,17,10,4,10,17,17},
    ['Y'-32]={17,17,10,4,4,4,4}, ['Z'-32]={31,1,2,4,8,16,31},
    ['0'-32]={14,17,19,21,25,17,14}, ['1'-32]={4,12,4,4,4,4,14},
    ['2'-32]={14,17,1,2,4,8,31}, ['3'-32]={30,1,1,14,1,1,30},
    ['4'-32]={2,6,10,18,31,2,2}, ['5'-32]={31,16,16,30,1,1,30},
    ['6'-32]={14,16,16,30,17,17,14}, ['7'-32]={31,1,2,4,8,8,8},
    ['8'-32]={14,17,17,14,17,17,14}, ['9'-32]={14,17,17,15,1,1,14},
    ['.'-32]={0,0,0,0,0,4,4}, ['/'-32]={1,1,2,4,8,16,16},
    ['-'-32]={0,0,0,31,0,0,0}
};
static const char *chapters[4][4] = {
    {"THEY TOLD US THE TRANSIT", "HUBS WERE SAFE.", "BY DAWN, THE MACHINES", "HAD LOCKED THE GATES."},
    {"I WAS FIXING THE GRID", "BELOW THE DEPOT.", "THE SHIELDED ROOM HID", "ME FROM THEIR SCANS."},
    {"THREE DAYS LATER, THEY", "FOUND MY DOOR.", "I ESCAPED THROUGH VENTS", "AND TOOK A PISTOL."},
    {"ONE HUMAN VOICE STILL", "ANSWERS BEYOND THE DEPOT.", "IF I REACH THE POWER", "STATION, I CAN FIND THEM."}
};

void intro_begin(void) { age=previous=0; active=1; }
void intro_end(void) { active=0; }
int intro_state(void) { return active ? (age<45 ? 1 : 2+(age-45)/105) : 0; }
int intro_step(unsigned buttons) {
    if (buttons & ~previous) { active=0; previous=buttons; return 1; }
    previous=buttons;
    if (age<464) age++;
    return 0;
}
static void text(uint16_t *pixels, int y, const char *message, unsigned color, int scale) {
    int length=0;
    while(message[length])length++;
    int left=(160-(length*6-1)*scale)/2;
    for(int n=0;n<length;n++) {
        unsigned c=(unsigned char)message[n];
        if(c<32||c>90)continue;
        for(int row=0;row<7;row++)for(int col=0;col<5;col++)if(glyphs[c-32][row]&(16>>col))
            for(int sy=0;sy<scale;sy++)for(int sx=0;sx<scale;sx++) {
                int x=left+(n*6+col)*scale+sx,yy=y+row*scale+sy;
                if((unsigned)x<160&&(unsigned)yy<120)pixels[yy*160+x]=color;
            }
    }
}
static void intro_draw_small(uint16_t *pixels) {
    int card=intro_state()-2;
    unsigned art=card<0?0:(unsigned)card;
    for(int y=0;y<120;y++)for(int x=0;x<160;x++) {
        unsigned color=0x0842;
        if(y<70) {
            unsigned row=card>=0&&y>=12 ? (y-12)*70/58 : y;
            unsigned p=intro_art[art*160*70+row*160+x];
            unsigned r=(p>>5)*31/7,g=((p>>2)&7)*31/7,b=(p&3)*31/3;
            if(card<0){r/=3;g/=3;b/=3;}
            color=r|(g<<5)|(b<<10);
        }
        if(y>=70)color=0x0842;
        pixels[y*160+x]=color;
    }
    if(card<0) {
        text(pixels,25,"GRIDFALL",0x3aff,2);
        text(pixels,75,"FIRST TO GO WERE",0x6f7b,1);
        text(pixels,86,"THE LIGHTS...",0x6f7b,1);
    } else {
        const char *headings[]={"01 / THE TAKEOVER","02 / THE SURVIVOR","03 / THE ESCAPE","04 / THE SIGNAL"};
        for(int y=0;y<12;y++)for(int x=0;x<160;x++)pixels[y*160+x]=0x0842;
        text(pixels,3,headings[card],0x3aff,1);
        for(int line=0;line<4;line++)text(pixels,72+line*9,chapters[card][line],0x6f7b,1);
    }
    text(pixels,112,"PRESS ANY BUTTON",0x3aff,1);
}

void intro_draw(uint16_t *pixels) {
    intro_draw_small(pixels);
    /* Expand backwards in the framebuffer, leaving no story-only RAM allocated. */
    for(int y=119;y>=0;y--)for(int x=159;x>=0;x--) {
        uint16_t p=pixels[y*160+x];
        pixels[y*640+x*2]=pixels[y*640+x*2+1]=p;
        pixels[y*640+320+x*2]=pixels[y*640+320+x*2+1]=p;
    }
}
