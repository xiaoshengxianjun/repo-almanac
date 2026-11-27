import { useState } from 'react'
import { Button, Empty, Modal } from '../components/ui'

export function Lookup({ s, close, query }: any) {
  const names = [
    ...new Set<string>(
      s.projects.flatMap((p: any) =>
        p.deps.filter((d: any) => d.lookup).map((d: any) => d.name),
      ),
    ),
  ]
  const [selected, set] = useState(names)
  return (
    <Modal title="查询公共 npm 版本" close={close}>
      <p>
        将以下选中的公开包名称发往
        registry.npmjs.org，获取可用版本及兼容性声明。
      </p>
      <div className="checklist">
        {names.map((n) => (
          <label key={n}>
            <input
              type="checkbox"
              checked={selected.includes(n)}
              onChange={() =>
                set(
                  selected.includes(n)
                    ? selected.filter((x) => x !== n)
                    : [...selected, n],
                )
              }
            />
            <code>{n}</code>
          </label>
        ))}
      </div>
      {!names.length && <Empty>没有可查询的已知公共包</Empty>}
      <div className="actions">
        <Button onClick={close}>取消</Button>
        <Button
          primary
          disabled={!selected.length}
          onClick={() => query(selected)}
        >
          查询 {selected.length} 个包
        </Button>
      </div>
    </Modal>
  )
}
