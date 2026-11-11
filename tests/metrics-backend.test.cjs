'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const { DatabaseSync } = require('node:sqlite');
const { readMetrics } = require('../dicts/metrics.cjs');

const ID = 'a0b1c2d3-1234-5678-90ab-123456789abc';
const OTHER = 'b0b1c2d3-1234-5678-90ab-123456789abc';

function varint(value) {
  value = BigInt(value);
  const bytes = [];
  do {
    const byte = Number(value & 127n);
    value >>= 7n;
    bytes.push(byte | (value ? 128 : 0));
  } while (value);
  return Buffer.from(bytes);
}

function scalar(field, value) {
  return Buffer.concat([varint(field * 8), varint(value)]);
}

function message(field, bytes) {
  return Buffer.concat([varint(field * 8 + 2), varint(bytes.length), bytes]);
}

function snapshot({ inTok = 0, outTok = 0, cacheRead = 0, thinkTok = 0, respTok = 0,
  ttft = [0, 0], stream = [0, 0] } = {}) {
  const usage = Buffer.concat([scalar(2, inTok), scalar(3, outTok), scalar(5, cacheRead),
    scalar(9, thinkTok), scalar(10, respTok)]);
  const time = parts => Buffer.concat([scalar(1, parts[0]), scalar(2, parts[1])]);
  return message(1, Buffer.concat([message(4, usage), message(11, time(ttft)), message(12, time(stream))]));
}

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agzh-metrics-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function fixture(directory, rows = [], steps = [], id = ID, wal = false) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, `${id}.db`));
  if (wal) db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0');
  db.exec('CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER); CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER)');
  const insert = db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)');
  for (const [idx, data] of rows) insert.run(idx, data, data.length);
  const step = db.prepare('INSERT INTO steps (idx, step_type) VALUES (?, ?)');
  for (const [idx, type] of steps) step.run(idx, type);
  if (wal) return db;
  db.close();
}

function event(url) {
  const frame = { url, parent: null };
  return { sender: { mainFrame: frame, isDestroyed: () => false }, senderFrame: frame };
}

test('reads actual SQLite blobs, keeps the valid latest call, and accounts for session and turn', t => {
  const directory = temporary(t);
  fixture(directory, [
    [0, snapshot({ inTok: 100, cacheRead: 900, outTok: 40, thinkTok: 10, respTok: 30, ttft: [1, 0], stream: [2, 0] })],
    [1, snapshot({ inTok: 200, cacheRead: 1800, outTok: 120, thinkTok: 20, respTok: 100, ttft: [0, 500000000], stream: [2, 0] })],
    [2, snapshot()],
    [3, Buffer.from([10, 20, 1])],
    [4, snapshot({ inTok: 300, cacheRead: 2700, outTok: 80, thinkTok: 30, respTok: 50, ttft: [1, 250000000], stream: [0, 500000000] })],
    [5, snapshot()],
  ], [[0, 14], [2, 15], [10, 14], [11, 15], [12, 1], [14, 15]]);
  const dbFile = path.join(directory, `${ID}.db`);
  const original = fs.readFileSync(dbFile);
  const result = readMetrics(ID, directory);
  assert.deepEqual(result, {
    cascadeId: ID, hasData: true, contextLimit: 256000,
    last: { idx: 4, inTok: 300, outTok: 80, cacheRead: 2700, thinkTok: 30, respTok: 50,
      ttft: 1.25, stream: 0.5, ctx: 3000, tps: 160, e2eTps: 80 / 1.75 },
    total: { inTok: 600, cacheRead: 5400, outTok: 240, thinkTok: 60, respTok: 180, calls: 3, userTurns: 2 },
    turn: { steps: 2, outTok: 200, thinkTok: 50, respTok: 150, duration: 4.25 },
  });
  assert.deepEqual(readMetrics(ID, directory), result);
  assert.deepEqual(readMetrics(ID.toUpperCase(), directory), { ...result, cascadeId: ID.toUpperCase() });
  assert.deepEqual(fs.readFileSync(dbFile), original, 'read-only collection leaves the original database unchanged');
});

test('uses E2E only when stream timing is too short or exceeds the upstream speed ceiling', t => {
  for (const [stream, outTok, expected] of [
    [[0, 249000000], 100, 100 / 1.249],
    [[0, 250000000], 150, 600],
    [[0, 250000000], 151, 151 / 1.25],
    [[0, 0], 100, 100],
  ]) {
    const directory = temporary(t);
    fixture(directory, [[0, snapshot({ inTok: 1, outTok, ttft: [1, 0], stream })]]);
    assert.equal(readMetrics(ID, directory).last.tps, expected);
  }
  const directory = temporary(t);
  fixture(directory, [[0, snapshot({ inTok: 1, outTok: 10 })]]);
  const result = readMetrics(ID, directory);
  assert.equal(result.last.tps, 0);
  assert.equal(result.last.e2eTps, 0);
  assert.deepEqual(result.turn, { steps: 0, outTok: 0, thinkTok: 0, respTok: 0, duration: 0 });
});

test('rejects malformed protobuf records without losing preceding valid usage', t => {
  const invalid = [
    Buffer.from([0]),                              // field zero
    Buffer.from([0x80]),                           // truncated tag
    Buffer.alloc(11, 0x80),                       // oversized tag varint
    Buffer.from([10, 0x80]),                       // truncated length
    Buffer.from([10, 20, 8, 1]),                   // message overruns buffer
    Buffer.from([9, 1, 2, 3]),                    // truncated fixed64
    Buffer.from([13, 1, 2, 3]),                   // truncated fixed32
    Buffer.from([11]),                            // unsupported group
    message(1, Buffer.from([34, 3, 16, 0x80])),    // truncated nested field
    message(1, message(4, Buffer.from([16, 0x80]))), // truncated nested value
    message(1, message(4, Buffer.concat([Buffer.from([16]), Buffer.alloc(9, 0xff), Buffer.from([2])]))),
    message(1, message(4, scalar(2, 9007199254740992n))), // unsafe token count
    snapshot({ inTok: Number.MAX_SAFE_INTEGER, cacheRead: 1 }),
    snapshot({ inTok: 1, ttft: [0, 1000000000] }), // invalid duration nanoseconds
    message(1, message(4, message(2, Buffer.from([1])))), // wrong usage wire type
  ];
  const directory = temporary(t);
  fixture(directory, [[0, snapshot({ inTok: 10, outTok: 5 })], ...invalid.map((data, idx) => [idx + 1, data])]);
  const result = readMetrics(ID, directory);
  assert.equal(result.last.idx, 0);
  assert.equal(result.total.calls, 1);
  assert.equal(result.total.inTok, 10);

  const emptyDirectory = temporary(t);
  fixture(emptyDirectory, invalid.map((data, idx) => [idx, data]));
  assert.deepEqual(readMetrics(ID, emptyDirectory), { cascadeId: ID, hasData: false });
});

test('skips bounded unknown protobuf fields including full unsigned 64-bit varints', t => {
  const directory = temporary(t);
  const unknown = Buffer.concat([
    scalar(90, 18446744073709551615n),
    varint(91 * 8 + 1), Buffer.alloc(8),
    varint(92 * 8 + 5), Buffer.alloc(4),
    message(93, Buffer.from([255, 255])),
  ]);
  fixture(directory, [[0, Buffer.concat([snapshot({ inTok: 50, outTok: 2 }), unknown])]]);
  assert.equal(readMetrics(ID, directory).last.inTok, 50);
});

test('returns no data only for absent or empty usage, never another conversation', t => {
  const directory = temporary(t);
  fixture(directory, [[0, snapshot({ inTok: 10, outTok: 5 })]], [], OTHER);
  assert.deepEqual(readMetrics(ID, directory), { cascadeId: ID, hasData: false });
  fixture(directory, []);
  assert.deepEqual(readMetrics(ID, directory), { cascadeId: ID, hasData: false });
  const zero = temporary(t);
  fixture(zero, [[0, snapshot()], [1, Buffer.alloc(0)]]);
  assert.deepEqual(readMetrics(ID, zero), { cascadeId: ID, hasData: false });
});

test('validates strict UUIDs and refuses symlink database paths', t => {
  const directory = temporary(t);
  for (const id of [null, undefined, 1, {}, '', '../secret', '------------------------------------',
    `${ID}/../${OTHER}`, `${ID}\u0000`, `${ID}.db`, 'a0b1c2d3_1234-5678-90ab-123456789abc']) {
    assert.throws(() => readMetrics(id, directory), /无效的会话标识/);
  }
  if (process.platform !== 'win32') {
    fixture(directory, [[0, snapshot({ inTok: 1 })]], [], OTHER);
    fs.symlinkSync(path.join(directory, `${OTHER}.db`), path.join(directory, `${ID}.db`));
    assert.throws(() => readMetrics(ID, directory), /不是普通文件/);
  }
});

test('observes WAL-only updates and user turns instead of reusing cached or stale data', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agzh-metrics-'));
  const writer = fixture(directory, [[0, snapshot({ inTok: 10, outTok: 5 })]], [[0, 14], [1, 15]], ID, true);
  t.after(() => {
    writer.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const mainFile = path.join(directory, `${ID}.db`);
  const original = fs.readFileSync(mainFile);
  assert.equal(readMetrics(ID, directory).last.outTok, 5);
  writer.prepare('UPDATE gen_metadata SET data = ? WHERE idx = ?').run(snapshot({ inTok: 10, outTok: 7 }), 0);
  assert.equal(readMetrics(ID, directory).last.outTok, 7);
  assert.deepEqual(fs.readFileSync(mainFile), original, 'the update is still in the WAL');
  writer.prepare('INSERT INTO steps VALUES (?, ?)').run(5, 14);
  const result = readMetrics(ID, directory);
  assert.equal(result.total.userTurns, 2);
  assert.equal(result.turn.steps, 0);
  assert.equal(result.last.outTok, 7);
  writer.exec('DELETE FROM gen_metadata');
  assert.deepEqual(readMetrics(ID, directory), { cascadeId: ID, hasData: false });
});

test('read failures throw rather than returning old cache data', t => {
  const directory = temporary(t);
  fixture(directory, [[0, snapshot({ inTok: 1 })]]);
  assert.equal(readMetrics(ID, directory).hasData, true);
  const writer = new DatabaseSync(path.join(directory, `${ID}.db`));
  writer.exec('DROP TABLE gen_metadata');
  writer.close();
  assert.throws(() => readMetrics(ID, directory), /gen_metadata/);
  fs.unlinkSync(path.join(directory, `${ID}.db`));
  assert.deepEqual(readMetrics(ID, directory), { cascadeId: ID, hasData: false });
});

test('register lazily loads Electron, selects the channel, and enforces main-frame local app origins', t => {
  const home = temporary(t);
  const appPath = path.join(home, 'app.asar');
  fixture(path.join(home, '.gemini', 'antigravity', 'conversations'), [[0, snapshot({ inTok: 11 })]]);
  fixture(path.join(home, '.gemini', 'antigravity-insiders', 'conversations'), [[0, snapshot({ inTok: 22 })]]);
  t.mock.method(os, 'homedir', () => home);
  const originalLoad = Module._load;
  let applicationName = 'Antigravity';
  let handler;
  let registrations = 0;
  t.mock.method(Module, '_load', function(request, ...args) {
    if (request === 'electron') return {
      app: { getName: () => applicationName, getAppPath: () => appPath },
      ipcMain: { handle(channel, callback) {
        assert.equal(channel, 'agzh:metrics');
        handler = callback;
        registrations++;
      } },
    };
    return originalLoad.call(this, request, ...args);
  });
  const modulePath = require.resolve('../dicts/metrics.cjs');
  t.after(() => { delete require.cache[modulePath]; });
  for (const [name, expected] of [['Antigravity', 11], ['Antigravity - Insiders', 22]]) {
    applicationName = name;
    delete require.cache[modulePath];
    const module = require(modulePath);
    const before = registrations;
    module.register();
    module.register();
    assert.equal(registrations, before + 1, 'registration is idempotent');
    for (const url of ['http://127.0.0.1:8080/workbench', 'https://localhost:8443/workbench',
      'http://[::1]:8080/workbench', pathToFileURL(path.join(appPath, 'dist', 'workbench.html')).href,
      `vscode-file://vscode-app${pathToFileURL(path.join(appPath, 'out', 'workbench.html')).pathname}`]) {
      assert.equal(handler(event(url), ID).last.inTok, expected, url);
    }
    for (const url of ['https://example.com/workbench', 'https://localhost.evil.test/workbench',
      'https://127.0.0.1.evil.test', 'data:text/html,hello', 'about:blank',
      'file://remote/share/workbench.html', pathToFileURL(path.join(home, 'app.asar-evil', 'workbench.html')).href,
      'vscode-file://evil/anything', 'https://user:pass@localhost/workbench']) {
      assert.deepEqual(handler(event(url), ID), { cascadeId: ID, hasData: false, error: '不受信任的指标请求' }, url);
    }
    const subframe = event('http://localhost:8080');
    subframe.senderFrame = { url: 'http://localhost:8080', parent: subframe.sender.mainFrame };
    assert.equal(handler(subframe, ID).error, '不受信任的指标请求');
    const destroyed = event('http://localhost:8080');
    destroyed.sender.isDestroyed = () => true;
    assert.equal(handler(destroyed, ID).hasData, false);
    assert.equal(handler({}, ID).error, '不受信任的指标请求');
    assert.deepEqual(handler(event('http://localhost:8080'), '../outside'),
      { cascadeId: null, hasData: false, error: '无法读取会话指标' });
    assert.deepEqual(handler(event('http://localhost:8080'), OTHER), { cascadeId: OTHER, hasData: false });
  }
  const corrupt = path.join(home, '.gemini', 'antigravity-insiders', 'conversations', `${OTHER}.db`);
  fs.writeFileSync(corrupt, 'not a SQLite database');
  assert.deepEqual(handler(event('http://localhost:8080'), OTHER),
    { cascadeId: OTHER, hasData: false, error: '无法读取会话指标' });
});
