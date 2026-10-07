const test = require('node:test');
const assert = require('node:assert');
const { RequestLogLine } = require('../Source/index.ts');

test('RequestLogLine never includes the query string', () => {
    const req = new Request('https://api.xmoj-script.uk/ws/notifications?SessionID=abc123secret');
    const line = RequestLogLine(req, 101, 12);
    assert.strictEqual(line.path, '/ws/notifications');
    assert.strictEqual(line.status, 101);
    assert.strictEqual(line.durationMs, 12);
    assert.ok(!JSON.stringify(line).includes('abc123secret'));
});

test('RequestLogLine records the failure when one is given', () => {
    const line = RequestLogLine(new Request('https://api.xmoj-script.uk/GetPost', { method: 'POST' }), 500, 3, new Error('boom'));
    assert.strictEqual(line.method, 'POST');
    assert.match(line.error, /^Error: boom\n\s+at /, 'errors keep their stack');
});

test('RequestLogLine stringifies non-Error throws', () => {
    const line = RequestLogLine(new Request('https://api.xmoj-script.uk/GetPost'), 500, 3, 'plain failure');
    assert.strictEqual(line.error, 'plain failure');
});

test('RequestLogLine leaves error unset on success', () => {
    const line = RequestLogLine(new Request('https://api.xmoj-script.uk/GetNotice'), 200, 1);
    assert.strictEqual(line.error, undefined);
});

// ---- Notification WebSocket auth ----

const Worker = require('../Source/index.ts').default;
const { HashSessionToken } = require('../Source/SessionToken.ts');

// Answers SELECTs on session_token from `tokens`, a map of token to row,
// matched on the hash the query binds, and records every query.
function wsEnvironment(tokens = {}) {
    const rowsByHash = Object.fromEntries(Object.entries(tokens).map(([token, row]) => [HashSessionToken(token), row]));
    const queries = [];
    const forwarded = [];
    const DB = {
        withSession() { return this; },
        prepare(q) {
            return {
                bind(...args) {
                    return {
                        all: async () => {
                            queries.push({ q, args });
                            if (q.startsWith('SELECT') && q.includes('session_token')) {
                                const row = rowsByHash[args[0]];
                                return { results: row ? [row] : [], meta: {} };
                            }
                            return { results: [], meta: { last_row_id: 1, changes: 1 } };
                        }
                    };
                }
            };
        }
    };
    const NOTIFICATIONS = {
        idFromName: (name) => name,
        get: () => ({
            fetch: async (request) => {
                forwarded.push(new URL(request.url));
                return new Response('forwarded');
            }
        })
    };
    return { env: { DB, NOTIFICATIONS }, queries, forwarded };
}

// profile.php embeds the logged-in user as user_id=<name>'
const ProfilePage = (user) => new Response("<a href='userinfo.php?user_id=" + user + "'>" + user + "</a>");

test('WebSocket with a token resolves the user without touching xmoj', async (t) => {
    const xmoj = t.mock.method(global, 'fetch', async () => ProfilePage('mallory'));
    const token = 'b'.repeat(64);
    const { env, forwarded } = wsEnvironment({ [token]: { user_id: 'alice', last_used: Date.now() } });
    await Worker.fetch(new Request('https://api.xmoj-script.uk/ws/notifications?Token=' + token), env);
    assert.strictEqual(xmoj.mock.calls.length, 0);
    assert.strictEqual(forwarded[0].searchParams.get('userId'), 'alice');
    assert.strictEqual(forwarded[0].searchParams.get('Token'), null, 'the token is not passed on');
});

test('WebSocket with an unknown token is unauthorized', async () => {
    const { env, forwarded } = wsEnvironment({ ['b'.repeat(64)]: { user_id: 'alice', last_used: Date.now() } });
    const response = await Worker.fetch(new Request('https://api.xmoj-script.uk/ws/notifications?Token=' + 'c'.repeat(64)), env);
    assert.strictEqual(response.status, 401);
    assert.strictEqual(forwarded.length, 0);
});

test('WebSocket with a PHPSESSID and IssueToken=1 mints a token for the connected message', async (t) => {
    t.mock.method(global, 'fetch', async () => ProfilePage('alice'));
    const { env, queries, forwarded } = wsEnvironment();
    await Worker.fetch(new Request('https://api.xmoj-script.uk/ws/notifications?SessionID=abc123&IssueToken=1', { headers: { Upgrade: 'websocket' } }), env);
    const issued = forwarded[0].searchParams.get('issuedToken');
    assert.match(issued, /^[0-9a-f]{64}$/);
    assert.strictEqual(forwarded[0].searchParams.get('SessionID'), null);
    assert.strictEqual(forwarded[0].searchParams.get('IssueToken'), null);
    const insert = queries.find((query) => query.q.startsWith('INSERT INTO `session_token`'));
    assert.ok(insert.args.includes(HashSessionToken(issued)));
    assert.ok(insert.args.includes('alice'));
});

test('WebSocket with only a PHPSESSID behaves as before', async (t) => {
    t.mock.method(global, 'fetch', async () => ProfilePage('alice'));
    const { env, queries, forwarded } = wsEnvironment();
    await Worker.fetch(new Request('https://api.xmoj-script.uk/ws/notifications?SessionID=abc123'), env);
    assert.strictEqual(forwarded[0].searchParams.get('userId'), 'alice');
    assert.strictEqual(forwarded[0].searchParams.get('issuedToken'), null);
    assert.strictEqual(queries.length, 0, 'no token minted');
});

test('WebSocket mints no token for a request that is not a WebSocket handshake', async (t) => {
    t.mock.method(global, 'fetch', async () => ProfilePage('alice'));
    const { env, queries, forwarded } = wsEnvironment();
    await Worker.fetch(new Request('https://api.xmoj-script.uk/ws/notifications?SessionID=abc123&IssueToken=1'), env);
    assert.strictEqual(queries.length, 0);
    assert.strictEqual(forwarded[0].searchParams.get('issuedToken'), null);
});

test('WebSocket drops an issuedToken the client supplied', async (t) => {
    t.mock.method(global, 'fetch', async () => ProfilePage('alice'));
    const { env, forwarded } = wsEnvironment();
    await Worker.fetch(new Request('https://api.xmoj-script.uk/ws/notifications?SessionID=abc123&issuedToken=' + 'd'.repeat(64)), env);
    assert.strictEqual(forwarded[0].searchParams.get('issuedToken'), null);
});
