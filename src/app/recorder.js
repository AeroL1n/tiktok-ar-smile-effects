// 连续录制一段时间的识别数据，用来定动态规则（例如“笑的节奏”）。纯数据，不碰页面。
export const RECORD_LABELS = Object.freeze([
  { slug: 'teeth-smile', name: '静止的露齿笑' },
  { slug: 'light-laugh', name: '轻轻笑出声' },
  { slug: 'big-laugh', name: '张大嘴大笑' },
  { slug: 'laugh-talk', name: '边笑边说话' },
  { slug: 'cry', name: '哭脸' },
  { slug: 'other', name: '其他' }
]);

const round = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);

export function createRecorder({ countdownMs = 3000, durationMs = 3000 } = {}) {
  let session = null;

  function start(slug, now) {
    const label = RECORD_LABELS.find((l) => l.slug === slug) ?? RECORD_LABELS.at(-1);
    session = { label, startAt: now + countdownMs, endAt: now + countdownMs + durationMs, columns: null, rows: [] };
  }

  function cancel() {
    session = null;
  }

  // frame: { blendshapes: [{categoryName, score}], extra: { 名称: 数值 } }，没有人脸时 blendshapes 为空。
  // 返回 { phase: 'idle' | 'countdown' | 'recording' | 'done', remainingMs, result }
  function update(now, frame) {
    if (!session) return { phase: 'idle' };
    if (now < session.startAt) return { phase: 'countdown', remainingMs: session.startAt - now };

    if (now < session.endAt) {
      const names = (frame?.blendshapes ?? []).map((c) => c.categoryName);
      const extraNames = Object.keys(frame?.extra ?? {});
      if (!session.columns && names.length) session.columns = ['t', ...extraNames, ...names];
      if (session.columns) {
        const values = new Map((frame?.blendshapes ?? []).map((c) => [c.categoryName, c.score]));
        for (const [k, v] of Object.entries(frame?.extra ?? {})) values.set(k, v);
        session.rows.push(session.columns.map((col) => (col === 't' ? Math.round(now - session.startAt) : round(values.get(col)))));
      }
      return { phase: 'recording', remainingMs: session.endAt - now };
    }

    const result = {
      label: session.label.slug,
      labelName: session.label.name,
      recordedAt: new Date().toISOString(),
      durationMs: Math.round(session.endAt - session.startAt),
      columns: session.columns ?? [],
      rows: session.rows
    };
    session = null;
    return { phase: 'done', result };
  }

  return { start, cancel, update, get active() { return session !== null; } };
}
