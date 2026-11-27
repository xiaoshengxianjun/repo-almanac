const { scanProject } = require('../engine/scan.cjs')
process.parentPort.on('message', ({ data }) => {
  try {
    const result = scanProject(data.root, data.dbPath, (p) =>
      process.parentPort.postMessage({ progress: p }),
    )
    process.parentPort.postMessage({ result })
  } catch (e) {
    process.parentPort.postMessage({ error: e.message })
  }
})
