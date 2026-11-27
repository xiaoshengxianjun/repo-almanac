import { useId, useState } from 'react'
import { Disclosure } from '../components/Disclosure'
import { Icon } from '../components/ui'

export interface Location {
  file: string
  line: number
  label: string
}
interface Comparison {
  latest?: string
  within?: string
  tag?: string
  checked?: number
  stale?: boolean
  gap: string
}
interface Dependency {
  name: string
  range: string
  version: string | null
  lockEvidence?: { manager: string; file: string; version: string }[]
  technology?: string
  group: string
  lookup: boolean
  localReason: string
  line: number
  comparison?: Comparison
}
export interface InventoryProject {
  file: string
  dir: string
  name: string
  lock?: string
  manager?: string
  env: { kind: string; value: string; file: string; line: number }[]
  deps: Dependency[]
  config?: {
    file: string
    srcDir: string
    dynamic: boolean
    registrations: { file: string; line: number; kind: string; name: string }[]
  }
}
const pluginPattern =
  /(?:^|[/-])(?:plugin|preset|loader)(?:s|[/-]|$)|-(?:loader|plugin)$|^@nuxtjs\//
const previewSize = 5
const primaryTiers = [
  ['nuxt', 'next', '@angular/core', '@nestjs/core', 'astro', 'electron'],
  ['vue', 'react', 'svelte', 'express', 'koa', 'fastify'],
  ['vue-router', 'react-dom', 'pinia', 'vuex'],
  ['vite', 'webpack', 'rollup', 'typescript', 'esbuild'],
]
function priority(d: Dependency, registered: Set<string>) {
  const tier = primaryTiers.findIndex((names) => names.includes(d.name))
  if (tier >= 0) return tier
  if (d.technology) return 4
  if (registered.has(d.name)) return 5
  return d.group === '运行' ? 6 : d.group === '开发' ? 8 : 7
}
export function orderStackTags(tags: string[], projects: InventoryProject[]) {
  const ranks = new Map<string, number>(),
    registered = new Set<string>()
  for (const p of projects)
    for (const d of p.deps)
      if (d.technology) ranks.set(d.technology, priority(d, registered))
  return [...tags].sort((a, b) => (ranks.get(a) ?? 10) - (ranks.get(b) ?? 10))
}
function compactGap(gap: string) {
  const parts = gap
    .split(' / ')
    .map((v) => v.replace(/^(npm|yarn|pnpm) · /, ''))
  return parts.every((v) => v === parts[0]) ? parts[0] : gap
}
function Contents({
  project: p,
  source,
}: {
  project: InventoryProject
  source: (e: Location) => void
}) {
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState('全部'),
    [expanded, setExpanded] = useState(false)
  const tableId = useId()
  const registrations = p.config?.registrations || []
  const registered = new Set(registrations.map((r) => r.name))
  const isPlugin = (d: Dependency) =>
    registered.has(d.name) || pluginPattern.test(d.name)
  const ordered = [...p.deps].sort(
    (a, b) =>
      priority(a, registered) - priority(b, registered) ||
      a.name.localeCompare(b.name),
  )
  const filtered = ordered.filter(
    (d) =>
      (filter === '全部' ||
        (filter === '插件' ? isPlugin(d) : d.group === filter)) &&
      d.name.toLowerCase().includes(query.trim().toLowerCase()),
  )
  const visible = expanded ? filtered : filtered.slice(0, previewSize)
  const tech = ordered.filter((d) => d.technology)
  const eligible = p.deps.filter((d) => d.lookup)
  const pending = eligible.filter((d) => !d.comparison).length
  const date = eligible.reduce(
    (time, d) => Math.max(time, d.comparison?.checked || 0),
    0,
  )
  const failed = eligible.filter((d) => d.comparison?.gap === '查询失败').length
  const stale = eligible.filter((d) => d.comparison?.stale).length
  const time = (value: number) =>
    new Date(value).toLocaleString('zh-CN', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
  return (
    <>
      <div className="stackInventory">
        {tech.map((d) => (
          <button
            key={d.name}
            title={p.file + ' · ' + d.name}
            onClick={() =>
              source({
                file: p.file,
                line: d.line,
                label: d.technology || d.name,
              })
            }
          >
            <b>{d.technology}</b> <code>{d.version || d.range}</code>
            {!d.version && <small>声明</small>}
          </button>
        ))}
        {p.env.map((e, i) => (
          <button
            key={i}
            onClick={() => source({ ...e, label: 'Node.js 环境' })}
          >
            <b>Node.js</b> <code>{e.value}</code>
            <small>{e.kind}</small>
          </button>
        ))}
        <button
          className="manifestLink"
          onClick={() => source({ file: p.file, line: 1, label: '依赖清单' })}
        >
          <Icon name="file" size={13} />
          {p.file}
        </button>
      </div>
      <div className="inventoryTools">
        <div className="segment" aria-label="依赖分类">
          {['全部', '运行', '开发', '可选', '配套', '插件'].map((v) => (
            <button
              key={v}
              aria-pressed={filter === v}
              className={filter === v ? 'on' : ''}
              onClick={() => {
                setFilter(v)
                setExpanded(false)
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="directoryTools">
          <label className="depSearch">
            <Icon name="search" size={14} />
            <input
              aria-label="筛选依赖名称"
              placeholder="筛选依赖名称"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setExpanded(false)
              }}
            />
          </label>
          {filtered.length > previewSize && (
            <Disclosure
              noun="依赖"
              count={filtered.length}
              controls={tableId}
              expanded={expanded}
              onToggle={() => setExpanded(!expanded)}
            />
          )}
        </div>
      </div>
      <div className="depScroll" id={tableId}>
        <table className="depTable">
          <thead>
            <tr>
              {[
                '依赖名称',
                '声明范围',
                '锁定版本',
                '范围内最新',
                '最新稳定版',
                '版本差距',
              ].map((c) => (
                <th scope="col" key={c}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => {
              const c = d.comparison
              const gap = compactGap(c?.gap || '查询中…')
              return (
                <tr key={d.name}>
                  <td>
                    <button
                      onClick={() =>
                        source({ file: p.file, line: d.line, label: d.name })
                      }
                    >
                      <code>{d.name}</code>
                    </button>
                    <small>
                      {d.group}
                      {isPlugin(d) ? ' · 插件' : ''}
                    </small>
                  </td>
                  <td>
                    <code>{d.range}</code>
                  </td>
                  <td>
                    {d.lockEvidence?.length ? (
                      d.lockEvidence.map((e) => (
                        <button
                          className="lockEvidence"
                          key={e.file}
                          title={e.file}
                          onClick={() =>
                            source({ file: e.file, line: 1, label: '锁文件' })
                          }
                        >
                          {e.manager} <code>{e.version}</code>
                        </button>
                      ))
                    ) : (
                      <code>{d.version || '未知'}</code>
                    )}
                  </td>
                  <td>
                    <code title="范围内最高的未弃用正式版本">
                      {c?.within || (c?.checked ? '无适用版' : '—')}
                    </code>
                  </td>
                  <td
                    title={
                      c?.checked ? '查询时间 ' + time(c.checked) : undefined
                    }
                  >
                    <strong>{c?.latest || '—'}</strong>
                    {c?.stale && <small>离线缓存</small>}
                    {c?.tag && c.tag !== c.latest && (
                      <small>latest 标签 {c.tag}</small>
                    )}
                  </td>
                  <td>
                    <span
                      title={c?.gap}
                      className={
                        'depGap ' +
                        (gap.includes('落后')
                          ? 'major'
                          : gap === '已是最新'
                            ? 'current'
                            : '')
                      }
                    >
                      {d.lookup ? gap : '仅本地'}
                    </span>
                    {!d.lookup && <small>{d.localReason}</small>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!filtered.length && (
        <p className="inventoryNote">
          {p.deps.length
            ? '没有符合筛选条件的依赖。'
            : '这份清单没有声明直接依赖。'}
        </p>
      )}
      <footer className="inventoryFooter">
        <span aria-live="polite">
          {pending
            ? '正在查询 ' + pending + ' 个公共依赖'
            : date
              ? '公共版本更新于 ' + time(date)
              : eligible.length
                ? '公共查询已结束'
                : '仅本地分析'}
          {failed ? ' · ' + failed + ' 项查询失败' : ''}
          {stale ? ' · ' + stale + ' 项使用离线缓存' : ''}
        </span>
        {expanded && filtered.length > previewSize && (
          <Disclosure
            noun="依赖"
            count={filtered.length}
            controls={tableId}
            expanded={expanded}
            onToggle={() => setExpanded(!expanded)}
          />
        )}
      </footer>
      {p.config && (
        <details className="nuxtPlugins">
          <summary>Nuxt 模块与插件注册 · {registrations.length}</summary>
          {registrations.map((r, i) => (
            <button
              key={i}
              onClick={() => source({ ...r, label: 'Nuxt 插件配置' })}
            >
              <code>{r.name}</code>
              <span>
                {r.kind} · {r.file}:{r.line}
              </span>
            </button>
          ))}
          {p.config.dynamic && (
            <p>配置含动态表达式，请打开配置文件核对其余注册项。</p>
          )}
          <button
            className="textBtn"
            onClick={() =>
              source({ file: p.config!.file, line: 1, label: 'Nuxt 配置' })
            }
          >
            查看配置文件 <Icon name="arrow" size={13} />
          </button>
        </details>
      )}
    </>
  )
}
export function DependencyInventory({
  projects,
  source,
  legacy,
}: {
  projects: InventoryProject[]
  source: (e: Location) => void
  legacy: boolean
}) {
  const [selected, setSelected] = useState('')
  const p =
    projects.find((v) => v.file === selected) ||
    projects.find((v) => !v.dir) ||
    projects[0]
  return (
    <section className="inventoryCard" aria-label="技术栈与依赖">
      <header className="moduleHead">
        <h2>技术栈与依赖 {p && <span>{p.deps.length}</span>}</h2>
        {projects.length > 1 ? (
          <select
            aria-label="选择项目清单"
            value={p.file}
            onChange={(e) => setSelected(e.target.value)}
          >
            {projects.map((v) => (
              <option key={v.file} value={v.file}>
                {v.file}
              </option>
            ))}
          </select>
        ) : (
          p?.lock && (
            <button
              className="textBtn"
              onClick={() =>
                source({ file: p.lock!, line: 1, label: '项目锁文件' })
              }
            >
              {p.manager} · {p.lock.split('/').pop()}{' '}
              <Icon name="chev" size={13} />
            </button>
          )
        )}
      </header>
      {legacy ? (
        <p className="inventoryNote">重新扫描后可查看依赖版本对比。</p>
      ) : p ? (
        <Contents key={p.file} project={p} source={source} />
      ) : (
        <p className="inventoryNote">
          未发现可解析的 package.json。公共版本对比当前支持 JavaScript /
          TypeScript 项目。
        </p>
      )}
    </section>
  )
}
