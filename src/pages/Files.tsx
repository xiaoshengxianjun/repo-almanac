import { lazy, useState, useEffect, Fragment, Suspense } from 'react'
import { Button, Empty, Icon, bytes, fmt, groups } from '../components/ui'
import { api } from '../desktop'

const VolumeChart = lazy(() => import('../components/VolumeChart'))

export function Files({ s, source, toast }: any) {
  const [folder, setFolder] = useState(''),
    [business, setBusiness] = useState(false),
    [q, setQ] = useState(''),
    [page, setPage] = useState(0),
    [data, setData] = useState<any>(null),
    [more, setMore] = useState(false)
  useEffect(() => {
    let ok = true
    api
      .files(s.id, { folder, business, query: q, page })
      .then((v: any) => ok && setData(v))
      .catch((e: any) => ok && toast(e.message))
    return () => {
      ok = false
    }
  }, [s.id, folder, business, q, page])
  function descend(dir: string) {
    setPage(0)
    setMore(false)
    setFolder(dir)
  }
  function pick(n: any) {
    const p = [folder, n.name].filter(Boolean).join('/')
    if (n.folder) descend(p)
    else source({ file: p, line: 1, label: n.name })
  }
  const parts = folder.split('/').filter(Boolean),
    valid = (data?.nodes || []).filter((n: any) => n.bytes > 0),
    unused = valid.slice(25)
  const mapItems = valid.slice(0, 25)
  if (unused.length)
    mapItems.push({
      name: '其他 ' + unused.length + ' 项',
      bytes: unused.reduce((a: any, b: any) => a + b.bytes, 0),
      other: true,
    })

  return (
    <>
      <div className="pageIntro">
        <h1>文件分布</h1>
        <p>按实际字节数浏览目录和文件，点击色块下钻或打开文件。</p>
      </div>
      <section className="panel padded">
        <div className="toolbar">
          <div className="crumbs">
            <button onClick={() => descend('')}>
              <Icon name="folder" size={16} />
              项目根目录
            </button>
            {parts.map((n, i) => (
              <Fragment key={i}>
                /
                <button
                  onClick={() => descend(parts.slice(0, i + 1).join('/'))}
                >
                  {n}
                </button>
              </Fragment>
            ))}
          </div>
          <div className="fileControls">
            {data?.nodes.some((n: any) => n.folder) && (
              <select
                className="directoryPicker"
                aria-label="进入子目录"
                value=""
                onChange={(e) => {
                  if (e.target.value)
                    descend([folder, e.target.value].filter(Boolean).join('/'))
                }}
              >
                <option value="">进入子目录…</option>
                {data.nodes
                  .filter((n: any) => n.folder)
                  .map((n: any) => (
                    <option key={n.name} value={n.name}>
                      {n.name}
                    </option>
                  ))}
              </select>
            )}
            <div className="segment">
              {['全部文件', '业务文件'].map((v, i) => (
                <button
                  key={v}
                  aria-pressed={business === !!i}
                  className={business === !!i ? 'on' : ''}
                  onClick={() => {
                    setBusiness(!!i)
                    setPage(0)
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Suspense fallback={<div className="treemap" />}>
          <VolumeChart
            nodes={mapItems}
            pick={(n: any) => (n.other ? setMore(true) : pick(n))}
          />
        </Suspense>
        {more && (
          <div className="wrap">
            {unused.map((n: any) => (
              <button className="textBtn" key={n.name} onClick={() => pick(n)}>
                {n.name}
              </button>
            ))}
          </div>
        )}
        <div className="sectionHead">
          <h2>
            文件清单{' '}
            <small>
              {fmt(data?.n || 0)} 个 · {bytes(data?.bytes || 0)}
            </small>
          </h2>
          <div className="searchField">
            <Icon name="search" size={15} />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(0)
              }}
              aria-label="筛选路径或文件名"
              placeholder="筛选路径或文件名"
            />
          </div>
        </div>
        <div className="fileTable">
          {data?.rows.map((f: any) => (
            <button
              key={f.path}
              onClick={() =>
                source({
                  file: f.path,
                  line: 1,
                  label: f.path.split('/').pop(),
                })
              }
            >
              <Icon name="file" size={15} />
              <code>{f.path}</code>
              <span>{groups[f.kind][0]}</span>
              <b>{bytes(f.bytes)}</b>
            </button>
          ))}
        </div>
        {data?.n === 0 && <Empty>没有匹配的文件</Empty>}
        <div className="pager">
          <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <span>
            {page + 1} / {Math.max(1, Math.ceil((data?.n || 0) / 60))}
          </span>
          <Button
            disabled={(page + 1) * 60 >= (data?.n || 0)}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      </section>
    </>
  )
}
