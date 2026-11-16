'use strict';
// Conservative guards for explicit admissions, not a general natural-language proof.
// Keep negated claims out of positive matching; contradictory positive claims still reject.
function positiveClaims(reason) {
    return String(reason || '')
        // Negation can govern an explicit list, e.g. "无残句或语法错误".
        // Match only named defects and list conjunctions, never a later clause.
        .replace(/(?:不存在|没有|并无|无)(?:任何|明显的?)?(?:(?:句子残缺|残句|语法错误|语法问题|词形问题)(?:或|和|及|、)(?:任何|明显的?)?)+(?:句子残缺|残句|语法错误|语法问题|词形问题)/g, '')
        .replace(/(?:不存在|没有|并无|并非|不是|不构成|不属于|无)(?:任何|明显的?)?(?:互相|相互|彼此)包含(?:关系)?/g, '')
        .replace(/(?:不存在|没有|并无|无|不是|并非|不构成|不属于|不存在任何)(?:任何|明显的?)?(?:语法错误|语法问题|词形问题|包含关系|同义关系|同义词)/g, '')
        .replace(/(?:无需|不必|不需要)(?:改为|改成|修改|纠正)[^，。；;]*/g, '')
        .replace(/(?:neither|not|no)\s+(?:grammatical errors?|grammar errors?|inclusion|synonymy)/gi, '');
}
function admitsGrammarDefect(reason) {
    const text=positiveClaims(reason);
    return /(?:存在|有|出现|属于)(?:明显的?)?语法(?:错误|问题)|不合语法|语法(?:不正确|不成立|不通|错误)|(?:主语|动词|时态|词形|单复数)[^，。；;]{0,35}(?:不一致|不匹配)|(?:应改为|应改成|应写为|过去式应为|第三人称单数应为)|除[^，。；;]*应为[^，。；;]*外|(?:grammatically (?:incorrect|invalid)|ungrammatical|subject.verb disagreement)/i.test(text);
}
function admitsMeaningOverlap(reason) {
    const text=positiveClaims(reason);
    return /(?<![不非])(?:是|存在|构成|属于|形成|具有)(?:了|一种|语义上的?)?包含关系|(?<!不)(?:互相|相互|彼此)包含|(?<![不非])(?:是|属于)[^，。；;]{1,45}的(?:一种|子类|下位词)|(?<![不非])(?:互为|属于|是)同义词|(?:is a (?:kind|type|subset) of|(?:are|is) synonymous)/i.test(text);
}
function admitsTranslationDefect(reason) {
    const text=positiveClaims(reason).replace(/(?:没有|不存在|并无|无)(?:任何)?(?:误译|漏译|增译|错译|词义错配)/g,'');
    return /(?:存在|出现|包含)(?:了)?(?:误译|漏译|增译|错译|词义错配)|(?:错误地|误)(?:译成|译为)|(?:译文|翻译|释义)[^，。；;]{0,12}(?:添加了|遗漏了|漏掉了)|(?:译文|翻译|释义)(?:不准确|不正确)|mistranslat(?:ed|ion)/i.test(text);
}
module.exports={admitsGrammarDefect,admitsMeaningOverlap,admitsTranslationDefect};
