import { useEffect, useRef } from 'react'

const paths: Record<string, string> = {
  book: 'M3 5c4-1 6 0 9 2 3-2 6-3 9-2v13c-4-1-6 0-9 2-3-2-6-3-9-2z M12 7v13',
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  flow: 'M5 4v11a3 3 0 0 0 3 3h7 M6 8h7a3 3 0 0 0 3-3 M3 3h4v4H3z M15 2h5v5h-5z M15 16h5v5h-5z',
  files: 'M3 4h18v16H3z M11 4v16 M11 12h10 M16 12v8',
  upgrade: 'M4 17l6-6 4 3 6-9 M14 5h6v6',
  folder: 'M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11H3z',
  open: 'M3 16V5h6l2 3h8v2 M3 19l3-8h16l-3 8z',
  search: 'M15 15l6 6 M17 10a7 7 0 1 1-14 0 7 7 0 1 1 14 0',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v4h16v-4',
  settings:
    'M4 6h7 M15 6h5 M4 12h2 M10 12h10 M4 18h9 M17 18h3 M11 4v4 M7 10v4 M14 16v4',
  arrow: 'M5 12h14 M14 7l5 5-5 5',
  chev: 'M9 5l7 7-7 7',
  close: 'M5 5l14 14 M19 5L5 19',
  exit: 'M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5 M9 12h12 M16 7l5 5-5 5',
  file: 'M5 3h9l5 5v13H5z M14 3v6h5',
  disk: 'M4 7l2-4h12l2 4 1 10v3H3v-3z M3 14h18 M16 17h2',
  code: 'M8 6l-6 6 6 6 M16 6l6 6-6 6 M14 4l-4 16',
  refresh: 'M20 10a8 8 0 1 0 0 6 M20 3v7h-7',
  clock: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 7v5l3 2',
  copy: 'M8 8h12v13H8z M16 5V3H3v13h2',
  network: 'M8 3h8v5H8z M3 16h6v5H3z M15 16h6v5h-6z M12 8v4 M6 16v-4h12v4',
  flag: 'M5 22V3 M5 4c6-4 9 4 15 0v10c-6 4-9-4-15 0',
  info: 'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 11v6 M12 7v1',
  terminal: 'M3 4h18v16H3z M6 9l3 3-3 3 M11 15h5',
  inbox: 'M3 15l3-10h12l3 10v5H3z M3 15h5l2 2h4l2-2h5',
  db: 'M3 6c0-5 18-5 18 0s-18 5-18 0 M3 6v12c0 5 18 5 18 0V6 M3 12c0 5 18 5 18 0',
}
export function Icon({
  name,
  size = 18,
  ...rest
}: {
  name: string
  size?: number
  [k: string]: any
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      <path d={paths[name] || paths.file} />
    </svg>
  )
}
export const groups: any = {
  code: ['程序源码', '#7665bb'],
  config: ['配置与清单', '#c46b43'],
  style: ['样式与页面', '#368891'],
  docs: ['文档', '#577eb1'],
  media: ['静态资源', '#b65e88'],
  other: ['其他文件', '#818295'],
}
export const statuses: any = {
  blocked: '已知阻塞',
  unknown: '信息不足',
  ready: '可试升级',
}
export const types: any = {
  route: '页面入口',
  event: '用户操作',
  handler: '函数调用',
  http: '接口请求',
  server: '服务端',
  storage: '本地存储',
  state: '状态操作',
  navigation: '页面跳转',
  lifecycle: '生命周期',
  symbol: '代码符号',
  config: '配置证据',
}
export function bytes(n: number) {
  if (!n) return '0 B'
  const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'],
    i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)))
  return (
    (n / 1024 ** i).toLocaleString('en-US', {
      maximumFractionDigits: i ? 1 : 0,
    }) +
    ' ' +
    u[i]
  )
}
export function fmt(n: number) {
  return n.toLocaleString('en-US')
}
export function flowIcon(f: any) {
  if (f.steps.some((step: any) => step.type === 'http')) return 'network'
  if (f.steps.some((step: any) => step.type === 'storage')) return 'db'
  return 'flow'
}
export function Button({
  children,
  icon,
  onClick,
  primary = false,
  disabled = false,
}: any) {
  return (
    <button
      className={'button ' + (primary ? 'primary' : '')}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}
export function Modal({ title, children, close, wide = false }: any) {
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement
    const initial = root.current?.querySelector<HTMLElement>('[data-autofocus]')
    ;(initial || root.current)?.focus()
    function key(e: KeyboardEvent) {
      const dialogs = document.querySelectorAll('[role="dialog"]')
      if (dialogs[dialogs.length - 1] !== root.current) return
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        close()
      } else if (e.key === 'Tab') {
        const els = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a,input,textarea,select,[tabindex="0"]',
          ) || []),
        ]
        if (!els.length) return
        if (
          e.shiftKey &&
          (document.activeElement === els[0] ||
            document.activeElement === root.current)
        ) {
          e.preventDefault()
          els.at(-1)?.focus()
        } else if (!e.shiftKey && document.activeElement === els.at(-1)) {
          e.preventDefault()
          els[0].focus()
        }
      }
    }
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      prev?.focus()
    }
  }, [])
  return (
    <div
      className="veil"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div
        className={'modal ' + (wide ? 'wide' : '')}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={root}
      >
        <div className="modalhead">
          <h2>{title}</h2>
          <button className="iconbtn" aria-label="关闭" onClick={close}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
export function Empty({ children }: any) {
  return (
    <div className="empty">
      <Icon name="inbox" size={26} />
      <p>{children}</p>
    </div>
  )
}
