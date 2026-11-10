import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(projectRoot, 'node_modules/@mediapipe/tasks-vision/wasm');
const destination = resolve(projectRoot, 'public/wasm');

await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
console.log('Copied MediaPipe WASM assets to public/wasm');
