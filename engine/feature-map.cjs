const path = require('node:path').posix

// A node has one display parent. Additional owners, return links and cycles
// stay inspectable as source-backed edges without duplicating action chains.
function buildFeatureMap(analysis, projects = [], files = []) {
  const nodes = new Map(),
    links = [],
    linked = new Set()
  const root = 'project',
    scopes = [...projects].sort((a, b) => b.dir.length - a.dir.length)
  function add(id, kind, label, parent, extra = {}) {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, parent, ...extra })
    return id
  }
  function key(...parts) {
    return JSON.stringify(parts)
  }
  function scope(file) {
    return scopes.find(
      (p) => !p.dir || file === p.file || file.startsWith(p.dir + '/'),
    )
  }
  function workspace(file) {
    const p = scope(file)
    return projects.length > 1 && p
      ? add(key('workspace', p.file), 'workspace', p.name, root, {
          file: p.file,
          line: 1,
          detail: p.file,
        })
      : root
  }
  function group(parent, label) {
    return add(key('group', parent, label), 'group', label, parent)
  }
  function edge(from, to, e) {
    if (!from || !to) return
    const signature = key(from, to, e.file, e.line, e.label)
    if (linked.has(signature)) return
    linked.add(signature)
    links.push({ from, to, file: e.file, line: e.line, label: e.label })
  }
  function append(map, k, v) {
    const list = map.get(k)
    if (list) list.push(v)
    else map.set(k, [v])
  }
  add(root, 'project', '项目入口', null)
  const pages = new Map(),
    byUrl = new Map(),
    homes = [],
    entries = [],
    byFile = new Map()
  for (const r of analysis.routes) {
    const id = key('page', r.file, r.line, r.component, r.url)
    if (nodes.has(id)) continue
    add(id, 'page', r.url === '/' ? '首页' : r.title, null, {
      file: r.component,
      line: 1,
      url: r.url,
      detail: r.origin || '路由配置',
      evidence: { file: r.file, line: r.line, label: r.origin || '路由声明' },
    })
    append(pages, r.component, id)
    append(byUrl, key(workspace(r.component), r.url), id)
    if (r.url === '/') homes.push(id)
  }
  function component(file) {
    return add(
      key('component', file),
      'component',
      path.basename(file, '.vue'),
      null,
      { file, line: 1, detail: '组件源码' },
    )
  }
  const viewNodes = (file) => pages.get(file) || [component(file)]
  for (const e of [
    ...analysis.entries,
    ...files.map((v) => ({
      file: v.path,
      line: 1,
      detail: '约定入口文件，启动方式需核对',
    })),
  ]) {
    const id = add(key('entry', e.file), 'entry', e.file, workspace(e.file), {
      file: e.file,
      line: e.line,
      detail: e.detail,
    })
    byFile.set(e.file, id)
    if (!entries.includes(id)) entries.push(id)
  }
  for (const l of analysis.navigation || []) {
    const targets = byUrl.get(key(workspace(l.from || l.file), l.dest))
    if (targets?.length === 1)
      for (const from of viewNodes(l.from || l.file)) edge(from, targets[0], l)
  }
  for (const l of analysis.componentUses || [])
    for (const from of viewNodes(l.file))
      for (const to of viewNodes(l.to)) edge(from, to, l)
  for (const l of analysis.imports || [])
    if (byFile.has(l.from) && l.to.endsWith('.vue'))
      for (const to of viewNodes(l.to))
        edge(byFile.get(l.from), to, {
          file: l.from,
          line: l.line,
          label: '入口导入',
        })
  const outgoing = new Map()
  for (const l of links) append(outgoing, l.from, l)
  for (const id of homes) {
    const n = nodes.get(id)
    n.parent = workspace(n.file)
  }
  function attach(start, kind) {
    const queue = [...start],
      seen = new Set(start)
    for (let i = 0; i < queue.length; i++) {
      for (const l of outgoing.get(queue[i]) || []) {
        const child = nodes.get(l.to)
        if (
          child.kind !== kind ||
          child.parent ||
          seen.has(child.id) ||
          workspace(child.file) !== workspace(l.file)
        )
          continue
        child.parent = l.from
        child.via = l.label
        seen.add(l.to)
        queue.push(l.to)
      }
    }
  }
  attach(homes, 'page')
  const allPages = [...pages.values()].flat()
  for (const id of allPages) {
    const n = nodes.get(id)
    if (n.parent) continue
    const section = group(workspace(n.file), '按路由浏览')
    const segments = n.url.split('/').filter(Boolean)
    n.parent = segments.length > 1 ? group(section, '/' + segments[0]) : section
  }
  attach([...allPages, ...entries], 'component')
  for (const f of analysis.flows) {
    const event =
      f.steps.find((e) => e.type === 'event' || e.type === 'lifecycle') ||
      f.steps[0]
    if (!event) continue
    const parent =
      pages.get(event.file)?.find((id) => nodes.get(id).url === f.url) ||
      component(event.file)
    add('action:' + f.id, 'action', f.name, parent, {
      file: event.file,
      line: event.line,
      flowId: f.id,
      detail: event.detail,
    })
  }
  for (const n of nodes.values()) {
    if (n.kind === 'component' && !n.parent) {
      const base = group(workspace(n.file), '页面归属待确认')
      const dir = path.dirname(n.file)
      n.parent = dir === '.' ? base : group(base, dir)
    }
  }
  for (const endpoint of analysis.services || []) {
    const parent =
      byFile.get(endpoint.file) || group(workspace(endpoint.file), '服务接口')
    add(
      key('service', endpoint.file, endpoint.line, endpoint.label),
      'service',
      endpoint.label,
      parent,
      {
        file: endpoint.file,
        line: endpoint.line,
        steps: endpoint.steps,
        detail: '已注册的服务接口',
      },
    )
  }
  return {
    nodes: [...nodes.values()],
    links,
    start: homes[0] || entries[0] || allPages[0] || root,
  }
}
module.exports = { buildFeatureMap }
