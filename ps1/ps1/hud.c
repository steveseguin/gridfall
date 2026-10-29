#include "doom.h"
#include "host.h"
#include "hud.h"

#define RGB(r,g,b) ((r)|((g)<<5)|((b)<<10))
static const unsigned char font[59][7]={
 ['A'-32]={14,17,17,31,17,17,17},['B'-32]={30,17,17,30,17,17,30},
 ['C'-32]={14,17,16,16,16,17,14},['D'-32]={30,17,17,17,17,17,30},
 ['E'-32]={31,16,16,30,16,16,31},['F'-32]={31,16,16,30,16,16,16},
 ['G'-32]={14,17,16,23,17,17,15},['H'-32]={17,17,17,31,17,17,17},
 ['I'-32]={14,4,4,4,4,4,14},['J'-32]={7,2,2,2,18,18,12},
 ['K'-32]={17,18,20,24,20,18,17},['L'-32]={16,16,16,16,16,16,31},
 ['M'-32]={17,27,21,21,17,17,17},['N'-32]={17,25,25,21,19,19,17},
 ['O'-32]={14,17,17,17,17,17,14},['P'-32]={30,17,17,30,16,16,16},
 ['Q'-32]={14,17,17,17,21,18,13},['R'-32]={30,17,17,30,20,18,17},
 ['S'-32]={15,16,16,14,1,1,30},['T'-32]={31,4,4,4,4,4,4},
 ['U'-32]={17,17,17,17,17,17,14},['V'-32]={17,17,17,17,17,10,4},
 ['W'-32]={17,17,17,21,21,21,10},['X'-32]={17,17,10,4,10,17,17},
 ['Y'-32]={17,17,10,4,4,4,4},['Z'-32]={31,1,2,4,8,16,31},
 ['0'-32]={14,17,19,21,25,17,14},['1'-32]={4,12,4,4,4,4,14},
 ['2'-32]={14,17,1,2,4,8,31},['3'-32]={30,1,1,14,1,1,30},
 ['4'-32]={2,6,10,18,31,2,2},['5'-32]={31,16,16,30,1,1,30},
 ['6'-32]={14,16,16,30,17,17,14},['7'-32]={31,1,2,4,8,8,8},
 ['8'-32]={14,17,17,14,17,17,14},['9'-32]={14,17,17,15,1,1,14},
 ['/'-32]={1,1,2,4,8,16,16},['-'-32]={0,0,0,31,0,0,0}
};
static void rect(uint16_t *p,int x,int y,int w,int h,unsigned c) {
    for(int yy=y;yy<y+h;yy++)for(int xx=x;xx<x+w;xx++)p[yy*320+xx]=c;
}
static void text(uint16_t *p,int x,int y,const char *s,unsigned c,int scale) {
    for(;*s;s++,x+=6*scale) {
        unsigned v=(unsigned char)*s;if(v<32||v>90)continue;
        for(int yy=0;yy<7;yy++)for(int xx=0;xx<5;xx++)
            if(font[v-32][yy]&(16>>xx))rect(p,x+xx*scale,y+yy*scale,scale,scale,c);
    }
}
static void number(uint16_t *p,int x,int y,int value,unsigned color,int scale) {
    char s[4];int n=0;
    if(value<0) {text(p,x,y,"--",color,scale);return;}
    if(value>999)value=999;
    if(value>=100)s[n++]='0'+value/100;
    if(value>=10)s[n++]='0'+value/10%10;
    s[n++]='0'+value%10;s[n]=0;
    text(p,x+1,y+1,s,RGB(0,1,2),scale);text(p,x,y,s,color,scale);
}
void hud_draw(uint16_t *p) {
    int *s=doom_state();
    unsigned amber=RGB(30,22,10),cyan=RGB(12,26,28),white=RGB(27,29,28);
    unsigned health=s[1]<30?RGB(31,7,5):white;
    for(int y=200;y<240;y++)rect(p,0,y,320,1,y&1?RGB(4,6,7):RGB(5,7,8));
    rect(p,0,200,320,1,amber);rect(p,0,202,320,1,RGB(0,2,3));
    for(int x=78;x<=234;x+=78){rect(p,x,204,1,33,RGB(1,2,3));rect(p,x+1,204,1,33,RGB(9,12,12));}
    text(p,10,205,"HEALTH",RGB(17,20,20),1);number(p,10,215,s[1],health,2);
    text(p,88,205,"AMMO",RGB(17,20,20),1);number(p,88,215,s[4],amber,2);
    text(p,166,205,"ARMOR",RGB(17,20,20),1);number(p,166,215,s[2],cyan,2);
    for(int i=0;i<10;i++) {
        rect(p,10+i*6,234,4,2,s[1]>i*10?health:RGB(7,9,9));
        rect(p,166+i*6,234,4,2,s[2]>i*10?cyan:RGB(7,9,9));
    }
    static const char *weapons[]={"FISTS","SIDEARM","SHOTGUN","AUTOGUN","ROCKETS","PLASMA","BFG","SAW"};
    text(p,88,232,weapons[s[3]<8?s[3]:0],RGB(16,18,17),1);
    text(p,246,205,"MACHINES",RGB(17,20,20),1);
    number(p,246,217,s[5],amber,1);text(p,260,217,"/",RGB(15,18,18),1);number(p,270,217,s[6],white,1);
    unsigned keycolors[3]={RGB(8,18,31),RGB(31,25,6),RGB(31,7,4)};
    for(int i=0;i<3;i++) {
        rect(p,246+i*17,230,12,7,RGB(1,2,3));
        rect(p,248+i*17,232,8,3,(players.cards[i]||players.cards[i+3])?keycolors[i]:RGB(7,9,10));
    }
    if(!gamepaused && !(players.AutomapFlags&AF_ACTIVE) && s[1]>0) {
        rect(p,155,99,3,3,RGB(1,2,2));rect(p,163,99,3,3,RGB(1,2,2));
        rect(p,159,95,3,3,RGB(1,2,2));rect(p,159,103,3,3,RGB(1,2,2));
        p[100*320+156]=p[100*320+164]=p[96*320+160]=p[104*320+160]=RGB(24,26,25);
    }
    if(players.damagecount) {
        unsigned red=RGB(25,3,2);
        rect(p,0,0,320,2,red);rect(p,0,198,320,2,red);
        rect(p,0,2,2,196,red);rect(p,318,2,2,196,red);
    }
    if(gamepaused||s[36]||s[1]<=0) {
        const char *title=gamepaused?"PAUSED":s[36]?"DEPOT CLEARED":"SIGNAL LOST";
        int length=0;while(title[length])length++;
        rect(p,55,78,210,42,RGB(1,3,4));rect(p,55,78,210,1,amber);
        text(p,(320-length*12)/2,87,title,amber,2);
        const char *help=gamepaused?"PRESS START OR P":s[36]?"RESTART TO PLAY AGAIN":"FIRE TO RESPAWN";
        length=0;while(help[length])length++;
        text(p,(320-length*6)/2,108,help,white,1);
    }
}
