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

module.exports = {
    isMeaningAnswerCorrect,
    normalizeMeaningText,
    splitMeaningParts,
};
