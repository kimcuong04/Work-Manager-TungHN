import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import path from 'node:path';
import electronPath from 'electron';
import { buildMain } from './build-main.mjs';

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[dev] renderer: ${url}`);

await buildMain();

// Dev luôn dùng dữ liệu riêng (.dev-data) để thử nghiệm không đụng vào dữ liệu thật của bản cài.
// Muốn thử trên một bản sao dữ liệu thật: copy thư mục data vào .dev-data, hoặc đặt PPM_DATA_DIR.
const dataDir = process.env.PPM_DATA_DIR || path.resolve('.dev-data');
console.log(`[dev] data: ${dataDir}`);

const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url, PPM_DATA_DIR: dataDir },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
