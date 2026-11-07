const { SURFACE_POLICY, parseSurfaceEvidence } = require('./question-surface');
const { CONTENT_REVIEW_POLICY, contentReviewPrompt, parseContentReview } = require('./question-content-review');
const { buildMiniMaxRequestBody, getMiniMaxSettings, assertMiniMaxResponse, miniMaxFallback } = require('./minimax-settings');
const { teachingAnalysisFromAudit, SEMANTIC_AUDIT_METHOD, semanticAuditInputFingerprint, semanticSenseFingerprint } = require('./teaching-analysis');
const { LEVEL_FIT_POLICY, levelFitPrompt, parseLevelFitEvidence } = require('./high-school-fit');

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
        'Judge the printed English words across ALL their ordinary senses. No hidden option glossary may restrict a distractor to one dictionary sense: the learner sees the English option, so any ordinary meaning that fits counts. The intended learning sense is checked separately only after English uniqueness is established.',
        'For each judgment also copy word exactly from that completion. Keep letter and word paired: never explain one word under another letter. The meaning field is the meaning of that word alone, not a paraphrase of the whole sentence or the desired answer. Choose the fragment containing the actual distinguishing clue, not a generic subject or introductory verb. Explain only the printed option; do not silently replace it with a synonym.',
        'Return valid JSON only: certain (boolean) and optionJudgments (all four, one per letter). Each judgment has letter, word (copy the completion input word exactly), fits (boolean), exclusion (none/grammar/contradiction), clueIndex (integer index of the relevant original fragment below), meaning (Chinese dictionary meaning of word ALONE, 2-12 characters, never the surrounding clue, attribute, or full action), reason (Chinese: justify the entire completed sentence; for exclusions identify the actual contradiction, not mere rarity). Do not put double-quote characters inside string values. Do NOT quote an expanded completion as evidence; cite a provided original fragment by its index. When all four judgments are grounded, set certain=true even if several fit. If a judgment remains unresolved, set certain=false and state the unresolved reading or fact in reason. No answer letter, no choice of the best option.',
        JSON.stringify({original:question?.context,fragments:String(question?.context || '').split(/_{3,}/).map((text,index)=>({index,text:text.trim()})).filter(f=>f.text.length>=3),completions:(question?.options || []).map((option,index)=>({letter:'ABCD'[index],word:String(option).replace(/^[A-D]\.\s*/,''),sentence:String(question?.context || '').replace(/_{3,}/g,String(option).replace(/^[A-D]\.\s*/,''))}))}),
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
            && judgments.every(item=>/^[A-D]$/.test(item.letter) && typeof item.fits === 'boolean'
                && (!question.requireContentReview || item.word === String(question.options['ABCD'.indexOf(item.letter)]).replace(/^[A-D]\.\s*/,'')));
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

function buildCriticalExclusionPrompt(question) {
    const lines = buildSemanticAuditPrompt(question).split('\n');
    const input = lines.pop();
    return [...lines,
        'CRITICAL EXCLUSION CHECK: independently look for an ordinary coherent reading of EVERY completed sentence before excluding it. You receive no prior reviewer judgments or proposed answer. A statement about a standard or usual form does not rule out a real variant. Consider real alternatives, polysemy and existing instrument variants; do not invent fantasy exceptions. Six-string banjos and six-string ukuleles exist, and a violin can be plucked. Mere standard string counts cannot establish impossibility. When the evidence does not establish a contradiction and you cannot decide, set certain=false. Return your own complete four judgments using the same schema.',
        input].join('\n');
}

function buildWordSensePrompt(question) {
    const index='ABCD'.indexOf(String(question.answer).toUpperCase());
    const word=String(question.options[index]).replace(/^[A-D]\.\s*/,'');
    const providedSense=(question.optionMeanings || question.option_meanings)[index];
    return [
            'WORD SENSE CHECK. 独立核对：英文单词在当前完整句中实际使用的词义，是否属于给定中文释义？只比较当前输入，不是在选答案。拼写相同不代表同一义项，材质与用这种材质制成的整件物品不是同一词义。例：nickel 给定镍时指金属元素，不能扩充为镍币或五美分硬币；但给定五美分硬币时可以指该硬币。calf 给定小腿时指身体部位，给定小牛时则可以指母牛产下的幼崽。例子不是对当前输入的预判。若给定释义明确列出多个义项，句中符合其中一个即可；不要擅自补入未列出的义项。相符就 matches=true，不相符或无法判断就 false；不要编造相关词不能同时出现等额外条件。',
            '给定释义可以比句中实例宽泛：没有额外限定的键盘包括电脑键盘和钢琴键盘，杯子包括陶瓷杯；不能因为释义没有逐项列出普通子类或用途就拒绝。只有给定释义本身明确限定为电脑键盘时，钢琴键盘才不符。具体实例与一般类别的关系，不等于另一词义或材质与制品的关系。',
            '只判断 markedSentence 中用« »标出的那个词，不要把同句其他词或主句的情绪误当成它的词义。先说明该词在所在分句中的实际用法和词义，再对照给定释义，最后给出布尔结论；解释若承认属于给定义项，matches不能又写false。',
            'Return ONE JSON object with top-level providedSense (copy the input exactly), contextualSense (short Chinese), reason (brief Chinese justification), matches (boolean), surface, levelFit, and contentReview when requested. If uncertain, matches=false. Each evidence section is an object, never an array of objects. Do not put double-quote characters inside string values.',
            'Also check the EXACT printed grammar, inflection, spelling and capitalization of ALL FOUR completions. Do not silently correct them. Ignore semantic contradictions for this grammar check. All four options must be grammatically usable in the blank: grammatical mismatch is not an acceptable distractor clue. Check modals followed by base verbs, subject agreement, noun number, parallel lists, proper names and sentence-initial capitalization.',
            'Add surface: {options:[{letter,word,grammatical,reason}]} for all four letters; copy word exactly; grammatical is boolean, reason is a brief Chinese explanation. A noun such as recreation cannot follow can as a verb. A correct answer with invalid grammar requires a new context; a malformed distractor requires replacement.',
            'Separate syntax from truth: a grammatically formed sentence may describe a false or impossible event. For example, The wooden spoon has a graphite tip is grammatically correct even though ordinary spoons have no graphite tip. Such a semantic contradiction must NOT set grammatical=false. If your reason admits the syntax is valid, grammatical must be true. Do not repeat the uniqueness decision as a grammar judgment.',
            levelFitPrompt(question),
            question.requireContentReview ? contentReviewPrompt(question) : '',
            'Before returning, check JSON shape: surface must be {"options":[...four judgments...]}, not [{"options":[...]}]. levelFit.clueIndex must select an originalFragments item beside the blank. Do not return levelFit.clue or a completed sentence as evidence. Do not omit other evidence sections after a negative sense judgment.',
            JSON.stringify({word,providedSense,completedSentence:question.context.replace(/_{3,}/g,word),markedSentence:question.context.replace(/_{3,}/g,'«'+word+'»'),completions:question.options.map((option,index)=>({letter:'ABCD'[index],word:String(option).replace(/^[A-D]\.\s*/,''),sentence:question.context.replace(/_{3,}/g,String(option).replace(/^[A-D]\.\s*/,''))}))}),
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
    // A malformed distractor is a repair request, not proof of vocabulary mastery.
    // Never let a subsequent model response overwrite a recorded grammar failure.
    const grammarFailure = review => question.level && review.optionJudgments?.some(item => item.exclusion === 'grammar')
        ? {...review, approved:false, status:'rejected', code:'surface_distractors', teachingAnalysis:undefined} : null;
    if (grammarFailure(initial)) return grammarFailure(initial);
    // Approval requires the exclusions to survive an explicit counterexample check.
    const verified = await evaluateUniqueAnswer(question, {callModel:() => callModel(buildCriticalExclusionPrompt(question))});
    if (!verified.approved) return {...verified, proofChecks:2};
    if (grammarFailure(verified)) return {...grammarFailure(verified), proofChecks:2};
    if (!semanticSenseFingerprint(question)) return question.level
        ? {...verified,approved:false,status:'rejected',code:'level_fit_evidence_invalid',teachingAnalysis:undefined,proofChecks:2}
        : {...verified,proofChecks:2};
    // Reuse the two actual uniqueness judgments; verify the specified sense separately.
    const {teachingAnalysis,...withoutTeaching}=verified;
    try {
        const raw = await callModel(buildWordSensePrompt(question));
        const surface = question.level ? parseSurfaceEvidence(question,extractJson(raw)?.surface) : {approved:true};
        if (!surface.approved) return {...withoutTeaching,...surface,proofChecks:2,senseChecks:1};
        const sense=parseWordSenseEvidence(question,raw);
        if (!sense.approved) return {...withoutTeaching,...sense,proofChecks:2,senseChecks:1};
        const fit = parseLevelFitEvidence(question,extractJson(raw)?.levelFit);
        if (!fit.approved) return {...withoutTeaching,...fit,proofChecks:2,senseChecks:1};
        const content=question.requireContentReview ? parseContentReview(question,extractJson(raw)?.contentReview,{requireOptionSeparation:true}) : {approved:true};
        if (!content.approved) return {...withoutTeaching,...content,proofChecks:2,senseChecks:1};
        return {...verified,...sense,...fit,proofChecks:2,senseChecks:1,teachingAnalysis:{...teachingAnalysis,...(surface.surface ? {surface:surface.surface} : {}),senseVerified:true,...(fit.levelFit ? {levelFit:fit.levelFit} : {}),...(content.contentReview ? {contentReview:content.contentReview} : {})}};
    } catch (error) {
        miniMaxFallback(error,null);
        return {...withoutTeaching,approved:false,status:'unavailable',proofChecks:2,code:'semantic_audit_unavailable',reason:'sense audit unavailable'};
    }
}
auditUniqueAnswer.auditMethod = SEMANTIC_AUDIT_METHOD;
auditUniqueAnswer.senseAware = true;
auditUniqueAnswer.surfacePolicy = SURFACE_POLICY;
auditUniqueAnswer.contentPolicy = CONTENT_REVIEW_POLICY;
auditUniqueAnswer.levelFitPolicy = LEVEL_FIT_POLICY;

module.exports = { CURRENT_SEMANTIC_AUDIT_POLICY_VERSION, buildAttestedQuestionSourceVersion, buildSemanticAuditPrompt, buildCriticalExclusionPrompt, buildWordSensePrompt, parseWordSenseEvidence, auditUniqueAnswer };
