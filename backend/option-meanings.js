const { hasMeaningfulChineseMeaning } = require('./question-quality');

function fieldText(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return fieldText(value[0]);
    if (typeof value === 'object') {
        return String(value.text ?? value.name ?? value.value ?? '');
    }
    return String(value);
}

function optionWord(option) {
    return String(option || '').replace(/^[A-D]\.\s*/, '').trim().toLowerCase();
}

async function enrichQuestionOptionMeanings({
    questions,
    records,
    translateWords,
    updateRecord = async () => {},
}) {
    const recordIndex = new Map();
    for (const record of records || []) {
        const word = fieldText(record.fields?.Word).trim().toLowerCase();
        if (!word) continue;
        if (!recordIndex.has(word)) recordIndex.set(word, []);
        recordIndex.get(word).push(record);
    }

    const knownMeanings = new Map();
    for (const [word, matchingRecords] of recordIndex) {
        const meaning = matchingRecords
            .map(record => fieldText(record.fields?.CN_Meaning).trim())
            .find(hasMeaningfulChineseMeaning);
        if (meaning) knownMeanings.set(word, meaning);
    }

    const wordsNeedingGenericMeaning = new Set();
    for (const question of questions) {
        const correctIndex = ['A', 'B', 'C', 'D'].indexOf(question.answer);
        (question.options || []).forEach((option, index) => {
            const word = optionWord(option);
            const hasQuestionMeaning = index === correctIndex && question.correctMeaning;
            if (word && !hasQuestionMeaning) wordsNeedingGenericMeaning.add(word);
        });
    }
    const missingWords = [...wordsNeedingGenericMeaning]
        .filter(word => !knownMeanings.has(word));
    const translated = missingWords.length > 0
        ? await translateWords(missingWords)
        : {};

    const retryWords = missingWords.filter(word => !fieldText(translated?.[word]).trim());
    const retried = retryWords.length > 0
        ? await translateWords(retryWords).catch(() => ({}))
        : {};
    const merged = { ...translated, ...retried };

    for (const word of missingWords) {
        const meaning = fieldText(merged?.[word]).trim();
        if (!meaning) continue;
        knownMeanings.set(word, meaning);
        for (const record of recordIndex.get(word) || []) {
            if (!fieldText(record.fields?.CN_Meaning).trim()) {
                await updateRecord(record.record_id, { CN_Meaning: meaning });
                record.fields.CN_Meaning = meaning;
            }
        }
    }

    for (const question of questions) {
        const correctIndex = ['A', 'B', 'C', 'D'].indexOf(question.answer);
        question.optionMeanings = (question.options || []).map((option, index) => {
            if (index === correctIndex && question.correctMeaning) {
                return question.correctMeaning;
            }
            const word = optionWord(option);
            return knownMeanings.get(word) || '中文释义补充失败';
        });
    }
    return questions;
}

module.exports = {
    enrichQuestionOptionMeanings,
    optionWord,
};
