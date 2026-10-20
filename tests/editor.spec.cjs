const { test, expect } = require('playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const fs = require('node:fs/promises');

const editor = pathToFileURL(path.resolve(__dirname, '../index.html')).href;
const field = (page, name) => page.locator(`#inspector [data-field="${name}"]`);
const card = (page, name) => page.locator('.skill-node').filter({ has: page.getByRole('heading', { name, exact: true }) });
const mobile = page => page.viewportSize().width <= 760;
async function panel(page, name) {
  if (mobile(page)) await page.locator(`[data-tab="${name}"]`).click();
}
async function draft(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('skill-tree-editor.generic.v1:' + location.pathname)));
}
async function edit(page, selector, value) {
  await page.locator(selector).fill(String(value));
  await page.locator(selector).press('Tab');
}
async function newProject(page, title = '纵向成长验收') {
  await page.getByRole('button', { name: '新建', exact: true }).click();
  await page.locator('#new-title').fill(title);
  await page.locator('#confirm-new').click();
}
async function add(page, name, child = false) {
  if (!child) await panel(page, 'library');
  await page.locator(child ? '#add-child' : '#add-skill').click();
  await field(page, 'name').fill(name);
  await field(page, 'name').press('Tab');
  return (await draft(page)).catalog.nodes.find(n => n.name === name).id;
}
async function select(page, name) {
  await panel(page, 'library');
  await page.locator('[data-select]').filter({ hasText: name }).click();
}
async function downloadJSON(page, button, info, filename) {
  const pending = page.waitForEvent('download');
  await page.locator(button).click();
  const download = await pending;
  const saved = info.outputPath(filename);
  await download.saveAs(saved);
  const json = JSON.parse(await fs.readFile(saved, 'utf8'));
  await info.attach(filename, { path: saved, contentType: 'application/json' });
  return { saved, json };
}
async function importJSON(page, json) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#import-project').click();
  await (await chooser).setFiles(typeof json === 'string' ? json : { name: 'project.json', mimeType: 'application/json', buffer: Buffer.from('\uFEFF' + JSON.stringify(json)) });
  await page.locator('#confirm-import').click();
  await expect(page.locator('#modal')).not.toBeVisible();
}
async function screenshot(page, info, name) {
  const file = info.outputPath(name + '.png');
  await page.screenshot({ path: file });
  await info.attach(name, { path: file, contentType: 'image/png' });
}
async function variable(page, name, type, value) {
  await panel(page, 'library');
  await page.locator('#manage-variables').click();
  await page.locator('#add-variable').click();
  await page.locator('#variable-name').fill(name);
  await page.locator('#variable-type').selectOption(type);
  if (type === 'boolean') await page.locator('#variable-preview').selectOption(String(value));
  else await page.locator('#variable-preview').fill(String(value));
  await page.getByRole('button', { name: '保存变量', exact: true }).click();
  await expect(page.locator('#modal-title')).toHaveText('变量设置');
  await page.locator('#close-modal').click();
  return (await draft(page)).catalog.variables.find(v => v.name === name).id;
}
async function assertInside(page, locator) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
}

test.beforeEach(async ({ page }) => {
  page.errors = [];
  page.on('pageerror', e => page.errors.push(e.message));
  await page.goto(editor);
  await expect(page.locator('#node-count')).toHaveText('0');
});
test.afterEach(async ({ page }) => { expect(page.errors).toEqual([]); });

test('空白创建多级分支、连线、纵向拖动、布局与撤销重做', async ({ page }, info) => {
  test.skip(info.project.name === 'touch', '窄屏操作由独立用例覆盖');
  await newProject(page);
  const root = await add(page, '基础训练');
  await field(page, 'trigger').fill('每天训练后生效');
  await field(page, 'notes').fill('入门 → 专精 → 精通');
  for (let i = 0; i < 3; i++) {
    if (i) await page.locator('#add-level').click();
    await edit(page, `#cost-${i}`, i + 1);
    await page.getByRole('textbox', { name: `${i + 1}级效果`, exact: true }).fill(`力量增加 ${(i + 1) * 2}`);
  }
  const branchA = await add(page, '剑术专精', true);
  await page.locator('[data-require-rank]').selectOption('2');
  await page.locator('#add-level').click();
  const leaf = await add(page, '剑术精通', true);
  await page.locator('[data-require-rank]').selectOption('2');
  const branchB = await add(page, '防御专精');
  await page.locator('#fit-view').click();
  await card(page, '基础训练').locator('[data-port="out"]').click();
  await card(page, '防御专精').locator('[data-port="in"]').click();
  await expect(page.locator('#edge-count')).toHaveText('3 条连线');
  await select(page, '剑术精通');
  await page.locator('#parent-select').selectOption(branchB);
  await page.locator('#add-prereq').click();
  expect((await draft(page)).catalog.nodes.find(n => n.id === leaf).requires).toEqual([{ id: branchA, rank: 2 }, { id: branchB, rank: 1 }]);
  await page.locator('#fit-view').click();
  const canvas = await page.locator('#canvas').boundingBox();
  for (const [name, x, y] of [['基础训练', .5, .14], ['剑术专精', .23, .43], ['防御专精', .77, .43], ['剑术精通', .5, .75]]) {
    const box = await card(page, name).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 25);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * x, canvas.y + canvas.height * y, { steps: 12 });
    await page.mouse.up();
  }
  const vertical = await draft(page);
  const positions = vertical.layout.positions;
  expect(positions[root].y).toBeLessThan(positions[branchA].y);
  expect(positions[branchA].y).toBeLessThan(positions[leaf].y);
  await screenshot(page, info, 'vertical-tree');
  await page.locator('#undo').click();
  expect((await draft(page)).layout.positions).not.toEqual(positions);
  await page.locator('#redo').click();
  expect((await draft(page)).layout.positions).toEqual(positions);
  await page.locator('#auto-layout').click();
  const automatic = (await draft(page)).layout.positions;
  expect(automatic).not.toEqual(positions);
  await page.locator('#canvas').focus();
  await page.keyboard.press('Control+z');
  expect((await draft(page)).layout.positions).toEqual(positions);
  await page.keyboard.press('Control+Shift+z');
  expect((await draft(page)).layout.positions).toEqual(automatic);
  await page.locator('#undo').click();
  await page.locator('#open-preview').click();
  await expect(page.locator('#modal-content')).toContainText('力量增加 6');
  await page.locator('#close-modal').click();
  const saved = await downloadJSON(page, '#save-project', info, 'growth-project.json');
  expect(saved.json).toEqual(await draft(page));
  await page.reload();
  expect(await draft(page)).toEqual(saved.json);
  await expect(page.locator('.skill-node')).toHaveCount(4);
  await expect(page.locator('.edge-path')).toHaveCount(4);
  await newProject(page, '临时项目');
  await importJSON(page, saved.saved);
  expect(await draft(page)).toEqual(saved.json);
  for (const node of saved.json.catalog.nodes) {
    await select(page, node.name);
    await expect(field(page, 'name')).toHaveValue(node.name);
    await expect(page.locator('.level-item')).toHaveCount(node.levels.length);
    await expect(page.locator('.requirement')).toHaveCount(node.requires.length);
    expect(await card(page, node.name).evaluate(el => ({ x: parseFloat(el.style.left), y: parseFloat(el.style.top) }))).toEqual(positions[node.id]);
  }
  const exported = await downloadJSON(page, '#export-catalog', info, 'growth-catalog.json');
  expect(exported.json).toEqual(saved.json.catalog);
  await importJSON(page, exported.saved);
  expect((await draft(page)).catalog).toEqual(saved.json.catalog);
  await page.locator('#undo').click();
  expect(await draft(page)).toEqual(saved.json);
});

test('复杂效果表单、动态来源、多条件与实际试算', async ({ page }, info) => {
  await newProject(page);
  const strength = await variable(page, '力量', 'number', 10);
  const count = await variable(page, '训练次数', 'number', 2);
  const ready = await variable(page, '完成训练', 'boolean', true);
  const mode = await variable(page, '场景', 'string', '日常');
  const root = await add(page, '基础训练');
  await page.locator('[data-add-effect="0"]').click();
  await page.getByLabel('影响变量', { exact: true }).selectOption(strength);
  await page.getByLabel('数值来源', { exact: true }).selectOption('variable');
  await page.getByLabel('引用变量', { exact: true }).selectOption(count);
  await edit(page, '[data-rule-field="sourceFactor"]', 2);
  await edit(page, '[data-rule-field="sourceOffset"]', 1);
  await page.locator('[data-add-condition]').click();
  await page.getByLabel('条件1变量', { exact: true }).selectOption(ready);
  await page.getByLabel('条件1值', { exact: true }).selectOption('true');
  await page.locator('[data-add-condition]').click();
  await page.getByLabel('条件2变量', { exact: true }).selectOption(mode);
  await page.getByLabel('条件2值', { exact: true }).fill('日常');
  await page.getByLabel('条件2值', { exact: true }).press('Tab');
  await page.locator('#simulate-skill').click();
  await page.locator('#calculate-effects').click();
  const result = page.locator('.result-table tr').filter({ hasText: '力量' });
  await expect(result.locator('strong')).toHaveText('15');
  await page.getByLabel('完成训练试算值', { exact: true }).selectOption('false');
  await page.locator('#calculate-effects').click();
  await expect(result.locator('strong')).toHaveText('10');
  await screenshot(page, info, 'effect-simulation');
  await page.locator('#close-modal').click();
  await page.getByLabel('条件组合', { exact: true }).selectOption('any');
  await page.locator('#simulate-skill').click();
  await page.getByLabel('完成训练试算值', { exact: true }).selectOption('false');
  await page.locator('#calculate-effects').click();
  await expect(result.locator('strong')).toHaveText('15');
  await page.locator('#close-modal').click();
  await page.locator('[data-remove-condition="1"]').click();
  await page.locator('[data-remove-condition="0"]').click();
  expect((await draft(page)).catalog.nodes[0].levels[0].effects[0].condition).toBeNull();
  const saved = await downloadJSON(page, '#save-project', info, 'effects-project.json');
  await newProject(page);
  await importJSON(page, saved.saved);
  expect(await draft(page)).toEqual(saved.json);
  await select(page, '基础训练');
  await expect(page.getByLabel('引用倍率', { exact: true })).toHaveValue('2');
  await field(page, 'type').selectOption('active');
  await page.locator('[data-rule-field="mode"]').selectOption('event');
  await page.locator('#simulate-skill').click();
  await page.locator('#simulation-mode').selectOption('event');
  await page.locator('#calculate-effects').click();
  await expect(result.locator('strong')).toHaveText('15');
  await page.locator(`[data-sim-enabled="${root}"]`).uncheck();
  await page.locator('#calculate-effects').click();
  await expect(result.locator('strong')).toHaveText('10');
});

function legacy(version) {
  const node = (id, name, requires) => ({ id, name, branchId: 'general', type: 'passive', trigger: '日常', notes: '原版备注', requires, levels: [{ cost: 1, effect: '旧版文字效果', ...(version === 2 ? { effects: [] } : {}) }] });
  return { format: 'skill-tree-project', version, catalog: { format: 'skill-tree-catalog', version, title: `旧版 v${version}`, branches: [{ id: 'general', name: '通用', color: '#3e7198' }], ...(version === 2 ? { variables: [] } : {}), nodes: [node('basic', '基础', []), node('advanced', '进阶', [{ id: 'basic', rank: 1 }])] }, layout: { positions: { basic: { x: -35, y: 40 }, advanced: { x: 80, y: 350 } } } };
}
for (const version of [1, 2]) test(`v${version} JSON 通过文件选择导入、重载与再次导出`, async ({ page }, info) => {
  const old = legacy(version);
  await importJSON(page, old);
  const current = await draft(page);
  expect(current.version).toBe(3);
  expect(current.catalog.version).toBe(3);
  expect(current.layout).toEqual(old.layout);
  expect(current.catalog.nodes[1].requires).toEqual(old.catalog.nodes[1].requires);
  await expect(page.locator('.skill-node')).toHaveCount(2);
  await select(page, '进阶');
  await expect(field(page, 'notes')).toHaveValue('原版备注');
  await expect(page.getByRole('textbox', { name: '1级效果', exact: true })).toHaveValue('旧版文字效果');
  await page.reload();
  expect(await draft(page)).toEqual(current);
  const saved = await downloadJSON(page, '#save-project', info, `migrated-v${version}.json`);
  expect(saved.json).toEqual(current);
});

test('重复连线、循环前置、无效 JSON 不破坏当前项目', async ({ page }, info) => {
  test.skip(info.project.name === 'touch', '画布端口需要桌面视口');
  await newProject(page);
  await add(page, '基础');
  await add(page, '进阶', true);
  await page.locator('#fit-view').click();
  const original = await draft(page);
  for (const [parent, child, message] of [['基础', '进阶', '已经存在'], ['进阶', '基础', '循环']]) {
    await card(page, parent).locator('[data-port="out"]').click();
    await card(page, child).locator('[data-port="in"]').click();
    await expect(page.locator('#toast')).toContainText(message);
    expect(await draft(page)).toEqual(original);
    await page.locator('#cancel-connect').click();
  }
  await page.locator('#file-input').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.locator('#toast')).toContainText('导入失败');
  expect(await draft(page)).toEqual(original);
  await select(page, '进阶');
  await page.locator('#delete-node').click();
  expect((await draft(page)).catalog.nodes).toHaveLength(1);
  await page.locator('#undo').click();
  expect(await draft(page)).toEqual(original);
});

test('目录分类管理、转移与删除可撤销', async ({ page }) => {
  await newProject(page);
  await add(page, '保留技能');
  await panel(page, 'library');
  await page.locator('#add-category').click();
  await edit(page, '.branch-editor:last-of-type [data-branch-name]', '专精');
  await page.locator('#close-modal').click();
  await select(page, '保留技能');
  const category = (await draft(page)).catalog.branches[1].id;
  await field(page, 'branchId').selectOption(category);
  await panel(page, 'library');
  await page.locator('#manage-branches').click();
  await page.locator(`[data-delete-branch="${category}"]`).click();
  await page.locator('#confirm-category-delete').click();
  await page.locator('#close-modal').click();
  expect((await draft(page)).catalog.branches).toHaveLength(1);
  expect((await draft(page)).catalog.nodes).toHaveLength(1);
  await panel(page, 'canvas');
  await page.locator('#undo').click();
  expect((await draft(page)).catalog.nodes[0].branchId).toBe(category);
});

test('窄屏目录、编辑、画布与弹窗均可操作', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await newProject(page, '窄屏验收');
  await expect(page.locator('#canvas-empty')).toBeVisible();
  await page.locator('#empty-add').click();
  await field(page, 'name').fill('窄屏技能');
  await page.locator('#add-level').click();
  await expect(page.locator('.level-item')).toHaveCount(2);
  await panel(page, 'canvas');
  await expect(card(page, '窄屏技能')).toBeVisible();
  await card(page, '窄屏技能').getByRole('heading').click();
  await expect(page.locator('.workspace')).toHaveAttribute('data-panel', 'inspector');
  await panel(page, 'library');
  await page.locator('#search').fill('窄屏');
  await page.locator('[data-select]').click();
  await expect(page.locator('.workspace')).toHaveAttribute('data-panel', 'inspector');
  await screenshot(page, info, 'narrow-inspector');
  for (const width of [320, 390, 760, 800]) {
    await page.setViewportSize({ width, height: 844 });
    await panel(page, 'canvas');
    await assertInside(page, page.locator('#export-catalog'));
    await assertInside(page, page.locator('#open-preview'));
    await assertInside(page, page.locator('#fit-view'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('结构化效果连续输入只撤销一个编辑动作', async ({ page }) => {
  await newProject(page);
  await variable(page, '力量', 'number', 10);
  await add(page, '训练');
  await page.locator('[data-add-effect="0"]').click();
  const effectValue = page.getByLabel('效果值', { exact: true });
  await effectValue.fill('');
  await effectValue.pressSequentially('123');
  await effectValue.press('Tab');
  await panel(page, 'canvas');
  await page.locator('#undo').click();
  expect((await draft(page)).catalog.nodes[0].levels[0].effects[0].value).toBe(0);
  await page.locator('#redo').click();
  expect((await draft(page)).catalog.nodes[0].levels[0].effects[0].value).toBe(123);
});
