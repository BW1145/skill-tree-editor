(function () {
  'use strict';
  const M = window.SkillTree, $ = id => document.getElementById(id);
  const STORAGE = 'skill-tree-editor.generic.v1:' + location.pathname;
  const TYPE = { passive: '被动', active: '主动', toggle: '开关' };
  const ICON = { passive: '◇', active: '↗', toggle: '⇄' };
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let data = M.project(window.SKILL_SEED), loadError = '';
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved) {
      data = M.parse(saved);
      if (JSON.parse(saved).version < M.VERSION && !localStorage.getItem(`${STORAGE}.backup-before-v${M.VERSION}`)) {
        try { localStorage.setItem(`${STORAGE}.backup-before-v${M.VERSION}`, saved); } catch { /* Existing draft remains untouched until the next edit. */ }
      }
    }
  }
  catch (error) { loadError = `本地草稿读取失败：${error.message}。可通过“导入”载入保存的项目。`; }
  let selected = data.catalog.nodes[0]?.id || null;
  let history = [], future = [], mergeKey = null, mergeTime = 0;
  let view = { x: 0, y: 0, scale: 1 }, gesture = null, connection = null, toastTimer;
  const nodeById = id => data.catalog.nodes.find(n => n.id === id);
  const branchById = id => data.catalog.branches.find(b => b.id === id);
  const selectedNode = () => nodeById(selected);
  const effectsUI = window.createSkillEffectsUI({ getData: () => data, selectedNode, commit, showModal, closeModal, toast, esc, uid });
  function toast(message, error = false) {
    if (error && $('modal').open) { $('modal-feedback').textContent = message; $('modal-feedback').hidden = false; }
    clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 3200);
  }
  function persist() {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(data));
      $('save-status').textContent = '草稿已存于此浏览器';
      $('save-status').title = '保存项目可下载文件，供备份或换电脑继续编辑。';
    } catch (error) {
      $('save-status').textContent = '请使用“保存项目”下载备份';
      toast(`自动保存未成功：${error.message}`, true);
    }
  }
  function remember(before, key) {
    if (!key || key !== mergeKey || Date.now() - mergeTime > 1300) history.push(before);
    if (history.length > 80) history.shift();
    mergeKey = key || null; mergeTime = Date.now(); future = [];
  }
  function commit(edit, options = {}) {
    const next = M.clone(data);
    try {
      edit(next);
      const normalized = M.project(next.catalog, next.layout.positions);
      const clean = { ...next, ...normalized, layout: { ...next.layout, ...normalized.layout } };
      if (JSON.stringify(clean) === JSON.stringify(data)) return true;
      remember(M.clone(data), options.key); data = clean;
      if (!nodeById(selected)) selected = data.catalog.nodes[0]?.id || null;
      persist(); render(options.inspector !== false);
      return true;
    } catch (error) { toast(error.message, true); return false; }
  }
  function undo(redo = false) {
    const source = redo ? future : history, destination = redo ? history : future;
    if (!source.length) return;
    destination.push(M.clone(data)); data = source.pop(); mergeKey = null;
    if (!nodeById(selected)) selected = data.catalog.nodes[0]?.id || null;
    cancelConnection(); persist(); render();
  }
  function render(refreshInspector = true) {
    if (document.activeElement !== $('project-title')) $('project-title').value = data.catalog.title;
    $('node-count').textContent = data.catalog.nodes.length;
    const edges = data.catalog.nodes.reduce((sum, n) => sum + n.requires.length, 0);
    $('edge-count').textContent = `${edges} 条连线`;
    $('undo').disabled = !history.length; $('redo').disabled = !future.length;
    $('selection-summary').textContent = selectedNode() ? `${selectedNode().name} · ${selectedNode().levels.length} 级` : '选择一个技能开始编辑';
    renderLibrary(); renderScene(); if (refreshInspector) renderInspector();
  }
  function renderLibrary() {
    const query = $('search').value.trim().toLocaleLowerCase();
    let count = 0;
    $('library-list').innerHTML = data.catalog.branches.map(branch => {
      const nodes = data.catalog.nodes.filter(n => n.branchId === branch.id && `${n.name} ${n.levels.map(l => l.effect).join(' ')}`.toLocaleLowerCase().includes(query));
      count += nodes.length;
      if (!nodes.length && query) return '';
      return `<section class="library-group"><div class="branch-heading" style="--branch:${branch.color}"><i class="dot"></i><button class="branch-title" data-edit-category="${branch.id}" title="编辑分类">${esc(branch.name)}</button><span class="branch-size">${nodes.length}</span></div>${nodes.map(n => `<button class="list-node ${n.id === selected ? 'selected' : ''}" data-select="${n.id}" aria-pressed="${n.id === selected}"><span class="list-icon">${ICON[n.type]}</span><span class="node-name">${esc(n.name)}</span><span class="list-rank">${n.levels.length}级</span></button>`).join('')}</section>`;
    }).join('');
    if (!count) $('library-list').innerHTML += `<p class="empty-list">${query ? '没有找到匹配的技能。' : '点击上方按钮，添加你的第一个技能。'}</p>`;
  }
  function renderScene() {
    $('canvas-empty').hidden = data.catalog.nodes.length > 0;
    $('nodes').innerHTML = data.catalog.nodes.map(n => {
      const p = data.layout.positions[n.id], branch = branchById(n.branchId);
      return `<article class="skill-node ${n.id === selected ? 'selected' : ''}" data-node="${n.id}" tabindex="0" aria-label="编辑${esc(n.name)}" style="left:${p.x}px;top:${p.y}px;--branch:${branch.color}">
        <button class="port port-in" data-port="in" data-id="${n.id}" title="连接前置技能" aria-label="为${esc(n.name)}连接前置技能"></button>
        <div class="node-meta"><span>${esc(branch.name)}</span><span>${ICON[n.type]} ${TYPE[n.type]}</span></div><h3>${esc(n.name)}</h3>
        <p class="node-description">${esc(n.levels[0].effect || '点击填写技能效果')}</p>
        <div class="node-foot"><span class="rank-bars">${n.levels.slice(0, 7).map(() => '<i></i>').join('')}</span><span>${n.levels.length} 级 / 首级 ${n.levels[0].cost} 点</span></div>
        <button class="port port-out" data-port="out" data-id="${n.id}" title="连接后续技能" aria-label="从${esc(n.name)}连接后续技能"></button></article>`;
    }).join('');
    drawEdges(); transform();
  }
  function drawEdges() {
    $('edges').innerHTML = `<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,1 L7,4 L0,7" fill="none" stroke="#8b9fb3" stroke-width="1.2"/></marker></defs>` + data.catalog.nodes.map(n => n.requires.map(r => {
      const a = data.layout.positions[r.id], b = data.layout.positions[n.id];
      const x1 = a.x + 230, y1 = a.y + 71, x2 = b.x, y2 = b.y + 71, offset = Math.max(55, Math.abs(x2 - x1) / 2);
      return `<path class="edge-path ${n.id === selected || r.id === selected ? 'highlight' : ''}" d="M${x1},${y1} C${x1 + offset},${y1} ${x2 - offset},${y2} ${x2},${y2}" marker-end="url(#arrow)"/><text class="edge-label" x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 9}" text-anchor="middle">${r.rank}级</text>`;
    }).join('')).join('');
  }
  function renderInspector() {
    const n = selectedNode();
    if (!n) { $('inspector').innerHTML = '<div class="inspector-empty"><strong>选择一个技能</strong>在这里填写效果、升级花费与前置条件。<br>所有内容都可以继续修改。</div>'; return; }
    const options = data.catalog.nodes.filter(other => other.id !== n.id && !n.requires.some(r => r.id === other.id));
    $('inspector').innerHTML = `<div class="inspector-heading"><h2>编辑技能</h2><button id="simulate-skill" class="quiet">试算效果</button></div><div class="inspector-body">
      <label class="field"><span>技能名称</span><input data-field="name" value="${esc(n.name)}" maxlength="120"></label>
      <div class="field-row"><label class="field"><span>分类</span><select data-field="branchId">${data.catalog.branches.map(b => `<option value="${b.id}" ${b.id === n.branchId ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></label>
      <label class="field"><span>使用方式</span><select data-field="type">${Object.entries(TYPE).map(([id, name]) => `<option value="${id}" ${n.type === id ? 'selected' : ''}>${name}</option>`).join('')}</select></label></div>
      <label class="field"><span>生效条件说明</span><textarea data-field="trigger" placeholder="什么时候生效？是否需要主动开启？">${esc(n.trigger)}</textarea><small>文字条件读取项目状态；试算时勾选是否满足。下方可设置附加变量条件。</small></label>
      <section class="form-section"><div class="section-heading"><h3>等级与效果</h3><button id="add-level">＋ 添加等级</button></div>
      <p class="field-hint" style="margin-bottom:15px">每级填写该等级的完整效果；花费表示升到这一级需要的技能点。</p>
      ${n.levels.map((level, i) => `<div class="level-item"><div class="level-heading"><strong>${i + 1} 级</strong><label for="cost-${i}">花费</label><input id="cost-${i}" type="number" min="0" step="1" value="${level.cost}" data-level="${i}" data-field="cost" aria-label="${i + 1}级花费"><span>点</span>${i === n.levels.length - 1 && i > 0 ? `<button data-remove-level="${i}" title="删除最后一级" aria-label="删除${i + 1}级">×</button>` : ''}</div><label class="field"><span>效果说明</span><textarea data-field="effect" data-level="${i}" aria-label="${i + 1}级效果" placeholder="写清这个等级能做到什么，以及适用范围。">${esc(level.effect)}</textarea></label>${effectsUI.renderLevel(level, i)}</div>`).join('')}</section>
      <section class="form-section"><div class="section-heading"><h3>前置技能</h3><span class="field-hint">全部满足后解锁</span></div>
      ${n.requires.length ? n.requires.map(r => { const parent = nodeById(r.id); return `<div class="requirement"><span title="${esc(parent.name)}">${esc(parent.name)}</span><select data-require-rank="${r.id}" aria-label="${esc(parent.name)}前置等级">${parent.levels.map((_, i) => `<option value="${i + 1}" ${i + 1 === r.rank ? 'selected' : ''}>${i + 1}级</option>`).join('')}</select><button data-remove-req="${r.id}" aria-label="移除前置${esc(parent.name)}">×</button></div>`; }).join('') : '<p class="field-hint">可以直接学习。选择前置技能后，会同步生成连线。</p>'}
      <div class="prereq-add"><select id="parent-select" aria-label="选择前置技能"><option value="">选择前置技能…</option>${options.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select><button id="add-prereq">添加</button></div></section>
      <section class="form-section"><label class="field"><span>设计备注</span><textarea data-field="notes" placeholder="记录待定参数、互斥规则或实现想法。">${esc(n.notes)}</textarea><small>备注留在技能目录中，已学技能摘要只提取效果和生效条件。</small></label></section>
      <div class="inspector-actions"><button id="add-child">＋ 后续技能</button><button id="duplicate">复制</button><button id="delete-node" class="quiet danger">删除</button></div><p class="id-note">固定标识：${n.id}</p></div>`;
  }
  function select(id, focus = false) {
    selected = id; mergeKey = null; render();
    $('inspector').scrollTop = 0;
    if (focus && nodeById(id)) centerNode(id);
  }
  function transform() {
    $('world').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.scale})`;
    $('zoom-value').value = `${Math.round(view.scale * 100)}%`;
    $('canvas').style.backgroundSize = `${20 * view.scale}px ${20 * view.scale}px`;
    $('canvas').style.backgroundPosition = `${view.x}px ${view.y}px`;
  }
  function fit() {
    if (!data.catalog.nodes.length || !$('canvas').clientWidth) return;
    const positions = Object.values(data.layout.positions), w = $('canvas').clientWidth, h = $('canvas').clientHeight;
    const minX = Math.min(...positions.map(p => p.x)), minY = Math.min(...positions.map(p => p.y));
    const width = Math.max(...positions.map(p => p.x)) + 230 - minX, height = Math.max(...positions.map(p => p.y)) + 142 - minY;
    view.scale = Math.max(.2, Math.min(1, (w - 80) / width, (h - 110) / height));
    view.x = (w - width * view.scale) / 2 - minX * view.scale;
    view.y = (h - height * view.scale) / 2 - minY * view.scale - 15; transform();
  }
  function centerNode(id) {
    const p = data.layout.positions[id];
    view.x = $('canvas').clientWidth / 2 - (p.x + 115) * view.scale;
    view.y = $('canvas').clientHeight / 2 - (p.y + 71) * view.scale; transform();
  }
  function zoom(factor, x = $('canvas').clientWidth / 2, y = $('canvas').clientHeight / 2) {
    const scale = Math.max(.2, Math.min(2, view.scale * factor)), ratio = scale / view.scale;
    view.x = x - (x - view.x) * ratio; view.y = y - (y - view.y) * ratio; view.scale = scale; transform();
  }
  function addSkill(parentId = null, duplicate = false) {
    const parent = nodeById(parentId), source = duplicate ? selectedNode() : null, id = uid('skill');
    const x = parent ? data.layout.positions[parentId].x + 310 : Math.round(($('canvas').clientWidth / 2 - view.x) / view.scale - 115);
    let y = parent ? data.layout.positions[parentId].y : Math.round(($('canvas').clientHeight / 2 - view.y) / view.scale - 71);
    while (Object.values(data.layout.positions).some(p => Math.abs(p.x - x) < 240 && Math.abs(p.y - y) < 150)) y += 175;
    const nextSelected = selected;
    selected = id;
    const ok = commit(d => {
      if (!d.catalog.branches.length) d.catalog.branches.push({ id: uid('branch'), name: '技能', color: '#3e7198' });
      const node = source ? { ...M.clone(source), id, name: `${source.name} 副本` } : {
        id, name: '新技能', branchId: parent?.branchId || nodeById(nextSelected)?.branchId || d.catalog.branches[0].id,
        type: 'passive', trigger: '', levels: [{ cost: 1, effect: '', effects: [] }], requires: parent ? [{ id: parentId, rank: 1 }] : [], notes: ''
      };
      d.catalog.nodes.push(node); d.layout.positions[id] = { x, y };
    });
    if (ok) { setPanel('inspector'); centerNode(id); $('inspector').scrollTop = 0; $('inspector').querySelector('[data-field="name"]')?.select(); }
    else selected = nextSelected;
  }
  function connect(parentId, childId) {
    const ok = commit(d => { d.catalog = M.addRequirement(d.catalog, parentId, childId); });
    if (ok) { cancelConnection(); toast('前置关系已连接'); }
  }
  function cancelConnection() { connection = null; $('connection-notice').hidden = true; }
  function portClick(port) {
    const id = port.dataset.id, side = port.dataset.port;
    if (connection && connection.side !== side) {
      connect(side === 'in' ? connection.id : id, side === 'in' ? id : connection.id); return;
    }
    connection = { id, side }; $('connection-notice').hidden = false;
    $('connection-notice').querySelector('span').textContent = side === 'out' ? `从“${nodeById(id).name}”连接：点击后续技能左侧圆点` : `为“${nodeById(id).name}”选择前置：点击前置技能右侧圆点`;
  }
  function setPanel(panel) {
    document.querySelector('.workspace').dataset.panel = panel;
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === panel));
  }
  function showModal(title, content) {
    $('modal-feedback').hidden = true;
    $('modal-title').textContent = title; $('modal-content').innerHTML = content;
    if (!$('modal').open) $('modal').showModal();
  }
  function closeModal() { $('modal').close(); }
  function saveFile(value, suffix) {
    const name = data.catalog.title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 70) || '技能树';
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${name}-${suffix}.json`; document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
    toast(suffix === '编辑项目' ? '已生成项目文件，请在浏览器下载中查看' : '已生成技能数据，可供角色卡构建使用');
  }
  function branchesModal() {
    showModal('管理分类', `<p class="field-hint" style="margin-bottom:18px">自由新增、改名、配色和排序。删除分类时，可将技能整批移到另一分类。</p>${data.catalog.branches.map((b, i) => `<div class="branch-editor" data-branch="${b.id}"><input type="color" data-branch-color="${b.id}" value="${b.color}" aria-label="${esc(b.name)}颜色"><input type="text" data-branch-name="${b.id}" value="${esc(b.name)}" aria-label="分类名称"><button data-move-branch="${b.id}" data-direction="-1" ${i === 0 ? 'disabled' : ''} aria-label="上移${esc(b.name)}">↑</button><button data-move-branch="${b.id}" data-direction="1" ${i === data.catalog.branches.length - 1 ? 'disabled' : ''} aria-label="下移${esc(b.name)}">↓</button><button data-delete-branch="${b.id}">删除</button></div>`).join('')}<button id="add-branch" class="primary-soft">＋ 新分类</button>`);
  }
  function addCategory() {
    const id = uid('branch');
    commit(d => { d.catalog.branches.push({ id, name: '新分类', color: '#677ba6' }); });
    branchesModal(); $('modal-content').querySelector(`[data-branch-name="${id}"]`).select();
  }
  function preview() {
    showModal('技能文字预览', `<p class="field-hint">以下内容来自当前编辑数据。每级效果独立呈现。</p>${data.catalog.nodes.map(n => `<article class="preview-node"><h3>${esc(n.name)}</h3><small>${esc(branchById(n.branchId).name)} / ${TYPE[n.type]} / 前置：${n.requires.length ? n.requires.map(r => `${esc(nodeById(r.id).name)} ${r.rank}级`).join('、') : '直接学习'}</small><p>${esc(n.trigger)}</p>${n.levels.map((l, i) => `<div class="preview-level"><strong>${i + 1}级 · ${l.cost}技能点</strong><p>${esc(l.effect || '待填写效果')}</p>${l.effects.map(e => `<p class="effect-summary">${esc(M.describeEffect(data.catalog, e))}</p>`).join('')}</div>`).join('')}</article>`).join('') || '<p>添加技能后即可查看预览。</p>'}`);
  }
  $('inspector').addEventListener('focusin', () => { mergeKey = null; });
  function editField(event) {
    const field = event.target.dataset.field, id = selected;
    if (!field) return;
    const element = event.target, isNumber = element.type === 'number', isSelect = element.tagName === 'SELECT';
    if ((isNumber || isSelect) && event.type !== 'change') return;
    if (!isNumber && !isSelect && event.type !== 'input') {
      if (field === 'name' && !element.value.trim()) { element.value = selectedNode().name; toast('技能名称需要填写。', true); }
      return;
    }
    if (field === 'name' && !element.value.trim()) return;
    const value = isNumber ? (element.value === '' ? NaN : Number(element.value)) : element.value;
    const ok = commit(d => {
      const n = d.catalog.nodes.find(n => n.id === id);
      if (element.dataset.level !== undefined) n.levels[Number(element.dataset.level)][field] = value;
      else n[field] = value;
    }, { inspector: isSelect, key: `${id}:${field}:${element.dataset.level || ''}` });
    if (!ok && isNumber) renderInspector();
  }
  $('inspector').addEventListener('input', editField);
  $('inspector').addEventListener('change', event => {
    editField(event);
    if (event.target.dataset.requireRank) commit(d => { d.catalog.nodes.find(n => n.id === selected).requires.find(r => r.id === event.target.dataset.requireRank).rank = Number(event.target.value); });
  });
  $('inspector').addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.id === 'add-level') commit(d => { const n = d.catalog.nodes.find(n => n.id === selected); n.levels.push({ cost: 1, effect: '', effects: [] }); });
    if (button.id === 'simulate-skill') effectsUI.openPreview();
    if (button.dataset.removeLevel) commit(d => { d.catalog.nodes.find(n => n.id === selected).levels.pop(); });
    if (button.dataset.removeReq) commit(d => { const n = d.catalog.nodes.find(n => n.id === selected); n.requires = n.requires.filter(r => r.id !== button.dataset.removeReq); });
    if (button.id === 'add-prereq') { const id = $('parent-select').value; if (id) connect(id, selected); else toast('先选择一个前置技能。'); }
    if (button.id === 'add-child') addSkill(selected);
    if (button.id === 'duplicate') addSkill(null, true);
    if (button.id === 'delete-node') {
      const id = selected;
      commit(d => { d.catalog.nodes = d.catalog.nodes.filter(n => n.id !== id); d.catalog.nodes.forEach(n => { n.requires = n.requires.filter(r => r.id !== id); }); delete d.layout.positions[id]; });
      toast('技能及相关连线已删除，可撤销');
    }
  });
  $('library-list').addEventListener('click', event => { const b = event.target.closest('[data-select]'); if (b) { select(b.dataset.select, true); setPanel('inspector'); } const c = event.target.closest('[data-edit-category]'); if (c) { branchesModal(); $('modal-content').querySelector(`[data-branch-name="${c.dataset.editCategory}"]`).focus(); } });
  $('canvas').addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button') || event.target.closest('.canvas-bottom')) return;
    const card = event.target.closest('[data-node]');
    const id = card?.dataset.node;
    if (id) select(id);
    gesture = { id, pointer: event.pointerId, x: event.clientX, y: event.clientY, original: M.clone(data), view: { ...view }, moved: false };
    $('canvas').setPointerCapture(event.pointerId); $('canvas').classList.add('dragging');
    if (id) event.preventDefault();
  });
  $('canvas').addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) gesture.moved = true;
    if (!gesture.moved) return;
    if (gesture.id) {
      const p = gesture.original.layout.positions[gesture.id];
      data.layout.positions[gesture.id] = { x: Math.round(p.x + dx / view.scale), y: Math.round(p.y + dy / view.scale) };
      const el = $('nodes').querySelector(`[data-node="${gesture.id}"]`), next = data.layout.positions[gesture.id];
      el.style.left = `${next.x}px`; el.style.top = `${next.y}px`; drawEdges();
    } else { view.x = gesture.view.x + dx; view.y = gesture.view.y + dy; transform(); }
  });
  function endGesture(event) {
    if (!gesture || gesture.pointer !== event.pointerId) return;
    if (gesture.id && gesture.moved) { remember(gesture.original); persist(); $('undo').disabled = false; $('redo').disabled = true; }
    if (gesture.id && !gesture.moved && window.innerWidth <= 760) setPanel('inspector');
    gesture = null; $('canvas').classList.remove('dragging');
  }
  $('canvas').addEventListener('pointerup', endGesture);
  $('canvas').addEventListener('pointercancel', endGesture);
  $('canvas').addEventListener('click', event => { const port = event.target.closest('[data-port]'); if (port) portClick(port); });
  $('canvas').addEventListener('keydown', event => { const card = event.target.closest('[data-node]'); if (card && ['Enter', ' '].includes(event.key) && !event.target.closest('button')) { event.preventDefault(); select(card.dataset.node); setPanel('inspector'); $('inspector').querySelector('input')?.focus(); } });
  $('canvas').addEventListener('wheel', event => { event.preventDefault(); const rect = $('canvas').getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.08 : 1 / 1.08, event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
  $('project-title').addEventListener('input', event => { if (event.target.value.trim()) commit(d => { d.catalog.title = event.target.value; }, { key: 'title', inspector: false }); });
  $('project-title').addEventListener('blur', () => { $('project-title').value = data.catalog.title; });
  $('search').addEventListener('input', renderLibrary);
  $('add-skill').onclick = () => addSkill(); $('empty-add').onclick = () => addSkill();
  $('undo').onclick = () => undo(); $('redo').onclick = () => undo(true);
  $('zoom-in').onclick = () => zoom(1.2); $('zoom-out').onclick = () => zoom(1 / 1.2); $('fit-view').onclick = fit;
  $('auto-layout').onclick = () => { commit(d => { d.layout.positions = M.layout(d.catalog); }); fit(); };
  $('cancel-connect').onclick = cancelConnection;
  $('save-project').onclick = () => saveFile(M.parse(data), '编辑项目');
  $('export-catalog').onclick = () => saveFile(M.normalize(data.catalog), '技能数据');
  $('import-project').onclick = () => $('file-input').click();
  $('file-input').onchange = async event => {
    const file = event.target.files[0]; event.target.value = ''; if (!file) return;
    try {
      const imported = M.parse(await file.text());
      showModal('导入项目', `<p class="help-content">即将载入“${esc(imported.catalog.title)}”，共 ${imported.catalog.nodes.length} 个技能。当前内容可通过撤销恢复。</p><div class="dialog-actions"><button id="cancel-import">取消</button><button id="confirm-import" class="primary">载入项目</button></div>`);
      $('cancel-import').onclick = closeModal;
      $('confirm-import').onclick = () => { remember(M.clone(data)); data = imported; selected = data.catalog.nodes[0]?.id || null; cancelConnection(); closeModal(); persist(); render(); setPanel('canvas'); requestAnimationFrame(fit); toast('项目已载入'); };
    } catch (error) { toast(`导入失败：${error.message}`, true); }
  };
  $('new-project').onclick = () => {
    showModal('新建技能树', '<label class="field"><span>项目名称</span><input id="new-title" value="我的技能树"></label><p class="field-hint">新建空白画布。当前内容可通过撤销恢复。</p><div class="dialog-actions"><button id="confirm-new" class="primary">创建</button></div>');
    $('confirm-new').onclick = () => {
      const title = $('new-title').value.trim(); if (!title) { $('new-title').focus(); return; }
      remember(M.clone(data)); data = M.project({ format: M.FORMAT, version: M.VERSION, title, branches: [{ id: uid('branch'), name: '技能', color: '#3e7198' }], variables: [], nodes: [] });
      selected = null; cancelConnection(); closeModal(); persist(); render(); setPanel('canvas');
    };
  };
  $('manage-branches').onclick = branchesModal;
  $('add-category').onclick = addCategory;
  $('manage-variables').onclick = effectsUI.openVariables;
  $('preview-effects').onclick = effectsUI.openPreview;
  $('open-preview').onclick = preview; $('close-modal').onclick = closeModal;
  $('modal-content').addEventListener('change', event => {
    const { branchColor, branchName } = event.target.dataset;
    if (branchColor || branchName) {
      const ok = commit(d => { const b = d.catalog.branches.find(b => b.id === (branchColor || branchName)); b[branchColor ? 'color' : 'name'] = event.target.value; });
      if (!ok) branchesModal();
    }
  });
  $('modal-content').addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b) return;
    if (b.id === 'add-branch') addCategory();
    if (b.dataset.moveBranch) { commit(d => { const i = d.catalog.branches.findIndex(v => v.id === b.dataset.moveBranch); const j = i + Number(b.dataset.direction); if (j >= 0 && j < d.catalog.branches.length) [d.catalog.branches[i], d.catalog.branches[j]] = [d.catalog.branches[j], d.catalog.branches[i]]; }); branchesModal(); }
    if (b.dataset.deleteBranch) {
      const id = b.dataset.deleteBranch;
      const count = data.catalog.nodes.filter(n => n.branchId === id).length;
      if (count) {
        showModal('转移技能并删除分类', `<p class="help-content">“${esc(branchById(id).name)}”有 ${count} 个技能。选择目标分类，保留技能及其前置关系。</p><label class="field"><span>移动到</span><select id="move-category-target">${data.catalog.branches.filter(b => b.id !== id).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}<option value="new">新建“未分类”</option></select></label><div class="dialog-actions"><button id="cancel-category-delete">取消</button><button id="confirm-category-delete" class="primary">转移并删除</button></div>`);
        $('cancel-category-delete').onclick = branchesModal;
        $('confirm-category-delete').onclick = () => { const target = $('move-category-target').value; commit(d => { let destination = target; if (destination === 'new') { destination = uid('branch'); d.catalog.branches.push({ id: destination, name: '未分类', color: '#677ba6' }); } d.catalog.nodes.forEach(n => { if (n.branchId === id) n.branchId = destination; }); d.catalog.branches = d.catalog.branches.filter(b => b.id !== id); }); branchesModal(); };
        return;
      }
      commit(d => { d.catalog.branches = d.catalog.branches.filter(b => b.id !== id); }); branchesModal();
    }
  });
  $('help').onclick = () => showModal('使用说明', `<div class="help-content"><p><strong>编辑分类</strong><br>目录上方可新增与管理分类；点击分类名称也可直接编辑。支持改名、改色、排序，以及转移技能后删除分类。</p><p><strong>设置变量效果</strong><br>在每级“变量效果”中直接按中文名称选择项目变量，可增加、乘以或设为指定值，并选择生效条件。左下角“变量设置”可添加自定义变量，路径自动生成。文字条件在试算中勾选是否满足，目标项目按已有状态判断。</p><p><strong>持续修正与触发结算</strong><br>持续加成从基础值计算；主动和开关技能须处于启用状态。恢复等即时变化选“触发时结算一次”，由目标项目按事件调用。点击“试算效果”可检验结果。</p><p><strong>连接与布局</strong><br>连接前置技能右侧圆点与后续技能左侧圆点，也可在右侧选择前置。拖动节点调整位置，拖动空白处平移，滚轮缩放。Ctrl+Z 撤销，Ctrl+Shift+Z 重做。</p><p><strong>保存与接入</strong><br>“保存项目”下载可继续编辑的文件；“导出技能数据”包含变量目录与效果规则。旧项目可直接导入，文字和布局保留。换电脑或清理浏览器数据前请保存项目。</p></div>`);
  document.querySelectorAll('[data-tab]').forEach(b => { b.onclick = () => { setPanel(b.dataset.tab); if (b.dataset.tab === 'canvas') requestAnimationFrame(fit); }; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancelConnection();
    if (event.target.matches('input,textarea,select') || $('modal').open) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undo(event.shiftKey); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); undo(true); }
  });
  let resizeTimer;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 120); });
  render(); requestAnimationFrame(fit);
  if (loadError) toast(loadError, true);
  else $('save-status').textContent = '草稿自动保存在此浏览器';
})();
