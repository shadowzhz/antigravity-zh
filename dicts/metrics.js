  function metricsCascadeId(location) {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const match = location.pathname.match(/\/c\/([^/]+)\/?$/i);
    const id = match ? match[1] : new URLSearchParams(location.search).get('cascadeId');
    return id && uuid.test(id) ? id.toLowerCase() : '';
  }

  function initMetrics() {
    const style = document.createElement('style');
    style.id = 'agzh-metrics-style';
    style.textContent = metricsCss;
    (document.head || document.documentElement || document.body).appendChild(style);
    let currentId = '', revision = 0, payload = null, renderedPayload = null, pending = false, stopped = false;
    let pollTimer, mountTimer, row = null, pill = null, tooltip = null, signature = '';
    let open = false;
    let ipc, ipcError;
    try {
      ipc = require('electron').ipcRenderer;
      if (!ipc || typeof ipc.invoke !== 'function') throw new Error('IPC 不可用');
    } catch {
      ipcError = '当前运行环境不支持指标通信，请使用 --metrics 重新安装并重启应用。';
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }
    function number(value, digits = 0) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value.toLocaleString('zh-CN', { maximumFractionDigits: digits }) : '—';
    }
    function seconds(value) { return number(value, 2) + ' 秒'; }
    function tokens(value) { return value >= 1000 ? number(value / 1000, 1) + 'k' : number(value); }
    function hideTooltip() {
      open = false;
      if (pill) pill.setAttribute('aria-expanded', 'false');
      if (tooltip) { tooltip.removeAttribute('data-visible'); tooltip.setAttribute('aria-hidden', 'true'); }
    }
    function positionTooltip() {
      if (!tooltip || !pill || pill.style.display === 'none' || !open) return;
      pill.setAttribute('aria-expanded', 'true');
      tooltip.setAttribute('data-visible', '1');
      tooltip.setAttribute('aria-hidden', 'false');
      const rect = pill.getBoundingClientRect();
      const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
      tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
      tooltip.style.top = Math.max(8, rect.top >= height + 8 ? rect.top - height - 8
        : Math.min(rect.bottom + 8, window.innerHeight - height - 8)) + 'px';
    }
    function toggleTooltip() {
      if (open) hideTooltip();
      else { open = true; positionTooltip(); }
    }
    function clear() {
      payload = null; renderedPayload = null; signature = '';
      if (pill) pill.style.display = 'none';
      hideTooltip();
    }
    function footer(box) {
      const direct = box.querySelector('.agy-composer-footer');
      if (direct && direct.children.length >= 2) return direct;
      const rows = box.querySelectorAll('div.flex.w-full.items-center.justify-between');
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].getAttribute('data-testid') !== 'input-box-bottom-toolbar' &&
            rows[i].querySelector('[data-testid="model-selector-trigger"], [data-testid="send-button"]')) return rows[i];
      }
      return null;
    }
    function layout() {
      if (!row || !row.isConnected || !pill || !payload) return;
      const left = row.children[0];
      if (!left) return;
      if (row.getAttribute('data-ag-row-mode') !== 'middle') row.setAttribute('data-ag-row-mode', 'middle');
      if (pill.getAttribute('data-ag-row-mode') !== 'middle') pill.setAttribute('data-ag-row-mode', 'middle');
      if (pill.parentElement !== left) left.appendChild(pill);
      positionTooltip();
    }
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleMount) : null;
    function mount() {
      clearTimeout(mountTimer);
      mountTimer = undefined;
      if (stopped || document.hidden || !currentId || !payload) return;
      const box = document.getElementById('antigravity.agentSidePanelInputBox') || document.querySelector('.surface-composer.bg-card-border');
      const nextRow = box && footer(box);
      if (!nextRow || nextRow.children.length < 2) {
        if (row) { row.removeAttribute('data-ag-row-mode'); row = null; }
        if (resizeObserver) resizeObserver.disconnect();
        if (pill) pill.style.display = 'none';
        hideTooltip();
        return;
      }
      if (!pill) {
        pill = element('button'); pill.id = 'ag-live-metrics-pill'; pill.type = 'button';
        pill.setAttribute('aria-label', '切换实时指标详情');
        pill.setAttribute('aria-expanded', 'false');
        pill.setAttribute('aria-controls', 'ag-live-metrics-tooltip');
        pill.setAttribute('translate', 'no');
        const text = element('span'); text.id = 'ag-live-metrics-text'; pill.appendChild(text);
        tooltip = element('div'); tooltip.id = 'ag-live-metrics-tooltip';
        tooltip.setAttribute('role', 'tooltip'); tooltip.setAttribute('translate', 'no');
        tooltip.setAttribute('aria-hidden', 'true'); document.body.appendChild(tooltip);
        pill.addEventListener('click', toggleTooltip);
        pill.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleTooltip(); }
        });
      }
      if (!tooltip.isConnected) document.body.appendChild(tooltip);
      if (row !== nextRow) {
        if (row) row.removeAttribute('data-ag-row-mode');
        if (resizeObserver) resizeObserver.disconnect();
        row = nextRow;
        if (resizeObserver) { resizeObserver.observe(row); resizeObserver.observe(row.children[0]); resizeObserver.observe(row.children[1]); }
      }
      render();
      layout();
    }
    function scheduleMount() {
      if (!mountTimer && !stopped && !document.hidden) mountTimer = setTimeout(mount, 80);
    }
    function detailRow(parent, label, value) {
      const line = element('div', 'ag-tt-row');
      line.appendChild(element('span', 'ag-tt-lbl', label));
      line.appendChild(element('span', 'ag-tt-val', value)); parent.appendChild(line);
    }
    function render() {
      if (!pill || !payload) return;
      if (payload !== renderedPayload) {
        renderedPayload = payload;
        const nextSignature = JSON.stringify(payload);
        if (signature !== nextSignature) {
          signature = nextSignature;
          const text = pill.firstElementChild;
          text.replaceChildren(); tooltip.replaceChildren();
          if (payload.error) {
            text.textContent = '指标暂不可用';
            tooltip.appendChild(element('div', 'ag-tt-hdr', '指标读取失败'));
            tooltip.appendChild(element('div', '', payload.error));
          } else {
            const last = payload.last, total = payload.total, turn = payload.turn;
            const limit = payload.contextLimit;
            const parts = [number(last.tps, 1) + ' tok/s', '首字 ' + seconds(last.ttft), '输出 ' + tokens(last.outTok)];
            parts.forEach((value, index) => {
              if (index) text.appendChild(element('span', 'ag-sep', '·'));
              text.appendChild(element('span', '', value));
            });
            tooltip.appendChild(element('div', 'ag-tt-hdr', '最新已记录调用 · 记录 ' + number(last.idx + 1)));
            detailRow(tooltip, '生成速度 / 端到端', number(last.tps, 1) + ' / ' + number(last.e2eTps, 1) + ' tok/s');
            detailRow(tooltip, '首字延迟 / 流式时长', seconds(last.ttft) + ' / ' + seconds(last.stream));
            detailRow(tooltip, '输入 / 缓存读取', number(last.inTok) + ' / ' + number(last.cacheRead));
            detailRow(tooltip, '输出 / 思考 / 正文', [last.outTok, last.thinkTok, last.respTok].map(value => number(value)).join(' / '));
            detailRow(tooltip, '上下文 / 参考容量', number(last.ctx) + ' / ' + number(limit));
            tooltip.appendChild(element('div', '', '256k 仅为参考容量，不代表当前模型上限或压缩阈值。'));
            tooltip.appendChild(element('div', 'ag-tt-hdr ag-tt-sec', '本轮统计（按已记录调用）'));
            detailRow(tooltip, '调用数 / 时长', number(turn.steps) + ' / ' + seconds(turn.duration));
            detailRow(tooltip, '输出 / 思考 / 正文', [turn.outTok, turn.thinkTok, turn.respTok].map(value => number(value)).join(' / '));
            tooltip.appendChild(element('div', 'ag-tt-hdr ag-tt-sec', '会话累计'));
            detailRow(tooltip, '调用 / 用户提问', number(total.calls) + ' / ' + number(total.userTurns));
            detailRow(tooltip, '输入 / 缓存读取', number(total.inTok) + ' / ' + number(total.cacheRead));
            const input = total.inTok + total.cacheRead;
            const cacheRate = input > 0 ? number(total.cacheRead / input * 100, 1) + '%' : '—';
            detailRow(tooltip, '缓存读取占输入', cacheRate);
            detailRow(tooltip, '输出 / 思考 / 正文', [total.outTok, total.thinkTok, total.respTok].map(value => number(value)).join(' / '));
          }
        }
      }
      pill.style.display = 'inline-flex';
    }
    function armPoll() {
      clearTimeout(pollTimer);
      if (!stopped && !document.hidden) pollTimer = setTimeout(tick, 2500);
    }
    function refresh() {
      if (pending || stopped || document.hidden || !currentId) return;
      if (ipcError) { payload = { cascadeId: currentId, error: ipcError }; mount(); return; }
      const id = currentId, requestRevision = revision;
      pending = true;
      Promise.resolve().then(() => ipc.invoke('agzh:metrics', id)).then(result => {
        if (stopped || document.hidden || requestRevision !== revision || metricsCascadeId(window.location) !== id) return;
        if (!result || typeof result.cascadeId !== 'string' || result.cascadeId.toLowerCase() !== id) {
          throw new Error('指标响应与当前会话不一致');
        }
        if (result.error) payload = { cascadeId: id, error: '无法读取会话指标：' + result.error };
        else if (result.hasData) payload = result;
        else { clear(); return; }
        mount();
      }).catch(error => {
        if (stopped || document.hidden || requestRevision !== revision || metricsCascadeId(window.location) !== id) return;
        payload = { cascadeId: id, error: '指标通信失败，请使用 --metrics 重新安装并重启应用。详情：' + error.message };
        mount();
      }).finally(() => {
        pending = false;
        if (requestRevision !== revision) refresh();
      });
    }
    function checkRoute() {
      const id = metricsCascadeId(window.location);
      if (id === currentId) return false;
      currentId = id; revision++; clear();
      if (!document.hidden) refresh();
      return true;
    }
    function tick() {
      if (stopped || document.hidden) return;
      if (!checkRoute()) refresh();
      scheduleMount(); armPoll();
    }
    function onVisibility() {
      clearTimeout(pollTimer); clearTimeout(mountTimer); mountTimer = undefined;
      if (document.hidden) { revision++; hideTooltip(); }
      else tick();
    }
    function onRoute() { checkRoute(); scheduleMount(); }
    function onScroll(event) { if (!tooltip || !tooltip.contains(event.target)) hideTooltip(); }
    function onKey(event) { if (event.key === 'Escape') hideTooltip(); }
    function onPointerDown(event) {
      if (!open || !pill || !tooltip) return;
      if (!pill.contains(event.target) && !tooltip.contains(event.target)) hideTooltip();
    }
    function isOwnMutation(mutation) {
      if (mutation.target && mutation.target.closest &&
          mutation.target.closest('#ag-live-metrics-pill, #ag-live-metrics-tooltip')) return true;
      const added = mutation.addedNodes;
      const removed = mutation.removedNodes;
      const addedLen = added ? added.length : 0;
      const removedLen = removed ? removed.length : 0;
      if (addedLen + removedLen === 0) return false;
      for (let i = 0; i < addedLen; i++) {
        if (added[i] !== pill && added[i] !== tooltip) return false;
      }
      for (let i = 0; i < removedLen; i++) {
        if (removed[i] !== pill && removed[i] !== tooltip) return false;
      }
      return true;
    }
    const observer = new MutationObserver(mutations => {
      if (stopped || document.hidden) return;
      checkRoute();
      if (mutations.some(mutation => !isOwnMutation(mutation))) scheduleMount();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', onRoute);
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('resize', scheduleMount);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    if (window.navigation) window.navigation.addEventListener('currententrychange', onRoute);
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('unload', () => {
      stopped = true; revision++; clearTimeout(pollTimer); clearTimeout(mountTimer);
      observer.disconnect(); if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('popstate', onRoute);
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('resize', scheduleMount);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
      if (window.navigation) window.navigation.removeEventListener('currententrychange', onRoute);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onPointerDown, true);
      if (pill) pill.remove(); if (tooltip) tooltip.remove();
      style.remove();
      if (row) row.removeAttribute('data-ag-row-mode');
    }, { once: true });
    tick();
  }
