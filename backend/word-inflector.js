const IRREGULARS = {
    be:         { third: 'is',      past: 'was',      pastP: 'been',       gerund: 'being' },
    have:       { third: 'has',     past: 'had',      pastP: 'had',        gerund: 'having' },
    do:         { third: 'does',    past: 'did',      pastP: 'done',       gerund: 'doing' },
    go:         { third: 'goes',    past: 'went',     pastP: 'gone',       gerund: 'going' },
    make:       { third: 'makes',   past: 'made',     pastP: 'made',       gerund: 'making' },
    take:       { third: 'takes',   past: 'took',     pastP: 'taken',      gerund: 'taking' },
    come:       { third: 'comes',   past: 'came',     pastP: 'come',       gerund: 'coming' },
    know:       { third: 'knows',   past: 'knew',     pastP: 'known',      gerund: 'knowing' },
    get:        { third: 'gets',    past: 'got',      pastP: 'gotten',     gerund: 'getting' },
    give:       { third: 'gives',   past: 'gave',     pastP: 'given',      gerund: 'giving' },
    find:       { third: 'finds',   past: 'found',    pastP: 'found',      gerund: 'finding' },
    think:      { third: 'thinks',  past: 'thought',  pastP: 'thought',    gerund: 'thinking' },
    see:        { third: 'sees',    past: 'saw',      pastP: 'seen',       gerund: 'seeing' },
    say:        { third: 'says',    past: 'said',     pastP: 'said',       gerund: 'saying' },
    tell:       { third: 'tells',   past: 'told',     pastP: 'told',       gerund: 'telling' },
    become:     { third: 'becomes', past: 'became',   pastP: 'become',     gerund: 'becoming' },
    show:       { third: 'shows',   past: 'showed',   pastP: 'shown',      gerund: 'showing' },
    leave:      { third: 'leaves',  past: 'left',     pastP: 'left',       gerund: 'leaving' },
    feel:       { third: 'feels',   past: 'felt',     pastP: 'felt',       gerund: 'feeling' },
    put:        { third: 'puts',    past: 'put',      pastP: 'put',        gerund: 'putting' },
    bring:      { third: 'brings',  past: 'brought',  pastP: 'brought',    gerund: 'bringing' },
    begin:      { third: 'begins',  past: 'began',    pastP: 'begun',      gerund: 'beginning' },
    keep:       { third: 'keeps',   past: 'kept',     pastP: 'kept',       gerund: 'keeping' },
    hold:       { third: 'holds',   past: 'held',     pastP: 'held',       gerund: 'holding' },
    write:      { third: 'writes',  past: 'wrote',    pastP: 'written',    gerund: 'writing' },
    stand:      { third: 'stands',  past: 'stood',    pastP: 'stood',      gerund: 'standing' },
    hear:       { third: 'hears',   past: 'heard',    pastP: 'heard',      gerund: 'hearing' },
    spend:      { third: 'spends',  past: 'spent',    pastP: 'spent',      gerund: 'spending' },
    run:        { third: 'runs',    past: 'ran',      pastP: 'run',        gerund: 'running' },
    lead:       { third: 'leads',   past: 'led',      pastP: 'led',        gerund: 'leading' },
    meet:       { third: 'meets',   past: 'met',      pastP: 'met',        gerund: 'meeting' },
    lose:       { third: 'loses',   past: 'lost',     pastP: 'lost',       gerund: 'losing' },
    fall:       { third: 'falls',   past: 'fell',     pastP: 'fallen',     gerund: 'falling' },
    cut:        { third: 'cuts',    past: 'cut',      pastP: 'cut',        gerund: 'cutting' },
    send:       { third: 'sends',   past: 'sent',     pastP: 'sent',       gerund: 'sending' },
    read:       { third: 'reads',   past: 'read',     pastP: 'read',       gerund: 'reading' },
    sit:        { third: 'sits',    past: 'sat',      pastP: 'sat',        gerund: 'sitting' },
    grow:       { third: 'grows',   past: 'grew',     pastP: 'grown',      gerund: 'growing' },
    win:        { third: 'wins',    past: 'won',      pastP: 'won',        gerund: 'winning' },
    pay:        { third: 'pays',    past: 'paid',     pastP: 'paid',       gerund: 'paying' },
    set:        { third: 'sets',    past: 'set',      pastP: 'set',        gerund: 'setting' },
    break:      { third: 'breaks',  past: 'broke',    pastP: 'broken',     gerund: 'breaking' },
    speak:      { third: 'speaks',  past: 'spoke',    pastP: 'spoken',     gerund: 'speaking' },
    eat:        { third: 'eats',    past: 'ate',      pastP: 'eaten',      gerund: 'eating' },
    drive:      { third: 'drives',  past: 'drove',    pastP: 'driven',     gerund: 'driving' },
    rise:       { third: 'rises',   past: 'rose',     pastP: 'risen',      gerund: 'rising' },
    ride:       { third: 'rides',   past: 'rode',     pastP: 'ridden',     gerund: 'riding' },
    fly:        { third: 'flies',   past: 'flew',     pastP: 'flown',      gerund: 'flying' },
    choose:     { third: 'chooses', past: 'chose',    pastP: 'chosen',     gerund: 'choosing' },
    draw:       { third: 'draws',   past: 'drew',     pastP: 'drawn',      gerund: 'drawing' },
    throw:      { third: 'throws',  past: 'threw',    pastP: 'thrown',     gerund: 'throwing' },
    catch:      { third: 'catches', past: 'caught',   pastP: 'caught',     gerund: 'catching' },
    teach:      { third: 'teaches', past: 'taught',   pastP: 'taught',     gerund: 'teaching' },
    buy:        { third: 'buys',    past: 'bought',   pastP: 'bought',     gerund: 'buying' },
    seek:       { third: 'seeks',   past: 'sought',   pastP: 'sought',     gerund: 'seeking' },
    fight:      { third: 'fights',  past: 'fought',   pastP: 'fought',     gerund: 'fighting' },
    build:      { third: 'builds',  past: 'built',    pastP: 'built',      gerund: 'building' },
    sell:       { third: 'sells',   past: 'sold',     pastP: 'sold',       gerund: 'selling' },
    forget:     { third: 'forgets', past: 'forgot',   pastP: 'forgotten',  gerund: 'forgetting' },
    forgive:    { third: 'forgives',past: 'forgave',  pastP: 'forgiven',   gerund: 'forgiving' },
    steal:      { third: 'steals',  past: 'stole',    pastP: 'stolen',     gerund: 'stealing' },
    hide:       { third: 'hides',   past: 'hid',      pastP: 'hidden',     gerund: 'hiding' },
    strike:     { third: 'strikes', past: 'struck',   pastP: 'struck',     gerund: 'striking' },
    wake:       { third: 'wakes',   past: 'woke',     pastP: 'woken',      gerund: 'waking' },
    wear:       { third: 'wears',   past: 'wore',     pastP: 'worn',       gerund: 'wearing' },
    tear:       { third: 'tears',   past: 'tore',     pastP: 'torn',       gerund: 'tearing' },
    sing:       { third: 'sings',   past: 'sang',     pastP: 'sung',       gerund: 'singing' },
    swim:       { third: 'swims',   past: 'swam',     pastP: 'swum',       gerund: 'swimming' },
    drink:      { third: 'drinks',  past: 'drank',    pastP: 'drunk',      gerund: 'drinking' },
    ring:       { third: 'rings',   past: 'rang',     pastP: 'rung',       gerund: 'ringing' },
    sink:       { third: 'sinks',   past: 'sank',     pastP: 'sunk',       gerund: 'sinking' },
    swear:      { third: 'swears',  past: 'swore',    pastP: 'sworn',      gerund: 'swearing' },
    bear:       { third: 'bears',   past: 'bore',     pastP: 'born',       gerund: 'bearing' },
    bite:       { third: 'bites',   past: 'bit',      pastP: 'bitten',     gerund: 'biting' },
    arise:      { third: 'arises',  past: 'arose',    pastP: 'arisen',     gerund: 'arising' },
    bind:       { third: 'binds',   past: 'bound',    pastP: 'bound',      gerund: 'binding' },
    forbid:     { third: 'forbids', past: 'forbade',  pastP: 'forbidden',  gerund: 'forbidding' },
    mistake:    { third: 'mistakes',past: 'mistook',  pastP: 'mistaken',   gerund: 'mistaking' },
    overcome:   { third: 'overcomes',past:'overcame', pastP: 'overcome',   gerund: 'overcoming' },
    undertake:  { third: 'undertakes',past:'undertook',pastP:'undertaken', gerund: 'undertaking' },
    withdraw:   { third: 'withdraws',past:'withdrew', pastP: 'withdrawn',  gerund: 'withdrawing' },
    shrink:     { third: 'shrinks', past: 'shrank',   pastP: 'shrunk',     gerund: 'shrinking' },
};

// multi-syllabic verbs with final-stressed CVC that require consonant doubling
const DOUBLERS = new Set([
    'commit','admit','omit','submit','permit','transmit','emit','remit',
    'occur','concur','incur','recur',
    'refer','prefer','infer','defer','confer','transfer',
    'rebel','compel','expel','repel','propel','excel','impel',
    'control','patrol','enroll','fulfill',
    'upset','forget',
]);

function isCVC(word) {
    const VOWELS = new Set('aeiou');
    const n = word.length;
    if (n < 3) return false;
    const c1 = word[n - 3], v = word[n - 2], c2 = word[n - 1];
    if (VOWELS.has(c1) || !VOWELS.has(v) || VOWELS.has(c2) || c2 === 'w' || c2 === 'x' || c2 === 'y') return false;
    return (word.match(/[aeiou]+/g) || []).length === 1 || DOUBLERS.has(word);
}

function regularGerund(word) {
    if (word.endsWith('ie')) return word.slice(0, -2) + 'ying';
    if (word.endsWith('e') && word.length > 2) return word.slice(0, -1) + 'ing';
    if (isCVC(word)) return word + word[word.length - 1] + 'ing';
    return word + 'ing';
}

function regularPast(word) {
    if (word.endsWith('e')) return word + 'd';
    if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ied';
    if (isCVC(word)) return word + word[word.length - 1] + 'ed';
    return word + 'ed';
}

function regularThird(word) {
    if (/[^aeiou]y$/.test(word)) return word.slice(0, -1) + 'ies';
    if (/(s|sh|ch|x|z)$/.test(word)) return word + 'es';
    return word + 's';
}

function getFormKey(base, surface) {
    const b = String(base || '').toLowerCase();
    const s = String(surface || '').toLowerCase();
    if (s === b) return 'base';
    const irr = IRREGULARS[b];
    if (irr) {
        if (s === irr.third) return 'third_singular';
        if (s === irr.past) return 'past';
        if (s === irr.pastP) return 'past_participle';
        if (s === irr.gerund) return 'present_participle';
    }
    if (s.endsWith('ing')) return 'present_participle';
    if (s.endsWith('ed') || s.endsWith('en')) return 'past_participle';
    if (s.endsWith('s')) return 'third_singular';
    return 'base';
}

function inflectWord(word, formKey) {
    const w = String(word || '').toLowerCase();
    if (formKey === 'base') return w;
    const irr = IRREGULARS[w];
    if (formKey === 'present_participle') return irr ? irr.gerund : regularGerund(w);
    if (formKey === 'past')               return irr ? irr.past  : regularPast(w);
    if (formKey === 'past_participle')    return irr ? irr.pastP : regularPast(w);
    if (formKey === 'third_singular')     return irr ? irr.third : regularThird(w);
    return w;
}

module.exports = { getFormKey, inflectWord };
