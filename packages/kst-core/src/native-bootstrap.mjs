import {decodeStrictJSON} from './wire-json.mjs';
// Only the supervised launch receives this one-shot private pipe. Never log it.
export async function readNativeBootstrap(input=process.stdin,{timeoutMs=1000}={}) {
 if(input.isTTY)return null;
 return new Promise(resolve=>{
  let chunks=[],size=0,settled=false;
  const done=value=>{if(settled)return;settled=true;clearTimeout(timer);input.off('data',data);input.off('end',end);input.off('error',end);input.pause();resolve(value);};
  const end=()=>{try{const v=decodeStrictJSON(Buffer.concat(chunks));if(v.schemaVersion===1&&typeof v.socketPath==='string'&&v.socketPath.startsWith('/private/tmp/kst-')&&Buffer.byteLength(v.socketPath)<=103&&typeof v.capability==='string'&&v.capability.length>=32&&v.capability.length<=128&&Object.keys(v).every(k=>['schemaVersion','socketPath','capability'].includes(k)))return done(v);}catch{}done(null);};
  const data=part=>{const bytes=Buffer.from(part);size+=bytes.length;if(size>4096)return done(null);chunks.push(bytes);if(bytes.includes(10))end();};
  const timer=setTimeout(()=>done(null),timeoutMs);input.on('data',data);input.on('end',end);input.on('error',end);input.resume();
 });
}
