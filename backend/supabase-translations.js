const https = require('https');
const { hasMeaningfulChineseMeaning } = require('./question-quality');
const { isContextSentenceTranslationAcceptable } = require('./context-sentence-translation');
const { buildMiniMaxRequestBody, getMiniMaxSettings } = require('./minimax-settings');

class TranslationError extends Error {
    constructor(code, message, options = {}) {
        super(message, options);
        this.name = 'TranslationError';
        this.code = code;
    }
}

function translationError(code, message, cause) {
    return new TranslationError(code, message, cause ? { cause } : undefined);
}

function callMiniMax(prompt, timeout) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.MINIMAX_API_KEY;
        if (!apiKey) {
            reject(translationError('TRANSLATION_CONFIG_MISSING', 'MiniMax translation is not configured'));
            return;
        }
        const settings = getMiniMaxSettings();
        const body = JSON.stringify(buildMiniMaxRequestBody(prompt));
        const request = https.request({
            hostname: 'api.minimax.chat',
            path: '/v1/text/chatcompletion_v2',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + apiKey,
                'Content-Length': Buffer.byteLength(body),
            },
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    reject(translationError('TRANSLATION_PROVIDER_UNAVAILABLE', `MiniMax translation request failed with status ${response.statusCode}`));
                    return;
                }
                try {
                    const result = JSON.parse(Buffer.concat(chunks).toString());
                    const content = result.choices?.[0]?.message?.content;
                    if (!content) {
                        reject(translationError('TRANSLATION_RESPONSE_INVALID', 'MiniMax translation response did not contain content'));
                        return;
                    }
                    resolve(content);
                } catch (error) {
                    reject(translationError('TRANSLATION_RESPONSE_INVALID', 'MiniMax translation response was not valid JSON', error));
                }
            });
        });
        request.on('error', error => reject(error?.code?.startsWith('TRANSLATION_')
            ? error
            : translationError('TRANSLATION_PROVIDER_UNAVAILABLE', 'MiniMax translation request failed', error)));
        const timer = setTimeout(() => {
            request.destroy(translationError('TRANSLATION_PROVIDER_TIMEOUT', 'MiniMax translation request timed out'));
        }, timeout || settings.timeoutMs);
        request.on('close', () => clearTimeout(timer));
        request.write(body);
        request.end();
    });
}

async function translateSupabaseWords(words, options = {}) {
    const uniqueWords = [...new Set((words || []).map(word => String(word || '').trim().toLowerCase()).filter(Boolean))];
    if (!uniqueWords.length) return {};
    const prompt = [
        'Translate these English vocabulary words into concise Simplified Chinese:',
        JSON.stringify(uniqueWords),
        'Return only one JSON object mapping each original word to its Chinese meaning.',
    ].join('\n');
    const request = typeof options.request === 'function' ? options.request : callMiniMax;
    const raw = await request(prompt);
    const match = String(raw || '').match(/\{[\s\S]*\}/);
    if (!match) {
        throw translationError('TRANSLATION_RESPONSE_INVALID', 'Word translation response did not contain a JSON object');
    }
    let parsed;
    try {
        parsed = JSON.parse(match[0]);
    } catch (error) {
        throw translationError('TRANSLATION_RESPONSE_INVALID', 'Word translation response contained invalid JSON', error);
    }
    const translated = Object.fromEntries(uniqueWords.map(word => [word, String(parsed?.[word] || '').trim()]));
    if (uniqueWords.some(word => !hasMeaningfulChineseMeaning(translated[word]))) {
        throw translationError('TRANSLATION_QUALITY_INVALID', 'Word translation response was incomplete or non-Chinese');
    }
    return translated;
}

async function translateSupabaseContext(sentence, options = {}) {
    const text = String(sentence || '').trim();
    if (!text) return '';
    const prompt = [
        'Translate this complete English sentence into natural Simplified Chinese:',
        JSON.stringify(text),
        'Return only the complete Chinese sentence. Do not explain or label the translation.',
    ].join('\n');
    const request = typeof options.request === 'function' ? options.request : callMiniMax;
    const raw = String(await request(prompt) || '').trim();
    const translated = raw.replace(/^```(?:text)?\s*|\s*```$/gi, '').trim();
    if (!isContextSentenceTranslationAcceptable({ type: 1, context: text, contextCN: translated })) {
        throw translationError('TRANSLATION_QUALITY_INVALID', 'Sentence translation was missing or incomplete');
    }
    return translated;
}

module.exports = {
    TranslationError,
    translateSupabaseContext,
    translateSupabaseWords,
};
