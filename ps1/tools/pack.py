"""Pack the original GRIDFALL bundle into sector-aligned, paletted PS1 resources."""
from pathlib import Path
from collections import Counter
from palette import make_palette
import struct
ROOT=Path(__file__).resolve().parents[1]
data=(ROOT/'assets/gridfall-source.bin').read_bytes()
assert data[:4]==b'D3WB'
n=struct.unpack_from('<I',data,8)[0]
resources={rid:data[offset:offset+size] for rid,offset,size in (struct.unpack_from('<III',data,12+i*12) for i in range(n))}
def adpcm(pcm):
    result=bytearray()
    samples=[v*256 for v in struct.unpack('<'+'b'*len(pcm),pcm)]
    for start in range(0,len(samples),28):
        block=samples[start:start+28];block += [0]*(28-len(block))
        shift=12
        while shift>0 and (max(block)>7*(4096>>shift) or min(block)<-8*(4096>>shift)):shift-=1
        scale=4096>>shift
        values=[max(-8,min(7,round(v/scale)))&15 for v in block]
        result.extend([shift,1 if start+28>=len(samples) else 0])
        result.extend(values[i]|(values[i+1]<<4) for i in range(0,28,2))
    return result
sounds={rid-1000:blob for rid,blob in resources.items() if rid>=1000}
bank=bytearray(4096)
struct.pack_into('<I',bank,0,len(sounds))
for i,(sid,blob) in enumerate(sorted(sounds.items())):
    rate,length=struct.unpack_from('<II',blob)
    encoded=adpcm(blob[8:8+length])
    struct.pack_into('<4I',bank,4+i*16,sid,len(bank)-4096,len(encoded),rate*4096//44100)
    bank.extend(encoded)
assert len(bank)<512*1024-0x1010
while len(bank)%2048:bank.append(0)
(ROOT/'build').mkdir(exist_ok=True)
art=(ROOT/'assets/story.rgb332').read_bytes()
assert len(art)==4*160*70
(ROOT/'build/intro_art.h').write_text('static const unsigned char intro_art[] = {\n'+
    '\n'.join(','.join(str(n) for n in art[i:i+32])+',' for i in range(0,len(art),32))+'\n};\n')
(ROOT/'build/SOUND.BNK').write_bytes(bank)
textures,first,flats,firstflat=struct.unpack_from('<4I',resources[1])
def indexed(pixels):
    return bytes(palette_index[p] for (p,) in struct.iter_unpack('<H',pixels))
# Sprite groups have a frame offset directory, then shared patches / rotations.
def sprite(blob, convert=indexed):
    frames=(struct.unpack_from('<I',blob)[0]&0x3fffffff)//4
    out=bytearray(frames*4); mapped={}
    def patch(offset):
        if offset in mapped:return mapped[offset]
        while len(out)%4:out.append(0)
        dest=len(out);mapped[offset]=dest
        w,h=struct.unpack_from('<HH',blob,offset+4)
        out.extend(blob[offset:offset+8]);out.extend(convert(blob[offset+8:offset+8+w*h*2]))
        return dest
    def rotation(base):
        if base in mapped:return mapped[base]
        while len(out)%4:out.append(0)
        dest=len(out);mapped[base]=dest;out.extend(bytes(32))
        for i in range(8):
            entry=struct.unpack_from('<I',blob,base+i*4)[0]
            target=patch(base+(entry&0x7fffffff))
            struct.pack_into('<I',out,dest+i*4,(target-dest)|(entry&0x80000000))
        return dest
    for i in range(frames):
        entry=struct.unpack_from('<I',blob,i*4)[0]
        target=rotation(entry&0x3fffffff) if entry&0x40000000 else patch(entry)
        struct.pack_into('<I',out,i*4,target|(entry&0x40000000))
    return out
# Determine the sprite range directly from the copied resource enum.
import re
text=re.sub(r'/\*.*?\*/|//[^\n]*','',(ROOT/'source/doomrez.h').read_text(),flags=re.S)
ids={'rTEXTURE1':1}
for body in re.findall(r'enum\s*\{(.*?)\}',text,re.S):
    value=0
    for item in body.split(','):
        if not item.strip():continue
        parts=item.strip().split('=');name=parts[0].strip()
        if len(parts)>1:value=sum(int(t) if t.strip().isdigit() else ids[t.strip()] for t in parts[1].split('+'))
        ids[name]=value;value+=1
sprite_ids={v for k,v in ids.items() if k.startswith('rSPR_')}
histogram=Counter()
def collect(pixels):
    histogram.update(p for (p,) in struct.iter_unpack('<H',pixels))
    return bytes(len(pixels)//2)
for rid,blob in resources.items():
    if first<=rid<first+textures:
        collect(blob[4:])
    elif firstflat<=rid<firstflat+flats:collect(blob)
    elif rid in sprite_ids:sprite(blob,collect)
palette,palette_index=make_palette(histogram)
(ROOT/'build/asset_palette.h').write_text('static const uint16_t asset_palette[256] = {\n'+
    '\n'.join(','.join(hex(n) for n in palette[i:i+16])+',' for i in range(0,256,16))+'\n};\n')
for rid,blob in list(resources.items()):
    if first<=rid<first+textures:
        # Preserve the original area-filtered mip chain for distant surfaces.
        resources[rid]=blob[:4]+indexed(blob[4:])
    elif firstflat<=rid<firstflat+flats:resources[rid]=indexed(blob)
    elif rid in sprite_ids:resources[rid]=sprite(blob)
    elif rid>=1000:del resources[rid] # Audio is a separate PS1 SPU bank.
    elif ids['rMAP01']+10<=rid<ids['rMAP01']+240:del resources[rid]
output=bytearray(16384)
struct.pack_into('<4sII',output,0,b'G1PS',1,len(resources))
for i,(rid,blob) in enumerate(sorted(resources.items())):
    while len(output)%2048:output.append(0)
    struct.pack_into('<III',output,12+i*12,rid,len(output),len(blob));output.extend(blob)
while len(output)%2048:output.append(0)
(ROOT/'build').mkdir(exist_ok=True)
(ROOT/'build/GRIDFALL.DAT').write_bytes(output)
print('PS1 resources:',len(resources),'disc bytes:',len(output))
