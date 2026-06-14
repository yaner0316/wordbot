const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeArticleContext,
    normalizeQuizArticleContexts,
} = require('../article-context');

test('normalizes an indefinite article before a quiz blank', () => {
    assert.equal(
        normalizeArticleContext('There has been a _____ increase.').text,
        'There has been a(n) _____ increase.'
    );
    assert.equal(
        normalizeArticleContext('It was an _____ opportunity.').text,
        'It was a(n) _____ opportunity.'
    );
});

test('leaves unrelated articles unchanged', () => {
    assert.equal(
        normalizeArticleContext('A student saw the _____.').text,
        'A student saw the _____.'
    );
});

test('normalizes final type-one contexts after any difficulty rewrite', () => {
    const questions = [
        { type: 1, context: 'There has been a _____ increase.' },
        { type: 2, context: 'a _____ increase' },
    ];

    normalizeQuizArticleContexts(questions);

    assert.equal(questions[0].context, 'There has been a(n) _____ increase.');
    assert.equal(questions[0].articleNormalized, true);
    assert.equal(questions[1].context, 'a _____ increase');
});
