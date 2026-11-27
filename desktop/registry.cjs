const { lookupProject } = require('../engine/upgrades.cjs')
async function readRegistryMetadata(name, cache, signal) {
  signal.throwIfAborted()
  if (Object.hasOwn(cache, name) && Date.now() - cache[name].time < 86400000)
    return {
      ...cache[name].meta,
      _checkedAt: cache[name].time,
      _source: 'npm 缓存 · ' + new Date(cache[name].time).toLocaleDateString(),
    }
  try {
    const r = await fetch(
      'https://registry.npmjs.org/' + encodeURIComponent(name),
      {
        redirect: 'error',
        credentials: 'omit',
        headers: { Accept: 'application/vnd.npm.install-v1+json' },
        signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]),
      },
    )
    if (!r.ok) throw Error('HTTP ' + r.status)
    const raw = await r.json(),
      versions = {}
    for (const [k, v] of Object.entries(raw.versions || {}))
      versions[k] = {
        engines: v.engines,
        peerDependencies: v.peerDependencies,
        peerDependenciesMeta: v.peerDependenciesMeta,
        deprecated: v.deprecated,
      }
    const meta = { 'dist-tags': raw['dist-tags'], versions }
    Object.defineProperty(cache, name, {
      value: { time: Date.now(), meta },
      enumerable: true,
      writable: true,
      configurable: true,
    })
    return {
      ...meta,
      _checkedAt: cache[name].time,
      _source: '公共 npm · ' + new Date().toLocaleDateString(),
    }
  } catch (e) {
    signal.throwIfAborted()
    if (Object.hasOwn(cache, name))
      return {
        ...cache[name].meta,
        _stale: true,
        _checkedAt: cache[name].time,
        _source:
          '离线缓存 · ' + new Date(cache[name].time).toLocaleDateString(),
      }
    throw e
  }
}

async function refreshVersions(snapshot, load, signal) {
  const names = [
    ...new Set(
      snapshot.projects.flatMap((p) =>
        p.deps.filter((d) => d.lookup).map((d) => d.name),
      ),
    ),
  ]
  const metadata = new Map(),
    failures = new Map()
  let index = 0
  async function worker() {
    while (index < names.length) {
      signal.throwIfAborted()
      const name = names[index++]
      try {
        metadata.set(name, await load(name))
      } catch (error) {
        signal.throwIfAborted()
        failures.set(name, error)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(names.length, 5) }, worker))
  const projects = [],
    findings = snapshot.findings.filter((f) => !f.online)
  for (const project of snapshot.projects) {
    signal.throwIfAborted()
    const result = await lookupProject(project, (name) => {
      if (failures.has(name)) throw failures.get(name)
      return metadata.get(name)
    })
    projects.push({ ...project, deps: result.deps })
    findings.push(
      ...result.results.map((f) => ({
        ...f,
        online: true,
        id: 'registry:' + f.id,
      })),
    )
  }
  return { ...snapshot, projects, findings }
}
module.exports = { readRegistryMetadata, refreshVersions }
