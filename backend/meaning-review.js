function normalizeMeaningText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[()\[\]{}\uFF08\uFF09\u3010\u3011\u300A\u300B]/g, '')
        .replace(/[\uFF0C,\u3002.!\uFF01\uFF1F?;\uFF1B:\uFF1A\u3001\/\\|"'\u201C\u201D\u2018\u2019\s-]+/g, '');
}

function splitMeaningParts(value) {
    return String(value || '')
        .split(/[\uFF1B;\uFF0C,\u3002\u3001\/\\|]/)
        .map(part => part.trim())
        .filter(Boolean);
}

function zh(...codes) {
    return String.fromCharCode(...codes);
}

const SEMANTIC_TOKEN_EQUIVALENCES = [
    [zh(0x7075, 0x9b42), zh(0x7cbe, 0x795e), zh(0x5fc3, 0x7075)],
    [zh(0x4f34, 0x4fa3), zh(0x7231, 0x4eba), zh(0x604b, 0x4eba), zh(0x914d, 0x5076)],
];

function hasSemanticTokenCoverage(answer, expectedMeaning) {
    const normalizedAnswer = normalizeMeaningText(answer);
    const normalizedExpected = normalizeMeaningText(expectedMeaning);
    const relevantGroups = SEMANTIC_TOKEN_EQUIVALENCES.filter(group =>
        group.some(term => normalizedAnswer.includes(normalizeMeaningText(term)))
    );
    if (relevantGroups.length < 2) return false;
    return relevantGroups.every(group =>
        group.some(term => normalizedExpected.includes(normalizeMeaningText(term)))
    );
}

function isMeaningAnswerCorrect(answer, expectedMeaning) {
    const normalizedAnswer = normalizeMeaningText(answer);
    if (!normalizedAnswer) return false;
    const normalizedExpected = normalizeMeaningText(expectedMeaning);
    if (!normalizedExpected) return false;
    if (
        normalizedAnswer.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedAnswer)
    ) {
        return true;
    }
    if (hasSemanticTokenCoverage(answer, expectedMeaning)) {
        return true;
    }
    return splitMeaningParts(expectedMeaning).some(part => {
        const normalizedPart = normalizeMeaningText(part);
        return normalizedPart.length >= 2 && (
            normalizedAnswer.includes(normalizedPart) ||
            normalizedPart.includes(normalizedAnswer)
        );
    });
}

function getPermutations(arr) {
    if (arr.length <= 1) return [arr];
    return arr.flatMap((item, i) =>
        getPermutations([...arr.slice(0, i), ...arr.slice(i + 1)])
            .map(perm => [item, ...perm])
    );
}

// All submitted texts must match all expected meanings in any order.
function isMultiMeaningCorrect(submittedTexts, expectedMeanings) {
    if (!Array.isArray(submittedTexts) || !Array.isArray(expectedMeanings)) return false;
    if (submittedTexts.length !== expectedMeanings.length) return false;
    return getPermutations(expectedMeanings).some(perm =>
        perm.every((expected, i) => isMeaningAnswerCorrect(submittedTexts[i], expected))
    );
}

module.exports = {
    isMeaningAnswerCorrect,
    isMultiMeaningCorrect,
    normalizeMeaningText,
    splitMeaningParts,
};
