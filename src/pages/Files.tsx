import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Button, Empty, Icon, bytes, fmt, groups } from '../components/ui'
import type { VolumeTile } from '../components/VolumeChart'
import {
  api,
  tidy,
  type FileListing,
  type FileRow,
  type Snapshot,
} from '../desktop'

const VolumeChart = lazy(() => import('../components/VolumeChart'))
const palette = [
  '#c1acca',
  '#e6b49d',
  '#9dc6ba',
  '#a9bed5',
  '#deca97',
  '#c2b3cf',
  '#d9adba',
  '#aabfc1',
]
const pageSize = 60
type Node = FileListing['nodes'][number]
interface View {
  folder: string
  includeOthers: boolean
  query: string
  page: number
}
interface Result {
  view: View
  listing?: FileListing
  error?: string
}
const initial: View = { folder: '', includeOthers: false, query: '', page: 0 }
function share(part: number, total: number) {
  const percent = total ? (100 * part) / total : 0
  return percent > 0 && percent < 0.1
    ? '<0.1%'
    : percent.toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + '%'
}

export function Files({
  s,
  source,
}: {
  s: Snapshot
  source: (location: { file: string; line: number; label: string }) => void
}) {
  const [view, setView] = useState<View>(initial)
  const [result, setResult] = useState<Result | null>(null),
    [more, setMore] = useState(false)
  const { folder, includeOthers, query, page } = view
  const data = result?.view === view ? result.listing : undefined
  const error = result?.view === view ? result.error : undefined
  useEffect(() => {
    let live = true
    api
      .files(s.id, { folder, business: !includeOthers, query, page })
      .then((listing) => {
        if (live) setResult({ view, listing })
      })
      .catch((e) => {
        if (live) setResult({ view, error: tidy(e) })
      })
    return () => {
      live = false
    }
  }, [s.id, view])
  function change(update: Partial<View>) {
    setMore(false)
    setView((previous) => ({ ...previous, page: 0, ...update }))
  }
  function toggle() {
    change({
      includeOthers: !includeOthers,
      folder: includeOthers ? (data?.businessAncestor ?? '') : folder,
    })
  }
  function openFile(file: string) {
    source({ file, line: 1, label: file.split('/').pop() || file })
  }
  function pick(node: Node) {
    const path = [folder, node.name].filter(Boolean).join('/')
    if (node.folder) change({ folder: path })
    else openFile(path)
  }
  const { tiles, remaining } = useMemo(() => {
    const nonempty = (data?.nodes || []).filter((n) => n.bytes > 0)
    const tiles: VolumeTile[] = nonempty
      .slice(0, 25)
      .map((n, i) => ({ ...n, color: palette[i % palette.length] }))
    const remaining = nonempty.slice(25)
    if (remaining.length)
      tiles.push({
        name: '其余 ' + fmt(remaining.length) + ' 项',
        kind: 'other',
        folder: 0,
        color: '#dedbe0',
        other: true,
        bytes: remaining.reduce((sum, n) => sum + n.bytes, 0),
        count: remaining.reduce((sum, n) => sum + n.count, 0),
      })
    return { tiles, remaining }
  }, [data])
  const ranked = tiles.filter((n) => !n.other).slice(0, 5)
  const parts = folder.split('/').filter(Boolean)
  const folders = data?.nodes.filter((n) => n.folder) || []
  const hasHidden =
    s.stats.business.reduce(
      (n: number, r: { count: number }) => n + Number(r.count),
      0,
    ) < s.fileCount
  const emptyText = query
    ? '没有符合筛选条件的文件'
    : !includeOthers && hasHidden
      ? '当前范围没有业务文件，可开启「显示非业务文件」查看。'
      : '当前目录没有已索引的文件。'

  function renderRow(f: FileRow) {
    const slash = f.path.lastIndexOf('/'),
      name = f.path.slice(slash + 1)
    return (
      <tr key={f.path}>
        <td>
          <button
            className="fileNameButton"
            title={f.path}
            onClick={() => openFile(f.path)}
          >
            <span className="fileGlyph" style={{ color: groups[f.kind][1] }}>
              <Icon name="file" size={17} />
            </span>
            <span>
              <strong>{name}</strong>
              {slash >= 0 && <code>{f.path.slice(0, slash)}</code>}
            </span>
          </button>
        </td>
        <td>
          <span className="fileKind">
            <i style={{ background: groups[f.kind][1] }} />
            {groups[f.kind][0]}
          </span>
        </td>
        <td className="fileBytes">{bytes(f.bytes)}</td>
      </tr>
    )
  }
  return (
    <div className="filesView">
      <header className="filesIntro">
        <div>
          <h1>文件分布</h1>
          <p>按体积浏览目录，定位占用空间的文件。</p>
        </div>
        <label className="fileScope">
          <span>
            <strong>显示非业务文件</strong>
            <small>依赖、Git、构建产物及忽略项</small>
          </span>
          <input
            type="checkbox"
            role="switch"
            aria-label="显示非业务文件"
            checked={includeOthers}
            onChange={toggle}
          />
          <i aria-hidden="true" />
        </label>
      </header>
      <div className="filesToolbar">
        <nav className="crumbs" aria-label="文件目录路径">
          <Icon name="folder" size={16} />
          <button
            aria-current={!folder ? 'location' : undefined}
            onClick={() => change({ folder: '' })}
          >
            项目根目录
          </button>
          {parts.map((name, i) => (
            <Fragment key={i}>
              <Icon name="chev" size={12} />
              <button
                aria-current={i === parts.length - 1 ? 'location' : undefined}
                onClick={() =>
                  change({ folder: parts.slice(0, i + 1).join('/') })
                }
              >
                {name}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="fileControls">
          <select
            className="directoryPicker"
            aria-label="进入子目录"
            disabled={!folders.length}
            value=""
            onChange={(e) => {
              if (e.target.value)
                change({
                  folder: [folder, e.target.value].filter(Boolean).join('/'),
                })
            }}
          >
            <option value="">进入子目录…</option>
            {folders.map((n) => (
              <option key={n.name} value={n.name}>
                {n.name}
              </option>
            ))}
          </select>
          <label className="searchField">
            <Icon name="search" size={15} />
            <input
              aria-label="筛选路径或文件名"
              placeholder="筛选路径或文件名"
              value={query}
              onChange={(e) => change({ query: e.target.value })}
            />
            {query && (
              <button
                type="button"
                aria-label="清除筛选"
                onClick={() => change({ query: '' })}
              >
                <Icon name="close" size={13} />
              </button>
            )}
          </label>
        </div>
      </div>
      <section
        className="filesCard"
        aria-label="空间分布"
        aria-busy={!data && !error}
      >
        <header className="filesCardHead">
          <h2>空间分布</h2>
          <span className="volumeMeasure">
            {data ? (
              <>
                <b>{bytes(data.bytes)}</b>
                <span> · {fmt(data.n)} 个文件</span>
              </>
            ) : (
              '—'
            )}
          </span>
        </header>
        {error ? (
          <div role="alert" className="filesEmpty">
            {error}
            <Button onClick={() => change({ page })}>重试</Button>
          </div>
        ) : !data ? (
          <div className="filesEmpty" role="status">
            正在读取文件分布…
          </div>
        ) : !ranked.length ? (
          <div className="filesEmpty">
            <Icon name="folder" size={25} />
            {data.n ? '此范围的文件均为 0 B，可在下方清单中查看。' : emptyText}
          </div>
        ) : (
          <div className="volumeLayout">
            <Suspense fallback={<div className="volumeCanvas" />}>
              <VolumeChart
                nodes={tiles}
                total={data.bytes}
                pick={(n) => (n.other ? setMore(!more) : pick(n))}
              />
            </Suspense>
            <aside className="volumeRanking" aria-label="体积排行">
              <header>
                <h3>体积排行</h3>
                <small>占当前范围</small>
              </header>
              <ol>
                {ranked.map((n) => (
                  <li key={n.name}>
                    <button
                      onClick={() => pick(n)}
                      title={n.name + ' · ' + bytes(n.bytes)}
                    >
                      <span className="rankName">
                        <Icon name={n.folder ? 'folder' : 'file'} size={14} />
                        <b>{n.name}</b>
                      </span>
                      <span className="rankShare">
                        {share(n.bytes, data.bytes)}
                      </span>
                      <span className="rankTrack">
                        <i
                          style={{
                            width: (100 * n.bytes) / data.bytes + '%',
                            background: n.color,
                          }}
                        />
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              {remaining.length > 0 && (
                <button
                  className="textBtn"
                  aria-expanded={more}
                  onClick={() => setMore(!more)}
                >
                  {more
                    ? '收起其余条目'
                    : '查看其余 ' + fmt(remaining.length) + ' 项'}
                  <Icon name="chev" size={12} />
                </button>
              )}
            </aside>
          </div>
        )}
        {more && data && remaining.length > 0 && (
          <div className="volumeMore">
            {remaining.map((n) => (
              <button key={n.name} onClick={() => pick(n)}>
                <Icon name={n.folder ? 'folder' : 'file'} size={13} />
                {n.name}
                <small>{bytes(n.bytes)}</small>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="filesCard" aria-label="文件清单">
        <header className="filesCardHead">
          <h2>文件清单</h2>
          {data && (
            <span className="fileRange">
              {data.n
                ? fmt(page * pageSize + 1) +
                  '–' +
                  fmt(page * pageSize + data.rows.length) +
                  ' / ' +
                  fmt(data.n)
                : '0 项'}
            </span>
          )}
        </header>
        {data?.rows.length ? (
          <table className="distributionTable">
            <thead>
              <tr>
                <th scope="col">文件名 / 所在目录</th>
                <th scope="col">类型</th>
                <th scope="col" aria-sort="descending">
                  大小 ↓
                </th>
              </tr>
            </thead>
            <tbody>{data.rows.map(renderRow)}</tbody>
          </table>
        ) : (
          <Empty>
            {error
              ? '文件清单读取失败'
              : data
                ? emptyText
                : '正在读取文件清单…'}
          </Empty>
        )}
        {data && data.n > pageSize && (
          <div className="pager">
            <Button disabled={!page} onClick={() => change({ page: page - 1 })}>
              上一页
            </Button>
            <span>
              {page + 1} / {Math.ceil(data.n / pageSize)}
            </span>
            <Button
              disabled={(page + 1) * pageSize >= data.n}
              onClick={() => change({ page: page + 1 })}
            >
              下一页
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}
