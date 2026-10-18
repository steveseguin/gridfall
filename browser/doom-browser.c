/* Browser platform for the original MIT-licensed 3DO engine. */
#include "doom.h"
#include "intmath.h"
#include <emscripten.h>
#include <limits.h>
#include <math.h>
/* unistd.h's close() conflicts with the original door-state enum. */
extern void *sbrk(intptr_t increment);

typedef struct { void *data; Word size; } Handle;
typedef struct { Word id, offset, size; } Resource;
typedef struct { Short width, height; Short pixels[]; } Image;
static Byte *bundle;
static Word bundle_size;
static Word resource_count;
static Resource *directory;
static Handle *resources[1100];
static uint32_t framebuffer[BROWSER_WIDTH * BROWSER_HEIGHT];
static Byte lightchannels[256][32];
static int state[43];
static int renderplayers[27], useRenderPlayers;
/* Level-entry checkpoint: version, map, skill, health, armor, armor type,
   weapon, owned weapons, four ammo counts and four capacities. */
static int checkpoint[16];
static int initialized, level_loaded, running;
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

EM_JS(void, browser_error, (int id), {
	throw new Error("Missing or invalid Doom resource " + id);
});
EM_JS(void, browser_sound, (int id, const Byte *data, int size, int rate, int left, int right), {
	if (Module.onSound) Module.onSound(id, data, size, rate, left, right);
});
EM_JS(void, browser_stop_sound, (int id), {
	if (Module.onStopSound) Module.onStopSound(id);
});

void *AllocAPointer(LongWord size)
{
	void *ptr = calloc(1, size ? size : 1);
	if (!ptr) abort();
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
	resources[id] = (Handle *)AllocAHandle(entry->size);
	memcpy(resources[id]->data, bundle + entry->offset, entry->size);
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
	uint64_t numerator = a < 0 ? -(int64_t)a : a;
	uint64_t denominator = b < 0 ? -(int64_t)b : b;
	uint64_t quotient;
	if (!denominator) return negative ? INT32_MIN : INT32_MAX;
	quotient = ((numerator << 16) + denominator / 2) / denominator;
	if (quotient > INT32_MAX) return negative ? INT32_MIN : INT32_MAX;
	return negative ? -(Fixed)quotient : (Fixed)quotient;
}

static inline __attribute__((always_inline)) uint32_t Color(Short pixel, int light)
{
	const Byte *channel;
	if (light < 32) light = 32;
	if (light > 255) light = 255;
	channel = lightchannels[light];
	return 0xff000000u | channel[(pixel >> 10) & 31] | (channel[(pixel >> 5) & 31] << 8) | (channel[pixel & 31] << 16);
}
static void Pixel(int x, int y, Short color, int light)
{
	if ((unsigned)x < BROWSER_WIDTH && (unsigned)y < BROWSER_HEIGHT) framebuffer[y * BROWSER_WIDTH + x] = Color(color, light);
}

typedef struct {
	const Short *pixels, *next;
	int width, height, nextwidth, nextheight, level, blend, columns, light, filtered;
	int irregular, period;
	double vscale, nextvscale;
} Surface;
static inline __attribute__((always_inline)) uint32_t MixColor(uint32_t a, uint32_t b, unsigned blend)
{
	uint32_t rb = ((a & 0xff00ff) * (256-blend) + (b & 0xff00ff) * blend) >> 8;
	uint32_t g = ((a & 0xff00) * (256-blend) + (b & 0xff00) * blend) >> 8;
	return 0xff000000 | (rb & 0xff00ff) | (g & 0xff00);
}
static Surface PrepareSurface(const Short *pixels, int w, int h, double footprint, int columns, int light)
{
	Surface s;
	int originalheight = h;
	s.level = 0; s.filtered = footprint > 1;
	while (footprint >= 2 && (w > 1 || h > 1)) {
		pixels += w*h; w = w > 1 ? w/2 : 1; h = h > 1 ? h/2 : 1;
		footprint *= .5; ++s.level;
	}
	s.pixels = pixels; s.width = w; s.height = h;
	s.next = pixels+w*h; s.nextwidth = w > 1 ? w/2 : 1; s.nextheight = h > 1 ? h/2 : 1;
	s.irregular = (originalheight & (originalheight-1)) != 0;
	s.period = originalheight<<16;
	s.vscale = (double)h/originalheight; s.nextvscale = (double)s.nextheight/originalheight;
	s.blend = s.filtered && (w > 1 || h > 1) ? (int)((footprint-1)*256) : 0;
	if (s.blend > 256) s.blend = 256;
	s.columns = columns; s.light = light;
	return s;
}
static inline __attribute__((always_inline)) uint32_t SurfacePixel(const Short *pixels, int w, int h, Word u, Word v, int columns, int light)
{
	int x = (u>>16)&(w-1), y = (int32_t)v>>16;
	/* Several door textures are 72 or 112 pixels tall, not powers of two. */
	if (h & (h-1)) { if (y < 0) y += h; else if (y >= h) y -= h; }
	else y &= h-1;
	return Color(pixels[columns ? x*h+y : y*w+x], light);
}
static inline __attribute__((always_inline)) uint32_t FilterSurface(const Short *pixels, int w, int h, Word u, Word v, int columns, int light)
{
	uint32_t a,b;
	u -= 32768; v -= 32768;
	a = MixColor(SurfacePixel(pixels,w,h,u,v,columns,light), SurfacePixel(pixels,w,h,u+65536,v,columns,light), (u>>8)&255);
	b = MixColor(SurfacePixel(pixels,w,h,u,v+65536,columns,light), SurfacePixel(pixels,w,h,u+65536,v+65536,columns,light), (u>>8)&255);
	return MixColor(a,b,(v>>8)&255);
}
static inline __attribute__((always_inline)) uint32_t SampleSurface(Surface *s, Word u, Word v)
{
	uint32_t a;
	Word basev = v;
	u = (Word)((int32_t)u>>s->level);
	if (s->irregular) {
		/* Normalize before rescaling so every mip repeats at the original height. */
		int wrapped = (int32_t)v % s->period;
		if (wrapped < 0) wrapped += s->period;
		basev = wrapped;
		v = (Word)(wrapped*s->vscale);
	} else v = (Word)((int32_t)v>>s->level);
	if (!s->filtered) return SurfacePixel(s->pixels,s->width,s->height,u,v,s->columns,s->light);
	a = FilterSurface(s->pixels,s->width,s->height,u,v,s->columns,s->light);
	if (!s->blend) return a;
	v = s->irregular ? (Word)(int32_t)((int32_t)basev*s->nextvscale) : (Word)((int32_t)v>>1);
	return MixColor(a, FilterSurface(s->next,s->nextwidth,s->nextheight,(Word)((int32_t)u>>1),v,s->columns,s->light), s->blend);
}
void BrowserDrawWall(Byte *data, Fixed u, Word texturemid, int topheight, int bottomheight, int scale)
{
	Image *im = (Image *)data;
	int y, top, bottom;
	double step, position;
	Surface surface;
	if (scale <= 0) return;
	step = 512.0/scale;
	/* Sample at pixel centers, retaining the fractional vertical texture origin.
	   Wrap V within this column: tall walls must not spill into adjacent columns. */
	top = (int)ceil(CenterY - topheight/(64*step) - .5);
	bottom = (int)ceil(CenterY - bottomheight/(64*step) - .5);
	if (top < 0) top = 0;
	if (bottom > (int)ScreenHeight) bottom = ScreenHeight;
	surface = PrepareSurface(im->pixels,im->width,im->height,step,1,tx_texturelight);
	position = (int32_t)texturemid + (top+.5-CenterY)*step*65536;
	for (y=top;y<bottom;++y) {
		framebuffer[y*BROWSER_WIDTH+tx_x] = SampleSurface(&surface,(Word)u,(Word)(int64_t)position);
		position += step*65536;
	}
}
void BrowserDrawPlane(Word x1, Word x2, Word y, Word height)
{
	double row = fabs(y+.5-CenterY), distance = (height/64.0)*(StretchWidth/65536.0)/row;
	double cosine = viewcos/65536.0, sine = viewsin/65536.0;
	double side = ((double)CenterX-x1-.5)/PROJECTIONX;
	double u = viewx + distance*(cosine-sine*side)*65536;
	double v = -(double)viewy - distance*(sine+cosine*side)*65536;
	double du = distance*sine/PROJECTIONX*65536, dv = distance*cosine/PROJECTIONX*65536;
	double footprint = fmax(distance/PROJECTIONX, distance/row);
	int light = distance > 0 ? lightcoef/(distance*16)-lightsub : lightmax;
	Surface surface;
	Word x;
	if (light < lightmin) light = lightmin;
	if (light > lightmax) light = lightmax;
	surface = PrepareSurface((Short *)PlaneSource,64,64,footprint,0,light);
	for (x=x1;x<x2;++x) {
		framebuffer[y*BROWSER_WIDTH+x] = SampleSurface(&surface,(Word)(int64_t)u,(Word)(int64_t)v);
		u += du; v += dv;
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
		Short color = image->pixels[yy * image->width + xx];
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
		Pixel(tx_x + ScreenXOffset, y + ScreenYOffset, image->pixels[sample], tx_texturelight);
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
	for (y = 0; y < ScreenHeight; ++y) {
		Word sy = y * 160 / ScreenHeight;
		if (sy >= image->height) sy = image->height - 1;
		Pixel(tx_x + ScreenXOffset, y + ScreenYOffset, image->pixels[(x % image->width) * image->height + sy], 255);
	}
}
void DrawFloorColumn(Word y, Word x, Word count, LongWord xf, LongWord yf, Fixed xs, Fixed ys)
{
	Short *source = (Short *)PlaneSource;
	Word i;
	for (i = 0; i < count; ++i) {
		Word sample = ((yf >> 16) & 63) * 64 + ((xf >> 16) & 63);
		Pixel(x + i + ScreenXOffset, y + ScreenYOffset, source[sample], tx_texturelight);
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
	if (vis->xscale <= 0 || vis->yscale <= 0) return;
	if (bottom > (int)ScreenHeight) bottom = ScreenHeight;
	/* Each screen row samples the same texture row in every sprite column. */
	for (y = first; y < bottom; ++y) {
		int sy = ((int64_t)(y - vis->y1) << 16) / vis->yscale;
		rows[y] = sy < image->height ? sy * image->width : -1;
	}
	for (x = left; x <= right; ++x) {
		int sx = ((int64_t)(x - vis->x1) << 16) / vis->xscale;
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
			if (rows[y] < 0) continue;
			color = image->pixels[rows[y] + sx];
			if (!color) continue;
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
				uint32_t *pixel = &framebuffer[(y + ScreenYOffset) * BROWSER_WIDTH + x + ScreenXOffset];
				*pixel = 0xff000000 | ((*pixel >> 1) & 0x7f7f7f);
			} else Pixel(x + ScreenXOffset, y + ScreenYOffset, color, light);
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
	if (useRenderPlayers) {
		/* Keep the flash attached; only the drawn position is interpolated. */
		double wx = psp->WeaponX + (double)renderplayers[24] / FRACUNIT - players.psprites[ps_weapon].WeaponX;
		double wy = psp->WeaponY + (double)renderplayers[25] / FRACUNIT - players.psprites[ps_weapon].WeaponY;
		left = (int)((wx + patch->leftoffset) * weaponwidth / 320) + ((int)ScreenWidth - weaponwidth) / 2 + ScreenXOffset;
		top = (int)((wy - 40 + patch->topoffset) * ScreenHeight / 160) + ScreenYOffset + 2;
	}
	for (y = 0; y < height; ++y) for (x = 0; x < width; ++x) {
		Short color = image->pixels[(y * 160 / ScreenHeight) * image->width + x * 320 / weaponwidth];
		if (color && top + y >= (int)ScreenYOffset && top + y < (int)(ScreenYOffset + ScreenHeight))
			Pixel(left + x, top + y, color, shadow ? 64 : 255);
	}
}
void DrawColors(void)
{
	int x, y, red = players.damagecount + (players.bonuscount >> 2);
	int green = players.bonuscount >> 2;
	int inverse = players.powers[pw_invulnerability] > 240 || (players.powers[pw_invulnerability] & 16);
	if (players.powers[pw_ironfeet] > 240 || (players.powers[pw_ironfeet] & 16)) green = 10;
	if (players.powers[pw_strength] && players.powers[pw_strength] < 255) red += (255 - players.powers[pw_strength]) >> 4;
	if (!red && !green && !inverse) return;
	for (y = ScreenYOffset; y < (int)(ScreenYOffset + ScreenHeight); ++y)
		for (x = ScreenXOffset; x < (int)(ScreenXOffset + ScreenWidth); ++x) {
			uint32_t *pixel = framebuffer + y * BROWSER_WIDTH + x;
			int r = (*pixel & 255) + red * 5, g = ((*pixel >> 8) & 255) + green * 5;
			if (inverse) *pixel ^= 0x00ffffff;
			else *pixel = (*pixel & 0xffff0000) | (r > 255 ? 255 : r) | ((g > 255 ? 255 : g) << 8);
		}
}
void EnableHardwareClipping(void) {}
void DisableHardwareClipping(void) {}
void UpdateAndPageFlip(void) {}
void DrawPlaque(Word id) { (void)id; }
void DrawSpriteCenter(Word id) { (void)id; }
void WritePrefsFile(void) {}
void ReadPrefsFile(void) {}
void ClearPrefsFile(void) {}
void Halt(void) { abort(); }
LongWord ReadTick(void) { return (LongWord)(emscripten_get_now() * .06); }
Word ReadJoyButtons(Word pad) { (void)pad; return JoyPadButtons; }
void O_Init(void) {}
void O_Control(player_t *player) { (void)player; }
void O_Drawer(void) {}
void ST_Start(void) { memset(&stbar, 0, sizeof(stbar)); }
void ST_Stop(void) {}
void ST_Ticker(void) {}
void ST_Drawer(void) {}
void PlaySound(Word id)
{
	Resource *entry = FindResource(1000 + id);
	if (entry && SfxVolume) {
		Word *sample = (Word *)(bundle + entry->offset);
		browser_sound(id, (Byte *)(sample + 2), sample[1], sample[0], LeftVolume * SfxVolume / 15, RightVolume * SfxVolume / 15);
	}
	LeftVolume = RightVolume = 255;
}
void StopSound(Word id) { browser_stop_sound(id); }
void SetSfxVolume(Word volume) { SfxVolume = volume; }
void SetMusicVolume(Word volume) { MusicVolume = volume; }
void PlaySong(Word song) { (void)song; }
void PauseMusic(void) {}
void ResumeMusic(void) {}

int doom_init(Byte *data, Word size)
{
	Word i, c, last = 0;
	if (initialized || size < 12 || memcmp(data, "D3WB", 4) || ((Word *)data)[1] != 3) return 0;
	resource_count = ((Word *)data)[2];
	if (resource_count > 1100 || resource_count > (size - 12) / sizeof(Resource)) return 0;
	directory = (Resource *)(data + 12);
	for (i = 0; i < resource_count; ++i) {
		Resource *r = directory + i;
		if (r->id >= 1100 || r->id <= last || (r->offset & 3) || r->offset > size || r->size > size - r->offset) return 0;
		last = r->id;
	}
	bundle = data;
	bundle_size = size;
	/* Preserve both integer rounding steps of the original per-pixel conversion. */
	for (i = 0; i < 256; ++i) for (c = 0; c < 32; ++c)
		lightchannels[i][c] = c * 255 / 31 * i / 255;
	ScreenSize = 0;
	R_Init();
	P_Init();
	initialized = 1;
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
	int i;
	int newcheckpoint = !level_loaded || skill >= 0 || map != gamemap;
	if (!initialized || map < 1 || map > 24 || skill > 4 || skill < -1) return;
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
	action = P_Ticker();
	if (!gamepaused) levelticks += 4;
	if (action == ga_died || action == ga_warped) doom_start(gamemap, -1);
	else if (action == ga_completed || action == ga_secretexit) {
		int i;
		exitmap = action == ga_secretexit ? 24 : gamemap == 23 ? 0 : gamemap == 24 ? 4 : gamemap + 1;
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
uint32_t *doom_render(int smooth)
{
	Word i;
	useRenderPlayers = smooth;
	for (i = 0; i < BROWSER_WIDTH * BROWSER_HEIGHT; ++i) framebuffer[i] = 0xff111111;
	if (level_loaded && players.mo) {
		if (showmap || (players.AutomapFlags & AF_ACTIVE)) {
			if (showmap) { players.automapx = players.mo->x; players.automapy = players.mo->y; }
			AM_Drawer();
		}
		else R_RenderPlayerView();
	}
	useRenderPlayers = 0;
	return framebuffer;
}
void doom_weapon(int weapon)
{
	if (level_loaded && weapon >= 0 && weapon < NUMWEAPONS && players.weaponowned[weapon] &&
		(weapon != players.readyweapon || players.pendingweapon != wp_nochange)) players.pendingweapon = weapon;
}
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
