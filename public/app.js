const state = {
  data: null,
  loading: false,
  modal: null,
  modalData: null,
  taskFilter: 'all',
  extensionFilter: 'all',
  search: '',
  connected: false,
};

const app = document.querySelector('#app');
const toastRegion = document.querySelector('#toast-region');

const STATUS_LABELS = {
  draft: '草稿',
  awaiting_approval: '等待批准',
  queued: '排队中',
  running: '执行中',
  paused: '已暂停',
  verifying: '正在验收',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  interrupted: '已中断',
};

const NAV_ITEMS = [
  ['home', '首页', 'home'],
  ['tasks', '任务', 'tasks'],
  ['memory', '记忆', 'memory'],
  ['extensions', '扩展', 'blocks'],
  ['security', '安全', 'shield'],
  ['settings', '设置', 'settings'],
];

await initialize();

async function initialize() {
  if (!location.hash) location.hash = '#/home';
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('change', handleChange);
  document.addEventListener('keydown', handleKeydown);
  window.addEventListener('hashchange', () => {
    state.modal = null;
    state.modalData = null;
    document.body.classList.remove('nav-open');
    render();
  });
  window.addEventListener('scroll', () => document.querySelector('.topbar')?.classList.toggle('scrolled', window.scrollY > 4), { passive: true });

  try {
    state.data = await api('/api/bootstrap');
    applyTheme(state.data.settings.theme);
    render();
    if (!new URLSearchParams(location.search).has('static')) connectEvents();
    if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('static')) navigator.serviceWorker.register('/sw.js').catch(() => {});
  } catch (error) {
    app.innerHTML = renderFatal(error);
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error?.message ?? `Request failed (${response.status}).`);
  return payload;
}

function connectEvents() {
  const stream = new EventSource('/api/events');
  stream.addEventListener('ready', () => {
    state.connected = true;
    renderRuntimeStatus();
  });
  stream.addEventListener('task-updated', (event) => {
    const task = JSON.parse(event.data);
    upsertTask(task);
    render();
  });
  stream.addEventListener('domain-event', (event) => {
    const domainEvent = JSON.parse(event.data);
    if (domainEvent.type === 'task.memory.candidate') refreshMemory();
    if (domainEvent.type === 'task.proof.completed') refreshSecurity();
  });
  stream.onerror = () => {
    state.connected = false;
    renderRuntimeStatus();
  };
}

function render() {
  if (!state.data) return;
  const route = getRoute();
  const page = renderPage(route);
  app.innerHTML = `${state.loading ? '<div class="loading-line"></div>' : ''}${renderShell(page, route)}${renderModal()}`;
  renderRuntimeStatus();
  requestAnimationFrame(() => {
    const log = document.querySelector('.log-stream');
    if (log) log.scrollTop = log.scrollHeight;
  });
}

function renderShell(page, route) {
  const active = route.parts[0] || 'home';
  const attentionCount = state.data.tasks.filter((task) => ['awaiting_approval', 'failed', 'interrupted'].includes(task.status)).length;
  const runtime = activeRuntime();
  return `
    <div class="mobile-overlay" data-action="close-nav"></div>
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#/home" aria-label="DeepSeek Harness One 首页">
          <div class="brand-mark" aria-hidden="true"><span></span></div>
          <div class="brand-copy">
            <div class="brand-name">DeepSeek Harness One</div>
            <div class="brand-subtitle">Agent Work System</div>
          </div>
        </a>
        <div class="nav-section-label">工作</div>
        <nav class="nav" aria-label="主导航">
          ${NAV_ITEMS.slice(0, 4).map(([id, label, icon]) => navLink(id, label, icon, active, id === 'tasks' && attentionCount ? attentionCount : null)).join('')}
        </nav>
        <div class="nav-section-label">系统</div>
        <nav class="nav" aria-label="系统导航">
          ${NAV_ITEMS.slice(4).map(([id, label, icon]) => navLink(id, label, icon, active)).join('')}
        </nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-runtime">
          <div class="runtime-line"><span class="status-dot ${runtime.id === 'demo' ? 'demo' : ''}"></span><span class="runtime-label">${escapeHtml(runtime.label)}</span></div>
          <div class="runtime-detail">${escapeHtml(runtime.id === 'demo' ? '演示运行时；数据不会发送到模型。' : `Profile · ${runtime.profile ?? 'headless'}`)}</div>
        </div>
      </aside>
      <section class="workspace">
        <header class="topbar">
          <button class="btn btn-ghost icon-button mobile-menu" data-action="open-nav" aria-label="打开导航">${icon('menu')}</button>
          <div class="breadcrumb">${renderBreadcrumb(route)}</div>
          <div class="topbar-spacer"></div>
          <div class="topbar-actions">
            <button class="btn btn-ghost icon-button" data-action="toggle-theme" aria-label="切换主题">${icon('sun')}</button>
            <button class="btn btn-primary" data-action="open-task">${icon('plus')}新任务</button>
          </div>
        </header>
        <main class="content page-enter">${page}</main>
      </section>
    </div>
  `;
}

function renderPage(route) {
  switch (route.parts[0]) {
    case 'tasks':
      return route.parts[1] ? renderTaskDetail(route.parts[1]) : renderTasksPage();
    case 'memory': return renderMemoryPage();
    case 'extensions': return renderExtensionsPage();
    case 'security': return renderSecurityPage();
    case 'settings': return renderSettingsPage();
    case 'workspaces': return renderWorkspacePage(route.parts[1]);
    default: return renderHomePage();
  }
}

function renderHomePage() {
  const tasks = state.data.tasks;
  const today = new Date().toDateString();
  const activeCount = tasks.filter((task) => ['queued', 'running', 'paused', 'verifying'].includes(task.status)).length;
  const attentionCount = tasks.filter((task) => ['awaiting_approval', 'failed', 'interrupted'].includes(task.status)).length;
  const completedToday = tasks.filter((task) => task.status === 'completed' && new Date(task.completedAt).toDateString() === today).length;
  const memoryCount = ['hot', 'documents', 'spaces'].reduce((sum, key) => sum + state.data.memory[key].length, 0);
  const recent = tasks.slice(0, 7);

  return `
    <div class="page-header">
      <div>
        <p class="eyebrow">Local-first Agent</p>
        <h1>${greeting()}${state.data.settings.displayName ? `，${escapeHtml(state.data.settings.displayName)}` : ''}</h1>
        <p class="page-description">告诉它你真正想完成的结果。One 会组织计划、选择执行层级、持续工作，并在交付前独立验证。</p>
      </div>
    </div>

    <form class="hero-composer" data-form="quick-task">
      <div class="composer-label">今天想完成什么？</div>
      <textarea class="composer-input" name="goal" required minlength="3" placeholder="例如：阅读这个仓库，完成架构梳理，修复主要问题，并用测试证明结果。"></textarea>
      <div class="composer-footer">
        <select class="select-compact" name="workspaceId" aria-label="工作区">${workspaceOptions()}</select>
        <select class="select-compact" name="mode" aria-label="执行模式">
          <option value="auto">自动模式</option><option value="fast">快速模式</option><option value="deep">深度模式</option>
        </select>
        <button class="btn btn-primary" type="submit">开始工作 ${icon('arrow')}</button>
      </div>
    </form>

    <div class="section-heading"><h2>今天</h2><span class="section-meta">实时状态</span></div>
    <div class="metric-grid">
      ${metric('正在运行', activeCount, '队列、执行与验收')}
      ${metric('需要你处理', attentionCount, attentionCount ? '批准或检查失败项' : '目前无需介入')}
      ${metric('今天完成', completedToday, '经过独立验收')}
      ${metric('已批准记忆', memoryCount, '跨任务持续积累')}
    </div>

    <div class="split-grid">
      <section>
        <div class="section-heading"><h2>最近任务</h2><a class="btn btn-ghost btn-small" href="#/tasks">查看全部</a></div>
        <div class="card"><div class="card-body">${recent.length ? renderTaskList(recent) : emptyState('spark', '还没有任务。上面的输入框就是最轻的开始。')}</div></div>
      </section>
      <section>
        <div class="section-heading"><h2>工作区</h2><button class="btn btn-ghost btn-small" data-action="open-workspace">${icon('plus')}添加</button></div>
        <div class="card"><div class="card-body">${renderWorkspaceList(state.data.workspaces.slice(0, 6))}</div></div>
      </section>
    </div>
  `;
}

function renderTasksPage() {
  const filters = ['all', 'running', 'awaiting_approval', 'completed', 'failed'];
  const query = state.search.trim().toLowerCase();
  const tasks = state.data.tasks.filter((task) => {
    const statusMatches = state.taskFilter === 'all'
      || (state.taskFilter === 'running' && ['queued', 'running', 'paused', 'verifying'].includes(task.status))
      || task.status === state.taskFilter;
    const queryMatches = !query || `${task.title} ${task.goal}`.toLowerCase().includes(query);
    return statusMatches && queryMatches;
  });
  return `
    ${pageHeader('任务', '每个任务都拥有可恢复计划、执行记录、成果和验收证据。', '<button class="btn btn-primary" data-action="open-task">新任务</button>')}
    <div class="filter-bar">
      ${filters.map((filter) => `<button class="filter-chip ${state.taskFilter === filter ? 'active' : ''}" data-action="task-filter" data-value="${filter}">${filterLabel(filter)}</button>`).join('')}
      <input class="search-input" data-action="task-search" value="${escapeAttribute(state.search)}" placeholder="搜索任务…" />
    </div>
    <div class="card"><div class="card-body">${tasks.length ? renderTaskList(tasks) : emptyState('search', '没有匹配的任务。换一个筛选条件或创建新任务。')}</div></div>
  `;
}

function renderTaskDetail(taskId) {
  const task = state.data.tasks.find((item) => item.id === taskId);
  if (!task) return emptyState('search', '没有找到这个任务。');
  const workspace = state.data.workspaces.find((item) => item.id === task.workspaceId);
  const latestOutput = task.outputs.at(-1)?.content;
  const proof = task.proof;
  return `
    <div class="task-page-grid">
      <div>
        <section class="card task-hero">
          <div class="task-headline">
            <div class="task-headline-copy">
              <div class="status-pill ${task.status}"><span class="task-state ${task.status}"></span>${STATUS_LABELS[task.status] ?? task.status}</div>
              <h1>${escapeHtml(task.title)}</h1>
              <div class="task-goal">${escapeHtml(task.goal)}</div>
            </div>
          </div>
          <div class="progress-track"><div class="progress-bar" style="width:${Math.max(1, task.progress)}%"></div></div>
          <div class="task-actions">${renderTaskActions(task)}</div>
        </section>

        <div class="section-heading"><h2>结果</h2><span class="section-meta">${workspace ? escapeHtml(workspace.name) : '未知工作区'}</span></div>
        <section class="card output-panel">
          <div class="card-header"><div class="card-title">最终输出</div><span class="section-meta">${task.outputs.length} 条输出</span></div>
          <div class="card-body">${latestOutput ? `<div class="output-content">${escapeHtml(latestOutput)}</div>` : emptyState('spark', task.status === 'running' ? 'Agent 正在工作，结果将在这里出现。' : '这个任务尚未生成最终结果。')}</div>
        </section>

        <div class="section-heading"><h2>成果</h2><span class="section-meta">${task.artifacts.length} 个</span></div>
        ${task.artifacts.length ? `<div class="artifact-grid">${task.artifacts.map(renderArtifact).join('')}</div>` : `<div class="card">${emptyState('file', '可检查的文档、网页、图片和报告会集中出现在这里。')}</div>`}

        <div class="section-heading"><h2>执行记录</h2><span class="section-meta">开发者详情</span></div>
        <section class="card">
          <div class="card-header"><div class="card-title">事件流</div><span class="section-meta">${task.logs.length} 条</span></div>
          <div class="card-body">${task.logs.length ? `<div class="log-stream">${task.logs.map(renderLog).join('')}</div>` : emptyState('terminal', '运行日志将在任务启动后出现。')}</div>
        </section>
      </div>

      <aside>
        <section class="card">
          <div class="card-header"><div class="card-title">计划</div><span class="section-meta">${task.plan.filter((phase) => phase.status === 'completed').length}/${task.plan.length}</span></div>
          <div class="card-body"><div class="timeline">${task.plan.map((phase, index) => renderPhase(phase, index)).join('')}</div></div>
        </section>

        <div class="section-heading"><h2>执行策略</h2></div>
        <section class="card"><div class="card-body">${renderRoute(task)}</div></section>

        <div class="section-heading"><h2>独立验收</h2></div>
        <section class="card"><div class="card-body">${proof ? renderProof(proof) : emptyState('check', task.status === 'verifying' ? '独立验证器正在检查交付。' : '任务完成后才会生成验收证据。')}</div></section>
      </aside>
    </div>
  `;
}

function renderMemoryPage() {
  const memory = state.data.memory;
  const approved = [...memory.hot, ...memory.documents, ...memory.spaces];
  return `
    ${pageHeader('记忆', 'One 只把稳定、未来仍有价值的信息写入长期记忆，并始终让你看见和控制。', '<button class="btn btn-primary" data-action="open-memory">添加记忆</button>')}
    ${memory.candidates.length ? `
      <div class="section-heading"><h2>等待你确认</h2><span class="section-meta">不会自动写入</span></div>
      <div class="memory-grid">${memory.candidates.map((item) => renderMemoryCard(item, true)).join('')}</div>
    ` : ''}
    <div class="section-heading"><h2>已批准记忆</h2><span class="section-meta">${approved.length} 条</span></div>
    ${approved.length ? `<div class="memory-grid">${approved.map((item) => renderMemoryCard(item, false)).join('')}</div>` : `<div class="card">${emptyState('memory', '还没有长期记忆。完成任务后，One 会提出少量候选供你确认。')}</div>`}
  `;
}

function renderExtensionsPage() {
  const categories = ['all', ...new Set(state.data.extensions.map((item) => item.category))];
  const extensions = state.data.extensions.filter((item) => state.extensionFilter === 'all' || item.category === state.extensionFilter);
  return `
    ${pageHeader('扩展', '经过筛选的能力包。默认产品保持克制，需要时再增加专业能力。')}
    <div class="filter-bar">${categories.map((category) => `<button class="filter-chip ${state.extensionFilter === category ? 'active' : ''}" data-action="extension-filter" data-value="${category}">${categoryLabel(category)}</button>`).join('')}</div>
    <div class="extension-grid">${extensions.map(renderExtension).join('')}</div>
  `;
}

function renderSecurityPage() {
  const security = state.data.security;
  const known = security.verdict !== 'unknown';
  const title = !known ? '尚未运行安全检查' : security.verdict === 'good' ? '本地环境状态良好' : '发现需要检查的项目';
  const description = !known ? '扫描只读取配置和元数据，不会上传秘密，也不会执行被审计插件。' : `覆盖范围：${security.coverage} · ${formatDate(security.generatedAt)}`;
  return `
    ${pageHeader('安全', '运行时策略与本地环境检查被收敛为一个清楚、可解释的安全状态。')}
    <section class="card security-hero">
      <div class="security-orb ${security.verdict}">${icon('shield')}</div>
      <div class="security-copy"><h2>${title}</h2><p>${escapeHtml(description)}</p></div>
      <button class="btn btn-primary" data-action="scan-security">${icon('scan')}运行检查</button>
    </section>
    <div class="metric-grid" style="margin-top:12px">
      ${metric('严重', security.summary.critical, '需要立即处理')}
      ${metric('高风险', security.summary.high, '建议在继续前处理')}
      ${metric('中风险', security.summary.medium, '检查权限与来源')}
      ${metric('低风险', security.summary.low, '信息与改进建议')}
    </div>
    <div class="section-heading"><h2>检查结果</h2><span class="section-meta">只显示脱敏证据</span></div>
    <div class="finding-list">${security.findings.length ? security.findings.map(renderFinding).join('') : `<div class="card">${emptyState('shield', known ? '没有发现需要展示的本地风险。' : '运行一次检查后，结果会出现在这里。')}</div>`}</div>
  `;
}

function renderSettingsPage() {
  const settings = state.data.settings;
  return `
    ${pageHeader('设置', '默认值服务于清晰、安全和低干扰。底层技术细节只在需要时出现。')}
    <div class="settings-grid">
      ${settingInput('displayName', '称呼', '只用于本地首页问候，不会发送给外部服务。', settings.displayName, '例如：Jack')}
      ${settingSelect('defaultMode', '默认执行模式', '自动模式让强模型负责规划与验收，常规执行优先控制成本。', settings.defaultMode, [['fast','快速'],['auto','自动'],['deep','深度']])}
      ${settingToggle('autoRunTasks', '创建后自动运行', '低风险任务创建后直接进入队列；高风险任务仍然需要明确批准。', settings.autoRunTasks)}
      ${settingToggle('proofStrict', '严格交付验收', '要求最终输出、完整计划和至少一个可检查成果全部通过。', settings.proofStrict)}
      ${settingToggle('memorySuggestions', '生成记忆候选', '完成任务后提出候选，但未经你确认不会写入长期记忆。', settings.memorySuggestions)}
      ${settingToggle('guardrails', '任务风险识别', '检测高影响意图，并在执行前要求明确批准。', settings.guardrails)}
      ${settingToggle('developerDetails', '显示开发者详情', '展示更完整的模型路由、事件流与诊断信息。', settings.developerDetails)}
      ${settingSelect('theme', '外观', '跟随系统，也可以固定使用浅色或深色界面。', settings.theme, [['system','跟随系统'],['light','浅色'],['dark','深色']])}
    </div>
  `;
}

function renderWorkspacePage(workspaceId) {
  const workspace = state.data.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return emptyState('folder', '没有找到这个工作区。');
  const tasks = state.data.tasks.filter((task) => task.workspaceId === workspaceId);
  return `
    ${pageHeader(workspace.name, workspace.path, '<button class="btn btn-primary" data-action="open-task" data-workspace="' + escapeAttribute(workspace.id) + '">在这里新建任务</button>')}
    <div class="metric-grid">
      ${metric('全部任务', tasks.length, '此工作区的历史')}
      ${metric('正在运行', tasks.filter((task) => ['running','queued','verifying'].includes(task.status)).length, '实时执行')}
      ${metric('已完成', tasks.filter((task) => task.status === 'completed').length, '经过验收')}
      ${metric('需要处理', tasks.filter((task) => ['failed','awaiting_approval'].includes(task.status)).length, '批准或修复')}
    </div>
    <div class="section-heading"><h2>任务</h2></div>
    <div class="card"><div class="card-body">${tasks.length ? renderTaskList(tasks) : emptyState('folder', '这个工作区还没有任务。')}</div></div>
  `;
}

function renderModal() {
  if (!state.modal) return '';
  if (state.modal === 'task') return taskModal();
  if (state.modal === 'workspace') return workspaceModal();
  if (state.modal === 'memory') return memoryModal();
  if (state.modal === 'extension-plan') return extensionPlanModal();
  return '';
}

function taskModal() {
  const selectedWorkspace = state.modalData?.workspaceId ?? 'ws_demo';
  return modalShell('创建任务', '从结果出发。计划、路由、执行与验收会自动组织。', `
    <form data-form="task" id="task-form">
      <div class="field"><label for="task-title">标题（可选）</label><input class="input" id="task-title" name="title" placeholder="系统会自动生成" /></div>
      <div class="field"><label for="task-goal">希望完成的结果</label><textarea class="textarea" id="task-goal" name="goal" required minlength="3" autofocus placeholder="描述结果、约束和重要背景，而不是只给一个动作。"></textarea></div>
      <div class="field"><label for="task-workspace">工作区</label><select class="select" id="task-workspace" name="workspaceId">${workspaceOptions(selectedWorkspace)}</select></div>
      <div class="field">
        <label>执行模式</label>
        <div class="mode-picker">
          ${modeOption('fast', '快速', '适合明确、低风险的小任务')}
          ${modeOption('auto', '自动', '默认；按阶段自动选择', true)}
          ${modeOption('deep', '深度', '复杂架构和关键决策')}
        </div>
      </div>
    </form>
  `, '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit" form="task-form">创建并运行</button>');
}

function workspaceModal() {
  return modalShell('添加工作区', 'One 只会在你明确选择的本地目录中工作。', `
    <form data-form="workspace" id="workspace-form">
      <div class="field"><label for="workspace-name">名称</label><input class="input" id="workspace-name" name="name" placeholder="例如：Foggy" /></div>
      <div class="field"><label for="workspace-path">本地目录绝对路径</label><input class="input" id="workspace-path" name="directory" required placeholder="/Users/jack/Projects/Foggy" /><div class="field-hint">浏览器不能直接读取任意文件夹，因此请粘贴路径。服务端会验证它是否存在。</div></div>
    </form>
  `, '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit" form="workspace-form">添加工作区</button>');
}

function memoryModal() {
  return modalShell('添加记忆', '只保存稳定、自包含、未来仍有价值的信息。不要写入密钥或原始敏感日志。', `
    <form data-form="memory" id="memory-form">
      <div class="field"><label for="memory-text">内容</label><textarea class="textarea" id="memory-text" name="text" required placeholder="例如：这个项目的所有移动端视觉默认使用 3:4 竖屏。"></textarea></div>
      <div class="field"><label for="memory-kind">层级</label><select class="select" id="memory-kind" name="kind"><option value="hot">运行时热记忆</option><option value="documents">项目档案摘要</option><option value="spaces">长期记忆体</option></select></div>
      <div class="field"><label for="memory-workspace">作用范围</label><select class="select" id="memory-workspace" name="workspaceId"><option value="">全局</option>${workspaceOptions()}</select></div>
    </form>
  `, '<button class="btn" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit" form="memory-form">保存记忆</button>');
}

function extensionPlanModal() {
  const extension = state.modalData?.extension;
  const plan = state.modalData?.plan;
  return modalShell(extension?.name ?? '安装计划', '执行前先看清来源、权限和命令。', `
    <div class="permission-list">${(extension?.permissions ?? []).map((permission) => `<span class="permission">${escapeHtml(permission)}</span>`).join('')}</div>
    ${(plan?.commands ?? []).map((command) => `<div class="command-box">${escapeHtml(command)}<button class="command-copy" data-action="copy" data-copy="${escapeAttribute(command)}" aria-label="复制">${icon('copy')}</button></div>`).join('') || '<p class="page-description">此扩展没有自动安装命令，请参考项目文档。</p>'}
  `, '<button class="btn btn-primary" data-action="close-modal">完成</button>');
}

async function handleClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  if (event.target.closest('[data-modal-body]') && target.classList.contains('modal-backdrop')) return;
  const action = target.dataset.action;
  if (action === 'open-nav') document.body.classList.add('nav-open');
  else if (action === 'close-nav') document.body.classList.remove('nav-open');
  else if (action === 'open-task') openModal('task', { workspaceId: target.dataset.workspace });
  else if (action === 'open-workspace') openModal('workspace');
  else if (action === 'open-memory') openModal('memory');
  else if (action === 'close-modal') closeModal();
  else if (action === 'toggle-theme') await toggleTheme();
  else if (action === 'task-filter') { state.taskFilter = target.dataset.value; render(); }
  else if (action === 'extension-filter') { state.extensionFilter = target.dataset.value; render(); }
  else if (action === 'task-open') location.hash = `#/tasks/${target.dataset.id}`;
  else if (action === 'workspace-open') location.hash = `#/workspaces/${target.dataset.id}`;
  else if (action === 'task-action') await performTaskAction(target.dataset.id, target.dataset.value);
  else if (action === 'memory-approve') await memoryCandidate(target.dataset.id, 'approve');
  else if (action === 'memory-reject') await memoryCandidate(target.dataset.id, 'reject');
  else if (action === 'memory-delete') await deleteMemory(target.dataset.id);
  else if (action === 'extension-plan') await showExtensionPlan(target.dataset.id);
  else if (action === 'scan-security') await scanSecurity();
  else if (action === 'copy') await copyText(target.dataset.copy ?? '');
  else if (action === 'reload') location.reload();
}


function handleKeydown(event) {
  if (event.key === 'Escape') {
    if (state.modal) closeModal();
    else document.body.classList.remove('nav-open');
    return;
  }
  if (!['Enter', ' '].includes(event.key)) return;
  const target = event.target.closest('[data-action="task-open"], [data-action="workspace-open"]');
  if (!target) return;
  event.preventDefault();
  target.click();
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  try {
    setLoading(true);
    if (form.dataset.form === 'quick-task' || form.dataset.form === 'task') {
      const payload = { ...data, autoRun: true };
      const response = await api('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      upsertTask(response.task);
      closeModal(false);
      form.reset();
      location.hash = `#/tasks/${response.task.id}`;
      toast(response.task.status === 'awaiting_approval' ? '任务已创建，需要你确认高影响操作。' : '任务已进入执行队列。', 'success');
    } else if (form.dataset.form === 'workspace') {
      const response = await api('/api/workspaces', { method: 'POST', body: JSON.stringify(data) });
      state.data.workspaces.unshift(response.workspace);
      closeModal();
      toast('工作区已添加。', 'success');
    } else if (form.dataset.form === 'memory') {
      const response = await api('/api/memory', { method: 'POST', body: JSON.stringify({ ...data, workspaceId: data.workspaceId || null }) });
      state.data.memory.hot.unshift(response.memory);
      closeModal();
      toast('记忆已保存。', 'success');
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

async function handleChange(event) {
  const setting = event.target.dataset.setting;
  if (!setting) return;
  const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
  try {
    const response = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ [setting]: value }) });
    state.data.settings = response.settings;
    if (setting === 'theme') applyTheme(value);
    toast('设置已保存。', 'success');
    render();
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function performTaskAction(id, action) {
  try {
    setLoading(true);
    const response = await api(`/api/tasks/${encodeURIComponent(id)}/actions`, { method: 'POST', body: JSON.stringify({ action }) });
    upsertTask(response.task);
    toast(action === 'approve' ? '已批准，任务进入队列。' : `任务操作：${action}`, 'success');
    render();
  } catch (error) {
    toast(error.message, 'error');
  } finally { setLoading(false); }
}

async function memoryCandidate(id, action) {
  try {
    setLoading(true);
    const response = await api(`/api/memory/candidates/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action }) });
    state.data.memory = response.memory;
    toast(action === 'approve' ? '候选已写入长期记忆。' : '候选已忽略。', 'success');
    render();
  } catch (error) { toast(error.message, 'error'); }
  finally { setLoading(false); }
}

async function deleteMemory(id) {
  if (!confirm('删除这条记忆？此操作不会影响历史任务。')) return;
  try {
    await api(`/api/memory/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await refreshMemory();
    toast('记忆已删除。', 'success');
  } catch (error) { toast(error.message, 'error'); }
}

async function showExtensionPlan(id) {
  try {
    const extension = state.data.extensions.find((item) => item.id === id);
    const response = await api(`/api/extensions/${encodeURIComponent(id)}`, { method: 'POST', body: JSON.stringify({ action: 'plan' }) });
    openModal('extension-plan', { extension, plan: response.plan });
  } catch (error) { toast(error.message, 'error'); }
}

async function scanSecurity() {
  try {
    setLoading(true);
    const response = await api('/api/security', { method: 'POST', body: '{}' });
    state.data.security = response.security;
    toast('本地安全检查已完成。', 'success');
    render();
  } catch (error) { toast(error.message, 'error'); }
  finally { setLoading(false); }
}

async function refreshMemory() {
  const response = await api('/api/memory');
  state.data.memory = response.memory;
  render();
}

async function refreshSecurity() {
  const response = await api('/api/security');
  state.data.security = response.security;
  render();
}

function renderTaskList(tasks) {
  return `<div class="task-list">${tasks.map((task) => `
    <article class="task-row" data-action="task-open" data-id="${escapeAttribute(task.id)}" tabindex="0">
      <span class="task-state ${task.status}"></span>
      <div class="task-main"><div class="task-title">${escapeHtml(task.title)}</div><div class="task-subtitle">${escapeHtml(task.goal)}</div></div>
      <div class="task-meta"><div class="task-status-label">${STATUS_LABELS[task.status] ?? task.status}</div><div class="task-time">${relativeTime(task.updatedAt)}</div></div>
    </article>`).join('')}</div>`;
}

function renderWorkspaceList(workspaces) {
  return `<div class="workspace-list">${workspaces.map((workspace) => `
    <article class="workspace-row" data-action="workspace-open" data-id="${escapeAttribute(workspace.id)}" tabindex="0">
      <div class="workspace-glyph">${icon('folder')}</div>
      <div class="workspace-copy"><div class="workspace-name">${escapeHtml(workspace.name)}</div><div class="workspace-path">${escapeHtml(workspace.path)}</div></div>
      ${icon('chevron')}
    </article>`).join('')}</div>`;
}

function renderTaskActions(task) {
  const buttons = [];
  if (task.status === 'awaiting_approval') buttons.push(actionButton(task.id, 'approve', '批准并运行', 'accent'));
  if (task.status === 'paused') buttons.push(actionButton(task.id, 'resume', '继续', 'primary'));
  if (['running', 'verifying'].includes(task.status)) buttons.push(actionButton(task.id, 'pause', '暂停'));
  if (['running', 'queued', 'paused', 'verifying'].includes(task.status)) buttons.push(actionButton(task.id, 'cancel', '取消', 'danger'));
  if (['failed', 'interrupted', 'cancelled'].includes(task.status)) buttons.push(actionButton(task.id, 'retry', '重新运行', 'primary'));
  if (task.status === 'completed') buttons.push('<button class="btn" data-action="open-task" data-workspace="' + escapeAttribute(task.workspaceId) + '">' + icon('repeat') + '新建后续任务</button>');
  return buttons.join('') || '<span class="section-meta">任务已进入只读历史</span>';
}

function actionButton(id, value, label, style = '') {
  return `<button class="btn ${style ? `btn-${style}` : ''}" data-action="task-action" data-id="${escapeAttribute(id)}" data-value="${value}">${label}</button>`;
}

function renderPhase(phase, index) {
  const symbol = phase.status === 'completed' ? '✓' : index + 1;
  return `<div class="phase ${phase.status}"><div class="phase-dot">${symbol}</div><div><div class="phase-title">${escapeHtml(phase.title)}</div><div class="phase-description">${escapeHtml(phase.description)}</div></div></div>`;
}

function renderRoute(task) {
  if (!task.route) return emptyState('route', '任务启动后，系统会选择执行层级。');
  return `
    <div class="check-list">
      ${routeRow('规划', task.route.planning.tier)}
      ${routeRow('执行', task.route.execution.tier)}
      ${routeRow('验收', task.route.review.tier)}
    </div>
    <p class="phase-description" style="margin-top:14px">${escapeHtml(task.route.reason)}</p>
    <div class="memory-tags"><span class="tag">${escapeHtml(task.route.mode)}</span><span class="tag">复杂度 ${task.route.complexityScore}/10</span></div>
  `;
}

function routeRow(label, tier) {
  return `<div class="check-row passed"><span class="check-mark">${tier === 'strong' ? '◆' : '◇'}</span><span>${label} · ${tier === 'strong' ? '强模型层' : '经济模型层'}</span></div>`;
}

function renderProof(proof) {
  return `
    <div class="proof-score"><div class="score-ring" style="--score:${proof.score}"><span>${proof.score}</span></div><div class="proof-copy"><strong>${proof.verdict === 'pass' ? '交付已验证' : '验收未通过'}</strong><span>${escapeHtml(proof.summary)}</span></div></div>
    <div class="check-list">${proof.checks.map((check) => `<div class="check-row ${check.passed ? 'passed' : 'failed'}"><span class="check-mark">${check.passed ? '✓' : '!'}</span><span>${escapeHtml(check.label)}${check.required ? '' : '（观察项）'}</span></div>`).join('')}</div>
  `;
}

function renderArtifact(artifact) {
  const href = !artifact.external ? `/api/artifacts/${artifact.path.split('/').map(encodeURIComponent).join('/')}` : null;
  const body = `<div class="artifact-kind">${escapeHtml(artifact.kind)}</div><div class="artifact-name">${escapeHtml(artifact.name)}</div><div class="artifact-meta">${formatBytes(artifact.size)} · ${artifact.external ? '工作区文件' : 'One Artifact'}</div>`;
  return href ? `<a class="artifact-card" href="${href}" target="_blank" rel="noreferrer">${body}</a>` : `<div class="artifact-card" title="${escapeAttribute(artifact.path)}">${body}</div>`;
}

function renderLog(log) {
  return `<div class="log-line ${log.level}"><span class="log-time">${formatTime(log.timestamp)}</span><span class="log-message">${escapeHtml(log.message)}</span></div>`;
}

function renderMemoryCard(item, candidate) {
  return `<article class="memory-card ${candidate ? 'candidate' : ''}">
    <div class="memory-type"><span>${candidate ? '候选' : memoryKindLabel(item)}</span><span>${candidate ? Math.round((item.confidence ?? 0) * 100) + '%' : relativeTime(item.updatedAt)}</span></div>
    <div class="memory-text">${escapeHtml(item.text)}</div>
    ${item.tags?.length ? `<div class="memory-tags">${item.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
    <div class="memory-actions">${candidate
      ? `<button class="btn btn-accent btn-small" data-action="memory-approve" data-id="${item.id}">记住</button><button class="btn btn-ghost btn-small" data-action="memory-reject" data-id="${item.id}">忽略</button>`
      : `<button class="btn btn-ghost btn-small btn-danger" data-action="memory-delete" data-id="${item.id}">删除</button>`}</div>
  </article>`;
}

function renderExtension(extension) {
  return `<article class="extension-card ${extension.tier}">
    <div class="extension-top"><div><div class="extension-category">${escapeHtml(extension.category)} · ${escapeHtml(extension.tier)}</div><div class="extension-name">${escapeHtml(extension.name)}</div></div><span class="extension-status ${extension.status}">${escapeHtml(extension.status)}</span></div>
    <p class="extension-description">${escapeHtml(extension.description)}</p>
    <div class="permission-list">${extension.permissions.slice(0, 4).map((permission) => `<span class="permission">${escapeHtml(permission)}</span>`).join('')}</div>
    <div class="extension-footer"><button class="btn btn-small" data-action="extension-plan" data-id="${extension.id}">${extension.status === 'installed' ? '查看配置' : '安装方式'}</button><span class="license">${escapeHtml(extension.license)}</span></div>
  </article>`;
}

function renderFinding(item) {
  return `<div class="finding-row"><div class="severity ${item.severity}">${escapeHtml(item.severity)}</div><div class="finding-message"><strong>${escapeHtml(item.code)}</strong><br>${escapeHtml(item.message)}</div></div>`;
}

function navLink(id, label, iconName, active, count) {
  return `<a class="nav-link ${active === id ? 'active' : ''}" href="#/${id}"><span class="nav-icon">${icon(iconName)}</span><span>${label}</span>${count ? `<span class="nav-count">${count}</span>` : ''}</a>`;
}

function pageHeader(title, description, action = '') {
  return `<div class="page-header"><div><p class="eyebrow">DeepSeek Harness One</p><h1>${escapeHtml(title)}</h1><p class="page-description">${escapeHtml(description)}</p></div>${action}</div>`;
}

function metric(label, value, foot) {
  return `<div class="metric-card"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`;
}

function settingInput(key, title, description, value, placeholder = '') {
  return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><span>${description}</span></div><input class="setting-input" data-setting="${key}" value="${escapeAttribute(value ?? '')}" placeholder="${escapeAttribute(placeholder)}" maxlength="80">` + '</div>';
}

function settingToggle(key, title, description, checked) {
  return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><span>${description}</span></div><label class="switch"><input type="checkbox" data-setting="${key}" ${checked ? 'checked' : ''}><span></span></label></div>`;
}

function settingSelect(key, title, description, value, options) {
  return `<div class="setting-row"><div class="setting-copy"><strong>${title}</strong><span>${description}</span></div><select class="select-compact" data-setting="${key}">${options.map(([id,label]) => `<option value="${id}" ${value === id ? 'selected' : ''}>${label}</option>`).join('')}</select></div>`;
}

function modalShell(title, description, body, footer) {
  return `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-label="${escapeAttribute(title)}" data-modal-body><header class="modal-header"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><button class="btn btn-ghost icon-button" data-action="close-modal" aria-label="关闭">${icon('x')}</button></header><div class="modal-body">${body}</div><footer class="modal-footer">${footer}</footer></section></div>`;
}

function modeOption(value, title, description, checked = false) {
  return `<label class="mode-option"><input type="radio" name="mode" value="${value}" ${checked ? 'checked' : ''}><strong>${title}</strong><span>${description}</span></label>`;
}

function workspaceOptions(selected = '') {
  return state.data.workspaces.map((workspace) => `<option value="${escapeAttribute(workspace.id)}" ${workspace.id === selected ? 'selected' : ''}>${escapeHtml(workspace.name)}</option>`).join('');
}

function emptyState(iconName, text) {
  return `<div class="empty-state"><div><div class="empty-state-icon">${icon(iconName)}</div><p>${escapeHtml(text)}</p></div></div>`;
}

function renderBreadcrumb(route) {
  if (route.parts[0] === 'tasks' && route.parts[1]) {
    const task = state.data.tasks.find((item) => item.id === route.parts[1]);
    return `<a href="#/tasks">任务</a> / <strong>${escapeHtml(task?.title ?? '详情')}</strong>`;
  }
  if (route.parts[0] === 'workspaces' && route.parts[1]) {
    const workspace = state.data.workspaces.find((item) => item.id === route.parts[1]);
    return `工作区 / <strong>${escapeHtml(workspace?.name ?? '详情')}</strong>`;
  }
  const item = NAV_ITEMS.find(([id]) => id === (route.parts[0] || 'home'));
  return `<strong>${item?.[1] ?? '首页'}</strong>`;
}

function renderRuntimeStatus() {
  const element = document.querySelector('.sidebar-runtime .runtime-line');
  if (!element || !state.data) return;
  const runtime = activeRuntime();
  element.title = state.connected ? '实时事件已连接' : '正在重新连接实时事件';
  element.querySelector('.status-dot')?.classList.toggle('offline', !state.connected);
  const label = element.querySelector('.runtime-label');
  if (label) label.textContent = runtime.label;
}

function activeRuntime() {
  const runtimeId = state.data.runtime.active;
  return state.data.runtime.runtimes.find((runtime) => runtime.id === runtimeId) ?? state.data.runtime.runtimes[0];
}

function openModal(name, data = null) {
  state.modal = name;
  state.modalData = data;
  render();
  requestAnimationFrame(() => document.querySelector('[autofocus]')?.focus());
}

function closeModal(shouldRender = true) {
  state.modal = null;
  state.modalData = null;
  if (shouldRender) render();
}

function setLoading(value) {
  state.loading = value;
  render();
}

async function toggleTheme() {
  const current = document.documentElement.dataset.theme || effectiveSystemTheme();
  const next = current === 'dark' ? 'light' : 'dark';
  const response = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ theme: next }) });
  state.data.settings = response.settings;
  applyTheme(next);
  render();
}

function applyTheme(theme) {
  const resolved = theme === 'system' ? effectiveSystemTheme() : theme;
  document.documentElement.dataset.theme = resolved;
}

function effectiveSystemTheme() {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function upsertTask(task) {
  const index = state.data.tasks.findIndex((item) => item.id === task.id);
  if (index >= 0) state.data.tasks[index] = task;
  else state.data.tasks.unshift(task);
  state.data.tasks.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

function getRoute() {
  const clean = location.hash.replace(/^#\/?/, '');
  return { parts: clean.split('/').filter(Boolean) };
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

function relativeTime(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.round((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return '刚刚';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return days < 14 ? `${days} 天前` : formatDate(timestamp);
}

function formatDate(timestamp) {
  if (!timestamp) return '尚未运行';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp));
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp));
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '大小未知';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

function filterLabel(filter) {
  return { all: '全部', running: '进行中', awaiting_approval: '待批准', completed: '已完成', failed: '失败' }[filter] ?? filter;
}

function categoryLabel(category) {
  return { all: '全部', core: '核心', memory: '记忆', execution: '执行', quality: '质量', security: '安全', ecosystem: '生态', capability: '能力', team: '团队', enterprise: '企业', studio: '创作' }[category] ?? category;
}

function memoryKindLabel(item) {
  if (state.data.memory.documents.some((entry) => entry.id === item.id)) return '项目档案';
  if (state.data.memory.spaces.some((entry) => entry.id === item.id)) return '长期记忆体';
  return '运行时记忆';
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制到剪贴板。', 'success');
  } catch { toast('复制失败，请手动选择文本。', 'error'); }
}

function toast(message, type = '') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  toastRegion.append(element);
  setTimeout(() => element.remove(), 4200);
}

function renderFatal(error) {
  return `<div class="boot-screen"><div class="brand-mark brand-mark--large"><span></span></div><h2>无法启动控制台</h2><p>${escapeHtml(error.message)}</p><button class="btn" data-action="reload">重新加载</button></div>`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function escapeAttribute(value) { return escapeHtml(value); }

function icon(name) {
  const paths = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/>',
    tasks: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    memory: '<path d="M9 4a4 4 0 0 0-4 4v8a4 4 0 0 0 4 4"/><path d="M15 4a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4M9 4h6v16H9M9 9h6M9 15h6"/>',
    blocks: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 14v6M14 17h6"/>',
    shield: '<path d="M12 3 20 6v6c0 5-3.3 8-8 9-4.7-1-8-4-8-9V6l8-3Z"/><path d="m9 12 2 2 4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14M14 7l5 5-5 5"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    folder: '<path d="M3 6h7l2 2h9v11H3z"/>', chevron: '<path d="m9 18 6-6-6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', spark: '<path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
    file: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/>', terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', route: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h4a4 4 0 0 1 4 4v6M10 18H8a4 4 0 0 1-4-4v-2"/>',
    repeat: '<path d="M20 7h-7a7 7 0 1 0 6.5 9.5"/><path d="m16 3 4 4-4 4"/>',
    scan: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M8 12h8"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>', copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.spark}</svg>`;
}
