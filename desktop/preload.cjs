const { contextBridge, ipcRenderer } = require('electron')
const methods = [
  'state',
  'closeProject',
  'choose',
  'refresh',
  'cancel',
  'files',
  'source',
  'report',
  'settings',
  'configure',
  'explain',
  'clear',
  'copy',
]
const api = Object.fromEntries(
  methods.map((name) => [
    name,
    (...args) => ipcRenderer.invoke('almanac:' + name, ...args),
  ]),
)
api.subscribe = (listener) => {
  const fn = (_event, data) => listener(data)
  ipcRenderer.on('almanac:event', fn)
  return () => ipcRenderer.removeListener('almanac:event', fn)
}
contextBridge.exposeInMainWorld('almanac', api)
