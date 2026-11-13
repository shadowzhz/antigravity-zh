const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../dicts/metrics.js'), 'utf8');
const A = '12345678-1234-1234-1234-123456789abc';
const B = 'abcdefab-abcd-abcd-abcd-abcdefabcdef';
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(id = A, unsupported = false) {
  class Target {
    constructor() { this.events = new Map(); }
    addEventListener(name, fn) { this.events.set(name, [...(this.events.get(name) || []), fn]); }
    removeEventListener(name, fn) { this.events.set(name, (this.events.get(name) || []).filter(item => item !== fn)); }
    fire(name, event = {}) { for (const fn of this.events.get(name) || []) fn(event); }
  }
  class Element extends Target {
    constructor(tag = 'div') {
      super(); this.tagName = tag; this.children = []; this.attrs = {}; this.style = {};
      this.parentElement = null; this._text = ''; this.offsetWidth = 100; this.offsetHeight = 160;
    }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) { this.replaceChildren(); this._text = String(value); }
    get firstElementChild() { return this.children[0]; }
    get isConnected() { return this === body || !!this.parentElement?.isConnected; }
    appendChild(child) { child.remove(); child.parentElement = this; this.children.push(child); return child; }
    remove() {
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1);
      this.parentElement = null;
    }
    replaceChildren() { for (const child of this.children) child.parentElement = null; this.children = []; this._text = ''; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    removeAttribute(key) { delete this.attrs[key]; }
    getBoundingClientRect() { return { left: 30, top: 500, bottom: 522 }; }
    querySelector(selector) { return selector === '.agy-composer-footer' ? this.children.find(child => child.className === 'agy-composer-footer') : null; }
    querySelectorAll() { return []; }
    closest() { return null; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  }
  const body = new Element('body'), document = new Target(), window = new Target();
  document.body = body; document.hidden = false;
  document.createElement = tag => new Element(tag);
  function find(root, id) { return root.id === id ? root : root.children.map(child => find(child, id)).find(Boolean); }
  document.getElementById = id => find(body, id);
  document.querySelector = () => null;
  window.location = { pathname: id ? '/c/' + id : '/', search: '' };
  window.innerWidth = 1000; window.innerHeight = 800;
  const timers = new Map(), requests = [], observers = [];
  let nextTimer = 0;
  const context = vm.createContext({ document, window, URLSearchParams, metricsCss: '',
    setTimeout(fn, delay) { timers.set(++nextTimer, { fn, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe() {} disconnect() { this.disconnected = true; }
    },
    require() {
      if (unsupported) throw new Error('unsupported');
      return { ipcRenderer: { invoke(channel, id) {
        assert.equal(channel, 'agzh:metrics');
        return new Promise((resolve, reject) => requests.push({ id, resolve, reject }));
      } } };
    },
  });
  function composer() {
    const old = document.getElementById('antigravity.agentSidePanelInputBox'); if (old) old.remove();
    const box = body.appendChild(new Element()); box.id = 'antigravity.agentSidePanelInputBox';
    const row = box.appendChild(new Element()); row.className = 'agy-composer-footer';
    row.appendChild(new Element()).appendChild(new Element()); row.appendChild(new Element());
    return row;
  }
  let row = composer();
  vm.runInContext(source + '\ninitMetrics();', context);
  return { context, document, window, requests, timers, observers, get row() { return row; },
    composer() { row = composer(); return row; },
    get pill() { return document.getElementById('ag-live-metrics-pill'); },
    get tooltip() { return document.getElementById('ag-live-metrics-tooltip'); },
    route(id) { window.location.pathname = id ? '/c/' + id : '/'; observers[0].callback([{ target: body }]); },
    flush(delay) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); }
    },
  };
}
function metrics(id = A) {
  return { cascadeId: id, hasData: true, contextLimit: 256000,
    last: { idx: 0, inTok: 2000, outTok: 100, cacheRead: 1000, thinkTok: 40, respTok: 60, ttft: 0.5, stream: 2, ctx: 3000, tps: 50, e2eTps: 40 },
    total: { inTok: 2000, cacheRead: 1000, outTok: 100, thinkTok: 40, respTok: 60, calls: 1, userTurns: 1 },
    turn: { steps: 1, outTok: 100, thinkTok: 40, respTok: 60, duration: 2.5 } };
}

test('strict conversation UUIDs and query routes are normalized', () => {
  const h = harness('');
  assert.equal(h.context.metricsCascadeId({ pathname: '/c/' + A.toUpperCase(), search: '' }), A);
  assert.equal(h.context.metricsCascadeId({ pathname: '/', search: '?cascadeId=' + B }), B);
  for (const pathname of ['/c/' + '-'.repeat(36), '/c/' + A + '/other', '/c/not-a-uuid']) {
    assert.equal(h.context.metricsCascadeId({ pathname, search: '' }), '');
  }
});

test('home and empty data stay hidden, route responses never leak across conversations', async () => {
  const h = harness(''); await settle(); assert.equal(h.requests.length, 0);
  h.route(A); await settle(); assert.equal(h.requests.length, 1);
  h.route(B); h.flush(2500); await settle(); assert.equal(h.requests.length, 1);
  h.requests[0].resolve(metrics(A)); await settle();
  assert.equal(h.pill, undefined); assert.equal(h.requests[1].id, B);
  h.requests[1].resolve(metrics(B)); await settle(); assert.equal(h.pill.style.display, 'inline-flex');
  h.route(A); assert.equal(h.pill.style.display, 'none'); await settle();
  h.requests[2].resolve({ cascadeId: A, hasData: false }); await settle(); assert.equal(h.pill.style.display, 'none');
  h.route(''); assert.equal(h.pill.style.display, 'none');
});

test('capsule stays inline across composer replacement and toggles details on click without hover popups', async () => {
  const h = harness(); await settle(); h.requests[0].resolve(metrics()); await settle();
  assert.equal(h.row.getAttribute('data-ag-row-mode'), 'middle');
  assert.match(h.pill.textContent, /50 tok\/s/);
  assert.match(h.pill.textContent, /首字 0\.5 秒/);
  assert.match(h.pill.textContent, /输出 100/);
  assert.doesNotMatch(h.pill.textContent, /上下文|参考256k/);
  assert.match(h.tooltip.textContent, /上下文 \/ 参考容量/);
  assert.match(h.tooltip.textContent, /3,000 \/ 256,000/);
  assert.match(h.tooltip.textContent, /33\.3%/);
  h.pill.fire('mouseenter'); h.pill.fire('focus');
  assert.equal(h.tooltip.getAttribute('data-visible'), null);
  assert.equal(h.pill.getAttribute('aria-expanded'), 'false');
  h.pill.fire('click');
  assert.equal(h.tooltip.getAttribute('data-visible'), '1');
  assert.equal(h.pill.getAttribute('aria-expanded'), 'true');
  h.document.fire('pointerdown', { target: h.tooltip });
  assert.equal(h.tooltip.getAttribute('data-visible'), '1');
  h.document.fire('pointerdown', { target: h.document.body });
  assert.equal(h.tooltip.getAttribute('data-visible'), null);
  assert.equal(h.pill.getAttribute('aria-expanded'), 'false');
  h.pill.fire('keydown', { key: 'Enter', preventDefault() {} });
  assert.equal(h.tooltip.getAttribute('data-visible'), '1');
  h.window.fire('keydown', { key: 'Escape' }); assert.equal(h.tooltip.getAttribute('data-visible'), null);
  h.pill.fire('click'); assert.equal(h.tooltip.getAttribute('data-visible'), '1');
  h.document.fire('pointerdown', { target: h.pill });
  assert.equal(h.tooltip.getAttribute('data-visible'), '1');
  h.pill.fire('click'); assert.equal(h.tooltip.getAttribute('data-visible'), null);
  h.pill.fire('keydown', { key: ' ', preventDefault() {} });
  assert.equal(h.tooltip.getAttribute('data-visible'), '1');
  h.pill.fire('click'); assert.equal(h.tooltip.getAttribute('data-visible'), null);
  h.composer(); h.observers[0].callback([{ target: h.document.body }]); h.flush(80);
  assert.equal(h.row.getAttribute('data-ag-row-mode'), 'middle');
  assert.equal(h.pill.parentElement, h.row.children[0]);
  assert.equal(h.requests.length, 1);
});

test('hidden windows pause polls and unload disconnects resources', async () => {
  const h = harness(); await settle();
  h.document.hidden = true; h.document.fire('visibilitychange'); assert.equal(h.timers.size, 0);
  h.requests[0].resolve(metrics()); await settle(); assert.equal(h.pill, undefined);
  h.document.hidden = false; h.document.fire('visibilitychange'); await settle(); assert.equal(h.requests.length, 2);
  h.requests[1].resolve(metrics()); await settle();
  h.window.fire('unload'); assert.equal(h.timers.size, 0); assert.equal(h.observers[0].disconnected, true);
  assert.equal(h.document.events.get('pointerdown').length, 0);
  assert.equal(h.pill, undefined);
});

test('IPC and unsupported errors remain visible and error text is never parsed as HTML', async () => {
  const h = harness(); await settle(); h.requests[0].reject(new Error('<img src=x>')); await settle();
  assert.equal(h.pill.textContent, '指标暂不可用'); assert.match(h.tooltip.textContent, /<img src=x>/);
  assert.equal(h.tooltip.children[1].children.length, 0);
  const unsupported = harness(A, true);
  assert.equal(unsupported.pill.textContent, '指标暂不可用');
  assert.match(unsupported.tooltip.textContent, /不支持指标通信/);
});

test('handles null cascadeId safely and ignores own pill DOM mutations', async () => {
  const h = harness();
  await settle();
  h.requests[0].resolve({ cascadeId: null, hasData: false });
  await settle();
  assert.equal(h.pill.textContent, '指标暂不可用');
  assert.match(h.tooltip.textContent, /指标响应与当前会话不一致/);

  const beforeTimers = h.timers.size;
  h.observers[0].callback([{ target: h.row.children[0], addedNodes: [h.pill], removedNodes: [] }]);
  assert.equal(h.timers.size, beforeTimers);
});
