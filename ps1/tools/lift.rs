use std::{collections::BTreeMap, fs};
use psxw_lift::program::{Program, Code, Source};
use psxw_inputs::originals::Originals;
fn main() {
    let args:Vec<String>=std::env::args().collect();
    let exe=fs::read(&args[1]).unwrap();
    let meta:serde_json::Value=serde_json::from_slice(&fs::read(&args[2]).unwrap()).unwrap();
    let word=|n|u32::from_le_bytes(exe[n..n+4].try_into().unwrap());
    let base=word(0x18);let size=word(0x1c);
    let end=meta["text_end"].as_u64().unwrap() as u32;
    let code=Code{id:"exe".into(),text:vec![base..end],data:vec![end..base+size],starts:BTreeMap::new()};
    let mut program=Program{main:"exe".into(),containers:BTreeMap::from([("exe".into(),code)])};
    for func in meta["functions"].as_array().unwrap(){
        let addr=func["address"].as_u64().unwrap() as u32;
        if addr>=base && addr<end {
            program.add("exe",addr,func["name"].as_str(),Source::Symbol,true);
            let size=func["size"].as_u64().unwrap() as u32;
            if size>0 {program.containers.get_mut("exe").unwrap().starts.get_mut(&addr).unwrap().size=Some(size);}
        }
    }
    program.add("exe",word(0x10),Some("entry"),Source::Entry,true);
    let originals=Originals::from_images(vec![("exe".into(),base,exe[2048..2048+size as usize].to_vec())]);
    let result=psxw_lift::translate_all(&mut program,&originals,&["exe".into()]);
    println!("Translated {} functions; {} failures; {} rounds",result.ok.len(),result.failed.len(),result.rounds);
    for (f,e) in &result.failed {println!("{} {:08x}: {:?}",f.name,f.addr,e);}
    let output=std::path::Path::new(&args[3]);fs::create_dir_all(output).unwrap();
    fs::write(output.join("psxw_rt.h"),psxw_lift::RT_HEADER).unwrap();
    let mut translated=Vec::new();
    for t in result.ok {
        translated.push(serde_json::json!({"address":t.func.addr,"name":t.func.name,"cname":t.cname,"externs":t.externs}));
        let mut c=format!("#include \"psxw_rt.h\"\n");
        for n in t.externs {c+=&format!("uint64_t {n}(uint32_t,uint32_t,uint32_t,uint32_t);\n");}
        c+=&t.c;
        fs::write(output.join(format!("{:08x}.c",t.func.addr)),c).unwrap();
    }
    fs::write(output.join("functions.json"),serde_json::to_vec_pretty(&translated).unwrap()).unwrap();
    if !result.failed.is_empty(){std::process::exit(1);}
}
