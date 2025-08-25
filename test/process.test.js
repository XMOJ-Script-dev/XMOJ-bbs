const test = require('node:test');
const assert = require('node:assert');
const { Process } = require('../Source/Process.ts');
const { Result } = require('../Source/Result.ts');

function createProcess(mocks = {}) {
    const {
        db: db_mocks = {},
        fetch: fetch_mock,
        kv: kv_mocks = {},
        ai: ai_mocks = {},
        logdb: logdb_mocks = {},
        req: req_mock,
    } = mocks;

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

test('IsSilenced returns true for silenced users', () => {
    const proc = createProcess();
    proc.Username = "zhaochenyi";
    assert.strictEqual(proc.IsSilenced(), true);
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
