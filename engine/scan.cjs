const fs = require('node:fs')
const path = require('node:path')
const ignore = require('ignore')
const { createHash } = require('node:crypto')
const { database, kindOf, overviewStats } = require('./storage.cjs')
const { registryRoutes } = require('./inventory.cjs')
const { buildFeatureMap } = require('./feature-map.cjs')
const { analyzeCode } = require('./trace.cjs')
const { analyzeUpgrades } = require('./upgrades.cjs')
const { containsDirectory } = require('./project-paths.cjs')

const inventoryVersion = 4
const generated = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  'target',
  'vendor',
  '.venv',
  '.gradle',
  '.cache',
  '__pycache__',
])
function scanProject(input, dbPath, onProgress = () => {}) {
  const root = fs.realpathSync(input)
  if (!fs.statSync(root).isDirectory()) throw new Error('请选择一个项目目录。')
  if (dbPath !== ':memory:') {
    dbPath = path.resolve(dbPath)
    if (containsDirectory(root, path.dirname(dbPath)))
      throw Error('索引必须保存在被分析项目之外。')
    // Each scan owns a fresh index. Never open an existing file for creation.
    fs.closeSync(fs.openSync(dbPath, 'wx', 0o600))
  }
  const db = database(dbPath, true)
  const texts = new Map(),
    signals = [],
    routing = new Map(),
    problems = []
  let fileCount = 0,
    bytes = 0,
    links = 0,
    readErrors = 0,
    omitted = 0,
    parsedBytes = 0,
    last = 0
  function problem(msg) {
    readErrors++
    if (problems.length < 35) problems.push(msg)
  }
  function progress(phase, force = false) {
    if (force || Date.now() - last > 130) {
      last = Date.now()
      onProgress({ phase, fileCount, bytes })
    }
  }
  try {
    const insert = db.prepare('INSERT INTO files VALUES(?,?,?,?,?,NULL)')
    const storeHash = db.prepare('UPDATE files SET digest=? WHERE path=?')
    db.exec('BEGIN')
    function walk(dir, rel, excluded, parents) {
      let list
      try {
        list = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        problem('无法读取目录 ' + (rel || '.'))
        return
      }
      let rules = parents
      if (
        !excluded &&
        list.some((d) => d.isFile() && d.name === '.gitignore')
      ) {
        try {
          const fp = path.join(dir, '.gitignore')
          if (fs.statSync(fp).size < 131072)
            rules = [
              ...parents,
              {
                prefix: rel ? rel + '/' : '',
                matcher: ignore().add(fs.readFileSync(fp, 'utf8')),
              },
            ]
        } catch {
          problem('忽略规则读取失败 ' + rel)
        }
      }
      // Read this project's manifests and lockfiles before a large source tree can exhaust the analysis budget.
      if (!excluded) {
        const priority = (ent) =>
          ent.isDirectory()
            ? 2
            : /^(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|nuxt\.config\.)/.test(
                  ent.name,
                )
              ? 0
              : 1
        list.sort((a, b) => priority(a) - priority(b))
      }
      for (const ent of list) {
        const rp = rel ? rel + '/' + ent.name : ent.name
        const full = path.join(dir, ent.name)
        const routeConfig = [
          '.npmrc',
          '.yarnrc',
          '.yarnrc.yml',
          'pnpm-workspace.yaml',
        ].includes(ent.name)
        if (routeConfig && !excluded) {
          let raw = null
          try {
            if (ent.isFile() && fs.lstatSync(full).size <= 131072)
              raw = fs.readFileSync(full, 'utf8')
          } catch {}
          routing.set(rel, [
            ...(routing.get(rel) || []),
            ...registryRoutes(ent.name, raw),
          ])
        }
        if (ent.isSymbolicLink()) {
          links++
          continue
        }
        const off =
          excluded ||
          generated.has(ent.name) ||
          rules.some((r) =>
            r.matcher.ignores(
              rp.slice(r.prefix.length) + (ent.isDirectory() ? '/' : ''),
            ),
          )
        if (ent.isDirectory()) {
          walk(full, rp, off, rules)
          continue
        }
        if (!ent.isFile()) continue
        let st
        try {
          st = fs.lstatSync(full)
          if (!st.isFile()) continue
        } catch {
          problem('无法读取文件 ' + rp)
          continue
        }
        const kind = kindOf(rp)
        insert.run(rp, st.size, st.mtimeMs, kind, off ? 0 : 1)
        fileCount++
        bytes += st.size
        progress('文件索引')
        if (off) continue
        const name = ent.name
        if (
          /^(package\.json|go\.mod|Cargo\.toml|pom\.xml|composer\.json|pyproject\.toml|requirements\.txt|Gemfile|build\.gradle|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/.test(
            name,
          )
        )
          signals.push(rp)
        const manifest = [
          'package.json',
          'package-lock.json',
          'npm-shrinkwrap.json',
          'pnpm-lock.yaml',
          'yarn.lock',
          '.nvmrc',
          '.node-version',
          'tsconfig.json',
          'jsconfig.json',
        ].includes(name)
        const interesting =
          manifest ||
          /\.(vue|[mc]?[jt]sx?)$/.test(name) ||
          /^README(?:\.md)?$/i.test(name) ||
          rp.includes('.github/workflows/') ||
          /^(Dockerfile|\.gitlab-ci\.yml)$/.test(name)
        if (!interesting) continue
        if (
          st.size > (manifest ? 24 * 1024 * 1024 : 1024 * 1024) ||
          parsedBytes + st.size > 100 * 1024 * 1024 ||
          texts.size >= 8000
        ) {
          omitted++
          continue
        }
        try {
          const buf = fs.readFileSync(full)
          texts.set(rp, buf.toString('utf8'))
          storeHash.run(createHash('sha256').update(buf).digest('hex'), rp)
          parsedBytes += st.size
        } catch {
          problem('无法解析 ' + rp)
        }
      }
    }
    walk(root, '', false, [])
    db.exec('COMMIT')
    progress('依赖清单', true)
    const upgrades = analyzeUpgrades(texts, signals, problem, routing)
    progress('业务流程', true)
    const analysis = analyzeCode(texts, signals, problem, upgrades.projects)
    const conventionalEntries = db
      .prepare(
        "SELECT path FROM files WHERE business=1 AND (path IN ('index.html','index.js','index.ts','main.go','main.py','__main__.py','src/main.rs') OR path LIKE '%/__main__.py' OR path LIKE 'cmd/%/main.go') ORDER BY path",
      )
      .all()
    const featureMap = buildFeatureMap(
      analysis,
      upgrades.projects,
      conventionalEntries,
    )
    const manifest =
      upgrades.projects.find((p) => p.dir === '') || upgrades.projects[0]
    const readme = [...texts.keys()].find((k) => /^readme(?:\.md)?$/i.test(k))
    const doc = readme ? texts.get(readme) : ''
    const heading = doc.match(/^#\s+(.{1,90})$/m)?.[1]
    const description =
      manifest?.description ||
      doc
        .split(/\r?\n/)
        .find((l) => /^[\p{L}\p{N}]/u.test(l.trim()) && l.length > 8)
        ?.slice(0, 160) ||
      ''
    const result = {
      inventoryVersion,
      name: heading || manifest?.name || path.basename(root),
      slug: manifest?.name || path.basename(root),
      root,
      description,
      readme,
      date: new Date().toISOString(),
      fileCount,
      bytes,
      links,
      readErrors,
      problems,
      omitted,
      stats: overviewStats(db),
      featureMap,
      ...analysis,
      ...upgrades,
    }
    db.prepare('INSERT INTO meta VALUES(?,?)').run(
      'snapshot',
      JSON.stringify(result),
    )
    return result
  } finally {
    db.close()
  }
}
module.exports = { scanProject, inventoryVersion }
