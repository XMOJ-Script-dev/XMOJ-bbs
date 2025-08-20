const test = require('node:test');
const assert = require('node:assert');
const { Process } = require('../Source/Process.ts');

function createProcess() {
  const stubDb = { withSession: () => stubDb };
  const env = {
    API_TOKEN: '',
    ACCOUNT_ID: '',
    GithubImagePAT: '',
    xssmseetee_v1_key: '',
    kv: {},
    CaptchaSecretKey: '',
    DB: stubDb,
    logdb: {},
    AI: {}
  };
  const req = new Request('https://example.com');
  return new Process(req, env);
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
