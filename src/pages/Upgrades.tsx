import { useState } from 'react'
import { Button, Empty, Icon, statuses } from '../components/ui'

export function Upgrades({ s, selected, setSelected, source, ai }: any) {
  const [filter, setFilter] = useState('all')
  const findings = s.findings.filter(
      (f: any) => filter === 'all' || f.status === filter,
    ),
    f = findings.find((v: any) => v.id === selected) || findings[0]
  return (
    <>
      <div className="pageIntro headingAction">
        <div>
          <h1>升级建议</h1>
          <p>结合锁定版本、运行环境和插件约束，核对升级前置条件。</p>
        </div>
      </div>
      <div className="segment filter">
        {['all', 'blocked', 'unknown', 'ready'].map((k) => (
          <button
            aria-pressed={k === filter}
            className={k === filter ? 'on' : ''}
            key={k}
            onClick={() => setFilter(k)}
          >
            {statuses[k] || '全部建议'}
          </button>
        ))}
      </div>
      <div className="split">
        <section className="panel listPane">
          {findings.map((v: any) => (
            <button
              key={v.id}
              className={'choice ' + (v.id === f?.id ? 'selected' : '')}
              aria-pressed={v.id === f?.id}
              onClick={() => setSelected(v.id)}
            >
              <span>
                <small className={'status ' + v.status}>
                  {statuses[v.status]}
                </small>
                <b>{v.title}</b>
                <small>{v.scope}</small>
              </span>
            </button>
          ))}
          {!findings.length && <Empty>此分类下没有建议</Empty>}
        </section>
        <section className="panel detail">
          {f ? (
            <>
              <div className="sectionHead">
                <div>
                  <span className="kicker">{f.scope}</span>
                  <h2>{f.title}</h2>
                </div>
                <Button icon="book" onClick={() => ai('upgrade', f)}>
                  解释建议
                </Button>
              </div>
              <div className="versionBox">
                <code>{f.from}</code>
                <Icon name="arrow" />
                <code>{f.target}</code>
                <span className={'status ' + f.status}>
                  {statuses[f.status]}
                </span>
              </div>
              <p>{f.reason}</p>
              {f.checks
                ?.filter((v: string) => !f.reason.includes(v))
                .map((v: string) => (
                  <p className="notice" key={v}>
                    {v}
                  </p>
                ))}
              <h3>项目证据</h3>
              {f.evidence.map((e: any, i: number) => (
                <button className="evidence" key={i} onClick={() => source(e)}>
                  <Icon name="code" size={15} />
                  {e.label}
                  <code>
                    {e.file}:{e.line}
                  </code>
                </button>
              ))}
              <h3>实施与验证</h3>
              <ol className="plan">
                {f.steps.map((v: string, i: number) => (
                  <li key={i}>{v}</li>
                ))}
              </ol>
              <h3>回退方式</h3>
              <p>{f.rollback}</p>
              <small className="muted">依据 · {f.source}</small>
            </>
          ) : (
            <Empty>
              此分类暂无升级建议。项目概览中可查看依赖版本和查询状态。
            </Empty>
          )}
        </section>
      </div>
    </>
  )
}
