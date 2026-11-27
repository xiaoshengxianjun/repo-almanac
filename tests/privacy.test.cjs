const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { scanProject } = require('../engine/scan.cjs')
const { database, readSource } = require('../engine/storage.cjs')
const { assertSeparateWorkspace } = require('../engine/project-paths.cjs')
const { saveReport } = require('../desktop/report.cjs')

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'almanac-privacy-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const root = path.join(dir, 'project')
  const workspace = path.join(dir, 'workspace')
  fs.mkdirSync(root)
  fs.mkdirSync(workspace)
  fs.writeFileSync(path.join(root, 'main.ts'), 'export const value = 1\n')
  fs.writeFileSync(path.join(root, '.gitignore'), 'build/\n')
  fs.mkdirSync(path.join(root, '.git'))
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  return { dir, root, workspace }
}

// Exclude access time, which the filesystem can update on any read.
function tree(dir) {
  const stat = fs.lstatSync(dir, { bigint: true })
  const contents = stat.isDirectory()
    ? fs
        .readdirSync(dir)
        .sort()
        .map((name) => [name, tree(path.join(dir, name))])
    : fs.readFileSync(dir)
  return [stat.mode, stat.mtimeNs, contents]
}

test('scanning, rescanning and reading source preserve the project tree', (t) => {
  const { root, workspace } = fixture(t)
  const before = tree(root)
  for (const name of ['first.sqlite', 'next.sqlite']) {
    const file = path.join(workspace, name)
    const snapshot = scanProject(root, file)
    const db = database(file)
    try {
      assert.match(
        readSource(db, snapshot.root, 'main.ts').lines[0],
        /value = 1/,
      )
    } finally {
      db.close()
    }
    assert.deepEqual(tree(root), before)
  }
})

test('overlapping roots and project-local index paths are rejected before writing', (t) => {
  const { dir, root, workspace } = fixture(t)
  const alias = path.join(dir, 'project-alias')
  fs.symlinkSync(root, alias, 'junction')
  const before = tree(root)
  assert.doesNotThrow(() => assertSeparateWorkspace(root, workspace))
  for (const candidate of [dir, workspace])
    assert.throws(() => assertSeparateWorkspace(candidate, workspace), /重叠/)
  assert.throws(
    () => assertSeparateWorkspace(path.join(root, '.git'), alias),
    /重叠/,
  )
  for (const parent of [root, alias, path.join(alias, '.git')])
    assert.throws(
      () => scanProject(root, path.join(parent, 'new.sqlite')),
      /之外/,
    )
  const existing = path.join(workspace, 'existing.sqlite')
  fs.writeFileSync(existing, 'original')
  assert.throws(() => scanProject(root, existing), { code: 'EEXIST' })
  assert.equal(fs.readFileSync(existing, 'utf8'), 'original')
  assert.deepEqual(tree(root), before)
})

test('export only writes ordinary files outside the project and private workspace', async (t) => {
  const { dir, root, workspace } = fixture(t)
  const alias = path.join(dir, 'alias')
  fs.symlinkSync(root, alias, 'junction')
  const linked = path.join(dir, 'linked.md')
  fs.linkSync(path.join(root, 'main.ts'), linked)
  const before = tree(root)
  const s = scanProject(root, ':memory:')
  for (const dest of [
    path.join(root, 'main.ts'),
    path.join(alias, 'report.md'),
    path.join(workspace, 'report.md'),
    linked,
  ])
    await assert.rejects(saveReport(s, dest, [workspace]), /之外|普通文件/)
  const dest = path.join(dir, 'report.md')
  fs.writeFileSync(dest, 'previous report')
  await saveReport(s, dest, [workspace])
  assert.match(fs.readFileSync(dest, 'utf8'), /项目分析报告/)
  assert.deepEqual(fs.readdirSync(workspace), [])
  assert.deepEqual(tree(root), before)
})
