import { useState, useEffect } from 'react'
import { Button, Modal } from '../components/ui'
import { api, tidy } from '../desktop'

export function Settings({ close, toast, hasIndex, clear }: any) {
  const [v, set] = useState<any>({ url: '', model: '' }),
    [key, setKey] = useState<string | undefined>(),
    [error, setError] = useState('')
  useEffect(() => {
    api.settings().then(set)
  }, [])
  return (
    <Modal title="应用设置" close={close}>
      <h3>AI 模型服务</h3>
      <p>支持聊天补全接口。服务地址填写到 API 前缀，项目分析可独立运行。</p>
      <label className="field">
        服务地址
        <input
          value={v.url}
          placeholder="http://localhost:11434/v1"
          onChange={(e) => set({ ...v, url: e.target.value })}
        />
      </label>
      <label className="field">
        模型名称
        <input
          value={v.model}
          onChange={(e) => set({ ...v, model: e.target.value })}
        />
      </label>
      <label className="field">
        API Key
        <input
          type="password"
          autoComplete="off"
          value={key || ''}
          placeholder={v.hasKey ? '已保存，留空保留原密钥' : '本地模型可留空'}
          onChange={(e) => setKey(e.target.value)}
        />
      </label>
      {error && <p className="notice">{error}</p>}
      <div className="actions">
        <Button
          primary
          onClick={async () => {
            try {
              await api.configure({ ...v, key })
              toast('模型设置已保存')
              close()
            } catch (e) {
              setError(tidy(e))
            }
          }}
        >
          保存设置
        </Button>
      </div>
      {hasIndex && (
        <>
          <hr />
          <h3>本地工作区</h3>
          <div className="wrap">
            <Button onClick={clear}>清除项目索引</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
