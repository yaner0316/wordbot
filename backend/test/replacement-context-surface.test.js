const test=require('node:test');
const assert=require('node:assert/strict');
const {generateReplacementContextWithAI}=require('../supabase-data');

async function generate(word,context){
 const previousFetch=global.fetch,previousKey=process.env.MINIMAX_API_KEY;
 process.env.MINIMAX_API_KEY='test-only';
 let calls=0;
 global.fetch=async()=>{calls++;return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({context})}}]})};};
 try{
  const result=await generateReplacementContextWithAI(word,'词义','中学','');
  assert.equal(calls,1,'one generation attempt must not add hidden model retries');
  return result;
 }finally{global.fetch=previousFetch;if(previousKey===undefined)delete process.env.MINIMAX_API_KEY;else process.env.MINIMAX_API_KEY=previousKey;}
}

test('replacement generation fills the requested base verb into a single model marker',async()=>{
 assert.equal(await generate('toss','Please __TARGET__ the coin upward to decide which team starts today.'),'Please toss the coin upward to decide which team starts today.');
});
test('replacement generation preserves the exact multiword selection',async()=>{
 assert.equal(await generate('take care of','We must __TARGET__ the injured bird until its wing heals.'),'We must take care of the injured bird until its wing heals.');
});
test('replacement generation rejects duplicate markers and extra target occurrences',async()=>{
 assert.equal(await generate('toss','Please __TARGET__ the ball and __TARGET__ the coin.'),'');
 assert.equal(await generate('toss','Please __TARGET__ the coin after a toss of the ball.'),'');
});
test('replacement generation still accepts literal target output and refuses inflected output',async()=>{
 assert.equal(await generate('toss','Please toss the coin upward to decide which team starts today.'),'Please toss the coin upward to decide which team starts today.');
 assert.equal(await generate('toss','The horse tossed its head as the rider pulled the reins.'),'');
});
