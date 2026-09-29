import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { siteBase } from './site-base.mjs';

const source = await readFile(
  new URL('../public/sw.js', import.meta.url),
  'utf8',
);
function worker(base) {
  const events = {};
  const added = [];
  const deleted = [];
  const matches = [];
  const root = 'https://example.github.io' + base;
  vm.runInNewContext(source, {
    URL,
    Response,
    self: {
      location: new URL(root + 'sw.js'),
      addEventListener: (type, handler) => {
        events[type] = handler;
      },
      clients: { claim: async () => {} },
    },
    caches: {
      open: async () => ({ addAll: async (urls) => added.push(...urls) }),
      keys: async () => [
        'krok-' + base + '-old',
        'krok-/other-app/-old',
        'unrelated',
      ],
      delete: async (key) => deleted.push(key),
      match: async (url) => {
        matches.push(url);
        return new Response('offline shell');
      },
    },
    fetch: async () => {
      throw new Error('offline');
    },
  });
  return { events, added, deleted, matches, root };
}

for (const base of ['/', '/daily-step-map/']) {
  test('PWA precache and offline navigation use scope ' + base, async () => {
    const state = worker(base);
    let pending = Promise.resolve();
    state.events.install({
      waitUntil: (promise) => {
        pending = promise;
      },
    });
    await pending;
    assert.equal(state.added[0], state.root);
    assert.ok(state.added.every((url) => url.startsWith(state.root)));
    let navigation = Promise.resolve(new Response());
    state.events.fetch({
      request: { url: state.root, method: 'GET', mode: 'navigate' },
      respondWith: (promise) => {
        navigation = promise;
      },
    });
    assert.equal(await (await navigation).text(), 'offline shell');
    assert.deepEqual(state.matches, [state.root]);
  });
}

test('PWA updates leave other GitHub Pages applications and external requests alone', async () => {
  const { events, deleted } = worker('/daily-step-map/');
  let pending = Promise.resolve();
  events.activate({
    waitUntil: (promise) => {
      pending = promise;
    },
  });
  await pending;
  assert.deepEqual(deleted, ['krok-/daily-step-map/-old']);
  for (const url of [
    'https://example.github.io/other-app/main.js',
    'https://tile.openstreetmap.org/1/1/1.png',
  ]) {
    events.fetch({
      request: { url, method: 'GET' },
      respondWith: () => assert.fail('Unexpected interception'),
    });
  }
});

test('Build base accepts root and repository paths and rejects invalid URL paths', () => {
  assert.equal(siteBase(), '/');
  assert.equal(siteBase('daily-step-map'), '/daily-step-map/');
  assert.equal(siteBase('/daily-step-map/'), '/daily-step-map/');
  for (const value of ['/../', '/foo?bar/', 'https://example.com/'])
    assert.throws(() => siteBase(value));
});
