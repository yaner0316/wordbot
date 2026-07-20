const { strict: assert } = require('assert');
const { test } = require('node:test');
const {
    hasAiMetaResponse,
    hasMeaningfulChineseMeaning,
    getQuestionQualityIssues,
    isQuestionQualityAcceptable,
} = require('../question-quality');

const META = "The text you've shared looks like garbled text. Could you let me know what you would like me to do?";
const META_CN = '您好，您提供的内容无法理解，请告诉我您的具体需求';
const ELEMENTARY = String.fromCharCode(0x5c0f, 0x5b66);
const JUNIOR_HIGH = String.fromCharCode(0x521d, 0x4e2d);
const SENIOR_HIGH = String.fromCharCode(0x9ad8, 0x4e2d);
const UNIVERSITY = String.fromCharCode(0x5927, 0x5b66);
const CN_CHEST = String.fromCharCode(0x80f8, 0x90e8);
const CN_CHEEK = String.fromCharCode(0x8138, 0x988a);
const CN_MUD = String.fromCharCode(0x6ce5);
const CN_CRAYONS = String.fromCharCode(0x8721, 0x7b14);
const CN_CLAP = String.fromCharCode(0x9f13, 0x638c);
const CN_SWEATER = String.fromCharCode(0x6bdb, 0x8863);

test('hasAiMetaResponse detects English meta-response', () => {
    assert.equal(hasAiMetaResponse(META), true);
});

test('hasAiMetaResponse detects Chinese meta-response', () => {
    assert.equal(hasAiMetaResponse(META_CN), true);
});

test('hasAiMetaResponse passes clean Chinese', () => {
    assert.equal(hasAiMetaResponse('固执的'), false);
});

test('hasMeaningfulChineseMeaning accepts valid Chinese', () => {
    assert.equal(hasMeaningfulChineseMeaning('固执的'), true);
});

test('hasMeaningfulChineseMeaning rejects empty', () => {
    assert.equal(hasMeaningfulChineseMeaning(''), false);
    assert.equal(hasMeaningfulChineseMeaning(null), false);
});

test('hasMeaningfulChineseMeaning rejects AI meta-response', () => {
    assert.equal(hasMeaningfulChineseMeaning(META_CN), false);
});

test('hasMeaningfulChineseMeaning rejects text with no Chinese characters', () => {
    assert.equal(hasMeaningfulChineseMeaning('stubborn'), false);
});

test('hasMeaningfulChineseMeaning rejects text over 50 chars', () => {
    assert.equal(hasMeaningfulChineseMeaning('固执的'.repeat(20)), false);
});

test('isQuestionQualityAcceptable: type 1 with dirty context is rejected', () => {
    const q = { type: 1, context: META, correctMeaning: '固执的', options: ['A. a', 'B. b', 'C. c', 'D. d'], answer: 'A', word: 'a' };
    assert.equal(isQuestionQualityAcceptable(q), false);
});

test('isQuestionQualityAcceptable: type 1 with dirty correctMeaning clears it but keeps question', () => {
    const q = { type: 1, context: 'She was _____ about her decision.', correctMeaning: META_CN, options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    const result = isQuestionQualityAcceptable(q);
    assert.equal(result, true);
    assert.equal(q.correctMeaning, '');
});

test('isQuestionQualityAcceptable: type 2 with dirty correctMeaning clears it but keeps question', () => {
    const q = { type: 2, context: 'refusing to change; unyielding', correctMeaning: META_CN, options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    const result = isQuestionQualityAcceptable(q);
    assert.equal(result, true);
    assert.equal(q.correctMeaning, '');
});

test('isQuestionQualityAcceptable: type 3 with dirty context (CN_Meaning) is rejected', () => {
    const q = { type: 3, context: META_CN, correctMeaning: META_CN, options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    assert.equal(isQuestionQualityAcceptable(q), false);
});

test('isQuestionQualityAcceptable: type 3 with English-only context is rejected', () => {
    const q = { type: 3, context: 'stubborn', correctMeaning: '固执的', options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    assert.equal(isQuestionQualityAcceptable(q), false);
});

test('isQuestionQualityAcceptable: type 3 with clean CN_Meaning is accepted', () => {
    const q = { type: 3, context: '固执的', correctMeaning: '固执的', options: ['A. stubborn', 'B. happy', 'C. calm', 'D. sad'], answer: 'A', word: 'stubborn' };
    assert.equal(isQuestionQualityAcceptable(q), true);
});


test('elementary fill-in rejects contexts that use a different sense than the Chinese meaning', () => {
    const cases = [
        {
            word: 'chest',
            context: "The museum's ancient _____ was secured with a brass lock, holding artifacts from the 17th century.",
            correctMeaning: CN_CHEST,
            options: ['A. study', 'B. chest', 'C. fare', 'D. compute'],
            answer: 'B',
        },
        {
            word: 'cheek',
            context: "You've got some _____, asking me for money!",
            correctMeaning: CN_CHEEK,
            options: ['A. cheek', 'B. chin', 'C. crayons', 'D. straight'],
            answer: 'A',
        },
        {
            word: 'mud',
            context: 'The campaign issues got lost in all the _____ from both parties.',
            correctMeaning: CN_MUD,
            options: ['A. ordinary', 'B. artificial', 'C. mud', 'D. gracious'],
            answer: 'C',
        },
    ];

    for (const q of cases) {
        const question = { type: 1, level: ELEMENTARY, ...q };
        assert.equal(isQuestionQualityAcceptable(question), false, q.word);
        assert.ok(getQuestionQualityIssues(question).some(issue => issue.startsWith('sense_mismatch')));
    }
});

test('fill-in rejects malformed double-ed option words', () => {
    const question = {
        type: 1,
        level: SENIOR_HIGH,
        word: 'earn',
        context: 'You can have the prize; you _____ it.',
        correctMeaning: String.fromCharCode(0x8d62, 0x5f97),
        options: ['A. inheriteded', 'B. earned', 'C. requesteded', 'D. borroweded'],
        answer: 'B',
    };

    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('bad_option_inflection'), 'issues=' + issues.join(','));
});

test('elementary fill-in rejects weak distractor shape', () => {
    const question = {
        type: 1,
        level: ELEMENTARY,
        word: 'crayons',
        context: 'The child pressed the bright _____ onto the paper, drawing a smiling sun with wavy edges.',
        correctMeaning: CN_CRAYONS,
        options: ['A. crayons', 'B. regular', 'C. atmosphere', 'D. put off'],
        answer: 'A',
    };

    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(getQuestionQualityIssues(question).includes('bad_distractor_shape'));
});

test('elementary definition questions are always rejected', () => {
    const question = {
        type: 2,
        level: ELEMENTARY,
        word: 'hobby',
        context: 'An activity or task with which one occupies oneself',
        correctMeaning: String.fromCharCode(0x7231, 0x597d),
        options: ['A. workplace', 'B. occupation', 'C. salary', 'D. hobby'],
        answer: 'D',
    };

    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('elementary_definition_question'), 'issues=' + issues.join(','));
});

test('elementary definition questions reject dictionary-style definitions', () => {
    const clap = {
        type: 2,
        level: ELEMENTARY,
        word: 'clap',
        context: 'The act of striking the palms of the hands, or any two surfaces, together.',
        correctMeaning: CN_CLAP,
        options: ['A. afraid', 'B. altitude', 'C. average', 'D. clap'],
        answer: 'D',
    };
    const sweater = {
        type: 2,
        level: ELEMENTARY,
        word: 'sweater',
        context: 'A knitted jacket or jersey, usually of thick wool, worn by athletes before or after exercise.',
        correctMeaning: CN_SWEATER,
        options: ['A. winter', 'B. event', 'C. sweater', 'D. grace'],
        answer: 'C',
    };

    assert.equal(isQuestionQualityAcceptable(clap), false);
    assert.ok(getQuestionQualityIssues(clap).includes('dictionary_definition'));
    assert.equal(isQuestionQualityAcceptable(sweater), false);
    assert.ok(getQuestionQualityIssues(sweater).includes('dictionary_definition'));
});

test('elementary definition questions reject screenshot hard dictionary definitions', () => {
    const cases = [
        {
            word: 'chest',
            context: 'A box, now usually a large strong box with a secure convex lid.',
            correctMeaning: CN_CHEST,
            options: ['A. chest', 'B. mud', 'C. pepper', 'D. foal'],
            answer: 'A',
        },
        {
            word: 'mud',
            context: 'A mixture of water and soil or fine grained sediment.',
            correctMeaning: CN_MUD,
            options: ['A. chest', 'B. mud', 'C. pepper', 'D. foal'],
            answer: 'B',
        },
        {
            word: 'pepper',
            context: 'A plant of the family Piperaceae.',
            correctMeaning: String.fromCharCode(0x80e1, 0x6912),
            options: ['A. chest', 'B. mud', 'C. pepper', 'D. foal'],
            answer: 'C',
        },
    ];

    for (const q of cases) {
        const question = { type: 2, level: ELEMENTARY, ...q };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, q.word);
        assert.ok(issues.includes('dictionary_definition'), q.word + ' issues=' + issues.join(','));
    }
});

test('elementary quality rejects actual hard cached rows from Draggy preview', () => {
    const cases = [
        {
            type: 1,
            word: 'swing',
            context: 'Door _____ tells you which way the door opens.',
            correctMeaning: String.fromCharCode(0x79cb, 0x5343),
            options: ['A. cub', 'B. swing', 'C. clap', 'D. chick'],
            answer: 'B',
            expected: 'not_elementary_context',
        },
        {
            type: 1,
            word: 'belly',
            context: 'the _____ of a flask, muscle, violin, sail, or ship',
            correctMeaning: String.fromCharCode(0x8179, 0x90e8),
            options: ['A. eraser', 'B. belly', 'C. curly', 'D. straight'],
            answer: 'B',
            expected: 'not_elementary_context',
        },
        {
            type: 2,
            word: 'roll',
            context: 'The act or result of rolling, or state of being rolled.',
            correctMeaning: String.fromCharCode(0x5377),
            options: ['A. inherit', 'B. stir', 'C. roll', 'D. handsome'],
            answer: 'C',
            expected: 'dictionary_definition',
        },
    ];

    for (const q of cases) {
        const question = { level: ELEMENTARY, ...q };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, q.word);
        assert.ok(issues.includes(q.expected), q.word + ' issues=' + issues.join(','));
    }
});

test('elementary quality checks keep a simple direct fill-in question', () => {
    const question = {
        type: 1,
        level: ELEMENTARY,
        word: 'apple',
        context: 'I ate a red _____.',
        correctMeaning: String.fromCharCode(0x82f9, 0x679c),
        options: ['A. apple', 'B. pear', 'C. banana', 'D. orange'],
        answer: 'A',
    };

    assert.deepEqual(getQuestionQualityIssues(question), []);
    assert.equal(isQuestionQualityAcceptable(question), true);
});


test('elementary quality rejects sampled bad cache rows from Draggy', () => {
    const cases = [
        {
            type: 1,
            word: 'corn',
            context: 'He paid her the nominal fee of two _____ of barley.',
            correctMeaning: String.fromCharCode(0x7389, 0x7c73),
            options: ['A. corns', 'B. pumps', 'C. slices', 'D. geographies'],
            answer: 'A',
            expected: 'invalid_fill_in_grammar',
        },
        {
            type: 1,
            word: 'pepper',
            context: 'Some ballparks have signs saying No _____ games.',
            correctMeaning: String.fromCharCode(0x80e1, 0x6912),
            options: ['A. timetable', 'B. pepper', 'C. guide', 'D. luxurious'],
            answer: 'B',
            expected: 'sense_mismatch_pepper',
        },
        {
            type: 1,
            word: 'lamb',
            context: 'The shepherd was up all night, _____ her young ewes.',
            correctMeaning: String.fromCharCode(0x7f8a, 0x7f94),
            options: ['A. lambing', 'B. examing', 'C. quizing', 'D. enduring'],
            answer: 'A',
            expected: 'sense_mismatch_lamb',
        },
        {
            type: 2,
            word: 'cabbage',
            context: 'An edible plant (Brassica oleracea var. capitata) having a head of green leaves.',
            correctMeaning: String.fromCharCode(0x5377, 0x5fc3, 0x83dc),
            options: ['A. debt', 'B. various', 'C. hotel', 'D. cabbage'],
            answer: 'D',
            expected: 'dictionary_definition',
        },
        {
            type: 2,
            word: 'cow',
            context: '(properly) An adult female of the species Bos taurus, especially one that has calved.',
            correctMeaning: String.fromCharCode(0x6bcd, 0x725b),
            options: ['A. authentic', 'B. text', 'C. action', 'D. cow'],
            answer: 'D',
            expected: 'dictionary_definition',
        },
    ];

    for (const q of cases) {
        const question = { level: ELEMENTARY, ...q };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, q.word);
        assert.ok(issues.includes(q.expected), q.word + ' issues=' + issues.join(','));
    }
});


test('elementary quality rejects second sampled bad cache rows from Draggy', () => {
    const cases = [
        {
            type: 2,
            word: 'pants',
            context: '(Manchester) An outer garment that covers the body from the waist downwards, covering each leg separately, usually as far as the ankles',
            correctMeaning: String.fromCharCode(0x88e4, 0x5b50),
            options: ['A. pants', 'B. aware', 'C. fairy', 'D. pepper'],
            answer: 'A',
            expected: 'dictionary_definition',
        },
        {
            type: 2,
            word: 'eraser',
            context: 'One who erases.',
            correctMeaning: String.fromCharCode(0x6a61, 0x76ae, 0x64e6),
            options: ['A. expect for', 'B. eraser', 'C. dyed', 'D. china'],
            answer: 'B',
            expected: 'dictionary_definition',
        },
        {
            type: 2,
            word: 'straight',
            context: 'Something that is not crooked or bent such as a part of a road or track.',
            correctMeaning: String.fromCharCode(0x76f4, 0x7684),
            options: ['A. mercy', 'B. cupboard', 'C. straight', 'D. basement'],
            answer: 'C',
            expected: 'dictionary_definition',
        },
        {
            type: 1,
            word: 'roll',
            context: 'During practice, the coach asked the child to execute a forward _____ across the padded mat.',
            correctMeaning: String.fromCharCode(0x524d, 0x6eda, 0x7ffb),
            options: ['A. stir', 'B. inherit', 'C. roll', 'D. handsome'],
            answer: 'C',
            expected: 'not_elementary_context',
        },
        {
            type: 3,
            word: 'braided',
            context: String.fromCharCode(0x7f16, 0x7ec7, 0x7684),
            correctMeaning: String.fromCharCode(0x7f16, 0x7ec7, 0x7684),
            options: ['A. seize', 'B. carry out', 'C. braided', 'D. vocabulary'],
            answer: 'C',
            expected: 'bad_distractor_shape',
        },
    ];

    for (const q of cases) {
        const question = { level: ELEMENTARY, ...q };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, q.word);
        assert.ok(issues.includes(q.expected), q.word + ' issues=' + issues.join(','));
    }
});

test('semantic sense mismatch is rejected across learning levels', () => {
    for (const level of [ELEMENTARY, JUNIOR_HIGH, SENIOR_HIGH, UNIVERSITY]) {
        const question = {
            type: 1,
            level,
            word: 'chest',
            context: "The museum's ancient _____ was secured with a brass lock, holding artifacts from the 17th century.",
            correctMeaning: CN_CHEST,
            options: ['A. study', 'B. chest', 'C. fare', 'D. compute'],
            answer: 'B',
        };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, level);
        assert.ok(issues.includes('sense_mismatch_chest'), level + ' issues=' + issues.join(','));
    }
});

test('bad distractor shape is rejected across learning levels', () => {
    for (const level of [ELEMENTARY, JUNIOR_HIGH, SENIOR_HIGH, UNIVERSITY]) {
        const question = {
            type: 1,
            level,
            word: 'crayons',
            context: 'The child pressed the bright _____ onto the paper, drawing a smiling sun with wavy edges.',
            correctMeaning: CN_CRAYONS,
            options: ['A. crayons', 'B. regular', 'C. atmosphere', 'D. put off'],
            answer: 'A',
        };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, level);
        assert.ok(issues.includes('bad_distractor_shape'), level + ' issues=' + issues.join(','));
    }
});

test('elementary fill-in rejects hard animal nursery context even with clean options', () => {
    const question = {
        type: 1,
        level: ELEMENTARY,
        word: 'foal',
        context: 'The mare nuzzled her newborn _____ in the soft meadow.',
        correctMeaning: String.fromCharCode(0x5c0f, 0x9a6c, 0x9a79),
        options: ['A. calf', 'B. puppy', 'C. kitten', 'D. foal'],
        answer: 'D',
    };
    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('not_elementary_context'), 'issues=' + issues.join(','));
});

test('elementary fill-in rejects weak same-category animal contexts', () => {
    const cases = [
        {
            word: 'foal',
            context: 'The young _____ ran beside its mother today.',
            options: ['A. cub', 'B. calf', 'C. lamb', 'D. foal'],
            answer: 'D',
        },
        {
            word: 'puppy',
            context: 'The happy _____ wagged its tail at home.',
            options: ['A. puppy', 'B. duck', 'C. kitten', 'D. rabbit'],
            answer: 'A',
        },
    ];

    for (const sample of cases) {
        const question = {
            type: 1,
            level: ELEMENTARY,
            correctMeaning: 'elementary meaning',
            ...sample,
        };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, sample.word);
        assert.ok(issues.includes('ambiguous_elementary_context'), sample.word + ' issues=' + issues.join(','));
    }
});

test('elementary fill-in rejects screenshot sample with phrase distractor', () => {
    const question = {
        type: 1,
        level: ELEMENTARY,
        word: 'foal',
        context: 'The mare nuzzled her newborn _____ in the soft meadow.',
        correctMeaning: String.fromCharCode(0x5c0f, 0x9a6c, 0x9a79),
        options: ['A. photographer', 'B. agree to', 'C. swing', 'D. foal'],
        answer: 'D',
    };
    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('bad_distractor_shape'), 'issues=' + issues.join(','));
    assert.ok(issues.includes('not_elementary_context'), 'issues=' + issues.join(','));
});
test('fill-in rejects ambiguous same-category food contexts across levels', () => {
    const question = {
        type: 1,
        level: '高中',
        word: 'cucumber',
        context: 'a(n) _____ salad is refreshing on a hot day.',
        correctMeaning: '黄瓜',
        options: ['A. lettuce', 'B. cucumber', 'C. celery', 'D. radish'],
        answer: 'B',
    };

    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('ambiguous_fill_in_context'), 'issues=' + issues.join(','));
});
test('fill-in rejects ambiguous same-category publication contexts across levels', () => {
    const question = {
        type: 1,
        level: ELEMENTARY,
        word: 'textbook',
        context: 'This chemistry _____ explains concepts very clearly.',
        correctMeaning: String.fromCharCode(0x6559, 0x79d1, 0x4e66),
        options: ['A. novel', 'B. biography', 'C. textbook', 'D. magazine'],
        answer: 'C',
    };

    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('ambiguous_fill_in_context'), 'issues=' + issues.join(','));
});

test('elementary fill-in rejects ambiguous same-category clothing and hair contexts', () => {
    const cases = [
        {
            word: 'braided',
            context: 'The girl wore _____ hair at school today.',
            options: ['A. straight', 'B. short', 'C. curly', 'D. braided'],
            answer: 'D',
        },
        {
            word: 'curly',
            context: 'The girl has _____ hair after her bath.',
            options: ['A. curly', 'B. long', 'C. short', 'D. straight'],
            answer: 'A',
        },
        {
            word: 'sweater',
            context: 'I wore a warm _____ on a cold day.',
            options: ['A. shirt', 'B. coat', 'C. sweater', 'D. jacket'],
            answer: 'C',
        },
        {
            word: 'pants',
            context: 'Tom wore blue _____ to school this morning.',
            options: ['A. pants', 'B. shirt', 'C. shoes', 'D. socks'],
            answer: 'A',
        },
        {
            word: 'shirt',
            context: 'The boy put on his blue _____ before going to school.',
            options: ['A. dress', 'B. pants', 'C. jacket', 'D. shirt'],
            answer: 'D',
        },
        {
            word: 'pants',
            context: 'Tom wore blue _____ on his legs to school this morning.',
            options: ['A. shirt', 'B. socks', 'C. pants', 'D. shoes'],
            answer: 'C',
        },
    ];

    for (const sample of cases) {
        const question = {
            type: 1,
            level: ELEMENTARY,
            correctMeaning: '小学释义',
            ...sample,
        };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, sample.word);
        assert.ok(issues.includes('ambiguous_elementary_context'), sample.word + ' issues=' + issues.join(','));
    }
});

test('elementary quality rejects screenshot ambiguous food and playground fill-ins', () => {
    const cases = [
        { word: 'pepper', context: 'Dad put black _____ on his hot soup.', options: ['A. pepper', 'B. sugar', 'C. butter', 'D. salt'], answer: 'A', expected: 'ambiguous_elementary_context' },
        { word: 'swing', context: 'Kids _____ high at the sunny park after school.', options: ['A. jump', 'B. swing', 'C. climb', 'D. slide'], answer: 'B', expected: 'ambiguous_elementary_context' },
        { word: 'lettuce', context: 'I want a ham sandwich with _____ and tomato.', options: ['A. lettuce', 'B. potato', 'C. carrot', 'D. corn'], answer: 'A', expected: 'ambiguous_fill_in_context' },
    ];
    for (const sample of cases) {
        const question = { type: 1, level: ELEMENTARY, correctMeaning: '小学释义', ...sample };
        const issues = getQuestionQualityIssues(question);
        assert.equal(isQuestionQualityAcceptable(question), false, sample.word);
        assert.ok(issues.includes(sample.expected), sample.word + ' issues=' + issues.join(','));
    }
});

test('fill-in rejects ambiguous same-category material contexts across levels', () => {
    const question = {
        type: 1,
        level: JUNIOR_HIGH,
        word: 'cotton',
        context: 'Socks were made of pure _____, which wore out at the toes and heels so holes occurred very often.',
        correctMeaning: String.fromCharCode(0x68c9, 0x82b1),
        options: ['A. linen', 'B. cotton', 'C. wool', 'D. silk'],
        answer: 'B',
    };

    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('ambiguous_fill_in_context'), 'issues=' + issues.join(','));
});
test('fill-in rejects ambiguous same-category sound adjective contexts across levels', () => {
    const question = {
        type: 1,
        level: JUNIOR_HIGH,
        word: 'strange',
        context: 'The _____ noise in the attic made me wonder if someone was hiding up there.',
        correctMeaning: String.fromCharCode(0x5947, 0x602a, 0x7684),
        options: ['A. quiet', 'B. sudden', 'C. distant', 'D. strange'],
        answer: 'D',
    };

    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('ambiguous_fill_in_context'), 'issues=' + issues.join(','));
});
test('fill-in rejects same-category ocean route contexts across levels', () => {
    const question = {
        type: 1,
        level: SENIOR_HIGH,
        word: 'pacific',
        context: 'The ship sailed across the _____, heading from New York to London.',
        correctMeaning: String.fromCharCode(0x592a, 0x5e73, 0x6d0b),
        options: ['A. atlantic', 'B. indian', 'C. pacific', 'D. arctic'],
        answer: 'C',
    };

    const issues = getQuestionQualityIssues(question);
    assert.equal(isQuestionQualityAcceptable(question), false);
    assert.ok(issues.includes('ambiguous_fill_in_context'), 'issues=' + issues.join(','));
});
