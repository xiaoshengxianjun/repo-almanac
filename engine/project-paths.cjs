const fs = require('node:fs')
const path = require('node:path')

// Compare actual directories, including aliases on case-insensitive volumes.
function containsDirectory(parent, child) {
  const root = fs.realpathSync.native(parent)
  const identity = fs.statSync(root, { bigint: true })
  let current = fs.realpathSync.native(child)
  while (true) {
    if (current === root) return true
    const entry = fs.statSync(current, { bigint: true })
    if (
      entry.ino !== 0n &&
      entry.dev === identity.dev &&
      entry.ino === identity.ino
    )
      return true
    const next = path.dirname(current)
    if (next === current) return false
    current = next
  }
}

function assertSeparateWorkspace(project, workspace) {
  if (
    containsDirectory(project, workspace) ||
    containsDirectory(workspace, project)
  )
    throw Error(
      '所选目录与项目志的数据目录重叠。请选择独立的项目文件夹，以保持原项目只读。',
    )
}

module.exports = { containsDirectory, assertSeparateWorkspace }
