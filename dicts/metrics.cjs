'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cache = new Map();
const MAX_CACHE = 30;

function proto(buffer) {
  let offset = 0;
  const fields = new Map();
  function varint() {
    let value = 0n;
    for (let byte = 0; byte < 10; byte++) {
      if (offset >= buffer.length) throw new Error('截断的指标数据');
      const part = buffer[offset++];
      if (byte === 9 && part > 1) throw new Error('无效的指标整数');
      value |= BigInt(part & 127) << BigInt(byte * 7);
      if (!(part & 128)) return value;
    }
    throw new Error('无效的指标整数');
  }
  while (offset < buffer.length) {
    const tag = varint();
    if (tag < 8n || tag > 0xffffffffn) throw new Error('无效的指标字段');
    const field = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (wire === 0) {
      fields.set(field, varint());
    } else if (wire === 1 || wire === 2 || wire === 5) {
      const size = wire === 2 ? varint() : BigInt(wire === 1 ? 8 : 4);
      if (size > BigInt(buffer.length - offset)) throw new Error('截断的指标字段');
      const end = offset + Number(size);
      fields.set(field, buffer.subarray(offset, end));
      offset = end;
    } else {
      throw new Error('不支持的指标字段');
    }
  }
  return fields;
}

function message(fields, field) {
  const value = fields.get(field);
  if (value === undefined) return new Map();
  if (!(value instanceof Uint8Array)) throw new Error('无效的指标消息');
  return proto(value);
}

function number(fields, field) {
  const value = fields.get(field);
  if (value === undefined) return 0;
  if (typeof value !== 'bigint' || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('无效的指标数值');
  }
  return Number(value);
}

function duration(fields, field) {
  const value = message(fields, field);
  const nanos = number(value, 2);
  if (nanos >= 1e9) throw new Error('无效的指标耗时');
  return number(value, 1) + nanos / 1e9;
}

function signature(dbPath) {
  function stat(file, optional) {
    try {
      const value = fs.lstatSync(file, { bigint: true });
      if (!value.isFile()) throw new Error('指标文件不是普通文件');
      return `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
    } catch (error) {
      if (optional && error.code === 'ENOENT') return null;
      throw error;
    }
  }
  const db = stat(dbPath, true);
  return db === null ? null : `${db}|${stat(`${dbPath}-wal`, true)}`;
}

function readMetrics(cascadeId, conversationsDir) {
  if (typeof cascadeId !== 'string' || !UUID.test(cascadeId)) {
    throw new Error('无效的会话标识');
  }
  const dbPath = path.join(conversationsDir, `${cascadeId.toLowerCase()}.db`);
  const before = signature(dbPath);
  const empty = { cascadeId, hasData: false };
  if (before === null) {
    cache.delete(dbPath);
    return empty;
  }
  const cached = cache.get(dbPath);
  if (cached && cached.signature === before) {
    cache.delete(dbPath);
    cache.set(dbPath, cached);
    return { ...cached.payload, cascadeId };
  }

  let db;
  let rows;
  let user;
  let planner;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(dbPath, { readOnly: true });
    // All three queries must describe the same live WAL snapshot.
    db.exec('BEGIN');
    rows = db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx ASC').all();
    user = db.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(idx), -1) AS lastIdx FROM steps WHERE step_type = ?').get(14);
    planner = db.prepare('SELECT COUNT(*) AS count FROM steps WHERE step_type = ? AND idx > ?').get(15, user.lastIdx);
    db.exec('COMMIT');
  } finally {
    if (db) db.close();
  }

  const valid = [];
  const total = { inTok: 0, cacheRead: 0, outTok: 0, thinkTok: 0, respTok: 0, calls: 0, userTurns: user.count };
  for (const row of rows) {
    try {
      if (!Number.isSafeInteger(row.idx) || row.idx < 0 || !(row.data instanceof Uint8Array)) continue;
      const chat = message(proto(row.data), 1);
      const usage = message(chat, 4);
      const inTok = number(usage, 2);
      const outTok = number(usage, 3);
      const cacheRead = number(usage, 5);
      const thinkTok = number(usage, 9);
      const respTok = number(usage, 10);
      const ttft = duration(chat, 11);
      const stream = duration(chat, 12);
      const ctx = inTok + cacheRead;
      if (!Number.isSafeInteger(ctx)) throw new Error('无效的上下文数值');
      if (ctx === 0 && outTok === 0) continue;
      const call = { idx: row.idx, inTok, outTok, cacheRead, thinkTok, respTok, ttft, stream, ctx };
      valid.push(call);
      for (const key of ['inTok', 'cacheRead', 'outTok', 'thinkTok', 'respTok']) total[key] += call[key];
    } catch {
      // Incomplete metadata snapshots must not erase an earlier valid call.
    }
  }

  let payload = empty;
  if (valid.length) {
    total.calls = valid.length;
    const last = valid[valid.length - 1];
    const e2e = last.ttft + last.stream;
    last.e2eTps = e2e > 0 ? last.outTok / e2e : 0;
    const streamTps = last.stream >= 0.25 ? last.outTok / last.stream : 0;
    last.tps = streamTps > 0 && streamTps <= 600 ? streamTps : last.e2eTps;
    const turn = { steps: 0, outTok: 0, thinkTok: 0, respTok: 0, duration: 0 };
    // shortcut: align distinct indexes by planner count; use a join when the schema exposes one.
    for (let i = Math.max(0, valid.length - planner.count); i < valid.length; i++) {
      const call = valid[i];
      turn.steps++;
      turn.outTok += call.outTok;
      turn.thinkTok += call.thinkTok;
      turn.respTok += call.respTok;
      turn.duration += call.ttft + call.stream;
    }
    payload = { cascadeId, hasData: true, contextLimit: 256000, last, total, turn };
  }
  // A writer may have committed while the read transaction was in progress.
  if (signature(dbPath) === before) {
    cache.delete(dbPath);
    cache.set(dbPath, { signature: before, payload });
    if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  }
  return payload;
}

function trustedSender(event, appPath) {
  const sender = event.sender;
  const frame = event.senderFrame;
  if (!sender || sender.isDestroyed() || !frame || frame !== sender.mainFrame || frame.parent !== null) return false;
  try {
    const url = new URL(frame.url);
    if (url.username || url.password) return false;
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    }
    if (!((url.protocol === 'file:' && (!url.hostname || url.hostname === 'localhost')) ||
          (url.protocol === 'vscode-file:' && url.hostname === 'vscode-app'))) return false;
    let file = decodeURIComponent(url.pathname);
    if (process.platform === 'win32') file = file.replace(/^\/(?=[a-z]:\/)/i, '');
    const relative = path.relative(appPath, path.resolve(file));
    return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  } catch {
    return false;
  }
}

let registered = false;
function register() {
  if (registered) return;
  const { app, ipcMain } = require('electron');
  const conversationsDir = path.join(os.homedir(), '.gemini',
    /insiders/i.test(app.getName()) ? 'antigravity-insiders' : 'antigravity', 'conversations');
  const appPath = path.resolve(app.getAppPath());
  ipcMain.handle('agzh:metrics', (event, cascadeId) => {
    const empty = { cascadeId: typeof cascadeId === 'string' && UUID.test(cascadeId) ? cascadeId : null, hasData: false };
    if (!trustedSender(event, appPath)) return { ...empty, error: '不受信任的指标请求' };
    try {
      return readMetrics(cascadeId, conversationsDir);
    } catch (error) {
      const message = error.code === 'ERR_UNKNOWN_BUILTIN_MODULE'
        ? '客户端缺少内置 SQLite，请升级 Antigravity 后重试。' : '无法读取会话指标';
      return { ...empty, error: message };
    }
  });
  registered = true;
}

module.exports = { readMetrics, register };
