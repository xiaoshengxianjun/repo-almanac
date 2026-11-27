const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')

const groups = {
  code: [
    'js',
    'jsx',
    'ts',
    'tsx',
    'mjs',
    'cjs',
    'mts',
    'cts',
    'vue',
    'svelte',
    'py',
    'php',
    'go',
    'rs',
    'java',
    'kt',
    'swift',
    'rb',
    'cs',
    'cpp',
    'c',
    'h',
    'dart',
    'sh',
    'sql',
  ],
  style: ['css', 'scss', 'less', 'sass', 'html', 'astro'],
  config: ['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'lock', 'properties'],
  docs: ['md', 'mdx', 'txt', 'rst', 'adoc'],
  media: [
    'png',
    'jpg',
    'jpeg',
    'webp',
    'gif',
    'svg',
    'ico',
    'avif',
    'woff',
    'woff2',
    'ttf',
    'mp4',
    'pdf',
  ],
}
function kindOf(file) {
  const ext = path.extname(file).slice(1).toLowerCase()
  return Object.keys(groups).find((key) => groups[key].includes(ext)) || 'other'
}
function database(file, create = false) {
  const db = new DatabaseSync(file, { readOnly: !create })
  if (create)
    db.exec(
      'CREATE TABLE files(path TEXT PRIMARY KEY, bytes INTEGER, modified REAL, kind TEXT, business INTEGER, digest TEXT); CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);',
    )
  return db
}
function readSnapshot(db) {
  const row = db.prepare("SELECT value FROM meta WHERE key='snapshot'").get()
  return JSON.parse(row.value)
}
function updateSnapshot(file, snapshot) {
  const db = new DatabaseSync(file)
  try {
    db.prepare("UPDATE meta SET value=? WHERE key='snapshot'").run(
      JSON.stringify(snapshot),
    )
  } finally {
    db.close()
  }
}
function overviewStats(db) {
  const group = (business) =>
    db
      .prepare(
        'SELECT kind, COUNT(*) AS count, SUM(bytes) AS bytes FROM files ' +
          (business ? 'WHERE business=1 ' : '') +
          'GROUP BY kind ORDER BY bytes DESC',
      )
      .all()
  return { all: group(false), business: group(true) }
}
function fileQuery(db, options = {}) {
  const { folder = '', query = '', business = false, page = 0 } = options
  const prefix = folder ? folder + '/' : ''
  const where =
    'WHERE substr(path,1,length(?))=? AND instr(lower(path),lower(?))>0' +
    (business ? ' AND business=1' : '')
  const params = [prefix, prefix, String(query)]
  const total = db
    .prepare(
      'SELECT COUNT(*) n,COALESCE(SUM(bytes),0) bytes FROM files ' + where,
    )
    .get(...params)
  const rows = db
    .prepare(
      'SELECT path,bytes,kind FROM files ' +
        where +
        ' ORDER BY bytes DESC,path LIMIT 60 OFFSET ?',
    )
    .all(...params, Math.max(0, Math.floor(Number(page) || 0)) * 60)
  const nodes = db
    .prepare(
      'WITH entries AS (SELECT substr(path,length(?)+1) rest,bytes,kind FROM files ' +
        where +
        "), children AS (SELECT CASE WHEN instr(rest,'/')>0 THEN substr(rest,1,instr(rest,'/')-1) ELSE rest END name, instr(rest,'/')>0 folder,bytes,kind FROM entries) SELECT name,folder,SUM(bytes) bytes,COUNT(*) count,CASE WHEN folder THEN 'folder' ELSE MIN(kind) END kind FROM children GROUP BY name,folder ORDER BY bytes DESC,name",
    )
    .all(prefix, ...params)
  return { ...total, rows, nodes }
}
function readSource(db, root, file, line = 1) {
  const row = db.prepare('SELECT * FROM files WHERE path=?').get(file)
  if (!row) throw new Error('该文件不在当前扫描索引中。')
  const full = path.join(root, file)
  const real = fs.realpathSync(full)
  const relative = path.relative(root, real)
  if (
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative) ||
    real !== full
  )
    throw new Error('文件路径已更改，请重新扫描。')
  const fd = fs.openSync(
    real,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  )
  try {
    const stat = fs.fstatSync(fd)
    if (
      !stat.isFile() ||
      stat.size !== row.bytes ||
      Math.abs(stat.mtimeMs - row.modified) > 1
    )
      throw new Error('文件自扫描后已变更，请重新扫描再定位。')
    if (stat.size > 2 * 1024 * 1024)
      return {
        notice: '文件超过 2 MiB，预览仅展示索引信息。',
        lines: [],
        start: 1,
      }
    if (
      ['.env', '.npmrc'].includes(path.basename(file)) ||
      /(^|\/)\.env\.|\.pem$|\.key$/i.test(file)
    )
      return { notice: '凭据文件仅展示索引信息。', lines: [], start: 1 }
    const buf = fs.readFileSync(fd)
    if (
      row.digest &&
      createHash('sha256').update(buf).digest('hex') !== row.digest
    )
      throw new Error('文件内容已变更，请重新扫描再定位。')
    if (buf.includes(0))
      return { notice: '二进制文件仅展示索引信息。', lines: [], start: 1 }
    const lines = buf.toString('utf8').split(/\r?\n/)
    const focus = Math.min(lines.length, Math.max(1, Number(line) || 1))
    const start = Math.max(1, focus - 16)
    return {
      lines: lines.slice(start - 1, start + 63).map((l) => l.slice(0, 2000)),
      start,
      total: lines.length,
      focus,
    }
  } finally {
    fs.closeSync(fd)
  }
}
module.exports = {
  database,
  fileQuery,
  readSnapshot,
  updateSnapshot,
  readSource,
  overviewStats,
  kindOf,
}
