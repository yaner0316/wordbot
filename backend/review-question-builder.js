function optionWord(option) {
    return String(option || '').replace(/^[A-D]\.\s*/, '').trim().toLowerCase();
}

function validQuestionTypes(info) {
    const types = [];
    if (info.context) types.push(1);
    if (info.meaning) types.push(2);
    if (info.CN_Meaning) types.push(3);
    return types;
}

function createReviewQuestionBuilder({
    buildQuizQuestion,
    rewriteContext,
    generateDistractors,
    chooseType,
}) {
    return async function buildReviewQuestion({
        reviewId,
        source,
        info,
        usedDistractors = new Set(),
    }) {
        const key = String(info.word || '').toLowerCase();
        const sourceWrongOptions = (source.options || [])
            .map(optionWord)
            .filter(word => word && word !== key);
        const excludedDistractors = new Set([
            ...sourceWrongOptions,
            ...usedDistractors,
        ]);

        const availableTypes = validQuestionTypes(info);
        const alternativeTypes = availableTypes.filter(type => type !== source.type);
        const type = alternativeTypes.length > 0
            ? chooseType(alternativeTypes)
            : source.type;

        let reviewInfo = { ...info };
        if (type === source.type) {
            reviewInfo = await rewriteContext({ source, info: reviewInfo, type });
            const field = type === 1
                ? 'context'
                : type === 2 ? 'meaning' : 'CN_Meaning';
            const originalText = source.context || info[field];
            if (
                !reviewInfo ||
                String(reviewInfo[field] || '').trim() ===
                    String(originalText || '').trim()
            ) {
                throw new Error('复习题必须使用新的题干');
            }
        }

        const generated = await generateDistractors({
            source,
            info: reviewInfo,
            type,
            excludedDistractors,
        });
        const forcedDistractors = [...new Set(
            (generated || [])
                .map(word => String(word || '').trim().toLowerCase())
                .filter(word =>
                    word &&
                    word !== key &&
                    !excludedDistractors.has(word)
                )
        )];
        if (forcedDistractors.length !== 3) {
            throw new Error('无法生成三个新的合格错误选项');
        }

        const question = buildQuizQuestion(
            source.recordId,
            reviewInfo,
            type,
            reviewId,
            ['A', 'B', 'C', 'D'],
            {
                excludedDistractors: [...excludedDistractors],
                forcedDistractors,
            }
        );
        if (!question) {
            throw new Error('复习题生成失败');
        }
        return question;
    };
}

module.exports = {
    createReviewQuestionBuilder,
    optionWord,
    validQuestionTypes,
};
