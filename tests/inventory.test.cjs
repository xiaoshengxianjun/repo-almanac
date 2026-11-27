const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { analyzeUpgrades, compareMetadata } = require('../engine/upgrades.cjs')
const { lookupPolicy } = require('../engine/inventory.cjs')
const {
  readRegistryMetadata,
  refreshVersions,
} = require('../desktop/registry.cjs')
const { scanProject } = require('../engine/scan.cjs')

const rootManifest = { name: 'site', dependencies: { nuxt: '^2.3.0' } }
const yarnLock =
  '# yarn lockfile v1\n\nnuxt@^2.3.0:\n  version "2.3.0"\n  resolved "https://registry.yarnpkg.com/nuxt/-/nuxt-2.3.0.tgz"\n'
const versions = {
  '2.3.0': {},
  '2.18.1': {},
  '4.0.0': {},
  '4.1.0': { deprecated: 'withdrawn' },
  '5.0.0-beta.1': {},
}
const meta = {
  versions,
  'dist-tags': { latest: '5.0.0-beta.1' },
  _checkedAt: 20,
}
function project(manifest, files) {
  const texts = new Map([['package.json', JSON.stringify(manifest)], ...files])
  return analyzeUpgrades(texts, [...texts.keys()]).projects[0]
}
test('stable, acceptable range and latest tag remain distinct; absent locks never imply a numeric gap', () => {
  const { deps } = project(rootManifest, [['yarn.lock', yarnLock]])
  assert.equal(deps[0].version, '2.3.0')
  const cmp = compareMetadata(deps[0], meta)
  assert.deepEqual(
    [cmp.latest, cmp.within, cmp.tag, cmp.gap],
    ['4.0.0', '2.18.1', '5.0.0-beta.1', '落后 2 个主版本'],
  )
  assert.equal(
    compareMetadata({ ...deps[0], version: null }, meta).gap,
    '锁定版本未知',
  )
  assert.equal(
    compareMetadata(deps[0], { versions: { '5.0.0-beta.1': {} } }).gap,
    '无稳定版本',
  )
})
test('lock selection respects the declared manager; pnpm workspace importers and Yarn Berry groups resolve separately', () => {
  const berry =
    '__metadata:\n  version: 8\n"nuxt@npm:^2.3.0, nuxt@npm:~2.3.0":\n  version: 2.3.0\n'
  const files = [
    ['yarn.lock', berry],
    ['package-lock.json', '{"packages":{}}'],
  ]
  assert.equal(project(rootManifest, files).conflict, true)
  assert.equal(
    project({ ...rootManifest, packageManager: 'yarn@4.0.0' }, files).deps[0]
      .version,
    '2.3.0',
  )
  const ambiguous = project(rootManifest, files)
  assert.equal(ambiguous.deps[0].version, null)
  assert.equal(
    compareMetadata(ambiguous.deps[0], meta).gap,
    'yarn · 落后 2 个主版本',
  )
  const texts = new Map([
    ['package.json', '{"packageManager":"pnpm@9.0.0"}'],
    ['apps/web/package.json', JSON.stringify(rootManifest)],
    [
      'pnpm-lock.yaml',
      "lockfileVersion: '9.0'\nimporters:\n  apps/web:\n    dependencies:\n      nuxt:\n        specifier: ^2.3.0\n        version: 2.3.4(vue@2.6.0)\n",
    ],
  ])
  assert.equal(
    analyzeUpgrades(texts, [...texts.keys()]).projects[1].deps[0].version,
    '2.3.4',
  )
})
test('private hosts, ambiguous scoped names, workspace and git references never enter requests', async () => {
  const privateSet = new Set(['internal'])
  const reason = (name, range, item, blocked = []) =>
    lookupPolicy(name, range, item, privateSet, new Set(blocked))
  assert.equal(
    reason('ordinary', '^1', {
      resolved: 'https://registry.npmjs.org/ordinary/-/ordinary-1.tgz',
    }),
    '',
  )
  assert.equal(
    reason('ordinary', '^1', {
      resolved: 'https://registry.npmmirror.com/ordinary/-/ordinary-1.0.0.tgz',
    }),
    '',
  )
  assert.ok(
    reason('ordinary', '^1', {
      resolved:
        'https://registry.npmmirror.com.example/ordinary/-/ordinary-1.0.0.tgz',
    }),
  )
  for (const args of [
    ['nuxt', '^2', { resolved: 'https://private.test/nuxt.tgz' }],
    [
      '@internal/staff',
      '1',
      { resolved: 'https://registry.npmjs.org/@internal/staff/-/staff-1.tgz' },
    ],
    ['internal', '1'],
    ['axios', 'git+ssh://private.test/pkg'],
    ['vue', '1', { link: true }],
    ['nuxt', '2', {}, ['*']],
    ['@nuxtjs/axios', '5', {}, ['@nuxtjs']],
  ])
    assert.ok(reason(...args))
  const p = project(
    { ...rootManifest, optionalDependencies: { hidden: 'file:../hidden' } },
    [],
  )
  const seen = []
  const result = await refreshVersions(
    { projects: [p, { ...p, file: 'app/package.json' }], findings: [] },
    async (name) => {
      seen.push(name)
      return meta
    },
    new AbortController().signal,
  )
  assert.deepEqual(seen, ['nuxt'])
  assert.equal(
    result.projects[1].deps.find((d) => d.name === 'nuxt').comparison.latest,
    '4.0.0',
  )
  assert.equal(
    result.projects[0].deps.find((d) => d.name === 'hidden').comparison,
    undefined,
  )
})
test('scanner reads static Nuxt module and plugin evidence, honors ignored registry settings, and keeps credentials outside the snapshot', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-inventory-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const [file, src] of [
    ['package.json', JSON.stringify(rootManifest)],
    ['.gitignore', '.npmrc\n'],
    [
      '.npmrc',
      'registry=https://private.test\n//private.test/:_authToken=CANARY_TOKEN\n',
    ],
    ['yarn.lock', yarnLock],
    [
      'nuxt.config.js',
      "const config = {\n modules:[['@nuxtjs/axios',{}]],\n plugins:[{src:'~/plugins/cart.js'}, ...additional]\n}\nmodule.exports = config",
    ],
  ])
    fs.writeFileSync(path.join(root, file), src)
  const s = scanProject(root, ':memory:')
  const p = s.projects[0]
  assert.equal(p.deps[0].lookup, false)
  assert.deepEqual(
    p.config.registrations.map((r) => [r.name, r.line]),
    [
      ['@nuxtjs/axios', 2],
      ['~/plugins/cart.js', 3],
    ],
  )
  assert.equal(p.config.dynamic, true)
  assert.ok(!JSON.stringify(s).includes('CANARY_TOKEN'))
})
test('fresh cache, offline cache, uncached failures and project cancellation are distinguishable', async (t) => {
  const signal = new AbortController().signal
  const cache = { nuxt: { time: Date.now(), meta } }
  const offline = t.mock.method(globalThis, 'fetch', async () => {
    throw Error('offline')
  })
  assert.equal(
    (await readRegistryMetadata('nuxt', cache, signal))._checkedAt,
    cache.nuxt.time,
  )
  assert.equal(offline.mock.callCount(), 0)
  cache.nuxt.time -= 86400001
  assert.equal((await readRegistryMetadata('nuxt', cache, signal))._stale, true)
  const p = project(rootManifest, [])
  const result = await refreshVersions(
    { projects: [p], findings: [] },
    (n) => readRegistryMetadata(n, {}, signal),
    signal,
  )
  assert.equal(result.projects[0].deps[0].comparison.gap, '查询失败')
  const controller = new AbortController()
  await assert.rejects(
    refreshVersions(
      { projects: [p], findings: [] },
      async () => {
        controller.abort()
        return meta
      },
      controller.signal,
    ),
    { name: 'AbortError' },
  )
})
