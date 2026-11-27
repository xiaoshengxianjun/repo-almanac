const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  utilityProcess,
  safeStorage,
  clipboard,
  Menu,
} = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const {
  database,
  fileQuery,
  readSource,
  readSnapshot,
  updateSnapshot,
} = require('../engine/storage.cjs')
const { readRegistryMetadata } = require('./registry.cjs')
const { reportText } = require('./report.cjs')
const { validEndpoint, explain } = require('./model.cjs')
const { lookupProject } = require('../engine/upgrades.cjs')

let win, active, indexedId, job, base, progress, lookupRequest
app.setName('RepoAlmanac')
function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(base, name), 'utf8'))
  } catch {
    return fallback
  }
}
function saveJson(name, value) {
  const full = path.join(base, name)
  const temp = full + '.tmp'
  fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 })
  fs.renameSync(temp, full)
}
function emit(value) {
  if (win && !win.isDestroyed()) win.webContents.send('almanac:event', value)
}
function state() {
  return {
    snapshot: active?.result || null,
    progress: progress || null,
    hasIndex: !!indexedId,
  }
}
function need(id) {
  if (!active || active.id !== id) throw Error('项目已切换，请重新打开视图。')
  return active
}
function removeIndexFiles(dbPath) {
  for (const file of [dbPath, dbPath + '-journal']) {
    try {
      fs.rmSync(file, { force: true })
    } catch (error) {
      console.warn('Could not remove workspace index:', error.message)
    }
  }
}
function closeActive() {
  lookupRequest?.abort()
  lookupRequest = null
  if (active) {
    active.db.close()
    active = null
  }
}
function cancel() {
  if (job) {
    const prev = job
    job = null
    prev.worker.kill()
    progress = null
    emit({ progress: null })
  }
}
function closeProject() {
  if (active)
    saveJson('latest.json', {
      id: active.id,
      root: active.result.root,
      closed: true,
    })
  cancel()
  closeActive()
  emit(state())
}
function clearIndex() {
  fs.rmSync(path.join(base, 'latest.json'), { force: true })
  cancel()
  closeActive()
  if (indexedId) removeIndexFiles(path.join(base, indexedId + '.sqlite'))
  indexedId = null
  emit(state())
}
function readIndex(id) {
  const dbPath = path.join(base, id + '.sqlite')
  const db = database(dbPath)
  try {
    return { id, dbPath, db, result: { ...readSnapshot(db), id } }
  } catch (error) {
    db.close()
    throw error
  }
}
function openDirectory(root) {
  if (!active && indexedId) {
    const last = readJson('latest.json', {})
    if (
      last.closed &&
      last.id === indexedId &&
      last.root === fs.realpathSync(root)
    ) {
      let saved
      try {
        saved = readIndex(indexedId)
      } catch {
        return start(root)
      }
      try {
        saveJson('latest.json', { id: saved.id })
      } catch (error) {
        saved.db.close()
        throw error
      }
      cancel()
      active = saved
      emit(state())
      return true
    }
  }
  return start(root)
}
function start(root) {
  cancel()
  const id = randomUUID(),
    dbPath = path.join(base, id + '.sqlite')
  const worker = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], {
    serviceName: 'RepoAlmanac Scanner',
  })
  let committed = false
  job = { worker, dbPath, id }
  progress = { phase: '文件索引', fileCount: 0, bytes: 0 }
  emit({ progress })
  worker.once('spawn', () => {
    if (job?.id !== id) worker.kill()
  })
  worker.on('message', (msg) => {
    if (job?.id !== id) return
    if (msg.progress) {
      progress = msg.progress
      emit({ progress })
      return
    }
    if (msg.result) {
      let db
      try {
        db = database(dbPath)
        const result = { ...msg.result, id }
        saveJson('latest.json', { id })
        closeActive()
        if (indexedId) removeIndexFiles(path.join(base, indexedId + '.sqlite'))
        indexedId = id
        active = { id, dbPath, db, result }
        committed = true
        progress = null
        job = null
        emit(state())
      } catch (e) {
        if (!committed) db?.close()
        emit({ error: e.message, progress: null })
        job = null
        progress = null
      }
    } else {
      emit({ error: msg.error || '分析失败', progress: null })
      job = null
      progress = null
    }
    worker.kill()
  })
  worker.on('exit', () => {
    if (job?.id === id) {
      progress = null
      job = null
      emit({ error: '扫描进程已结束，可以重新扫描。', progress: null })
    }
    if (!committed) removeIndexFiles(dbPath)
  })
  worker.postMessage({ root, dbPath })
  return true
}
const api = {
  state,
  closeProject,
  choose: async () => {
    const result = await dialog.showOpenDialog(win, {
      title: '选择本地开发项目',
      properties: ['openDirectory'],
    })
    return !result.canceled && openDirectory(result.filePaths[0])
  },
  refresh: (id) => {
    const s = need(id).result
    return start(s.root)
  },
  cancel,
  files: (id, options) => fileQuery(need(id).db, options),
  source: (id, e) => {
    const a = need(id)
    return readSource(a.db, a.result.root, e.file, e.line)
  },
  copy: (text) => clipboard.writeText(String(text).slice(0, 5000)),
  report: async (id) => {
    const s = need(id).result
    const result = await dialog.showSaveDialog(win, {
      title: '导出 Markdown 报告',
      defaultPath:
        (s.slug || '项目').replace(/[^\p{L}\p{N}._-]+/gu, '-') + '-项目分析.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled) return false
    await fs.promises.writeFile(result.filePath, reportText(s), 'utf8')
    return true
  },
  lookup: async (id, allowed) => {
    const s = need(id).result
    if (lookupRequest) throw Error('版本查询正在进行')
    const request = new AbortController()
    lookupRequest = request
    const cache = readJson('registry.json', {}),
      all = [],
      issues = []
    try {
      for (const p of s.projects) {
        const val = await lookupProject(
          p,
          (name) => readRegistryMetadata(name, cache, request.signal),
          allowed,
        )
        all.push(...val.results)
        issues.push(...val.errors)
      }
      request.signal.throwIfAborted()
      need(id)
      saveJson('registry.json', cache)
      const prior = s.findings.filter((f) => !f.online)
      const updated = {
        ...s,
        findings: [
          ...prior,
          ...all.map((f) => ({ ...f, online: true, id: 'registry:' + f.id })),
        ],
      }
      updateSnapshot(active.dbPath, updated)
      active.result = updated
      emit({ snapshot: updated })
      return { count: all.length, errors: issues }
    } finally {
      if (lookupRequest === request) lookupRequest = null
    }
  },
  clear: clearIndex,
  settings: () => {
    const s = readJson('ai.json', {})
    return { url: s.url || '', model: s.model || '', hasKey: !!s.secret }
  },
  configure: ({ url, model, key }) => {
    const endpoint = String(url || '')
      .trim()
      .replace(/\/+$/, '')
    if (endpoint) validEndpoint(endpoint)
    const old = readJson('ai.json', {})
    let secret = old.url === endpoint ? old.secret : null
    if (key === '') secret = null
    if (key) {
      if (!safeStorage.isEncryptionAvailable())
        throw Error('系统凭据加密不可用')
      secret = safeStorage.encryptString(key).toString('base64')
    }
    saveJson('ai.json', {
      url: endpoint,
      model: String(model || '').trim(),
      secret,
    })
    return api.settings()
  },
  explain: async (id, type, entryId) => {
    const s = need(id).result,
      c = readJson('ai.json', {})
    if (!c.url || !c.model) throw Error('请先配置模型地址和名称。')
    const entry = (type === 'flow' ? s.flows : s.findings).find(
      (v) => v.id === entryId,
    )
    if (!entry) throw Error('找不到记录')
    return explain(type, entry, c)
  },
}
function makeWindow() {
  win = new BrowserWindow({
    title: '项目志 · RepoAlmanac',
    width: 1390,
    height: 910,
    minWidth: 870,
    minHeight: 650,
    backgroundColor: '#f7f5f6',
    ...(process.platform === 'darwin' && {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 17, y: 15 },
    }),
    icon: path.join(__dirname, '../assets/app-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.loadFile(path.join(__dirname, '../dist/index.html'))
}
if (!app.requestSingleInstanceLock()) app.quit()
else
  app.whenReady().then(() => {
    base = path.join(app.getPath('userData'), 'workspace')
    fs.mkdirSync(base, { recursive: true })
    const last = readJson('latest.json', {})
    if (/^[\da-f-]{36}$/.test(last.id || '')) {
      const dbPath = path.join(base, last.id + '.sqlite')
      if (fs.existsSync(dbPath)) indexedId = last.id
      if (indexedId && !last.closed) {
        try {
          active = readIndex(indexedId)
          // Pre-0.1.3 installations may have an automatically created example index.
          if (active.result.isDemo === true) clearIndex()
        } catch {
          closeActive()
        }
      }
    }
    for (const [name, fn] of Object.entries(api))
      ipcMain.handle('almanac:' + name, (e, ...args) => {
        if (
          e.sender !== win.webContents ||
          e.senderFrame !== win.webContents.mainFrame
        )
          throw Error('无效的窗口')
        return fn(...args)
      })
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: '项目志',
          submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
        },
        {
          label: '编辑',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' },
          ],
        },
        {
          label: '视图',
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { role: 'togglefullscreen' },
          ],
        },
      ]),
    )
    makeWindow()
    app.on('second-instance', () => {
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) makeWindow()
    })
  })
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => {
  cancel()
  closeActive()
})
