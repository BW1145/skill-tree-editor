const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('./model.js');
const catalog = () => ({
  format: M.FORMAT, version: 3, title: '效果检查',
  branches: [{ id: 'general', name: '通用', color: '#3e7198' }],
  variables: [
    { id: 'hp', name: '血条', path: '资源.血条', type: 'number', preview: 20, min: 0, maxVariableId: 'cap' },
    { id: 'cap', name: '最大血量', path: '资源.最大血量', type: 'number', preview: 100 },
    { id: 'count', name: '数量', path: '状态.数量', type: 'number', preview: 2 },
    { id: 'ready', name: '已开启', path: '状态.已开启', type: 'boolean', preview: true },
    { id: 'mode', name: '模式', path: '状态.模式', type: 'string', preview: '日常' },
  ], nodes: [],
});
const effect = overrides => ({ id: 'effectA', variableId: 'hp', operation: 'add', value: 10, mode: 'continuous', condition: null, ...overrides });
const withEffects = effects => ({ ...catalog(), nodes: [{ id: 'skillA', name: '技能甲', branchId: 'general', type: 'passive', trigger: '', notes: '', requires: [], levels: [{ cost: 1, effect: '', effects }] }] });
const values = { hp: 20, cap: 100, count: 2, ready: true, mode: '日常' };
const run = (c, v = values) => M.calculate(c, { skillA: 1 }, v).values;

test('关联上限使用技能修改后的上限，固定上限同时生效', () => {
  const c = withEffects([effect({ value: 200 }), effect({ id: 'capChange', variableId: 'cap', value: 50 })]);
  assert.equal(run(c).hp, 150);
  c.variables[0].max = 120;
  assert.equal(run(c).hp, 120);
});
test('减少上限会限制当前资源，取消关联后保持独立', () => {
  const c = withEffects([effect({ variableId: 'cap', value: -90 })]);
  assert.equal(run(c).hp, 10);
  delete c.variables[0].maxVariableId;
  assert.equal(run(c).hp, 20);
});
test('动态效果支持引用变量百分比及加值，输入保持原值', () => {
  const c = withEffects([effect({ value: { variableId: 'cap', factor: 0.1, offset: 0 } })]);
  assert.equal(run(c).hp, 30);
  c.nodes[0].levels[0].effects[0] = effect({ operation: 'multiply', value: { variableId: 'count', factor: 0.05, offset: 1 } });
  assert.equal(run(c).hp, 22);
  assert.equal(values.hp, 20);
  assert.match(M.describeEffect(c, c.nodes[0].levels[0].effects[0]), /数量 × 0.05 \+ 1/);
});
test('引用采用计算前输入，与效果排列顺序无关', () => {
  const effects = [effect({ value: { variableId: 'cap', factor: 0.1 } }), effect({ id: 'capChange', variableId: 'cap', value: 50 })];
  assert.deepEqual(run(withEffects(effects)), run(withEffects([...effects].reverse())));
  assert.equal(run(withEffects(effects)).hp, 30);
});
test('数值、文字、布尔条件支持全部与任一满足', () => {
  const conditions = [
    { variableId: 'count', comparator: 'gte', value: 3 },
    { variableId: 'ready', comparator: 'eq', value: true },
    { variableId: 'mode', comparator: 'eq', value: '日常' },
  ];
  const c = withEffects([effect({ condition: { mode: 'all', conditions } })]);
  assert.equal(run(c).hp, 20);
  c.nodes[0].levels[0].effects[0].condition.mode = 'any';
  assert.equal(run(c).hp, 30);
  assert.equal(run(c, { ...values, ready: false, mode: '战斗' }).hp, 20);
});
test('旧单条件、固定数字、v1与v2项目导入后保留含义和布局', () => {
  for (const version of [1, 2]) {
    const c = withEffects([effect({ condition: { variableId: 'ready', comparator: 'eq', value: true } })]);
    c.version = version;
    const saved = { format: M.PROJECT, version, catalog: c, layout: { positions: { skillA: { x: 30, y: 80 } } } };
    const loaded = M.parse(JSON.stringify(saved));
    assert.equal(loaded.version, 3);
    assert.deepEqual(loaded.layout.positions.skillA, { x: 30, y: 80 });
    assert.equal(run(loaded.catalog).hp, 30);
    assert.equal(run(loaded.catalog, { ...values, ready: false }).hp, 20);
  }
});
test('新效果导出后重载，保留引用和所有条件；事件重复调用只结算一次', () => {
  const c = withEffects([effect({ mode: 'event', value: { variableId: 'cap', factor: 0.1, offset: 0 }, condition: { mode: 'all', conditions: [{ variableId: 'ready', comparator: 'eq', value: true }, { variableId: 'count', comparator: 'gt', value: 0 }] } })]);
  const loaded = M.parse(JSON.stringify(M.project(c))).catalog;
  assert.deepEqual(loaded, c);
  const options = { eventId: 'event1', skillId: 'skillA' };
  const first = M.settleEvent(loaded, { skillA: 1 }, values, options);
  const second = M.settleEvent(loaded, { skillA: 1 }, first.values, { ...options, settledEvents: first.settledEvents });
  assert.equal(first.values.hp, 30);
  assert.equal(second.values.hp, 30);
});
test('拒绝失效引用、非数值来源、空条件组及循环上限', () => {
  for (const value of [{ variableId: 'missing', factor: 1 }, { variableId: 'ready', factor: 1 }, { variableId: 'cap', factor: NaN }]) {
    assert.throws(() => M.validate(withEffects([effect({ value })])));
  }
  assert.throws(() => M.validate(withEffects([effect({ condition: { mode: 'all', conditions: [] } })])));
  const c = catalog(); c.variables[1].maxVariableId = 'hp';
  assert.throws(() => M.validate(c));
  assert.deepEqual(M.effectReferences(effect({ value: { variableId: 'cap', factor: 1 }, condition: { mode: 'any', conditions: [{ variableId: 'ready', comparator: 'eq', value: true }] } })), ['hp', 'cap', 'ready']);
});
