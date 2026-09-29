import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const root = 'dist';
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
  .filter(
    (file) =>
      /\.(js|css|woff2|png|svg|webmanifest)$/.test(file) &&
      path.basename(file) !== 'sw.js',
  )
  .map((file) => path.relative(root, file).split(path.sep).join('/'))
  .sort();
const hash = createHash('sha256');
for (const file of ['index.html', ...assets]) {
  hash.update(file).update(await readFile(path.join(root, file)));
}
hash.update(await readFile('public/sw.js'));
const version = hash.digest('hex').slice(0, 12);
let sw = await readFile('public/sw.js', 'utf8');
sw = sw
  .replace("CACHE_PREFIX + 'v1'", 'CACHE_PREFIX + ' + JSON.stringify(version))
  .replace(
    "const PRECACHE = ['.', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];",
    'const PRECACHE = ' + JSON.stringify(['.', ...assets]) + ';',
  );
await writeFile(path.join(root, 'sw.js'), sw);
await writeFile(path.join(root, '.nojekyll'), '');
console.log('PWA precache prepared: ' + assets.length + ' local assets.');
