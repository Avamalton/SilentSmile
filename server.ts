import fs from 'node:fs';
import path from 'node:path';

const distBundle = path.resolve(process.cwd(), 'server-dist.mjs');

// In production (or when pre-bundled server-dist.mjs exists and we are not in dev), execute the bundled server
const isDev = process.env.npm_lifecycle_event === 'dev';
if (!isDev && fs.existsSync(distBundle)) {
  await import('./server-dist.mjs');
} else {
  // In development, dynamic import handles TypeScript resolution seamlessly with tsx
  await import('./src/server/app.ts');
}
