const test = require('node:test')
const assert = require('node:assert/strict')
const { aiContext } = require('../shared/ai-context.mjs')
const { reportText } = require('../desktop/report.cjs')

const entry = {
  name: '保存笔记',
  file: 'src/Notes.vue',
  steps: [
    {
      file: 'src/Notes.vue',
      line: 8,
      label: '保存',
      detail: '点击按钮',
      snippet: 'private source',
    },
  ],
  notes: ['核对同步结果'],
}
const upgrade = {
  name: 'vite',
  title: '更新构建工具',
  status: 'blocked',
  from: '4',
  target: '5',
  scope: 'notes',
  reason: '构建环境需要更新',
  checks: ['检查 Node 版本'],
  evidence: [{ file: 'package.json', line: 3, label: 'vite 版本' }],
  steps: ['验证构建'],
  rollback: '恢复清单和锁文件',
  source: '内置规则',
}

test('model context selects and numbers evidence for both entry types', () => {
  assert.deepEqual(aiContext('flow', entry), {
    name: '保存笔记',
    status: null,
    target: null,
    notes: entry.notes,
    evidence: [
      {
        id: 1,
        file: 'src/Notes.vue',
        line: 8,
        label: '保存',
        detail: '点击按钮',
      },
    ],
  })
  const context = aiContext('upgrade', upgrade)
  assert.deepEqual(context.notes, upgrade.checks)
  assert.equal(context.status, 'blocked')
  assert.equal(context.target, '5')
  assert.equal(context.evidence[0].file, 'package.json')
})

test('exported Markdown identifies source lines and upgrade blockers', () => {
  const report = reportText({
    id: 'snapshot-id',
    name: '工作区',
    date: '2026-11-27',
    slug: 'notes',
    fileCount: 2,
    bytes: 40,
    tags: ['Vue'],
    links: 0,
    readErrors: 0,
    omitted: 0,
    flows: [{ ...entry, page: entry.file, url: '/notes' }],
    findings: [upgrade],
    problems: [],
  })
  assert.match(report, /1\. 保存 · src\/Notes\.vue:8/)
  assert.match(report, /更新构建工具 · 已知阻塞/)
  assert.match(report, /package\.json:3 · vite 版本/)
  assert.match(report, /回退：恢复清单和锁文件/)
  assert.match(report, /快照 snapshot-id/)
})
