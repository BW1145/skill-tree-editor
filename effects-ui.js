'use strict';
window.createSkillEffectsUI = function ({ getData, selectedNode, commit, showModal, closeModal, toast, esc, uid }) {
  const M = window.SkillTree, $ = id => document.getElementById(id);
  const variableTypes = { number: '数值', boolean: '是 / 否', string: '文字' };
  const operations = { add: '增加 / 减少', multiply: '乘以', set: '设为' };
  const comparisons = { eq: '等于', ne: '不等于', gt: '大于', gte: '大于等于', lt: '小于', lte: '小于等于' };
  const catalog = () => getData().catalog;
  const variable = id => catalog().variables.find(v => v.id === id);
  const textValue = value => typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
  const options = (items, value) => Object.entries(items).map(([id, name]) => `<option value="${id}" ${id === value ? 'selected' : ''}>${esc(name)}</option>`).join('');
  const label = v => `${v.name}${v.unit ? `（${v.unit}）` : ''}${v.reviewRequired ? ' · 待核对' : ''}`;
  function grouped(variables) {
    const groups = new Map();
    for (const v of variables) { const group = v.group || '自定义变量'; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(v); }
    return [...groups];
  }
  function variableOptions(value, forEffect = false, numberOnly = false) {
    return grouped(catalog().variables.filter(v => (!v.reviewRequired || v.id === value) && (!forEffect || v.usage !== 'condition') && (!numberOnly || v.type === 'number'))).map(([group, vars]) => `<optgroup label="${esc(group)}">${vars.map(v => `<option value="${esc(v.id)}" ${v.id === value ? 'selected' : ''}>${esc(label(v))}</option>`).join('')}</optgroup>`).join('');
  }
  function valueInput(v, value, attributes) {
    if (v.type === 'boolean') return `<select ${attributes}>${options({ true: '是', false: '否' }, String(value))}</select>`;
    if (v.type === 'string' && v.choices?.length) {
      const choices = [...new Set([...v.choices, value])];
      return `<select ${attributes}>${choices.map(choice => `<option value="${esc(choice)}" ${choice === value ? 'selected' : ''}>${esc(choice)}</option>`).join('')}</select>`;
    }
    return `<input type="${v.type === 'number' ? 'number' : 'text'}" ${v.type === 'number' ? 'step="any"' : ''} value="${esc(value)}" ${attributes}>`;
  }
  function parsedValue(v, input) {
    if (v.type === 'boolean') return input.value === 'true';
    if (v.type === 'number') { if (!input.value.trim() || !Number.isFinite(Number(input.value))) throw new Error('请填写有效数值。'); return Number(input.value); }
    return input.value;
  }
  function renderLevel(level, index) {
    return `<div class="structured-effects"><div class="section-heading"><h3>变量效果</h3><button data-add-effect="${index}">${catalog().variables.length ? '＋ 添加效果' : '＋ 定义变量'}</button></div>
      ${level.effects.map((e, i) => { const v = variable(e.variableId), reference = e.value !== null && typeof e.value === 'object', conditions = M.conditionList(e.condition); return `<div class="effect-rule" data-effect="${i}" data-effect-level="${index}">
        <div class="effect-rule-title"><span>效果 ${i + 1}</span><button data-delete-effect="${i}" data-effect-level="${index}" aria-label="删除变量效果${i + 1}">×</button></div>
        <label class="field"><span>影响变量</span><select data-rule-field="variableId" aria-label="影响变量">${variableOptions(e.variableId, true)}</select>${v.description ? `<small>${esc(v.description)}</small>` : ''}</label>
        <div class="field-row"><label class="field"><span>运算</span><select data-rule-field="operation">${options(v.type === 'number' ? operations : { set: '设为' }, e.operation)}</select></label>${v.type === 'number' ? `<label class="field"><span>数值来源</span><select data-rule-field="valueSource" aria-label="数值来源">${options({ fixed: '固定数字', variable: '引用变量' }, reference ? 'variable' : 'fixed')}</select></label>` : ''}</div>
        ${reference ? `<label class="field"><span>引用哪个变量</span><select data-rule-field="sourceVariable" aria-label="引用变量">${variableOptions(e.value.variableId, false, true)}</select></label><div class="field-row"><label class="field"><span>乘以倍率</span><input type="number" step="any" data-rule-field="sourceFactor" aria-label="引用倍率" value="${e.value.factor}"><small>10%填写0.1。</small></label><label class="field"><span>再加上</span><input type="number" step="any" data-rule-field="sourceOffset" aria-label="引用加值" value="${e.value.offset ?? 0}"><small>无需加值时填0。</small></label></div>` : `<label class="field"><span>数值 / 结果</span>${valueInput(v, e.value, 'data-rule-field="value" aria-label="效果值"')}${v.type === 'number' ? `<small>加减、设值采用${v.unit ? esc(v.unit) : '此变量的单位'}；乘法填倍率。</small>` : ''}</label>`}
        <label class="field"><span>结算方式</span><select data-rule-field="mode">${options({ continuous: '持续修正', event: '触发时结算一次' }, e.mode)}</select></label>
        <div class="section-heading"><h3>附加变量条件</h3><button data-add-condition="${i}" data-effect-level="${index}">＋ 添加条件</button></div>
        ${conditions.length ? `<label class="field"><span>生效方式</span><select data-rule-field="conditionMode" aria-label="条件组合">${options({ all: '全部条件满足', any: '任一条件满足' }, e.condition.mode ?? 'all')}</select></label>` : '<p class="field-hint">无附加变量条件。</p>'}
        ${conditions.map((c, ci) => { const cv = variable(c.variableId); return `<div class="condition-row" data-condition-index="${ci}"><div class="effect-rule-title"><span>条件 ${ci + 1}</span><button data-remove-condition="${ci}" data-effect-index="${i}" data-effect-level="${index}" aria-label="删除条件${ci + 1}">×</button></div><label class="field"><span>条件变量</span><select data-rule-field="conditionVariable" aria-label="条件${ci + 1}变量">${variableOptions(cv.id)}</select></label><div class="field-row"><label class="field"><span>判断</span><select data-rule-field="comparator" aria-label="条件${ci + 1}判断">${options(cv.type === 'number' ? comparisons : { eq: '等于', ne: '不等于' }, c.comparator)}</select></label><label class="field"><span>条件值</span>${valueInput(cv, c.value, `data-rule-field="conditionValue" aria-label="条件${ci + 1}值"`)}</label></div></div>`; }).join('')}
        <p class="effect-summary">${esc(M.describeEffect(catalog(), e))}</p></div>`; }).join('')}
      ${level.effects.length ? '' : '<p class="field-hint">选择变量后，设置加多少、乘多少或改成什么值。</p>'}</div>`;
  }
  function references(id) {
    return catalog().nodes.flatMap(n => n.levels.flatMap(l => l.effects)).filter(e => M.effectReferences(e).includes(id)).length + catalog().variables.filter(v => v.maxVariableId === id).length;
  }
  function openVariables() {
    showModal('变量设置', `<p class="field-hint">添加项目使用的数值、文字或是／否变量，再在技能中选择对应效果和条件。名称、路径、单位与范围都可自行定义。</p><div class="variable-actions"><button id="add-variable" class="primary-soft">＋ 自定义变量</button></div><div class="variable-list">${grouped(catalog().variables).map(([group, vars]) => `<section class="variable-group"><h3>${esc(group)} <span>${vars.length}</span></h3>${vars.map(v => `<div class="variable-row"><div><strong>${esc(label(v))}</strong><span>${variableTypes[v.type]} · ${v.usage === 'condition' ? '生效条件' : '效果与条件'}${v.description ? ` · ${esc(v.description)}` : ''}</span></div><button data-edit-variable="${esc(v.id)}">编辑</button><button data-delete-variable="${esc(v.id)}" class="quiet danger">删除</button></div>`).join('')}</section>`).join('') || '<p class="empty-list">点击“自定义变量”，添加项目需要的属性或状态。</p>'}</div>`);
  }
  function editVariable(id = null) {
    const v = id ? variable(id) : { id: uid('var'), name: '', type: 'number', preview: 0, min: null, max: null, group: '自定义变量' };
    if (!id) v.path = `自定义.${v.id}`;
    showModal(id ? '编辑变量' : '自定义变量', `<form id="variable-form"><label class="field"><span>变量名称</span><input id="variable-name" value="${esc(v.name)}" placeholder="例如：护盾值" required></label><label class="field"><span>变量类型</span><select id="variable-type">${options(variableTypes, v.type)}</select></label><div id="variable-value-fields"></div><p class="field-hint">只填名称和类型即可使用。试算基础值用于预览，实际初始值由接入项目决定。</p><details class="variable-advanced"><summary>高级：变量路径与选项</summary><label class="field"><span>项目中的变量路径</span><input id="variable-path" value="${esc(v.path)}" required><small>已自动填写。接入项目时按此路径读取和更新；改名后路径仍保持稳定。</small></label><label class="field"><span>单位（选填）</span><input id="variable-unit" value="${esc(v.unit || '')}" placeholder="例如：点、天、厘米"></label><label class="field"><span>用途说明（选填）</span><input id="variable-description" value="${esc(v.description || '')}"></label><label class="field"><span>文字候选值（每行一个，选填）</span><textarea id="variable-choices" placeholder="填写后可用下拉选择">${esc((v.choices || []).join('\n'))}</textarea><small>仅文字变量使用；留空时自由填写。</small></label></details><div class="dialog-actions"><button type="button" id="variable-back">返回列表</button><button class="primary" type="submit">保存变量</button></div></form>`);
    const renderValues = () => {
      const type = $('variable-type').value, same = type === v.type, preview = same ? v.preview : type === 'number' ? 0 : type === 'boolean' ? false : '';
      $('variable-value-fields').innerHTML = `<label class="field"><span>试算用基础值</span>${valueInput({ type }, preview, 'id="variable-preview" aria-label="试算用基础值"')}</label>${type === 'number' ? `<div class="field-row"><label class="field"><span>下限（选填）</span><input type="number" step="any" id="variable-min" value="${same && v.min != null ? v.min : ''}"></label><label class="field"><span>固定上限（选填）</span><input type="number" step="any" id="variable-max" value="${same && v.max != null ? v.max : ''}"></label></div><label class="field"><span>关联上限变量（选填）</span><select id="variable-cap" aria-label="关联上限变量"><option value="">不关联</option>${catalog().variables.filter(item => item.type === 'number' && item.id !== v.id && (!item.maxVariableId || item.id === v.maxVariableId)).map(item => `<option value="${esc(item.id)}" ${item.id === v.maxVariableId ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select><small>例如血条的上限关联到“最大血量”；同时设置固定上限时取较低值。</small></label>` : ''}`;
    };
    renderValues(); $('variable-type').onchange = renderValues; $('variable-back').onclick = openVariables;
    $('variable-form').onsubmit = event => {
      event.preventDefault();
      try {
        const type = $('variable-type').value;
        const bound = key => type !== 'number' || !$(key).value.trim() ? null : parsedValue({ type: 'number' }, $(key));
        const next = { ...v, name: $('variable-name').value.trim(), path: $('variable-path').value.trim(), type, preview: parsedValue({ type }, $('variable-preview')), min: bound('variable-min'), max: bound('variable-max') };
        if (type === 'number' && $('variable-cap').value) next.maxVariableId = $('variable-cap').value;
        else delete next.maxVariableId;
        next.unit = $('variable-unit').value.trim(); next.description = $('variable-description').value.trim();
        if (type === 'string') next.choices = [...new Set($('variable-choices').value.split('\n').map(s => s.trim()).filter(Boolean))];
        else delete next.choices;
        if (commit(d => { const i = d.catalog.variables.findIndex(v => v.id === next.id); if (i < 0) d.catalog.variables.push(next); else d.catalog.variables[i] = next; })) openVariables();
      } catch (error) { toast(error.message, true); }
    };
  }
  function openPreview() {
    if (!catalog().variables.length) { openVariables(); return; }
    const node = selectedNode();
    const used = new Set(catalog().nodes.flatMap(n => n.levels.flatMap(l => l.effects.flatMap(M.effectReferences))));
    for (const v of catalog().variables) if (v.maxVariableId && (used.has(v.id) || used.has(v.maxVariableId))) { used.add(v.id); used.add(v.maxVariableId); }
    const usedVariables = catalog().variables.filter(v => used.has(v.id));
    showModal('效果试算', `<p class="field-hint">使用选定技能的当前等级效果计算。可添加多个技能一起试算。文字条件在这里勾选是否满足；目标项目从已有状态判断。本页输入仅用于试算。</p><div id="simulation-skills">${catalog().nodes.map(n => `<div class="simulation-skill"><span>${esc(n.name)}<small class="simulation-trigger">${esc(n.trigger)}</small></span><select data-sim-skill="${n.id}" aria-label="${esc(n.name)}试算等级"><option value="0">未学习</option>${n.levels.map((_, i) => `<option value="${i + 1}" ${node?.id === n.id && i === 0 ? 'selected' : ''}>${i + 1}级</option>`).join('')}</select><label><input type="checkbox" data-sim-enabled="${n.id}" checked>${n.type === 'passive' ? '条件满足' : '启用'}</label></div>`).join('')}</div><div class="simulation-values">${usedVariables.map(v => `<label class="field"><span>${esc(label(v))} · 基础值</span>${valueInput(v, v.preview, `data-sim-variable="${v.id}" aria-label="${esc(v.name)}试算值"`)}</label>`).join('')}</div><div class="field-row"><label class="field"><span>计算方式</span><select id="simulation-mode">${options({ continuous: '持续修正', event: '触发结算' }, 'continuous')}</select></label><label class="field"><span>触发哪个技能</span><select id="simulation-event" disabled>${catalog().nodes.map(n => `<option value="${n.id}" ${n.id === node?.id ? 'selected' : ''}>${esc(n.name)}</option>`).join('')}</select></label></div><button id="calculate-effects" class="primary">计算结果</button><div id="simulation-result" aria-live="polite"></div>`);
    $('simulation-mode').onchange = () => { $('simulation-event').disabled = $('simulation-mode').value !== 'event'; };
    $('calculate-effects').onclick = () => {
      try {
        const ranks = {}, enabled = {}, values = {};
        document.querySelectorAll('[data-sim-skill]').forEach(el => { ranks[el.dataset.simSkill] = Number(el.value); });
        document.querySelectorAll('[data-sim-enabled]').forEach(el => { enabled[el.dataset.simEnabled] = el.checked; });
        document.querySelectorAll('[data-sim-variable]').forEach(el => { values[el.dataset.simVariable] = parsedValue(variable(el.dataset.simVariable), el); });
        const result = M.calculate(catalog(), ranks, values, { enabled, conditionsMet: enabled, mode: $('simulation-mode').value, skillId: $('simulation-event').value });
        $('simulation-result').innerHTML = `<p class="field-hint">先应用设定值，再合计加减值，最后相乘所有倍率；最后按上下限截取；关联上限的变量使用本次计算后的上限。</p><table class="result-table"><thead><tr><th>变量</th><th>基础值</th><th>结果</th></tr></thead><tbody>${usedVariables.map(v => `<tr><td>${esc(v.name)}</td><td>${esc(textValue(values[v.id]))}</td><td><strong>${esc(textValue(result.values[v.id]))}</strong></td></tr>`).join('')}</tbody></table>${result.changes.length ? '' : '<p class="field-hint">当前没有匹配的变量效果。检查等级、开关、条件和结算方式。</p>'}`;
      } catch (error) { $('simulation-result').textContent = error.message; }
    };
  }
  $('inspector').addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b) return;
    if (b.dataset.addEffect !== undefined) {
      const v = catalog().variables.find(v => !v.reviewRequired && v.usage !== 'condition');
      if (!v) { openVariables(); return; }
      commit(d => { d.catalog.nodes.find(n => n.id === selectedNode().id).levels[Number(b.dataset.addEffect)].effects.push({ id: uid('effect'), variableId: v.id, operation: v.type === 'number' ? 'add' : 'set', value: v.type === 'number' ? 0 : v.preview, mode: selectedNode().type === 'active' ? 'event' : 'continuous', condition: null }); });
    }
    if (b.dataset.deleteEffect !== undefined) commit(d => { d.catalog.nodes.find(n => n.id === selectedNode().id).levels[Number(b.dataset.effectLevel)].effects.splice(Number(b.dataset.deleteEffect), 1); });
    if (b.dataset.addCondition !== undefined) commit(d => {
      const effect = d.catalog.nodes.find(n => n.id === selectedNode().id).levels[Number(b.dataset.effectLevel)].effects[Number(b.dataset.addCondition)];
      const v = d.catalog.variables[0];
      effect.condition = { mode: effect.condition?.mode ?? 'all', conditions: [...M.conditionList(effect.condition), { variableId: v.id, comparator: 'eq', value: v.preview }] };
    });
    if (b.dataset.removeCondition !== undefined) commit(d => {
      const effect = d.catalog.nodes.find(n => n.id === selectedNode().id).levels[Number(b.dataset.effectLevel)].effects[Number(b.dataset.effectIndex)];
      const conditions = M.conditionList(effect.condition).filter((_, i) => i !== Number(b.dataset.removeCondition));
      effect.condition = conditions.length ? { mode: effect.condition.mode ?? 'all', conditions } : null;
    });
  });
  function editEffect(event) {
    const key = event.target.dataset.ruleField; if (!key) return;
    const typing = event.type === 'input';
    if (typing && (!['sourceFactor', 'sourceOffset', 'value', 'conditionValue'].includes(key) || event.target.tagName === 'SELECT')) return;
    if (typing && event.target.type === 'number' && (!event.target.value.trim() || !Number.isFinite(Number(event.target.value)))) return;
    const row = event.target.closest('[data-effect]'), level = Number(row.dataset.effectLevel), index = Number(row.dataset.effect);
    const value = event.target.value;
    const ok = commit(d => {
      const effect = d.catalog.nodes.find(n => n.id === selectedNode().id).levels[level].effects[index];
      if (key === 'variableId') { const v = variable(value); effect.variableId = value; effect.operation = v.type === 'number' ? 'add' : 'set'; effect.value = v.type === 'number' ? 0 : v.preview; }
      else if (key === 'valueSource') effect.value = value === 'variable' ? { variableId: catalog().variables.find(v => v.type === 'number' && !v.reviewRequired).id, factor: 1, offset: 0 } : 0;
      else if (key === 'sourceVariable') effect.value.variableId = value;
      else if (key === 'sourceFactor') effect.value.factor = parsedValue({ type: 'number' }, event.target);
      else if (key === 'sourceOffset') effect.value.offset = parsedValue({ type: 'number' }, event.target);
      else if (key === 'value') effect.value = parsedValue(variable(effect.variableId), event.target);
      else if (['conditionVariable', 'conditionValue', 'comparator', 'conditionMode'].includes(key)) {
        effect.condition = { mode: effect.condition?.mode ?? 'all', conditions: M.conditionList(effect.condition) };
        if (key === 'conditionMode') effect.condition.mode = value;
        else {
          const c = effect.condition.conditions[Number(event.target.closest('[data-condition-index]').dataset.conditionIndex)];
          if (key === 'conditionVariable') { c.variableId = value; c.comparator = 'eq'; c.value = variable(value).preview; }
          else if (key === 'conditionValue') c.value = parsedValue(variable(c.variableId), event.target);
          else c.comparator = value;
        }
      }
      else effect[key] = value;
    }, { inspector: !typing, key: typing ? `${selectedNode().id}:effect:${level}:${index}:${key}:${event.target.closest('[data-condition-index]')?.dataset.conditionIndex ?? ''}` : undefined });
    if (typing && ok) row.querySelector('.effect-summary').textContent = M.describeEffect(catalog(), selectedNode().levels[level].effects[index]);
  }
  $('inspector').addEventListener('input', editEffect);
  $('inspector').addEventListener('change', editEffect);
  $('modal-content').addEventListener('click', event => {
    const b = event.target.closest('button'); if (!b) return;
    if (b.id === 'add-variable') editVariable();
    if (b.dataset.editVariable) editVariable(b.dataset.editVariable);
    if (b.dataset.deleteVariable) {
      const id = b.dataset.deleteVariable, count = references(id);
      if (count) { toast(`这个变量被 ${count} 处效果或上限关联使用，请先调整引用。`, true); return; }
      if (commit(d => { d.catalog.variables = d.catalog.variables.filter(v => v.id !== id); })) openVariables();
    }
  });
  return { renderLevel, openVariables, openPreview };
};

