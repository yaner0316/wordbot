const test=require('node:test'),assert=require('node:assert/strict');
test('call metadata records attempts, failures and usage without retaining prompt or provider content',()=>{
 const {startMiniMaxCall,getMiniMaxCallSummary}=require('../minimax-call-log');const before=getMiniMaxCallSummary();
 const call=startMiniMaxCall('stem_review','MiniMax-M3');call.http(200);call.payload({base_resp:{status_code:2062,status_msg:'secret'},choices:[{message:{content:'private text'}}],usage:{total_tokens:9}});call.finish(Object.assign(new Error('Bearer secret'),{code:'MINIMAX_RATE_LIMITED'}));call.finish();
 const after=getMiniMaxCallSummary();assert.equal(after.started,before.started+1);assert.equal(after.completed,before.completed+1);assert.equal(after.inFlight,before.inFlight);assert.equal(after.recent.at(-1).providerCode,2062);assert.equal(after.recent.at(-1).errorCode,'MINIMAX_RATE_LIMITED');assert.equal(after.recent.at(-1).tokens,9);assert.doesNotMatch(JSON.stringify(after),/private text|Bearer|secret/);
});
test('HTTP rejection from the real audit client is logged as failed, not completed',async()=>{
 const previous=global.fetch,key=process.env.MINIMAX_API_KEY;process.env.MINIMAX_API_KEY='test';global.fetch=async()=>({ok:false,status:529});
 try{await assert.rejects(require('../question-semantic-audit').auditStem({}),e=>e.code==='MINIMAX_PROVIDER_OVERLOADED');const row=require('../minimax-call-log').getMiniMaxCallSummary().recent.at(-1);assert.equal(row.status,'failed');assert.equal(row.httpStatus,529);assert.equal(row.errorCode,'MINIMAX_PROVIDER_OVERLOADED');}
 finally{global.fetch=previous;if(key===undefined)delete process.env.MINIMAX_API_KEY;else process.env.MINIMAX_API_KEY=key;}
});
