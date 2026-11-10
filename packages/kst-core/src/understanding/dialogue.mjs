import {Fault} from '../engine.mjs';
export class Discussions{
 constructor(now=Date.now){this.now=now;this.contexts=new Map();}
 get(id){let c=this.contexts.get(id);if(!c){if(this.contexts.size>=8){const available=[...this.contexts.values()].filter(x=>['IDLE','RESULT'].includes(x.state)).sort((a,b)=>a.touched-b.touched);if(!available.length)throw new Fault('DISCUSSION_CAPACITY','Finish or stop an existing discussion first.',409);this.contexts.delete(available[0].id);}c={id,state:'IDLE',revision:0,generation:1,touched:this.now()};this.contexts.set(id,c);}if(c.expiresAt&&c.expiresAt<=this.now()&&c.state!=='DISPATCHING'){delete c.pendingRequest;delete c.question;delete c.choices;delete c.templateTarget;c.state='IDLE';c.revision++;}if(c.lastResult&&this.now()-c.lastResult.mentioned>300000)delete c.lastResult;return c;}
 transition(c,state,patch={}){const next={...c,...patch,state,revision:c.revision+1,touched:this.now()};if(Buffer.byteLength(JSON.stringify(next))>2048)throw new Fault('CONTEXT_CAPACITY','Discussion context is full. Start a new discussion.',409);Object.assign(c,next);return c;}
 stop(id){for(const c of this.contexts.values())if(!id||c.id===id){c.generation++;c.revision++;c.state='IDLE';delete c.pendingRequest;delete c.question;delete c.choices;delete c.templateTarget;delete c.lastResult;delete c.lastConfirmed;delete c.lastOperation;delete c.lastPlan;}}
}
