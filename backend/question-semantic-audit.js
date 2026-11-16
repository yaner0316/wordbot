const {QUESTION_POLICY,stemInput,stemFingerprint,optionFingerprint,hasCurrentStemReview}=require('./question-policy');
const {isPrimaryLevel}=require('./learning-level');
const {levelGuidance,isSupportedLevel}=require('./high-school-fit');
const {admitsGrammarDefect}=require('./audit-reason-consistency');
const { CONTENT_REVIEW_POLICY, contentReviewPrompt, parseContentReview } = require('./question-content-review');
const { buildMiniMaxRequestBody, getMiniMaxSettings, assertMiniMaxHttpStatus, isMiniMaxProviderError, assertMiniMaxResponse, miniMaxFallback } = require('./minimax-settings');
const { teachingAnalysisFromAudit, SEMANTIC_AUDIT_METHOD, semanticAuditInputFingerprint, semanticSenseFingerprint } = require('./teaching-analysis');


const CURRENT_SEMANTIC_AUDIT_POLICY_VERSION = 'unique-answer-v3';

function buildAttestedQuestionSourceVersion(baseVersion) {
    return `${String(baseVersion || 'v1').trim()}|${CURRENT_SEMANTIC_AUDIT_POLICY_VERSION}|${QUESTION_POLICY}`;
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
        if (!response.ok) assertMiniMaxHttpStatus(response.status);
        const payload = await response.json();
        assertMiniMaxResponse(payload);
        return payload?.choices?.[0]?.message?.content || '';
    } finally {
        clearTimeout(timer);
    }
}

function buildSemanticAuditPrompt(question) {
    return [
        'You are checking whether English sentences have an ordinary coherent reading supported by the stated context, NOT guessing a missing vocabulary word. No intended answer is provided.',
        'Independently evaluate EVERY completed sentence below, including every modifier, action and causal link. A sentence fits when its ordinary reading follows the stated situation without adding a rescue story. Do not rank the options. Multiple supported readings is a valid result. certain means confidence in these four fit judgments, not confidence that a unique answer exists.',
        'Use ordinary literal senses or recognized existing variants, not mere physical conceivability. Do not invent modified objects, hypothetical product designs, role-play, or missing parts to give an option the defining structure of another object. A cover or component is not the whole named object. A nonstandard reading needs an identifiable real sense or existing variant; saying it could be designed or cannot be ruled out is not evidence. Assess ordinary language, not every imaginable modification.',
        'Reject an option for a grammatical impossibility, a contradiction with the stated context, or a reading that requires an unstated premise. Do not add unstated motives, actions, or background to rescue an option. Possibility in a story you can imagine is not support in this sentence. In particular, do not invent hidden intentions or preferences, extra events before or after the stated action, an accidental second action, or a special role or setting solely to make a distractor fit. Preserve the printed causal, temporal and referential links.',
        'Distinguish missing rescue premises from ordinary word meanings and shared world knowledge. The action explicitly asserted by a completion is not itself an added premise. A person can perform an ordinary stated action outside their usual profession without inventing a second occupation or hobby. Less usual or less typical alone is NOT a reason to exclude. Do not invent restrictions about ownership, locations, portability or body parts. Do not silently narrow a genuinely ambiguous action to one intended sense: a quick brush does not specify teeth rather than hair. Apply the same standard to ALL options; do not force uniqueness.',
        'For EVERY judgment return addedPremises: an array of the specific unstated motives, actions or background required to make that reading work. Use [] if none are required. If a reading works only after adding such premises, set fits=false, exclusion=unstated_premise, list them and explain why the printed context does not supply them. fits=true requires addedPremises=[] and exclusion=none. For grammar or contradiction exclusions use addedPremises=[] and identify the printed defect. If unsure whether a premise is needed, set certain=false. Do not label a real, already supported alternative as an unstated premise just to exclude it.',
        'A capable instrument can play a song regardless of how common it is in school. A flask can have a screw cap. A quilt can be on a couch. But an animal lacking a trunk cannot satisfy USING ITS TRUNK, even if it can drink water.',
        'EVERY judgment, including fits=true, must provide a non-null clueIndex pointing to an original fragment of at least three characters. A fitting sentence needs an explicit supporting clue just as an exclusion needs evidence. Do not omit the index or set it to null for the fitting option.',
        'Judge the printed English words across ALL their ordinary senses. No hidden option glossary may restrict a distractor to one dictionary sense: the learner sees the English option, so any ordinary meaning that fits counts. The intended learning sense is checked separately only after English uniqueness is established.',
        'For each judgment also copy word exactly from that completion. Keep letter and word paired: never explain one word under another letter. The meaning field is the meaning of that word alone, not a paraphrase of the whole sentence or the desired answer. Choose the fragment containing the actual distinguishing clue, not a generic subject or introductory verb. Explain only the printed option; do not silently replace it with a synonym.',
        'Also return wordValid (boolean: real correctly formed word/phrase, independent of fitting this blank), levelSuitable (boolean: no unsupported lexical burden), and grammatical (boolean) for each exact completion. Judge grammar separately from semantic truth. Do not silently correct a verb or insert words: if the printed completion needs such a correction, grammatical=false, fits=false, exclusion=grammar. Every conclusion must agree with its reason, even if this means no option fits.',
        'A different part of speech may legitimately fail this blank; that does not make the option malformed. Do not reject two wrong choices just because their meanings overlap. Return semanticDiscrimination:boolean: at least one grammatically usable wrong alternative must require meaning/context to exclude; reject a question solvable solely by POS or option formatting.',
        levelGuidance(question.level),
        'Return valid JSON only: semanticDiscrimination (boolean), certain (boolean) and optionJudgments (all four, one per letter). Each judgment has grammatical (boolean), wordValid (boolean), levelSuitable (boolean), letter, word (copy the completion input word exactly), fits (boolean), exclusion (none/grammar/contradiction/unstated_premise), addedPremises (array of Chinese strings), clueIndex (integer index of the relevant original fragment below), meaning (Chinese dictionary meaning of word ALONE, 2-12 characters, never the surrounding clue, attribute, or full action), reason (Chinese: justify the entire completed sentence; for exclusions identify the actual contradiction, grammatical defect or required unstated premise, not mere rarity). Do not put double-quote characters inside string values. Do NOT quote an expanded completion as evidence; cite a provided original fragment by its index. When all four judgments are grounded, set certain=true even if several fit. If a judgment remains unresolved, set certain=false and state the unresolved reading or fact in reason. No answer letter, no choice of the best option.',
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
        // Formal evidence must say whether a reading needs invented circumstances.
        // A contradictory label is a re-audit request, never an automatic exclusion.
        const premiseEvidenceValid = complete && judgments.every(item=>{
            if (item.addedPremises === undefined && !question.requireContentReview && item.exclusion !== 'unstated_premise') return true;
            if (!Array.isArray(item.addedPremises) || !item.addedPremises.every(p=>typeof p==='string' && p.trim().length>0)) return false;
            return item.exclusion === 'unstated_premise'
                ? item.fits === false && item.addedPremises.length>0
                : item.addedPremises.length===0;
        });
        const grounded = complete && judgments.every(item=>item.fits ? item.exclusion === 'none'
            : ['grammar','contradiction','unstated_premise'].includes(item.exclusion)) && premiseEvidenceValid
            && judgments.every(item=>typeof item.clue === 'string' && item.clue.length >= 3 && !/_{3,}/.test(item.clue) && context.includes(item.clue));
        const consistent = !declared || JSON.stringify(declared) === JSON.stringify(validLetters);
        const fitting = judgments.find(item=>item.fits);
        const teachingAnalysis = parsed?.certain === true && grounded && consistent && validLetters.length === 1
            ? teachingAnalysisFromAudit(question,{optionJudgments:judgments,clue:fitting.clue,clueReason:fitting.reason,correctReason:fitting.reason}) : null;
        const approved = validLetters[0] === answer && !!teachingAnalysis;
        const code = !complete || !premiseEvidenceValid ? 'semantic_evidence_invalid' : parsed?.certain !== true ? 'semantic_audit_uncertain'
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
            semanticDiscrimination:parsed?.semanticDiscrimination,
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

function parseWordSenseEvidence(question,raw) {
    const sense=extractJson(raw),index='ABCD'.indexOf(String(question.answer).toUpperCase());
    const printedWord=String(question.options[index]).replace(/^[A-D]\.\s*/,'');
    const changed=question.word && String(question.word).toLowerCase()!==printedWord.toLowerCase();
    if (changed) {
        const e=sense?.targetInflection;
        const complete=e?.baseWord===question.word && e?.printedWord===printedWord && typeof e.sameLexeme==='boolean'
            && ['noun_number','verb_inflection','adjective_degree','other_inflection','invalid'].includes(e.change)
            && /[\u3400-\u9fff]/.test(String(e.reason || '')) && String(e.reason || '').length>=8;
        if (!complete || !e.sameLexeme || e.change==='invalid' || isPrimaryLevel(question.level) && e.change!=='noun_number')
            return {approved:false,status:'rejected',code:complete?'semantic_expected_sense_mismatch':'semantic_evidence_invalid',reason:e?.reason || 'target inflection evidence missing',senseAudit:sense};
    }
    const providedSense=(question.optionMeanings || question.option_meanings)?.[index];
    const grounded=typeof sense?.matches==='boolean' && String(sense.providedSense || '').trim()===String(providedSense || '').trim()
            && /[\u3400-\u9fff]/.test(String(sense.contextualSense || '')) && /[\u3400-\u9fff]/.test(String(sense.reason || '')) && String(sense.reason || '').trim().length>=8;
    if (!grounded || !sense.matches) return {approved:false,status:'rejected',code:grounded?'semantic_expected_sense_mismatch':'semantic_evidence_invalid',reason:grounded?sense.reason:'sense evidence invalid',senseAudit:sense};
    return {approved:true,status:'approved',senseVerified:true,...(changed?{targetFormVerified:true}:{}),senseFingerprint:semanticSenseFingerprint(question),senseAudit:sense};
}

const STEM_CHECKS=['grammar','naturalness','sense','form','level','clue','burden'];
const validReason=value=>typeof value==='string' && value.trim().length>=8 && /[\u3400-\u9fff]/.test(value);
function buildStemReviewPrompt(question) {
    const input=stemInput(question);
    return [
        'STEM REVIEW. Review ONLY the English stem with the printed target filled in, before options or translations exist. No uniqueness judgment at this stage.',
        'Check grammar/completeness (no sentence fragments), naturalness, selected sense/POS, legal target form, learner level, a useful stated clue to the target meaning, and reading burden. Multiple complete sentences are allowed. There is NO word-count or clause-count ceiling. Identify actual unsupported language, inference/background knowledge or unnecessary padding; length alone is not a defect.',
        'The selected sense must actually be used in the sentence. A broad meaning may include its ordinary concrete subtypes; a noun cannot silently become a different verb sense. If the sentence uses another sense, revise English, never rewrite the selected Chinese meaning.',
        isPrimaryLevel(input.level)
            ? '小学两档：Only noun singular/plural changes are permitted. Keep target verbs exactly in the supplied form, and do not change adjective degree. This restriction concerns the target, not every supporting verb in the sentence.'
            : 'Junior-secondary and above permit grammatical inflection of the same lexical entry, sense and POS. No synonyms or derivationally different words.',
        levelGuidance(input.level),
        'Return JSON {certain:boolean,checks:{grammar:{pass:boolean,evidence:exact substring of completedSentence,reason:Chinese},naturalness:{...},sense:{...},form:{...},level:{...},clue:{...},burden:{...}}}. Each check must cite the actual input and explain its conclusion (at least 8 Chinese/mixed characters), not just appropriate. A stated defect cannot accompany pass=true. Uncertain evidence cannot approve.',
        input.word.toLowerCase()!==input.targetForm.toLowerCase()
            ? 'Also return targetInflection:{baseWord:copy canonical word,printedWord:copy targetForm,sameLexeme:boolean,change:noun_number/verb_inflection/adjective_degree/other_inflection/invalid,reason:Chinese evidence}. Similar spelling alone is not lexical identity.' : '',
        JSON.stringify({...input,completedSentence:input.context.replace(/_{3,}/g,input.targetForm)}),
    ].filter(Boolean).join('\n');
}
function parseStemReview(question,parsed) {
    const input=stemInput(question),completed=input.context.replace(/_{3,}/g,input.targetForm);
    if (!isSupportedLevel(input.level)) return {approved:false,status:'rejected',code:'level_fit_unsupported',reason:'不支持的学习难度。'};
    const checks=parsed?.checks;
    const invalid=()=>({approved:false,status:'rejected',code:'stem_evidence_invalid',reason:'题干审核证据缺失或与输入不一致。'});
    if (!input.word || !input.targetForm || !input.targetMeaning || !input.level || !checks
        || !STEM_CHECKS.every(key=>typeof checks[key]?.pass==='boolean' && validReason(checks[key]?.reason)
            && typeof checks[key]?.evidence==='string' && checks[key].evidence.length>=2 && completed.includes(checks[key].evidence))) return invalid();
    const failures=STEM_CHECKS.filter(key=>!checks[key].pass);
    if (checks.grammar.pass && admitsGrammarDefect(checks.grammar.reason)) return invalid();
    if (failures.length) {
        const code=failures.includes('sense') || failures.includes('form') ? 'semantic_expected_sense_mismatch'
            : failures.includes('level') || failures.includes('burden') ? 'level_fit_context' : 'surface_context';
        return {approved:false,status:'rejected',code,reason:failures.map(key=>checks[key].reason).join('; '),repairEvidence:failures.map(key=>({check:key,...checks[key]}))};
    }
    if (parsed.certain!==true) return invalid();
    const changed=input.word.toLowerCase()!==input.targetForm.toLowerCase();
    if (changed) {
        const e=parsed.targetInflection;
        if (e?.baseWord!==input.word || e?.printedWord!==input.targetForm || e.sameLexeme!==true || !validReason(e.reason)
            || !['noun_number','verb_inflection','adjective_degree','other_inflection'].includes(e.change)
            || isPrimaryLevel(input.level) && e.change!=='noun_number')
            return {approved:false,status:'rejected',code:'semantic_expected_sense_mismatch',reason:e?.reason || '目标词形缺少同词条证据。',repairEvidence:[e || {}]};
    }
    return {approved:true,status:'approved',policy:QUESTION_POLICY,inputFingerprint:stemFingerprint(question),checks,
        ...(changed?{targetFormVerified:true,targetInflection:parsed.targetInflection}:{})};
}
async function auditStem(question,{callModel=callMiniMax}={}) {
    try {return parseStemReview(question,extractJson(await callModel(buildStemReviewPrompt(question))));}
    catch(error) {miniMaxFallback(error,null);return {approved:false,status:'unavailable',code:'stem_audit_unavailable',reason:'题干审核暂不可用。'};}
}
async function auditOptions(question,{callModel=callMiniMax}={}) {
    const result=await evaluateUniqueAnswer({...question,requireContentReview:true},{callModel});
    const correct=result.optionJudgments?.find(item=>item.letter===question.answer);
    if (correct && (correct.grammatical===false || admitsGrammarDefect(correct.reason)))
        return {...result,approved:false,status:'rejected',code:'surface_context',reason:correct.reason,repairEvidence:[correct],teachingAnalysis:undefined};
    if (!result.approved) return result;
    const invalid=code=>({...result,approved:false,status:'rejected',code,teachingAnalysis:undefined,
        reason:result.optionJudgments.map(item=>item.word+': '+item.reason).join('; '),repairEvidence:result.optionJudgments});
    if (!result.optionJudgments.every(item=>typeof item.grammatical==='boolean' && typeof item.wordValid==='boolean' && typeof item.levelSuitable==='boolean'
        && (!item.fits || item.grammatical) && (item.grammatical || item.exclusion==='grammar')
        && !(item.grammatical && admitsGrammarDefect(item.reason)))) return invalid('semantic_evidence_invalid');
    if (result.optionJudgments.some(item=>!item.wordValid)) return invalid('surface_distractors');
    if (result.optionJudgments.some(item=>!item.levelSuitable)) return invalid('level_fit_distractors');
    if (result.semanticDiscrimination!==true || !result.optionJudgments.some(item=>!item.fits && item.grammatical)) return invalid('options_no_semantic_discrimination');
    return {...result,policy:QUESTION_POLICY,optionFingerprint:optionFingerprint(question),proofChecks:1};
}
async function auditTranslation(question,{callModel=callMiniMax}={}) {
    try {
        const parsed=extractJson(await callModel(contentReviewPrompt(question))),e=parsed?.contentReview;
        if (typeof e?.targetSense?.matches!=='boolean' || !validReason(e.targetSense.reason) || !/[\u3400-\u9fff]/.test(e.targetSense.contextualSense || ''))
            return {approved:false,status:'rejected',code:'content_review_missing',reason:'词义核对证据不完整。'};
        if (!e.targetSense.matches) return {approved:false,status:'rejected',code:'semantic_expected_sense_mismatch',reason:e.targetSense.reason,repairEvidence:[e.targetSense]};
        return parseContentReview(question,e);
    } catch(error) {miniMaxFallback(error,null);return {approved:false,status:'unavailable',code:'translation_audit_unavailable',reason:'翻译审核暂不可用。'};}
}
async function auditUniqueAnswer(question,{callModel=callMiniMax}={}) {
    const stem=hasCurrentStemReview(question,question.stemReview) ? question.stemReview : await auditStem(question,{callModel});
    if (!stem.approved) return stem;
    const saved=question.optionReview;
    const options=saved?.approved && saved.policy===QUESTION_POLICY && saved.optionFingerprint===optionFingerprint(question)
        ? saved : await auditOptions(question,{callModel});
    if (!options.approved) return options;
    const translation=await auditTranslation(question,{callModel});
    if (!translation.approved) return {...translation,validLetters:options.validLetters,proofChecks:1};
    const senseFingerprint=semanticSenseFingerprint(question);
    return {...options,senseVerified:true,senseFingerprint,targetFormVerified:stem.targetFormVerified===true,
        teachingAnalysis:{...options.teachingAnalysis,policy:QUESTION_POLICY,canonicalWord:question.word,stemReview:stem,
            senseVerified:true,senseFingerprint,contentReview:translation.contentReview}};
}
auditUniqueAnswer.auditMethod=SEMANTIC_AUDIT_METHOD;
auditUniqueAnswer.senseAware=true;
auditUniqueAnswer.contentPolicy=CONTENT_REVIEW_POLICY;
auditUniqueAnswer.questionPolicy=QUESTION_POLICY;
auditUniqueAnswer.auditStem=auditStem;
auditUniqueAnswer.auditOptions=auditOptions;
module.exports={CURRENT_SEMANTIC_AUDIT_POLICY_VERSION,buildAttestedQuestionSourceVersion,buildSemanticAuditPrompt,
    buildStemReviewPrompt,parseStemReview,parseWordSenseEvidence,auditStem,auditOptions,auditTranslation,auditUniqueAnswer};
