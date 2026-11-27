const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { containsDirectory } = require('../engine/project-paths.cjs')

const label = { blocked: '已知阻塞', ready: '可试升级', unknown: '信息不足' }

function reportText(s) {
  const lines = [
    '# ' + s.name + ' · 项目分析报告',
    '',
    '扫描于 ' + s.date,
    '',
    '## 项目概览',
    '',
    s.description || s.slug,
    '',
    s.fileCount +
      ' 个文件，' +
      s.bytes +
      ' 字节。技术栈：' +
      s.tags.join('、') +
      '。',
    '',
    '## 业务流程',
    '',
  ]
  for (const flow of s.flows) {
    lines.push('### ' + flow.name, '', flow.page + ' ' + flow.url, '')
    for (const [i, e] of flow.steps.entries())
      lines.push(i + 1 + '. ' + e.label + ' · ' + e.file + ':' + e.line)
    lines.push('', ...flow.notes, '')
  }
  lines.push('## 升级建议', '')
  for (const f of s.findings) {
    lines.push(
      '### ' + f.title + ' · ' + label[f.status],
      '',
      f.scope + ' · ' + f.from + ' → ' + f.target,
      '',
      f.reason,
      ...(f.checks || []),
      '',
      ...f.evidence.map((e) => '- ' + e.file + ':' + e.line + ' · ' + e.label),
      '',
      ...f.steps.map((t, i) => i + 1 + '. ' + t),
      '',
      '回退：' + f.rollback,
      '',
      '依据：' + f.source + (f.url ? ' ' + f.url : ''),
      '',
    )
  }
  lines.push(
    '## 扫描范围',
    '',
    s.links +
      ' 个符号链接，' +
      s.readErrors +
      ' 个读取或解析问题，' +
      s.omitted +
      ' 个文件超出深度解析预算。',
    ...s.problems,
    '',
    '规则版本 0.1 · 快照 ' + s.id,
  )
  return lines.join('\n')
}

async function saveReport(snapshot, filename, otherProtectedDirs = []) {
  const parent = fs.realpathSync.native(path.dirname(filename))
  for (const dir of [snapshot.root, ...otherProtectedDirs]) {
    // A previously indexed project may have been moved or removed.
    if (
      fs.statSync(dir, { throwIfNoEntry: false }) &&
      containsDirectory(dir, parent)
    )
      throw Error('请将报告保存到项目和应用数据目录之外，例如“下载”文件夹。')
  }
  const target = path.join(parent, path.basename(filename))
  const existing = fs.lstatSync(target, { throwIfNoEntry: false })
  if (existing && (!existing.isFile() || existing.nlink > 1))
    throw Error('请选择普通文件作为报告保存位置。')
  const temp = path.join(parent, '.repo-almanac-' + randomUUID() + '.tmp')
  const file = await fs.promises.open(temp, 'wx', 0o600)
  try {
    try {
      await file.writeFile(reportText(snapshot), 'utf8')
    } finally {
      await file.close()
    }
    await fs.promises.rename(temp, target)
  } finally {
    await fs.promises.rm(temp, { force: true })
  }
}

module.exports = { reportText, saveReport }
