const test=require('node:test');
const assert=require('node:assert/strict');
const {issueSenseSelection,selectedEntries}=require('../dictionary-selection');
const sense={definition:'a financial institution',cnMeaning:'银行',partOfSpeech:'noun'};
const config={secret:'test-only-sense-key',now:1000};
test('only offered senses can be saved, with user spelling expiry and tamper checks',()=>{
 const selectionToken=issueSenseSelection('Bank',sense,'Student',config);
 const entry={word:'bank',selectionToken};
 assert.deepEqual(selectedEntries('student',[entry,entry],config),[{word:'bank',meaning:sense.definition,cnMeaning:'银行',POS:'noun'}]);
 for(const invalid of [{word:'bank'},{...entry,word:'course'},{...entry,cnMeaning:'原因'},{...entry,meaning:'invented'},{...entry,selectionToken:selectionToken+'x'}])assert.throws(()=>selectedEntries('student',[invalid],config),{code:'SELECTED_SENSE_REQUIRED'});
 assert.throws(()=>selectedEntries('other',[entry],config),{code:'SELECTED_SENSE_REQUIRED'});
 assert.throws(()=>selectedEntries('student',[entry],{...config,now:86402000}),{code:'SELECTED_SENSE_REQUIRED'});
 assert.throws(()=>selectedEntries('student',[entry,{word:'course'}],config),{code:'SELECTED_SENSE_REQUIRED'});
});

test('production selection receipts never fall back to the public development key',()=>{
 const keys=['NODE_ENV','WORDBOT_SESSION_SECRET','WORDBOT_ADMIN_TOKEN'];
 const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 try {
  process.env.NODE_ENV='production';delete process.env.WORDBOT_SESSION_SECRET;delete process.env.WORDBOT_ADMIN_TOKEN;
  assert.throws(()=>issueSenseSelection('bank',sense,'student'),{code:'SELECTION_SIGNING_NOT_CONFIGURED'});
 }finally{for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
});
