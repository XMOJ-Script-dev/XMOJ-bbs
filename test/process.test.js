const test = require('node:test');
const assert = require('node:assert');
const { Process } = require('../Source/Process.ts');
const { Result } = require('../Source/Result.ts');

function createProcess(mocks = {}) {
    const {
        db: db_mocks = {},
        fetch: fetch_mock,
        notifications: notification_mocks = {},
        kv: kv_mocks = {},
        ai: ai_mocks = {},
        logdb: logdb_mocks = {},
        req: req_mock,
    } = mocks;

    const notifyFetch = test.mock.fn(notification_mocks.fetch || (async () => new Response('OK')));

    const env = {
        API_TOKEN: 'test-api-token',
        ACCOUNT_ID: 'test-account-id',
        GithubImagePAT: 'test-github-pat',
        xssmseetee_v1_key: 'test-key',
        kv: {
            get: test.mock.fn(kv_mocks.get || (async () => null)),
            put: test.mock.fn(kv_mocks.put || (async () => {})),
            list: test.mock.fn(kv_mocks.list || (async () => ({ keys: [] }))),
            getWithMetadata: test.mock.fn(kv_mocks.getWithMetadata || (async () => ({ value: null, metadata: null }))),
            delete: test.mock.fn(kv_mocks.delete || (async () => {})),
        },
        CaptchaSecretKey: 'test-secret',
        DB: {
            prepare: test.mock.fn(db_mocks.prepare || (() => ({
                bind: () => ({
                    run: () => ({ results: [] }),
                    all: () => ({ results: [] }),
                    first: () => null,
                })
            }))),
            batch: test.mock.fn(db_mocks.batch || (async () => [])),
            exec: test.mock.fn(db_mocks.exec || (async () => ({ count: 0, duration: 0 }))),
            withSession: () => this,
            dump: test.mock.fn(db_mocks.dump || (async () => (new ArrayBuffer(0)))),
        },
        logdb: {
            writeDataPoint: test.mock.fn(logdb_mocks.writeDataPoint || (() => { }))
        },
        AI: {
            run: test.mock.fn(ai_mocks.run || (async () => ({})))
        },
        NOTIFICATIONS: {
            idFromName: test.mock.fn(notification_mocks.idFromName || ((id) => id)),
            get: test.mock.fn(notification_mocks.get || (() => ({
                fetch: notifyFetch,
            }))),
        },
        NOTIFICATION_PUSH_TOKEN: 'test-notification-token',
    };

    const req = req_mock || new Request('https://example.com', {
        headers: { "CF-Connecting-IP": "127.0.0.1" }
    });
    const proc = new Process(req, env);

    // Mock Database methods
    proc.XMOJDatabase = {
        GetTableSize: test.mock.fn(db_mocks.GetTableSize || (async () => new Result(true, "", { TableSize: 0 }))),
        Select: test.mock.fn(db_mocks.Select || (async () => new Result(true, "", []))),
        Insert: test.mock.fn(db_mocks.Insert || (async () => new Result(true, "", { InsertID: 1 }))),
        Update: test.mock.fn(db_mocks.Update || (async () => new Result(true, ""))),
        Delete: test.mock.fn(db_mocks.Delete || (async () => new Result(true, ""))),
    };

    // Mock internal Fetch property
    proc.Fetch = test.mock.fn(fetch_mock || (async () => new Response('')));

    // Mock global fetch
    if (fetch_mock) {
        test.mock.method(global, 'fetch', fetch_mock);
    }

    // Mock username and sessionID for tests that need it
    proc.Username = "testuser";
    proc.SessionID = "testsession";
    proc._notifyFetch = notifyFetch;

    return proc;
}

test('Process serves notice on legacy /GetNotice endpoint', async () => {
    const proc = createProcess({
        req: new Request('https://example.com/GetNotice', {
            method: 'GET',
            headers: { "CF-Connecting-IP": "127.0.0.1" }
        }),
        kv: {
            get: async () => 'test notice'
        }
    });

    const response = await proc.Process();
    const payload = await response.json();
    assert.strictEqual(payload.Success, true);
    assert.strictEqual(payload.Data.Notice, 'test notice');
});

test('Process serves notice on versioned /v1/GetNotice endpoint', async () => {
    const proc = createProcess({
        req: new Request('https://example.com/v1/GetNotice', {
            method: 'GET',
            headers: { "CF-Connecting-IP": "127.0.0.1" }
        }),
        kv: {
            get: async () => 'test notice'
        }
    });

    const response = await proc.Process();
    const payload = await response.json();
    assert.strictEqual(payload.Success, true);
    assert.strictEqual(payload.Data.Notice, 'test notice');
});

test('Process maps /v1 to GetNotice for versioned default endpoint', async () => {
    const proc = createProcess({
        req: new Request('https://example.com/v1', {
            method: 'GET',
            headers: { "CF-Connecting-IP": "127.0.0.1" }
        }),
        kv: {
            get: async () => 'test notice'
        }
    });

    const response = await proc.Process();
    const payload = await response.json();
    assert.strictEqual(payload.Success, true);
    assert.strictEqual(payload.Data.Notice, 'test notice');
});

test('Process uses GetStd C++ string processing on /v1/GetStd', async () => {
    const req = new Request('https://example.com/v1/GetStd', {
        method: 'POST',
        headers: {
            "CF-Connecting-IP": "127.0.0.1",
            "content-type": "application/json"
        },
        body: JSON.stringify({
            Authentication: { SessionID: 'testsession', Username: 'testuser' },
            Data: {},
            Version: 'test',
            DebugMode: false
        })
    });
    const proc = createProcess({ req });

    proc.CheckToken = test.mock.fn(async () => new Result(true, '', { Success: true }));
    proc.ProcessFunctions.GetStd = test.mock.fn(async () => new Result(true, 'ok', { Code: 'line1\nline2' }));

    const response = await proc.Process();
    const responseText = await response.text();
    const expectedText = proc.processCppString(JSON.stringify(new Result(true, 'ok', { Code: 'line1\nline2' })));

    assert.strictEqual(responseText, expectedText);
});

test('CheckParams passes with valid data', () => {
  const proc = createProcess();
  const result = proc.CheckParams({ a: 1, b: 'x' }, { a: 'number', b: 'string' });
  assert.ok(result.Success);
});

test('CheckParams fails when parameter missing', () => {
  const proc = createProcess();
  const result = proc.CheckParams({ a: 1 }, { a: 'number', b: 'string' });
  assert.strictEqual(result.Success, false);
  assert.match(result.Message, /参数b未找到/);
});

test('CheckParams fails with unexpected parameter', () => {
  const proc = createProcess();
  const result = proc.CheckParams({ a: 1, c: 2 }, { a: 'number' });
  assert.strictEqual(result.Success, false);
  assert.match(result.Message, /参数c未知/);
});

test('IsAdmin returns true for admin users', () => {
    const proc = createProcess();
    proc.Username = "chenlangning";
    assert.strictEqual(proc.IsAdmin(), true);
});

test('IsAdmin returns false for non-admin users', () => {
    const proc = createProcess();
    proc.Username = "testuser";
    assert.strictEqual(proc.IsAdmin(), false);
});

test('DenyMessage returns true for denied users', () => {
    const proc = createProcess();
    proc.Username = "std";
    assert.strictEqual(proc.DenyMessage(), true);
});

test('DenyMessage returns false for allowed users', () => {
    const proc = createProcess();
    proc.Username = "testuser";
    assert.strictEqual(proc.DenyMessage(), false);
});

test('IsSilenced returns false for non-silenced users', () => {
    const proc = createProcess();
    proc.Username = "testuser";
    assert.strictEqual(proc.IsSilenced(), false);
});

test('DenyEdit returns true for denied users', () => {
    const proc = createProcess();
    proc.Username = "testuser";
    proc.DenyBadgeEditList = ["testuser"];
    assert.strictEqual(proc.DenyEdit(), true);
});

test('DenyEdit returns false for allowed users', () => {
    const proc = createProcess();
    proc.Username = "testuser";
    assert.strictEqual(proc.DenyEdit(), false);
});

test('CheckToken succeeds with valid session from DB', async () => {
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', [{
                user_id: 'testuser',
                create_time: new Date().getTime()
            }])
        }
    });
    const result = await proc.CheckToken({ SessionID: 'testsession', Username: 'testuser' });
    assert.ok(result.Success);
    assert.strictEqual(result.Message, '令牌匹配');
});

test('CheckToken fails for expired session from DB', async () => {
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', [{
                user_id: 'testuser',
                create_time: new Date().getTime() - 1000 * 60 * 60 * 24 * 8
            }]),
            Delete: async () => new Result(true, '')
        }
    });
    // This will fail because the token is expired and it will try to fetch from the network
    const result = await proc.CheckToken({ SessionID: 'testsession', Username: 'testuser' });
    assert.strictEqual(result.Success, false);
});

test('CheckToken succeeds with valid session from fetch', async () => {
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', []),
            GetTableSize: async () => new Result(true, '', { TableSize: 0 }),
            Insert: async () => new Result(true, '', { InsertID: 1 })
        },
        fetch: async () => new Response("user_id=testuser'")
    });
    const result = await proc.CheckToken({ SessionID: 'testsession', Username: 'testuser' });
    assert.ok(result.Success);
    assert.strictEqual(result.Message, '令牌匹配');
});

test('CheckToken fails when fetch fails', async () => {
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', [])
        },
        fetch: async () => { throw new Error('Network error') }
    });
    const result = await proc.CheckToken({ SessionID: 'testsession', Username: 'testuser' });
    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '令牌不合法');
});

test('CheckToken fails when session and username do not match', async () => {
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', [])
        },
        fetch: async () => new Response("user_id=anotheruser'")
    });
    const result = await proc.CheckToken({ SessionID: 'testsession', Username: 'testuser' });
    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '令牌不匹配');
});

test('IfUserExist returns true if user in DB', async () => {
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 1 })
        }
    });
    const result = await proc.IfUserExist('testuser');
    assert.ok(result.Success);
    assert.strictEqual(result.Data.Exist, true);
});

test('IfUserExist returns true if user found via fetch', async () => {
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 0 })
        },
        fetch: async () => new Response('some content')
    });
    const result = await proc.IfUserExist('testuser');
    assert.ok(result.Success);
    assert.strictEqual(result.Data.Exist, true);
});

test('IfUserExist returns false if user not found', async () => {
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 0 })
        },
        fetch: async () => new Response('No such User!')
    });
    const result = await proc.IfUserExist('testuser');
    assert.ok(result.Success);
    assert.strictEqual(result.Data.Exist, false);
});

test('IfUserExist returns false on fetch error', async () => {
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 0 })
        },
        fetch: async () => { throw new Error('Network error') }
    });
    const result = await proc.IfUserExist('testuser');
    assert.strictEqual(result.Success, false);
});

test('IfUserExist returns false for non-lowercase username', async () => {
    const proc = createProcess();
    const result = await proc.IfUserExist('TestUser');
    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '用户名必须为小写');
});

test('VerifyCaptcha skips if secret key is undefined', async () => {
    const proc = createProcess();
    proc.CaptchaSecretKey = undefined;
    const result = await proc.VerifyCaptcha('any-token');
    assert.ok(result.Success);
    assert.strictEqual(result.Message, '验证码检测跳过');
});

test('VerifyCaptcha fails with empty token', async () => {
    const proc = createProcess();
    const result = await proc.VerifyCaptcha('');
    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '验证码没有完成');
});

test('VerifyCaptcha succeeds with valid token', async () => {
    const proc = createProcess({
        fetch: async () => new Response(JSON.stringify({ success: true }))
    });
    const result = await proc.VerifyCaptcha('valid-token');
    assert.ok(result.Success);
    assert.strictEqual(result.Message, '验证码通过');
});

test('VerifyCaptcha fails with invalid token', async () => {
    const proc = createProcess({
        fetch: async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }))
    });
    const result = await proc.VerifyCaptcha('invalid-token');
    assert.strictEqual(result.Success, false);
    assert.match(result.Message, /验证没有通过/);
    assert.match(result.Message, /验证码令牌不正确或已过期/);
});

test('VerifyCaptcha handles multiple error codes', async () => {
    const proc = createProcess({
        fetch: async () => new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret', 'missing-input-response'] }))
    });
    const result = await proc.VerifyCaptcha('any-token');
    assert.strictEqual(result.Success, false);
    assert.match(result.Message, /密钥不正确/);
    assert.match(result.Message, /验证码令牌为空/);
});


test('AddMailMention pushes enough realtime data for direct client rendering', async () => {
    const proc = createProcess({
        db: {
            GetTableSize: async (table) => {
                if (table === 'short_message_mention') {
                    return new Result(true, '', { TableSize: 0 });
                }
                return new Result(true, '', { TableSize: 0 });
            },
            Insert: async (table) => {
                if (table === 'short_message_mention') {
                    return new Result(true, '', { InsertID: 42 });
                }
                return new Result(true, '', { InsertID: 1 });
            },
        }
    });

    await proc['AddMailMention']('alice', 'testuser');

    assert.strictEqual(proc._notifyFetch.mock.calls.length, 1);
    const notificationRequest = proc._notifyFetch.mock.calls[0].arguments[0];
    const pushedBody = await notificationRequest.json();
    assert.deepStrictEqual(pushedBody.notification, {
        type: 'mail_mention',
        data: {
            MentionID: 42,
            FromUserID: 'alice',
            MentionTime: pushedBody.notification.data.MentionTime,
        }
    });
    assert.strictEqual(typeof pushedBody.notification.data.MentionTime, 'number');
});

test('AddBBSMention pushes full mention payload for websocket clients', async () => {
    const proc = createProcess({
        db: {
            GetTableSize: async (table) => {
                if (table === 'bbs_mention') {
                    return new Result(true, '', { TableSize: 0 });
                }
                return new Result(true, '', { TableSize: 0 });
            },
            Insert: async (table) => {
                if (table === 'bbs_mention') {
                    return new Result(true, '', { InsertID: 99 });
                }
                return new Result(true, '', { InsertID: 1 });
            },
            Select: async (table) => {
                if (table === 'bbs_post') {
                    return new Result(true, '', [{ title: 'Hello world' }]);
                }
                return new Result(true, '', []);
            }
        }
    });

    proc.RawDatabase = {
        prepare: () => ({
            bind: () => ({
                run: async () => ({ results: [{ position: 30 }] })
            })
        })
    };

    await proc['AddBBSMention']('targetUser', 123, 456);

    assert.strictEqual(proc._notifyFetch.mock.calls.length, 1);
    const notificationRequest = proc._notifyFetch.mock.calls[0].arguments[0];
    const pushedBody = await notificationRequest.json();
    assert.deepStrictEqual(pushedBody.notification, {
        type: 'bbs_mention',
        data: {
            MentionID: 99,
            PostID: 123,
            ReplyID: 456,
            PostTitle: 'Hello world',
            MentionTime: pushedBody.notification.data.MentionTime,
            PageNumber: 3,
        }
    });
    assert.strictEqual(typeof pushedBody.notification.data.MentionTime, 'number');
});

test('SetUserSettings creates new settings row when none exists', async () => {
    const insertedRows = [];
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 0 }),
            Insert: async (table, data) => {
                insertedRows.push({ table, data });
                return new Result(true, '', { InsertID: 1 });
            }
        }
    });
    const result = await proc.ProcessFunctions['SetUserSettings']({ Settings: '{"Discussion":"true","Theme":"dark"}' });
    assert.ok(result.Success);
    assert.strictEqual(result.Message, '保存设置成功');
    assert.strictEqual(insertedRows.length, 1);
    assert.strictEqual(insertedRows[0].table, 'user_settings');
    assert.strictEqual(insertedRows[0].data.user_id, 'testuser');
    assert.strictEqual(insertedRows[0].data.settings, '{"Discussion":"true","Theme":"dark"}');
});

test('SetUserSettings updates existing settings row', async () => {
    const updatedRows = [];
    const proc = createProcess({
        db: {
            Insert: async () => {
                // Simulate a primary key conflict (row already exists)
                throw new Error('UNIQUE constraint failed: user_settings.user_id');
            },
            Update: async (table, data, where) => {
                updatedRows.push({ table, data, where });
                return new Result(true, '');
            }
        }
    });
    const result = await proc.ProcessFunctions['SetUserSettings']({ Settings: '{"Discussion":"false"}' });
    assert.ok(result.Success);
    assert.strictEqual(result.Message, '保存设置成功');
    assert.strictEqual(updatedRows.length, 1);
    assert.strictEqual(updatedRows[0].table, 'user_settings');
    assert.strictEqual(updatedRows[0].data.settings, '{"Discussion":"false"}');
    assert.deepStrictEqual(updatedRows[0].where, { user_id: 'testuser' });
});

test('SetUserSettings fails with invalid JSON', async () => {
    const proc = createProcess();
    const result = await proc.ProcessFunctions['SetUserSettings']({ Settings: 'not-json' });
    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '设置格式有误');
});

test('SetUserSettings fails when Settings is an array', async () => {
    const proc = createProcess();
    const result = await proc.ProcessFunctions['SetUserSettings']({ Settings: '["a","b"]' });
    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '设置格式有误');
});

test('GetUserSettings returns empty object when no settings stored', async () => {
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', [])
        }
    });
    const result = await proc.ProcessFunctions['GetUserSettings']({});
    assert.ok(result.Success);
    assert.strictEqual(result.Message, '获得设置成功');
    assert.deepStrictEqual(result.Data.Settings, {});
});

test('GetUserSettings returns stored settings', async () => {
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', [{ settings: '{"Discussion":"true","Theme":"dark"}' }])
        }
    });
    const result = await proc.ProcessFunctions['GetUserSettings']({});
    assert.ok(result.Success);
    assert.strictEqual(result.Message, '获得设置成功');
    assert.deepStrictEqual(result.Data.Settings, { Discussion: 'true', Theme: 'dark' });
});

test('GetUserSettings fails when stored settings JSON is corrupted', async () => {
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', [{ settings: 'corrupted{json' }])
        }
    });
    const result = await proc.ProcessFunctions['GetUserSettings']({});
    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '设置数据损坏');
});

test('GetUserSettings fails when stored settings JSON is valid but not an object', async () => {
    const proc = createProcess({
        db: {
            // settings is valid JSON (an array) but not an object
            Select: async () => new Result(true, '', [{ settings: '["a","b"]' }])
        }
    });
    const result = await proc.ProcessFunctions['GetUserSettings']({});
    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '设置数据损坏');
});
