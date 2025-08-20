const test = require('node:test');
const assert = require('node:assert');
const { Result, ThrowErrorIfFailed } = require('../Source/Result.ts');

test('Result toString serializes correctly', () => {
  const result = new Result(true, 'ok', { value: 42 });
  assert.strictEqual(
    result.toString(),
    JSON.stringify({ Success: true, Data: { value: 42 }, Message: 'ok' })
  );
});

test('ThrowErrorIfFailed returns data on success', () => {
  const result = new Result(true, 'msg', { hello: 'world' });
  assert.deepStrictEqual(ThrowErrorIfFailed(result), { hello: 'world' });
});

test('ThrowErrorIfFailed throws on failure', () => {
  const result = new Result(false, 'bad', { error: true });
  assert.throws(() => ThrowErrorIfFailed(result), (err) => err === result);
});
