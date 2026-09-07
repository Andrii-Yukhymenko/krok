import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = 'dist/client';
async function list(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? list(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat();
}
const assets = (await list(root))
  .filter((file) => /\.(js|css|woff2)$/.test(file) && !file.endsWith('/sw.js'))
  .map((file) => '/' + path.relative(root, file).split(path.sep).join('/'));
const version = createHash('sha256')
  .update(assets.join('|'))
  .digest('hex')
  .slice(0, 12);
let sw = await readFile('public/sw.js', 'utf8');
sw = sw
  .replace('krok-v1', 'krok-' + version)
  .replace(
    "const PRECACHE = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];",
    'const PRECACHE = ' +
      JSON.stringify([
        '/',
        '/manifest.webmanifest',
        '/icon-192.png',
        '/icon-512.png',
        ...assets,
      ]) +
      ';',
  );
await writeFile(path.join(root, 'sw.js'), sw);
console.log('PWA precache prepared: ' + assets.length + ' local assets.');
