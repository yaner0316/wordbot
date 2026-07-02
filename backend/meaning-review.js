function normalizeMeaningText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[()\[\]{}（）【】《》]/g, '')
        .replace(/[，,。.!！？?；;：:、/\\|"'“”‘’\s-]+/g, '');
}

function splitMeaningParts(value) {
    return String(value || '')
        .split(/[；;，,。、/\\|]/)
        .map(part => part.trim())
        .filter(Boolean);
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
