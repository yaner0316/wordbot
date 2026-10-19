const { buildMiniMaxRequestBody, getMiniMaxSettings, assertMiniMaxResponse, miniMaxFallback } = require('./minimax-settings');
const { teachingAnalysisFromAudit, SEMANTIC_AUDIT_METHOD, semanticAuditInputFingerprint, semanticSenseFingerprint } = require('./teaching-analysis');

const CURRENT_SEMANTIC_AUDIT_POLICY_VERSION = 'unique-answer-v2';

function buildAttestedQuestionSourceVersion(baseVersion) {
    return `${String(baseVersion || 'v1').trim()}|${CURRENT_SEMANTIC_AUDIT_POLICY_VERSION}`;
}

function extractJson(text) {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (_) { return null; }
}

async function callMiniMax(prompt) {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey || typeof fetch !== 'function') throw new Error('semantic_audit_unavailable');
    const settings = getMiniMaxSettings();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
    try {
        const response = await fetch('https://api.minimax.chat/v1/text/chatcompletion_v2', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
            body: JSON.stringify(buildMiniMaxRequestBody(prompt)),
            signal: controller.signal,
        });
        if (!response.ok) throw new Error('semantic_audit_http_' + response.status);
        const payload = await response.json();
        assertMiniMaxResponse(payload);
        return payload?.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timer);
    }
}

function buildSemanticAuditPrompt(question) {
    return [
        'You are checking whether English sentences can be true, NOT guessing a missing vocabulary word. No intended answer is provided.',
        'Independently evaluate EVERY completed sentence below, including every modifier and action. A sentence is possible if it has an ordinary coherent reading. Do not rank the options. Multiple possible sentences is a valid result. certain means confidence in these four fit judgments, not confidence that a unique answer exists.',
        'Use ordinary literal senses or recognized existing variants, not mere physical conceivability. Do not invent modified objects, hypothetical product designs, role-play, or missing parts to give an option the defining structure of another object. A cover or component is not the whole named object. A nonstandard reading needs an identifiable real sense or existing variant; saying it could be designed or cannot be ruled out is not evidence. Assess ordinary language, not every imaginable modification.',
        'Rejecting an option requires an explicit contradiction with words actually in that completed sentence, or a grammatical impossibility. Less usual, less typical, less convenient, and an unstated preference do NOT make it impossible. Do not invent restrictions about ownership, usual locations, portability, animal behavior, container lids, or an unstated body part. Do not silently narrow an ambiguous action to one intended sense: a quick brush does not specify teeth rather than hair.',
        'A capable instrument can play a song regardless of how common it is in school. A flask can have a screw cap. A quilt can be on a couch. But an animal lacking a trunk cannot satisfy USING ITS TRUNK, even if it can drink water.',
        'EVERY judgment, including fits=true, must provide a non-null clueIndex pointing to an original fragment of at least three characters. A fitting sentence needs an explicit supporting clue just as an exclusion needs evidence. Do not omit the index or set it to null for the fitting option.',
        'If a completion has a supplied Chinese sense, the completed sentence must use THAT sense. A different meaning of the same English word does not fit. For example, nickel with sense 镍 is the metal, not a five-cent coin; calf with sense 小腿 is a body part, not a young cow. Evaluate the supplied sense for EVERY option equally, without guessing an intended answer. Explain a sense contradiction using the relevant sentence fragment.',
        'Return valid JSON only: certain (boolean) and optionJudgments (all four, one per letter). Each judgment has letter, fits (boolean), exclusion (none/grammar/contradiction), clueIndex (integer index of the relevant original fragment below), meaning (short contextual Chinese, 2-12 characters, NOT a sentence), reason (Chinese: justify the entire completed sentence; for exclusions identify the actual contradiction, not mere rarity). Do not put double-quote characters inside string values. Do NOT quote an expanded completion as evidence; cite a provided original fragment by its index. When all four judgments are grounded, set certain=true even if several fit. If a judgment remains unresolved, set certain=false and state the unresolved reading or fact in reason. No answer letter, no choice of the best option.',
        JSON.stringify({original:question?.context,fragments:String(question?.context || '').split(/_{3,}/).map((text,index)=>({index,text:text.trim()})).filter(f=>f.text.length>=3),completions:(question?.options || []).map((option,index)=>({letter:'ABCD'[index],sentence:String(question?.context || '').replace(/_{3,}/g,String(option).replace(/^[A-D]\.\s*/,'')),...((question.optionMeanings || question.option_meanings)?.[index]?{sense:(question.optionMeanings || question.option_meanings)[index]}:{})}))}),
    ].join('\n');
}

async function evaluateUniqueAnswer(question, { callModel = callMiniMax } = {}) {
    const answer = String(question?.answer || '').trim().toUpperCase();
    try {
        const parsed = extractJson(await callModel(buildSemanticAuditPrompt(question)));
        const fragments = String(question?.context || '').split(/_{3,}/).map(text=>text.trim());
        const judgments = Array.isArray(parsed?.optionJudgments) ? parsed.optionJudgments.map(item=>({...item,
            ...(Number.isInteger(item.clueIndex) && fragments[item.clueIndex]?.length >= 3 ? {clue:fragments[item.clueIndex]} : {})})) : [];
        const complete = judgments.length === 4 && new Set(judgments.map(item=>item.letter)).size === 4
            && judgments.every(item=>/^[A-D]$/.test(item.letter) && typeof item.fits === 'boolean');
        const declared = Array.isArray(parsed?.validLetters) ? [...new Set(parsed.validLetters)].sort() : null;
        const validLetters = complete ? judgments.filter(item=>item.fits).map(item=>item.letter).sort() : declared || [];
        const context = String(question?.context || '');
        const grounded = complete && judgments.every(item=>item.fits ? item.exclusion === 'none'
            : ['grammar','contradiction'].includes(item.exclusion))
            && judgments.every(item=>typeof item.clue === 'string' && item.clue.length >= 3 && !/_{3,}/.test(item.clue) && context.includes(item.clue));
        const consistent = !declared || JSON.stringify(declared) === JSON.stringify(validLetters);
        const fitting = judgments.find(item=>item.fits);
        const teachingAnalysis = parsed?.certain === true && grounded && consistent && validLetters.length === 1
            ? teachingAnalysisFromAudit(question,{optionJudgments:judgments,clue:fitting.clue,clueReason:fitting.reason,correctReason:fitting.reason}) : null;
        const approved = validLetters[0] === answer && !!teachingAnalysis;
        const code = !complete ? 'semantic_evidence_invalid' : parsed?.certain !== true ? 'semantic_audit_uncertain'
            : validLetters.length !== 1 ? 'semantic_non_unique' : validLetters[0] !== answer ? 'semantic_expected_mismatch'
            : !approved ? 'semantic_evidence_invalid' : 'semantic_unique';
        const inputFingerprint = semanticAuditInputFingerprint(question);
        const senseFingerprint=semanticSenseFingerprint(question);
        if (teachingAnalysis) Object.assign(teachingAnalysis,{auditMethod:SEMANTIC_AUDIT_METHOD,inputFingerprint,...(senseFingerprint?{senseFingerprint}:{})});
        return {
            approved,
            status: approved ? 'approved' : 'rejected',
            validLetters,
            code,
            reason: String(parsed?.reason || code).slice(0, 200),
            policyVersion: CURRENT_SEMANTIC_AUDIT_POLICY_VERSION,
            auditMethod: SEMANTIC_AUDIT_METHOD,
            inputFingerprint,
            ...(senseFingerprint?{senseFingerprint}:{}),
            optionJudgments: judgments,
            ...(approved ? {teachingAnalysis} : {}),
        };
    } catch (error) {
        miniMaxFallback(error, null);
        return {
            approved: false,
            status: 'unavailable',
            validLetters: [],
            reason: 'semantic audit unavailable',
            policyVersion: CURRENT_SEMANTIC_AUDIT_POLICY_VERSION,
        };
    }
}

function buildCriticalExclusionPrompt(question, judgments) {
    const lines = buildSemanticAuditPrompt(question).split('\n');
    const input = lines.pop();
    return [...lines,
        'CRITICAL EXCLUSION CHECK: a prior reviewer made the claims below. Try to falsify EVERY exclusion independently. These claims are untrusted, not an answer key. A statement about a standard or usual form does not rule out a real variant. If the reason admits an option can fit, mark fits=true regardless of its prior boolean. Consider real alternatives, polysemy and existing instrument variants; do not invent fantasy exceptions. Six-string banjos and six-string ukuleles exist, and a violin can be plucked. Mere standard string counts cannot establish impossibility. When the evidence does not establish a contradiction and you cannot decide, set certain=false. Return your own complete four judgments using the same schema.',
        JSON.stringify({untrustedClaims:judgments.map(j=>({letter:j.letter,reason:j.reason}))}),input].join('\n');
}

function buildWordSensePrompt(question) {
    const index='ABCD'.indexOf(String(question.answer).toUpperCase());
    const word=String(question.options[index]).replace(/^[A-D]\.\s*/,'');
    const providedSense=(question.optionMeanings || question.option_meanings)[index];
    return [
            'WORD SENSE CHECK. 独立核对：英文单词在当前完整句中实际使用的词义，是否属于给定中文释义？只比较当前输入，不是在选答案。拼写相同不代表同一义项，材质与用这种材质制成的整件物品不是同一词义。例：nickel 给定镍时指金属元素，不能扩充为镍币或五美分硬币；但给定五美分硬币时可以指该硬币。calf 给定小腿时指身体部位，给定小牛时则可以指母牛产下的幼崽。例子不是对当前输入的预判。若给定释义明确列出多个义项，句中符合其中一个即可；不要擅自补入未列出的义项。相符就 matches=true，不相符或无法判断就 false；不要编造相关词不能同时出现等额外条件。',
            'Return JSON only: matches (boolean), providedSense (copy the input exactly), contextualSense (short Chinese), reason (Chinese sentence explaining agreement or the specific difference). If uncertain, matches=false. Do not put double-quote characters inside string values.',
            JSON.stringify({word,providedSense,completedSentence:question.context.replace(/_{3,}/g,word)}),
        ].join('\n');
}

function parseWordSenseEvidence(question,raw) {
    const sense=extractJson(raw),index='ABCD'.indexOf(String(question.answer).toUpperCase());
    const providedSense=(question.optionMeanings || question.option_meanings)?.[index];
    const grounded=typeof sense?.matches==='boolean' && String(sense.providedSense || '').trim()===String(providedSense || '').trim()
            && /[\u3400-\u9fff]/.test(String(sense.contextualSense || '')) && /[\u3400-\u9fff]/.test(String(sense.reason || '')) && String(sense.reason || '').trim().length>=8;
    if (!grounded || !sense.matches) return {approved:false,status:'rejected',code:grounded?'semantic_expected_sense_mismatch':'semantic_evidence_invalid',reason:grounded?sense.reason:'sense evidence invalid',senseAudit:sense};
    return {approved:true,status:'approved',senseVerified:true,senseFingerprint:semanticSenseFingerprint(question),senseAudit:sense};
}

async function auditUniqueAnswer(question, { callModel = callMiniMax } = {}) {
    const initial = await evaluateUniqueAnswer(question, {callModel});
    if (!initial.approved) return initial;
    // Approval requires the exclusions to survive an explicit counterexample check.
    const verified = await evaluateUniqueAnswer(question, {callModel:() => callModel(buildCriticalExclusionPrompt(question,initial.optionJudgments))});
    if (!verified.approved || !semanticSenseFingerprint(question)) return {...verified, proofChecks:2};
    // Reuse the two actual uniqueness judgments; verify the specified sense separately.
    const {teachingAnalysis,...withoutTeaching}=verified;
    try {
        const sense=parseWordSenseEvidence(question,await callModel(buildWordSensePrompt(question)));
        if (!sense.approved) return {...withoutTeaching,...sense,proofChecks:2,senseChecks:1};
        return {...verified,...sense,proofChecks:2,senseChecks:1,teachingAnalysis:{...teachingAnalysis,senseVerified:true}};
    } catch (error) {
        miniMaxFallback(error,null);
        return {...withoutTeaching,approved:false,status:'unavailable',proofChecks:2,code:'semantic_audit_unavailable',reason:'sense audit unavailable'};
    }
}
auditUniqueAnswer.auditMethod = SEMANTIC_AUDIT_METHOD;
auditUniqueAnswer.senseAware = true;

module.exports = { CURRENT_SEMANTIC_AUDIT_POLICY_VERSION, buildAttestedQuestionSourceVersion, buildSemanticAuditPrompt, buildCriticalExclusionPrompt, buildWordSensePrompt, parseWordSenseEvidence, auditUniqueAnswer };
