const test = require('node:test');
const assert = require('node:assert');
const { Database } = require('../Source/Database.ts');

function createStub(responses) {
  return {
    queries: [],
    withSession() { return this; },
    prepare(q) {
      const self = this;
      return {
        bind(...args) {
          return {
            all: async () => {
              self.queries.push({ q, args });
              const r = responses.shift();
              if (r instanceof Error) throw r;
              return r;
            }
          };
        }
      };
    }
  };
}

test('Insert builds SQL and returns InsertID', async () => {
  const stub = createStub([{ results: [], meta: { last_row_id: 7 } }]);
  const db = new Database(stub);
  const res = await db.Insert('users', { name: 'Alice', age: 20 });
  assert.ok(res.Success);
  assert.strictEqual(res.Data.InsertID, 7);
  assert.strictEqual(stub.queries[0].q, 'INSERT INTO `users` (`name`, `age`) VALUES (?, ?);');
  assert.deepStrictEqual(stub.queries[0].args, ['Alice', 20]);
});

test('Select supports conditions and options', async () => {
  const stub = createStub([{ results: [{ id: 1 }], meta: {} }]);
  const db = new Database(stub);
  const res = await db.Select(
    'users',
    ['id'],
    { id: 1, age: { Operator: '>', Value: 18 } },
    { Order: 'id', OrderIncreasing: true, Limit: 1, Offset: 0 },
    true
  );
  assert.ok(res.Success);
  assert.deepStrictEqual(res.Data, [{ id: 1 }]);
  assert.strictEqual(
    stub.queries[0].q,
    'SELECT DISTINCT `id` FROM `users` WHERE `id` = ? AND `age` > ? ORDER BY `id` ASC LIMIT 1 OFFSET 0;'
  );
  assert.deepStrictEqual(stub.queries[0].args, [1, 18]);
});

test('Update builds correct statement', async () => {
  const stub = createStub([{ results: [], meta: {} }]);
  const db = new Database(stub);
  const res = await db.Update('users', { name: 'Bob' }, { id: 1 });
  assert.ok(res.Success);
  assert.strictEqual(stub.queries[0].q, 'UPDATE `users` SET `name` = ? WHERE `id` = ?;');
  assert.deepStrictEqual(stub.queries[0].args, ['Bob', 1]);
});

test('GetTableSize returns count', async () => {
  const stub = createStub([{ results: [{ 'COUNT(*)': 3 }], meta: {} }]);
  const db = new Database(stub);
  const res = await db.GetTableSize('users', { age: { Operator: ">=", Value: 18 } });
  assert.ok(res.Success);
  assert.strictEqual(res.Data.TableSize, 3);
  assert.strictEqual(
    stub.queries[0].q,
    'SELECT COUNT(*) FROM `users` WHERE `age` >= ?;'
  );
  assert.deepStrictEqual(stub.queries[0].args, [18]);
});

test('Delete builds statement with condition', async () => {
  const stub = createStub([{ results: [], meta: {} }]);
  const db = new Database(stub);
  const res = await db.Delete('users', { id: 1 });
  assert.ok(res.Success);
  assert.strictEqual(stub.queries[0].q, 'DELETE FROM `users` WHERE `id` = ? ;');
  assert.deepStrictEqual(stub.queries[0].args, [1]);
});

test('Query returns failure on database error', async () => {
  const stub = createStub([new Error('bad')]);
  const db = new Database(stub);
  const result = await db.Query('SELECT 1;', []);
  assert.strictEqual(result.Success, false);
});
