const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os')
const { scanProject } = require('../engine/scan.cjs')
const { database, readSource, fileQuery } = require('../engine/storage.cjs')
const {
  analyzeUpgrades,
  lookupProject,
  evaluate,
} = require('../engine/upgrades.cjs')
const { analyzeCode } = require('../engine/trace.cjs')
const noteSources = new Map([
  [
    'src/router.ts',
    `import { createRouter } from 'vue-router'
import Notes from './Notes.vue'
createRouter({ routes: [{ path: '/notes', component: Notes }] })`,
  ],
  [
    'src/Notes.vue',
    `<template>
  <button @click="sync">同步笔记</button>
  <button @click="keep">本地暂存</button>
</template>
<script setup>
import { send } from './network'
function sync() { return send() }
function keep() { localStorage.setItem('note', 'text') }
</script>`,
  ],
  [
    'src/network.ts',
    "export function send() { return fetch('/api/notes', { method: 'POST' }) }",
  ],
  [
    'server/index.mjs',
    `import express from 'express'
import { routes } from './routes.mjs'
const app = express()
app.use('/api', routes)
app.listen(4781)`,
  ],
  [
    'server/routes.mjs',
    `import { Router } from 'express'
import { writeNote } from './handlers.mjs'
export const routes = Router()
routes.post('/notes', writeNote)`,
  ],
  ['server/handlers.mjs', 'export function writeNote(req, res) { res.end() }'],
  [
    'vite.config.ts',
    `import { defineConfig } from 'vite'
export default defineConfig({ server: { proxy: { '/api': 'http://localhost:4781' } }, worker: { plugins: [] } })`,
  ],
])
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-almanac-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}
test('source locations connect a network action to its handler and distinguish local storage', (t) => {
  const root = fixture(t)
  for (const [file, content] of [
    ...noteSources,
    ['package.json', '{"name":"notes","devDependencies":{"vite":"^4"}}'],
    [
      'package-lock.json',
      '{"lockfileVersion":3,"packages":{"node_modules/vite":{"version":"4.5.14"}}}',
    ],
    ['.github/workflows/build.yml', "node-version: '16.20.2'"],
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), content)
  }
  const dbPath = path.join(fixture(t), 'index.sqlite')
  const s = scanProject(root, dbPath)
  const db = database(dbPath)
  t.after(() => db.close())
  assert.equal(s.flows.length, 2)
  const submit = s.flows.find((f) => f.name === '同步笔记'),
    draft = s.flows.find((f) => f.name === '本地暂存')
  assert.equal(submit.steps.at(-1).label, 'writeNote')
  assert.equal(submit.steps.at(-1).file, 'server/handlers.mjs')
  assert.equal(draft.steps.at(-1).type, 'storage')
  assert.ok(!draft.steps.some((e) => e.type === 'http'))
  for (const f of s.flows)
    for (const e of f.steps) {
      const view = readSource(db, s.root, e.file, e.line)
      assert.ok(view.lines[e.line - view.start]?.trim())
    }
  assert.equal(s.findings[0].status, 'blocked')
  assert.deepEqual(s.findings[0].checks, [
    'CI 使用 Node 16.20.2，目标要求 ^18.0.0 || >=20.0.0',
  ])
  assert.ok(s.findings.some((f) => f.name === 'worker.plugins'))
})
test('partial, external and ambiguous backends stop at a request', () => {
  const texts = new Map(noteSources)
  const a = new Map(texts)
  a.delete('vite.config.ts')
  const noProxy = analyzeCode(a, []).flows.find((f) => f.name === '同步笔记')
  assert.equal(noProxy.steps.at(-1).type, 'http')
  assert.ok(noProxy.notes.length)
  texts.set('server/another.mjs', texts.get('server/index.mjs'))
  const multiple = analyzeCode(texts, []).flows.find(
    (f) => f.name === '同步笔记',
  )
  assert.equal(multiple.steps.at(-1).type, 'http')
})
test('full and business counts, zero bytes, symlinks, path containment and stale previews', (t) => {
  const dir = fixture(t),
    root = path.join(dir, '工作区')
  fs.mkdirSync(root)
  fs.mkdirSync(path.join(root, 'dist'))
  fs.writeFileSync(path.join(root, 'dist/a'), 'abcdef')
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.txt\n')
  fs.writeFileSync(path.join(root, 'ignored.txt'), 'skip')
  fs.writeFileSync(path.join(root, 'index.ts'), 'export const num=20')
  fs.writeFileSync(path.join(root, 'empty'), '')
  fs.symlinkSync(os.tmpdir(), path.join(root, 'link'), 'dir')
  const loc = path.join(dir, 'index.sqlite'),
    s = scanProject(root, loc),
    db = database(loc)
  t.after(() => db.close())
  assert.equal(s.fileCount, 5)
  assert.equal(s.links, 1)
  assert.equal(fileQuery(db, { business: true }).n, 3)
  assert.equal(fileQuery(db, { folder: 'dist' }).bytes, 6)
  assert.equal(fileQuery(db, { query: 'empty' }).rows[0].bytes, 0)
  assert.throws(() => readSource(db, s.root, '../index.sqlite'))
  fs.writeFileSync(path.join(root, 'index.ts'), 'export const num=3')
  assert.throws(() => readSource(db, s.root, 'index.ts'), /变更/)
})
test('legacy locks, latest and in-range candidates, CI and peer constraints', async () => {
  for (const v of [1, 2, 3]) {
    const lock =
      v === 1
        ? { lockfileVersion: 1, dependencies: { vue: { version: '3.1.0' } } }
        : {
            lockfileVersion: v,
            packages: { 'node_modules/vue': { version: '3.1.0' } },
          }
    const texts = new Map([
      ['package.json', '{"name":"demo","dependencies":{"vue":"^3.0.0"}}'],
      ['package-lock.json', JSON.stringify(lock)],
    ])
    const p = analyzeUpgrades(texts, ['package.json']).projects[0]
    assert.equal(p.deps[0].version, '3.1.0')
    const meta = {
      versions: { '3.4.0': {}, '4.0.0': { engines: { node: '>=20' } } },
      'dist-tags': { latest: '4.0.0' },
    }
    const r = await lookupProject(p, async () => meta, ['vue'])
    assert.deepEqual(
      r.results.map((f) => f.status),
      ['ready', 'unknown'],
    )
    p.env = [{ kind: 'CI', value: '16', file: 'ci.yml', line: 2 }]
    assert.equal(
      evaluate(p, p.deps[0], '4.0.0', { node: '>=20' }, {}, 'test').status,
      'blocked',
    )
    p.deps.push({ name: 'plugin', peers: { vue: '^3' }, version: '1.0.0' })
    assert.equal(
      evaluate(p, p.deps[0], '4.0.0', {}, {}, 'test').status,
      'blocked',
    )
    assert.deepEqual(
      (
        await lookupProject(p, async () => {
          throw Error('offline')
        }, ['vue'])
      ).errors,
      ['vue · offline'],
    )
  }
})
test('unsupported directories still yield a useful inventory and technology signals', (t) => {
  const root = fixture(t)
  fs.writeFileSync(path.join(root, 'go.mod'), 'module sample\n')
  fs.writeFileSync(path.join(root, 'file.go'), 'package main\n')
  const s = scanProject(root, ':memory:')
  assert.equal(s.fileCount, 2)
  assert.deepEqual(s.tags, ['Go'])
  assert.equal(s.flows.length, 0)
  assert.equal(s.findings.length, 0)
})
