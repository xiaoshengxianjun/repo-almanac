import { useState } from 'react'
import { Button, Empty, Icon, flowIcon, types } from '../components/ui'

export function Flows({ s, chosen, setChosen, source, ai }: any) {
  const [q, setQ] = useState('')
  const items = s.flows.filter((f: any) =>
    [f.name, f.page, f.url, ...f.steps.map((e: any) => e.label + ' ' + e.file)]
      .join(' ')
      .toLowerCase()
      .includes(q.toLowerCase()),
  )
  const current = items.find((f: any) => f.id === chosen) || items[0]
  return (
    <>
      <div className="pageIntro">
        <h1>业务流程</h1>
        <p>从页面操作追踪关键代码，查看每一步的文件依据。</p>
      </div>
      <div className="split">
        <section className="panel listPane">
          <div className="searchField">
            <Icon name="search" size={16} />
            <input
              aria-label="搜索业务、路由或函数"
              placeholder="搜索业务、路由或函数"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          {items.map((f: any) => (
            <button
              key={f.id}
              className={'choice ' + (f.id === current?.id ? 'selected' : '')}
              aria-pressed={f.id === current?.id}
              title={f.name + ' · ' + (f.url || f.page)}
              onClick={() => setChosen(f.id)}
            >
              <Icon name={flowIcon(f)} />
              <span>
                <b>{f.name}</b>
                <small>
                  {f.page} · {f.steps.length} 步
                </small>
              </span>
            </button>
          ))}
          {!items.length && <Empty>没有匹配的业务流程</Empty>}
        </section>
        <section className="panel detail">
          {current ? (
            <>
              <div className="sectionHead">
                <div>
                  <span className="kicker">{current.url || '页面动作'}</span>
                  <h2>{current.name}</h2>
                </div>
                <Button icon="book" onClick={() => ai('flow', current)}>
                  解释流程
                </Button>
              </div>
              <div className="timeline">
                {current.steps.map((e: any, i: number) => (
                  <button className="step" key={i} onClick={() => source(e)}>
                    <span className="stepNo">{i + 1}</span>
                    <span>
                      <small>
                        {types[e.type]} · {e.detail}
                      </small>
                      <b>{e.label}</b>
                      <code>
                        {e.file}:{e.line}
                      </code>
                    </span>
                    <Icon name="chev" size={14} />
                  </button>
                ))}
              </div>
              {current.notes.map((n: string) => (
                <p className="notice" key={n}>
                  <Icon name="info" size={15} />
                  {n}
                </p>
              ))}
            </>
          ) : (
            <Empty>
              当前适配器支持 Vue 模板事件。可用工作区搜索定位已识别的函数。
            </Empty>
          )}
        </section>
      </div>
    </>
  )
}
