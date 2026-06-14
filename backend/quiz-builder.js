function createQuizBuilder({
    choose,
    escapeRegExp,
    getWordForms,
    isContextUsableForWord,
    normalizeArticleContext,
    getFallbackDistractors = () => [],
}) {
    return function buildQuizQuestion(
        recordId,
        info,
        qType,
        testId,
        letters,
        {
            excludedDistractors = [],
            forcedDistractors = null,
        } = {}
    ) {
        const key = info.word.toLowerCase();
        const excluded = new Set(
            excludedDistractors.map(distractor =>
                String(distractor || '').trim().toLowerCase()
            )
        );
        const specificDistractors = (info.distractors || [])
            .map(distractor => String(distractor || '').trim().toLowerCase())
            .filter(distractor =>
                distractor &&
                distractor !== key &&
                !excluded.has(distractor)
            );
        const fallbackDistractors = forcedDistractors === null
            ? getFallbackDistractors(info)
                .map(distractor => String(distractor || '').trim().toLowerCase())
                .filter(distractor =>
                    distractor &&
                    distractor !== key &&
                    !excluded.has(distractor)
                )
            : [];

        let usableDistractors = forcedDistractors === null
            ? [...new Set([...specificDistractors, ...fallbackDistractors])]
            : [...new Set(
                forcedDistractors
                    .map(distractor => String(distractor || '').trim().toLowerCase())
                    .filter(distractor =>
                        distractor &&
                        distractor !== key &&
                        !excluded.has(distractor)
                    )
            )];
        if (forcedDistractors !== null && usableDistractors.length !== 3) {
            return null;
        }
        if (usableDistractors.length < 3) return null;
        let articleNormalized = false;
        if (qType === 1 && isContextUsableForWord(key, info.context)) {
            usableDistractors = usableDistractors.filter(distractor =>
                !distractor.includes(key) && !key.includes(distractor)
            );
        }
        if (usableDistractors.length < 3) return null;

        const pickedDistractors = forcedDistractors === null
            ? choose(usableDistractors, 3)
            : usableDistractors;
        const allOptions = choose([key, ...pickedDistractors], 4);
        const correctIndex = allOptions.indexOf(key);
        const options = allOptions.map(
            (option, index) => `${letters[index]}. ${option}`
        );

        let question;
        if (qType === 1) {
            if (!isContextUsableForWord(key, info.context)) return null;
            const forms = getWordForms(key).map(escapeRegExp).join('|');
            const pattern = new RegExp(`\\b(${forms})\\b`, 'gi');
            let context = (info.context || '').replace(pattern, '_____');
            if (!context.includes('_____')) return null;
            const normalized = normalizeArticleContext(context);
            context = normalized.text;
            articleNormalized = normalized.normalized;
            question = {
                type: 1,
                word: key,
                context,
                options,
                answer: letters[correctIndex],
                articleNormalized,
                correctMeaning: info.CN_Meaning || '',
            };
        } else if (qType === 2) {
            const meaning = (info.meaning || '').split(';')[0] || info.meaning || '';
            question = {
                type: 2,
                word: key,
                context: meaning,
                options,
                answer: letters[correctIndex],
                correctMeaning: info.CN_Meaning || '',
            };
        } else if (qType === 3) {
            question = {
                type: 3,
                word: key,
                context: info.CN_Meaning || '',
                options,
                answer: letters[correctIndex],
                correctMeaning: info.CN_Meaning || '',
            };
        }

        if (!question || !question.context) return null;
        question.testId = testId;
        question.record_id = recordId;
        return question;
    };
}

module.exports = { createQuizBuilder };
