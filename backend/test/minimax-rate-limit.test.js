const test=require('node:test'),assert=require('node:assert/strict');
const {auditUniqueAnswer}=require('../question-semantic-audit');
const {generateSupabaseDistractors}=require('../supabase-distractors');
const {generateReplacementContextWithAI,buildCacheQuestionRowsForWord}=require('../supabase-data');
test('HTTP 200 Token Plan rejection stops each model stage after one request',async()=>{
 const previousFetch=global.fetch,previousKey=process.env.MINIMAX_API_KEY;process.env.MINIMAX_API_KEY='test-only';let calls=0;
 global.fetch=async()=>{calls++;return {ok:true,json:async()=>({base_resp:{status_code:2062,status_msg:'Token Plan rate limit'},usage:{total_tokens:0}})};};
 try{for(const operation of [()=>auditUniqueAnswer({context:'He plays _____.',options:['A. guitar','B. drum','C. flute','D. piano'],answer:'A'}),()=>generateReplacementContextWithAI('guitar','吉他','高中',''),()=>generateSupabaseDistractors({word:'guitar',meaning:'吉他',context:'He plays _____.'})]){calls=0;await assert.rejects(operation(),e=>e.code==='MINIMAX_RATE_LIMITED');assert.equal(calls,1);}}
 finally{global.fetch=previousFetch;if(previousKey===undefined)delete process.env.MINIMAX_API_KEY;else process.env.MINIMAX_API_KEY=previousKey;}
});
test('candidate retries do not turn a provider rate limit into more generation calls',async()=>{
 for(const failingStage of ['context','distractors']){let calls=0;const fail=async()=>{calls++;throw Object.assign(new Error('provider limited'),{code:'MINIMAX_RATE_LIMITED'});};
 await assert.rejects(buildCacheQuestionRowsForWord({user:{id:'user'},word:{id:'word',user_id:'user',word:'guitar',meaning_zh:'吉他',context_en:failingStage==='context'?'':'He plays guitar at home.'},level:'高中',generateContext:failingStage==='context'?fail:async()=>'',generateDistractors:fail,translateWords:async()=>({})}),e=>e.code==='MINIMAX_RATE_LIMITED');assert.equal(calls,1);}
});
test('HTTPS translation preserves an HTTP 200 rate-limit envelope without malformed-response retries',async()=>{
 const https=require('node:https'),{EventEmitter}=require('node:events'),{translateSupabaseWords}=require('../supabase-translations');
 const priorRequest=https.request,priorKey=process.env.MINIMAX_API_KEY;process.env.MINIMAX_API_KEY='test-only';let calls=0;
 https.request=(_options,onResponse)=>{calls++;const req=new EventEmitter();req.write=()=>{};req.end=()=>process.nextTick(()=>{const res=new EventEmitter();res.statusCode=200;onResponse(res);res.emit('data',Buffer.from(JSON.stringify({base_resp:{status_code:2062}})));res.emit('end');req.emit('close');});return req;};
 try{await assert.rejects(translateSupabaseWords(['guitar']),e=>e.code==='MINIMAX_RATE_LIMITED');assert.equal(calls,1);}
 finally{https.request=priorRequest;if(priorKey===undefined)delete process.env.MINIMAX_API_KEY;else process.env.MINIMAX_API_KEY=priorKey;}
});
