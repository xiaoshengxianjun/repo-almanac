const path = require('node:path').posix
const semver = require('semver')
const ts = require('@typescript/typescript6')
const viteGuide = 'https://v5.vite.dev/guide/migration'
const { projectLock, parent } = require('./dependency-locks.cjs')
const { technologies, lookupPolicy, nuxtConfig } = require('./inventory.cjs')
function json(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
function dirOf(file) {
  const dir = path.dirname(file)
  return dir === '.' ? '' : dir
}
function evidence(label, file, line = 1) {
  return { label, file, line, type: 'config', detail: '配置证据' }
}
function workerArrayLine(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  let line
  function visit(n) {
    if (
      ts.isPropertyAssignment(n) &&
      n.name.getText(ast).replace(/['"]/g, '') === 'worker' &&
      ts.isObjectLiteralExpression(n.initializer)
    ) {
      const plugins = n.initializer.properties.find(
        (p) =>
          ts.isPropertyAssignment(p) &&
          p.name.getText(ast).replace(/['"]/g, '') === 'plugins' &&
          ts.isArrayLiteralExpression(p.initializer),
      )
      if (plugins)
        line =
          ast.getLineAndCharacterOfPosition(plugins.name.getStart(ast)).line + 1
    }
    ts.forEachChild(n, visit)
  }
  visit(ast)
  return line
}
function analyzeUpgrades(
  texts,
  signals,
  onProblem = () => {},
  routing = new Map(),
) {
  const tags = new Set(),
    projects = [],
    findings = []
  const manifests = new Map(
    signals
      .filter((f) => path.basename(f) === 'package.json')
      .map((f) => [f, json(texts.get(f))]),
  )
  const locals = new Set(
    [...manifests.values()].map((m) => m?.name).filter(Boolean),
  )
  const lockCache = new Map(),
    signalSet = new Set(signals)
  const markers = {
    'go.mod': 'Go',
    'Cargo.toml': 'Rust',
    'pom.xml': 'Maven',
    'composer.json': 'PHP',
    'pyproject.toml': 'Python',
    'requirements.txt': 'Python',
    Gemfile: 'Ruby',
    'build.gradle': 'Gradle',
  }
  for (const f of signals)
    if (markers[path.basename(f)]) tags.add(markers[path.basename(f)])
  for (const [file, manifest] of manifests) {
    if (!manifest) {
      onProblem('清单解析失败 ' + file)
      continue
    }
    const dir = dirOf(file),
      groups = new Map()
    for (const [key, label] of [
      ['peerDependencies', '配套'],
      ['devDependencies', '开发'],
      ['dependencies', '运行'],
      ['optionalDependencies', '可选'],
    ]) {
      for (const [name, range] of Object.entries(manifest[key] || {})) {
        if (typeof range === 'string') groups.set(name, { range, label })
      }
    }
    const blocked = new Set()
    let manager,
      at = dir
    while (true) {
      for (const scope of routing.get(at) || []) blocked.add(scope)
      const declaration = manifests.get(
        path.join(at, 'package.json'),
      )?.packageManager
      if (!manager && typeof declaration === 'string')
        manager = declaration.split('@')[0]
      if (!at) break
      at = parent(at)
    }
    const lock = projectLock(dir, manager, texts, signalSet, lockCache)
    const conflict = lock.conflict
    for (const k of groups.keys())
      if (technologies.has(k)) tags.add(technologies.get(k))
    if (groups.size) tags.add('JavaScript')
    const env = []
    for (const [f, txt] of texts) {
      if (/(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/.test(f)) {
        for (const match of txt.matchAll(
          /^\s*node-version:\s*['"]?([~^]?\d+(?:\.(?:\d+|x)){0,2})['"]?\s*(?:#.*)?$/gm,
        )) {
          env.push({
            kind: 'CI',
            value: match[1],
            file: f,
            line: txt
              .slice(0, match.index + match[0].indexOf('node-version'))
              .split('\n').length,
          })
        }
      } else if (
        [path.join(dir, '.nvmrc'), path.join(dir, '.node-version')].includes(f)
      )
        env.push({ kind: '开发机', value: txt.trim(), file: f, line: 1 })
    }
    if (typeof manifest.engines?.node === 'string')
      env.push({ kind: '声明', value: manifest.engines.node, file, line: 1 })
    const resolved = [...groups].map(([name, { range, label }]) => {
      const item = lock.record(name, range)
      const alternatives = (lock.alternatives || []).map((other) => ({
        manager: other.manager,
        file: other.file,
        item: other.record(name, range),
      }))
      const lockEvidence = alternatives
        .filter((x) => semver.valid(x.item?.version))
        .map((x) => ({
          manager: x.manager,
          file: x.file,
          version: x.item.version,
        }))
      const agreed =
        lockEvidence.length &&
        lockEvidence.length === alternatives.length &&
        lockEvidence.every((e) => e.version === lockEvidence[0].version)
      const origins = alternatives.map((x) => x.item).filter(Boolean)
      const localReason =
        (origins.length ? origins : [item])
          .map((origin) => lookupPolicy(name, range, origin, locals, blocked))
          .find(Boolean) || ''
      const displayRange = /(?:[:/]|^git@)/.test(range)
        ? range
            .split(/[:/]/)[0]
            .replace(/[^a-z-].*/i, '')
            .slice(0, 20) + ' 引用'
        : range
      const at = texts.get(file).indexOf(JSON.stringify(name))
      const line = at < 0 ? 1 : texts.get(file).slice(0, at).split('\n').length
      return {
        name,
        range: displayRange,
        group: label,
        technology: technologies.get(name) || null,
        localReason,
        line,
        version:
          semver.valid(item?.version) ||
          (agreed ? lockEvidence[0].version : null),
        lockEvidence,
        peers: item?.peerDependencies || {},
        peerMeta: item?.peerDependenciesMeta || {},
        lookup: !localReason,
      }
    })
    const p = {
      name: manifest.name || path.basename(dir) || '根项目',
      dir,
      file,
      description: manifest.description || '',
      env,
      lock: lock.file,
      manager: lock.manager || null,
      config: nuxtConfig(dir, texts),
      worker: null,
      deps: resolved,
      conflict,
    }
    projects.push(p)
    const vite = resolved.find((d) => d.name === 'vite')
    if (
      vite?.version &&
      semver.valid(vite.version) &&
      semver.major(vite.version) === 4
    ) {
      const config = [...texts.keys()].find(
        (f) => dirOf(f) === dir && /^vite\.config\./.test(path.basename(f)),
      )
      const workerLine = config && workerArrayLine(config, texts.get(config))
      if (workerLine)
        p.worker = evidence('worker.plugins 数组', config, workerLine)
      const finding = evaluate(
        p,
        vite,
        '5.4.0',
        { node: '^18.0.0 || >=20.0.0' },
        {},
        '内置历史迁移规则',
        viteGuide,
      )
      findings.push({
        ...finding,
        title: '评估 Vite 5 构建迁移',
        reason:
          '从 Vite 4 迁移到 Vite 5 前，核对构建环境和配置。目标版本用于迁移规则演示。',
      })
      if (p.worker)
        findings.push({
          id: file + ':worker',
          title: '调整 Worker 插件配置',
          name: 'worker.plugins',
          status: 'blocked',
          from: '数组',
          target: '函数',
          scope: p.name,
          reason:
            '配置使用数组形式。迁移到 Vite 5 时需要改为返回插件列表的函数。',
          source: 'Vite 官方迁移指南',
          url: viteGuide,
          evidence: [p.worker],
          steps: [
            '记录当前生产构建与 Worker 行为',
            '将 worker.plugins 改为返回插件数组的函数',
            '运行生产构建并测试实际 Worker 路径',
          ],
          rollback: '恢复原配置和本次构建工具版本。',
        })
    }
    if (groups.size && (!lock.parsed || conflict))
      findings.push({
        id: file + ':lock',
        title: conflict ? '核对项目使用的包管理器' : '确认依赖锁定版本',
        name: '依赖清单',
        status: 'unknown',
        scope: p.name,
        from: '声明范围',
        target: '锁定版本',
        reason: conflict
          ? '发现多个包管理器或锁文件与声明不一致，需要核对构建所用的锁文件。'
          : '缺少可解析的锁文件，声明范围无法证明锁定版本。',
        source: '本地清单',
        evidence: [evidence('依赖清单', file)],
        steps: [
          '与构建配置核对实际的包管理器',
          '补充该次构建使用的锁文件后重新扫描',
        ],
        rollback: '核对信息无需修改业务代码。',
      })
  }
  return { tags: [...tags], projects, findings }
}
function evaluate(
  project,
  dep,
  target,
  engines,
  peers,
  source,
  url,
  allResolved = [],
  peerMeta = {},
) {
  const problems = [],
    unknown = [],
    refs = [evidence('声明范围', project.file, dep.line || 1)]
  if (project.lock) refs.push(evidence('解析锁定版本', project.lock))
  for (const e of dep.lockEvidence || [])
    refs.push(evidence(e.manager + ' 锁 · ' + e.version, e.file))
  if (project.conflict) unknown.push('项目包管理器待核对')
  if (!dep.version) unknown.push('缺少当前锁定版本')
  const ci = project.env.filter((e) => e.kind === 'CI')
  if (engines.node) {
    if (!ci.length) unknown.push('CI 的 Node 版本待确认')
    for (const e of ci) {
      refs.push(evidence(e.kind + ' Node ' + e.value, e.file, e.line))
      if (!semver.validRange(e.value) || !semver.validRange(engines.node))
        unknown.push('运行时版本范围需要人工核对')
      else if (!semver.intersects(e.value, engines.node))
        problems.push('CI 使用 Node ' + e.value + '，目标要求 ' + engines.node)
      else if (!semver.subset(e.value, engines.node))
        unknown.push('CI 范围仅部分满足 ' + engines.node)
    }
  }
  const installed = new Map(
    [...allResolved, ...project.deps].map((d) => [d.name, d]),
  )
  for (const [name, range] of Object.entries(peers || {})) {
    const actual = installed.get(name)?.version
    if (!actual && !peerMeta[name]?.optional)
      unknown.push('待确认配套依赖 ' + name + ' ' + range)
    if (actual && (!semver.valid(actual) || !semver.validRange(range)))
      unknown.push('待确认 ' + name + ' 的版本格式')
    else if (actual && !semver.satisfies(actual, range))
      problems.push(name + ' ' + actual + ' 不满足 ' + range)
  }
  for (const d of project.deps) {
    const range = d.peers?.[dep.name]
    if (range && semver.validRange(range) && !semver.satisfies(target, range))
      problems.push(d.name + ' 要求 ' + dep.name + ' ' + range)
  }
  const status = problems.length
    ? 'blocked'
    : unknown.length
      ? 'unknown'
      : 'ready'
  return {
    id: project.file + ':' + dep.name + ':' + target,
    title: dep.name + ' 依赖更新',
    name: dep.name,
    scope: project.name,
    status,
    from: dep.version || dep.range,
    target,
    reason:
      [...problems, ...unknown].join('；') ||
      '已检查的运行时和直接插件约束通过，可进入构建验证。',
    checks: [...problems, ...unknown],
    source,
    url,
    evidence: refs,
    steps: [
      '记录原版本的构建和关键业务流程结果',
      ...problems.map((p) => '先解决：' + p),
      ...unknown.map((p) => '核对：' + p),
      '在独立变更中更新依赖和锁文件',
      '干净安装后运行生产构建和核心流程回归',
    ],
    rollback: '恢复本次清单、锁文件、构建配置和对应的 CI 运行环境。',
  }
}
function compareMetadata(dep, meta) {
  const stable = Object.keys(meta.versions || {}).filter(
    (v) =>
      semver.valid(v) && !semver.prerelease(v) && !meta.versions[v]?.deprecated,
  )
  const latest = semver.maxSatisfying(stable, '*'),
    within = semver.maxSatisfying(stable, dep.range)
  function gapFor(version) {
    let gap = '锁定版本未知'
    if (!latest) gap = '无稳定版本'
    else if (semver.valid(version)) {
      const diff = semver.major(latest) - semver.major(version)
      if (semver.eq(version, latest)) gap = '已是最新'
      else if (semver.gt(version, latest)) gap = '高于稳定版'
      else if (diff) gap = '落后 ' + diff + ' 个主版本'
      else if (semver.minor(latest) > semver.minor(version)) gap = '次版本更新'
      else
        gap =
          semver.patch(latest) > semver.patch(version)
            ? '补丁更新'
            : '可转稳定版'
    }
    return gap
  }
  let gap = gapFor(dep.version)
  if (latest && !dep.version && dep.lockEvidence?.length) {
    gap = dep.lockEvidence
      .map((e) => e.manager + ' · ' + gapFor(e.version))
      .join(' / ')
  }
  return {
    latest,
    within,
    tag: meta['dist-tags']?.latest || null,
    checked: meta._checkedAt,
    stale: !!meta._stale,
    gap,
  }
}
async function lookupProject(project, fetchMeta, allowed) {
  const results = [],
    errors = [],
    deps = []
  for (const dep of project.deps) {
    if (!dep.lookup || (allowed && !allowed.includes(dep.name))) {
      deps.push(dep)
      continue
    }
    try {
      const meta = await fetchMeta(dep.name),
        comparison = compareMetadata(dep, meta)
      deps.push({ ...dep, comparison })
      for (const target of new Set([comparison.within, comparison.latest])) {
        if (!target || (dep.version && !semver.gt(target, dep.version)))
          continue
        const doc = meta.versions[target]
        results.push(
          evaluate(
            project,
            dep,
            target,
            doc.engines || {},
            doc.peerDependencies || {},
            meta._source || 'npm registry',
            'https://www.npmjs.com/package/' + dep.name,
            [],
            doc.peerDependenciesMeta || {},
          ),
        )
      }
    } catch (e) {
      errors.push(dep.name + ' · ' + e.message)
      const comparison = dep.comparison?.latest
        ? { ...dep.comparison, stale: true }
        : { gap: '查询失败' }
      deps.push({ ...dep, comparison })
    }
  }
  return { results, errors, deps }
}
module.exports = { analyzeUpgrades, lookupProject, evaluate, compareMetadata }
