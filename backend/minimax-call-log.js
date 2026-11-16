'use strict';
// Process-local diagnostic metadata only. Never accept prompts, identities or bodies.
const since=new Date().toISOString(),recent=[];
let started=0,completed=0,failed=0,tokens=0;
const safe=value=>/^[a-zA-Z0-9_-]{1,80}$/.test(String(value||''))?String(value):'unknown';
const numeric=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):null;
function startMiniMaxCall(stage,model){
 const begin=Date.now(),row={id:++started,startedAt:new Date(begin).toISOString(),stage:safe(stage),model:safe(model),httpStatus:null,providerCode:null,tokens:0};let done=false;
 const emit=data=>{try{console.log(JSON.stringify({event:'minimax_call',...data}));}catch{}};
 emit({...row,status:'started'});
 return {
  http(status){row.httpStatus=numeric(status);},
  payload(p){row.providerCode=numeric(p?.base_resp?.status_code);row.tokens=numeric(p?.usage?.total_tokens)||0;},
  finish(error){if(done)return;done=true;completed++;if(error)failed++;tokens+=row.tokens;const entry={...row,endedAt:new Date().toISOString(),elapsedMs:Date.now()-begin,status:error?'failed':'completed',errorCode:error?safe(error.code||error.name):null};recent.push(entry);if(recent.length>30)recent.shift();emit(entry);},
 };
}
function getMiniMaxCallSummary(){return {since,started,completed,failed,inFlight:started-completed,tokens,recent:recent.map(row=>({...row}))};}
module.exports={startMiniMaxCall,getMiniMaxCallSummary};
