const test = require('node:test');
const assert = require('node:assert/strict');
const { auditQuestionCacheRows } = require('../question-cache-semantic-audit');

test('dry-run reports cache ids and per-user counts without changing rows', () => {
    const rows = [
        { id: 'cache-cushion', user_id: 'u1', word: 'cushion', quality_status: 'ready', cache_state: 'active', question_type: 1, question_text: 'Use a soft _____.', options: ['A. cushion','B. pillow','C. bolster','D. pad'], answer: 'A', option_meanings: ['垫子,软垫','枕头','长枕','垫子'] },
        { id: 'cache-conference', user_id: 'u1', word: 'conference', quality_status: 'ready', cache_state: 'reserved_next_day', question_type: 1, question_text: 'Attend the _____.', options: ['A. seminar','B. conference','C. forum','D. symposium'], answer: 'B', option_meanings: ['研讨会','会议,研讨会','论坛','专题讨论会'] },
        { id: 'cache-safe', user_id: 'u2', word: 'apple', quality_status: 'ready', cache_state: 'active', question_type: 1, question_text: 'Eat an _____.', options: ['A. apple','B. desk','C. chair','D. road'], answer: 'A', option_meanings: ['苹果','桌子','椅子','道路'] },
    ];
    const before = JSON.stringify(rows);
    const report = auditQuestionCacheRows(rows, [{ id: 'u1', username: 'yusi' }, { id: 'u2', username: 'qiuqiu' }]);

    assert.equal(report.affectedCount, 2);
    assert.deepEqual(report.byUser, { yusi: 2 });
    assert.deepEqual(report.affected.map(item => item.cacheId), ['cache-cushion', 'cache-conference']);
    assert.equal(JSON.stringify(rows), before);
});
