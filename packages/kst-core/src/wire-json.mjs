import {Fault} from './engine.mjs';

// JSON.parse alone silently accepts duplicate properties and UTF-8 replacement.
export function decodeStrictJSON(bytes) {
  let text,value;
  try { text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);value=JSON.parse(text); }
  catch { throw new Fault('INVALID_JSON','Malformed JSON or invalid UTF-8.'); }
  let i=0;
  const space=()=>{while(/\s/.test(text[i]??'')&&i<text.length)i++;};
  const string=()=>{const start=i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}return JSON.parse(text.slice(start,i));};
  const scan=(depth)=>{
    if(depth>64)throw new Fault('INVALID_JSON','JSON nesting exceeds the supported depth.');
    space();const c=text[i];
    if(c==='"'){string();return;}
    if(c==='{'){
      i++;space();const keys=new Set();if(text[i]==='}'){i++;return;}
      while(i<text.length){space();const key=string();if(keys.has(key))throw new Fault('INVALID_JSON','Duplicate JSON properties are not allowed.');keys.add(key);space();i++;scan(depth+1);space();if(text[i++]==='}')return;}
    }else if(c==='['){
      i++;space();if(text[i]===']'){i++;return;}
      while(i<text.length){scan(depth+1);space();if(text[i++]===']')return;}
    }else{const start=i;while(i<text.length&&!/[\s,\]}]/.test(text[i]))i++;const token=text.slice(start,i);if(/^-?[0-9]/.test(token)&&!Number.isFinite(Number(token)))throw new Fault('INVALID_JSON','JSON numbers must be finite.');}
  };
  scan(0);return value;
}
