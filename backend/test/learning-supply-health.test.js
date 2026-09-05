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
