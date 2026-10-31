import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync, existsSync} from 'node:fs';

function worker() {
  const handlers = {}, stores = new Map();
  const scope = 'https://example.com/chord-voicing/';
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const data = stores.get(name);
      return {
        async addAll(paths) { for (const path of paths) data.set(new URL(path, scope).href, {path}); },
        async match(url) { return data.get(url); }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(key) { return stores.delete(key); }
  };
  vm.runInNewContext(readFileSync(new URL('../dist/sw.js', import.meta.url), 'utf8'), {
    self: {registration: {scope}, addEventListener: (type, fn) => handlers[type] = fn},
    caches, URL, fetch() { throw new Error('offline'); }
  });
  return {handlers, stores, scope};
}

test('all install assets exist and manifest stays within deployment subdirectory', () => {
  const manifest = JSON.parse(readFileSync(new URL('../dist/manifest.webmanifest', import.meta.url)));
  assert.equal(manifest.display, 'standalone');
  for (const field of ['id', 'scope', 'start_url']) assert.equal(manifest[field], './');
  for (const icon of manifest.icons) {
    const png = readFileSync(new URL(`../dist/${icon.src}`, import.meta.url));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});

test('subdirectory app opens offline; updates only remove this app’s old caches', async () => {
  const {handlers, stores, scope} = worker();
  await new Promise((resolve, reject) => handlers.install({waitUntil: p => p.then(resolve, reject)}));
  for (const url of [...stores.values()][0].keys()) {
    const path = new URL(url).pathname.replace('/chord-voicing/', '') || 'index.html';
    assert.ok(existsSync(new URL(`../dist/${path}`, import.meta.url)), path);
    let response;
    handlers.fetch({request: {url: url + '?source=app', method: 'GET'}, respondWith: p => response = p});
    assert.ok(await response);
  }
  stores.set(`voicing-${scope}-old`, new Map());
  stores.set('another-app', new Map());
  await new Promise((resolve, reject) => handlers.activate({waitUntil: p => p.then(resolve, reject)}));
  assert.ok(stores.has('another-app'));
  assert.ok(!stores.has(`voicing-${scope}-old`));
  handlers.fetch({request: {url: 'https://example.com/other/', method: 'GET'}, respondWith() {assert.fail('unrelated request intercepted');}});
});
