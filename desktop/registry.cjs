async function readRegistryMetadata(name, cache, signal) {
  signal.throwIfAborted()
  if (cache[name] && Date.now() - cache[name].time < 86400000)
    return {
      ...cache[name].meta,
      _source: 'npm 缓存 · ' + new Date(cache[name].time).toLocaleDateString(),
    }
  try {
    const r = await fetch(
      'https://registry.npmjs.org/' + encodeURIComponent(name),
      {
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
    cache[name] = { time: Date.now(), meta }
    return {
      ...meta,
      _source: '公共 npm · ' + new Date().toLocaleDateString(),
    }
  } catch (e) {
    signal.throwIfAborted()
    if (cache[name])
      return {
        ...cache[name].meta,
        _source:
          '离线缓存 · ' + new Date(cache[name].time).toLocaleDateString(),
      }
    throw e
  }
}

module.exports = { readRegistryMetadata }
