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
    assert.strictEqual(line.error, 'Error: boom');
});

test('RequestLogLine leaves error unset on success', () => {
    const line = RequestLogLine(new Request('https://api.xmoj-script.uk/GetNotice'), 200, 1);
    assert.strictEqual(line.error, undefined);
});
