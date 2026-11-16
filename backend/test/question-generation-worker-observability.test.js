'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createQuestionGenerationWorker } = require('../question-generation-worker');

test('continuing rate limits keep one-minute probes rather than extending to five minutes',async()=>{
 let time=Date.parse('2026-11-16T00:00:00Z'),calls=0;const worker=createQuestionGenerationWorker({workerId:'probe',now:()=>new Date(time),jobStore:{claim:async()=>[{}],fail:async()=>{},complete:async()=>{}},generationService:{process:async()=>{calls++;throw Object.assign(new Error('limited'),{code:'MINIMAX_RATE_LIMITED'});}}});
 for(let i=0;i<4;i++){await worker.runOnce();assert.equal(calls,i+1);assert.equal(Date.parse(worker.getObservability().providerCooldownUntil)-time,60000);time+=30000;await worker.runOnce();assert.equal(calls,i+1);time+=30000;}
});

test('provider outage pauses claims across jobs and resumes automatically without discarding work',async()=>{
 let time=Date.parse('2026-11-15T16:00:00Z'),claims=0,attempts=0,failed=0,completed=0;
 const worker=createQuestionGenerationWorker({workerId:'worker',runImmediately:false,batchSize:1,now:()=>new Date(time),
  jobStore:{claim:async()=>{claims++;return [{id:'job'}];},fail:async()=>{failed++;},complete:async()=>{completed++;}},
  generationService:{process:async()=>{attempts++;if(attempts===1)throw Object.assign(new Error('overload'),{code:'MINIMAX_PROVIDER_OVERLOADED'});return {readyCount:2};}}});
 await worker.runOnce();assert.equal(failed,1);
 time+=5000;await worker.runOnce();assert.equal(claims,1);assert.equal(attempts,1);
 assert.equal(worker.getObservability().providerCooldownCode,'MINIMAX_PROVIDER_OVERLOADED');
 time+=60000;await worker.runOnce();assert.equal(claims,2);assert.equal(completed,1);
 assert.equal(worker.getObservability().providerCooldownUntil,undefined);
});

test('worker exposes attempts, claims, successful polls, and completed progress', async () => {
    const timestamp = '2026-08-14T00:00:00.000Z';
    const worker = createQuestionGenerationWorker({
        jobStore: {
            claim: async () => [{ id: 'job-1' }],
            complete: async () => {},
            fail: async () => {},
        },
        generationService: { process: async () => ({ readyCount: 2 }) },
        workerId: 'worker-a',
        runImmediately: false,
        now: () => timestamp,
        setIntervalFn: () => ({ id: 1 }),
        clearIntervalFn: () => {},
    });

    assert.deepEqual(worker.getObservability(), {
        startedAt: null,
        lastAttemptAt: null,
        lastClaimAt: null,
        lastSuccessAt: null,
        lastCompletionAt: null,
    });

    worker.start();
    await worker.runOnce();

    assert.deepEqual(worker.getObservability(), {
        startedAt: timestamp,
        lastAttemptAt: timestamp,
        lastClaimAt: timestamp,
        lastSuccessAt: timestamp,
        lastCompletionAt: timestamp,
    });
    await worker.stop();
});

test('successful empty polls do not fabricate claim or completion progress', async () => {
    const timestamp = '2026-08-14T00:00:00.000Z';
    const worker = createQuestionGenerationWorker({
        jobStore: {
            claim: async () => [],
            complete: async () => {},
            fail: async () => {},
        },
        generationService: { process: async () => ({ readyCount: 2 }) },
        workerId: 'worker-a',
        runImmediately: false,
        now: () => timestamp,
        setIntervalFn: () => ({ id: 1 }),
        clearIntervalFn: () => {},
    });

    worker.start();
    await worker.runOnce();

    assert.equal(worker.getObservability().lastAttemptAt, timestamp);
    assert.equal(worker.getObservability().lastSuccessAt, timestamp);
    assert.equal(worker.getObservability().lastClaimAt, null);
    assert.equal(worker.getObservability().lastCompletionAt, null);
    await worker.stop();
});
