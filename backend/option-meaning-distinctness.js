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

function meaningsOverlap(left, right) {
    const leftTokens = normalizeMeaningTokens(left);
    const rightTokens = normalizeMeaningTokens(right);
    if (!leftTokens.length || !rightTokens.length) return false;
    return leftTokens.some(a => rightTokens.some(b => a === b || a.includes(b) || b.includes(a)));
}

// Returns the colliding index pairs of an exact four-option meaning list.
function getOverlappingOptionPairs(meanings) {
    const groups = (Array.isArray(meanings) ? meanings : []).map(normalizeMeaningTokens);
    const pairs = [];
    if (groups.length !== 4) return pairs;
    for (let left = 0; left < groups.length; left += 1) {
        for (let right = left + 1; right < groups.length; right += 1) {
            if (groups[left].some(a => groups[right].some(b => a === b || a.includes(b) || b.includes(a)))) {
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
