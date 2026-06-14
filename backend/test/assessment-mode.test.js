const test = require('node:test');
const assert = require('node:assert/strict');

const {
    ASSESSMENT_MODE,
    createAssessmentId,
    filterAssessmentRecords,
    getAssessmentMode,
    isRealAssessment,
    isTestAssessment,
    normalizeAssessmentMode,
    shouldAffectLearningState,
} = require('../assessment-mode');

test('legacy quiz ids are treated as real learning data', () => {
    assert.equal(getAssessmentMode('a1b2c3d4'), ASSESSMENT_MODE.REAL);
    assert.equal(isRealAssessment('a1b2c3d4'), true);
});

test('test quiz ids are classified as test data', () => {
    assert.equal(getAssessmentMode('test-a1b2c3d4'), ASSESSMENT_MODE.TEST);
    assert.equal(isTestAssessment('test-a1b2c3d4'), true);
});

test('review ids retain their real or test assessment mode', () => {
    assert.equal(getAssessmentMode('real-review-r1'), ASSESSMENT_MODE.REAL);
    assert.equal(getAssessmentMode('test-review-r1'), ASSESSMENT_MODE.TEST);
    assert.equal(isTestAssessment('test-review-r1'), true);
});

test('assessment ids include an explicit mode prefix', () => {
    assert.match(createAssessmentId('real', () => 'abcd1234'), /^real-abcd1234$/);
    assert.match(createAssessmentId('test', () => 'abcd1234'), /^test-abcd1234$/);
});

test('invalid assessment modes are rejected', () => {
    assert.throws(
        () => normalizeAssessmentMode('preview'),
        /考核模式只能是 real 或 test/
    );
});

test('real-data filtering includes legacy ids and excludes test ids', () => {
    const records = [
        { fields: { test_id: 'legacy123' } },
        { fields: { test_id: 'real-abcd1234' } },
        { fields: { test_id: 'test-abcd1234' } },
    ];

    assert.deepEqual(
        filterAssessmentRecords(records, ASSESSMENT_MODE.REAL),
        records.slice(0, 2)
    );
});

test('test-data filtering selects only explicitly tagged test ids', () => {
    const records = [
        { fields: { test_id: 'legacy123' } },
        { fields: { test_id: 'test-abcd1234' } },
    ];

    assert.deepEqual(
        filterAssessmentRecords(records, ASSESSMENT_MODE.TEST),
        [records[1]]
    );
});

test('only real assessments may update learning state', () => {
    assert.equal(shouldAffectLearningState('legacy123'), true);
    assert.equal(shouldAffectLearningState('real-abcd1234'), true);
    assert.equal(shouldAffectLearningState('test-abcd1234'), false);
});
