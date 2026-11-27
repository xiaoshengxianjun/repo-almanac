const path = require('node:path').posix
const semver = require('semver')
const ts = require('@typescript/typescript6')

const technologies = new Map(
  Object.entries({
    nuxt: 'Nuxt',
    vue: 'Vue',
    'vue-router': 'Vue Router',
    vuex: 'Vuex',
    pinia: 'Pinia',
    react: 'React',
    'react-dom': 'React DOM',
    next: 'Next.js',
    svelte: 'Svelte',
    astro: 'Astro',
    express: 'Express',
    koa: 'Koa',
    fastify: 'Fastify',
    electron: 'Electron',
    typescript: 'TypeScript',
    vite: 'Vite',
    webpack: 'webpack',
    rollup: 'Rollup',
    esbuild: 'esbuild',
    tailwindcss: 'Tailwind CSS',
    '@angular/core': 'Angular',
    '@nestjs/core': 'NestJS',
  }),
)
// Scoped npm names may be private even when their tarball is hosted on npm.
const publicNames = new Set([
  ...technologies.keys(),
  ...(
    'axios lodash eslint prettier jest vitest jquery core-js babel-loader sass sass-loader postcss autoprefixer dotenv semver ' +
    'vue-i18n vue-loader vue-template-compiler webpack-cli cross-env element-ui element-plus ' +
    '@nuxtjs/axios @nuxtjs/auth @nuxtjs/auth-next @nuxtjs/i18n @nuxtjs/pwa @nuxtjs/proxy @nuxtjs/robots @nuxtjs/sitemap @nuxtjs/tailwindcss @nuxtjs/composition-api ' +
    '@vitejs/plugin-vue @vitejs/plugin-react @vue/cli-service @vue/compiler-sfc @babel/core @babel/preset-env @types/react @types/react-dom @types/node @typescript/typescript6 @electron/packager @yarnpkg/lockfile'
  ).split(/\s+/),
])
function officialTarball(name, resolved) {
  try {
    const url = new URL(resolved)
    const prefix = '/' + name + '/-/' + name.split('/').at(-1) + '-'
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      [
        'registry.npmjs.org',
        'registry.yarnpkg.com',
        'registry.npmmirror.com',
      ].includes(url.hostname) &&
      decodeURIComponent(url.pathname).startsWith(prefix) &&
      url.pathname.endsWith('.tgz')
    )
  } catch {
    return false
  }
}
function lookupPolicy(name, range, item, locals, blocked) {
  if (
    locals.has(name) ||
    item?.link ||
    item?.inBundle ||
    item?.bundled ||
    item?.private
  )
    return '本地或工作区依赖'
  if (typeof range !== 'string' || !semver.validRange(range))
    return '非版本范围引用'
  if (blocked.has('*') || blocked.has(name.split('/')[0]))
    return '项目指定了其他注册源'
  if (item?.name && item.name !== name) return '包别名引用'
  if (item?.resolved && !officialTarball(name, item.resolved))
    return '来源未经确认'
  if (publicNames.has(name)) return ''
  if (
    /^[a-z0-9][a-z0-9._-]*$/.test(name) &&
    item?.resolved &&
    officialTarball(name, item.resolved)
  )
    return ''
  return '公共来源待确认'
}
// Retain routing decisions only. No credential or configuration value enters the index.
function registryRoutes(filename, content) {
  if (content === null) return ['*']
  if (filename === '.npmrc') {
    const blocked = []
    for (const line of content.split(/\r?\n/)) {
      const m = line.trim().match(/^(?:(@[^:\s]+):)?registry\s*=\s*(.*)$/i)
      if (
        m &&
        !/^["']?https:\/\/registry\.(?:npmjs\.org|yarnpkg\.com|npmmirror\.com)\/?["']?\s*$/i.test(
          m[2],
        )
      )
        blocked.push(m[1] || '*')
    }
    return blocked
  }
  return /^\s*(?:["']?(?:registry|npmRegistryServer|registries|npmScopes|npmRegistries|yarn-path|yarnPath)["']?[\s:=])/im.test(
    content,
  )
    ? ['*']
    : []
}
function nuxtConfig(dir, texts) {
  const file = [...texts.keys()].find(
    (f) =>
      path.dirname(f) === (dir || '.') &&
      /^nuxt\.config\.[cm]?[jt]s$/.test(path.basename(f)),
  )
  if (!file) return null
  const ast = ts.createSourceFile(
    file,
    texts.get(file),
    ts.ScriptTarget.Latest,
    true,
  )
  const constants = new Map()
  for (const st of ast.statements) {
    if (
      !ts.isVariableStatement(st) ||
      !(st.declarationList.flags & ts.NodeFlags.Const)
    )
      continue
    for (const decl of st.declarationList.declarations)
      if (ts.isIdentifier(decl.name))
        constants.set(decl.name.text, decl.initializer)
  }
  function resolve(node) {
    const seen = new Set()
    while (node && !seen.has(node)) {
      seen.add(node)
      if (ts.isIdentifier(node) && constants.has(node.text))
        node = constants.get(node.text)
      else if (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node)
      )
        node = node.expression
      else return node
    }
  }
  function field(obj, key) {
    const property = obj?.properties?.find(
      (p) =>
        (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
        p.name.getText(ast).replace(/^['"]|['"]$/g, '') === key,
    )
    return resolve(property?.initializer || property?.name)
  }
  const literal = (n) => (n && ts.isStringLiteralLike(n) ? n.text : null)
  let config
  for (const st of ast.statements) {
    let expr = ts.isExportAssignment(st) ? st.expression : null
    if (
      ts.isExpressionStatement(st) &&
      ts.isBinaryExpression(st.expression) &&
      st.expression.left.getText(ast) === 'module.exports'
    )
      expr = st.expression.right
    expr = resolve(expr)
    if (
      expr &&
      ts.isCallExpression(expr) &&
      expr.expression.getText(ast) === 'defineNuxtConfig'
    )
      expr = resolve(expr.arguments[0])
    if (expr && ts.isObjectLiteralExpression(expr)) config = expr
  }
  const registrations = []
  let dynamic =
    !config || config.properties.some((p) => ts.isSpreadAssignment(p))
  for (const key of ['modules', 'buildModules', 'plugins']) {
    const arr = field(config, key)
    if (!arr) continue
    if (!ts.isArrayLiteralExpression(arr)) {
      dynamic = true
      continue
    }
    for (const element of arr.elements) {
      const entry = resolve(element)
      if (!entry) {
        dynamic = true
        continue
      }
      const val = ts.isArrayLiteralExpression(entry)
        ? entry.elements[0]
        : ts.isObjectLiteralExpression(entry)
          ? field(entry, 'src')
          : entry
      const name = literal(resolve(val))
      if (!name) {
        dynamic = true
        continue
      }
      registrations.push({
        name,
        kind: key,
        file,
        line: ast.getLineAndCharacterOfPosition(val.getStart(ast)).line + 1,
      })
    }
  }
  return {
    file,
    registrations,
    dynamic,
    srcDir: literal(field(config, 'srcDir')) || '',
    pagesDir: literal(field(field(config, 'dir'), 'pages')) || 'pages',
    pagesDisabled: field(config, 'pages')?.kind === ts.SyntaxKind.FalseKeyword,
    customRouting:
      !config || !!field(config, 'router') || !!field(config, 'hooks'),
  }
}
module.exports = { technologies, lookupPolicy, registryRoutes, nuxtConfig }
