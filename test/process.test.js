const test = require('node:test');
const assert = require('node:assert');
const { Process, RebuildStdList } = require('../Source/Process.ts');
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

function stubGetPostQuery(proc, rows) {
    const calls = [];
    proc.RawDatabase = {
        prepare: (query) => ({
            bind: (...args) => ({
                all: async () => {
                    calls.push({ query, args });
                    return { results: rows };
                }
            })
        })
    };
    return calls;
}

function postRow(overrides = {}) {
    return Object.assign({
        post_user_id: 'alice',
        problem_id: 1000,
        title: 'Post one',
        post_time: 111,
        board_id: 2,
        board_name: '学术版',
        lock_person: null,
        lock_time: null,
        reply_count: 2,
        reply_id: null,
        reply_user_id: null,
        content: null,
        reply_time: null,
        edit_time: null,
        edit_person: null
    }, overrides);
}

test('GetPost fetches the whole discussion in a single query', async () => {
    const proc = createProcess();
    const calls = stubGetPostQuery(proc, [
        postRow({ reply_id: 1, reply_user_id: 'u1', content: 'hello', reply_time: 1001 }),
        postRow({ reply_id: 2, reply_user_id: 'u2', content: 'world', reply_time: 1002 })
    ]);

    const result = await proc.ProcessFunctions['GetPost']({ PostID: 1, Page: 1 });

    assert.ok(result.Success);
    assert.strictEqual(result.Message, '获得讨论成功');
    assert.strictEqual(calls.length, 1, 'expected exactly one SQL query');
    assert.deepStrictEqual(calls[0].args, [1, 1, 15, 0, 1]);
    assert.strictEqual(result.Data.UserID, 'alice');
    assert.strictEqual(result.Data.ProblemID, 1000);
    assert.strictEqual(result.Data.Title, 'Post one');
    assert.strictEqual(result.Data.PostTime, 111);
    assert.strictEqual(result.Data.BoardID, 2);
    assert.strictEqual(result.Data.BoardName, '学术版');
    assert.strictEqual(result.Data.PageCount, 1);
    assert.deepStrictEqual(result.Data.Lock, { Locked: false, LockPerson: '', LockTime: 0 });
    assert.deepStrictEqual(result.Data.Reply, [
        { ReplyID: 1, UserID: 'u1', Content: 'hello', ReplyTime: 1001, EditTime: null, EditPerson: null },
        { ReplyID: 2, UserID: 'u2', Content: 'world', ReplyTime: 1002, EditTime: null, EditPerson: null }
    ]);
});

test('GetPost binds the offset for the requested page', async () => {
    const proc = createProcess();
    const calls = stubGetPostQuery(proc, [
        postRow({ reply_count: 20, reply_id: 16, reply_user_id: 'u16', content: 'x', reply_time: 1016 })
    ]);

    const result = await proc.ProcessFunctions['GetPost']({ PostID: 7, Page: 2 });

    assert.ok(result.Success);
    assert.deepStrictEqual(calls[0].args, [7, 7, 15, 15, 7]);
    assert.strictEqual(result.Data.PageCount, 2);
    assert.strictEqual(result.Data.Reply.length, 1);
});

test('GetPost reports a locked discussion', async () => {
    const proc = createProcess();
    stubGetPostQuery(proc, [
        postRow({ lock_person: 'admin', lock_time: 999, reply_count: 1, reply_id: 1, reply_user_id: 'u1', content: 'hi', reply_time: 1001 })
    ]);

    const result = await proc.ProcessFunctions['GetPost']({ PostID: 1, Page: 1 });

    assert.ok(result.Success);
    assert.deepStrictEqual(result.Data.Lock, { Locked: true, LockPerson: 'admin', LockTime: 999 });
});

test('GetPost rewrites legacy domain in reply content', async () => {
    const proc = createProcess();
    stubGetPostQuery(proc, [
        postRow({ reply_count: 1, reply_id: 1, reply_user_id: 'u1', content: 'see https://xmoj-bbs.tech/a and xmoj-bbs.tech/b', reply_time: 1001 })
    ]);

    const result = await proc.ProcessFunctions['GetPost']({ PostID: 1, Page: 1 });

    assert.strictEqual(result.Data.Reply[0].Content, 'see https://xmoj-bbs.me/a and xmoj-bbs.me/b');
});

test('GetPost fails when the discussion does not exist', async () => {
    const proc = createProcess();
    stubGetPostQuery(proc, []);

    const result = await proc.ProcessFunctions['GetPost']({ PostID: 999, Page: 1 });

    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '该讨论不存在');
});

test('GetPost returns an empty discussion when it has no replies', async () => {
    const proc = createProcess();
    stubGetPostQuery(proc, [postRow({ reply_count: 0 })]);

    const result = await proc.ProcessFunctions['GetPost']({ PostID: 2, Page: 1 });

    assert.ok(result.Success);
    assert.strictEqual(result.Data.PageCount, 0);
    assert.deepStrictEqual(result.Data.Reply, []);
    assert.strictEqual(result.Data.Title, '', 'metadata is withheld for an empty discussion, as before');
});

test('GetPost rejects a page outside the available range', async () => {
    const proc = createProcess();
    const calls = stubGetPostQuery(proc, [postRow({ reply_count: 2 })]);

    const result = await proc.ProcessFunctions['GetPost']({ PostID: 1, Page: 5 });

    assert.strictEqual(result.Success, false);
    assert.strictEqual(result.Message, '参数页数不在范围1~1内');
    assert.strictEqual(calls.length, 1);
});

test('GetPost clamps a negative offset for a non-positive page', async () => {
    const proc = createProcess();
    const calls = stubGetPostQuery(proc, [postRow({ reply_count: 2 })]);

    const result = await proc.ProcessFunctions['GetPost']({ PostID: 1, Page: 0 });

    assert.strictEqual(result.Success, false);
    assert.strictEqual(calls[0].args[3], 0, 'offset must never be negative');
});

test('GetPost clears mentions for the reader', async () => {
    const deleted = [];
    const proc = createProcess({
        db: {
            Delete: async (table, where) => {
                deleted.push({ table, where });
                return new Result(true, '');
            }
        }
    });
    stubGetPostQuery(proc, [
        postRow({ reply_count: 1, reply_id: 1, reply_user_id: 'u1', content: 'hi', reply_time: 1001 })
    ]);

    await proc.ProcessFunctions['GetPost']({ PostID: 1, Page: 1 });

    assert.deepStrictEqual(deleted, [{ table: 'bbs_mention', where: { post_id: 1, to_user_id: 'testuser' } }]);
});

// --- std_list KV cache ---------------------------------------------------
// The cache is a denormalised copy of `SELECT problem_id FROM std_answer`.
// It is rebuilt wholesale from the database rather than patched incrementally,
// so a dropped or racing write cannot leave it permanently out of sync.

function kvStub(initial) {
    const store = { std_list: initial };
    const puts = [];
    return {
        store,
        puts,
        get: async (key) => (key in store ? store[key] : null),
        put: async (key, value) => { store[key] = value; puts.push(value); },
    };
}

test('RebuildStdList writes every problem_id from the database', async () => {
    const kv = kvStub('stale\n');
    const db = {
        Select: async (table, columns) => {
            assert.strictEqual(table, 'std_answer');
            assert.deepStrictEqual(columns, ['problem_id']);
            return new Result(true, '', [
                { problem_id: 1000 }, { problem_id: 1001 }, { problem_id: 1002 }
            ]);
        }
    };

    const list = await RebuildStdList(db, kv);

    assert.strictEqual(list, '1000\n1001\n1002');
    assert.strictEqual(kv.store.std_list, '1000\n1001\n1002');
});

test('RebuildStdList writes an empty cache when the table is empty', async () => {
    const kv = kvStub('1000\n1001\n');
    const db = { Select: async () => new Result(true, '', []) };

    await RebuildStdList(db, kv);

    assert.strictEqual(kv.store.std_list, '');
});

test('RebuildStdList heals a cache that has drifted from the database', async () => {
    // 1001 was dropped by a lost write; 9999 was never in the table.
    const kv = kvStub('1000\n9999\n');
    const db = {
        Select: async () => new Result(true, '', [
            { problem_id: 1000 }, { problem_id: 1001 }, { problem_id: 1002 }
        ])
    };

    await RebuildStdList(db, kv);

    assert.strictEqual(kv.store.std_list, '1000\n1001\n1002');
});

const STD_CODE_MARKER = '/' + '*'.repeat(62);

// Minimal pages that satisfy the XMOJ scraper in UploadStd.
function stdScraperFetch() {
    const statusPage = `<table id="problemstatus">
        <thead><tr><th>#</th><th>SID</th><th>user</th></tr></thead>
        <tbody>
          <tr><td>1</td><td>1</td><td>someone</td></tr>
          <tr><td>2</td><td>555</td><td>std</td></tr>
        </tbody>
      </table>[NEXT]`;
    const sourcePage = `int main(){}\n${STD_CODE_MARKER}\ntrailer\n<!--not cached-->`;
    return async (url) => new Response(
        String(url).includes('getsource.php') ? sourcePage : statusPage
    );
}

test('UploadStd rebuilds and awaits the cache after inserting a std', async () => {
    const kv = kvStub('1000\n');
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 0 }),
            Insert: async () => new Result(true, '', { InsertID: 1 }),
            Select: async () => new Result(true, '', [{ problem_id: 1000 }, { problem_id: 1234 }]),
        }
    });
    proc.kv = kv;
    proc.GetProblemScoreChecker = async () => 100;
    proc.Fetch = stdScraperFetch();

    const result = await proc.ProcessFunctions['UploadStd']({ ProblemID: 1234 });

    assert.ok(result.Success, result.Message);
    assert.strictEqual(kv.puts.length, 1, 'cache written exactly once');
    assert.strictEqual(kv.store.std_list, '1000\n1234',
        'cache must reflect the database once UploadStd resolves');
});

test('UploadStd repairs a cache missing an already-uploaded problem', async () => {
    // The DB already has a std for 1234 but the cache lost it. Re-uploading
    // must put it back rather than silently doing nothing.
    const kv = kvStub('1000\n');
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 1 }),
            Select: async () => new Result(true, '', [{ problem_id: 1000 }, { problem_id: 1234 }]),
        }
    });
    proc.kv = kv;

    const result = await proc.ProcessFunctions['UploadStd']({ ProblemID: 1234 });

    assert.ok(result.Success);
    assert.strictEqual(result.Message, '此题已经有人上传标程');
    assert.strictEqual(kv.store.std_list, '1000\n1234');
});

test('UploadStd touches neither database nor cache when already in sync', async () => {
    // The hot path: the script re-uploads a problem that already has a std and
    // is already cached. This must cost zero database rows and zero KV writes.
    const kv = kvStub('1000\n1234\n');
    const select = test.mock.fn(async () => new Result(true, '', []));
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 1 }),
            Select: select,
        }
    });
    proc.kv = kv;

    await proc.ProcessFunctions['UploadStd']({ ProblemID: 1234 });

    assert.strictEqual(select.mock.calls.length, 0, 'no database read on the hot path');
    assert.strictEqual(kv.puts.length, 0, 'no cache write on the hot path');
    assert.strictEqual(kv.store.std_list, '1000\n1234\n', 'cache left untouched');
});

test('GetStdList returns no spurious trailing zero', async () => {
    const proc = createProcess();
    proc.kv = kvStub('1000\n1001\n1002\n');   // legacy trailing-newline format

    const result = await proc.ProcessFunctions['GetStdList']({});

    assert.ok(result.Success);
    assert.deepStrictEqual(result.Data.StdList, [1000, 1001, 1002]);
});

test('GetStdList fills the cache from the database when the key is unset', async () => {
    // An unset key is not an empty list - answering [] would tell the client
    // that no problem has a std answer at all.
    const kv = kvStub(undefined);
    const proc = createProcess({
        db: {
            Select: async () => new Result(true, '', [
                { problem_id: 1000 }, { problem_id: 1001 }
            ])
        }
    });
    proc.kv = kv;

    const result = await proc.ProcessFunctions['GetStdList']({});

    assert.ok(result.Success);
    assert.deepStrictEqual(result.Data.StdList, [1000, 1001]);
    assert.strictEqual(kv.store.std_list, '1000\n1001', 'cache filled for next time');
});

test('GetStdList serves an empty cache without touching the database', async () => {
    // An empty string is a legitimately empty cache (no stds uploaded yet) and
    // must be distinguished from a missing key.
    const select = test.mock.fn(async () => new Result(true, '', []));
    const proc = createProcess({ db: { Select: select } });
    proc.kv = kvStub('');

    const result = await proc.ProcessFunctions['GetStdList']({});

    assert.ok(result.Success);
    assert.deepStrictEqual(result.Data.StdList, []);
    assert.strictEqual(select.mock.calls.length, 0, 'empty cache is valid, no rebuild');
});

test('UploadStd rebuilds when the cache key is unset entirely', async () => {
    const kv = kvStub(undefined);
    const proc = createProcess({
        db: {
            GetTableSize: async () => new Result(true, '', { TableSize: 1 }),
            Select: async () => new Result(true, '', [{ problem_id: 1234 }]),
        }
    });
    proc.kv = kv;

    await proc.ProcessFunctions['UploadStd']({ ProblemID: 1234 });

    assert.strictEqual(kv.store.std_list, '1234');
});
