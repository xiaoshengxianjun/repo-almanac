import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Icon, types } from '../components/ui'

interface Evidence {
  file: string
  line: number
  label: string
  type?: string
  detail?: string
}
interface Flow {
  id: string
  name: string
  page: string
  url: string
  steps: Evidence[]
  notes: string[]
}
interface Feature {
  id: string
  kind: string
  label: string
  parent: string | null
  file?: string
  line?: number
  detail?: string
  url?: string
  via?: string
  flowId?: string
  evidence?: Evidence
  steps?: Evidence[]
}
interface Link extends Evidence {
  from: string
  to: string
}
interface MapData {
  nodes: Feature[]
  links: Link[]
  start: string
}
interface Props {
  s: { name: string; flows: Flow[]; featureMap?: MapData }
  chosen: string
  setChosen: (id: string) => void
  source: (e: Evidence) => void
  compact?: boolean
  openFull?: (id: string) => void
  ai?: (type: string, f: Flow) => void
}
const kinds: Record<string, [string, string, number]> = {
  project: ['项目', 'inbox', 0],
  workspace: ['子项目', 'folder', 1],
  page: ['页面', 'files', 2],
  entry: ['程序入口', 'terminal', 3],
  component: ['组件', 'code', 4],
  service: ['服务接口', 'network', 5],
  action: ['操作', 'flag', 6],
  group: ['分组', 'folder', 7],
}
function append<T>(m: Map<string, T[]>, k: string, v: T) {
  const items = m.get(k)
  if (items) items.push(v)
  else m.set(k, [v])
}
function indexMap(data: MapData, flows: Flow[]) {
  const byId = new Map(data.nodes.map((n) => [n.id, n])),
    byFlow = new Map(flows.map((f) => [f.id, f]))
  const children = new Map<string, Feature[]>(),
    links = new Map<string, Link[]>(),
    text = new Map<string, string>()
  for (const n of data.nodes) {
    if (n.parent) append(children, n.parent, n)
    const f = n.flowId && byFlow.get(n.flowId)
    text.set(
      n.id,
      [
        n.label,
        n.file,
        n.url,
        ...(f ? f.steps.map((e) => e.label + ' ' + e.file) : []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    )
  }
  for (const list of children.values())
    list.sort(
      (a, b) =>
        Number(b.url === '/') - Number(a.url === '/') ||
        kinds[a.kind][2] - kinds[b.kind][2] ||
        a.label.localeCompare(b.label, 'zh-CN'),
    )
  for (const l of data.links) append(links, l.from, l)
  function ancestors(id: string) {
    const result = []
    let n = byId.get(id)
    while (n?.parent) {
      result.push(n.parent)
      n = byId.get(n.parent)
    }
    return result.reverse()
  }
  function chains(start: Feature) {
    const queue = [start],
      seen = new Set([start.id]),
      result: Feature[] = []
    function push(n: Feature | undefined) {
      if (n && !seen.has(n.id)) {
        seen.add(n.id)
        queue.push(n)
      }
    }
    const grouping = ['workspace', 'project', 'group'].includes(start.kind)
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i]
      if (n.flowId || n.steps?.length) result.push(n)
      for (const c of children.get(n.id) || [])
        if (grouping || c.kind !== 'page') push(c)
      for (const l of links.get(n.id) || []) {
        const target = byId.get(l.to)
        if (target?.kind === 'component') push(target)
      }
    }
    const rank = (item: Feature) => {
      const f = item.flowId && byFlow.get(item.flowId)
      if (!f) return 3
      if (
        f.steps.some((e) => e.type === 'lifecycle' && e.detail === 'asyncData')
      )
        return 0
      if (
        f.steps.some((e) => ['http', 'storage', 'state'].includes(e.type || ''))
      )
        return 1
      return 2
    }
    return result.sort(
      (a, b) =>
        Number(b.parent === start.id) - Number(a.parent === start.id) ||
        rank(a) - rank(b),
    )
  }
  return { byId, byFlow, children, links, text, ancestors, chains }
}
function previewSteps(steps: Evidence[]) {
  const indexes = steps.map((_, i) => i)
  if (steps.length <= 3) return indexes
  const trigger = steps.findIndex(
    (e) => e.type === 'event' || e.type === 'lifecycle',
  )
  const effect =
    indexes
      .filter((i) =>
        ['http', 'server', 'storage', 'state', 'navigation'].includes(
          steps[i].type || '',
        ),
      )
      .at(-1) ?? steps.length - 1
  const start = Math.max(0, trigger)
  const middle =
    start > 0
      ? 0
      : (indexes.find(
          (i) => i > start && i < effect && steps[i].type === 'handler',
        ) ?? 1)
  return [...new Set([start, middle, effect])].sort((a, b) => a - b)
}
function Explorer({
  s,
  chosen,
  setChosen,
  source,
  compact,
  openFull,
  ai,
  data,
}: Props & { data: MapData }) {
  const idx = useMemo(() => indexMap(data, s.flows), [data, s.flows])
  const [q, search] = useState(''),
    [expanded, setExpanded] = useState<Set<string>>(
      () =>
        new Set([
          ...idx.ancestors(chosen || data.start),
          chosen || data.start,
          'project',
        ]),
    )
  const [chainId, chooseChain] = useState('')
  const terms = q.trim().toLowerCase()
  const matches = useMemo(
    () =>
      terms
        ? [...idx.text].filter(([, v]) => v.includes(terms)).map(([k]) => k)
        : [],
    [terms, idx],
  )
  const visible = useMemo(
    () => new Set(matches.flatMap((id) => [id, ...idx.ancestors(id)])),
    [matches, idx],
  )
  const id =
    terms && !visible.has(chosen || data.start)
      ? matches[0]
      : chosen || data.start
  const n = idx.byId.get(id) || (!terms ? idx.byId.get(data.start) : undefined)
  const selectedRow = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!chosen || !idx.byId.has(chosen)) return
    setExpanded((prev) => new Set([...prev, ...idx.ancestors(chosen)]))
  }, [idx, chosen])
  useEffect(() => {
    const row = selectedRow.current,
      pane = row?.closest('.featureTree') as HTMLElement | undefined
    if (!row || !pane) return
    const bounds = row.getBoundingClientRect(),
      frame = pane.getBoundingClientRect()
    if (bounds.top < frame.top || bounds.bottom > frame.bottom)
      pane.scrollTop += bounds.top - frame.top - 10
  }, [id, expanded])
  function select(key: string) {
    search('')
    chooseChain('')
    setChosen(key)
    setExpanded((prev) => new Set([...prev, ...idx.ancestors(key), key]))
  }
  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const chains = useMemo(() => (n ? idx.chains(n) : []), [idx, n])
  const chain = chains.find((c) => c.id === chainId) || chains[0]
  const flow = chain?.flowId ? idx.byFlow.get(chain.flowId) : undefined
  const steps = flow?.steps || chain?.steps || []
  const displaySteps = compact ? previewSteps(steps) : steps.map((_, i) => i)
  const related = n ? idx.links.get(n.id) || [] : []
  const label = (v: Feature) => (v.kind === 'project' ? s.name : v.label)
  function branch(v: Feature) {
    if (terms && !visible.has(v.id)) return null
    const kids = idx.children.get(v.id) || [],
      open = !!terms || expanded.has(v.id)
    return (
      <li key={v.id}>
        <div className={'treeRow ' + (v.id === n?.id ? 'active' : '')}>
          {kids.length ? (
            <button
              type="button"
              className="treeToggle"
              aria-expanded={open}
              aria-label={(open ? '收起' : '展开') + label(v)}
              disabled={!!terms}
              onClick={() => toggle(v.id)}
            >
              <Icon name="chev" size={13} />
            </button>
          ) : (
            <span className="treeLeaf" aria-hidden="true" />
          )}
          <button
            className="treeSelect"
            ref={v.id === n?.id ? selectedRow : undefined}
            aria-current={v.id === n?.id ? 'true' : undefined}
            onClick={() => select(v.id)}
            title={[label(v), v.url || v.file, v.via]
              .filter(Boolean)
              .join(' · ')}
          >
            <Icon name={kinds[v.kind][1]} size={15} />
            <span>{label(v)}</span>
            {v.url === '/' && <code>/</code>}
          </button>
        </div>
        {!!kids.length && open && <ul>{kids.map(branch)}</ul>}
      </li>
    )
  }
  const roots = idx.children.get('project') || []
  return (
    <section
      className={'featureBoard ' + (compact ? 'compact' : 'full')}
      aria-label="业务功能树"
    >
      <header className="moduleHead">
        <h2>
          <Icon name="flow" />
          业务功能树
        </h2>
        {compact ? (
          <button
            className="textBtn"
            onClick={() => openFull?.(n?.id || data.start)}
          >
            查看完整功能树 <Icon name="arrow" size={14} />
          </button>
        ) : (
          <span className="featureCounts">
            {data.nodes.filter((v) => v.kind === 'page').length} 个页面 ·{' '}
            {s.flows.length.toLocaleString()} 项操作
          </span>
        )}
      </header>
      <div className="featureBody">
        <div className="featureNav">
          {!compact && (
            <label className="searchField">
              <Icon name="search" size={15} />
              <input
                aria-label="搜索业务、路由或函数"
                placeholder="搜索功能、路由或链路"
                value={q}
                onChange={(e) => search(e.target.value)}
              />
            </label>
          )}
          <nav className="featureTree" aria-label="功能层级">
            <ul>{branch(idx.byId.get('project')!)}</ul>
            {terms && !matches.length && <p>没有匹配的功能或链路。</p>}
          </nav>
        </div>
        <div className="featureDetail">
          {n && (
            <>
              <div className="featureTrail">
                {idx
                  .ancestors(n.id)
                  .slice(-3)
                  .map((k) => (
                    <button key={k} onClick={() => select(k)}>
                      {label(idx.byId.get(k)!)} <Icon name="chev" size={11} />
                    </button>
                  ))}
                <span>{kinds[n.kind][0]}</span>
              </div>
              <div className="featureTitle">
                <div>
                  <h3>{label(n)}</h3>
                  {n.url && <code>{n.url}</code>}
                </div>
                {n.file && (
                  <button
                    className="textBtn"
                    title={n.file}
                    onClick={() =>
                      source({
                        file: n.file!,
                        line: n.line || 1,
                        label: n.label,
                      })
                    }
                  >
                    查看源码 <Icon name="code" size={14} />
                  </button>
                )}
              </div>
              {n.detail && (
                <p className="nodeOrigin">
                  {n.evidence ? (
                    <button
                      title={n.evidence.file}
                      onClick={() => source(n.evidence!)}
                    >
                      {n.detail} <Icon name="chev" size={12} />
                    </button>
                  ) : (
                    n.detail
                  )}
                </p>
              )}
              {!!related.length && (
                <details className="relations">
                  <summary>关联页面与组件 · {related.length}</summary>
                  {related.map((l, i) => (
                    <div key={i}>
                      <button onClick={() => select(l.to)}>
                        {label(idx.byId.get(l.to)!)}{' '}
                        <Icon name="arrow" size={12} />
                      </button>
                      <button
                        title={l.file + ':' + l.line}
                        onClick={() => source(l)}
                      >
                        {l.label} · L{l.line}
                      </button>
                    </div>
                  ))}
                </details>
              )}
              {chain ? (
                <>
                  <div className="chainHead">
                    <b>{chain.id === n.id ? '数据链路' : '关联数据链路'}</b>
                    {chains.length > 1 ? (
                      <select
                        aria-label="选择数据链路"
                        value={chain.id}
                        onChange={(e) => chooseChain(e.target.value)}
                      >
                        {chains.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label} · {c.file}:{c.line}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span>
                        {chain.id !== n.id ? chain.label : steps.length + ' 步'}
                      </span>
                    )}
                  </div>
                  <ol className="featureSteps">
                    {displaySteps.map((i) => {
                      const e = steps[i]
                      return (
                        <li key={i} data-type={e.type}>
                          <button
                            onClick={() => source(e)}
                            title={e.file + ':' + e.line}
                          >
                            <span className="stepNo">{i + 1}</span>
                            <span>
                              <small>
                                {compact ? i + 1 + ' · ' : ''}
                                {types[e.type || ''] || '源码依据'}
                                {!compact && e.detail ? ' · ' + e.detail : ''}
                              </small>
                              <b>{e.label}</b>
                              <code>
                                {compact ? e.file.split('/').pop() : e.file}:
                                {e.line}
                              </code>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                  {compact && steps.length > 3 && (
                    <button
                      className="textBtn"
                      onClick={() => openFull?.(chain.id)}
                    >
                      查看完整 {steps.length} 步 <Icon name="arrow" size={13} />
                    </button>
                  )}
                  {!compact &&
                    flow?.notes.map((note) => (
                      <p className="notice" key={note}>
                        {note}
                      </p>
                    ))}
                  {!compact && flow && ai && (
                    <Button icon="book" onClick={() => ai('flow', flow)}>
                      解释这条链路
                    </Button>
                  )}
                </>
              ) : (
                <p className="chainEmpty">
                  {n.kind === 'project' && !roots.length
                    ? '当前扫描未识别出程序入口、页面或业务操作。'
                    : '此节点尚未定位到可验证的数据操作。'}
                  {n.file ? '可从源码继续阅读。' : ''}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
export function FeatureExplorer(props: Props) {
  if (!props.s.featureMap)
    return <p className="inventoryNote">重新扫描后可查看业务功能树。</p>
  return <Explorer {...props} data={props.s.featureMap} />
}
