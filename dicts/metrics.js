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
    let currentId = '', revision = 0, payload = null, pending = false, stopped = false;
    let pollTimer, mountTimer, tooltipTimer, row = null, pill = null, tooltip = null, signature = '';
    let hovered = false, focused = false, dismissed = false;
    let ipc, ipcError;
    try {
      ipc = require('electron').ipcRenderer;
      if (!ipc || typeof ipc.invoke !== 'function') throw new Error('IPC 不可用');
    } catch (error) {
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
      if (tooltip) { tooltip.removeAttribute('data-visible'); tooltip.setAttribute('aria-hidden', 'true'); }
    }
    function leaveTooltip() {
      hovered = false;
      clearTimeout(tooltipTimer);
      tooltipTimer = setTimeout(() => { if (!hovered && !focused) hideTooltip(); }, 120);
    }
    function positionTooltip() {
      if (!tooltip || !pill || pill.style.display === 'none' || dismissed || !(hovered || focused)) return;
      tooltip.setAttribute('data-visible', '1');
      tooltip.setAttribute('aria-hidden', 'false');
      const rect = pill.getBoundingClientRect();
      const width = tooltip.offsetWidth, height = tooltip.offsetHeight;
      tooltip.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
      tooltip.style.top = Math.max(8, rect.top >= height + 8 ? rect.top - height - 8
        : Math.min(rect.bottom + 8, window.innerHeight - height - 8)) + 'px';
    }
    function clear() {
      clearTimeout(tooltipTimer);
      payload = null; signature = ''; hovered = false; focused = false; dismissed = false;
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
      const left = row.children[0], right = row.children[1];
      if (!left || !right) return;
      const children = Array.from(left.children).filter(child => child !== pill);
      const gap = parseFloat(getComputedStyle(left).columnGap) || 0;
      const leftWidth = children.reduce((width, child) => width + Math.max(child.offsetWidth, child.scrollWidth), 0)
        + Math.max(0, children.length - 1) * gap;
      const needed = Math.max(150, pill.firstElementChild.scrollWidth + 24);
      const mode = row.clientWidth - leftWidth - right.offsetWidth - 14 < needed ? 'bottom' : 'middle';
      if (row.getAttribute('data-ag-row-mode') !== mode) row.setAttribute('data-ag-row-mode', mode);
      if (pill.getAttribute('data-ag-row-mode') !== mode) pill.setAttribute('data-ag-row-mode', mode);
      if (mode === 'bottom') {
        if (pill.previousElementSibling !== row) row.after(pill);
      } else if (pill.parentElement !== left) left.appendChild(pill);
      positionTooltip();
    }
    const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleMount) : null;
    function mount() {
      clearTimeout(mountTimer);
      mountTimer = undefined;
      if (stopped || document.hidden || !currentId || !payload) return;
      const box = document.getElementById('antigravity.agentSidePanelInputBox') || document.querySelector('.surface-composer.bg-card-border');
      const nextRow = box && footer(box);
      if (!nextRow || nextRow.children.length < 2) { if (pill) pill.style.display = 'none'; hideTooltip(); return; }
      if (!pill) {
        pill = element('button'); pill.id = 'ag-live-metrics-pill'; pill.type = 'button';
        pill.setAttribute('aria-label', '查看实时指标详情');
        pill.setAttribute('aria-describedby', 'ag-live-metrics-tooltip');
        pill.setAttribute('translate', 'no');
        const text = element('span'); text.id = 'ag-live-metrics-text'; pill.appendChild(text);
        tooltip = element('div'); tooltip.id = 'ag-live-metrics-tooltip';
        tooltip.setAttribute('role', 'tooltip'); tooltip.setAttribute('translate', 'no');
        tooltip.setAttribute('aria-hidden', 'true'); document.body.appendChild(tooltip);
        const enterTooltip = () => { clearTimeout(tooltipTimer); hovered = true; dismissed = false; positionTooltip(); };
        pill.addEventListener('mouseenter', enterTooltip);
        pill.addEventListener('mouseleave', leaveTooltip);
        tooltip.addEventListener('mouseenter', enterTooltip);
        tooltip.addEventListener('mouseleave', leaveTooltip);
        pill.addEventListener('focus', () => { focused = true; dismissed = false; positionTooltip(); });
        pill.addEventListener('blur', () => { focused = false; if (!hovered) hideTooltip(); });
        pill.addEventListener('click', () => { dismissed = false; positionTooltip(); });
        pill.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); dismissed = false; positionTooltip(); }
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
          const percent = last.ctx / limit * 100;
          const parts = [number(last.tps, 1) + ' tok/s', '首字 ' + seconds(last.ttft),
            '上下文 ' + tokens(last.ctx) + '/参考' + tokens(limit) + ' (' + number(percent) + '%)',
            '输出 ' + tokens(last.outTok)];
          parts.forEach((value, index) => {
            if (index) text.appendChild(element('span', 'ag-sep', '·'));
            const warning = index === 2 ? (percent >= 90 ? 'ag-ctx-crit' : percent >= 75 ? 'ag-ctx-warn' : '') : '';
            text.appendChild(element('span', warning, value));
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
        if (!result || result.cascadeId.toLowerCase() !== id) throw new Error('指标响应与当前会话不一致');
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
      clearTimeout(pollTimer); clearTimeout(mountTimer); clearTimeout(tooltipTimer); mountTimer = undefined;
      if (document.hidden) { revision++; hideTooltip(); }
      else tick();
    }
    function onRoute() { checkRoute(); scheduleMount(); }
    function onScroll(event) { if (!tooltip || !tooltip.contains(event.target)) hideTooltip(); }
    function onKey(event) { if (event.key === 'Escape') { dismissed = true; hideTooltip(); } }
    const observer = new MutationObserver(mutations => {
      if (stopped || document.hidden) return;
      checkRoute();
      if (mutations.some(mutation => !mutation.target.closest ||
          !mutation.target.closest('#ag-live-metrics-pill, #ag-live-metrics-tooltip'))) scheduleMount();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', onRoute);
    window.addEventListener('hashchange', onRoute);
    window.addEventListener('resize', scheduleMount);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey);
    if (window.navigation) window.navigation.addEventListener('currententrychange', onRoute);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('unload', () => {
      stopped = true; revision++; clearTimeout(pollTimer); clearTimeout(mountTimer); clearTimeout(tooltipTimer);
      observer.disconnect(); if (resizeObserver) resizeObserver.disconnect();
      window.removeEventListener('popstate', onRoute);
      window.removeEventListener('hashchange', onRoute);
      window.removeEventListener('resize', scheduleMount);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('keydown', onKey);
      if (window.navigation) window.navigation.removeEventListener('currententrychange', onRoute);
      document.removeEventListener('visibilitychange', onVisibility);
      if (pill) pill.remove(); if (tooltip) tooltip.remove();
      style.remove();
      if (row) row.removeAttribute('data-ag-row-mode');
    }, { once: true });
    tick();
  }
