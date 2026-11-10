// 用开发时录制的真人数据回放规则。录制文件在 test/recordings/（不进仓库），没有文件时跳过。
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULES } from '../src/rules/config.js';
import { createExpressionMachine } from '../src/rules/expression.js';
import { createFireworkScheduler } from '../src/rules/effects.js';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../test/recordings');
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];

// 期望：张嘴大笑至少放一次烟花；其余都不能放烟花（轻轻笑出声目前判成下雨，是已知局限）。
const EXPECT_FIREWORK = { 'big-laugh': true, 'teeth-smile': false, 'light-laugh': false, 'laugh-talk': false, cry: false };

function replay(recording) {
  const machine = createExpressionMachine(RULES);
  const scheduler = createFireworkScheduler(RULES.fireworks);
  for (let t = 0; t <= RULES.calibration.durationMs + 50; t += 50) {
    machine.update({ now: t, face: { smile: 0, jaw: 0, lipGap: 0, squint: 0.2 } });
  }
  const offset = RULES.calibration.durationMs + 100;
  const col = new Map(recording.columns.map((name, i) => [name, i]));
  const get = (row, name) => row[col.get(name)];
  const pair = (row, name) => (get(row, `${name}Left`) + get(row, `${name}Right`)) / 2;
  let launches = 0;
  for (const row of recording.rows) {
    const now = offset + get(row, 't');
    const hasFace = get(row, 'mouthSmileLeft') !== null;
    const face = hasFace
      ? {
          smile: pair(row, 'mouthSmile'),
          jaw: get(row, 'jawOpen'),
          lipGap: get(row, 'lipGap'),
          squint: pair(row, 'eyeSquint'),
          upperUp: pair(row, 'mouthUpperUp'),
          browDown: pair(row, 'browDown')
        }
      : null;
    const view = machine.update({ now, face });
    if (scheduler.update(now, view.state === 'laugh').launch) launches += 1;
  }
  return launches;
}

for (const file of files) {
  const recording = JSON.parse(readFileSync(resolve(dir, file), 'utf8'));
  const expected = EXPECT_FIREWORK[recording.label];
  if (expected === undefined || !recording.rows.length) continue;
  test(`录制回放：${recording.labelName}（${file.slice(11, 19)}）${expected ? '放烟花' : '不放烟花'}`, () => {
    const launches = replay(recording);
    if (expected) assert.ok(launches >= 1, `应该放烟花，实际 ${launches} 次`);
    else assert.equal(launches, 0, `不应该放烟花，实际 ${launches} 次`);
  });
}
