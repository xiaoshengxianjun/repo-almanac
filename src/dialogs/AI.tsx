import { useState, useEffect } from 'react'
import { Button, Modal } from '../components/ui'
import { api, tidy } from '../desktop'
import { aiContext } from '../../shared/ai-context.mjs'

export function AI({ s, ctx, close, settings }: any) {
  const [cfg, setCfg] = useState<any>(),
    [busy, setBusy] = useState(false),
    [data, setData] = useState<any[]>([]),
    [err, setErr] = useState('')
  useEffect(() => {
    api.settings().then(setCfg)
  }, [])
  return (
    <Modal
      title={ctx.type === 'flow' ? '解释业务流程' : '解释升级建议'}
      close={close}
    >
      <h3>{ctx.item.name}</h3>
      <p>下列证据的位置、标签和相关规则结论会发送到所选模型服务。</p>
      <div className="payload">
        <code>{JSON.stringify(aiContext(ctx.type, ctx.item), null, 2)}</code>
      </div>
      {cfg?.url && (
        <small className="muted">
          {cfg.model} · {cfg.url}
        </small>
      )}
      {err && <p className="notice">{err}</p>}
      {data.map((v, i) => (
        <p key={i}>
          {v.text} <small>〔证据 {v.evidenceIds.join('、')}〕</small>
        </p>
      ))}
      <div className="actions">
        {cfg?.url && cfg.model ? (
          <Button
            primary
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              setErr('')
              try {
                setData(await api.explain(s.id, ctx.type, ctx.item.id))
              } catch (e) {
                setErr(tidy(e))
              } finally {
                setBusy(false)
              }
            }}
          >
            {busy ? '正在生成…' : '发送并生成解释'}
          </Button>
        ) : (
          <Button onClick={settings} icon="settings">
            配置模型服务
          </Button>
        )}
      </div>
    </Modal>
  )
}
