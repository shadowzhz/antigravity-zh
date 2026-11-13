// AGZH ENGINE START
;(function() {
  __DICT_ITEMS__
  const metricsEnabled = __METRICS_ENABLED__;
  __METRICS_RUNTIME__

  // The JSON bundle is the only built-in dictionary. User overrides are a
  // replaceable snapshot; removing a key restores its bundled value.
  const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const baseDictionary = Object.freeze(Object.assign(Object.create(null), bundledDictionary));
  const isAlnumKey = /^[a-zA-Z0-9]+$/;
  const startAlnum = /^[a-zA-Z0-9]/;
  const endAlnum = /[a-zA-Z0-9]$/;
  const hasAsciiAlpha = /[A-Za-z]/;
  const MAX_CACHE_SIZE = 4096;
  const translationCache = new Map();
  let dictionary, userOverrides, lowerIndex, buckets3, buckets12;
  let hasNonAsciiAlphaKeys = false;
  let dictVersion = 0;
  let observerStarted = false;

  function isWordBound(code) {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 48 && code <= 57) || code === 45;
  }

  function isAsciiAlphaCode(code) {
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
  }

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
    const nextBuckets3 = new Map();
    const nextBuckets12 = new Map();
    let nextHasNonAsciiAlpha = false;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (!hasAsciiAlpha.test(key)) nextHasNonAsciiAlpha = true;
      const kLen = key.length;
      const inLong = kLen >= 4;
      const inShort = kLen > 3 || isAlnumKey.test(key);
      if (!inLong && !inShort) continue;
      const kl = key.toLowerCase();
      const entry = {
        kl,
        len: kl.length,
        needL: startAlnum.test(key),
        needR: endAlnum.test(key),
        inLong,
        inShort
      };
      if (entry.len >= 3) {
        const prefix = kl.slice(0, 3);
        let list = nextBuckets3.get(prefix);
        if (!list) nextBuckets3.set(prefix, (list = []));
        list.push(entry);
      } else if (entry.len >= 1) {
        const prefix = kl[0];
        let list = nextBuckets12.get(prefix);
        if (!list) nextBuckets12.set(prefix, (list = []));
        list.push(entry);
      }
    }
    // Publish only after the complete snapshot has validated and compiled.
    dictionary = next;
    userOverrides = nextUser;
    lowerIndex = index;
    buckets3 = nextBuckets3;
    buckets12 = nextBuckets12;
    hasNonAsciiAlphaKeys = nextHasNonAsciiAlpha;
    dictVersion++;
    translationCache.clear();
  }

  let lastExternalContents = null;
  function loadExternalDict() {
    try {
      const fs = require('fs');
      const path = require('path');
      const file = path.join(require('os').homedir(), '.antigravity-zh', 'zh-CN.json');
      const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '{}';
      if (raw === lastExternalContents && dictionary) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('词典必须是 JSON 对象');
      const items = Object.prototype.hasOwnProperty.call(parsed, 'translations') ? parsed.translations : parsed;
      if (!items || typeof items !== 'object' || Array.isArray(items)) throw new Error('translations 必须是对象');
      const overrides = Object.create(null);
      let hasNewOverrides = false;
      for (const [key, value] of Object.entries(items)) {
        if (key.startsWith('__')) continue;
        if (!key.trim() || typeof value !== 'string') throw new Error('词条必须使用非空键和字符串译文');
        overrides[key] = value;
        hasNewOverrides = true;
      }
      const hadOverrides = userOverrides ? Object.keys(userOverrides).length > 0 : false;
      if (!dictionary || hadOverrides || hasNewOverrides) {
        rebuildDict(overrides);
        if (observerStarted && document.body) translateNode(document.body);
      }
      lastExternalContents = raw;
    } catch (error) {
      if (!dictionary) rebuildDict(Object.create(null));
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
      const watcher = fs.watch(directory, { persistent: false }, (_event, filename) => {
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
    [/^Worked for ([\d smhd.]+)$/, function (_, d) { return '已工作 ' + fmtDuration(d); }],
    [/^Thought for ([\d smhd.]+)$/, function (_, d) { return '已思考 ' + fmtDuration(d); }],
    [/^Edited (.*) \+(\d+) -(\d+)$/, '编辑了 $1 (+$2 -$3)'],
    [/^(\d+) files? changed$/, '$1 个文件已更改'],
    [/^Explored (\d+) files?$/, '浏览了 $1 个文件'],
    [/^Explored (.+)$/, '浏览了 $1'],
    [/^Canceled (taskkill.*)$/, '已取消 $1'],
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
    [/^(?:All )?scheduled tasks run as (.+?)\.?$/i, '所有计划任务均以 $1 模型运行。'],
    [/^(?:All )?plugins run as (.+?)\.?$/i, '所有插件均以 $1 模型运行。'],
    [/^(?:All )?automations run as (.+?)\.?$/i, '所有自动化任务均以 $1 模型运行。'],
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
    [/^More actions for (.+)$/i, '$1 的更多操作'],
    [/^(.+),\s*setup required$/i, '$1（需要配置）'],
    [/^Tool Definition:\s*(.+)$/i, '工具定义：$1'],
    [/^Invocation:\s*(.+)$/i, '调用：$1'],
    [/^Agent permissions preset selector, current:\s*(.+)$/i, '智能体权限预设选择器，当前：$1'],
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
    [/^View archived in the sidebar\s*\(/i, '在侧边栏查看已归档 (']
  ];

  const allowLowerTokens = new Set(['today', 'yesterday', 'now', 'week', 'month', 'verbose']);
  const isSingleLowerAllowed = token => allowLowerTokens.has(token) || hasOwn(userOverrides, token);
  const lookupMatch = match => (hasOwn(dictionary, match) ? dictionary[match] : dictionary[lowerIndex[match.toLowerCase()]]);
  const puncMap = { '?': '？', '.': '。', '!': '！', ',': '，', ';': '；', ':': '：' };
  const purePuncRegex = /^[?.!,;:]+$/;
  const validPurePuncRegex = /^[?!]+$|^[.,;:]$/;
  const singleLowerRegex = /^[a-z0-9_-]+$/;
  const puncRegex = /(\.\.\.|…|\.|\?|!|:|：|？|！|。)$/;
  const cjkRegex = /[一-龥]/;
  const leadingCjkRegex = /^[\u4e00-\u9fff]/;
  const suffixRuleRegex = /needs a few details from you before it can run\.?$|,\s*setup required$/i;
  const shortTokenRegex = /[A-Za-z][A-Za-z'-]*/g;
  const cjkSpaceRegex = /([一-龥])\s+([一-龥])/g;
  const cjkDotRegex = /([一-龥])\.\s*(?=[一-龥])/g;

  function countAsciiAlpha(str, start, end) {
    let n = 0;
    for (let i = start; i < end; i++) {
      if (isAsciiAlphaCode(str.charCodeAt(i))) n++;
    }
    return n;
  }

  function hasTwoAsciiAlpha(str, start, end) {
    let prev = false;
    for (let i = start; i < end; i++) {
      const isA = isAsciiAlphaCode(str.charCodeAt(i));
      if (isA && prev) return true;
      prev = isA;
    }
    return false;
  }

  function scanLongBuckets(core) {
    const len = core.length;
    if (len < 4 || !buckets3.size) return null;
    const lower = core.toLowerCase();
    if (lower.length !== len) return null;
    let out = '';
    let lastIndex = 0;
    let i = 0;
    let longReplaced = false;
    let longMatchedChars = 0;
    let consecutiveAlphaInGap = 0;
    while (i <= len - 4) {
      const list = buckets3.get(lower.slice(i, i + 3));
      let matchedEntry = null;
      if (list) {
        const prevB = i > 0 && isWordBound(core.charCodeAt(i - 1));
        for (let j = 0; j < list.length; j++) {
          const e = list[j];
          if (!e.inLong) continue;
          const end = i + e.len;
          if (end > len) continue;
          if (e.needL && prevB) continue;
          if (e.needR && end < len && isWordBound(core.charCodeAt(end))) continue;
          if (lower.startsWith(e.kl, i)) {
            matchedEntry = e;
            break;
          }
        }
      }
      if (matchedEntry) {
        if (hasTwoAsciiAlpha(core, lastIndex, i)) return null;
        out += core.slice(lastIndex, i) + lookupMatch(core.slice(i, i + matchedEntry.len));
        longMatchedChars += countAsciiAlpha(core, i, i + matchedEntry.len);
        longReplaced = true;
        i += matchedEntry.len;
        lastIndex = i;
        consecutiveAlphaInGap = 0;
      } else {
        if (isAsciiAlphaCode(core.charCodeAt(i))) {
          if (++consecutiveAlphaInGap >= 2) return null;
        } else {
          consecutiveAlphaInGap = 0;
        }
        i++;
      }
    }
    if (!longReplaced || hasTwoAsciiAlpha(core, lastIndex, len)) return null;
    const ltotalChars = countAsciiAlpha(core, 0, len);
    if (ltotalChars > 0 && longMatchedChars / ltotalChars < 0.95) return null;
    return out + core.slice(lastIndex);
  }

  function scanShortBuckets(core) {
    const len = core.length;
    if (!len) return null;
    const lower = core.toLowerCase();
    if (lower.length !== len) return null;
    let out = '';
    let lastIndex = 0;
    let i = 0;
    let replaced = false;
    while (i < len) {
      let matchedEntry = null;
      const prevB = i > 0 && isWordBound(core.charCodeAt(i - 1));
      if (i <= len - 3 && buckets3.size) {
        const list3 = buckets3.get(lower.slice(i, i + 3));
        if (list3) {
          for (let j = 0; j < list3.length; j++) {
            const e = list3[j];
            if (!e.inShort) continue;
            const end = i + e.len;
            if (end > len) continue;
            if (e.needL && prevB) continue;
            if (e.needR && end < len && isWordBound(core.charCodeAt(end))) continue;
            if (lower.startsWith(e.kl, i)) {
              matchedEntry = e;
              break;
            }
          }
        }
      }
      if (!matchedEntry && buckets12.size) {
        const list12 = buckets12.get(lower[i]);
        if (list12) {
          for (let j = 0; j < list12.length; j++) {
            const e = list12[j];
            if (!e.inShort) continue;
            const end = i + e.len;
            if (end > len) continue;
            if (e.needL && prevB) continue;
            if (e.needR && end < len && isWordBound(core.charCodeAt(end))) continue;
            if (lower.startsWith(e.kl, i)) {
              matchedEntry = e;
              break;
            }
          }
        }
      }
      if (matchedEntry) {
        out += core.slice(lastIndex, i) + lookupMatch(core.slice(i, i + matchedEntry.len));
        replaced = true;
        i += matchedEntry.len;
        lastIndex = i;
      } else {
        i++;
      }
    }
    return replaced ? out + core.slice(lastIndex) : null;
  }

  function translateTrimmed(trimmed) {
    // --- 纯标点节点：独立渲染的英文标点转中文标点（如 DOM 拆分的 "?" 节点；保留 ".." / "..." 等多字符标点）---
    if (purePuncRegex.test(trimmed)) {
      if (!validPurePuncRegex.test(trimmed)) return null;
      let puncOut = '';
      for (const ch of trimmed) puncOut += puncMap[ch];
      return puncOut;
    }

    // 0. 单单词全小写标识符绝对保护（防止误伤用户工程名、目录名、变量名、命令与文件名）
    // 显式写入用户自定义词典或白名单的全小写词条允许翻译；其余纯小写单词保持原文。
    const isSingleLowerToken = singleLowerRegex.test(trimmed);
    if (isSingleLowerToken && !isSingleLowerAllowed(trimmed)) {
      return null;
    }

    // 1. Direct Literal Match (Exact match including punctuation)
    if (hasOwn(dictionary, trimmed)) {
      return dictionary[trimmed];
    }

    const trimmedLower = trimmed.toLowerCase();
    const lowerKey = lowerIndex[trimmedLower];
    if (lowerKey !== undefined && !isSingleLowerToken) {
      return dictionary[lowerKey];
    }

    if (!hasNonAsciiAlphaKeys && !hasAsciiAlpha.test(trimmed)) {
      return null;
    }

    // 2. Intelligent Punctuation Stripping & Reconstruction
    let core = trimmed;
    let trailPunc = '';
    let matchPunc = '';

    // Strip trailing common punctuation
    const match = core.match(puncRegex);
    if (match) {
      matchPunc = match[0];
      core = core.slice(0, -matchPunc.length).trim();

      // Determine the correct Chinese counterpart punctuation
      if (matchPunc === '.') trailPunc = '。';
      else if (matchPunc === '?') trailPunc = '？';
      else if (matchPunc === '!') trailPunc = '！';
      else if (matchPunc === ':') trailPunc = '：';
      else trailPunc = matchPunc; // keep ..., …, ：, ？, ！, 。
    }

    // Check stripped core in dictionary
    const isSingleLowerCore = singleLowerRegex.test(core);
    let coreTranslated;
    if (!isSingleLowerCore || isSingleLowerAllowed(core)) {
      if (hasOwn(dictionary, core)) {
        coreTranslated = dictionary[core];
      } else {
        const coreLower = core.toLowerCase();
        const coreLowerKey = lowerIndex[coreLower];
        if (coreLowerKey !== undefined && !isSingleLowerCore) {
          coreTranslated = dictionary[coreLowerKey];
        }
      }
    }

    if (coreTranslated !== undefined) {
      return coreTranslated ? coreTranslated + trailPunc : '';
    }

    // 2.5 动态正则规则兜底（在词典精确匹配之后执行，避免劫持已校对的词条）
    if (leadingCjkRegex.test(trimmed) && !suffixRuleRegex.test(trimmed)) {
      return null;
    }
    for (var ri = 0; ri < dynamicRules.length; ri++) {
      if (dynamicRules[ri][0].test(trimmed)) {
        var ruleOut = trimmed.replace(dynamicRules[ri][0], dynamicRules[ri][1]);
        if (ruleOut !== trimmed) {
          return ruleOut;
        }
      }
    }

    // 3. Fallback to word-by-word ONLY for short strings (<= 3 words)
    // 如果短语中已经包含了中文字符（即原本就是汉化内容或中英混排），则严禁进入英文分词翻译
    // 这可以完美阻止像中英文混排短语被分词规则执行二次翻译导致重叠和污染
    if (cjkRegex.test(core)) {
      return null;
    }
    // This prevents long unmatched sentences from getting mangled into Chinglish.
    const wordsCount = core.split(/\s+/).filter(Boolean).length;
    if (wordsCount > 3) {
      // 长文本子串匹配：用词典中的词条（>=4字符）按长度降序做替换
      // 处理 DOM 拆分或动态拼接导致完整文本无法精确匹配的情况（如权限弹窗选项）
      // 词边界用 (?<![A-Za-z0-9-]) / (?![A-Za-z0-9-])：连字符视为单词一部分，
      // 避免 "agy-customizations"、"multi-turn" 等复合词被拆词误翻
      var lfinal = scanLongBuckets(core);
      if (lfinal === null) {
        return null; // 保持原文
      }
      lfinal = lfinal.replace(cjkSpaceRegex, '$1$2');
      // 中文之间残留的英文句号转中文句号（长文本子串替换后句中常见）
      lfinal = lfinal.replace(cjkDotRegex, '$1。');
      if (matchPunc) {
        lfinal += trailPunc;
      }
      return lfinal;
    }

    // 短文本单单词小写标识符保护：如果核心词是单个全小写单词且不在允许列表内，直接保持原文，防止被短文本正则泛化误翻
    if (isSingleLowerCore) {
      return null;
    }
    // 全词校验门槛：短文本中每个 >=2 字母的单词都必须命中词典，
    // 否则保持原文（如 "Failed to run" 中 to 未命中 -> 整句保留英文，
    // 杜绝 "已失败 to 运行" 这类中英夹杂）。比覆盖率门槛更可预测。
    const shortTokens = core.match(shortTokenRegex) || [];
    for (var ti = 0; ti < shortTokens.length; ti++) {
      var token = shortTokens[ti];
      if (token.length < 2) continue;
      if (!(token.toLowerCase() in lowerIndex)) {
        return null;
      }
    }
    const shortReplaced = scanShortBuckets(core);
    let finalTranslated = shortReplaced !== null ? shortReplaced : core;
    // 消除中文字符之间可能由分词替换残留的英文空格，提升翻译句子的连贯精致度
    finalTranslated = finalTranslated.replace(cjkSpaceRegex, '$1$2');
    if (matchPunc) {
      finalTranslated += trailPunc;
    }
    return finalTranslated;
  }

  function translateString(text) {
    if (!text) return text;
    const trimmed = text.trim();
    if (!trimmed) return text;
    let translated = translationCache.get(trimmed);
    if (translated === undefined) {
      translated = translateTrimmed(trimmed);
      if (translationCache.size >= MAX_CACHE_SIZE) translationCache.clear();
      translationCache.set(trimmed, translated);
    }
    if (translated === null || translated === trimmed) return text;
    return text === trimmed ? translated : text.replace(trimmed, () => translated);
  }

  // 用于模糊匹配类名中包含代码/预览/diff相关关键词的正则
  const skipTagsSet = new Set(['SCRIPT', 'STYLE', 'CODE', 'PRE', 'NOSCRIPT', 'KBD', 'SAMP', 'VAR']);
  const skipExactClassRegex = /(?:^|\s)(?:token|cursor-edit|mention-menu|slash-menu|slash-command|monaco-editor|editor-instance|xterm|terminal-instance|input-area|chat-input)(?=$|\s)/;
  const truncateClassRegex = /(?:^|\s)truncate(?=$|\s)/;
  const whitespaceNowrapRegex = /(?:^|\s)whitespace-nowrap(?=$|\s)/;
  const codeClassPattern = /code-line|(?:^|[\s_-])(?:select-contain|hljs|shiki|prism|monaco|codemirror|line-number|line-content|gutter|codeblock|code-block|code-view|code-preview|file-preview|file-content|syntax-highlighting)(?:$|[\s_-])/i;
  const skipDataAttrs = [
    'data-language', 'data-code', 'data-line', 'data-line-number',
    'data-project-name', 'data-project-card', 'data-project-label', 'data-repo-slug',
    'data-card-name', 'data-member-name', 'data-symbol-name', 'data-variable-name',
    'data-file-uri', 'data-uri', 'data-turn-content', 'data-diff',
    'data-current-original-line', 'data-current-modified-line', 'data-arg-key',
    'data-arg-type', 'data-slug-base', 'data-mention-menu',
    'data-lexical-beautiful-mention', 'data-slash-menu'
  ];
  const skipTestIds = new Set([
    'planner-response-text', 'artifact-view', 'project-selector-trigger',
    'project-selector-item', 'project-header', 'conversation-navigator-card',
    'sidecar-project-link', 'command-menu'
  ]);
  const triggerTestIds = new Set([
    'thinking-collapsible-trigger', 'worked-for-collapsible', 'tool-group-collapsible'
  ]);

  function classifyElement(cur) {
    if (cur.id === 'ag-live-metrics-pill' || cur.id === 'ag-live-metrics-tooltip') return 'skip';
    // 4a0. 标签若为代码或脚本标签（PRE, CODE, KBD, SAMP 等），绝对跳过！
    if (cur.tagName && skipTagsSet.has(cur.tagName)) {
      return 'skip';
    }
    // 4a. contenteditable 区域
    if (cur.isContentEditable) {
      return 'skip';
    }
    // 4a0b / 4b2 / 4b4 / 4d / 4e. 类名检查
    const cn = cur.className;
    if (typeof cn === 'string') {
      if (cn.length > 0) {
        if (skipExactClassRegex.test(cn) || codeClassPattern.test(cn)) {
          return 'skip';
        }
        if (truncateClassRegex.test(cn)) {
          const p = cur.parentElement;
          if (p) {
            const pcn = p.className;
            if (typeof pcn === 'string'
                ? whitespaceNowrapRegex.test(pcn)
                : (p.classList && p.classList.contains('whitespace-nowrap'))) {
              return 'skip'; // 跳过智能体动态生成的工具调用摘要
            }
          }
        }
      }
    } else if (cur.classList) {
      if (cur.classList.contains('token') ||
          cur.classList.contains('cursor-edit') ||
          cur.classList.contains('mention-menu') ||
          cur.classList.contains('slash-menu') ||
          cur.classList.contains('slash-command') ||
          cur.classList.contains('monaco-editor') ||
          cur.classList.contains('editor-instance') ||
          cur.classList.contains('xterm') ||
          cur.classList.contains('terminal-instance') ||
          cur.classList.contains('input-area') ||
          cur.classList.contains('chat-input')) {
        return 'skip';
      }
      if (cur.classList.contains('truncate')) {
        const p = cur.parentElement;
        if (p && p.classList && p.classList.contains('whitespace-nowrap')) {
          return 'skip';
        }
      }
    }
    // 原生 DOM 上若无属性或仅有 class 属性，直接跳过全部 getAttribute 查询
    const domAttrs = cur.attributes;
    if (domAttrs !== undefined && (domAttrs.length === 0 || (domAttrs.length === 1 && domAttrs[0].name === 'class'))) {
      return 'normal';
    }
    if (cur.getAttribute) {
      const editable = cur.getAttribute('contenteditable');
      if (editable !== null && editable !== undefined) {
        const edLower = editable.toLowerCase();
        if (edLower === '' || edLower === 'true' || edLower === 'plaintext-only') {
          return 'skip';
        }
      }
      if (cur.getAttribute('role') === 'code') {
        return 'skip';
      }
      for (let i = 0; i < skipDataAttrs.length; i++) {
        if (cur.getAttribute(skipDataAttrs[i]) !== null) {
          return 'skip';
        }
      }
      const testId = cur.getAttribute('data-testid');
      if (testId) {
        if (skipTestIds.has(testId) ||
            testId.startsWith('mention-menu') ||
            testId.startsWith('slash-command') ||
            testId.startsWith('slash-menu')) {
          return 'skip';
        }
        if (triggerTestIds.has(testId)) {
          return 'trigger';
        }
        if (testId === 'thinking-collapsible') {
          return 'thinking';
        }
      }
    }
    return 'normal';
  }

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
      const kind = classifyElement(cur);
      if (kind === 'skip') return 'skip';
      if (kind === 'trigger') allowThinkingTrigger = true;
      else if (kind === 'thinking' && !allowThinkingTrigger) skipContent = true;
      cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host);
    }

    return skipContent ? 'children' : 'translate';
  }

  const textStates = new WeakMap();
  const attributeStates = new WeakMap();
  const shadowRoots = new WeakMap();
  const observedRoots = new WeakMap();
  const translatedAttributes = ['placeholder', 'title', 'aria-label'];
  const translatedAttributesSet = new Set(translatedAttributes);

  function translateTextNode(node) {
    const current = node.nodeValue;
    const state = textStates.get(node);
    if (state && current === state.last && state.version === dictVersion) return;
    const original = state && current === state.last ? state.original : current;
    const translated = translateString(original);
    textStates.set(node, { original, last: translated, version: dictVersion });
    if (current !== translated) node.nodeValue = translated;
  }

  function translateAttribute(node, name) {
    if (!translatedAttributesSet.has(name)) return;
    const current = node.getAttribute(name);
    let states = attributeStates.get(node);
    if (current === null) {
      if (states) delete states[name];
      return;
    }
    const state = states ? states[name] : undefined;
    if (state && current === state.last && state.version === dictVersion) return;
    if (!states) {
      states = Object.create(null);
      attributeStates.set(node, states);
    }
    const original = state && current === state.last ? state.original : current;
    const translated = translateString(original);
    states[name] = { original, last: translated, version: dictVersion };
    if (current !== translated) node.setAttribute(name, translated);
  }

  function translateNode(node, inheritedScope) {
    if (!node) return;
    let scope;
    if (inheritedScope === undefined) {
      // Thinking containers must be traversed to reach their UI triggers, but
      // their prose remains protected. All other exclusions still prune subtrees.
      scope = getTranslationScope(node);
      if (scope === 'skip') return;
    } else if (node.nodeType === Node.TEXT_NODE) {
      const parent = node.parentElement;
      if (parent && (parent.tagName === 'INPUT' || parent.tagName === 'TEXTAREA')) return;
      scope = inheritedScope;
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const kind = classifyElement(node);
      if (kind === 'skip') return;
      scope = kind === 'trigger' ? 'translate' : kind === 'thinking' ? 'children' : inheritedScope;
    } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      scope = inheritedScope;
    } else {
      return;
    }

    const skipContent = scope === 'children';
    if (node.nodeType === Node.TEXT_NODE) {
      if (!skipContent) translateTextNode(node);
    } else if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (!skipContent) {
          for (let i = 0; i < translatedAttributes.length; i++) {
            translateAttribute(node, translatedAttributes[i]);
          }
        }
        const shadow = node.shadowRoot || shadowRoots.get(node);
        if (shadow) {
          translateNode(shadow, scope);
          observeRoot(shadow);
        }
      }
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        translateNode(children[i], scope);
      }
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
          } else if (mutation.type === 'characterData') {
            const state = textStates.get(mutation.target);
            if (state && mutation.target.nodeValue === state.last && state.version === dictVersion) continue;
            if (getTranslationScope(mutation.target) === 'translate') translateTextNode(mutation.target);
          } else if (mutation.type === 'attributes') {
            const states = attributeStates.get(mutation.target);
            const state = states && states[mutation.attributeName];
            if (state && mutation.target.getAttribute(mutation.attributeName) === state.last && state.version === dictVersion) continue;
            if (getTranslationScope(mutation.target) === 'translate') translateAttribute(mutation.target, mutation.attributeName);
          }
        } catch (error) {
          console.error('Observer translation error:', error);
        }
      }
      if (added.size > 1) {
        for (const node of added) {
          let p = node.parentElement;
          let covered = false;
          while (p) {
            if (added.has(p)) { covered = true; break; }
            p = p.parentElement;
          }
          if (!covered) {
            try { translateNode(node); }
            catch (error) { console.error('Observer translation error:', error); }
          }
        }
      } else {
        for (const node of added) {
          try { translateNode(node); }
          catch (error) { console.error('Observer translation error:', error); }
        }
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
    observerStarted = true;
    if (metricsEnabled) {
      initMetrics();
    }
    try { translateNode(document.body); }
    catch (error) { console.error('Translation error:', error); }
    observeRoot(document.body);
  }

  loadExternalDict();
  if (!dictionary) rebuildDict(Object.create(null));
  watchExternalDict();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver, { once: true });
  } else {
    startObserver();
  }
})();
