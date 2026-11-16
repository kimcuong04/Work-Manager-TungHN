import { build } from 'esbuild';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  packages: 'external',
  logLevel: 'info',
};

export async function buildMain() {
  await Promise.all([
    build({ ...shared, entryPoints: ['src/main/main.ts'], outfile: 'dist-electron/main.js', external: ['electron'] }),
    build({ ...shared, entryPoints: ['src/main/preload.ts'], outfile: 'dist-electron/preload.js', external: ['electron'] }),
  ]);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  await buildMain();
}
