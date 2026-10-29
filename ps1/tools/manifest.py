"""Export PS1 addresses and hashes for tools consuming the native build."""
from pathlib import Path
import hashlib,json,re,struct,subprocess,sys
root=Path(__file__).resolve().parents[1]
build=root/'build'
readelf=sys.argv[1]
elf=build/'gridfall.elf';exe=(build/'gridfall.exe').read_bytes()
assert exe[:8]==b'PS-X EXE'
sections=subprocess.check_output([readelf,'-SW',str(elf)],text=True)
match=re.search(r'\]\s+\.text\s+PROGBITS\s+([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)',sections)
assert match,'Missing ELF text section'
text_start,text_size=(int(v,16) for v in match.groups())
symbols=subprocess.check_output([readelf,'-sW',str(elf)],text=True)
functions=[]
for line in symbols.splitlines():
    parts=line.split()
    if len(parts)>=8 and parts[3]=='FUNC' and parts[6]!='UND':
        functions.append({'name':parts[7],'address':int(parts[1],16)&0xffffffff,'size':int(parts[2])})
functions.sort(key=lambda row:row['address'])
manifest={'title':'GRIDFALL PS1','platform':'PlayStation MIPS R3000A','sdk':'PSn00bSDK 0.24',
 'entry':struct.unpack_from('<I',exe,0x10)[0],'load_address':struct.unpack_from('<I',exe,0x18)[0],
 'text_start':text_start,'text_end':text_start+text_size,'functions':functions,
 'sha256':{name:hashlib.sha256((build/name).read_bytes()).hexdigest() for name in ['gridfall.exe','gridfall.elf','gridfall.bin','gridfall.cue','GRIDFALL.DAT','SOUND.BNK']}}
(build/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(build/'gridfall.symbols.txt').write_text(symbols)
print('Exported',len(functions),'native function symbols and build hashes')
