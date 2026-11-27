import { useState, useEffect } from 'react'
import { Empty, Icon, Modal, bytes, flowIcon } from '../components/ui'
import { api, type FileRow } from '../desktop'

export function Search({ s, source, openFlow, openFinding, close }: any) {
  const [q, setQ] = useState(''),
    [files, setFiles] = useState<FileRow[]>([])
  useEffect(() => {
    let ok = true
    api
      .files(s.id, { query: q })
      .then((v) => {
        if (ok) setFiles(v.rows.slice(0, 12))
      })
      .catch(() => {})
    return () => {
      ok = false
    }
  }, [q, s.id])
  const text = q.toLowerCase(),
    flows = s.flows
      .filter((f: any) =>
        [f.name, f.page, f.url, ...f.steps.map((e: any) => e.label)]
          .join(' ')
          .toLowerCase()
          .includes(text),
      )
      .slice(0, 12)
  const symbols = q
    ? s.symbols
        .filter((v: any) =>
          (v.label + ' ' + v.file).toLowerCase().includes(text),
        )
        .slice(0, 18)
    : []
  const found = q
    ? s.findings
        .filter((f: any) => f.title.toLowerCase().includes(text))
        .slice(0, 8)
    : []
  return (
    <Modal title="搜索项目" close={close}>
      <div className="searchField big">
        <Icon name="search" />
        <input
          data-autofocus
          aria-label="搜索业务、路由、符号或文件"
          placeholder="业务名称、路由、符号或文件路径"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="searchResults">
        {flows.map((f: any) => (
          <button key={'f' + f.id} onClick={() => openFlow(f)}>
            <Icon name={flowIcon(f)} />
            <b>{f.name}</b>
            <small>{f.page} · 业务流程</small>
          </button>
        ))}
        {symbols.map((v: any, i: number) => (
          <button key={'s' + i} onClick={() => source(v)}>
            <Icon name="code" />
            <b>{v.label}</b>
            <small>
              {v.file}:{v.line}
            </small>
          </button>
        ))}
        {found.map((f: any) => (
          <button key={f.id} onClick={() => openFinding(f)}>
            <Icon name="upgrade" />
            <b>{f.title}</b>
            <small>升级建议</small>
          </button>
        ))}
        {files.map((f) => (
          <button
            key={f.path}
            onClick={() =>
              source({ file: f.path, line: 1, label: f.path.split('/').pop() })
            }
          >
            <Icon name="file" />
            <code>{f.path}</code>
            <small>{bytes(f.bytes)}</small>
          </button>
        ))}
        {!flows.length && !symbols.length && !files.length && !found.length && (
          <Empty>没有匹配的结果</Empty>
        )}
      </div>
    </Modal>
  )
}
