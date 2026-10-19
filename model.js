/* Shared catalog contract: usable in a browser or a CommonJS build step. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SkillTree = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FORMAT = 'skill-tree-catalog';
  const PROJECT = 'skill-tree-project';
  const VERSION = 3;
  const TYPES = ['passive', 'active', 'toggle'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const fail = message => { throw new Error(message); };
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const validId = id => typeof id === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(id) && !['constructor', 'prototype', '__proto__'].includes(id);
  function requireText(value, label, allowEmpty = true) {
    if (typeof value !== 'string' || (!allowEmpty && !value.trim())) fail(`${label}需要填写文字。`);
    return value;
  }
  const OPERATIONS = ['add', 'multiply', 'set'];
  const MODES = ['continuous', 'event'];
  const COMPARISONS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'];
  const validPath = path => typeof path === 'string' && path.split('.').every(p => p.trim() === p && p.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(p) && !/[\[\]]/.test(p));
  const isValue = (v, value) => typeof value === v.type && (v.type !== 'number' || Number.isFinite(value));
  const isReference = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const conditionList = condition => condition?.conditions ?? (condition ? [condition] : []);
  const effectReferences = effect => [effect.variableId, ...(isReference(effect.value) ? [effect.value.variableId] : []), ...conditionList(effect.condition).map(c => c.variableId)];
  function migrate(catalog) {
    const next = clone(catalog);
    if (next?.format === FORMAT && [1, 2].includes(next.version)) {
      next.version = VERSION; next.variables = next.variables || [];
      for (const node of next.nodes || []) for (const level of node.levels || []) level.effects = level.effects || [];
    }
    return next;
  }
  function validate(catalog) {
    if (!catalog || catalog.format !== FORMAT || catalog.version !== VERSION) fail('请选择受支持的技能数据或编辑器项目。');
    requireText(catalog.title, '项目名称', false);
    if (!Array.isArray(catalog.branches) || !Array.isArray(catalog.nodes)) fail('技能分组或节点格式不正确。');
    if (!Array.isArray(catalog.variables)) fail('变量目录格式不正确。');
    const variables = new Map(), paths = [];
    for (const v of catalog.variables) {
      if (!validId(v.id) || variables.has(v.id)) fail('变量标识重复或格式不正确。');
      requireText(v.name, '变量名称', false);
      if (!validPath(v.path)) fail(`“${v.name}”的路径需要用点分隔，例如：属性.力量。`);
      if (paths.some(p => p === v.path || p.startsWith(v.path + '.') || v.path.startsWith(p + '.'))) fail('变量路径重复或互相包含，请为每个变量使用独立字段。');
      if (!['number', 'boolean', 'string'].includes(v.type) || !isValue(v, v.preview)) fail(`“${v.name}”的预览值与类型不匹配。`);
      if (v.usage != null && !['effect', 'condition'].includes(v.usage)) fail(`“${v.name}”的用途需要是效果或条件。`);
      if (v.choices != null && (!Array.isArray(v.choices) || !v.choices.every(value => isValue(v, value)))) fail(`“${v.name}”的候选值与类型不匹配。`);
      for (const bound of ['min', 'max']) if (v[bound] != null && (v.type !== 'number' || !Number.isFinite(v[bound]))) fail(`“${v.name}”的上下限需要填写数字。`);
      if (v.min != null && v.max != null && v.min > v.max) fail(`“${v.name}”的下限高于上限。`);
      paths.push(v.path); variables.set(v.id, v);
    }
    for (const v of catalog.variables) if (v.maxVariableId != null) {
      const cap = variables.get(v.maxVariableId);
      if (v.type !== 'number' || !cap || cap.type !== 'number' || cap.id === v.id || cap.maxVariableId) fail(`“${v.name}”需要引用独立的数值上限。`);
    }
    const branches = new Set();
    for (const branch of catalog.branches) {
      if (!validId(branch.id) || branches.has(branch.id)) fail('分组标识重复或格式不正确。');
      branches.add(branch.id);
      requireText(branch.name, '分组名称', false);
      if (!/^#[0-9a-fA-F]{6}$/.test(branch.color)) fail('分组颜色需要使用六位颜色值。');
    }
    const nodes = new Map();
    for (const node of catalog.nodes) {
      if (!validId(node.id) || nodes.has(node.id)) fail('技能标识重复或格式不正确。');
      nodes.set(node.id, node);
      requireText(node.name, '技能名称', false);
      if (!branches.has(node.branchId)) fail(`“${node.name}”需要选择有效分组。`);
      if (!TYPES.includes(node.type)) fail(`“${node.name}”的使用方式不正确。`);
      requireText(node.trigger, '生效条件'); requireText(node.notes, '设计备注');
      if (!Array.isArray(node.levels) || !node.levels.length) fail(`“${node.name}”至少需要一级效果。`);
      const effectIds = new Set();
      for (const level of node.levels) {
        if (!Number.isSafeInteger(level.cost) || level.cost < 0) fail(`“${node.name}”的技能点花费需要是非负整数。`);
        requireText(level.effect, '等级效果');
        if (!Array.isArray(level.effects)) fail(`“${node.name}”的变量效果需要是列表。`);
        for (const effect of level.effects) {
          if (!validId(effect.id) || effectIds.has(effect.id)) fail(`“${node.name}”的效果标识重复或格式不正确。`);
          effectIds.add(effect.id);
          const target = variables.get(effect.variableId);
          if (!target) fail(`“${node.name}”的效果引用了不存在的变量。`);
          if (target.usage === 'condition') fail(`“${target.name}”用于生效条件，请在条件栏选择它。`);
          if (!OPERATIONS.includes(effect.operation) || !MODES.includes(effect.mode)) fail('变量效果的运算或结算方式不正确。');
          if (isReference(effect.value)) {
            const source = variables.get(effect.value.variableId);
            if (target.type !== 'number' || source?.type !== 'number' || !Number.isFinite(effect.value.factor) || (effect.value.offset != null && !Number.isFinite(effect.value.offset))) fail(`“${target.name}”需要引用数值变量，并填写有效倍率和加值。`);
          } else if (!isValue(target, effect.value) || (target.type !== 'number' && effect.operation !== 'set')) fail(`“${target.name}”的效果值或运算方式与变量类型不匹配。`);
          if (effect.condition != null) {
            if (effect.condition.conditions !== undefined && (!['all', 'any'].includes(effect.condition.mode) || !Array.isArray(effect.condition.conditions) || !effect.condition.conditions.length)) fail('条件组需要选择全部或任一满足，并至少保留一个条件。');
            for (const c of conditionList(effect.condition)) {
              const variable = c && variables.get(c.variableId);
              if (!variable || !isValue(variable, c.value) || !COMPARISONS.includes(c.comparator) || (variable.type !== 'number' && !['eq', 'ne'].includes(c.comparator))) fail('变量效果的生效条件与变量类型不匹配。');
            }
          }
        }
      }
      if (!Array.isArray(node.requires)) fail(`“${node.name}”的前置条件格式不正确。`);
    }
    for (const node of catalog.nodes) {
      const seen = new Set();
      for (const req of node.requires) {
        const parent = nodes.get(req.id);
        if (!parent) fail(`“${node.name}”引用了不存在的前置技能。`);
        if (seen.has(req.id)) fail(`“${node.name}”的前置技能重复。`);
        seen.add(req.id);
        if (!Number.isInteger(req.rank) || req.rank < 1 || req.rank > parent.levels.length) fail(`“${node.name}”要求的前置等级超出了“${parent.name}”的等级范围。`);
      }
    }
    const visiting = new Set(), done = new Set();
    function visit(id) {
      if (visiting.has(id)) fail('前置关系形成了循环：技能不能互相等待解锁。');
      if (done.has(id)) return;
      visiting.add(id);
      for (const req of nodes.get(id).requires) visit(req.id);
      visiting.delete(id); done.add(id);
    }
    for (const id of nodes.keys()) visit(id);
    return catalog;
  }
  function normalize(catalog) {
    catalog = migrate(catalog);
    validate(catalog);
    return { ...clone(catalog), format: FORMAT, version: VERSION, title: catalog.title,
      branches: catalog.branches.map(b => ({ ...clone(b), id: b.id, name: b.name, color: b.color })),
      nodes: catalog.nodes.map(n => ({ id: n.id, name: n.name, branchId: n.branchId, type: n.type,
        ...clone(n), trigger: n.trigger, levels: n.levels.map(l => ({ ...clone(l), cost: l.cost, effect: l.effect, effects: clone(l.effects) })),
        requires: n.requires.map(r => ({ id: r.id, rank: r.rank })), notes: n.notes })) };
  }
  function layout(catalog) {
    validate(catalog);
    const depths = new Map(), nodes = new Map(catalog.nodes.map(n => [n.id, n]));
    const depth = n => {
      if (!depths.has(n.id)) depths.set(n.id, n.requires.length ? 1 + Math.max(...n.requires.map(r => depth(nodes.get(r.id)))) : 0);
      return depths.get(n.id);
    };
    const rows = new Map(), positions = {};
    for (const branch of catalog.branches) for (const node of catalog.nodes.filter(n => n.branchId === branch.id)) {
      const d = depth(node), row = rows.get(d) || 0;
      positions[node.id] = { x: 70 + d * 310, y: 65 + row * 180 };
      rows.set(d, row + 1);
    }
    return positions;
  }
  function project(catalog, positions = {}) {
    const clean = normalize(catalog), fallback = layout(clean), result = {};
    for (const node of clean.nodes) {
      const p = positions[node.id];
      result[node.id] = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : fallback[node.id];
    }
    return { format: PROJECT, version: VERSION, catalog: clean, layout: { positions: result } };
  }
  function parse(value) {
    const data = typeof value === 'string' ? JSON.parse(value.replace(/^\uFEFF/, '')) : value;
    if (data && data.format === PROJECT) {
      if (![1, 2, VERSION].includes(data.version)) fail('编辑器项目版本不匹配。');
      const current = project(data.catalog, data.layout && data.layout.positions);
      return { ...clone(data), ...current, layout: { ...clone(data.layout || {}), ...current.layout } };
    }
    return project(data);
  }
  function addRequirement(catalog, parentId, childId, rank = 1) {
    const next = clone(catalog), child = next.nodes.find(n => n.id === childId);
    if (!child) fail('请先选择后续技能。');
    if (child.requires.some(r => r.id === parentId)) fail('这条前置关系已经存在。');
    child.requires.push({ id: parentId, rank });
    return normalize(next);
  }
  function state(catalog, ranks = {}) {
    validate(catalog);
    if (!ranks || typeof ranks !== 'object' || Array.isArray(ranks)) fail('技能投入应为技能标识与等级的对应表。');
    const known = new Set(catalog.nodes.map(n => n.id));
    for (const id of Object.keys(ranks)) if (!known.has(id)) fail(`技能投入包含未知标识：${id}`);
    const rankOf = id => own(ranks, id) ? ranks[id] : 0;
    let spent = 0;
    for (const n of catalog.nodes) {
      const rank = rankOf(n.id);
      if (!Number.isInteger(rank) || rank < 0 || rank > n.levels.length) fail(`“${n.name}”的已学等级不正确。`);
      if (rank > 0 && n.requires.some(r => rankOf(r.id) < r.rank)) fail(`“${n.name}”的前置条件尚未满足。`);
      spent += n.levels.slice(0, rank).reduce((sum, l) => sum + l.cost, 0);
    }
    return { spent, skills: catalog.nodes.map(n => {
      const rank = rankOf(n.id), next = n.levels[rank];
      return { id: n.id, name: n.name, type: n.type, rank, maxRank: n.levels.length,
        trigger: n.trigger, effect: rank ? n.levels[rank - 1].effect : '',
        nextCost: next ? next.cost : null,
        eligible: Boolean(next) && n.requires.every(r => rankOf(r.id) >= r.rank) };
    }) };
  }
  function learn(catalog, ranks, id, budget) {
    if (!Number.isSafeInteger(budget) || budget < 0) fail('技能点总预算需要是非负整数。');
    const view = state(catalog, ranks), skill = view.skills.find(n => n.id === id);
    if (!skill || !skill.eligible) fail('当前技能尚未满足前置条件，或已达到最高等级。');
    if (view.spent + skill.nextCost > budget) fail('剩余技能点不足。');
    return { ...ranks, [id]: skill.rank + 1 };
  }
  function learnedText(catalog, ranks) {
    return state(catalog, ranks).skills.filter(n => n.rank).map(n => {
      const level = catalog.nodes.find(s => s.id === n.id).levels[n.rank - 1];
      const rules = level.effects.map(e => describeEffect(catalog, e)).join('；');
      return `${n.name}（${n.rank}级）：${n.effect}${n.trigger ? ` 生效条件：${n.trigger}` : ''}${rules ? ` 变量效果：${rules}` : ''}`;
    }).join('\n');
  }
  function describeEffect(catalog, effect) {
    const variable = catalog.variables.find(v => v.id === effect.variableId);
    const symbols = { add: '+', multiply: '×', set: '=' }, comparisons = { eq: '=', ne: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
    const valueText = value => typeof value === 'boolean' ? (value ? '是' : '否') : String(value);
    const reference = isReference(effect.value), source = reference && catalog.variables.find(v => v.id === effect.value.variableId);
    const offset = reference ? (effect.value.offset ?? 0) : 0;
    const value = reference ? `（${source.name} × ${effect.value.factor}${offset ? ` ${offset > 0 ? '+' : '−'} ${Math.abs(offset)}` : ''}）` : valueText(effect.value);
    const conditions = conditionList(effect.condition).map(c => `${catalog.variables.find(v => v.id === c.variableId).name} ${comparisons[c.comparator]} ${valueText(c.value)}`);
    return `${variable.name} ${symbols[effect.operation]} ${value}${conditions.length ? `（${conditions.join(effect.condition.mode === 'any' ? ' 或 ' : ' 且 ')}时）` : ''} · ${effect.mode === 'continuous' ? '持续修正' : '触发结算'}`;
  }
  function calculate(catalog, ranks, values, options = {}) {
    state(catalog, ranks);
    const mode = options.mode || 'continuous';
    if (!MODES.includes(mode)) fail('请选择持续修正或触发结算。');
    if (mode === 'event' && !catalog.nodes.some(n => n.id === options.skillId && (ranks[n.id] || 0) > 0)) fail('触发结算需要指定已掌握的技能。');
    const variables = new Map(catalog.variables.map(v => [v.id, v]));
    const read = id => { const v = variables.get(id); if (v.reviewRequired) fail(`“${v.name}”属于待核对引用，请先按当前设计调整关联。`); if (!own(values, id) || !isValue(v, values[id])) fail(`请提供“${v.name}”当前的${v.type === 'number' ? '数值' : '值'}。`); return values[id]; };
    const grouped = new Map();
    const compare = (a, op, b) => ({ eq: () => a === b, ne: () => a !== b, gt: () => a > b, gte: () => a >= b, lt: () => a < b, lte: () => a <= b }[op]());
    for (const node of catalog.nodes) {
      const rank = ranks[node.id] || 0; if (!rank) continue;
      if (options.conditionsMet?.[node.id] === false) continue;
      if (mode === 'event' && node.id !== options.skillId) continue;
      if (mode === 'continuous' && node.type !== 'passive' && options.enabled?.[node.id] !== true) continue;
      if (mode === 'event' && node.type === 'toggle' && options.enabled?.[node.id] !== true) continue;
      for (const effect of node.levels[rank - 1].effects) {
        if (effect.mode !== mode) continue;
        const tests = conditionList(effect.condition).map(c => compare(read(c.variableId), c.comparator, c.value));
        if (tests.length && !(effect.condition.mode === 'any' ? tests.some(Boolean) : tests.every(Boolean))) continue;
        read(effect.variableId);
        if (!grouped.has(effect.variableId)) grouped.set(effect.variableId, []);
        const value = isReference(effect.value) ? read(effect.value.variableId) * effect.value.factor + (effect.value.offset ?? 0) : effect.value;
        grouped.get(effect.variableId).push({ ...effect, value, skillId: node.id });
      }
    }
    const result = clone(values), changes = [];
    for (const [id, effects] of grouped) {
      const variable = variables.get(id), before = read(id), setters = effects.filter(e => e.operation === 'set');
      if (setters.some(e => e.value !== setters[0].value)) fail(`“${variable.name}”同时收到不同的设定值，请调整技能开关或条件。`);
      let after = setters.length ? setters[0].value : before;
      if (variable.type === 'number') {
        after = (after + effects.filter(e => e.operation === 'add').reduce((n, e) => n + e.value, 0)) * effects.filter(e => e.operation === 'multiply').reduce((n, e) => n * e.value, 1);
        if (!Number.isFinite(after)) fail(`“${variable.name}”的计算结果超出有效数值范围。`);
        if (variable.min != null) after = Math.max(variable.min, after);
        if (variable.max != null) after = Math.min(variable.max, after);
      }
      result[id] = after;
      changes.push({ variableId: id, path: variable.path, before, after, sources: effects.map(e => ({ skillId: e.skillId, effectId: e.id })) });
    }
    for (const v of catalog.variables) {
      if (!v.maxVariableId || (!grouped.has(v.id) && !grouped.has(v.maxVariableId))) continue;
      const before = read(v.id), capBefore = read(v.maxVariableId);
      const cap = grouped.has(v.maxVariableId) ? result[v.maxVariableId] : capBefore;
      if (cap < (v.min ?? 0)) fail(`“${v.name}”的上限低于下限。`);
      const after = Math.max(v.min ?? 0, Math.min(result[v.id], cap));
      result[v.id] = after;
      const change = changes.find(c => c.variableId === v.id);
      if (change) change.after = after;
      else if (after !== before) changes.push({ variableId: v.id, path: v.path, before, after, sources: changes.find(c => c.variableId === v.maxVariableId).sources });
    }
    return { values: result, changes };
  }
  function readValues(catalog, statData) {
    validate(catalog);
    const values = {};
    for (const variable of catalog.variables) {
      let value = statData;
      for (const part of variable.path.split('.')) value = value && typeof value === 'object' && own(value, part) ? value[part] : undefined;
      if (value !== undefined) values[variable.id] = value;
    }
    return values;
  }
  function settleEvent(catalog, ranks, values, options) {
    requireText(options?.eventId, '事件标识', false);
    requireText(options?.skillId, '技能标识', false);
    const key = JSON.stringify([options.eventId, options.skillId]);
    const settled = options.settledEvents || [];
    if (!Array.isArray(settled) || !settled.every(id => typeof id === 'string')) fail('已结算事件需要使用标识列表。');
    if (settled.includes(key)) return { values: clone(values), changes: [], settledEvents: [...settled], alreadyApplied: true };
    const result = calculate(catalog, ranks, values, { ...options, mode: 'event' });
    return { ...result, settledEvents: [...settled, key], alreadyApplied: false };
  }
  return { FORMAT, PROJECT, VERSION, TYPES, OPERATIONS, MODES, COMPARISONS, clone, validate, normalize, migrate, layout, project, parse, addRequirement, state, learn, learnedText, describeEffect, conditionList, effectReferences, calculate, readValues, settleEvent };
});
