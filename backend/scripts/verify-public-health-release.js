const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

function normalizeExpectedCommit(value) {
    const commit = String(value || '').toLowerCase();
    if (!GIT_SHA_PATTERN.test(commit)) throw new Error('expected release SHA must be a full Git commit');
    return commit;
}

async function verifyPublicHealthRelease({
    healthUrl,
    expectedCommit,
    fetchImpl = fetch,
    timeoutMs = 10_000,
} = {}) {
    const expected = normalizeExpectedCommit(expectedCommit);
    const response = await fetchImpl(healthUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error('public health did not return success');
    const health = await response.json();
    if (!health?.ok) throw new Error('public health was not healthy');
    if (health?.release?.commit !== expected) throw new Error('release SHA did not match');
    return { commit: expected, healthUrl };
}

function parseCliArguments(args) {
    const values = {};
    for (let index = 0; index < args.length; index += 2) {
        const name = args[index];
        const value = args[index + 1];
        if (!['--health-url', '--expected-commit', '--attempts', '--interval-ms'].includes(name) || !value) {
            throw new Error('invalid public health verification arguments');
        }
        values[name] = value;
    }
    return values;
}

function boundedInteger(value, fallback, minimum, maximum) {
    if (value === undefined) return fallback;
    const number = Number(value);
    if (!Number.isInteger(number) || number < minimum || number > maximum) {
        throw new Error('invalid public health verification retry settings');
    }
    return number;
}

async function runCli(args = process.argv.slice(2)) {
    const options = parseCliArguments(args);
    const attempts = boundedInteger(options['--attempts'], 1, 1, 60);
    const intervalMs = boundedInteger(options['--interval-ms'], 5_000, 0, 60_000);
    let failure = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            await verifyPublicHealthRelease({
                healthUrl: options['--health-url'],
                expectedCommit: options['--expected-commit'],
            });
            return;
        } catch (_) {
            failure = new Error('public health release verification failed');
        }
        if (attempt < attempts && intervalMs > 0) {
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }
    }
    throw failure;
}

if (require.main === module) {
    runCli().then(
        () => console.log('public health release verification passed'),
        () => {
            console.error('public health release verification failed');
            process.exitCode = 1;
        }
    );
}

module.exports = {
    verifyPublicHealthRelease,
};
