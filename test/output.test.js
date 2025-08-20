const test = require('node:test');
const assert = require('node:assert');
const { Output } = require('../Source/Output.ts');

test('Output methods use corresponding console functions', () => {
  const calls = [];
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.log = (fmt, msg) => calls.push(['log', fmt, msg]);
  console.warn = (fmt, msg) => calls.push(['warn', fmt, msg]);
  console.error = (fmt, msg) => calls.push(['error', fmt, msg]);
  console.debug = (fmt, msg) => calls.push(['debug', fmt, msg]);

  Output.Debug('d');
  Output.Log('l');
  Output.Warn('w');
  Output.Error('e');

  assert.deepStrictEqual(calls.map(c => c[0]), ['log', 'warn', 'error']);

  console.log = original.log;
  console.warn = original.warn;
  console.error = original.error;
  console.debug = original.debug;
});
