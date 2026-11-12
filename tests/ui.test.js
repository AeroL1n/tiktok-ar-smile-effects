import test, { after } from 'node:test';
import assert from 'node:assert/strict';

// 文案和状态显示不依赖浏览器；摄像头资源释放另由浏览器流程测试验证。
const originalDocument = globalThis.document;
const nodes = new Map();
globalThis.document = {
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '', dataset: {}, style: {}, hidden: false });
    return nodes.get(id);
  },
  querySelectorAll() { return []; }
};
const ui = await import('../src/app/ui.js');
after(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

test('摄像头按钮：未启动、加载、运行、暂停和失败使用对应操作文案', () => {
  for (const [mode, label] of Object.entries({
    idle: '开启摄像头', loading: '正在启动…', live: '关闭摄像头', paused: '开启摄像头', error: '重试'
  })) {
    ui.setMode(mode, mode);
    assert.equal(ui.els.button.textContent, label);
    assert.equal(ui.els.status.dataset.mode, mode);
  }
});

test('隐藏占位不会覆盖摄像头关闭或加载文案', () => {
  for (const mode of ['loading', 'live']) {
    ui.setMode(mode, mode);
    const label = ui.els.button.textContent;
    ui.hidePlaceholder();
    assert.equal(ui.els.placeholder.hidden, true);
    assert.equal(ui.els.button.textContent, label);
  }
  ui.showPlaceholder('摄像头已关闭', '开启摄像头');
  assert.equal(ui.els.placeholder.hidden, false);
  assert.equal(ui.els.button.textContent, '开启摄像头');
});

test('状态行：待机引导、失败原因和演示静默状态互不覆盖', () => {
  ui.renderStage({ phase: 'running', state: 'idle', reason: '', hint: '' });
  assert.equal(ui.els.reason.textContent, '微笑下雨，大笑放烟花');
  ui.renderStage({ phase: 'running', state: 'idle', reason: '光线太暗', hint: '' });
  assert.equal(ui.els.reason.textContent, '光线太暗');
  ui.renderDemoStage('laugh');
  assert.equal(ui.els.reason.textContent, '');
  assert.equal(ui.els.state.textContent, '大笑 · 烟花');
});
