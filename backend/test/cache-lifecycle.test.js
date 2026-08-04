const test = require('node:test');
const assert = require('node:assert/strict');

const {
    CACHE_STATES,
    buildInitialVariantMetadata,
    isCacheVariantSelectable,
    planCorrectVariantTransition,
    planWrongVariantReplacement,
} = require('../cache-lifecycle');

const NOW = Date.parse('2026-07-30T12:00:00.000Z');

test('initial cache creates an active variant and a next-day reserved variant', () => {
    const first = buildInitialVariantMetadata({ slot: 1, now: NOW });
    const second = buildInitialVariantMetadata({ slot: 2, now: NOW });

    assert.deepEqual(first, {
        cache_state: CACHE_STATES.ACTIVE,
        variant_slot: 1,
        available_from: new Date(NOW).toISOString(),
    });
    assert.equal(second.cache_state, CACHE_STATES.RESERVED_NEXT_DAY);
    assert.equal(second.variant_slot, 2);
    assert.equal(second.available_from, new Date(NOW + 18 * 60 * 60 * 1000).toISOString());
});

test('reserved variant becomes selectable only on the scheduled day', () => {
    const row = {
        qualityStatus: 'ready',
        cacheState: CACHE_STATES.RESERVED_NEXT_DAY,
        availableFrom: new Date(NOW + 24 * 60 * 60 * 1000).toISOString(),
    };

    assert.equal(isCacheVariantSelectable(row, NOW), false);
    assert.equal(isCacheVariantSelectable(row, NOW + 24 * 60 * 60 * 1000), true);
});

test('correct answer retires current variant and promotes the reserved variant', () => {
    assert.deepEqual(planCorrectVariantTransition({
        currentCacheId: 'cache-a',
        reservedCacheId: 'cache-b',
    }), [
        { id: 'cache-a', cache_state: CACHE_STATES.RETIRED },
        { id: 'cache-b', cache_state: CACHE_STATES.ACTIVE, available_from: null },
    ]);
});

test('wrong answer keeps old variant until replacement is ready, then retires it', () => {
    assert.deepEqual(planWrongVariantReplacement({
        currentCacheId: 'cache-a',
        replacementCacheId: 'cache-c',
    }), {
        replacement: { id: 'cache-c', cache_state: CACHE_STATES.ACTIVE, available_from: null },
        retired: { id: 'cache-a', cache_state: CACHE_STATES.RETIRED },
    });
});