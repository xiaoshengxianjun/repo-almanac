import { Icon } from './ui'
export function Disclosure({
  expanded,
  onToggle,
  noun,
  count,
  controls,
}: {
  expanded: boolean
  onToggle: () => void
  noun: string
  count: number
  controls: string
}) {
  const label = expanded ? '收起' + noun : '展开全部' + count + '项' + noun
  return (
    <button
      type="button"
      className="disclosure"
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {expanded ? '收起' : '展开全部'}
      <span aria-hidden="true">{expanded ? '' : count}</span>
      <Icon name="chev" size={14} />
    </button>
  )
}
