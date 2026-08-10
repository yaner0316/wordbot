function getRecordKey(word) {
  return String(word?.record_id || word?.recordId || word?.word_id || word?.word || '').trim();
}

function mergeWordPage(current, next) {
  const merged = [...(Array.isArray(current) ? current : [])];
  for (const word of Array.isArray(next) ? next : []) {
    const key = getRecordKey(word);
    const index = merged.findIndex(existing => getRecordKey(existing) === key);
    if (index === -1) merged.push(word);
    else merged[index] = word;
  }
  return merged;
}

function updateWordInList(words, updated) {
  const key = getRecordKey(updated);
  return (Array.isArray(words) ? words : []).map(word => getRecordKey(word) === key ? updated : word);
}

function removeWordFromList(words, recordKey) {
  const target = String(recordKey || '').trim();
  return (Array.isArray(words) ? words : []).filter(word => getRecordKey(word) !== target);
}

function hasMoreWordPages(meta) {
  return Number(meta?.page || 0) < Number(meta?.totalPages || 0);
}

function buildWordUpdatePayload(userId, word, fields = {}) {
  return {
    userId,
    recordId: getRecordKey(word),
    word: String(word?.word || word || '').trim(),
    meaning: fields.meaning ?? word?.meaning ?? '',
    cnMeaning: fields.cnMeaning ?? word?.cnMeaning ?? '',
    context: fields.context ?? word?.context ?? '',
    distractors: fields.distractors ?? word?.distractors ?? '',
    status: fields.status ?? word?.status ?? 'Pending',
  };
}

module.exports = { getRecordKey, mergeWordPage, updateWordInList, removeWordFromList, hasMoreWordPages, buildWordUpdatePayload };
