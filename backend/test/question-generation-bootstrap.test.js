'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_QUESTION_GENERATION_ATTEMPTS,
    DEFAULT_QUESTION_WORKER_MAX_ATTEMPTS,
    DEFAULT_QUESTION_WORKER_BATCH_SIZE,
    DEFAULT_QUESTION_WORKER_LEASE_MS,
} = require('../question-generation-bootstrap');

test('worker defaults claim one job with a fifteen-minute lease', () => {
    assert.equal(DEFAULT_QUESTION_WORKER_BATCH_SIZE, 1);
    assert.equal(DEFAULT_QUESTION_WORKER_LEASE_MS, 15 * 60 * 1000);
});

test('worker retries durable jobs across the cooling window without repeating a full build inside one lease', () => {
    assert.equal(DEFAULT_QUESTION_WORKER_MAX_ATTEMPTS, 20);
    assert.equal(DEFAULT_QUESTION_GENERATION_ATTEMPTS, 1);
});
