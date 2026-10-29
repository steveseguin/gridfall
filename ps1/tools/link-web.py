"""Link psxw's translated MIPS functions with the browser hardware boundary."""
from pathlib import Path
import hashlib,json,re,subprocess,sys

root=Path(__file__).resolve().parents[1]
build=root/'build';lifted=build/'lifted';web=root/'web'
web.mkdir(exist_ok=True)
meta=json.loads((build/'manifest.json').read_text())
functions=json.loads((lifted/'functions.json').read_text())
symbols={}
for line in (build/'gridfall.sym').read_text().splitlines():
    parts=line.split()
    if len(parts)==3: symbols[parts[2]]=int(parts[0],16)&0xffffffff

# Console I/O is the platform boundary. The engine, renderer, C library and
# compiler arithmetic helpers execute the code lifted from the PS-X EXE.
boundary={'ps1_fatal','ps1_read','ps1_sound','ps1_stop_sound'}
library={'__divdi3','__udivdi3','InitHeap','sbrk','TrackHeapUsage','malloc','calloc','free',
         'memset','abs','toupper','memcpy','memcmp','strcpy','strcmp','strchr','strlen','strcat'}
selected=[f for f in functions if f['address']<symbols['ps1_fatal'] or f['name'] in library|boundary]
by_address={f['address']:f for f in functions}
for f in selected:
    if f['name'] in boundary:continue
    for ext in f['externs']:
        match=re.fullmatch(r'psxw_f_([0-9A-Fa-f]{8})',ext)
        if match:
            dependency=by_address[int(match[1],16)]
            if dependency not in selected:selected.append(dependency)
names={f['name']:f for f in selected}
assert boundary<=names.keys()
header=(lifted/'psxw_rt.h').read_text()
header=header.replace('/* psx-wasm:', '#pragma once\nextern unsigned char psxw_ram[];\n/* psx-wasm:',1)
header=header.replace('(uint32_t)(a)', '(psxw_ram + ((uint32_t)(a) & 0x1fffffu))')
(build/'psxw_rt.h').write_text(header)
c=['#include "psxw_rt.h"']
for f in selected:
    addr=f['address'];c.append(f'#define psxw_f_{addr:08X} {f["cname"]}')
    c.append(f'uint64_t {f["cname"]}(uint32_t,uint32_t,uint32_t,uint32_t);')
for f in selected:
    if f['name'] not in boundary:
        c.append((lifted/f'{f["address"]:08x}.c').read_text())
c.append('''
unsigned char psxw_ram[0x200000] __attribute__((aligned(16)));
static uint32_t guest_sp=0x801fff00,guest_gp,chain;
uint32_t psxw_sp_get(void){return guest_sp;}
void psxw_sp_set(uint32_t n){guest_sp=n;}
uint32_t psxw_gp_get(void){return guest_gp;}
void psxw_gp_set(uint32_t n){guest_gp=n;}
uint32_t psxw_chain_get(void){return chain;}
void psxw_chain_set(uint32_t n){chain=n;}
__attribute__((import_module("host"),import_name("fatal"),noreturn)) void host_fatal(uint32_t,uint32_t);
__attribute__((import_module("host"),import_name("read"))) void host_read(uint32_t,uint32_t,uint32_t);
__attribute__((import_module("host"),import_name("sound"))) void host_sound(uint32_t,uint32_t);
void psxw_trap_overflow(uint32_t pc){host_fatal(0,pc);}
void psxw_bad_jump(uint32_t pc,uint32_t target){host_fatal(pc,target);}
void __psxw_break(int code){host_fatal(0,code);}
''')
adapters={
 'ps1_fatal':'host_fatal(a0,a1);',
 'ps1_read':'host_read(a0,(uint32_t)(psxw_ram+(a1&0x1fffff)),a2);return 0;',
 'ps1_sound':'host_sound(a0,1);return 0;',
 'ps1_stop_sound':'host_sound(a0,0);return 0;'
}
for name,body in adapters.items():
    c.append(f'uint64_t {names[name]["cname"]}(uint32_t a0,uint32_t a1,uint32_t a2,uint32_t a3){{{body}}}')
c.append('uint64_t psxw_call_indirect(uint32_t addr,uint32_t a,uint32_t b,uint32_t c,uint32_t d){switch(addr){')
for f in selected:c.append(f'case 0x{f["address"]:08x}u:return {f["cname"]}(a,b,c,d);')
c.append('default:host_fatal(0,addr);}}')
c.append('__attribute__((export_name("call"))) uint32_t call(uint32_t addr,uint32_t a,uint32_t b,uint32_t c,uint32_t d){return psxw_call_indirect(addr,a,b,c,d);}')
c.append('__attribute__((export_name("ram_address"))) uint32_t ram_address(void){return (uint32_t)psxw_ram;}')
c.append(f'__attribute__((export_name("initialize"))) void initialize(void){{guest_gp=0x{symbols["_gp"]:08x}u;{names["InitHeap"]["cname"]}(0x{symbols["_end"]:08x}u,0x{0x801f0000-symbols["_end"]:x},0,0);}}')
(build/'translated.c').write_text('\n'.join(c))
compiler=sys.argv[1]
subprocess.run([compiler,'--target=wasm32','-std=c11','-O2','-ffreestanding','-nostdlib','-fno-strict-aliasing',
 '-Wno-unused-label','-Wl,--no-entry,--export-memory,--initial-memory=4194304,--max-memory=4194304,--threads=1',
 str(build/'translated.c'),'-o',str(web/'gridfall.wasm')],check=True)
for name in ['gridfall.exe','GRIDFALL.DAT','SOUND.BNK']:(web/name).write_bytes((build/name).read_bytes())
exposed=['doom_init','doom_start','doom_step','doom_render_lerp','doom_state','doom_weapon','doom_intro','directory_buffer',
         'forwardmove','sidemove','palette','PadAttack','PadUse','PadSpeed']
report={'compiler':'psxw-lift','compiler_revision':'40d0989cf222ae2a2912def47bc64a2cece2632b',
        'translated_functions':len(functions),'linked_functions':len(selected)-len(boundary),
        'platform_adapters':sorted(boundary),'symbols':{n:symbols[n] for n in exposed},
        'sha256':{n:hashlib.sha256((web/n).read_bytes()).hexdigest() for n in ['gridfall.exe','gridfall.wasm','GRIDFALL.DAT','SOUND.BNK']}}
(web/'build.json').write_text(json.dumps(report,indent=2)+'\n')
print('Linked',report['linked_functions'],'PS1-translated functions into',web/'gridfall.wasm')
