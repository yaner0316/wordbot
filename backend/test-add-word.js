process.env.DATA_SOURCE = 'supabase';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const dataSource = require('./data-source');
const supabase = require('./supabase-client');

function fail(label, error) {
    const message = error?.message || String(error || 'unknown error');
    throw new Error(`${label}: ${message}`);
}

async function ensureTestUser() {
    const username = 'test_user';
    const { data: existing, error: selectError } = await supabase
        .from('users')
        .select('id,username,username_key')
        .eq('username_key', username)
        .maybeSingle();
    if (selectError) fail('select test user', selectError);
    if (existing) return existing;

    const { data: inserted, error: insertError } = await supabase
        .from('users')
        .insert({ username, learning_level: '中学' })
        .select('id,username,username_key')
        .single();
    if (insertError) fail('insert test user', insertError);
    return inserted;
}

async function main() {
    const user = await ensureTestUser();
    const inserted = await dataSource.addWord({
        username: 'test_user',
        word: 'testword123',
        meaning: 'test',
        level: '中学',
        partsOfSpeech: ['noun'],
    });

    const { data: wordRow, error: wordError } = await supabase
        .from('words')
        .select('id,user_id,word,meaning_en,level,mastery_status')
        .eq('id', inserted.id)
        .single();
    if (wordError) fail('verify inserted word', wordError);

    const { data: junctionRows, error: junctionError } = await supabase
        .from('word_parts_of_speech')
        .select('position,part_of_speech_id')
        .eq('word_id', inserted.id)
        .order('position', { ascending: true });
    if (junctionError) fail('verify word parts junction', junctionError);

    const partIds = (junctionRows || []).map(row => row.part_of_speech_id);
    const { data: parts, error: partsError } = await supabase
        .from('parts_of_speech')
        .select('id,code')
        .in('id', partIds);
    if (partsError) fail('verify parts of speech', partsError);

    const partCodes = new Map((parts || []).map(row => [row.id, row.code]));
    const pos = (junctionRows || []).map(row => partCodes.get(row.part_of_speech_id));

    if (wordRow.user_id !== user.id) throw new Error('verified word belongs to the wrong user');
    if (wordRow.word !== 'testword123') throw new Error(`unexpected word: ${wordRow.word}`);
    if (wordRow.meaning_en !== 'test') throw new Error(`unexpected meaning: ${wordRow.meaning_en}`);
    if (!pos.includes('noun')) throw new Error(`noun POS junction missing: ${JSON.stringify(pos)}`);

    console.log(JSON.stringify({
        ok: true,
        dataSource: dataSource.DATA_SOURCE,
        insertedWordId: inserted.id,
        verifiedWord: wordRow.word,
        verifiedMeaning: wordRow.meaning_en,
        verifiedLevel: wordRow.level,
        verifiedPos: pos,
    }, null, 2));
}

main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
});
