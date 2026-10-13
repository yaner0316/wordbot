const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rnApp = fs.readFileSync(
    path.join(__dirname, '..', '..', 'WordBot', 'App.js'),
    'utf8'
);
const webAppPath = process.env.WORDBOT_WEB_APP_PATH
    || path.join(__dirname, '..', '..', '..', 'web', 'src', 'app.js');
const webApp = fs.readFileSync(webAppPath, 'utf8');

const rnWordSeparatorPattern = /split\(\/\[\\n,，;；\\s\]\+\//;

test('word entry accepts newline, comma, and semicolon separators in RN and Web', () => {
    assert.match(rnApp, rnWordSeparatorPattern);
    assert.match(webApp, /split\(\/\\n\+\//);
    const start=webApp.indexOf('function parseParentWordEntries('),end=webApp.indexOf('\nfunction ',start+1);
    const context={};vm.createContext(context);vm.runInContext(webApp.slice(start,end),context);
    assert.deepEqual(JSON.parse(JSON.stringify(context.parseParentWordEntries('take care of, up to; library\ncarry the banner\npromotion | 促销，推广；活动'))),[
        {word:'take care of',cnMeaning:''},{word:'up to',cnMeaning:''},{word:'library',cnMeaning:''},{word:'carry the banner',cnMeaning:''},{word:'promotion',cnMeaning:'促销，推广；活动'},
    ]);
});
