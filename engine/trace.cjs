const ts = require('@typescript/typescript6')
const { parse: parseVue } = require('@vue/compiler-sfc')
const path = require('node:path').posix
const ext = /\.(?:[mc]?[jt]sx?|vue)$/
function walk(node, visit) {
  visit(node)
  ts.forEachChild(node, (child) => {
    walk(child, visit)
  })
}
function prop(obj, key) {
  return obj && ts.isObjectLiteralExpression(obj)
    ? obj.properties.find((p) => p.name?.getText().replace(/['"]/g, '') === key)
        ?.initializer
    : undefined
}
function literal(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : undefined
}
function routePath(a, b) {
  return (
    ('/' + [a, b].filter(Boolean).join('/'))
      .replace(/\/+/g, '/')
      .replace(/\/$/, '') || '/'
  )
}
function analyzeCode(texts, signals, onProblem = () => {}, projects = []) {
  const mods = new Map(),
    symbols = [],
    actions = [],
    navigation = [],
    componentUses = [],
    routes = [],
    servers = [],
    mounts = [],
    listens = [],
    proxies = [],
    routerVars = new Set(),
    buildAliases = []
  const scopes = [...projects].sort((a, b) => b.dir.length - a.dir.length)
  const owner = (file) =>
    scopes.find((p) => !p.dir || file.startsWith(p.dir + '/'))
  const configPaths = [...texts.keys()]
    .filter((p) => /(^|\/)(tsconfig|jsconfig)\.json$/.test(p))
    .sort((a, b) => b.length - a.length)
  const aliasConfigs = configPaths.map((p) => ({
    dir: path.dirname(p) === '.' ? '' : path.dirname(p) + '/',
    config:
      ts.parseConfigFileTextToJson(p, texts.get(p)).config?.compilerOptions ||
      {},
  }))
  function localPath(from, spec) {
    if (!spec) return
    const candidates = []
    if (spec.startsWith('.'))
      candidates.push(path.join(path.dirname(from), spec))
    else {
      const project = owner(from)
      if (project?.config && /^(?:~~|@@|~|@)\//.test(spec)) {
        const [prefix, ...parts] = spec.split('/')
        candidates.push(
          path.join(
            project.dir,
            prefix.length === 1 ? project.config.srcDir : '',
            ...parts,
          ),
        )
      }
      for (const alias of buildAliases) {
        if (
          (!alias.scope || from.startsWith(alias.scope + '/')) &&
          (spec === alias.name || spec.startsWith(alias.name + '/'))
        )
          candidates.push(path.join(alias.to, spec.slice(alias.name.length)))
      }
      const config = aliasConfigs.find((c) => from.startsWith(c.dir))
      for (const [pattern, values] of Object.entries(
        config?.config.paths || {},
      )) {
        const [before, after = ''] = pattern.split('*')
        if (!Array.isArray(values)) continue
        if (
          pattern.includes('*')
            ? spec.startsWith(before) && spec.endsWith(after)
            : spec === pattern
        ) {
          const tail = spec.slice(
            before.length,
            after ? spec.length - after.length : undefined,
          )
          for (const v of values)
            if (typeof v === 'string')
              candidates.push(
                path.join(
                  config.dir,
                  config.config.baseUrl || '.',
                  v.replace('*', tail),
                ),
              )
        }
      }
    }
    for (const c of candidates)
      for (const stem of [c, c.replace(/\.js$/, '.ts'), c + '/index'])
        for (const e of [
          '',
          '.ts',
          '.tsx',
          '.js',
          '.jsx',
          '.mjs',
          '.cjs',
          '.vue',
        ])
          if (texts.has(stem + e)) return stem + e
  }
  function key(file, name) {
    return file + '#' + name
  }
  function ev(type, label, file, line, detail) {
    return { type, label, file, line, detail }
  }
  function ref(m, name) {
    const i = m.imports.get(name)
    return i
      ? { file: localPath(m.file, i.spec), name: i.name }
      : { file: m.file, name }
  }
  function func(m, name) {
    const r = ref(m, name)
    return mods.get(r.file)?.defs.get(r.name)
  }
  function templateText(n) {
    return n.type === 2
      ? n.content
      : (n.children || []).map(templateText).join(' ').trim()
  }
  for (const [file, source] of texts) {
    if (!ext.test(file) || /\.d\.[mc]?ts$/.test(file)) continue
    let bodies = [{ content: source, offset: 0 }],
      template
    if (file.endsWith('.vue')) {
      const parsed = parseVue(source, { filename: file, sourceMap: false })
      if (parsed.errors.length) onProblem('组件解析不完整 ' + file)
      const d = parsed.descriptor
      bodies = [d.script, d.scriptSetup]
        .filter(Boolean)
        .map((b) => ({ content: b.content, offset: b.loc.start.line - 1 }))
      template = d.template?.ast
    }
    const m = {
      file,
      imports: new Map(),
      defs: new Map(),
      values: new Map(),
      parts: [],
      tags: new Map(),
      heading: null,
      componentNames: new Map(),
    }
    mods.set(file, m)
    for (const b of bodies) {
      const sf = ts.createSourceFile(
        file,
        b.content,
        ts.ScriptTarget.Latest,
        true,
        /\.tsx$|\.jsx$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      )
      const line = (n) =>
        sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 + b.offset
      m.parts.push({ sf, line })
      for (const st of sf.statements) {
        if (ts.isImportDeclaration(st)) {
          const spec = literal(st.moduleSpecifier),
            c = st.importClause
          if (c?.name) m.imports.set(c.name.text, { spec, name: 'default' })
          if (c?.namedBindings && ts.isNamedImports(c.namedBindings))
            for (const e of c.namedBindings.elements)
              m.imports.set(e.name.text, {
                spec,
                name: e.propertyName?.text || e.name.text,
              })
        }
      }
      function define(name, node, isDefault = false) {
        if (!name || !node.body) return
        const value = { m, name, node, line }
        m.defs.set(name, value)
        if (isDefault) m.defs.set('default', value)
        symbols.push(ev('symbol', name, file, line(node), '函数定义'))
      }
      for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st))
          define(
            st.name?.text || 'default',
            st,
            st.modifiers?.some((v) => v.kind === ts.SyntaxKind.DefaultKeyword),
          )
        if (ts.isVariableStatement(st))
          for (const d of st.declarationList.declarations) {
            if (!ts.isIdentifier(d.name) || !d.initializer) continue
            m.values.set(d.name.text, d.initializer)
            if (
              ts.isArrowFunction(d.initializer) ||
              ts.isFunctionExpression(d.initializer)
            )
              define(d.name.text, d.initializer)
          }
        if (file.endsWith('.vue') && ts.isExportAssignment(st)) {
          const opts = ts.isCallExpression(st.expression)
            ? st.expression.arguments[0]
            : st.expression
          for (const v of prop(opts, 'components')?.properties || []) {
            if (ts.isShorthandPropertyAssignment(v))
              m.componentNames.set(v.name.text, v.name.text)
            else if (
              ts.isPropertyAssignment(v) &&
              ts.isIdentifier(v.initializer)
            )
              m.componentNames.set(
                v.name.getText().replace(/['"]/g, ''),
                v.initializer.text,
              )
          }
          if (opts && ts.isObjectLiteralExpression(opts))
            for (const member of opts.properties) {
              const hook = member.name?.getText().replace(/^['"]|['"]$/g, '')
              const description = {
                asyncData: '加载页面数据',
                fetch: '获取组件数据',
                created: '创建组件',
                mounted: '挂载组件',
              }[hook]
              if (
                !['asyncData', 'fetch', 'created', 'mounted'].includes(hook) ||
                !description
              )
                continue
              if (
                ['asyncData', 'fetch'].includes(hook) &&
                !owner(file)?.deps.some((d) => d.name === 'nuxt') &&
                !owner(file)?.config
              )
                continue
              const fn = ts.isMethodDeclaration(member)
                ? member
                : ts.isPropertyAssignment(member)
                  ? member.initializer
                  : null
              if (!fn || !ts.isFunctionLike(fn) || !fn.body) continue
              define(hook, fn)
              actions.push({
                file,
                name: description + ' · ' + hook,
                handler: hook,
                line: line(member),
                expr: hook,
                type: 'lifecycle',
              })
            }
          const methods = prop(opts, 'methods')
          for (const method of methods?.properties || [])
            if (ts.isMethodDeclaration(method))
              define(method.name.getText(), method)
        }
      }
    }
    if (template) {
      function visit(n) {
        if (n.tag) {
          if (
            !m.heading &&
            n.tag === 'h1' &&
            n.children?.length &&
            n.children.every((child) => child.type === 2)
          ) {
            const title = templateText(n).trim()
            if (title)
              m.heading = { title: title.slice(0, 65), line: n.loc.start.line }
          }
          if (!m.tags.has(n.tag)) m.tags.set(n.tag, n.loc.start.line)
          if (
            ['a', 'routerlink', 'nuxtlink'].includes(
              n.tag.toLowerCase().replace(/-/g, ''),
            )
          ) {
            const arg = n.tag === 'a' ? 'href' : 'to'
            const attr = n.props.find(
              (p) =>
                p.name === arg || (p.name === 'bind' && p.arg?.content === arg),
            )
            const bound = attr?.exp?.content?.trim()
            const dest =
              attr?.value?.content ||
              (bound && /^(['"])([^'"]+)\1$/.exec(bound)?.[2])
            if (dest && /^\/(?!\/)/.test(dest))
              navigation.push({
                file,
                line: attr.loc.start.line,
                dest: dest.split(/[?#]/)[0],
                label: '页面链接',
              })
          }
        }
        for (const p of n.props || []) {
          if (
            p.name !== 'on' ||
            !['click', 'submit', 'change'].includes(p.arg?.content)
          )
            continue
          const expr = p.exp?.content?.trim() || '',
            match = /^([A-Za-z_$][\w$]*)(?:\([^;]*\))?$/.exec(expr)
          const label =
            templateText(n) ||
            n.props.find((v) => v.name === 'aria-label')?.value?.content ||
            match?.[1] ||
            expr
          actions.push({
            file,
            name: label.slice(0, 65),
            handler: match?.[1],
            line: p.loc.start.line,
            expr,
          })
        }
        for (const child of n.children || []) visit(child)
      }
      visit(template)
    }
  }
  // Vite aliases are read as syntax. Project configuration is never imported.
  for (const m of mods.values())
    if (/^vite\.config\./.test(path.basename(m.file))) {
      for (const { sf } of m.parts)
        walk(sf, (n) => {
          if (
            !ts.isCallExpression(n) ||
            m.imports.get(n.expression.getText())?.spec !== 'vite'
          )
            return
          const aliases = prop(prop(n.arguments[0], 'resolve'), 'alias')
          for (const p of aliases?.properties || []) {
            if (!p.name || !p.initializer) continue
            const target = p.initializer,
              scope = path.dirname(m.file) === '.' ? '' : path.dirname(m.file)
            let rel = literal(target)
            if (ts.isCallExpression(target)) {
              const v = target.arguments[0]
              if (
                v &&
                ts.isNewExpression(v) &&
                v.expression.getText() === 'URL' &&
                v.arguments?.[1]?.getText() === 'import.meta.url'
              )
                rel = literal(v.arguments[0])
              else if (v?.getText() === '__dirname')
                rel = literal(target.arguments[1])
            }
            if (rel && !path.isAbsolute(rel))
              buildAliases.push({
                scope,
                name: p.name.getText().replace(/['"]/g, ''),
                to: path.join(scope, rel),
              })
          }
        })
    }
  buildAliases.sort((a, b) => b.scope.length - a.scope.length)
  function deref(m, n) {
    return n && ts.isIdentifier(n) ? m.values.get(n.text) || n : n
  }
  function resolveComponent(m, n) {
    if (!n) return
    if (ts.isIdentifier(n))
      return localPath(m.file, m.imports.get(n.text)?.spec)
    let spec
    walk(n, (c) => {
      if (
        ts.isCallExpression(c) &&
        c.expression.kind === ts.SyntaxKind.ImportKeyword
      )
        spec = literal(c.arguments[0])
    })
    return localPath(m.file, spec)
  }
  function addRoutes(m, n, parent, line, depth = 0) {
    if (depth > 12) return
    if (n && ts.isIdentifier(n) && m.imports.has(n.text)) {
      const r = ref(m, n.text),
        other = mods.get(r.file),
        value = other?.values.get(r.name)
      const part = other?.parts.find((p) => value?.getSourceFile() === p.sf)
      if (value && part)
        return addRoutes(other, value, parent, part.line, depth + 1)
    }
    n = deref(m, n)
    if (depth > 12 || !n || !ts.isArrayLiteralExpression(n)) return
    for (let entry of n.elements) {
      if (ts.isSpreadElement(entry)) {
        addRoutes(m, entry.expression, parent, line, depth + 1)
        continue
      }
      entry = deref(m, entry)
      const p = literal(prop(entry, 'path'))
      if (p === undefined) continue
      const url = p.startsWith('/') ? p : routePath(parent, p),
        component = resolveComponent(m, prop(entry, 'component'))
      if (component)
        routes.push({
          file: m.file,
          line: line(entry),
          component,
          url,
          title:
            literal(prop(prop(entry, 'meta'), 'title')) ||
            literal(prop(entry, 'name')) ||
            url,
        })
      addRoutes(m, prop(entry, 'children'), url, line, depth + 1)
    }
  }
  for (const m of mods.values())
    for (const { sf, line } of m.parts) {
      for (const [name, v] of m.values) {
        if (ts.isCallExpression(v)) {
          const exp = v.expression.getText(),
            head = exp.split('.')[0]
          if (
            m.imports.get(head)?.spec === 'express' &&
            (m.imports.get(head).name === 'Router' ||
              exp === head ||
              exp === head + '.Router')
          )
            routerVars.add(key(m.file, name))
        }
      }
      walk(sf, (n) => {
        if (!ts.isCallExpression(n)) return
        const exp = n.expression.getText(),
          args = n.arguments
        if (
          m.imports.get(exp)?.spec === 'vue-router' &&
          m.imports.get(exp).name === 'createRouter'
        ) {
          const opts = deref(m, args[0])
          let arr = prop(opts, 'routes')
          if (!arr && opts && ts.isObjectLiteralExpression(opts))
            arr = opts.properties.find(
              (v) =>
                ts.isShorthandPropertyAssignment(v) && v.name.text === 'routes',
            )?.name
          addRoutes(m, arr, '', line)
        }
        if (
          /^vite\.config\./.test(path.basename(m.file)) &&
          m.imports.get(exp)?.spec === 'vite'
        ) {
          const proxy = prop(prop(args[0], 'server'), 'proxy')
          for (const p of proxy?.properties || []) {
            if (!p.name || !p.initializer || prop(p.initializer, 'rewrite'))
              continue
            const url =
              literal(p.initializer) || literal(prop(p.initializer, 'target'))
            if (!url) continue
            try {
              const u = new URL(url)
              if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))
                proxies.push({
                  dir: path.dirname(m.file),
                  prefix: p.name.getText().replace(/['"]/g, ''),
                  port: u.port || '80',
                })
            } catch {}
          }
        }
        if (!ts.isPropertyAccessExpression(n.expression)) return
        const recv = n.expression.expression.getText(),
          method = n.expression.name.text,
          id = key(m.file, recv)
        if (!routerVars.has(id)) return
        if (method === 'listen' && args[0] && ts.isNumericLiteral(args[0]))
          listens.push({ id, port: args[0].text })
        const url = literal(args[0])
        if (url === undefined) return
        if (method === 'use' && args[1] && ts.isIdentifier(args[1])) {
          const r = ref(m, args[1].text)
          mounts.push({ parent: id, child: key(r.file, r.name), url })
        }
        if (
          ['get', 'post', 'put', 'patch', 'delete'].includes(method) &&
          args.length >= 2
        )
          servers.push({
            id,
            m,
            url,
            method: method.toUpperCase(),
            handler: args[args.length - 1],
            line: line(n),
          })
      })
    }
  const normalizeTag = (name) => name.replace(/-/g, '').toLowerCase()
  for (const m of mods.values()) {
    if (!m.file.endsWith('.vue')) continue
    const project = owner(m.file)
    const nuxt = project?.config || project?.deps.some((d) => d.name === 'nuxt')
    if (nuxt && !project.config?.pagesDisabled) {
      const root = project.dir,
        config = project.config,
        src = config?.srcDir || ''
      const candidates = src ? [src] : ['', 'app']
      const base = candidates
        .map((base) => path.join(root, base, config?.pagesDir || 'pages') + '/')
        .find((base) => m.file.startsWith(base))
      if (base && !routes.some((r) => r.component === m.file)) {
        const rel = m.file.slice(base.length, -4)
        const url = routePath(
          '',
          rel
            .replace(/(^|\/)index$/, '')
            .split('/')
            .map((v, i, parts) => {
              if (v === '_') return '*'
              if (v.startsWith('_'))
                return ':' + v.slice(1) + (i === parts.length - 1 ? '?' : '')
              return v
                .replace(/\[\.\.\.([^\]]+)\]/g, ':$1(.*)')
                .replace(/\[([^\]]+)\]/g, ':$1')
            })
            .join('/'),
        )
        routes.push({
          file: m.file,
          line: m.heading?.line || 1,
          component: m.file,
          url,
          title: url === '/' ? '首页' : m.heading?.title || url,
          origin: project.config?.customRouting
            ? 'Nuxt 页面约定 · 路由配置需核对'
            : 'Nuxt 页面约定',
        })
      }
    }
    const bindings = new Map()
    for (const [name, i] of m.imports)
      if (i.name === 'default') bindings.set(normalizeTag(name), i.spec)
    for (const [name, local] of m.componentNames)
      if (m.imports.has(local))
        bindings.set(normalizeTag(name), m.imports.get(local).spec)
    for (const [tag, line] of m.tags) {
      const to = localPath(m.file, bindings.get(normalizeTag(tag)))
      if (to?.endsWith('.vue') && to !== m.file)
        componentUses.push({ file: m.file, to, line, label: '模板组件 ' + tag })
    }
  }
  const endpoints = []
  function collect(id, prefix, port, seen) {
    if (seen.has(id)) return
    const next = new Set(seen).add(id)
    for (const s of servers.filter((s) => s.id === id))
      endpoints.push({ ...s, port, url: routePath(prefix, s.url) })
    for (const link of mounts.filter((l) => l.parent === id))
      collect(link.child, routePath(prefix, link.url), port, next)
  }
  for (const s of listens) collect(s.id, '', s.port, new Set())
  const flows = []
  function trace(action, route) {
    const steps = [],
      reasons = new Set(),
      visited = new Set()
    if (route)
      steps.push(ev('route', route.title, route.file, route.line, route.url))
    steps.push(
      ev(
        action.type || 'event',
        action.name,
        action.file,
        action.line,
        action.expr,
      ),
    )
    const rootFn = action.handler && func(mods.get(action.file), action.handler)
    if (!rootFn) reasons.add('事件处理函数未能静态定位')
    function follow(f, depth) {
      if (!f || depth > 10 || steps.length >= 48) {
        reasons.add('调用链已达到追踪边界')
        return
      }
      const id = key(f.m.file, f.name)
      if (visited.has(id)) return
      visited.add(id)
      steps.push(
        ev('handler', f.name, f.m.file, f.line(f.node), '处理函数定义'),
      )
      function visit(c) {
        if (steps.length >= 48) {
          reasons.add('调用链已达到追踪边界')
          return
        }
        if (c !== f.node.body && ts.isFunctionLike(c)) return
        if (ts.isCallExpression(c)) {
          const exp = c.expression.getText(),
            arg = c.arguments[0]
          const client = exp.split('.')[0],
            axios =
              f.m.imports.get(client)?.spec === 'axios' &&
              /\.(get|post|put|patch|delete)$/.test(exp)
          const nuxtAxios =
            owner(f.m.file)?.config &&
            /^(?:this\.)?\$axios\.\$?(get|post|put|patch|delete)$/.test(exp)
          if (/^(?:this\.)?\$router\.(?:push|replace)$/.test(exp)) {
            const dest = literal(arg) || literal(prop(arg, 'path'))
            steps.push(
              ev('navigation', dest || '动态跳转', f.m.file, f.line(c), exp),
            )
            if (dest && /^\/(?!\/)/.test(dest))
              navigation.push({
                from: action.file,
                file: f.m.file,
                line: f.line(c),
                dest: dest.split(/[?#]/)[0],
                label: '路由跳转',
              })
            else reasons.add('目标页面需在运行时确认')
          } else if (exp === 'fetch' || axios || nuxtAxios) {
            const url = literal(arg)
            const opts = c.arguments[1],
              method =
                axios || nuxtAxios
                  ? exp.split('.').pop().replace('$', '').toUpperCase()
                  : literal(prop(opts, 'method'))?.toUpperCase() ||
                    (!opts ||
                    (ts.isObjectLiteralExpression(opts) &&
                      !prop(opts, 'method') &&
                      !opts.properties.some((p) => ts.isSpreadAssignment(p)))
                      ? 'GET'
                      : undefined)
            steps.push(
              ev(
                'http',
                (method || 'HTTP') + ' ' + (url || '动态地址'),
                f.m.file,
                f.line(c),
                '发出请求',
              ),
            )
            const pathOnly = url?.split('?')[0]
            const proxy = proxies
              .filter(
                (p) =>
                  (p.dir === '.' || action.file.startsWith(p.dir + '/')) &&
                  (pathOnly === p.prefix ||
                    pathOnly?.startsWith(p.prefix + '/')),
              )
              .sort(
                (a, b) =>
                  b.dir.length - a.dir.length ||
                  b.prefix.length - a.prefix.length,
              )[0]
            const matches = endpoints.filter(
              (e) =>
                proxy &&
                e.port === proxy.port &&
                e.url === pathOnly &&
                e.method === method,
            )
            if (matches.length === 1) {
              const s = matches[0],
                def = ts.isIdentifier(s.handler)
                  ? func(s.m, s.handler.text)
                  : null
              steps.push(
                ev(
                  'server',
                  s.method + ' ' + s.url,
                  s.m.file,
                  s.line,
                  'Express 路由注册',
                ),
              )
              if (def)
                steps.push(
                  ev(
                    'server',
                    def.name,
                    def.m.file,
                    def.line(def.node),
                    '服务端处理函数',
                  ),
                )
            } else
              reasons.add(
                url ? '服务端归属或处理路径待确认' : '请求地址在运行时生成',
              )
          } else if (
            /^(?:localStorage|sessionStorage)\.(?:getItem|setItem|removeItem)$/.test(
              exp,
            )
          )
            steps.push(
              ev(
                'storage',
                literal(arg) || '本地存储',
                f.m.file,
                f.line(c),
                exp,
              ),
            )
          else if (/^(?:this\.)?\$store\.(?:dispatch|commit)$/.test(exp)) {
            steps.push(
              ev(
                'state',
                literal(arg) || '动态状态操作',
                f.m.file,
                f.line(c),
                exp,
              ),
            )
            reasons.add('状态处理器需结合 store 配置核对')
          } else if (
            ts.isPropertyAccessExpression(c.expression) &&
            c.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
            f.m.file.endsWith('.vue')
          ) {
            const target = f.m.defs.get(c.expression.name.text)
            if (target) follow(target, depth + 1)
          } else if (ts.isIdentifier(c.expression)) {
            const target = func(f.m, exp)
            if (target) follow(target, depth + 1)
          }
        }
        ts.forEachChild(c, visit)
      }
      visit(f.node.body)
    }
    if (rootFn) follow(rootFn, 0)
    flows.push({
      id: String(flows.length + 1),
      name: action.name,
      page: route?.title || path.basename(action.file),
      url: route?.url || '',
      steps,
      notes: [...reasons],
    })
  }
  for (const action of actions) {
    const r = routes.filter((r) => r.component === action.file)
    for (const route of r.length ? r : [null]) trace(action, route)
  }
  const entries = [],
    imports = []
  for (const m of mods.values()) {
    if (
      /(^|\/)(src\/main|src\/index|server\/index|app\/main|main)\.[cm]?[jt]sx?$/.test(
        m.file,
      )
    )
      entries.push(
        ev('entry', m.file, m.file, 1, '常见入口文件名，需结合启动配置核对'),
      )
    for (const { sf, line } of m.parts)
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st)) continue
        const to = localPath(m.file, literal(st.moduleSpecifier))
        if (to) imports.push({ from: m.file, to, line: line(st) })
      }
  }
  for (const p of projects) {
    const manifest = JSON.parse(texts.get(p.file))
    for (const [label, item] of [
      ['主入口', manifest.main],
      [
        '启动脚本',
        /^node\s+(?:\.\/)?([\w./-]+\.[cm]?[jt]s)(?:\s|$)/.exec(
          String(manifest.scripts?.start || ''),
        )?.[1],
      ],
      ...Object.entries(
        typeof manifest.bin === 'string'
          ? { CLI: manifest.bin }
          : manifest.bin || {},
      ),
    ]) {
      if (typeof item !== 'string') continue
      const file = path.join(p.dir, item)
      if (texts.has(file) && !entries.some((e) => e.file === file))
        entries.push(ev('entry', label, file, 1, p.file + ' 声明的程序入口'))
    }
  }
  const services = endpoints.map((e) => {
    const handler = ts.isIdentifier(e.handler)
      ? func(e.m, e.handler.text)
      : null
    const steps = [
      ev(
        'server',
        e.method + ' ' + e.url,
        e.m.file,
        e.line,
        'Express 路由注册',
      ),
    ]
    if (handler)
      steps.push(
        ev(
          'handler',
          handler.name,
          handler.m.file,
          handler.line(handler.node),
          '请求处理函数',
        ),
      )
    return {
      file: e.m.file,
      line: e.line,
      label: e.method + ' ' + e.url,
      steps,
    }
  })
  return {
    flows,
    routes,
    symbols,
    entries,
    imports,
    componentUses,
    navigation,
    services,
  }
}
module.exports = { analyzeCode }
