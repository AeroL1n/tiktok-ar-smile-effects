// 占位烟花：只用来确认触发时机，正式烟花会在下一步替换。
export function createPlaceholderFireworks(rules) {
  const bursts = [];

  function launch(px, py, now) {
    bursts.push({ x: px, y: py, start: now });
  }

  function draw(ctx, now, width) {
    const life = rules.fireworks.lifetimeMs;
    for (let i = bursts.length - 1; i >= 0; i -= 1) {
      const t = (now - bursts[i].start) / life;
      if (t >= 1) {
        bursts.splice(i, 1);
        continue;
      }
      ctx.strokeStyle = `rgba(255, 199, 138, ${1 - t})`;
      ctx.lineWidth = Math.max(2, width / 220) * (1 - t * 0.6);
      ctx.beginPath();
      ctx.arc(bursts[i].x, bursts[i].y, width * 0.04 + width * 0.22 * t, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function clear() {
    bursts.length = 0;
  }

  return { launch, draw, clear, get burstCount() { return bursts.length; } };
}
