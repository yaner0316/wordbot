const test = require('node:test');
const assert = require('node:assert/strict');
const { getLearningSupplyHealth } = require('../runtime-health');
test('old queue remains degraded immediately after a worker restart', () => {
 const result=getLearningSupplyHealth({ok:true,status:'never_succeeded',eligibleDueCount:101},{alerts:{oldestPendingOverThreshold:true},counts:{failed:7}});
 assert.equal(result.ok,false);assert.equal(result.status,'backlog_overdue');
});
test('new worker with pending work is warming up, empty queue can be ready',()=>{
 assert.equal(getLearningSupplyHealth({ok:true,status:'never_succeeded',eligibleDueCount:1},{}).ok,false);
 assert.equal(getLearningSupplyHealth({ok:true,status:'idle',eligibleDueCount:0},{counts:{failed:0}}).ok,true);
});

test('invalid blocked data keeps learning supply degraded when the worker has no claimable jobs', () => {
 const result = getLearningSupplyHealth({ok:true,status:'idle',eligibleDueCount:0}, {counts:{pending:0,retrying:1,failed:0,blockedInvalidWord:10},alerts:{oldestPendingOverThreshold:false}});
 assert.deepEqual(result, {ok:false,status:'invalid_data_blocked'});
});
