const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, '../dicts/zh_cn.json'), 'utf8'));
const injection = execFileSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
  ['-c', 'import install; print(install.build_injection(install.load_dictionary()))'],
  { cwd: path.join(__dirname, '..'), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
const source = injection.replace(/\}\)\(\);\s*$/, `
  globalThis.api = { translateString, translateNode, loadExternalDict, startObserver,
    get dictionary() { return dictionary; } };
})();`);

function harness(initial = null, sandboxed = false, prefix = '') {
  let external = initial;
  let watchCallback;
  let watchedPath;
  let closed = false;
  const observers = [];
  const timers = new Map();
  const events = new Map();
  let nextTimer = 0;
  class Element {
    constructor(tag = 'DIV', attrs = {}) {
      this.nodeType = 1; this.tagName = tag; this.attrs = { ...attrs };
      this.childNodes = []; this.parentElement = null; this.className = '';
      this.classList = { contains: key => this.className.split(/\s+/).includes(key) };
    }
    getAttribute(key) { return Object.hasOwn(this.attrs, key) ? this.attrs[key] : null; }
    setAttribute(key, value) { this.attrs[key] = value; }
    append(child) { child.parentElement = this; this.childNodes.push(child); return child; }
    getRootNode() { return this.parentElement ? this.parentElement.getRootNode() : this; }
    attachShadow() {
      const root = new Element(); root.nodeType = 11; root.host = this;
      this.shadowRoot = root;
      return root;
    }
  }
  const body = new Element('BODY');
  const document = { body, readyState: 'complete', addEventListener() {} };
  const mockFs = {
    existsSync: file => !file.endsWith('zh-CN.json') || external !== null,
    readFileSync: () => typeof external === 'string' ? external : JSON.stringify(external),
    watch: (directory, options, callback) => {
      watchedPath = directory; watchCallback = callback;
      return { on() {}, close() { closed = true; } };
    },
  };
  const context = vm.createContext({
    document, Element, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1, DOCUMENT_FRAGMENT_NODE: 11 },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(root) { this.root = root; }
    },
    console: { warn() {}, error(...args) { throw new Error(args.map(String).join(' ')); } },
    window: { addEventListener: (name, callback) => events.set(name, callback) },
    setTimeout: callback => { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimeout: id => timers.delete(id),
    require: name => {
      if (sandboxed) throw new Error('preload fs unavailable');
      if (name === 'fs') return mockFs;
      if (name === 'os') return { homedir: () => '/audit-home' };
      return require(name);
    },
  });
  vm.runInContext(prefix + '\n\n' + source, context);
  return {
    ...context.api, body, Element, observers, timers, original: context.original,
    text(value, parent = body) { return parent.append({ nodeType: 3, nodeValue: value, getRootNode() { return this.parentElement.getRootNode(); } }); },
    setExternal(value) { external = value; context.api.loadExternalDict(); },
    fileEvent(value, kind = 'change') { external = value; watchCallback(kind, 'zh-CN.json'); },
    flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); },
    unload() { events.get('unload')(); },
    get watchedPath() { return watchedPath; },
    get closed() { return closed; },
  };
}

test('generated injection compiles and uses calibrated JSON when fs is unavailable', () => {
  const h = harness(null, true);
  for (const key of ['Account', 'Actuation Permissions', 'Settings']) {
    assert.equal(h.translateString(key), bundle[key]);
  }
  assert.equal(h.translateString('toString'), 'toString');
  assert.equal(h.translateString('hasOwnProperty'), 'hasOwnProperty');
});

test('injection is isolated from semicolon-free preload expressions', () => {
  for (const prefix of ['globalThis.original = 1', 'globalThis.original = (() => 1)()']) {
    const h = harness(null, true, prefix);
    assert.equal(h.original, 1);
    assert.equal(h.translateString('Settings'), bundle.Settings);
  }
});

test('thinking triggers translate on full traversal and reload while prose stays original', () => {
  const h = harness();
  const container = h.body.append(new h.Element('DIV', { 'data-testid': 'thinking-collapsible', title: 'Settings' }));
  const wrapper = container.append(new h.Element());
  const prose = h.text('Settings', wrapper);
  const labels = [];
  for (const id of ['thinking-collapsible-trigger', 'worked-for-collapsible', 'tool-group-collapsible']) {
    const trigger = wrapper.append(new h.Element('BUTTON', { 'data-testid': id, title: 'Settings' }));
    const label = h.text('Thinking for 3s', trigger.append(new h.Element('SPAN')));
    labels.push({ trigger, label });
  }
  h.translateNode(h.body);
  for (const { trigger, label } of labels) {
    assert.equal(label.nodeValue, '已思考 3 秒');
    assert.equal(trigger.getAttribute('title'), bundle.Settings);
  }
  h.setExternal({ 'Thinking for 3s': '新的状态', Settings: '新的设置' });
  for (const { trigger, label } of labels) {
    assert.equal(label.nodeValue, '新的状态');
    assert.equal(trigger.getAttribute('title'), '新的设置');
  }
  assert.equal(prose.nodeValue, 'Settings');
  assert.equal(container.getAttribute('title'), 'Settings');
  h.setExternal({});
  for (const { label } of labels) assert.equal(label.nodeValue, '已思考 3 秒');
  const added = wrapper.append(new h.Element('BUTTON', { 'data-testid': 'thinking-collapsible-trigger' }));
  const addedText = h.text('Thinking for 3s', added);
  h.observers.find(o => o.root === h.body).callback([{ type: 'childList', addedNodes: [wrapper] }]);
  assert.equal(addedText.nodeValue, '已思考 3 秒');
  assert.equal(prose.nodeValue, 'Settings');
});

test('thinking traversal exceptions never bypass code, editable, or reply protection', () => {
  for (const [tag, attrs] of [['CODE', {}], ['DIV', {contenteditable: 'true'}],
      ['DIV', {'data-testid': 'planner-response-text'}]]) {
    const h = harness();
    const container = h.body.append(new h.Element('DIV', {'data-testid': 'thinking-collapsible'}));
    const protectedNode = container.append(new h.Element(tag, attrs));
    const trigger = protectedNode.append(new h.Element('SPAN', {'data-testid': 'thinking-collapsible-trigger'}));
    const label = h.text('Thinking for 3s', trigger);
    h.translateNode(h.body);
    h.translateNode(label);
    h.setExternal({'Thinking for 3s': '不应写入'});
    assert.equal(label.nodeValue, 'Thinking for 3s');
  }
});

test('hot reload updates existing text and translated attributes', () => {
  const h = harness();
  const label = h.text('Settings');
  const button = h.body.append(new h.Element('BUTTON', { title: 'Settings' }));
  h.translateNode(h.body);
  assert.equal(label.nodeValue, bundle.Settings);
  h.setExternal({ Settings: '新的设置' });
  assert.equal(label.nodeValue, '新的设置');
  assert.equal(button.getAttribute('title'), '新的设置');
});

test('deleting override restores bundled translation and unknown original', () => {
  const h = harness({ Settings: '定制设置', 'Audit Unique Label': '专用标签' });
  const known = h.text('Settings');
  const unknown = h.text('Audit Unique Label');
  h.translateNode(h.body);
  h.setExternal({});
  assert.equal(known.nodeValue, bundle.Settings);
  assert.equal(unknown.nodeValue, 'Audit Unique Label');
  assert.equal(h.translateString('Audit Unique Label'), 'Audit Unique Label');
});

test('deleting external file resets overrides', () => {
  const h = harness({ Settings: '定制设置' });
  const label = h.text('Settings'); h.translateNode(h.body);
  h.setExternal(null);
  assert.equal(label.nodeValue, bundle.Settings);
});

test('invalid JSON and invalid values keep last valid snapshot', () => {
  const h = harness({ Settings: '有效设置' });
  for (const invalid of ['{', { Settings: 4 }, [], null, { translations: [] }]) {
    if (invalid === null) continue; // A missing file intentionally clears overrides.
    h.setExternal(invalid);
    assert.equal(h.translateString('Settings'), '有效设置');
  }
});

test('wrapper format and replacement metacharacters are literal', () => {
  const h = harness({ translations: { Settings: '$& $$ $1' } });
  assert.equal(h.translateString(' Settings '), ' $& $$ $1 ');
});

test('application text changes become the new source rather than resurrecting old text', () => {
  const h = harness(); const label = h.text('Settings'); h.translateNode(label);
  label.nodeValue = 'Account'; h.translateNode(label);
  h.setExternal({ Settings: '其他设置', Account: '新账户' });
  assert.equal(label.nodeValue, '新账户');
});

test('all editable forms and inherited descendants are protected', () => {
  for (const value of ['', 'true', 'TRUE', 'plaintext-only']) {
    const h = harness(); const editable = h.body.append(new h.Element('DIV', { contenteditable: value }));
    const child = editable.append(new h.Element('SPAN')); const label = h.text('Settings', child);
    h.translateNode(h.body); assert.equal(label.nodeValue, 'Settings');
    h.setExternal({ Settings: '不应写入' }); assert.equal(label.nodeValue, 'Settings');
  }
});

test('business value attributes remain untouched while UI attributes translate', () => {
  const h = harness();
  for (const tag of ['OPTION', 'BUTTON', 'INPUT', 'TEXTAREA']) {
    const el = h.body.append(new h.Element(tag, { value: 'Settings', title: 'Settings' }));
    h.translateNode(el);
    assert.equal(el.getAttribute('value'), 'Settings');
    assert.equal(el.getAttribute('title'), bundle.Settings);
  }
});

test('code ancestor overrides a thinking trigger exception', () => {
  const h = harness(); const pre = h.body.append(new h.Element('PRE'));
  const trigger = pre.append(new h.Element('SPAN', { 'data-testid': 'thinking-collapsible-trigger' }));
  const label = h.text('Settings', trigger);
  h.translateNode(label); assert.equal(label.nodeValue, 'Settings');
});

test('empty data markers also protect user content', () => {
  const h = harness();
  for (const key of ['data-code', 'data-project-name', 'data-turn-content', 'data-mention-menu']) {
    const el = h.body.append(new h.Element('DIV', { [key]: '' }));
    const label = h.text('Settings', el);
    h.translateNode(label); assert.equal(label.nodeValue, 'Settings');
  }
});

test('shadow roots are translated on reload and obey host code protection', () => {
  const h = harness(); const host = h.body.append(new h.Element()); const shadow = host.attachShadow();
  const label = h.text('Settings', shadow); h.translateNode(h.body);
  h.setExternal({ Settings: '影子设置' }); assert.equal(label.nodeValue, '影子设置');
  const code = h.body.append(new h.Element('CODE')); const protectedRoot = code.attachShadow();
  const protectedLabel = h.text('Settings', protectedRoot);
  h.translateNode(protectedLabel); assert.equal(protectedLabel.nodeValue, 'Settings');
});

test('directory watch coalesces events and survives rename notifications', () => {
  const h = harness(); const label = h.text('Settings'); h.translateNode(label);
  assert.equal(path.basename(h.watchedPath), '.antigravity-zh');
  h.fileEvent({ Settings: '旧事件' }); h.fileEvent({ Settings: '新事件' }, 'rename');
  assert.equal(h.timers.size, 1); h.flush(); assert.equal(label.nodeValue, '新事件');
  h.fileEvent({ Settings: '再次保存' }, 'rename'); h.flush(); assert.equal(label.nodeValue, '再次保存');
  h.unload(); assert.equal(h.closed, true);
});

test('observer self notifications are idempotent and roots are not observed twice', () => {
  const h = harness(); const label = h.text('Settings');
  const observer = h.observers.find(o => o.root === h.body);
  const records = [{ type: 'characterData', target: label }];
  observer.callback(records); observer.callback(records);
  assert.equal(label.nodeValue, bundle.Settings);
  h.startObserver(); h.startObserver();
  assert.equal(h.observers.filter(o => o.root === h.body).length, 1);
});

test('dynamic parameters and lowercase identifiers preserve intended behavior', () => {
  const h = harness();
  assert.equal(h.translateString('project'), 'project');
  assert.match(h.translateString('Worked for 1m 2s'), /1.*2/);
  assert.equal(h.translateString('scheduled tasks run as AuditModel'), '所有计划任务均以 AuditModel 模型运行。');
  assert.ok(h.translateString("Yes, allow 'echo $HOME' this time").includes('echo $HOME'));
});
