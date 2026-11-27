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
      <hr />
      <h3>隐私与本地数据</h3>
      <p>
        扫描在本机只读进行。索引保存在以下应用目录，导出报告时请选择项目外的位置。
      </p>
      {v.dataDirectory && <code className="longPath">{v.dataDirectory}</code>}
      <p>
        扫描后会自动向公共 npm
        注册表发送可确认公开的依赖名称。版本比较在本机完成，24
        小时内复用缓存，过期后再次查询时尝试刷新。私有源、本地引用和来源待确认的依赖仅在本机展示。
      </p>
      <p>AI 解释需单独确认，模型服务会收到预览中的证据。</p>
      {hasIndex && (
        <div className="wrap">
          <Button onClick={clear}>清除项目索引</Button>
        </div>
      )}
    </Modal>
  )
}
