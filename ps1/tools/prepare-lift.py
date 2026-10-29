from pathlib import Path
import json,sys
root=Path(__file__).resolve().parents[1]
compiler=Path(sys.argv[1]).resolve()
driver=root/'build'/'lift-driver'
(driver/'src').mkdir(parents=True,exist_ok=True)
(driver/'src'/'main.rs').write_bytes((root/'tools'/'lift.rs').read_bytes())
manifest='[workspace]\n\n[package]\nname="gridfall-psxw"\nversion="0.1.0"\nedition="2024"\n[dependencies]\nserde_json="1.0"\n'
for crate in ['psxw-lift','psxw-inputs']:
    manifest+=crate+'={path='+json.dumps(str(compiler/'crates'/crate))+'}\n'
(driver/'Cargo.toml').write_text(manifest)
