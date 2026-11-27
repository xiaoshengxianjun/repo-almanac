const path = require('node:path').posix
const semver = require('semver')
const yaml = require('yaml')
const yarn = require('@yarnpkg/lockfile')

const locks = {
  'npm-shrinkwrap.json': 'npm',
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
}
function parent(dir) {
  const value = path.dirname(dir)
  return value === '.' ? '' : value
}
function parse(file, source) {
  if (!source) return null
  if (file.endsWith('.json')) return JSON.parse(source)
  if (file.endsWith('yarn.lock') && !/^__metadata:/m.test(source)) {
    const parsed = yarn.parse(source)
    return parsed.type === 'success' ? parsed.object : null
  }
  if (file.endsWith('yarn.lock') || file.endsWith('.yaml')) {
    const data = yaml.parse(source, { maxAliasCount: 20, logLevel: 'silent' })
    if (data?.__metadata) {
      const descriptors = new Map()
      for (const [key, entry] of Object.entries(data))
        for (const descriptor of key.split(/,\s+/))
          descriptors.set(descriptor, entry)
      return descriptors
    }
    return data
  }
  return null
}
function projectLock(dir, manager, texts, signals, cache) {
  let at = dir,
    files
  while (true) {
    files = Object.keys(locks)
      .map((n) => path.join(at, n))
      .filter((f) => texts.has(f) || signals.has(f))
    if (files.length || !at) break
    at = parent(at)
  }
  const choices = new Set(files.map((f) => locks[path.basename(f)]))
  const conflict = manager
    ? files.length > 0 && !choices.has(manager)
    : choices.size > 1
  if (!manager && choices.size > 1) {
    const alternatives = [...choices].map((choice) =>
      projectLock(dir, choice, texts, signals, cache),
    )
    return {
      manager: null,
      conflict: true,
      file: null,
      parsed: false,
      alternatives,
      record: () => null,
    }
  }
  const file =
    !conflict &&
    files.find((f) => !manager || locks[path.basename(f)] === manager)
  if (!file)
    return { manager, conflict, file: null, parsed: false, record: () => null }
  const type = locks[path.basename(file)]
  if (!cache.has(file)) {
    try {
      cache.set(file, parse(file, texts.get(file)))
    } catch {
      cache.set(file, null)
    }
  }
  const lock = cache.get(file)
  const sub = path.relative(at || '.', dir || '.')
  function record(name, range) {
    if (!lock) return null
    if (type === 'npm') {
      if (!lock.packages) return sub ? null : lock.dependencies?.[name]
      let scope = sub
      while (true) {
        const item = lock.packages[path.join(scope, 'node_modules', name)]
        if (item) return item
        if (!scope) return null
        scope = parent(scope)
      }
    }
    if (type === 'yarn') {
      const key = name + '@' + range
      return lock instanceof Map
        ? lock.get(name + '@npm:' + range) || lock.get(key)
        : lock[key]
    }
    if (type === 'pnpm') {
      const importer =
        lock.importers?.[sub || '.'] || (!sub && !lock.importers && lock)
      const entry =
        importer?.optionalDependencies?.[name] ??
        importer?.dependencies?.[name] ??
        importer?.devDependencies?.[name]
      const ref = typeof entry === 'string' ? entry : entry?.version
      if (!ref || (entry.specifier && entry.specifier !== range)) return null
      const version = ref.split('(')[0].split('_')[0]
      const info =
        lock.packages?.[name + '@' + version] ||
        lock.packages?.['/' + name + '@' + version] ||
        lock.packages?.['/' + name + '/' + version]
      return {
        ...info,
        version: semver.valid(version),
        link: !semver.valid(version),
        resolved: info?.resolution?.tarball,
      }
    }
    return null
  }
  return { file, manager: type, conflict, parsed: !!lock, record }
}
module.exports = { projectLock, parent }
