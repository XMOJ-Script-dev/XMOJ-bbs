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

test('disconnect closes every socket of the user with 4001 and nobody else\'s', async () => {
  const manager = createManager();
  const closed = [];
  const socket = (user) => Object.assign(createFakeWebSocket(user), { close: (code, reason) => closed.push([user, code, reason]) });
  const aliceA = socket('alice'), aliceB = socket('alice'), bob = socket('bob');
  manager.addSession('alice', aliceA);
  manager.addSession('alice', aliceB);
  manager.addSession('bob', bob);

  const response = await manager.fetch(new Request('https://dummy/disconnect', {
    method: 'POST',
    headers: { 'X-Notification-Token': 'test-push-token' },
    body: JSON.stringify({ userId: 'alice' }),
  }));

  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual(closed, [['alice', 4001, 'Logged out'], ['alice', 4001, 'Logged out']]);
  await manager.fetch(new Request('https://dummy/notify', {
    method: 'POST',
    headers: { 'X-Notification-Token': 'test-push-token' },
    body: JSON.stringify({ userId: 'bob', notification: { type: 'pong' } }),
  }));
  assert.deepStrictEqual(bob.getSent(), [JSON.stringify({ type: 'pong' })], 'other users keep their socket');
});

test('disconnect requires the internal token', async () => {
  const manager = createManager();
  const response = await manager.fetch(new Request('https://dummy/disconnect', {
    method: 'POST',
    body: JSON.stringify({ userId: 'alice' }),
  }));
  assert.strictEqual(response.status, 401);
});

test('webSocketClose answers the close frame so the client sees the code', () => {
  const manager = createManager();
  const closed = [];
  const socket = Object.assign(createFakeWebSocket('alice'), { close: (code, reason) => closed.push([code, reason]) });
  manager.addSession('alice', socket);
  manager.webSocketClose(socket, 4001, 'Logged out');
  manager.webSocketClose(Object.assign(createFakeWebSocket('alice'), { close: (code, reason) => closed.push([code, reason]) }), 1005, '');
  assert.deepStrictEqual(closed, [[4001, 'Logged out'], [1000, '']], 'reserved codes cannot be sent back');
});

// Admits a socket through fetch() with stand-ins for the Workers-only pieces.
async function admit(manager, query) {
  const client = createFakeWebSocket(), server = Object.assign(createFakeWebSocket(), { closed: null });
  server.close = (code, reason) => { server.closed = [code, reason]; };
  const realPair = global.WebSocketPair, RealResponse = global.Response;
  global.WebSocketPair = function () { return { 0: client, 1: server }; };
  global.Response = function (body, init) { return { status: init.status, webSocket: init.webSocket }; };
  try {
    const response = await manager.fetch(new Request('https://dummy/ws?' + query, { headers: { Upgrade: 'websocket' } }));
    return { response, server };
  } finally {
    global.WebSocketPair = realPair;
    global.Response = RealResponse;
  }
}

function managerWithTokens(validHashes, failing = false) {
  const state = { getWebSockets: () => [], acceptWebSocket: () => {} };
  const DB = {
    prepare: () => ({
      bind: (hash) => ({
        first: async () => {
          if (failing) throw new Error('D1 down');
          return validHashes.includes(hash) ? { 1: 1 } : null;
        }
      })
    })
  };
  return new NotificationManager(state, { NOTIFICATION_PUSH_TOKEN: 'test-push-token', DB });
}

test('a socket whose token was revoked mid-handshake is closed with 4001', async () => {
  const manager = managerWithTokens([]);
  const { server } = await admit(manager, 'userId=alice&tokenHash=gone');
  assert.deepStrictEqual(server.closed, [4001, 'Logged out']);
  assert.strictEqual(manager.sessions.get('alice'), undefined, 'not left subscribed');
  assert.deepStrictEqual(server.getSent(), [], 'never told it is connected');
});

test('a socket whose token is still valid is admitted', async () => {
  const manager = managerWithTokens(['live']);
  const { server } = await admit(manager, 'userId=alice&tokenHash=live');
  assert.strictEqual(server.closed, null);
  assert.strictEqual(manager.sessions.get('alice').size, 1);
  assert.match(server.getSent()[0], /"type":"connected"/);
});

test('a D1 failure during the re-check does not drop the socket', async () => {
  const manager = managerWithTokens([], true);
  const { server } = await admit(manager, 'userId=alice&tokenHash=whatever');
  assert.strictEqual(server.closed, null);
});

test('disconnect rejects a body it cannot read instead of failing silently', async () => {
  const manager = createManager();
  for (const body of ['not json', '', JSON.stringify({ userId: 5 })]) {
    const response = await manager.fetch(new Request('https://dummy/disconnect', {
      method: 'POST', headers: { 'X-Notification-Token': 'test-push-token' }, body,
    }));
    assert.strictEqual(response.status, 400, JSON.stringify(body));
  }
});

test('webSocketClose answers codes close() would reject, like 1001', () => {
  const manager = createManager();
  const closed = [];
  for (const code of [1001, 1002, 1011, 2999, 5000]) {
    manager.webSocketClose(Object.assign(createFakeWebSocket('alice'), { close: (c) => closed.push(c) }), code, '');
  }
  assert.deepStrictEqual(closed, [1000, 1000, 1000, 1000, 1000]);
});
