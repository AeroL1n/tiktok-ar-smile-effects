import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));
const recordingsDir = resolve(root, 'test/recordings');
const SLUG = /^[a-z-]{1,24}$/;
const MAX_BYTES = 2 * 1024 * 1024;

// 只在开发服务器里生效：把页面录到的识别数据存进 test/recordings/（不进仓库）。
function saveRecordings() {
  return {
    name: 'save-recordings',
    configureServer(server) {
      server.middlewares.use('/__recordings', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        let size = 0;
        const chunks = [];
        req.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) req.destroy();
          else chunks.push(chunk);
        });
        req.on('end', async () => {
          try {
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!SLUG.test(data.label) || !Array.isArray(data.rows)) throw new Error('bad payload');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const file = `${stamp}-${data.label}.json`;
            await mkdir(recordingsDir, { recursive: true });
            await writeFile(resolve(recordingsDir, file), JSON.stringify(data));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ file }));
          } catch {
            res.statusCode = 400;
            res.end();
          }
        });
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [saveRecordings()]
});
