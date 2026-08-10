const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mergeWordPage,
  updateWordInList,
  removeWordFromList,
  hasMoreWordPages,
  buildWordUpdatePayload,
} = require('../word-editor-logic');

test('merges pages without duplicating a meaning record', () => {
  const first = [{ recordId: 'a', word: 'bank' }];
  const second = [{ recordId: 'a', word: 'bank' }, { recordId: 'b', word: 'cushion' }];

  assert.deepEqual(mergeWordPage(first, second), [
    { recordId: 'a', word: 'bank' },
    { recordId: 'b', word: 'cushion' },
  ]);
});

test('updates only the edited meaning record', () => {
  const words = [{ recordId: 'a', word: 'bank', meaning: 'river edge' }, { recordId: 'b', word: 'bank', meaning: 'money place' }];
  const updated = { recordId: 'b', word: 'bank', meaning: 'financial institution' };

  assert.deepEqual(updateWordInList(words, updated), [words[0], updated]);
});

test('removes only the deleted meaning record', () => {
  const words = [{ recordId: 'a', word: 'bank' }, { recordId: 'b', word: 'bank' }];
  assert.deepEqual(removeWordFromList(words, 'a'), [words[1]]);
});

test('reports whether another page is available', () => {
  assert.equal(hasMoreWordPages({ page: 1, totalPages: 2 }), true);
  assert.equal(hasMoreWordPages({ page: 2, totalPages: 2 }), false);
});

test('builds an update payload with the exact meaning record id', () => {
  const word = { record_id: 'meaning-bank-river', word: 'bank', meaning: 'river edge', cnMeaning: '河岸' };
  assert.deepEqual(buildWordUpdatePayload('qiuqiu', word, {
    meaning: 'financial institution',
    cnMeaning: '银行',
    context: 'I went to the bank.',
    distractors: 'shop,school,park',
    status: 'Pending',
  }), {
    userId: 'qiuqiu',
    recordId: 'meaning-bank-river',
    word: 'bank',
    meaning: 'financial institution',
    cnMeaning: '银行',
    context: 'I went to the bank.',
    distractors: 'shop,school,park',
    status: 'Pending',
  });
});
