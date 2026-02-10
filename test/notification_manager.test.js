const test = require('node:test');
const assert = require('node:assert');
const { NotificationManager } = require('../Source/NotificationManager.ts');

function createFakeWebSocket(userId = '') {
  const sent = [];
  let attachment = userId ? { userId } : undefined;
  return {
    readyState: 1,
    send: (payload) => sent.push(payload),
    serializeAttachment: (value) => {
      attachment = value;
    },
    deserializeAttachment: () => attachment,
    getSent: () => sent,
  };
}

function createManager() {
  const state = {
    getWebSockets: () => [],
    acceptWebSocket: () => {},
  };
  return new NotificationManager(state, { NOTIFICATION_PUSH_TOKEN: 'test-push-token' });
}

test('stale socket close only removes the closed socket, not other active sessions', async () => {
  const manager = createManager();
  const oldSocket = createFakeWebSocket('alice');
  const newSocket = createFakeWebSocket('alice');

  manager.addSession('alice', oldSocket);
  manager.addSession('alice', newSocket);

  // Simulate close event from an older connection.
  manager.webSocketClose(oldSocket);

  // Push a notification and assert the active connection still receives it.
  await manager.fetch(new Request('https://dummy/notify', {
    method: 'POST',
    headers: { 'X-Notification-Token': 'test-push-token' },
    body: JSON.stringify({
      userId: 'alice',
      notification: { type: 'bbs_mention', data: { PostID: 1 } },
    }),
  }));

  assert.deepStrictEqual(oldSocket.getSent(), []);
  assert.deepStrictEqual(newSocket.getSent(), [JSON.stringify({ type: 'bbs_mention', data: { PostID: 1 } })]);
});

test('notifications fan out to all active sockets for the same user', async () => {
  const manager = createManager();
  const socketA = createFakeWebSocket('bob');
  const socketB = createFakeWebSocket('bob');

  manager.addSession('bob', socketA);
  manager.addSession('bob', socketB);

  const payload = { type: 'mail_mention', data: { FromUserID: 'alice' } };
  await manager.fetch(new Request('https://dummy/notify', {
    method: 'POST',
    headers: { 'X-Notification-Token': 'test-push-token' },
    body: JSON.stringify({ userId: 'bob', notification: payload }),
  }));

  const expected = [JSON.stringify(payload)];
  assert.deepStrictEqual(socketA.getSent(), expected);
  assert.deepStrictEqual(socketB.getSent(), expected);
});


test('rejects notify without internal token', async () => {
  const manager = createManager();
  const socket = createFakeWebSocket('eve');
  manager.addSession('eve', socket);

  const response = await manager.fetch(new Request('https://dummy/notify', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'eve',
      notification: { type: 'bbs_mention', data: { PostID: 10 } },
    }),
  }));

  assert.strictEqual(response.status, 401);
  assert.deepStrictEqual(socket.getSent(), []);
});
