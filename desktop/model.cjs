const { safeStorage } = require('electron')
const { aiContext } = require('../shared/ai-context.mjs')

function validEndpoint(value) {
  const u = new URL(value)
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    !(
      u.protocol === 'https:' ||
      (u.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
    )
  )
    throw Error('模型地址须使用 HTTPS，或使用本机 HTTP 地址。')
  return u.href.replace(/\/$/, '') + '/chat/completions'
}

async function explain(type, entry, config) {
  const ctx = aiContext(type, entry),
    url = validEndpoint(config.url)
  const headers = { 'Content-Type': 'application/json' }
  if (config.secret)
    headers.Authorization =
      'Bearer ' +
      safeStorage.decryptString(Buffer.from(config.secret, 'base64'))
  const res = await fetch(url, {
    method: 'POST',
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(40000),
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'system',
          content:
            '用简体中文解释给接手项目的工程师。仅基于提供的证据，不修改规则状态，不补充新版本。输出 JSON {"items":[{"text":"解释","evidenceIds":[1]}]}，每项至少引用一个已有证据编号。',
        },
        { role: 'user', content: JSON.stringify(ctx) },
      ],
    }),
  })
  if (!res.ok) throw Error('模型服务返回 HTTP ' + res.status)
  const raw = await res.json(),
    reply = raw.choices?.[0]?.message?.content || ''
  const data = JSON.parse(
    reply.replace(/^\s*\x60{3}(?:json)?\s*|\s*\x60{3}\s*$/g, ''),
  )
  const valid = data.items?.filter(
    (i) =>
      typeof i.text === 'string' &&
      Array.isArray(i.evidenceIds) &&
      i.evidenceIds.length &&
      i.evidenceIds.every(
        (n) => Number.isInteger(n) && n > 0 && n <= ctx.evidence.length,
      ),
  )
  if (!valid?.length) throw Error('模型没有返回可核对的证据，保留原报告。')
  return valid.slice(0, 12)
}

module.exports = { validEndpoint, explain }
