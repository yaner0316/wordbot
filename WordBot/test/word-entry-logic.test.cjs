const test=require('node:test'),assert=require('node:assert/strict');
const {parseEntryWords,selectedEntryPayload}=require('../word-entry-logic');
test('batch keeps phrases and rejects handwritten glosses',()=>{
 assert.deepEqual(parseEntryWords('Bank\nlook after, bank'),['bank','look after']);
 for(const input of ['bank | 银行','原因',''])assert.throws(()=>parseEntryWords(input));
});
test('every word needs a selected issued sense and only receipts leave the client',()=>{
 const items=[{word:'bank',senses:[{selectionToken:'one',cnMeaning:'手改'}],selected:[0]},{word:'course',senses:[],selected:[]}];
 assert.throws(()=>selectedEntryPayload(items),/course/);
 assert.deepEqual(selectedEntryPayload(items.slice(0,1)),[{word:'bank',selectionToken:'one'}]);
});
