const test = require('node:test');
const assert = require('node:assert/strict');

const { generateElementaryTemplateContext, generateElementaryDefinition, generateElementaryDistractors } = require('../elementary-context');

function assertSingleOccurrence(context, word) {
    const matches = context.toLowerCase().match(new RegExp(`\\b${word}\\b`, 'g')) || [];
    assert.equal(matches.length, 1, context);
}

test('builds deterministic elementary fill-in contexts for young animal definitions', () => {
    const cases = [
        ['cub', 'A young fox.', 'The cub is a baby fox in this story.'],
        ['calf', 'A young cow or bull.', 'The calf is a baby cow on the farm.'],
        ['lamb', 'A young sheep.', 'The lamb is a baby sheep on the farm.'],
    ];
    for (const [word, meaning, expected] of cases) {
        const context = generateElementaryTemplateContext(word, meaning);
        assert.equal(context, expected);
        assertSingleOccurrence(context, word);
    }
});

test('builds deterministic elementary fill-in contexts for common concrete words', () => {
    for (const [word, meaning] of [
        ['corn', 'grain'],
        ['cheek', 'side of the face'],
        ['roll', 'move by turning over'],
        ['puppy', 'a young dog'],
        ['chick', 'a young chicken'],
        ['climb', 'go up'],
        ['swing', 'move back and forth'],
        ['belly', 'stomach'],
        ['crayons', 'colored drawing sticks'],
        ['chest', 'body part'],
        ['mud', 'wet dirt'],
        ['pepper', 'spice'],
        ['pants', 'clothes'],
        ['eraser', 'school tool'],
    ]) {
        const context = generateElementaryTemplateContext(word, meaning);
        assert.ok(context, word);
        assertSingleOccurrence(context, word);
    }
});

test('returns empty when no safe elementary template is known', () => {
    assert.equal(generateElementaryTemplateContext('abstract', 'hard idea'), '');
});
test('builds child-friendly elementary definitions without revealing the answer', () => {
    const cases = [
        ['roll', 'The act or result of rolling.', 'To move by turning over and over.'],
        ['chest', 'A box, now usually a large strong box with a secure convex lid.', 'The front part of your body above your belly.'],
        ['crayons', 'A stick of colored chalk or wax used for drawing.', 'Colored sticks used for drawing.'],
    ];
    for (const [word, meaning, expected] of cases) {
        const definition = generateElementaryDefinition(word, meaning);
        assert.equal(definition, expected);
        assert.equal(new RegExp(`\\b${word}\\b`, 'i').test(definition), false, definition);
    }
});
test('builds simple elementary distractors for known words', () => {
    const cases = [
        ['pepper', ['salt', 'sugar', 'butter']],
        ['calf', ['cub', 'foal', 'lamb']],
        ['chick', ['duck', 'egg', 'bird']],
    ];
    for (const [word, expected] of cases) {
        assert.deepEqual(generateElementaryDistractors(word), expected);
    }
    assert.deepEqual(generateElementaryDistractors('unknown'), []);
});
test('elementary clothing and hair templates disambiguate same-category options', () => {
    const braided = generateElementaryTemplateContext('braided', 'woven hair');
    assert.match(braided, /three|woven|braid/i);
    assertSingleOccurrence(braided, 'braided');

    const sweater = generateElementaryTemplateContext('sweater', 'warm clothes');
    assert.match(sweater, /knit|knitted|wool/i);
    assertSingleOccurrence(sweater, 'sweater');

    const pants = generateElementaryTemplateContext('pants', 'clothes');
    assert.match(pants, /legs/i);
    assertSingleOccurrence(pants, 'pants');

    const curly = generateElementaryTemplateContext('curly', 'having curls');
    assert.match(curly, /many|curls|loops/i);
    assertSingleOccurrence(curly, 'curly');
});
