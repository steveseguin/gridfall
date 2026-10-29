/* PS1 platform for the GRIDFALL / 3DO C engine. */
#include "doom.h"
#include "intmath.h"
#include <stdio.h>
#include "host.h"
#include "intro.h"
#include <limits.h>
#include "asset_palette.h"
#include "hud.h"

/* unistd.h's close() conflicts with the original door-state enum. */


typedef struct { void *data; Word size; } Handle;
typedef struct { Word id, offset, size; } Resource;
typedef struct { Short width, height; Byte pixels[]; } Image;
static Byte *bundle;
static Word bundle_size;
static Word resource_count;
static Resource *directory;
static Handle *resources[1100];
static uint16_t framebuffer[BROWSER_WIDTH * BROWSER_HEIGHT];
static uint16_t palette[256];
static uint16_t shade[4][32][256], shade_palette[256];
static Word lightstyle;
static int lightbias;
static int state[43];
static int renderplayers[27], useRenderPlayers;
static int previous_render[27], render_valid;
int *doom_render_players(void);
/* Level-entry checkpoint: version, map, skill, health, armor, armor type,
   weapon, owned weapons, four ammo counts and four capacities. */
static int checkpoint[16];
static int initialized, level_loaded, running;
static unsigned intro_release;
static int endphase, exitmap;
static Word endticks, levelticks;
player_t BrowserPlayers[4], *BrowserCurrentPlayer = BrowserPlayers;
int BrowserPlayerCount = 1, BrowserLocalPlayer, BrowserDeathmatch;
int BrowserFrags[4];
Word BrowserLevelCounts[3];
mapthing_t BrowserStarts[4];
static Word netbuttons[4], previousbuttons[4], spawnserial[4];
static Word playerTicks[4];
static uint32_t spawnrandom = 1;
static int netweapons[4], showmap;
static int commandMode, netcommands[36];
static unsigned playerMask = 1;
Word LeftVolume = 255, RightVolume = 255;
Word SfxVolume = 15, MusicVolume;
LongWord LastTics = 4;
stbar_t stbar;
extern Word tx_x;
extern int tx_scale;

static void browser_error(int id) { ps1_fatal("RESOURCE", id); }
static void browser_stop_sound(int id) { ps1_stop_sound(id); }

void *AllocAPointer(LongWord size)
{
	void *ptr = calloc(1, size ? size : 1);
	if (!ptr) ps1_fatal("OUT OF RAM", size);
	return ptr;
}
void DeallocAPointer(void *ptr) { free(ptr); }
void **AllocAHandle(LongWord size)
{
	Handle *handle = AllocAPointer(sizeof(*handle));
	handle->data = AllocAPointer(size);
	handle->size = size;
	return (void **)handle;
}
void DeallocAHandle(void **handle)
{
	if (handle) { free(*handle); free(handle); }
}
void *LockAHandle(void **handle) { return *handle; }
void UnlockAHandle(void **handle) { (void)handle; }
LongWord GetAHandleSize(void **handle) { return ((Handle *)handle)->size; }
void SetHandlePurgeFlag(void **handle, Word flag) { (void)handle; (void)flag; }
void PurgeHandles(Word priority) { (void)priority; }
void CompactHandles(void) {}

static Resource *FindResource(Word id)
{
	Word low = 0, high = resource_count;
	while (low < high) {
		Word mid = low + (high - low) / 2;
		if (directory[mid].id < id) low = mid + 1;
		else high = mid;
	}
	return low < resource_count && directory[low].id == id ? directory + low : 0;
}
void **LoadAResourceHandle(Word id)
{
	Resource *entry;
	if (id >= 1100) { browser_error(id); return 0; }
	if (resources[id]) return (void **)resources[id];
	entry = FindResource(id);
	if (!entry) { browser_error(id); return 0; }
	resources[id] = (Handle *)AllocAHandle((entry->size + 2047) & ~2047);
	ps1_read(entry->offset, resources[id]->data, entry->size);
	return (void **)resources[id];
}
void *LoadAResource(Word id) { return *LoadAResourceHandle(id); }
void ReleaseAResource(Word id) { (void)id; }
void KillAResource(Word id)
{
	if (id < 1100) { DeallocAHandle((void **)resources[id]); resources[id] = 0; }
}
void *GetShapeIndexPtr(void *group, Word index) { return (Byte *)group + ((Word *)group)[index]; }
Word GetShapeWidth(void *shape) { return ((Image *)shape)->width; }
Word GetShapeHeight(void *shape) { return ((Image *)shape)->height; }

Fixed IMFixMul(Fixed a, Fixed b)
{
	int64_t product = (int64_t)a * b;
	int negative = product < 0;
	uint64_t magnitude = negative ? -product : product;
	/* The ARM routine rounds magnitude to nearest, then restores the sign. */
	magnitude = (magnitude + 32768) >> 16;
	if (magnitude > INT32_MAX) return negative ? INT32_MIN : INT32_MAX;
	return negative ? -(Fixed)magnitude : (Fixed)magnitude;
}
Fixed IMFixDiv(Fixed a, Fixed b)
{
	int negative = (a < 0) != (b < 0);
	uint32_t numerator = a < 0 ? 0u-(uint32_t)a : (uint32_t)a;
	uint32_t denominator = b < 0 ? 0u-(uint32_t)b : (uint32_t)b;
	uint32_t quotient, remainder;
	if (!denominator) return negative ? INT32_MIN : INT32_MAX;
	quotient=numerator/denominator;remainder=numerator%denominator;
	if(quotient>=32768)return negative?INT32_MIN:INT32_MAX;
	/* The MIPS integer divider handles the whole part. Only sixteen fractional
	   bits remain; unsigned doubling is safe because |b| is at most 2^31. */
	for(int bit=0;bit<16;bit++) {
		remainder<<=1;quotient<<=1;
		if(remainder>=denominator){remainder-=denominator;quotient++;}
	}
	if(remainder >= (denominator>>1)+(denominator&1))quotient++;
	if (quotient > INT32_MAX) return negative ? INT32_MIN : INT32_MAX;
	return negative ? -(Fixed)quotient : (Fixed)quotient;
}

static uint16_t Color(Short pixel, int light) {
    int r=(pixel>>10)&31,g=(pixel>>5)&31,b=pixel&31;
    if(light<32)light=32; if(light>255)light=255;
    return (r*light/255) | ((g*light/255)<<5) | ((b*light/255)<<10);
}
static void Pixel(int x,int y,Short color,int light) {
    if((unsigned)x<BROWSER_WIDTH && (unsigned)y<BROWSER_HEIGHT)
        framebuffer[y*BROWSER_WIDTH+x]=Color(color,light);
}
Word BrowserSectorStyle(sector_t *sector) {
    if(sector->CeilingPic==(Word)-1) return 0;
    if(sector->special==4 || sector->special==5 || sector->special==7 || sector->special==16) return 3;
    return sector->floorheight<0 ? 1 : 2;
}
void BrowserSetLight(Word style,int bias) { lightstyle=style&3;lightbias=bias; }
static uint16_t *LightTable(int light,Word style) {
    if(light<16)light=16;if(light>255)light=255;
    return shade[style&3][light>>3];
}
static void UpdateShades(void) {
    static const unsigned gain[4][3]={{256,256,256},{195,230,256},{256,232,200},{256,144,116}};
    if(!memcmp(palette,shade_palette,sizeof(palette)))return;
    memcpy(shade_palette,palette,sizeof(palette));
    for(int s=0;s<4;s++)for(int l=0;l<32;l++)for(int i=0;i<256;i++) {
        unsigned p=palette[i],r=(p>>10)&31,g=(p>>5)&31,b=p&31;
        r=r*l*gain[s][0]/(31*256);g=g*l*gain[s][1]/(31*256);b=b*l*gain[s][2]/(31*256);
        shade[s][l][i]=r|(g<<5)|(b<<10);
    }
}
void BrowserDrawWall(Byte *data, Fixed u, Word texturemid, int topheight, int bottomheight, int scale) {
    Image *im=(Image *)data;
    int y,top,bottom,step,position,x;
    int width=im->width,height=im->height,level=0;
    Byte *pixels=im->pixels;
    uint16_t *colors=LightTable(tx_texturelight+lightbias,lightstyle);
    if(scale<=0)return;
    top=CenterY-(int)(((int64_t)topheight*scale)>>15);
    bottom=CenterY-(int)(((int64_t)bottomheight*scale)>>15);
    if(top<0)top=0;if(bottom>(int)ScreenHeight)bottom=ScreenHeight;
    step=(512<<16)/scale;
    position=(int32_t)texturemid+(top-CenterY)*step;
    /* Select once per column; filtered source art costs no extra pixel reads.
       Stop before an odd dimension so scrolling doors keep their exact period. */
    while(step >= (2<<16) && width>1 && height>1 && !(width&1) && !(height&1)) {
        pixels+=width*height;width>>=1;height>>=1;
        step>>=1;position>>=1;++level;
    }
    x=(u>>(16+level))&(width-1);
    /* Wrap once, then advance with additions instead of a divide per pixel. */
    int period=height<<16;
    position%=period;if(position<0)position+=period;
    step%=period;
    pixels+=x*height;
    uint16_t *dest=framebuffer+top*BROWSER_WIDTH+tx_x;
    for(y=top;y<bottom;y++,dest+=BROWSER_WIDTH) {
        *dest=colors[pixels[position>>16]];
        position+=step;if(position>=period)position-=period;
    }
}
void SetAPixel(Word x, Word y, Word color) { Pixel(x, y, color, 255); }
void DrawARect(Word x, Word y, Word w, Word h, Word color)
{
	int left = (int)x, top = (int)y, right = left + (int)w, bottom = top + (int)h;
	int xx, yy;
	if (left < 0) left = 0;
	if (top < 0) top = 0;
	if (right > BROWSER_WIDTH) right = BROWSER_WIDTH;
	if (bottom > BROWSER_HEIGHT) bottom = BROWSER_HEIGHT;
	for (yy = top; yy < bottom; ++yy) for (xx = left; xx < right; ++xx) Pixel(xx, yy, color, 255);
}
void DrawLine(Word ax, Word ay, Word bx, Word by, Word color)
{
	int x = ax, y = ay, x2 = bx, y2 = by;
	int dx = abs(x2 - x), sx = x < x2 ? 1 : -1;
	int dy = -abs(y2 - y), sy = y < y2 ? 1 : -1;
	int error = dx + dy;
	for (;;) {
		int e2;
		Pixel(x, y, color, 255);
		if (x == x2 && y == y2) break;
		e2 = error * 2;
		if (e2 >= dy) { error += dy; x += sx; }
		if (e2 <= dx) { error += dx; y += sy; }
	}
}
void DrawShape(Word x, Word y, void *shape)
{
	Image *image = shape;
	Word xx, yy;
	for (yy = 0; yy < image->height; ++yy) for (xx = 0; xx < image->width; ++xx) {
		Short color = palette[image->pixels[yy * image->width + xx]];
		if (color) Pixel((int)x + xx, (int)y + yy, color, 255);
	}
}
void DrawMShape(Word x, Word y, void *shape) { DrawShape(x, y, shape); }
void DrawRezShape(Word x, Word y, Word id) { DrawShape(x, y, LoadAResource(id)); }
void DrawWallColumn(Word topword, Word column, Byte *source, Word run)
{
	Image *image = (Image *)source;
	int top = (int)topword + 1;
	int bottom = top + ((int64_t)run * tx_scale + 511) / 512;
	int y, start = top < 0 ? 0 : top;
	uint64_t position;
	Word sample, remainder, advance, fraction, size = image->width * image->height;
	if (tx_scale <= 0) return;
	if (bottom > (int)ScreenHeight) bottom = ScreenHeight;
	/* Exact quotient/remainder stepping retains the original integer sampling. */
	position = (int64_t)(start - top) * 512;
	sample = (column + position / tx_scale) % size;
	remainder = position % tx_scale;
	advance = (512 / tx_scale) % size;
	fraction = 512 % tx_scale;
	for (y = start; y < bottom; ++y) {
		Pixel(tx_x + ScreenXOffset, y + ScreenYOffset, palette[image->pixels[sample]], tx_texturelight);
		sample += advance;
		remainder += fraction;
		if (remainder >= (Word)tx_scale) { remainder -= tx_scale; ++sample; }
		if (sample >= size) sample -= size;
	}
}
void DrawSkyLine(void)
{
	Image *image = (Image *)*SkyTexture->data;
	Word x = ((xtoviewangle[tx_x] + viewangle) >> ANGLETOSKYSHIFT) & 255;
	Word y;
	static Short rows[MAXSCREENHEIGHT];
	static Word cached_height;
	uint16_t *colors=LightTable(255,0);
	if(cached_height!=image->height) {
		for(y=0;y<ScreenHeight;y++) {
			Word sy=y*160/ScreenHeight;
			rows[y]=sy<image->height?sy:image->height-1;
		}
		cached_height=image->height;
	}
	Byte *column=image->pixels+(x%image->width)*image->height;
	uint16_t *dest=framebuffer+tx_x;
	for (y = 0; y < ScreenHeight; ++y) {
		*dest=colors[column[rows[y]]];dest+=BROWSER_WIDTH;
	}
}
void DrawFloorColumn(Word y, Word x, Word count, LongWord xf, LongWord yf, Fixed xs, Fixed ys)
{
	Byte *source = (Byte *)PlaneSource;
	Word i, width=64, level=0;
	Word footprint=abs(xs)>abs(ys)?abs(xs):abs(ys);
	int row=abs((int)y-CenterY);
	uint16_t *colors=LightTable(tx_texturelight,lightstyle);
	uint16_t *dest=framebuffer+(y+ScreenYOffset)*BROWSER_WIDTH+x+ScreenXOffset;
	/* Perspective compresses the vertical footprint near the horizon. */
	if(row>0 && row<PROJECTIONX) {
		/* Beyond the last mip, clamp before multiplying rather than dividing 64 bits. */
		footprint=footprint>UINT_MAX/PROJECTIONX ? (64u<<16) : footprint*PROJECTIONX/row;
	}
	while(footprint >= (2<<16) && width>1) {
		source+=width*width;width>>=1;footprint>>=1;++level;
	}
	for (i = 0; i < count; ++i) {
		Word sample = (((yf >> (16+level)) & (width-1)) << (6-level)) + ((xf >> (16+level)) & (width-1));
		dest[i]=colors[source[sample]];
		xf += xs;
		yf += ys;
	}
}

static void DrawSprite(vissprite_t *vis, int clipped)
{
	patch_t *patch = (patch_t *)((Byte *)LoadAResource(vis->PatchLump) + vis->PatchOffset);
	Image *image = (Image *)&patch->Data;
	int left = vis->x1 < 0 ? 0 : vis->x1;
	int right = vis->x2 >= (int)ScreenWidth ? (int)ScreenWidth - 1 : vis->x2;
	int bottom = vis->y1 + (((int64_t)image->height * vis->yscale + 65535) >> 16);
	int x, y, light = vis->colormap & 255;
	int outfit = vis->thing->player ? vis->thing->player - BrowserPlayers : -1;
	int rows[MAXSCREENHEIGHT], first = vis->y1 < 0 ? 0 : vis->y1;
	uint16_t *colors=LightTable(light,light==255?0:BrowserSectorStyle(vis->thing->subsector->sector));
	if (vis->xscale <= 0 || vis->yscale <= 0) return;
	if (bottom > (int)ScreenHeight) bottom = ScreenHeight;
	/* Each screen row samples the same texture row in every sprite column. */
	for (y = first; y < bottom; ++y) {
		Word delta=y-vis->y1;
		int sy = delta<=65535 ? (delta<<16)/(Word)vis->yscale : ((uint64_t)delta<<16)/vis->yscale;
		rows[y] = sy < image->height ? sy * image->width : -1;
	}
	for (x = left; x <= right; ++x) {
		Word delta=x-vis->x1;
		int sx = delta<=65535 ? (delta<<16)/(Word)vis->xscale : ((uint64_t)delta<<16)/vis->xscale;
		int top = vis->y1 < 0 ? 0 : vis->y1;
		int end = bottom;
		if (sx >= image->width) sx = image->width - 1;
		if (vis->colormap & 0x4000) sx = image->width - 1 - sx;
		if (clipped) {
			int cliptop = spropening[x] >> 8, clipbottom = spropening[x] & 255;
			if (top < cliptop) top = cliptop;
			if (end > clipbottom) end = clipbottom;
		}
		for (y = top; y < end; ++y) {
			Short color;
			Byte index;
			if (rows[y] < 0) continue;
			index=image->pixels[rows[y]+sx];
			if (!index) continue;
			color = palette[index];
			if (outfit >= 0 && outfit < BrowserPlayerCount) {
				int r=(color>>10)&31, g=(color>>5)&31, b=color&31;
				/* Recolor teal fabric only; preserve skin, weapons and neutral armor. */
				if (g > r && b > r && g >= b) {
					static const int colors[4][3]={{12,31,17},{12,21,31},{31,12,9},{31,24,8}};
					int shade = (g*5+2)/4+2;
					if (shade > 31) shade = 31;
					color = 0x8000 | ((shade*colors[outfit][0]/31)<<10) | ((shade*colors[outfit][1]/31)<<5) | (shade*colors[outfit][2]/31);
				}
			}
			if (vis->colormap & 0x8000) {
				uint16_t *pixel = &framebuffer[(y + ScreenYOffset) * BROWSER_WIDTH + x + ScreenXOffset];
				*pixel = (*pixel >> 1) & 0x3def;
			} else if(outfit>=0) Pixel(x + ScreenXOffset, y + ScreenYOffset, color, light);
			else framebuffer[(y+ScreenYOffset)*BROWSER_WIDTH+x+ScreenXOffset]=colors[index];
		}
	}
}
void DrawSpriteNoClip(vissprite_t *vis) { DrawSprite(vis, 0); }
void DrawSpriteClip(Word x1, Word x2, vissprite_t *vis) { (void)x1; (void)x2; DrawSprite(vis, 1); }
void BrowserDrawWeapon(pspdef_t *psp, Word shadow)
{
	Word frame = psp->StatePtr->SpriteFrame;
	patch_t *patch = GetShapeIndexPtr(LoadAResource(frame >> FF_SPRITESHIFT), frame & FF_FRAMEMASK);
	Image *image = (Image *)&patch->Data;
	int weaponwidth = PROJECTIONX * 2;
	int left = ((psp->WeaponX + patch->leftoffset) * weaponwidth) / 320 + ((int)ScreenWidth - weaponwidth) / 2 + ScreenXOffset;
	int top = ((psp->WeaponY - 40 + patch->topoffset) * (int)ScreenHeight) / 160 + ScreenYOffset + 2;
	int width = (image->width * weaponwidth + 319) / 320;
	int height = (image->height * ScreenHeight + 159) / 160;
	int x, y;
	int columns[BROWSER_WIDTH];
	int firstx=left<0?-left:0,lastx=width;
	int firsty=top<0?-top:0,lasty=height;
	if(left+lastx>(int)ScreenWidth)lastx=ScreenWidth-left;
	if(top+lasty>(int)ScreenHeight)lasty=ScreenHeight-top;
	if(firstx>=lastx || firsty>=lasty)return;
	for(x=firstx;x<lastx;x++)columns[x-firstx]=x*320/weaponwidth;
	int lighting=shadow?64:(int)players.mo->subsector->sector->lightlevel+40;
	uint16_t *colors=LightTable(lighting,BrowserSectorStyle(players.mo->subsector->sector));
	if(psp->StatePtr->SpriteFrame&FF_FULLBRIGHT)colors=LightTable(255,0);

	for (y = firsty; y < lasty; ++y) {
		Byte *row=image->pixels+(y*160/ScreenHeight)*image->width;
		uint16_t *dest=framebuffer+(top+y)*BROWSER_WIDTH+left+firstx;
		for(x=firstx;x<lastx;x++,dest++) {
			Byte index=row[columns[x-firstx]];
			if(index)*dest=colors[index];
		}
	}
}
void DrawColors(void) {}
void EnableHardwareClipping(void) {}
void DisableHardwareClipping(void) {}
void UpdateAndPageFlip(void) {}
void DrawPlaque(Word id) { (void)id; }
void DrawSpriteCenter(Word id) { (void)id; }
void WritePrefsFile(void) {}
void ReadPrefsFile(void) {}
void ClearPrefsFile(void) {}
void Halt(void) { abort(); }
LongWord ReadTick(void) { return (LongWord)(ps1_ticks()); }
Word ReadJoyButtons(Word pad) { (void)pad; return JoyPadButtons; }
void O_Init(void) {}
void O_Control(player_t *player) { (void)player; }
void O_Drawer(void) {}
void ST_Start(void) { memset(&stbar, 0, sizeof(stbar)); }
void ST_Stop(void) {}
void ST_Ticker(void) {}
void ST_Drawer(void) {}
void PlaySound(Word id) { ps1_sound(id); LeftVolume=RightVolume=255; }
void StopSound(Word id) { browser_stop_sound(id); }
void SetSfxVolume(Word volume) { SfxVolume = volume; }
void SetMusicVolume(Word volume) { MusicVolume = volume; }
void PlaySong(Word song) { (void)song; }
void PauseMusic(void) {}
void ResumeMusic(void) {}

int doom_init(Byte *data, Word size)
{
	Word i, c, last = 0;
	if (initialized || size < 12 || memcmp(data, "G1PS", 4) || ((Word *)data)[1] != 1) return 0;
	resource_count = ((Word *)data)[2];
	if (resource_count > 1100 || resource_count > (size - 12) / sizeof(Resource)) return 0;
	directory = (Resource *)(data + 12);
	for (i = 0; i < resource_count; ++i) {
		Resource *r = directory + i;
		if (r->id >= 1100 || r->id <= last || (r->offset & 3) || r->size > 1024*1024) return 0;
		last = r->id;
	}
	bundle = data;
	bundle_size = size;
    memcpy(palette, asset_palette, sizeof(palette));
	ScreenSize = 0;
	R_Init();
	P_Init();
	initialized = 1;
	intro_begin();
	return 1;
}
static int SpawnBrowserPlayer(int slot)
{
	mapthing_t spot;
	mobj_t probe;
	int attempt, start, count = BrowserDeathmatch ? (int)(deathmatch_p - deathmatchstarts) : 4;
	memset(&probe, 0, sizeof(probe));
	probe.radius = mobjinfo[MT_PLAYER].Radius;
	probe.height = mobjinfo[MT_PLAYER].Height;
	probe.player = BrowserPlayers + slot;
	probe.flags = MF_SOLID;
	probe.InfoPtr = &mobjinfo[MT_PLAYER];
	if (!count) count = 4;
	start = slot + spawnserial[slot];
	if (BrowserDeathmatch) {
		spawnrandom ^= spawnrandom<<13; spawnrandom ^= spawnrandom>>17; spawnrandom ^= spawnrandom<<5;
		start = spawnrandom % count;
	}
	for (attempt = 0; attempt < count * 17; ++attempt) {
		int index = (start + attempt) % count;
		int ring = attempt / count;
		spot = BrowserDeathmatch && deathmatch_p > deathmatchstarts ? deathmatchstarts[index] : BrowserStarts[index];
		if (!spot.type) spot = BrowserStarts[0];
		if (!spot.type) continue;
		if (ring) {
			int direction = (ring - 1) & 7, distance = ((ring - 1) / 8 + 1) * 48;
			spot.x += distance * finecosine[direction * (FINEANGLES / 8)];
			spot.y += distance * finesine[direction * (FINEANGLES / 8)];
		}
		probe.x = spot.x; probe.y = spot.y;
		probe.z = PointInSubsector(spot.x, spot.y)->sector->floorheight;
		if (BrowserPlayerCount > 1 && (!P_CheckPosition(&probe, spot.x, spot.y) || tmceilingz - tmfloorz < probe.height)) continue;
		BrowserCurrentPlayer = BrowserPlayers + slot;
		if (players.mo) {
			players.mo->damageplayer = &players;
			players.mo->player = 0;
		}
		spot.type = slot + 1;
		P_SpawnPlayer(&spot);
		players.colormap = slot;
		if (BrowserDeathmatch) memset(players.cards, 1, sizeof(players.cards));
		++spawnserial[slot];
		return 1;
	}
	return 0;
}
/* Keep recent bodies, but leave room for live actors in long multiplayer sessions. */
static void TrimBrowserBodies(void)
{
	mobj_t *body, *next, *other;
	int count = 0, i;
	for (body = mobjhead.next; body != &mobjhead; body = body->next)
		if (body->InfoPtr == &mobjinfo[MT_PLAYER] && !body->player && (body->flags & MF_CORPSE)) ++count;
	for (body = mobjhead.next; body != &mobjhead && count > 32; body = next) {
		next = body->next;
		if (body->InfoPtr != &mobjinfo[MT_PLAYER] || body->player || !(body->flags & MF_CORPSE)) continue;
		for (other = mobjhead.next; other != &mobjhead; other = other->next) if (other->target == body) {
			/* Shots keep their owner after that owner's old body is removed. */
			if (body->damageplayer && (other->InfoPtr == &mobjinfo[MT_ROCKET] ||
				other->InfoPtr == &mobjinfo[MT_PLASMA] || other->InfoPtr == &mobjinfo[MT_BFG] ||
				other->InfoPtr == &mobjinfo[MT_BARREL]))
				other->target = body->damageplayer->mo;
			else { other->target = 0; other->threshold = 0; }
		}
		for (i = 0; i < (int)numsectors; ++i) if (sectors[i].soundtarget == body) sectors[i].soundtarget = 0;
		for (i = 0; i < 4; ++i) if (BrowserPlayers[i].attacker == body) BrowserPlayers[i].attacker = 0;
		P_RemoveMobj(body); --count;
	}
}
void BrowserSpawnPlayers(void)
{
	int i;
	for (i = 0; i < BrowserPlayerCount; ++i) {
		BrowserPlayers[i].mo = 0;
		if (!(playerMask & (1u << i))) continue;
		BrowserPlayers[i].killcount = BrowserPlayers[i].itemcount = BrowserPlayers[i].secretcount = 0;
		if (BrowserPlayers[i].playerstate == PST_DEAD) BrowserPlayers[i].playerstate = PST_REBORN;
		if (!SpawnBrowserPlayer(i)) browser_error(-1);
	}
	BrowserCurrentPlayer = BrowserPlayers;
}
void BrowserRespawn(void)
{
	int slot = BrowserCurrentPlayer - BrowserPlayers, k, j;
	Word kills = players.killcount, items = players.itemcount, secrets = players.secretcount;
	Boolean cards[NUMCARDS] = {0};
	/* Keep the team's keys through death, including a simultaneous team wipe. */
	if (!BrowserDeathmatch) for (j = 0; j < BrowserPlayerCount; ++j)
		for (k = 0; k < NUMCARDS; ++k) cards[k] |= BrowserPlayers[j].cards[k];
	if (SpawnBrowserPlayer(slot)) {
		players.killcount = kills; players.itemcount = items; players.secretcount = secrets;
		if (!BrowserDeathmatch) memcpy(players.cards, cards, sizeof(cards));
		TrimBrowserBodies();
	}
}
Word BrowserPlayerTime(player_t *player)
{
	return BrowserPlayerCount > 1 ? playerTicks[player - BrowserPlayers] : TotalGameTicks;
}
static void BrowserPlayerCommand(int i, Word buttons, int weapon)
{
	BrowserCurrentPlayer = BrowserPlayers + i;
	JoyPadButtons = buttons & ~PadStart;
	PrevJoyPadButtons = previousbuttons[i];
	NewJoyPadButtons = JoyPadButtons & ~PrevJoyPadButtons;
	previousbuttons[i] = JoyPadButtons;
	if (players.playerstate == PST_REBORN) BrowserRespawn();
	if (players.playerstate == PST_REBORN) return;
	/* Movement and its bob phase advance once per command, including prediction. */
	playerTicks[i] += ElapsedTime;
	if (weapon >= 0 && weapon < NUMWEAPONS && players.weaponowned[weapon] &&
		(weapon != players.readyweapon || players.pendingweapon != wp_nochange))
		players.pendingweapon = weapon;
	P_PlayerThink(&players);
}
void BrowserThinkPlayers(void)
{
	int i, n;
	for (i = 0; i < BrowserPlayerCount; ++i) {
		if (!(playerMask & (1u << i))) continue;
		if (commandMode) {
			for (n = 0; n < netcommands[i*9]; ++n)
				BrowserPlayerCommand(i, (Word)netcommands[i*9+1+n*2], netcommands[i*9+2+n*2]);
		} else BrowserPlayerCommand(i, netbuttons[i], netweapons[i]);
		BrowserCurrentPlayer = BrowserPlayers + i;
		/* Hazards and power timers follow world time, even while input is missing. */
		if (players.mo && players.playerstate == PST_LIVE) P_PlayerWorldThink(&players);
	}
	/* World updates must never depend on which viewpoint this browser renders. */
	BrowserCurrentPlayer = BrowserPlayers;
}
mobj_t *BrowserFindTarget(mobj_t *actor,Boolean allaround)
{
	int i;
	mobj_t *best = 0;
	Fixed nearest = INT32_MAX;
	if (BrowserPlayerCount == 1) return BrowserPlayers[0].mo;
	for (i = 0; i < BrowserPlayerCount; ++i) {
		mobj_t *mo = BrowserPlayers[i].mo;
		Fixed distance;
		if (!mo || !mo->MObjHealth) continue;
		distance = GetApproxDistance(mo->x - actor->x, mo->y - actor->y);
		if (!allaround && distance > MELEERANGE && actor->subsector->sector->soundtarget != mo) {
			angle_t angle = PointToAngle(actor->x, actor->y, mo->x, mo->y) - actor->angle;
			if (angle > ANG90 && angle < ANG270) continue;
		}
		if (distance < nearest && CheckSight(actor, mo)) { nearest = distance; best = mo; }
	}
	return best;
}
void doom_seed(Word seed) { spawnrandom = seed ? seed : 1; }
void doom_multiplayer(int count, int local, int deathmatch, int mask)
{
	if (count < 1 || count > 4 || local < 0 || local >= count) return;
	playerMask = mask ? mask & ((1u << count) - 1) : (1u << count) - 1;
	BrowserPlayerCount = count; BrowserLocalPlayer = local; BrowserDeathmatch = count > 1 && deathmatch;
	memset(BrowserFrags, 0, sizeof(BrowserFrags));
	memset(spawnserial, 0, sizeof(spawnserial));
	showmap = 0;
}
/* Apply membership only at ordered frame boundaries. Slots never shift. */
void doom_roster(unsigned mask)
{
	int i, j;
	if (BrowserPlayerCount != 4 || mask > 15) return;
	for (i = 0; i < 4; ++i) {
		mobj_t *mo = BrowserPlayers[i].mo, *other;
		if (!((playerMask ^ mask) & (1u << i))) continue;
		if (!(mask & (1u << i)) && mo) {
			/* Clear references before releasing a departing player's actor. */
			for (other = mobjhead.next; other != &mobjhead; other = other->next) {
				if (other->target == mo || (other->target && other->target->damageplayer == BrowserPlayers + i)) {
					/* Preserve co-op protection after removing the shooter's actor. */
					if (other->InfoPtr == &mobjinfo[MT_ROCKET] ||
						other->InfoPtr == &mobjinfo[MT_PLASMA] || other->InfoPtr == &mobjinfo[MT_BFG] ||
						other->InfoPtr == &mobjinfo[MT_BARREL])
						other->flags |= MF_ORPHANSHOT;
					other->target = 0;
					other->threshold = 0;
				}
			}
			for (other = mobjhead.next; other != &mobjhead; other = other->next)
				if (other->damageplayer == BrowserPlayers + i) other->damageplayer = 0;
			for (j = 0; j < (int)numsectors; ++j)
				if (sectors[j].soundtarget == mo) sectors[j].soundtarget = 0;
			for (j = 0; j < 4; ++j)
				if (BrowserPlayers[j].attacker == mo) BrowserPlayers[j].attacker = 0;
			P_RemoveMobj(mo);
		}
		memset(BrowserPlayers + i, 0, sizeof(player_t));
		BrowserPlayers[i].playerstate = PST_REBORN;
		BrowserFrags[i] = 0; previousbuttons[i] = netbuttons[i] = playerTicks[i] = 0; netweapons[i] = -1;
		if (mask & (1u << i)) {
			BrowserCurrentPlayer = BrowserPlayers + i;
			BrowserRespawn();
		}
	}
	playerMask = mask;
	BrowserCurrentPlayer = BrowserPlayers + BrowserLocalPlayer;
}
void doom_start(int map, int skill)
{
	render_valid=0;
	int i;
	int newcheckpoint = !level_loaded || skill >= 0 || map != gamemap;
	if (!initialized || map < 1 || map > 24 || skill > 4 || skill < -1) return;
	intro_end(); intro_release=0;
	BrowserCurrentPlayer = BrowserPlayers;
	if (level_loaded) {
		if (skill < 0) for (i = 0; i < BrowserPlayerCount; ++i) {
			BrowserCurrentPlayer = BrowserPlayers + i; G_PlayerFinishLevel();
		}
		S_Clear();
		P_Stop();
		for (i = 0; i < 4; ++i) BrowserPlayers[i].mo = 0;
	}
	if (skill >= 0) {
		memset(BrowserPlayers, 0, sizeof(BrowserPlayers));
		memset(BrowserFrags, 0, sizeof(BrowserFrags));
		memset(spawnserial, 0, sizeof(spawnserial));
		for (i = 0; i < BrowserPlayerCount; ++i) {
			BrowserCurrentPlayer = BrowserPlayers + i; G_InitNew((skill_t)skill, map);
		}
	}
	else gamemap = map;
	BrowserCurrentPlayer = BrowserPlayers;
	memset(previousbuttons, 0, sizeof(previousbuttons));
	JoyPadButtons = PrevJoyPadButtons = NewJoyPadButtons = 0;
	TotalGameTicks = 0;
	memset(playerTicks, 0, sizeof(playerTicks));
	/* Replays and new matches must not inherit the previous world's animation phase. */
	for (i = 0; i < (int)NumFlatAnims; ++i) FlatAnims[i].CurrentPic = FlatAnims[i].BasePic;
	endphase = exitmap = 0; endticks = levelticks = 0;
	memset(BrowserLevelCounts, 0, sizeof(BrowserLevelCounts));
	ElapsedTime = 4;
	P_Start();
	BrowserCurrentPlayer = BrowserPlayers + BrowserLocalPlayer;
	level_loaded = running = 1;
	if (BrowserPlayerCount == 1 && newcheckpoint) {
		checkpoint[0] = 1; checkpoint[1] = gamemap; checkpoint[2] = gameskill;
		checkpoint[3] = players.health; checkpoint[4] = players.armorpoints; checkpoint[5] = players.armortype;
		checkpoint[6] = players.readyweapon; checkpoint[7] = 0;
		for (i = 0; i < NUMWEAPONS; ++i) if (players.weaponowned[i]) checkpoint[7] |= 1<<i;
		for (i = 0; i < NUMAMMO; ++i) { checkpoint[8+i] = players.ammo[i]; checkpoint[12+i] = players.maxammo[i]; }
	}
}
int *doom_checkpoint(void) { return checkpoint; }
void doom_pause(int paused)
{
	if (BrowserPlayerCount == 1 && level_loaded && !endphase) gamepaused = !!paused;
}
int doom_load_checkpoint(const int *data)
{
	int i, saved[16];
	if (!initialized || !data) return 0;
	memcpy(saved, data, sizeof(saved));
	if (saved[0] != 1 || saved[1] < 1 || saved[1] > 24 || saved[2] < 0 || saved[2] > 4 ||
		saved[3] < 1 || saved[3] > 200 || saved[4] < 0 || saved[4] > 200 || saved[5] < 0 || saved[5] > 2 ||
		saved[6] < 0 || saved[6] >= NUMWEAPONS || saved[7] < 0 || saved[7] >= (1<<NUMWEAPONS) ||
		(saved[7]&3) != 3 || !(saved[7]&(1<<saved[6]))) return 0;
	for (i = 0; i < NUMAMMO; ++i) {
		if (saved[12+i] != (int)maxammo[i] && saved[12+i] != (int)maxammo[i]*2) return 0;
		if (saved[8+i] < 0 || saved[8+i] > saved[12+i]) return 0;
		if ((saved[12+i] > (int)maxammo[i]) != (saved[12] > (int)maxammo[0])) return 0;
	}
	doom_multiplayer(1, 0, 0, 1);
	doom_start(saved[1], saved[2]);
	players.health = players.mo->MObjHealth = saved[3];
	players.armorpoints = saved[4]; players.armortype = saved[5]; players.readyweapon = saved[6];
	players.backpack = saved[12] > (int)maxammo[0];
	for (i = 0; i < NUMWEAPONS; ++i) players.weaponowned[i] = (saved[7]>>i)&1;
	for (i = 0; i < NUMAMMO; ++i) { players.ammo[i] = saved[8+i]; players.maxammo[i] = saved[12+i]; }
	SetupPSprites(&players);
	memcpy(checkpoint, saved, sizeof(saved));
	return 1;
}
int doom_step(Word buttons)
{
	Word action;
	if(intro_state()) {
		if(intro_step(buttons)) { doom_start(1,2); intro_release=buttons; }
		return 0;
	}
	if(intro_release) { intro_release=buttons; buttons=0; }
	/* An empty spectator-hosted room keeps its world paused. */
	if (!running || (BrowserPlayerCount == 4 && !playerMask)) return 0;
	if (endphase) {
		Word pressed = 0;
		int i;
		for (i = 0; i < BrowserPlayerCount; ++i) {
			Word held = BrowserPlayerCount > 1 ? netbuttons[i] : buttons;
			pressed |= held & ~previousbuttons[i];
			previousbuttons[i] = held;
		}
		endticks += 4;
		if (endticks >= TICKSPERSEC / 2 && (pressed & (PadA | PadB | PadC))) {
			if (exitmap) doom_start(exitmap, -1);
			else { endphase = 2; running = 0; }
		}
		return 0;
	}
	BrowserCurrentPlayer = BrowserPlayers;
	PrevJoyPadButtons = JoyPadButtons;
	JoyPadButtons = buttons;
	NewJoyPadButtons = buttons & ~PrevJoyPadButtons;
	ElapsedTime = 4;
	TotalGameTicks += 4;
	memcpy(previous_render,doom_render_players(),sizeof(previous_render));
	render_valid=1;
	action = P_Ticker();
	if (!gamepaused) levelticks += 4;
	if (action == ga_died || action == ga_warped) doom_start(gamemap, -1);
	else if (action == ga_completed || action == ga_secretexit) {
		int i;
		exitmap = 0; /* This disc contains the first map. */
		endphase = 1; endticks = 0;
		for (i = 0; i < BrowserPlayerCount; ++i)
			previousbuttons[i] = BrowserPlayerCount > 1 ? netbuttons[i] : buttons;
		S_Clear();
	}
	BrowserCurrentPlayer = BrowserPlayers + BrowserLocalPlayer;
	return action;
}
int doom_net_step(Word a, Word b, Word c, Word d, int wa, int wb, int wc, int wd)
{
	commandMode = 0;
	netbuttons[0] = a; netbuttons[1] = b; netbuttons[2] = c; netbuttons[3] = d;
	netweapons[0] = wa; netweapons[1] = wb; netweapons[2] = wc; netweapons[3] = wd;
	return doom_step(a);
}
/* Four slots, each containing a count and up to four [buttons, weapon] commands. */
int doom_net_commands(const int *commands)
{
	int i, n;
	for (i = 0; i < 4; ++i) if (commands[i*9] < 0 || commands[i*9] > 4) return 0;
	memcpy(netcommands, commands, sizeof(netcommands));
	commandMode = 1;
	for (i = 0; i < 4; ++i) {
		netbuttons[i] = 0;
		for (n = 0; n < commands[i*9]; ++n) netbuttons[i] |= (Word)commands[i*9+1+n*2];
	}
	return doom_step(netbuttons[0]);
}
/* Replayed inside a disposable snapshot: predict the actor, not the entire world. */
void doom_predict(Word buttons, int weapon)
{
	if (!running || endphase || !(playerMask & (1u << BrowserLocalPlayer))) return;
	ElapsedTime = 4;
	BrowserPlayerCommand(BrowserLocalPlayer, buttons, weapon);
	BrowserCurrentPlayer = BrowserPlayers + BrowserLocalPlayer;
}
void doom_map(void)
{
	if (BrowserPlayerCount > 1) showmap = !showmap;
	else if (level_loaded) players.AutomapFlags ^= AF_ACTIVE;
}
/* Only the visibility bit survives a rendered prediction; game state is rolled back. */
Word *doom_map_lines(void)
{
	static Word layout[4];
	layout[0] = numlines ? (Word)(uintptr_t)&lines[0].flags : 0;
	layout[1] = sizeof(line_t); layout[2] = numlines; layout[3] = ML_MAPPED;
	return layout;
}
/* Select a spectator camera without changing players or restarting the world. */
void doom_view(int slot)
{
	if (slot < 0 || slot >= BrowserPlayerCount) return;
	BrowserLocalPlayer = slot;
	BrowserCurrentPlayer = BrowserPlayers + slot;
}
/* Local rollback ranges: immutable bundle and framebuffer need no copying. */
Word *doom_snapshot_ranges(void)
{
	static Word ranges[6];
	ranges[0] = 0; ranges[1] = (Word)(uintptr_t)framebuffer;
	ranges[2] = (Word)(uintptr_t)(framebuffer + BROWSER_WIDTH * BROWSER_HEIGHT);
	ranges[3] = (Word)(uintptr_t)bundle;
	ranges[4] = (Word)(uintptr_t)(bundle + bundle_size);
	ranges[5] = (Word)(uintptr_t)sbrk(0);
	return ranges;
}
/* Render poses are temporary presentation data, never simulation positions. */
/* Four [x, y, z, angle, health] records followed by four eye offsets above feet. */
/* Then the viewed weapon's fixed-point x/y and weapon type. */
int *doom_render_players(void)
{
	int i;
	for (i = 0; i < 4; ++i) {
		mobj_t *mo = BrowserPlayers[i].mo;
		renderplayers[i*5] = mo ? mo->x : 0;
		renderplayers[i*5+1] = mo ? mo->y : 0;
		renderplayers[i*5+2] = mo ? mo->z : 0;
		renderplayers[i*5+3] = mo ? mo->angle : 0;
		renderplayers[i*5+4] = mo ? mo->MObjHealth : 0;
		renderplayers[20+i] = mo ? BrowserPlayers[i].viewz - mo->z : 0;
	}
	renderplayers[24] = players.psprites[ps_weapon].WeaponX * FRACUNIT;
	renderplayers[25] = players.psprites[ps_weapon].WeaponY * FRACUNIT;
	renderplayers[26] = players.readyweapon;
	return renderplayers;
}
void BrowserRenderPosition(mobj_t *mo, Fixed *x, Fixed *y, Fixed *z, angle_t *angle)
{
	int i;
	if (!useRenderPlayers || !mo->player) return;
	i = mo->player - BrowserPlayers;
	if (i < 0 || i >= BrowserPlayerCount) return;
	*x = renderplayers[i*5]; *y = renderplayers[i*5+1];
	*z += renderplayers[i*5+2] - mo->z;
	*angle = renderplayers[i*5+3];
}
void BrowserRenderView(Fixed *z)
{
	if (useRenderPlayers) *z = renderplayers[BrowserLocalPlayer*5+2] + renderplayers[20+BrowserLocalPlayer];
}
uint16_t *doom_render(int smooth)
{
	Word i;
	if(intro_state()) { intro_draw(framebuffer); return framebuffer; }
	UpdateShades();
	useRenderPlayers = smooth;
	for (i = 0; i < BROWSER_WIDTH * BROWSER_HEIGHT; ++i) framebuffer[i] = 0x0842;
	if (level_loaded && players.mo) {
		if (showmap || (players.AutomapFlags & AF_ACTIVE)) {
			if (showmap) { players.automapx = players.mo->x; players.automapy = players.mo->y; }
			AM_Drawer();
		}
		else R_RenderPlayerView();
	}
	useRenderPlayers = 0;
	hud_draw(framebuffer);
	return framebuffer;
}
uint16_t *doom_render_lerp(unsigned fraction)
{
	if(!render_valid || fraction>=65536 || gamepaused || intro_state())return doom_render(0);
	doom_render_players();
	/* Presentation only: physics, collision and firing retain their fixed ticks. */
	for(int player=0;player<BrowserPlayerCount;player++) {
		int base=player*5,snap=0;
		for(int axis=0;axis<3;axis++) {
			int64_t distance=(int64_t)renderplayers[base+axis]-previous_render[base+axis];
			if(distance>128*FRACUNIT || distance<-128*FRACUNIT)snap=1;
		}
		if(snap)continue;
		for(int axis=0;axis<4;axis++) {
			int delta=(uint32_t)renderplayers[base+axis]-(uint32_t)previous_render[base+axis];
			renderplayers[base+axis]=previous_render[base+axis]+IMFixMul(delta,fraction);
		}
		renderplayers[20+player]=previous_render[20+player]+IMFixMul(renderplayers[20+player]-previous_render[20+player],fraction);
	}
	return doom_render(1);
}
void doom_weapon(int weapon)
{
	if (level_loaded && weapon >= 0 && weapon < NUMWEAPONS && players.weaponowned[weapon] &&
		(weapon != players.readyweapon || players.pendingweapon != wp_nochange)) players.pendingweapon = weapon;
}
int doom_intro(void) { return intro_state(); }
int *doom_state(void)
{
	Word i;
	state[0] = gamemap; state[1] = players.health; state[2] = players.armorpoints;
	state[3] = players.readyweapon;
	state[4] = players.readyweapon < NUMWEAPONS && WeaponAmmos[players.readyweapon] < NUMAMMO ? players.ammo[WeaponAmmos[players.readyweapon]] : -1;
	state[5] = players.killcount; state[6] = TotalKillsInLevel;
	state[7] = players.itemcount; state[8] = players.secretcount;
	if (BrowserPlayerCount > 1 && !BrowserDeathmatch) {
		state[5] = BrowserLevelCounts[0]; state[7] = BrowserLevelCounts[1]; state[8] = BrowserLevelCounts[2];
	}
	state[9] = players.mo ? players.mo->x : 0; state[10] = players.mo ? players.mo->y : 0;
	state[11] = players.mo ? players.mo->angle : 0;
	state[12] = players.playerstate; state[13] = running; state[14] = gamepaused;
	state[15] = 0;
	for (i = 0; i < NUMCARDS; ++i) if (players.cards[i]) state[15] |= 1 << i;
	state[16] = 0;
	for (i = 0; i < NUMWEAPONS; ++i) if (players.weaponowned[i]) state[16] |= 1 << i;
	state[17] = TotalGameTicks;
	for (i = 0; i < NUMAMMO; ++i) { state[18 + i] = players.ammo[i]; state[22 + i] = players.maxammo[i]; }
	state[26] = players.damagecount; state[27] = players.bonuscount;
	state[28] = BrowserPlayerCount; state[29] = BrowserLocalPlayer; state[30] = BrowserDeathmatch;
	for (i = 0; i < 4; ++i) state[31 + i] = BrowserFrags[i];
	state[35] = players.attackdown;
	state[36] = endphase; state[37] = exitmap; state[38] = levelticks;
	state[39] = ItemsFoundInLevel; state[40] = SecretsFoundInLevel; state[41] = endticks; state[42] = playerMask;
	return state;
}
/* Logical values only: pointers, sound panning and render visibility differ per browser. */
uint32_t doom_checksum(void)
{
	uint32_t hash = 2166136261u;
	mobj_t *mo;
	Word i, j;
#define HASH(v) hash = (hash ^ (uint32_t)(v)) * 16777619u
	HASH(gamemap); HASH(TotalGameTicks); HASH(playerMask);
	if (BrowserDeathmatch) HASH(spawnrandom);
	if (endphase) { HASH(endphase); HASH(exitmap); HASH(endticks); }
	for (i = 0; i < (Word)BrowserPlayerCount; ++i) {
		player_t *p = BrowserPlayers + i;
		HASH(p->health); HASH(p->armorpoints); HASH(p->playerstate); HASH(p->readyweapon); HASH(p->pendingweapon);
		HASH(BrowserFrags[i]);
		if (BrowserPlayerCount > 1) HASH(playerTicks[i]);
		for (j = 0; j < NUMAMMO; ++j) { HASH(p->ammo[j]); HASH(p->maxammo[j]); }
		for (j = 0; j < NUMCARDS; ++j) { HASH(p->cards[j]); }
		for (j = 0; j < NUMPOWERS; ++j) { HASH(p->powers[j]); }
	}
	for (mo = mobjhead.next; mo != &mobjhead; mo = mo->next) {
		HASH(mo->x); HASH(mo->y); HASH(mo->z); HASH(mo->angle); HASH(mo->MObjHealth);
		HASH(mo->momx); HASH(mo->momy); HASH(mo->momz); HASH(mo->tics); HASH(mo->flags);
		HASH(mo->state - states);
		if (mo->damageplayer) { HASH(mo->damageplayer - BrowserPlayers + 1); }
	}
	for (i = 0; i < numsectors; ++i) {
		HASH(sectors[i].floorheight); HASH(sectors[i].ceilingheight); HASH(sectors[i].special); HASH(sectors[i].lightlevel);
	}
	for (i = 0; i < numlines; ++i) { HASH(lines[i].special); }
#undef HASH
	return hash;
}
