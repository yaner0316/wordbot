'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    DEFAULT_QUESTION_WORKER_BATCH_SIZE,
    DEFAULT_QUESTION_WORKER_LEASE_MS,
} = require('../question-generation-bootstrap');

test('worker defaults claim one job with a fifteen-minute lease', () => {
    assert.equal(DEFAULT_QUESTION_WORKER_BATCH_SIZE, 1);
    assert.equal(DEFAULT_QUESTION_WORKER_LEASE_MS, 15 * 60 * 1000);
});
