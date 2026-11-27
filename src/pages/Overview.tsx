import { useMemo, useState } from 'react'
import {
  Icon,
  Empty,
  bytes,
  fmt,
  groups,
  statuses,
  types,
} from '../components/ui'
import archiveArt from '../art/archive.webp'

interface Evidence {
  type: string
  file: string
  line: number
  label: string
}
interface Flow {
  id: string
  name: string
  page: string
  url: string
  steps: Evidence[]
  notes: string[]
}
interface Category {
  kind: string
  count: number
  bytes: number
}

function traceHighlights(flow: Flow) {
  const steps = flow.steps
  const action = steps.find((e) => e.type === 'event') || steps[0]
  const request =
    steps.find((e) => e.type === 'http') ||
    steps.find((e) => e.type === 'handler')
  return [...new Set([action, request, steps.at(-1)])].filter(
    (e): e is Evidence => Boolean(e),
  )
}

function WorkflowIndex({
  flows,
  go,
  openFlow,
  source,
}: {
  flows: Flow[]
  go: (tab: string) => void
  openFlow: (f: Flow) => void
  source: (e: Evidence) => void
}) {
  const [selected, setSelected] = useState('')
  const current = flows.find((f) => f.id === selected) || flows[0]
  return (
    <section className="flowBoard">
      <header className="moduleHead">
        <h2>
          业务流程 <span>{fmt(flows.length)}</span>
        </h2>
        <button className="textBtn" onClick={() => go('flows')}>
          全部流程 <Icon name="arrow" size={15} />
        </button>
      </header>
      {current ? (
        <div className="flowWorkbench">
          <div className="flowIndex" aria-label="选择预览流程">
            {flows.slice(0, 5).map((f) => (
              <button
                type="button"
                key={f.id}
                className={'flowRow ' + (f === current ? 'chosen' : '')}
                aria-pressed={f === current}
                onClick={() => setSelected(f.id)}
              >
                <span className="flowPin" aria-hidden="true" />
                <span
                  className="flowRowText"
                  title={f.name + ' · ' + (f.url || f.page)}
                >
                  <b>{f.name}</b>
                  <code>{f.url || f.page}</code>
                </span>
                <Icon name="chev" size={14} />
              </button>
            ))}
          </div>
          <div className="tracePreview">
            <div className="traceHead">
              <div>
                <span className="traceLabel">
                  <Icon name="flow" size={14} />
                  调用链预览
                </span>
                <h3 title={current.name}>{current.name}</h3>
              </div>
              <button className="textBtn" onClick={() => openFlow(current)}>
                完整 {current.steps.length} 步 <Icon name="arrow" size={14} />
              </button>
            </div>
            <div className="traceCanvas">
              <ol className="traceNodes" key={current.id}>
                {traceHighlights(current).map((e) => (
                  <li key={[e.type, e.file, e.line, e.label].join('|')}>
                    <button
                      onClick={() => source(e)}
                      title={e.label + ' · ' + e.file + ':' + e.line}
                    >
                      <span className={'nodeIcon ' + e.type}>
                        <Icon
                          name={
                            e.type === 'http'
                              ? 'network'
                              : e.type === 'server'
                                ? 'terminal'
                                : e.type === 'event'
                                  ? 'flag'
                                  : e.type === 'storage'
                                    ? 'db'
                                    : 'code'
                          }
                          size={17}
                        />
                      </span>
                      <small>{types[e.type] || e.type}</small>
                      <b>{e.label}</b>
                      <code>
                        {e.file.split('/').pop()}:{e.line}
                      </code>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
            {current.notes.length > 0 && (
              <div className="traceNotes">
                <Icon name="info" size={14} />
                {current.notes.join('；')}
              </div>
            )}
          </div>
        </div>
      ) : (
        <Empty>
          此项目未识别到静态页面操作。可从项目阅读入口或文件清单查看源码。
        </Empty>
      )}
    </section>
  )
}

function Composition({
  stats,
  go,
}: {
  stats: Category[]
  go: (tab: string) => void
}) {
  const [measure, setMeasure] = useState<'count' | 'bytes'>('count')
  const ordered = [...stats].sort((a, b) => b[measure] - a[measure])
  const peak = ordered[0]?.[measure] || 1
  return (
    <section className="compositionPanel">
      <header className="moduleHead">
        <h2>文件构成</h2>
        <div className="segment" aria-label="文件构成指标">
          {(['count', 'bytes'] as const).map((k) => (
            <button
              key={k}
              className={measure === k ? 'on' : ''}
              aria-pressed={measure === k}
              onClick={() => setMeasure(k)}
            >
              {k === 'count' ? '按数量' : '按体积'}
            </button>
          ))}
        </div>
      </header>
      <div className="bars">
        {ordered.map((g) => (
          <div className="barRow" key={g.kind}>
            <span>{groups[g.kind][0]}</span>
            <div className="barTrack" aria-hidden="true">
              <i
                style={{
                  width: (100 * g[measure]) / peak + '%',
                  backgroundColor: groups[g.kind][1],
                }}
              />
            </div>
            <b>{measure === 'count' ? fmt(g.count) : bytes(g.bytes)}</b>
          </div>
        ))}
      </div>
      {!ordered.length && <Empty>扫描范围内没有普通文件。</Empty>}
      <button className="textBtn sectionLink" onClick={() => go('files')}>
        查看文件分布 <Icon name="arrow" size={14} />
      </button>
    </section>
  )
}

export function Overview({
  s,
  go,
  openFlow,
  openFinding,
  source,
  scanDetails,
  rescan,
  scanning,
}: any) {
  const flows = useMemo(() => {
    const routes = new Map<string, number>()
    for (const route of s.routes || [])
      if (!routes.has(route.url)) routes.set(route.url, routes.size)
    return [...s.flows].sort(
      (a, b) =>
        (routes.get(a.url) ?? Infinity) - (routes.get(b.url) ?? Infinity) ||
        b.steps.length - a.steps.length,
    )
  }, [s.flows, s.routes])
  const timestamp = new Date(s.date)
  return (
    <div className="overview">
      <header className="projectHeader">
        <div className="heroCopy">
          <button
            className={'snapshotLink' + (s.readErrors ? ' hasIssues' : '')}
            onClick={scanDetails}
            title="查看扫描详情"
          >
            <i aria-hidden="true" />
            {s.readErrors ? '扫描有待核对项' : '已完成扫描'}
            <span>·</span>
            <time dateTime={s.date}>
              {timestamp.toLocaleString('zh-CN', {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              })}
            </time>
            <Icon name="chev" size={12} />
          </button>
          <div className="projectIdentity">
            <h1>{s.name}</h1>
            {s.slug !== s.name && <code>{s.slug}</code>}
          </div>
          {s.description && <p>{s.description}</p>}
          <div className="heroTools">
            <button className="heroScan" onClick={rescan} disabled={scanning}>
              <Icon name="refresh" size={14} />
              {scanning ? '扫描中' : '重新扫描'}
            </button>
            {s.tags.length > 0 && (
              <div className="stackLine" aria-label="技术栈">
                {s.tags.map((tag: string) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="heroArt" aria-hidden="true">
          <img src={archiveArt} alt="" draggable={false} />
        </div>
      </header>
      <div className="metrics">
        {[
          ['项目文件', fmt(s.fileCount), 'files', 'files', 'blue'],
          ['文件总大小', bytes(s.bytes), 'files', 'disk', 'teal'],
          ['业务流程', fmt(s.flows.length), 'flows', 'flow', 'violet'],
          ['升级建议', fmt(s.findings.length), 'upgrades', 'upgrade', 'coral'],
        ].map(([label, value, tab, icon, tone]) => (
          <button
            key={label}
            className={'metric ' + tone}
            onClick={() => go(tab)}
          >
            <span className="metricIcon" aria-hidden="true">
              <Icon name={icon} size={20} />
            </span>
            <span className="metricValue">
              <small>{label}</small>
              <strong>{value}</strong>
            </span>
            <Icon name="chev" size={12} />
          </button>
        ))}
      </div>
      <WorkflowIndex
        flows={flows}
        go={go}
        openFlow={openFlow}
        source={source}
      />
      <div className="analysisGrid">
        <div className="insightColumn">
          <section className="upgradePanel">
            <header className="moduleHead">
              <h2>
                升级建议 <span>{s.findings.length}</span>
              </h2>
              <button className="textBtn" onClick={() => go('upgrades')}>
                全部建议 <Icon name="arrow" size={14} />
              </button>
            </header>
            {s.findings.slice(0, 4).map((f: any) => (
              <button
                className="findingRow"
                key={f.id}
                onClick={() => openFinding(f)}
              >
                <span className={'status ' + f.status}>
                  {statuses[f.status]}
                </span>
                <span>
                  <b>{f.title}</b>
                  <code>
                    {f.from} → {f.target}
                  </code>
                </span>
                <Icon name="chev" size={15} />
              </button>
            ))}
            {!s.findings.length && <Empty>本地规则暂未发现升级事项。</Empty>}
          </section>
          {(s.readme || s.entries?.length > 0) && (
            <section className="readingPanel">
              <header className="moduleHead">
                <h2>项目阅读入口</h2>
              </header>
              <div className="readingLinks">
                {s.readme && (
                  <button
                    onClick={() =>
                      source({ file: s.readme, line: 1, label: '项目说明' })
                    }
                  >
                    <Icon name="book" size={16} />
                    <b>项目说明</b>
                    <code>{s.readme}</code>
                  </button>
                )}
                {s.entries?.slice(0, 8).map((e: Evidence) => (
                  <button key={e.file} onClick={() => source(e)}>
                    <Icon name="terminal" size={16} />
                    <b>候选入口</b>
                    <code>{e.file}</code>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
        <Composition stats={s.stats.all} go={go} />
      </div>
    </div>
  )
}
