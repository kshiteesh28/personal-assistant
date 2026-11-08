export function hashFeature(text) { let h=2166136261; for(const b of Buffer.from(text,'utf8')) h=Math.imul(h^b,16777619)>>>0; return h; }
export function extractFeatures(text,context={}) {
 const tokens=String(text).normalize('NFC').toLowerCase().replace(/[’‘]/gu,"'").match(/<[a-z_]+>|[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu)??[];
 const limited=tokens.slice(0,64), emissions=[];
 for(const key of ['pendingField','lastEntityType','negated','question','correction']) if(context[key]) emissions.push(`x:${key}:${String(context[key]).slice(0,32)}`);
 emissions.push(...limited.map(t=>`w:${t}`));
 for(let i=1;i<limited.length;i++) emissions.push(`b:${limited[i-1]} ${limited[i]}`);
 for(const token of limited) { if(token.startsWith('<'))continue; const scalars=Array.from(token).slice(0,12); for(let i=0;i+2<scalars.length;i++) emissions.push(`c:${scalars.slice(i,i+3).join('')}`); }
 const items=new Map(); let order=0;
 for(const feature of emissions){const hash=hashFeature(feature), index=1+hash%4095, sign=(hash>>>31)?-1:1; const item=items.get(index); if(item)item.count+=sign; else items.set(index,{index,count:sign,order:order++});}
 const retained=[...items.values()].filter(x=>x.count!==0).slice(0,127).sort((a,b)=>a.index-b.index);
 const indices=Uint16Array.from([0,...retained.map(x=>x.index)]),counts=Int8Array.from([1,...retained.map(x=>Math.max(-3,Math.min(3,x.count)))]);
 return {...normalizeCounts(indices,counts),counts,truncated:tokens.length>64};
}
export function validateVector({indices,values}) {
 if(!(indices instanceof Uint16Array)||!(values instanceof Float32Array)||indices.length!==values.length||indices.length<1||indices.length>128||indices[0]!==0)throw new Error('Invalid sparse vector');
 let norm=0;for(let i=0;i<indices.length;i++){if(indices[i]>=4096||(i&&indices[i]<=indices[i-1])||!Number.isFinite(values[i])||Math.abs(values[i])>1)throw new Error('Invalid sparse entry');norm+=values[i]*values[i];}if(Math.abs(norm-1)>1e-4)throw new Error('Invalid sparse norm');
}
export function normalizeCounts(indices,counts){let norm=0;for(const c of counts)norm+=c*c; norm=Math.sqrt(norm);return {indices:Uint16Array.from(indices),values:Float32Array.from(counts,c=>Math.fround(c/norm))};}
export function encodeFeatures(vector){const {indices,counts}=vector;if(!counts||indices.length!==counts.length||indices.length<1||indices.length>128||indices[0]!==0||counts[0]!==1)throw new Error('Invalid feature counts');const bytes=[1,indices.length&255,indices.length>>>8];let prev=0;for(let i=0;i<indices.length;i++){const id=indices[i],c=counts[i];if(!Number.isInteger(id)||id<0||id>=4096||(i&&id<=prev)||!Number.isInteger(c)||c===0||Math.abs(c)>3)throw new Error('Invalid feature counts');let delta=id-prev;do{const b=delta&127;delta>>>=7;bytes.push(b|(delta?128:0));}while(delta);bytes.push(c&255);prev=id;}const out=Buffer.from(bytes);if(out.length>512)throw new Error('Features exceed budget');return out;}
export function decodeFeatures(input){const b=Buffer.from(input);if(b.length<5||b.length>512||b[0]!==1)throw new Error('Invalid feature codec');const count=b.readUInt16LE(1);if(count<1||count>128)throw new Error('Invalid feature count');let p=3,prev=0;const ids=[],counts=[];for(let i=0;i<count;i++){let delta=0,shift=0,byte,n=0;do{if(p>=b.length||n++>=2)throw new Error('Invalid feature varint');byte=b[p++];delta|=(byte&127)<<shift;shift+=7;}while(byte&128);if(n>1&&(byte&127)===0)throw new Error('Noncanonical varint');const id=prev+delta;if(p>=b.length||id>=4096||(i&&id<=prev))throw new Error('Invalid feature id');const c=b.readInt8(p++);if(c===0||Math.abs(c)>3||(i===0&&(id!==0||c!==1)))throw new Error('Invalid feature value');ids.push(id);counts.push(c);prev=id;}if(p!==b.length)throw new Error('Trailing feature bytes');return {...normalizeCounts(ids,counts),counts:Int8Array.from(counts)};}
