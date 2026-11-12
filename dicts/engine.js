// AGZH ENGINE START
;(function() {
  __DICT_ITEMS__
  const metricsEnabled = __METRICS_ENABLED__;
  __METRICS_RUNTIME__

  // The JSON bundle is the only built-in dictionary. User overrides are a
  // replaceable snapshot; removing a key restores its bundled value.
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const baseDictionary = Object.freeze(Object.assign(Object.create(null), bundledDictionary));
  let dictionary, userOverrides, lowerIndex, longTextRegex, shortTextRegex;
  function rebuildDict(overrides) {
    const nextUser = Object.assign(Object.create(null), overrides);
    const next = Object.assign(Object.create(null), baseDictionary, nextUser);
    const index = Object.create(null);
    // Index user overrides before bundled entries so case-insensitive lookups prefer user values.
    for (const key of Object.keys(nextUser)) {
      if (!(key.toLowerCase() in index)) index[key.toLowerCase()] = key;
    }
    for (const key of Object.keys(baseDictionary)) {
      if (!(key.toLowerCase() in index)) index[key.toLowerCase()] = key;
    }
    const keys = Object.keys(next).sort((a, b) => b.length - a.length);
    const longRegex = compileDictionaryRegex(keys.filter(key => key.length >= 4));
    const shortRegex = compileDictionaryRegex(keys.filter(key => key.length > 3 || /^[a-zA-Z0-9]+$/.test(key)));
    // Publish only after the complete snapshot has validated and compiled.
    dictionary = next;
    userOverrides = nextUser;
    lowerIndex = index;
    longTextRegex = longRegex;
    shortTextRegex = shortRegex;
  }

  let lastExternalContents = null;
  function loadExternalDict() {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(require('os').homedir(), '.antigravity-zh', 'zh-CN.json');
      const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '{}';
      if (raw === lastExternalContents) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('词典必须是 JSON 对象');
      const items = Object.prototype.hasOwnProperty.call(parsed, 'translations') ? parsed.translations : parsed;
      if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('translations 必须是对象');
      const overrides = Object.create(null);
      for (const [key, value] of Object.entries(items)) {
        if (key.startsWith('__')) continue;
        if (!key.trim() || typeof value !== 'string') throw new Error('词条必须使用非空键和字符串译文');
        overrides[key] = value;
      }
      rebuildDict(overrides);
      lastExternalContents = raw;
      if (document.body) translateNode(document.body);
    } catch (error) {
      // A partial save or unavailable preload fs keeps the last valid snapshot.
      console.warn('[Antigravity-ZH] 外部词典未更新:', error.message);
    }
  }

  function watchExternalDict() {
    try {
      const fs = require('fs');
      const path = require('path');
      const directory = path.join(require('os').homedir(), '.antigravity-zh');
      if (!fs.existsSync(directory)) return;
      let timer;
      // Watch the directory, so rename-based editor saves do not detach us
      // from the current file. Coalesce bursts into one reload.
      const watcher = fs.watch(directory, { persistent: false }, (event, filename) => {
        if (filename != null && String(filename) !== 'zh-CN.json') return;
        clearTimeout(timer);
        timer = setTimeout(loadExternalDict, 200);
      });
      watcher.on('error', error => console.warn('[Antigravity-ZH] 词典监听失败:', error.message));
      window.addEventListener('unload', () => {
        clearTimeout(timer);
        watcher.close();
      }, { once: true });
    } catch (error) {
      console.warn('[Antigravity-ZH] 无法监听外部词典:', error.message);
    }
  }

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Compile dictionary alternatives once per dictionary update, not for every text node.
  function compileDictionaryRegex(keys) {
    if (!keys.length) return null;
    const alternatives = keys.map((key) => {
      const startBoundary = /^[a-zA-Z0-9]/.test(key) ? '(?<![A-Za-z0-9-])' : '';
      const endBoundary = /[a-zA-Z0-9]$/.test(key) ? '(?![A-Za-z0-9-])' : '';
      return startBoundary + escapeRegExp(key) + endBoundary;
    });
    return new RegExp(alternatives.join('|'), 'gi');
  }

  // 时长格式化：1d2h3m4.5s / 1d 2h 3m -> 1 天 2 小时 3 分 4.5 秒
  const fmtDuration = function (d) {
    return d
      .replace(/(\d+(?:\.\d+)?)\s*d/gi, '$1 天')
      .replace(/(\d+(?:\.\d+)?)\s*h/gi, '$1 小时')
      .replace(/(\d+(?:\.\d+)?)\s*m/gi, '$1 分')
      .replace(/(\d+(?:\.\d+)?)\s*s/gi, '$1 秒')
      .replace(/(天|小时|分|秒)\s*(?=\d)/g, '$1 ');
  };
  const MONTH_CN = { jan: '1月', feb: '2月', mar: '3月', apr: '4月', may: '5月', jun: '6月', jul: '7月', aug: '8月', sep: '9月', oct: '10月', nov: '11月', dec: '12月' };
  const meridiem = function (ap) { return ap.toUpperCase() === 'PM' ? '下午' : '上午'; };
  // 动态正则规则（参考社区汉化项目沉淀，整串锚定匹配；在词典精确匹配之后执行）
  const dynamicRules = [
    [/^(\d+)\s*(?:seconds?|secs?)\s+ago$/i, '$1 秒前'],
    [/^(\d+)\s*(?:minutes?|mins?)\s+ago$/i, '$1 分钟前'],
    [/^(\d+)\s*(?:hours?|hrs?)\s+ago$/i, '$1 小时前'],
    [/^(\d+)\s*days?\s+ago$/i, '$1 天前'],
    [/^(\d+)\s*weeks?\s+ago$/i, '$1 周前'],
    [/^(\d+)\s*months?\s+ago$/i, '$1 个月前'],
    [/^(\d+)\s*years?\s+ago$/i, '$1 年前'],
    [/^(\d+)[sS]\s+ago$/, '$1 秒前'],
    [/^(\d+)[mM]\s+ago$/, '$1 分钟前'],
    [/^(\d+)[hH]\s+ago$/, '$1 小时前'],
    [/^(\d+)[dD]\s+ago$/, '$1 天前'],
    [/^\((\d+)\s+subagents?\)$/i, '($1 个子智能体)'],
    [/^(\d+)\s+subagents?$/i, '$1 个子智能体'],
    [/^(\d+)\s+active\s+subagents?$/i, '$1 个运行中的子智能体'],
    [/^(\d+)\s+tasks?\s+running$/i, '$1 个运行中的任务'],
    [/^(\d+)\s+agents?\s+running$/i, '$1 个运行中的智能体'],
    [/^(\d+)\s+active\s+conversations?$/i, '$1 个活跃对话'],
    [/^(\d+)\s+archived\s+conversations?$/i, '$1 个已归档对话'],
    [/^See all\s*\((\d+)\)$/i, '查看全部 ($1)'],
    [/^See all\s+(\d+)$/i, '查看全部 $1 项'],
    [/^Step (\d+) of (\d+)$/i, '第 $1 步（共 $2 步）'],
    [/^Task (\d+) running$/i, '正在运行任务 $1'],
    [/^Created (\d+) files?$/i, '已创建 $1 个文件'],
    [/^Modified (\d+) files?$/i, '已修改 $1 个文件'],
    [/^Ran (\d+) commands?$/i, '已运行 $1 个命令'],
    [/^Thinking for (\d+)s$/i, '已思考 $1 秒'],
    [/^Stopped after (\d+) steps?$/i, '已在 $1 步后停止'],
    [/^You have used some of your weekly limit,?\s*it will fully refresh in (.*?)\.?$/i, '您已消耗了部分每周额度，将在 $1 后完全重置刷新。'],
    [/^You have used some of your 5-?hour limit,?\s*it will fully refresh in (.*?)\.?$/i, '您已消耗了部分 5 小时额度，将在 $1 后完全重置刷新。'],
    [/^You have hit your 5-?hour limit,?\s*it will refresh in (.*?)\.?$/i, '您已达到 5 小时上限，将在 $1 后重置刷新。'],
    [/^You have hit your weekly limit,?\s*it will refresh in (.*?)\.?$/i, '您已达到每周上限，将在 $1 后重置刷新。'],
    [/^Your quota for this model is running low\.?$/i, '您在此模型上的剩余配额即将耗尽。'],
    [/^Your quota for this model has run out\.?$/i, '您在此模型上的配额已耗尽。'],
    [/^Your plan's baseline quota will refresh on (.+?)\.?\s*You can upgrade to a Google AI Ultra plan to receive higher rate limits\.?$/i, '您的套餐基础配额将于 $1 重置刷新。您可以升级至 Google AI Ultra 以获取更高的请求配额与速率上限。'],
    [/^Your plan's baseline quota will refresh on (.+?)\.?\s*To continue using this model now,?\s*enable AI Credit overages\.?$/i, '您的套餐基础配额将于 $1 重置刷新。若要立即继续使用此模型，请启用 AI 额度超量使用。'],
    [/^Your plan's baseline quota will refresh on ([^.。]+)\.?$/i, '您的套餐基础配额将于 $1 重置刷新。'],
    [/^(?:Model|Your) quota will refresh on ([^.。]+)\.?$/i, '您的模型配额将于 $1 重置刷新。'],
    [/^You need at least (\d+) AI Credits to send messages\.?$/i, '您至少需要 $1 个 AI 额度才能发送消息。'],
    [/^To continue using this model now,?\s*purchase more AI Credits\.?$/i, '若要立即继续使用此模型，请购买更多 AI 额度。'],
    [/^To continue using this model now,?\s*enable AI Credit overages\.?$/i, '若要立即继续使用此模型，请启用 AI 额度超量使用。'],
    [/^To continue using (.+?) now,?\s*purchase more AI Credits\.?$/i, '若要立即继续使用 $1，请购买更多 AI 额度。'],
    [/^To continue using (.+?) now,?\s*enable AI Credit overages\.?$/i, '若要立即继续使用 $1，请启用 AI 额度超量使用。'],
    [/^Available AI Credits:\s*(.+)$/i, '可用 AI 额度：$1'],
    [/^([\d,]+)\s*\/\s*([\d,]+)\s*tokens?\s*\(([\d.]+%)\)$/i, '$1 / $2 个 Token ($3)'],
    [/^\(([\d,]+)\s*tokens?\)\s*([\d.]+%)$/i, '($1 个 Token) $2'],
    [/^\(([\d,]+)\s*tokens?\)$/i, '($1 个 Token)'],
    [/^[Rr]esets? in (\d+)\s*(?:d|days?)[,\s]+(\d+)\s*(?:h|hours?)[,\s]+(\d+)\s*(?:m|mins?|minutes?)\.?$/, '$1 天 $2 小时 $3 分钟后重置'],
    [/^[Rr]esets? in (\d+)\s*(?:d|days?)[,\s]+(\d+)\s*(?:h|hours?)\.?$/, '$1 天 $2 小时后重置'],
    [/^[Rr]esets? in (\d+)\s*(?:h|hours?)[,\s]+(\d+)\s*(?:m|mins?|minutes?)\.?$/, '$1 小时 $2 分钟后重置'],
    [/^[Rr]esets? in (\d+)\s*(?:m|mins?|minutes?)[,\s]+(\d+)\s*(?:s|secs?|seconds?)\.?$/, '$1 分 $2 秒后重置'],
    [/^[Rr]esets? in (\d+)\s*(?:d|days?)\.?$/, '$1 天后重置'],
    [/^[Rr]esets? in (\d+)\s*(?:h|hours?)\.?$/, '$1 小时后重置'],
    [/^[Rr]esets? in (\d+)\s*(?:m|mins?|minutes?)\.?$/, '$1 分钟后重置'],
    [/^[Rr]esets? in (\d+)\s*(?:s|secs?|seconds?)\.?$/, '$1 秒后重置'],
    [/^[Rr]esets? in less than a minute\.?$/i, '不到 1 分钟后重置'],
    [/^[Rr]esets? in a few seconds\.?$/i, '几秒后重置'],
    [/^[Rr]esets? soon\.?$/i, '即将重置'],
    [/^[Rr]efreshes? in (\d+)\s*(?:d|days?)[,\s]+(\d+)\s*(?:h|hours?)[,\s]+(\d+)\s*(?:m|mins?|minutes?)\.?$/, '$1 天 $2 小时 $3 分钟后重置刷新'],
    [/^[Rr]efreshes? in (\d+)\s*(?:d|days?)[,\s]+(\d+)\s*(?:h|hours?)\.?$/, '$1 天 $2 小时后重置刷新'],
    [/^[Rr]efreshes? in (\d+)\s*(?:h|hours?)[,\s]+(\d+)\s*(?:m|mins?|minutes?)\.?$/, '$1 小时 $2 分钟后重置刷新'],
    [/^[Rr]efreshes? in (\d+)\s*(?:d|days?)\.?$/, '$1 天后重置刷新'],
    [/^[Rr]efreshes? in (\d+)\s*(?:h|hours?)\.?$/, '$1 小时后重置刷新'],
    [/^[Rr]efreshes? in (\d+)\s*(?:m|mins?|minutes?)\.?$/, '$1 分钟后重置刷新'],
    [/^[Rr]efreshes? in (\d+)\s*(?:s|secs?|seconds?)\.?$/, '$1 秒后重置刷新'],
    [/^[Rr]efreshes? soon\.?$/i, '即将重置刷新'],
    [/^Permanently delete (.+?)\s+including\s+(\d+)\s+active\s+conversations?\s*([?.。？])?$/i, function (m, body, n, p) { return '永久删除 ' + body + '，包括其中的 ' + n + ' 个活跃对话' + (p === '?' ? '？' : p === '.' ? '。' : p || ''); }],
    [/^Permanently delete (.+?)\s*([?.。？])?$/, function (m, body, p) { return '永久删除 ' + body + (p === '?' ? '？' : p === '.' ? '。' : p || ''); }],
    [/^Mark all (\d+) conversations as read$/i, '将全部 $1 个对话标记为已读'],
    [/^Mark (\d+) conversations? as read$/i, '将 $1 个对话标记为已读'],
    [/^You have (\d+) conversations in progress\. Updating will interrupt them, and they will automatically resume once the update completes\.$/i, '您当前有 $1 个正在进行的对话。更新将暂时中断这些对话，并在更新完成后自动恢复。'],
    [/^You have (\d+) conversations in progress\. Updating will cancel them and you'll need to manually restart them\.$/i, '您当前有 $1 个正在进行的对话。更新将取消这些对话，更新后您需要手动重新开始。'],
    [/^(Enter|Alt\+Enter|Shift\+Enter|Ctrl\+Enter|Cmd\+Enter)\s+Queues after the turn$/i, '$1 在当前回合结束后排队'],
    [/^(Enter|Alt\+Enter|Shift\+Enter|Ctrl\+Enter|Cmd\+Enter)\s+Sends immediately$/i, '$1 立即发送'],
    [/^(Enter|Alt\+Enter|Shift\+Enter|Ctrl\+Enter|Cmd\+Enter)\s+On empty prompt,\s*sends next in queue$/i, '$1 在输入框为空时发送队列中的下一条消息'],
    [/^Record Audio(\s+Ctrl\+[A-Za-z])?$/i, '录制语音$1'],
    [/^New Terminal(\s+Ctrl\+Shift\+.*)?$/i, '新建终端$1'],
    [/^Add Terminal(\s+Ctrl\+Shift\+.*)?$/i, '添加终端$1'],
    [/^Add Context(\s+.*)?$/i, '添加上下文$1'],
    [/^Select Project(\s+(?:Ctrl|Cmd|Alt|Shift)\+[\w;:,/+ -]+)?$/i, '选择项目$1'],
    [/^Select Model(\s+(?:Ctrl|Cmd|Alt|Shift)\+[\w;:,/+ -]+)?$/i, '选择模型$1'],
    [/^Cancel\s*\(((?:Ctrl|Cmd|Alt|Shift)\+[\w+-]+)\)$/i, '取消 ($1)'],
    [/^Send [Mm]essage\s+(Enter|Return|Ctrl\+Enter|Cmd\+Enter|↵)$/, '发送消息 $1'],
    [/^Send [Mm]essage\s+\((Enter|Return|Ctrl\+Enter|Cmd\+Enter|↵)\)$/, '发送消息 ($1)'],
    [/^([\d,.]+)% of the customization budget is available\.?$/i, '$1% 的自定义扩展预算可用。'],
    [/^of the customization budget is available\.?$/i, '的自定义扩展预算可用。'],
    [/^Show (\d+) breakdowns?$/i, '显示 $1 项明细'],
    [/^Hide (\d+) breakdowns?$/i, '隐藏 $1 项明细'],
    [/^(\d+) demoted$/i, '$1 项已降级'],
    [/^(\d+) excluded$/i, '$1 项已排除'],
    [/^(\d+)\s+tools?\s+excluded$/i, '已排除 $1 个工具'],
    [/^(\d+)\s+tools?\s+enabled$/i, '已启用 $1 个工具'],
    [/^(\d+)\s+tools?\s+disabled$/i, '已禁用 $1 个工具'],
    [/^(\d+)\s+tools$/i, '$1 个工具'],
    [/^Plugin:\s*(.*)$/i, '插件：$1'],
    [/^Build with (.+) Plugins$/i, 'Build with $1 插件'],
    [/^There are currently no Build with (.+) plugins available\.?$/i, '当前暂无可用的 Build with $1 插件。'],
    [/^Failed to enable plugin (.+)$/i, '启用插件 $1 失败'],
    [/^Failed to update agent:\s*(.+)$/i, '更新智能体失败：$1'],
    [/^Failed to remove agent:\s*(.+)$/i, '移除智能体失败：$1'],
    [/^Failed to remove plugin:\s*(.+)$/i, '移除插件失败：$1'],
    [/^Failed to toggle plugin:\s*(.+)$/i, '切换插件状态失败：$1'],
    [/^Error updating agent:\s*(.+)$/i, '更新智能体出错：$1'],
    [/^Failed to write MCP config:\s*(.+)$/i, '写入 MCP 配置失败：$1'],
    [/^Failed to load skills:\s*(.+)$/i, '加载技能失败：$1'],
    [/^Failed to scan skills config file:\s*(.+)$/i, '扫描技能配置文件失败：$1'],
    [/^Failed to revalidate slash commands:\s*(.*)$/i, '重新验证斜杠命令失败：$1'],
    [/^Failed to add plugin\.?\s*(?:Please try again\.?)?$/i, '添加插件失败。请重试。'],
    [/^Unnamed [Aa]gent (\d+)$/, '未命名智能体 $1'],
    [/^Unnamed [Ss]kill (\d+)$/, '未命名技能 $1'],
    [/^UI Extension (\d+)$/, '界面扩展 $1'],
    [/^Automation (\d+)$/, '自动化任务 $1'],
    [/^Rule (\d+)$/, '规则 $1'],
    [/^Branch ([\w./-]+)$/, '分支 $1'],
    [/^All changes since (.+)$/i, '自 $1 以来的全部更改'],
    [/^(\d+) commits? to push$/i, '$1 个待推送的提交'],
    [/^(\d+) commits? to pull$/i, '$1 个待拉取的提交'],
    [/^(?:All |全部)?scheduled tasks run as (.+?)\.?$/i, '所有计划任务均以 $1 模型运行。'],
    [/^(?:All |全部)?plugins run as (.+?)\.?$/i, '所有插件均以 $1 模型运行。'],
    [/^(?:All |全部)?automations run as (.+?)\.?$/i, '所有自动化任务均以 $1 模型运行。'],
    [/^Review permissions for (.+)$/i, '审查 $1 的权限'],
    [/^(.+) needs a few details from you before it can run\.$/i, '$1 运行前需要您补充几项详细信息。'],
    [/^Agents created by (.+) run in a dedicated (?:project|workspace) with its own permissions, which you can change anytime in the (?:project|workspace) settings page\.? On top of those defaults, (.+) requests the access below\.$/i, '由 $1 创建的智能体将在专属工作区中运行并拥有独立权限，您可以随时在设置页面中更改。除默认权限外，$2 还请求以下访问权限。'],
    [/^Agents created by (.+) run in a dedicated (?:project|workspace) with its own permissions, which you can change anytime in the (?:project|workspace) settings page\.?$/i, '由 $1 创建的智能体将在专属工作区中运行并拥有独立权限，您可以随时在设置页面中更改。'],
    [/^On top of those defaults, (.+) requests the access below\.$/i, '除默认权限外，$1 还请求以下访问权限。'],
    [/^Message from (.+)$/i, '来自 $1 的消息'],
    [/^Executing task:\s*(.+)$/i, '正在执行任务：$1'],
    [/^Send feedback as (.+)$/i, '以 $1 身份发送反馈'],
    [/^Models within this group:\s*(.*)$/i, '该分组包含的模型：$1'],
    [/^Select model,\s*current:\s*(.+)$/i, '选择模型，当前：$1'],
    [/^Branch,\s*current:\s*(.+)$/i, function (m, cur) {
      var parts = cur.split(', ');
      var translatedParts = parts.map(function (p) {
        var trimmed = p.trim();
        var val = dictionary[trimmed];
        if (!val) {
          var lowerKey = lowerIndex[trimmed.toLowerCase()];
          if (lowerKey !== undefined) val = dictionary[lowerKey];
        }
        return val || trimmed;
      });
      return '分支，当前：' + translatedParts.join('，');
    }],
    [/^(\d+) models selected$/i, '已选择 $1 个模型'],
    [/^Auth code for (.+)$/i, '$1 的授权码'],
    [/^The (.+) MCP server requires configuration parameters before it can be started\.?$/i, '$1 MCP 服务器需要先配置参数才能启动。'],
    [/^See more in (.+)$/i, '在 $1 中查看更多'],
    [/^See less in (.+)$/i, '在 $1 中收起'],
    [/^(?:More actions|更多操作) for (.+)$/i, '$1 的更多操作'],
    [/^(.+),\s*setup required$/i, '$1（需要配置）'],
    [/^Tool Definition:\s*(.+)$/i, '工具定义：$1'],
    [/^Invocation:\s*(.+)$/i, '调用：$1'],
    [/^Agent permissions preset selector, current:\s*(.+)$/i, '智能体权限预设选择器，当前：$1'],
    [/^Undo to (?:this point|here)\.?$/i, '撤销到此处'],
    [/^Search tasks[.…]*$/i, '搜索任务...'],
    [/^Search conversations[.…]*$/i, '搜索对话...'],
    [/^Enter scheduled task name[.…]*$/i, '输入计划任务名称...'],
    [/^Enter a prompt for the agent to run[.…]*$/i, '输入供智能体执行的提示词...'],
    [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*[-\u2013\u2014]\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i, function (m, mo1, d1, mo2, d2) { return MONTH_CN[mo1.toLowerCase()] + d1 + '日 - ' + MONTH_CN[mo2.toLowerCase()] + d2 + '日'; }],
    [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*[-\u2013\u2014]\s*(\d{1,2})$/i, function (m, mo, d1, d2) { return MONTH_CN[mo.toLowerCase()] + d1 + '日 - ' + d2 + '日'; }],
    [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)?$/i, function (m, mo, d, y, t, ap) { return y + '年' + MONTH_CN[mo.toLowerCase()] + d + '日 ' + (ap ? meridiem(ap) + ' ' : '') + t; }],
    [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)?$/i, function (m, mo, d, t, ap) { return MONTH_CN[mo.toLowerCase()] + d + '日 ' + (ap ? meridiem(ap) + ' ' : '') + t; }],
    [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s*(\d{4})$/i, function (m, mo, d, y) { return y + '年' + MONTH_CN[mo.toLowerCase()] + d + '日'; }],
    [/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i, function (m, mo, d) { return MONTH_CN[mo.toLowerCase()] + d + '日'; }],
    [/^(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM)$/i, function (m, t, ap) { return meridiem(ap) + ' ' + t; }],
    // --- 吸收自 Zero-Touch 项目（antigravity-chinese-Zero-Touch） ---
    [/^(\d+)\s*([smhd])\s+ago$/i, function (m, n, u) { return n + ' ' + { s: '秒', m: '分钟', h: '小时', d: '天' }[u.toLowerCase()] + '前'; }],
    [/^Load older messages,\s*showing\s+(\d+)\s+of\s+(\d+)$/i, '加载更早的消息（已显示 $1 / $2）'],
    [/^showing\s+(\d+)\s+of\s+(\d+)$/i, '已显示 $1 / $2'],
    [/^Fold lines\s+(\d+)\s*-\s*(\d+)$/i, '折叠第 $1-$2 行'],
    [/^Run command:\s*(.+)$/i, '执行命令：$1'],
    [/^Remove\s+(.{1,40})$/i, '移除 $1'],
    // --- 吸收自 AntigravityCN 项目 ---
    [/^Thinking\s*\((.+)\)$/i, '正在思考（$1）'],
    [/^(\d+)\s+searches?$/i, '$1 次搜索'],
    [/^(\d+(?:\.\d+)?%?)\s+remaining$/i, '$1 剩余'],
    [/^(\d+)\s+hours?\s+(\d+)\s+minutes?$/i, '$1 小时 $2 分钟'],
    [/^(\d+)\s+minutes?$/i, '$1 分钟'],
    [/^(\d+)\s+hours?$/i, '$1 小时'],
    [/^(\d+)\s+days?$/i, '$1 天'],
    // --- 权限确认弹窗按钮（插入命令后的动态形式）---
    [/^Yes, and always allow '([\s\S]+)' in this conversation$/i, '是，且在此对话中始终允许 \'$1\''],
    [/^Yes, and always allow '([\s\S]+)' in this project$/i, '是，且在此项目中始终允许 \'$1\''],
    [/^Yes, and always allow '([\s\S]+)' when not in a project$/i, '是，且在非项目时始终允许 \'$1\''],
    [/^Yes, and always allow '([\s\S]+)'$/i, '是，且始终允许 \'$1\''],
    [/^Yes, allow '([\s\S]+)' this time$/i, '是，仅允许本次执行 \'$1\''],
    [/^Yes, allow '([\s\S]+)'$/i, '是，允许 \'$1\''],
    // --- 归档通知与会话列表筛选 ---
    [/^View archived in the sidebar \((.+)\)\.?$/i, '在侧边栏查看已归档（$1）。'],
    [/^View archived in the sidebar\s*\(/i, '在侧边栏查看已归档 ('],
    [/^View archived in the sidebar$/i, '在侧边栏查看已归档'],
    [/^menu\)\.$/i, '菜单）。'],
    [/^menu\)$/i, '菜单)']
  ];

  const allowLowerTokens = new Set(['today', 'yesterday', 'now', 'am', 'pm', 'week', 'month', 'verbose']);
  const isSingleLowerAllowed = token => allowLowerTokens.has(token) || hasOwn(userOverrides, token);
  const lookupMatch = match => (hasOwn(dictionary, match) ? dictionary[match] : dictionary[lowerIndex[match.toLowerCase()]]);

  function translateString(text) {
    if (!text) return text;
    const trimmed = text.trim();
    if (!trimmed) return text;

    // --- 纯标点节点：独立渲染的英文标点转中文标点（如 DOM 拆分的 "?" 节点；保留 ".." / "..." 等多字符标点）---
    if (/^[?.!,;:]+$/.test(trimmed)) {
      if (!/^[?!]+$|^[.,;:]$/.test(trimmed)) return text;
      const puncMap = { '?': '？', '.': '。', '!': '！', ',': '，', ';': '；', ':': '：' };
      let puncOut = '';
      for (const ch of trimmed) puncOut += puncMap[ch] || ch;
      return text.replace(trimmed, () => puncOut);
    }

    // --- Dynamic Agent Logs Regex Rules (Fixed Escaping) ---
    let dynamicMatch = trimmed;
    let isDynamic = false;

    if (/^Worked for [\d smhd.]+$/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/Worked for (.+)$/, function (_, d) {
        return '已工作 ' + fmtDuration(d);
      });
      isDynamic = true;
    }
    if (/^Thought for [\d smhd.]+$/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/Thought for (.+)$/, function (_, d) {
        return '已思考 ' + fmtDuration(d);
      });
      isDynamic = true;
    }
    if (/^Edited .* \+\d+ -\d+$/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/Edited (.*) \+(\d+) -(\d+)/, '编辑了 $1 (+$2 -$3)');
      isDynamic = true;
    }
    if (/^\d+ files? changed$/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^(\d+) files? changed(.*)/, '$1 个文件已更改$2');
      isDynamic = true;
    }
    if (/^Explored/.test(trimmed)) {
      if (/^Explored \d+ files?$/.test(trimmed)) {
        dynamicMatch = dynamicMatch.replace(/^Explored (\d+) files?(.*)/, '浏览了 $1 个文件$2');
      } else if (/^Explored (.*)$/.test(trimmed)) {
        dynamicMatch = dynamicMatch.replace(/^Explored (.*)/, '浏览了 $1');
      }
      isDynamic = true;
    }
    if (/^Canceled taskkill/.test(trimmed)) {
      dynamicMatch = dynamicMatch.replace(/^Canceled (.*)/, '已取消 $1');
      isDynamic = true;
    }

    if (isDynamic) {
      return text.replace(trimmed, () => dynamicMatch);
    }
    // --- End Dynamic Regex ---

    // 0. 单单词全小写标识符绝对保护（防止误伤用户工程名、目录名、变量名、命令与文件名）
    // 显式写入用户自定义词典或白名单的全小写词条允许翻译；其余纯小写单词保持原文。
    const isSingleLowerToken = /^[a-z0-9_-]+$/.test(trimmed);
    if (isSingleLowerToken && !isSingleLowerAllowed(trimmed)) {
      return text;
    }

    // 1. Direct Literal Match (Exact match including punctuation)
    if (hasOwn(dictionary, trimmed)) {
      return text.replace(trimmed, () => dictionary[trimmed]);
    }

    const trimmedLower = trimmed.toLowerCase();
    const lowerKey = lowerIndex[trimmedLower];
    if (lowerKey !== undefined && (!isSingleLowerToken || lowerKey === trimmed)) {
      return text.replace(trimmed, () => dictionary[lowerKey]);
    }

    // 2. Intelligent Punctuation Stripping & Reconstruction
    let core = trimmed;
    let trailPunc = '';
    let matchPunc = '';

    // Strip trailing common punctuation
    const puncRegex = /(\.\.\.|…|\.|\?|!|:|：|？|！|。)$/;
    const match = core.match(puncRegex);
    if (match) {
      matchPunc = match[0];
      core = core.slice(0, -matchPunc.length).trim();

      // Determine the correct Chinese counterpart punctuation
      if (matchPunc === '.') trailPunc = '。';
      else if (matchPunc === '?') trailPunc = '？';
      else if (matchPunc === '!') trailPunc = '！';
      else if (matchPunc === ':') trailPunc = '：';
      else if (matchPunc === '：') trailPunc = '：';
      else if (matchPunc === '？') trailPunc = '？';
      else if (matchPunc === '！') trailPunc = '！';
      else if (matchPunc === '。') trailPunc = '。';
      else trailPunc = matchPunc; // keep ..., …
    }

    // Check stripped core in dictionary
    const isSingleLowerCore = /^[a-z0-9_-]+$/.test(core);
    let coreTranslated;
    if (!isSingleLowerCore || isSingleLowerAllowed(core)) {
      if (hasOwn(dictionary, core)) {
        coreTranslated = dictionary[core];
      } else {
        const coreLower = core.toLowerCase();
        const lowerKey = lowerIndex[coreLower];
        if (lowerKey !== undefined && (!isSingleLowerCore || lowerKey === core)) {
          coreTranslated = dictionary[lowerKey];
        }
      }
    }

    if (coreTranslated !== undefined) {
      return text.replace(trimmed, () => (coreTranslated ? coreTranslated + trailPunc : ''));
    }

    // 2.5 动态正则规则兜底（在词典精确匹配之后执行，避免劫持已校对的词条）
    for (var ri = 0; ri < dynamicRules.length; ri++) {
      if (dynamicRules[ri][0].test(trimmed)) {
        var ruleOut = trimmed.replace(dynamicRules[ri][0], dynamicRules[ri][1]);
        if (ruleOut !== trimmed) {
          return text.replace(trimmed, () => ruleOut);
        }
      }
    }

    // 3. Fallback to word-by-word ONLY for short strings (<= 3 words)
    // 如果短语中已经包含了中文字符（即原本就是汉化内容或中英混排），则严禁进入英文分词翻译
    // 这可以完美阻止像中英文混排短语被分词规则执行二次翻译导致重叠和污染
    const hasChinese = /[一-龥]/.test(core);
    // This prevents long unmatched sentences from getting mangled into Chinglish.
    const wordsCount = core.split(/\s+/).filter(Boolean).length;
    if (wordsCount > 3) {
      // 长文本子串匹配：用词典中的词条（>=4字符）按长度降序做替换
      // 处理 DOM 拆分或动态拼接导致完整文本无法精确匹配的情况（如权限弹窗选项）
      // 词边界用 (?<![A-Za-z0-9-]) / (?![A-Za-z0-9-])：连字符视为单词一部分，
      // 避免 "agy-customizations"、"multi-turn" 等复合词被拆词误翻
      let longTemp = core;
      let longReplaced = false;
      let longMatchedChars = 0;
      if (longTextRegex) {
        longTemp = core.replace(longTextRegex, function (m) {
          longMatchedChars += (m.match(/[A-Za-z]/g) || []).length;
          longReplaced = true;
          return lookupMatch(m);
        });
      }
      // 覆盖率门槛与纯正度防御：
      // 如果长句中仍残留有未翻译的连续英文字母单词（如 where, in the, are saved, from the），
      // 说明并非所有内容均有确切对应，严禁生硬拼接产生中英夹杂怪句（如 "文件夹 where 文件已下载 in the 内置浏览器 are saved"），
      // 保持原文更为整洁。
      var ltotalChars = (core.match(/[A-Za-z]/g) || []).length;
      if (!longReplaced || (ltotalChars > 0 && longMatchedChars / ltotalChars < 0.95)) {
        return text; // 保持原文
      }
      var remainingAlphaWords = longTemp.match(/[A-Za-z]{2,}/g) || [];
      if (remainingAlphaWords.length > 0) {
        return text; // 保持原文，杜绝夹杂生硬英文字词
      }
      var lfinal = longTemp;
      lfinal = lfinal.replace(/([一-龥])\s+([一-龥])/g, '$1$2');
      // 中文之间残留的英文句号转中文句号（长文本子串替换后句中常见）
      lfinal = lfinal.replace(/([一-龥])\.\s*(?=[一-龥])/g, '$1。');
      if (matchPunc) {
        lfinal += trailPunc;
      }
      return text.replace(trimmed, () => lfinal);
    }

    // 短文本：已含中文的中英混排短语不再逐词翻译，防止二次污染
    if (hasChinese) {
      return text;
    }
    // 短文本单单词小写标识符保护：如果核心词是单个全小写单词且不在允许列表内，直接保持原文，防止被短文本正则泛化误翻
    if (isSingleLowerCore) {
      return text;
    }
    // 全词校验门槛：短文本中每个 >=2 字母的单词都必须命中词典，
    // 否则保持原文（如 "Failed to run" 中 to 未命中 -> 整句保留英文，
    // 杜绝 "已失败 to 运行" 这类中英夹杂）。比覆盖率门槛更可预测。
    const shortTokens = core.match(/[A-Za-z][A-Za-z'-]*/g) || [];
    for (var ti = 0; ti < shortTokens.length; ti++) {
      var token = shortTokens[ti];
      if (token.length < 2) continue;
      if (!(token.toLowerCase() in lowerIndex)) {
        return text;
      }
    }
    let temp = core;
    let replaced = false;
    if (shortTextRegex) {
      temp = core.replace(shortTextRegex, function (m) {
        replaced = true;
        return lookupMatch(m);
      });
    }

    let finalTranslated = replaced ? temp : core;
    // 消除中文字符之间可能由分词替换残留的英文空格，提升翻译句子的连贯精致度
    finalTranslated = finalTranslated.replace(/([一-龥])\s+([一-龥])/g, '$1$2');
    if (matchPunc) {
      finalTranslated += trailPunc;
    }
    return text.replace(trimmed, () => finalTranslated);
  }

  // 用于模糊匹配类名中包含代码/预览/diff相关关键词的正则
  const codeClassPattern = /(?:^|[\s_-])(hljs|shiki|prism|monaco|codemirror|line-number|line-content|gutter|codeblock|code-block|code-view|code-preview|file-preview|file-content|syntax-highlighting)(?:$|[\s_-])/i;

  const skipTags = ['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'KBD', 'SAMP', 'VAR'];

  // translate: translate content; children: traverse only; skip: prune subtree.
  function getTranslationScope(node) {
    if (!node) return 'skip';

    // 如果是文本节点，我们检查其父元素；如果是属性/元素节点，检查自身
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element) return 'translate';

    // 2. 如果是文本节点，并且其父元素是输入框/文本域，必须跳过文本节点翻译
    if (node.nodeType === Node.TEXT_NODE) {
      if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
        return 'skip';
      }
    }

    // Scan ancestors once, retaining content protection until all hard exclusions are checked.
    let cur = element;
    let allowThinkingTrigger = false;
    let skipContent = false;
    while (cur) {
      if (cur.id === 'ag-live-metrics-pill' || cur.id === 'ag-live-metrics-tooltip') return 'skip';
      // 4a0. 祖先标签若为代码或脚本标签（PRE, CODE, KBD, SAMP 等），绝对跳过！
      if (cur.tagName && skipTags.includes(cur.tagName)) {
        return 'skip';
      }

      // 4a0b. 语法高亮代码 token 元素（如 Prism/Shiki/hljs token），绝对跳过
      if (cur.classList && cur.classList.contains('token')) {
        return 'skip';
      }

      // 4a. contenteditable 区域
      const editable = cur.getAttribute && cur.getAttribute('contenteditable');
      if (cur.isContentEditable || (editable !== null && editable !== undefined &&
          ['', 'true', 'plaintext-only'].includes(editable.toLowerCase()))) {
        return 'skip';
      }

      // 4b. 检查 data 属性（代码块语言标记等）
      if (cur.getAttribute) {
        if (cur.getAttribute('data-language') !== null ||
            cur.getAttribute('data-code') !== null ||
            cur.getAttribute('data-line') !== null ||
            cur.getAttribute('data-line-number') !== null) {
          return 'skip';
        }
      }

      // 4b2. 思考链/模型回复正文/工具调用摘要保护：
      //      - 模型生成的自由思考链（.cursor-edit）、回复正文、工件视图属于动态自由文本，严禁局部词汇机翻。
      //      - 工具调用步骤中，仅放行系统动词前缀（如 Ran -> 已运行、Running -> 正在运行），
      //        而工具调用摘要正文（toolSummary，具有 .truncate 且父级为 .whitespace-nowrap）必须完全保留英文原文。
      //      - 「已思考 X 秒」触发药丸是系统 UI，放行汉化。
      if (cur.classList && cur.classList.contains('cursor-edit')) {
        return 'skip';
      }
      if (cur.classList && cur.classList.contains('truncate')) {
        const p = cur.parentElement;
        if (p && p.classList && p.classList.contains('whitespace-nowrap')) {
          return 'skip'; // 跳过智能体动态生成的工具调用摘要
        }
      }
      if (cur.getAttribute) {
        const testId = cur.getAttribute('data-testid');
        if (testId === 'thinking-collapsible-trigger' ||
            testId === 'worked-for-collapsible' ||
            testId === 'tool-group-collapsible') {
          allowThinkingTrigger = true;
        }
        if (testId === 'thinking-collapsible' && !allowThinkingTrigger) {
          skipContent = true;
        }
        if (testId === 'planner-response-text' ||
            testId === 'artifact-view') {
          return 'skip';
        }
      }

      // 4b3. 用户实体数据保护：项目名称、工作区名称、代码仓库、符号变量、文件路径、代码Diff、消息内容等用户自定义数据容器
      if (cur.getAttribute) {
        if (cur.getAttribute('data-project-name') !== null ||
            cur.getAttribute('data-project-card') !== null ||
            cur.getAttribute('data-project-label') !== null ||
            cur.getAttribute('data-repo-slug') !== null ||
            cur.getAttribute('data-card-name') !== null ||
            cur.getAttribute('data-member-name') !== null ||
            cur.getAttribute('data-symbol-name') !== null ||
            cur.getAttribute('data-variable-name') !== null ||
            cur.getAttribute('data-file-uri') !== null ||
            cur.getAttribute('data-uri') !== null ||
            cur.getAttribute('data-turn-content') !== null ||
            cur.getAttribute('data-diff') !== null ||
            cur.getAttribute('data-current-original-line') !== null ||
            cur.getAttribute('data-current-modified-line') !== null ||
            cur.getAttribute('data-arg-key') !== null ||
            cur.getAttribute('data-arg-type') !== null ||
            cur.getAttribute('data-slug-base') !== null) {
          return 'skip';
        }
        const testId = cur.getAttribute('data-testid');
        if (testId) {
          if (testId === 'project-selector-trigger' ||
              testId === 'project-selector-item' ||
              testId === 'project-header' ||
              testId === 'conversation-navigator-card' ||
              testId === 'sidecar-project-link') {
            return 'skip';
          }
        }
      }

      // 4b4. 快捷指令与提及菜单保护：保持英文原版，不执行翻译
      if (cur.getAttribute) {
        if (cur.getAttribute('data-mention-menu') !== null ||
            cur.getAttribute('data-lexical-beautiful-mention') !== null ||
            cur.getAttribute('data-slash-menu') !== null) {
          return 'skip';
        }
        const testId = cur.getAttribute('data-testid');
        if (testId && (
            testId.startsWith('mention-menu') ||
            testId.startsWith('slash-command') ||
            testId.startsWith('slash-menu') ||
            testId === 'command-menu'
        )) {
          return 'skip';
        }
      }
      if (cur.classList && (
          cur.classList.contains('mention-menu') ||
          cur.classList.contains('slash-menu') ||
          cur.classList.contains('slash-command')
      )) {
        return 'skip';
      }

      // 4c. 检查 role 属性
      if (cur.getAttribute) {
        const role = cur.getAttribute('role');
        if (role === 'code') {
          return 'skip';
        }
      }

      // 4d. 精确类名匹配 — 已知的编辑器/终端/输入区域
      if (cur.classList && (
        cur.classList.contains('monaco-editor') ||
        cur.classList.contains('editor-instance') ||
        cur.classList.contains('xterm') ||
        cur.classList.contains('terminal-instance') ||
        cur.classList.contains('input-area') ||
        cur.classList.contains('chat-input')
      )) {
        return 'skip';
      }

      // 4e. 类名匹配 — 精确与模糊检测（高精度防御，防止 Tailwind 选择器如 [&_code] 引起的误杀）
      if (cur.className && typeof cur.className === 'string') {
        const lowerClass = cur.className.toLowerCase();
        if (
          lowerClass.includes('code-line') ||
          /(?:^|[\s_-])select-contain(?:$|[\s_-])/i.test(cur.className) ||
          codeClassPattern.test(cur.className)
        ) {
          return 'skip';
        }
      }

      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host);
    }

    return skipContent ? 'children' : 'translate';
  }

  const textStates = new WeakMap();
  const attributeStates = new WeakMap();
  const shadowRoots = new WeakMap();
  const observedRoots = new WeakMap();
  const translatedAttributes = ['placeholder', 'title', 'aria-label'];

  function translateTextNode(node) {
    const current = node.nodeValue;
    const state = textStates.get(node);
    const original = state && current === state.last ? state.original : current;
    const translated = translateString(original);
    textStates.set(node, { original, last: translated });
    if (current !== translated) node.nodeValue = translated;
  }

  function translateAttribute(node, name) {
    if (!translatedAttributes.includes(name)) return;
    let states = attributeStates.get(node);
    if (!states) {
      states = Object.create(null);
      attributeStates.set(node, states);
    }
    const current = node.getAttribute(name);
    if (current === null) {
      delete states[name];
      return;
    }
    const state = states[name];
    const original = state && current === state.last ? state.original : current;
    const translated = translateString(original);
    states[name] = { original, last: translated };
    if (current !== translated) node.setAttribute(name, translated);
  }

  function translateNode(node) {
    // Thinking containers must be traversed to reach their UI triggers, but
    // their prose remains protected. All other exclusions still prune subtrees.
    const scope = getTranslationScope(node);
    if (scope === 'skip') return;
    const skipContent = scope === 'children';
    if (node.nodeType === Node.TEXT_NODE) {
      if (!skipContent) translateTextNode(node);
    } else if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (!skipContent) translatedAttributes.forEach(attr => translateAttribute(node, attr));
        const shadow = node.shadowRoot || shadowRoots.get(node);
        if (shadow) {
          translateNode(shadow);
          observeRoot(shadow);
        }
      }
      for (const child of node.childNodes) translateNode(child);
    }
  }


  const observerConfig = {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: translatedAttributes
  };

  function observeRoot(root) {
    if (observedRoots.has(root)) return;
    const observer = new MutationObserver(mutations => {
      // Keep observing while translating: our own writes are idempotent, and
      // disconnecting would discard synchronous application mutations.
      const added = new Set();
      for (const mutation of mutations) {
        try {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(node => added.add(node));
          } else if (getTranslationScope(mutation.target) === 'translate') {
            if (mutation.type === 'characterData') translateTextNode(mutation.target);
            else if (mutation.type === 'attributes') translateAttribute(mutation.target, mutation.attributeName);
          }
        } catch (error) {
          console.error('Observer translation error:', error);
        }
      }
      for (const node of added) {
        try { translateNode(node); }
        catch (error) { console.error('Observer translation error:', error); }
      }
    });
    observedRoots.set(root, observer);
    observer.observe(root, observerConfig);
  }

  const originalAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function() {
    const root = originalAttachShadow.apply(this, arguments);
    shadowRoots.set(this, root);
    observeRoot(root);
    return root;
  };

  function startObserver() {
    if (!document.body) return;
    if (metricsEnabled) {
      initMetrics();
    }
    try { translateNode(document.body); }
    catch (error) { console.error('Translation error:', error); }
    observeRoot(document.body);
  }

  rebuildDict(Object.create(null));
  loadExternalDict();
  watchExternalDict();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
})();
