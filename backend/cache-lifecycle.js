const VARIANT_READY_DELAY_MS = 18 * 60 * 60 * 1000;

const CACHE_STATES = Object.freeze({
    ACTIVE: 'active',
    RESERVED_NEXT_DAY: 'reserved_next_day',
    REPLACE_PENDING: 'replace_pending',
    RETIRED: 'retired',
});

function iso(value) {
    return new Date(value).toISOString();
}

function buildInitialVariantMetadata({ slot, now = Date.now() }) {
    const normalizedSlot = Number(slot) === 2 ? 2 : 1;
    return {
        cache_state: normalizedSlot === 1 ? CACHE_STATES.ACTIVE : CACHE_STATES.RESERVED_NEXT_DAY,
        variant_slot: normalizedSlot,
        available_from: iso(Number(now) + (normalizedSlot === 2 ? VARIANT_READY_DELAY_MS : 0)),
    };
}

function isCacheVariantSelectable(row, now = Date.now()) {
    if (!row || row.qualityStatus !== 'ready') return false;
    if (![CACHE_STATES.ACTIVE, CACHE_STATES.RESERVED_NEXT_DAY].includes(row.cacheState)) return false;
    if (row.cacheState === CACHE_STATES.RESERVED_NEXT_DAY) {
        const availableAt = Date.parse(row.availableFrom || '');
        if (!Number.isFinite(availableAt) || availableAt > Number(now)) return false;
    }
    return true;
}

function planCorrectVariantTransition({ currentCacheId, reservedCacheId }) {
    return [
        { id: currentCacheId, cache_state: CACHE_STATES.RETIRED },
        { id: reservedCacheId, cache_state: CACHE_STATES.ACTIVE, available_from: null },
    ];
}

function planWrongVariantReplacement({ currentCacheId, replacementCacheId }) {
    return {
        replacement: { id: replacementCacheId, cache_state: CACHE_STATES.ACTIVE, available_from: null },
        retired: { id: currentCacheId, cache_state: CACHE_STATES.RETIRED },
    };
}

module.exports = {
    VARIANT_READY_DELAY_MS,
    CACHE_STATES,
    buildInitialVariantMetadata,
    isCacheVariantSelectable,
    planCorrectVariantTransition,
    planWrongVariantReplacement,
};