const path = require('node:path').posix
const semver = require('semver')
const ts = require('@typescript/typescript6')
const viteGuide = 'https://v5.vite.dev/guide/migration'
const publicPackages = new Set([
  'vite',
  'vue',
  'vue-router',
  'react',
  'react-dom',
  'next',
  'nuxt',
  'express',
  'typescript',
  'webpack',
  'rollup',
  'axios',
  'lodash',
  'pinia',
  'eslint',
  '@vitejs/plugin-vue',
  '@vitejs/plugin-react',
  '@vue/cli-service',
])
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
function analyzeUpgrades(texts, signals, onProblem = () => {}) {
  const tags = new Set(),
    projects = [],
    findings = []
  const named = {
    vue: 'Vue',
    'vue-router': 'Vue Router',
    react: 'React',
    nuxt: 'Nuxt',
    next: 'Next.js',
    typescript: 'TypeScript',
    vite: 'Vite',
    express: 'Express',
    webpack: 'webpack',
    electron: 'Electron',
  }
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
  for (const file of signals.filter(
    (f) => path.basename(f) === 'package.json',
  )) {
    const manifest = json(texts.get(file))
    if (!manifest) {
      onProblem('清单解析失败 ' + file)
      continue
    }
    const dir = dirOf(file),
      deps = { ...manifest.dependencies, ...manifest.devDependencies }
    for (const k of Object.keys(deps)) if (named[k]) tags.add(named[k])
    if (Object.keys(deps).length) tags.add('JavaScript')
    const candidates = []
    let ancestor = dir
    while (true) {
      for (const n of [
        'npm-shrinkwrap.json',
        'package-lock.json',
        'yarn.lock',
        'pnpm-lock.yaml',
        'bun.lock',
        'bun.lockb',
      ]) {
        const p = path.join(ancestor, n)
        if (texts.has(p) || signals.includes(p)) candidates.push(p)
      }
      if (candidates.length || !ancestor) break
      ancestor = dirOf(ancestor)
    }
    const npmLock = candidates.find((f) =>
      /package-lock\.json$|npm-shrinkwrap\.json$/.test(f),
    )
    const conflict = candidates.some(
      (f) => !/package-lock\.json$|npm-shrinkwrap\.json$/.test(f),
    )
    const lock = npmLock && !conflict ? json(texts.get(npmLock)) : null
    function record(name) {
      if (!lock) return null
      if (!lock.packages) return lock.dependencies?.[name] || null
      let scope = path.relative(dirOf(npmLock), dir)
      while (true) {
        const item = lock.packages[path.join(scope, 'node_modules', name)]
        if (item) return item
        if (!scope) break
        scope = dirOf(scope)
      }
      return null
    }
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
    const resolved = Object.entries(deps).map(([name, range]) => {
      const item = record(name)
      const at = texts.get(file).indexOf(JSON.stringify(name))
      const line = at < 0 ? 1 : texts.get(file).slice(0, at).split('\n').length
      return {
        name,
        range,
        line,
        version: item?.version || null,
        peers: item?.peerDependencies || {},
        peerMeta: item?.peerDependenciesMeta || {},
        lookup: publicPackages.has(name) && Boolean(semver.validRange(range)),
      }
    })
    const p = {
      name: manifest.name || path.basename(dir) || '根项目',
      dir,
      file,
      description: manifest.description || '',
      env,
      lock: npmLock || null,
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
    if (Object.keys(deps).length && (!lock || conflict))
      findings.push({
        id: file + ':lock',
        title: conflict ? '核对项目使用的包管理器' : '确认依赖锁定版本',
        name: '依赖清单',
        status: 'unknown',
        scope: p.name,
        from: '声明范围',
        target: '锁定版本',
        reason: conflict
          ? '发现其他包管理器的锁文件。当前 npm 分析器无法确认实际安装版本。'
          : '缺少可解析的 npm 锁文件，声明范围无法证明安装版本。',
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
async function lookupProject(project, fetchMeta, allowed) {
  const results = [],
    errors = []
  for (const dep of project.deps.filter(
    (d) => d.lookup && allowed.includes(d.name),
  )) {
    try {
      const meta = await fetchMeta(dep.name)
      const versions = Object.keys(meta.versions || {}).filter(
        (v) =>
          semver.valid(v) &&
          !semver.prerelease(v) &&
          !meta.versions[v].deprecated,
      )
      const latest = meta['dist-tags']?.latest,
        within = semver.maxSatisfying(versions, dep.range)
      for (const target of new Set(
        [within, latest].filter(
          (v) =>
            semver.valid(v) &&
            (!semver.valid(dep.version) || semver.gt(v, dep.version)),
        ),
      )) {
        const doc = meta.versions[target]
        if (!doc) continue
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
    }
  }
  return { results, errors }
}
module.exports = { analyzeUpgrades, lookupProject, evaluate }
