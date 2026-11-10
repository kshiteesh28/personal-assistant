import { predict } from './model.mjs';

// Personal training may disable an automatic class; it may never relax seed floors.
export function preserveAutomaticPolicy(candidate,seed,gates,predictor=predict) {
  const policies=seed.policies.map(p=>({...p}));
  const counts=Array.from({length:27},()=>({accepted:0,correct:0}));
  for(const r of gates){const p=predictor(candidate,r.features),label=p.top[0].label,rule=policies[label];
    if(!rule.automaticEnabled||p.top[0].score-rule.scoreFloor<=1e-4||p.margin-rule.marginFloor<=1e-4)continue;
    counts[label].accepted++;if(r.label===label)counts[label].correct++;
  }
  for(let label=0;label<27;label++){const c=counts[label];if(policies[label].automaticEnabled&&(c.accepted<10||c.correct/c.accepted<.98))policies[label].automaticEnabled=false;}
  const accepted=counts.reduce((n,c,i)=>n+(policies[i].automaticEnabled?c.accepted:0),0);
  if(accepted<100)for(const p of policies)p.automaticEnabled=false;
  let changes=0;for(let label=0;label<32;label++){if(Boolean(candidate.policies[label]?.automaticEnabled)!==Boolean(policies[label].automaticEnabled))changes++;}
  candidate.policies=policies;return {disabledClasses:policies.slice(0,27).filter((p,i)=>seed.policies[i].automaticEnabled&&!p.automaticEnabled).length,policyChanges:changes};
}
