import { useState, useEffect } from 'react'
import { Button, Modal } from '../components/ui'
import { api, tidy } from '../desktop'

export function Source({ s, item, close, onFlow, onSource, toast }: any) {
  const [v, set] = useState<any>(null),
    [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    set(null)
    setErr('')
    api
      .source(s.id, item)
      .then((r: any) => live && set(r))
      .catch((e: any) => live && setErr(tidy(e)))
    return () => {
      live = false
    }
  }, [s.id, item])
  const related = s.flows.filter((f: any) =>
    f.steps.some((e: any) => e.file === item.file && e.line === item.line),
  )
  const links = (s.imports || [])
    .filter((r: any) => r.from === item.file || r.to === item.file)
    .slice(0, 24)
  return (
    <Modal wide title={item.label || '源码预览'} close={close}>
      <div className="sourceBar">
        <code>
          {item.file}:{item.line}
        </code>
        <Button
          icon="copy"
          onClick={() =>
            api
              .copy(item.file + ':' + item.line)
              .then(() => toast('文件位置已复制'))
          }
        >
          复制位置
        </Button>
      </div>
      {err || v?.notice ? (
        <p className="notice">{err || v.notice}</p>
      ) : v ? (
        <div className="sourceCode">
          {v.lines.map((l: string, i: number) => (
            <div key={i} className={i + v.start === v.focus ? 'hit' : ''}>
              <span>{i + v.start}</span>
              <pre>{l || ' '}</pre>
            </div>
          ))}
        </div>
      ) : (
        <p>读取文件中…</p>
      )}
      {related.length > 0 && (
        <>
          <h3>关联业务流程</h3>
          <div className="wrap">
            {related.map((f: any) => (
              <Button key={f.id} icon="flow" onClick={() => onFlow(f)}>
                {f.name}
              </Button>
            ))}
          </div>
        </>
      )}
      {links.length > 0 && (
        <>
          <h3>本地模块引用</h3>
          {links.map((r: any, i: number) => {
            const outgoing = r.from === item.file
            const file = outgoing ? r.to : r.from
            return (
              <button
                className="evidence"
                key={i}
                onClick={() =>
                  onSource({ file, line: outgoing ? 1 : r.line, label: file })
                }
              >
                {outgoing ? '导入模块' : '被引用于'}
                <code>{file}</code>
              </button>
            )
          })}
        </>
      )}
    </Modal>
  )
}
