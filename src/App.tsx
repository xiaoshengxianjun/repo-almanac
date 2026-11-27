import { useEffect, useRef, useState } from 'react'
import { Button, Icon, Modal, bytes, fmt } from './components/ui'
import { api, tidy, type WorkspaceEvent, type WorkspaceState } from './desktop'
import { Overview } from './pages/Overview'
import { Flows } from './pages/Flows'
import { Files } from './pages/Files'
import { Upgrades } from './pages/Upgrades'
import { AI } from './dialogs/AI'
import { Lookup } from './dialogs/Lookup'
import { Search } from './dialogs/Search'
import { Settings } from './dialogs/Settings'
import { Source } from './dialogs/Source'
import brandMark from '../assets/brand-mark.svg?no-inline'
import archiveArt from './art/archive.webp'
import { version } from '../package.json'

const macWindow = navigator.platform.toLowerCase().includes('mac')
const scanPhases = ['文件索引', '业务流程', '升级规则']
const tabs = [
  ['overview', 'grid', '项目概览'],
  ['flows', 'flow', '业务流程'],
  ['files', 'files', '文件分布'],
  ['upgrades', 'upgrade', '升级建议'],
]
export function App() {
  const [s, setS] = useState<WorkspaceState['snapshot']>(null),
    [progress, setProgress] = useState<WorkspaceState['progress']>(null),
    [hasIndex, setHasIndex] = useState(false),
    [tab, go] = useState('overview'),
    [flow, setFlow] = useState(''),
    [finding, setFinding] = useState(''),
    [popup, setPopup] = useState(''),
    [read, setRead] = useState<any>(null),
    [message, setMessage] = useState(''),
    [darken, setDarken] = useState(false),
    [ctx, setCtx] = useState<any>(null),
    [querying, setQuerying] = useState(false)
  const id = useRef(''),
    timer = useRef<any>(null),
    openProjectButton = useRef<HTMLButtonElement>(null),
    scroll = useRef<HTMLElement>(null)
  function toast(t: string) {
    clearTimeout(timer.current)
    setMessage(t)
    timer.current = setTimeout(() => setMessage(''), 5500)
  }
  function update(v: WorkspaceEvent) {
    if (v.hasIndex !== undefined) setHasIndex(v.hasIndex)
    if (v.snapshot !== undefined) {
      const next = v.snapshot?.id || ''
      if (next !== id.current) {
        id.current = next
        go('overview')
        setPopup('')
        setRead(null)
        setFlow('')
        setFinding('')
        setCtx(null)
        setDarken(false)
        setQuerying(false)
        setMessage('')
      }
      setS(v.snapshot)
    }
    if (v.progress !== undefined) setProgress(v.progress)
    if (v.error) toast(v.error)
  }
  useEffect(() => {
    const unsub = api.subscribe(update)
    api
      .state()
      .then(update)
      .catch((e: any) => toast(tidy(e)))
    return unsub
  }, [])
  useEffect(() => {
    scroll.current?.scrollTo(0, 0)
  }, [tab, s?.id])
  useEffect(() => {
    function keys(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && s) {
        e.preventDefault()
        setPopup('search')
      }
    }
    window.addEventListener('keydown', keys)
    return () => window.removeEventListener('keydown', keys)
  }, [s])
  async function run(fn: () => any) {
    try {
      return await fn()
    } catch (e) {
      toast(tidy(e))
    }
  }
  function openFlow(f: any) {
    setFlow(f.id)
    go('flows')
    setPopup('')
  }
  function openFinding(f: any) {
    setFinding(f.id)
    go('upgrades')
    setPopup('')
  }
  function source(e: any) {
    setRead(e)
    setPopup('source')
  }
  function ai(type: string, item: any) {
    setCtx({ type, item })
    setPopup('ai')
  }
  const close = () => setPopup('')
  async function lookup(names: string[]) {
    if (!s) return
    const projectId = s.id
    close()
    setQuerying(true)
    try {
      const res = await api.lookup(projectId, names)
      if (id.current !== projectId) return
      toast(
        '发现 ' +
          res.count +
          ' 个候选更新' +
          (res.errors.length ? '。查询失败：' + res.errors.join('，') : '。'),
      )
    } catch (error) {
      if (id.current === projectId) toast(tidy(error))
    } finally {
      if (id.current === projectId) setQuerying(false)
    }
  }
  const current = tabs.find((t) => t[0] === tab)!
  return (
    <div className={'shell' + (macWindow ? ' macWindow' : '')}>
      <aside className="sidebar">
        <div className="brand">
          <img className="brandMark" src={brandMark} alt="" />
          <div>
            <b>项目志</b>
            <small>RepoAlmanac</small>
          </div>
        </div>
        <button
          ref={openProjectButton}
          className="openProject"
          onClick={() => run(api.choose)}
        >
          <Icon name="open" size={17} />
          <span>打开项目</span>
          <Icon name="chev" size={13} />
        </button>
        <nav aria-label="工作区">
          <div className="navLabel">项目分析</div>
          {tabs.map(([key, icon, name]) => (
            <button
              key={key}
              className={'navBtn ' + (s && tab === key ? 'active' : '')}
              aria-current={s && tab === key ? 'page' : undefined}
              onClick={() => go(key)}
              disabled={!s}
            >
              <span className={'navIcon nav-' + key}>
                <Icon name={icon} size={15} />
              </span>
              {name}
              {key === 'upgrades' && !!s?.findings.length && (
                <span className="navCount">{s.findings.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sideBottom">
          <button className="navBtn" onClick={() => setPopup('settings')}>
            <Icon name="settings" />
            应用设置
          </button>
          <div className="localFoot">
            <i className="dot" />
            <span>本地工作区</span>
            <code>v{version}</code>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="topbarInner">
            <div className="bread">
              {(s || progress) && (
                <button
                  type="button"
                  className="backToHome"
                  title="关闭项目并返回首页"
                  aria-label="关闭项目并返回首页"
                  onClick={() =>
                    run(async () => {
                      await api.closeProject()
                      openProjectButton.current?.focus()
                    })
                  }
                >
                  <Icon name="back" size={18} />
                </button>
              )}
              <Icon name="folder" size={16} />
              <span className="crumbProject" title={s?.root}>
                {s?.slug || '本地工作区'}
              </span>
              {s && (
                <>
                  <i>/</i>
                  <b>{current[2]}</b>
                </>
              )}
            </div>
            <div className="headBtns">
              {s && (
                <div className="projectTools">
                  {tab !== 'overview' && (
                    <>
                      <button
                        className="plain"
                        onClick={() => run(() => api.refresh(s.id))}
                        disabled={!!progress}
                        title="重新扫描"
                      >
                        <Icon name="refresh" size={14} />
                        <span>重新扫描</span>
                      </button>
                      <i />
                    </>
                  )}
                  <button
                    className="plain"
                    onClick={async () => {
                      if (await run(() => api.report(s.id)))
                        toast('Markdown 报告已导出。')
                    }}
                  >
                    <Icon name="download" size={15} />
                    导出报告
                  </button>
                </div>
              )}
              {s && (
                <button
                  className="searchBtn"
                  aria-label="全局搜索"
                  onClick={() => setPopup('search')}
                >
                  <Icon name="search" size={16} />
                  <span>搜索项目</span>
                  <kbd>{macWindow ? '⌘ K' : 'Ctrl K'}</kbd>
                </button>
              )}
            </div>
          </div>
        </header>
        <main ref={scroll} className={s ? 'projectMain' : 'welcomeMain'}>
          <div className="mainContent">
            {progress && (
              <div className="progressBar">
                <span className="spinner" />
                <span className="srOnly" role="status">
                  {'当前扫描阶段：' + progress.phase}
                </span>
                <ol className="scanPhases" aria-label="扫描阶段">
                  {scanPhases.map((phase, i) => (
                    <li
                      key={phase}
                      aria-current={
                        phase === progress.phase ? 'step' : undefined
                      }
                      className={
                        i < scanPhases.indexOf(progress.phase) ? 'done' : ''
                      }
                    >
                      {phase}
                    </li>
                  ))}
                </ol>
                <span className="scanCount">
                  {fmt(progress.fileCount)} 个文件
                </span>
                <Button onClick={() => run(api.cancel)}>取消扫描</Button>
              </div>
            )}
            {!s ? (
              <section className={'welcome' + (progress ? ' scanning' : '')}>
                <div className="welcomeArt" aria-hidden="true">
                  <img src={archiveArt} alt="" draggable={false} />
                </div>
                <h1>{progress ? '正在分析项目' : '打开一个项目'}</h1>
                <p>
                  {progress
                    ? '正在整理文件、业务流程和升级建议。'
                    : '选择本地项目文件夹，查看业务流程、关键代码和升级建议。'}
                </p>
                {!progress && (
                  <div className="wrap">
                    <Button primary icon="open" onClick={() => run(api.choose)}>
                      打开项目
                    </Button>
                  </div>
                )}
              </section>
            ) : (
              <>
                {tab === 'overview' && (
                  <Overview
                    key={s.id}
                    s={s}
                    go={go}
                    openFlow={openFlow}
                    openFinding={openFinding}
                    source={source}
                    rescan={() => run(() => api.refresh(s.id))}
                    scanning={!!progress}
                    scanDetails={() => setPopup('scan')}
                  />
                )}
                {tab === 'flows' && (
                  <Flows
                    key={s.id}
                    s={s}
                    chosen={flow}
                    setChosen={setFlow}
                    source={source}
                    ai={ai}
                  />
                )}
                {tab === 'files' && (
                  <Files key={s.id} s={s} source={source} toast={toast} />
                )}
                {tab === 'upgrades' && (
                  <Upgrades
                    key={s.id}
                    s={s}
                    selected={finding}
                    setSelected={setFinding}
                    source={source}
                    ai={ai}
                    lookup={() => {
                      if (querying) toast('正在查询公共包元数据…')
                      else setPopup('lookup')
                    }}
                  />
                )}
                {tab !== 'overview' && (
                  <button className="scanFoot" onClick={() => setPopup('scan')}>
                    <Icon name="clock" size={13} />{' '}
                    {s.readErrors ? '扫描有待核对项' : '已完成扫描'} ·{' '}
                    {new Date(s.date).toLocaleString('zh-CN', {
                      hour12: false,
                    })}{' '}
                    · 扫描详情 <Icon name="chev" size={12} />
                  </button>
                )}
              </>
            )}
          </div>
        </main>
      </div>
      {popup === 'source' && s && (
        <Source
          s={s}
          item={read}
          close={close}
          onFlow={openFlow}
          onSource={source}
          toast={toast}
        />
      )}
      {popup === 'search' && s && (
        <Search
          s={s}
          close={close}
          source={source}
          openFlow={openFlow}
          openFinding={openFinding}
        />
      )}
      {popup === 'lookup' && s && <Lookup s={s} close={close} query={lookup} />}
      {popup === 'settings' && (
        <Settings
          close={close}
          toast={toast}
          hasIndex={hasIndex}
          clear={() => {
            setDarken(true)
          }}
        />
      )}
      {darken && (
        <Modal title="清除项目索引" close={() => setDarken(false)}>
          <p>删除项目志保存在本机的扫描结果。下次打开项目时会重新扫描。</p>
          <div className="actions">
            <Button onClick={() => setDarken(false)}>取消</Button>
            <Button
              primary
              onClick={async () => {
                await run(api.clear)
                setDarken(false)
                close()
              }}
            >
              清除索引
            </Button>
          </div>
        </Modal>
      )}
      {popup === 'ai' && s && (
        <AI
          s={s}
          ctx={ctx}
          close={close}
          settings={() => setPopup('settings')}
        />
      )}
      {popup === 'scan' && s && (
        <Modal title="扫描详情" close={close}>
          <p className="longPath">{s.root}</p>
          <div className="facts">
            <span>
              普通文件<b>{fmt(s.fileCount)}</b>
            </span>
            <span>
              逻辑总大小<b>{bytes(s.bytes)}</b>
            </span>
            <span>
              跳过的符号链接<b>{s.links}</b>
            </span>
            <span>
              读取或解析问题<b>{s.readErrors}</b>
            </span>
            <span>
              超出解析预算的文件<b>{s.omitted}</b>
            </span>
          </div>
          {s.problems.map((v: string) => (
            <p key={v}>{v}</p>
          ))}
          <h3>子项目与依赖清单</h3>
          {s.projects.slice(0, 80).map((p: any) => (
            <button
              key={p.file}
              className="evidence"
              onClick={() => source({ file: p.file, line: 1, label: p.name })}
            >
              {p.name}
              <code>{p.file}</code>
            </button>
          ))}
          {s.readme && (
            <button
              className="evidence"
              onClick={() =>
                source({ file: s.readme, line: 1, label: '项目文档' })
              }
            >
              项目文档<code>{s.readme}</code>
            </button>
          )}
        </Modal>
      )}
      {message && (
        <div role="status" className="toast" onClick={() => setMessage('')}>
          <Icon name="info" size={16} />
          {message}
        </div>
      )}
    </div>
  )
}
