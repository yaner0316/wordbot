'use strict';

// A four-option fill-in question is only unambiguous when the four Chinese option
// meanings are clearly different from each other. When two glosses repeat, or one
// contains the other ("小的" inside "极小的"), the child cannot tell the options apart
// and the question is rejected downstream.
//
// This module is the single source of truth for that rule. The question quality gate
// and the distractor selection gate both use it, so a distractor can never pass
// selection only to be rejected by the very same rule later.

function normalizeMeaningTokens(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return [];
    const separators = /[\uFF0C,\u3001\uFF1B;\/|\uFF08\uFF09()]+/;
    const particles = /[\s\u7684\u5730\u5F97]+/g;
    return [...new Set(text
        .split(separators)
        .map(token => token.replace(particles, '').trim())
        .filter(token => token.length >= 2))];
}

function meaningTokensOverlap(left,right) {
    if (left===right) return true;
    const numeric=/[0-9零〇一二两兩三四五六七八九十百千万萬亿億兆壹贰貳叁肆伍陆陸柒捌玖拾佰仟点點.正负負+-]/;
    const numberPattern=/[0-9零〇一二两兩三四五六七八九十百千万萬亿億兆壹贰貳叁肆伍陆陸柒捌玖拾佰仟点點.正负負+-]+/g;
    const sameAmount=(a,b)=>{
        const arabic=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
        if(arabic.test(a)&&arabic.test(b)) return Number(a)===Number(b);
        const clean=value=>value.replace(/^[+正零〇]+/,'');
        a=clean(a);b=clean(b);
        return a===b || (/^[十拾百佰千仟万萬亿億兆]/.test(b)&&a==='一'+b)
            || (/^[十拾百佰千仟万萬亿億兆]/.test(a)&&b==='一'+a);
    };
    const containsWhole=(full,part)=>{
        for(let index=full.indexOf(part);index>=0;index=full.indexOf(part,index+1)) {
            // 五 in 二十五 and 5 in 25 are parts of another amount, not a
            // shared denomination. Ordinary non-numeric containment remains.
            const cutsNumber=(numeric.test(part[0])&&numeric.test(full[index-1]||''))
                || (numeric.test(part.at(-1))&&numeric.test(full[index+part.length]||''));
            if(cutsNumber){
                const truncated=[...part.matchAll(numberPattern)],whole=[...full.matchAll(numberPattern)];
                if(truncated.some(piece=>{const start=index+piece.index,span=whole.find(n=>n.index<=start&&n.index+n[0].length>=start+piece[0].length);return span&&!sameAmount(span[0],piece[0]);})) continue;
            }
            return true;
        }
        return false;
    };
    return containsWhole(left,right)||containsWhole(right,left);
}

function meaningsOverlap(left, right) {
    const leftTokens = normalizeMeaningTokens(left);
    const rightTokens = normalizeMeaningTokens(right);
    if (!leftTokens.length || !rightTokens.length) return false;
    return leftTokens.some(a => rightTokens.some(b => meaningTokensOverlap(a,b)));
}

// Returns the colliding index pairs of an exact four-option meaning list.
function getOverlappingOptionPairs(meanings) {
    const groups = (Array.isArray(meanings) ? meanings : []).map(normalizeMeaningTokens);
    const pairs = [];
    if (groups.length !== 4) return pairs;
    for (let left = 0; left < groups.length; left += 1) {
        for (let right = left + 1; right < groups.length; right += 1) {
            if (groups[left].some(a => groups[right].some(b => meaningTokensOverlap(a,b)))) {
                pairs.push([left, right]);
            }
        }
    }
    return pairs;
}

function hasOverlappingOptionMeanings(meanings) {
    return getOverlappingOptionPairs(meanings).length > 0;
}

module.exports = {
    normalizeMeaningTokens,
    meaningsOverlap,
    getOverlappingOptionPairs,
    hasOverlappingOptionMeanings,
};
