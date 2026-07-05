#!/usr/bin/env node
/**
 * One-time admin script: reset parent credentials for selected child accounts.
 *
 * The parent password is never stored in this file or printed to stdout.
 * Usage:
 *   node backend/reset-parent-credentials.js
 *   node backend/reset-parent-credentials.js --users=Draggy,qiuqiu,yusi --parent=xiaoyan
 *   $env:WORDBOT_PARENT_PASSWORD="..."; node backend/reset-parent-credentials.js
 */

const path = require('node:path');
const readline = require('node:readline');

try {
    require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (error) {
    // Production injects env vars directly; local dotenv is optional.
}

const { initializeParentCredentials, verifyParentLogin } = require('./feishu');

function parseArg(name, fallback = '') {
    const prefix = `--${name}=`;
    const arg = process.argv.find(item => item.startsWith(prefix));
    return arg ? arg.slice(prefix.length).trim() : fallback;
}

function parseUsers(raw) {
    return String(raw || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

function askVisible(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => {
        rl.close();
        resolve(answer);
    }));
}

function askHidden(question) {
    if (!process.stdin.isTTY) return askVisible(question);
    return new Promise(resolve => {
        let value = '';
        readline.emitKeypressEvents(process.stdin);
        const wasRaw = process.stdin.isRaw;
        process.stdin.setRawMode(true);
        process.stdout.write(question);
        function cleanup() {
            process.stdin.off('keypress', onKeypress);
            process.stdin.setRawMode(Boolean(wasRaw));
            process.stdout.write('\n');
        }
        function onKeypress(str, key = {}) {
            if (key.ctrl && key.name === 'c') {
                cleanup();
                process.exit(130);
            }
            if (key.name === 'return' || key.name === 'enter') {
                cleanup();
                resolve(value);
                return;
            }
            if (key.name === 'backspace') {
                value = value.slice(0, -1);
                return;
            }
            if (str && !key.ctrl && !key.meta) value += str;
        }
        process.stdin.on('keypress', onKeypress);
    });
}

async function getParentPassword() {
    const fromEnv = process.env.WORDBOT_PARENT_PASSWORD;
    if (fromEnv) return String(fromEnv);
    return askHidden('Parent password (input hidden): ');
}

async function main() {
    const users = parseUsers(parseArg('users', 'Draggy,qiuqiu,yusi'));
    const parentUsername = parseArg('parent', 'xiaoyan');
    const dryRun = process.argv.includes('--dry-run');

    if (users.length === 0) throw new Error('No users provided. Use --users=Draggy,qiuqiu,yusi');
    if (!parentUsername) throw new Error('Parent username is required. Use --parent=xiaoyan');

    console.log(`Target users: ${users.join(', ')}`);
    console.log(`Parent username: ${parentUsername}`);
    if (dryRun) {
        console.log('[dry-run] No Feishu records will be changed.');
        return;
    }

    const parentPassword = await getParentPassword();
    if (!parentPassword || parentPassword.length < 4) {
        throw new Error('Parent password must be at least 4 characters.');
    }

    for (const user of users) {
        process.stdout.write(`Resetting parent credentials for ${user} ... `);
        await initializeParentCredentials({ user, parentUsername, parentPassword });
        await verifyParentLogin({ user, parentUsername, password: parentPassword });
        console.log('ok');
    }

    console.log('All selected parent credentials were reset and verified.');
}

main().catch(error => {
    console.error('Failed:', error && error.message ? error.message : error);
    process.exit(1);
});