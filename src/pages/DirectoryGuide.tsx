import { useEffect, useId, useState } from 'react'
import { Disclosure } from '../components/Disclosure'
import { api, tidy, type FileListing } from '../desktop'
import { fmt, Icon, groups } from '../components/ui'
import type { InventoryProject, Location } from './DependencyInventory'

const conventions: Record<string, string> = {
  src: '应用源代码',
  components: '可复用的界面组件',
  pages: '按页面组织的视图',
  views: '页面视图',
  layouts: '页面布局',
  store: '共享状态与数据操作',
  stores: '共享状态与数据操作',
  middleware: '请求或路由中间件',
  plugins: '插件与初始化代码',
  public: '公开静态文件',
  static: '静态资源',
  assets: '图片、字体等项目资源',
  styles: '全局样式与主题',
  api: '接口相关代码',
  server: '服务端代码',
  routes: '路由定义',
  router: '客户端路由配置',
  composables: '组合式逻辑',
  utils: '通用工具函数',
  lib: '共享代码库',
  desktop: '桌面端代码',
  engine: '核心处理逻辑',
  shared: '跨模块共享代码',
  scripts: '开发与构建脚本',
  docs: '项目文档',
  tests: '自动化测试',
  test: '自动化测试',
  __tests__: '自动化测试',
  packages: '子包集合',
  apps: '应用子项目',
  '.github': 'GitHub 项目配置',
  workflows: '自动化工作流',
}
function purpose(
  node: FileListing['nodes'][number],
  full: string,
  projects: InventoryProject[],
) {
  if (!node.folder) {
    if (node.name === 'package.json') return '项目清单与依赖声明'
    if (
      /^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/.test(
        node.name,
      )
    )
      return '依赖解析与锁定版本'
    if (/^README(?:\.|$)/i.test(node.name)) return '项目说明与使用入口'
    if (/^nuxt\.config\./.test(node.name)) return 'Nuxt 配置与插件注册'
    return groups[node.kind]?.[0] || '项目文件'
  }
  const project = projects
    .filter((p) => !p.dir || full === p.dir || full.startsWith(p.dir + '/'))
    .sort((a, b) => b.dir.length - a.dir.length)[0]
  if (project?.dir === full) return '子项目 · ' + project.name
  if (project?.config) {
    const base = [project.dir, project.config.srcDir.replace(/^\.\/|\/$/g, '')]
      .filter(Boolean)
      .join('/')
    const local = base
      ? full.startsWith(base + '/')
        ? full.slice(base.length + 1)
        : ''
      : full
    if (local === 'pages') return 'Nuxt 页面路由（按目录约定）'
    if (local === 'layouts') return 'Nuxt 页面布局（按目录约定）'
    if (local === 'plugins') return 'Nuxt 插件代码，可对照配置中的注册项'
  }
  return Object.hasOwn(conventions, node.name)
    ? conventions[node.name] + '（按目录名推断）'
    : '用途待确认，可进入目录查看文件'
}
export function DirectoryGuide({
  id,
  projects,
  source,
}: {
  id: string
  projects: InventoryProject[]
  source: (e: Location) => void
}) {
  const [folder, setFolder] = useState(''),
    [expanded, setExpanded] = useState(false)
  const listId = useId()
  const [data, setData] = useState<FileListing | null>(null),
    [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setData(null)
    setError('')
    api
      .files(id, { folder, business: true })
      .then((v) => {
        if (live) setData(v)
      })
      .catch((e) => {
        if (live) setError(tidy(e))
      })
    return () => {
      live = false
    }
  }, [id, folder])
  function enter(to: string) {
    setData(null)
    setExpanded(false)
    setFolder(to)
  }
  const firstFolders = [
    'pages',
    'app',
    'src',
    'apps',
    'packages',
    'server',
    'api',
    'components',
    'routes',
    'router',
  ]
  const importance = (n: FileListing['nodes'][number]) => {
    const rank = firstFolders.indexOf(n.name)
    if (n.folder && rank >= 0) return rank
    return n.name.startsWith('.') ? 30 : n.folder ? 20 : 24
  }
  const nodes = [...(data?.nodes || [])].sort(
    (a, b) => importance(a) - importance(b) || a.name.localeCompare(b.name),
  )
  const parts = folder ? folder.split('/') : []
  return (
    <section className="inventoryCard directoryGuide" aria-label="项目目录结构">
      <header className="moduleHead">
        <h2>项目目录结构</h2>
        <div className="directoryTools">
          <span className="muted">业务文件 · {data ? fmt(data.n) : '…'}</span>
          {nodes.length > 5 && (
            <Disclosure
              controls={listId}
              noun="目录条目"
              count={nodes.length}
              expanded={expanded}
              onToggle={() => setExpanded(!expanded)}
            />
          )}
        </div>
      </header>
      <nav className="directoryPath" aria-label="目录路径">
        {['根目录', ...parts].map((v, i) => (
          <span key={i}>
            {i > 0 && <Icon name="chev" size={12} />}
            <button
              disabled={i === parts.length}
              onClick={() => enter(parts.slice(0, i).join('/'))}
            >
              {v}
            </button>
          </span>
        ))}
      </nav>
      <div id={listId}>
        {(expanded ? nodes : nodes.slice(0, 5)).map((n) => {
          const full = folder ? folder + '/' + n.name : n.name
          return (
            <button
              className="guideRow"
              key={full}
              onClick={() =>
                n.folder
                  ? enter(full)
                  : source({ file: full, line: 1, label: n.name })
              }
            >
              <span className="guideName">
                <Icon name={n.folder ? 'folder' : 'file'} size={16} />
                <code>
                  {n.name}
                  {n.folder ? '/' : ''}
                </code>
              </span>
              <span>{purpose(n, full, projects)}</span>
              <small>{n.folder ? fmt(n.count) + ' 个文件' : '查看文件'}</small>
              <Icon name="chev" size={13} />
            </button>
          )
        })}
      </div>
      {(!data || !nodes.length) && (
        <p className="inventoryNote">
          {error || (data ? '此目录没有已索引的业务文件。' : '读取目录中…')}
        </p>
      )}
    </section>
  )
}
