const test = require('node:test')
const assert = require('node:assert/strict')
const { analyzeCode } = require('../engine/trace.cjs')
const { analyzeUpgrades } = require('../engine/upgrades.cjs')
const { buildFeatureMap } = require('../engine/feature-map.cjs')
function analyze(files, other = []) {
  const texts = new Map(Object.entries(files)),
    signals = [...texts.keys()].filter((f) => f.endsWith('package.json'))
  const { projects } = analyzeUpgrades(texts, signals)
  const scan = analyzeCode(texts, signals, undefined, projects)
  return { ...scan, tree: buildFeatureMap(scan, projects, other) }
}
test('home navigation, shared components and action chains retain their distinct source evidence', () => {
  const s = analyze({
    'package.json': '{"name":"store","dependencies":{"nuxt":"^2"}}',
    'nuxt.config.js': 'export default {router:{extendRoutes(routes){}}}',
    'pages/index.vue':
      "<template><main><NuxtLink to='/orders'>订单</NuxtLink><OrderForm/></main></template><script setup>import OrderForm from '~/components/OrderForm.vue'</script>",
    'pages/orders.vue':
      "<template><main><h1>我的订单</h1><OrderForm/><nuxt-link to='/'>首页</nuxt-link></main></template><script setup>import OrderForm from '../components/OrderForm.vue'</script>",
    'components/OrderForm.vue':
      "<template><button @click='save'>保存订单</button></template><script>export default {methods:{save(){this.storeDraft();this.$router.push('/orders')},storeDraft(){localStorage.setItem('order','1')}}}</script>",
    'components/Unused.vue':
      "<template><button @click='other'>孤立操作</button></template>",
    'pages/profile.vue': '<template><main>未挂接到首页的页面</main></template>',
  })
  const { tree } = s,
    home = tree.nodes.find((n) => n.id === tree.start),
    orders = tree.nodes.find((n) => n.url === '/orders'),
    component = tree.nodes.find(
      (n) => n.file === 'components/OrderForm.vue' && n.kind === 'component',
    )
  assert.equal(home.url, '/')
  assert.match(home.detail, /核对/)
  assert.equal(orders.label, '我的订单')
  assert.equal(orders.parent, home.id)
  assert.notEqual(tree.nodes.find((n) => n.url === '/profile').parent, home.id)
  assert.equal(tree.links.filter((l) => l.to === component.id).length, 2)
  assert.ok(tree.links.some((l) => l.from === orders.id && l.to === home.id))
  assert.ok(
    tree.links.some(
      (l) =>
        l.from === component.id && l.to === orders.id && l.label === '路由跳转',
    ),
  )
  const f = s.flows.find((v) => v.name === '保存订单')
  assert.equal(tree.nodes.find((v) => v.flowId === f.id).parent, component.id)
  assert.deepEqual(
    f.steps.map((e) => e.type),
    ['event', 'handler', 'handler', 'storage', 'navigation'],
  )
  for (const node of tree.nodes) {
    const seen = new Set()
    let n = node
    while (n.parent) {
      assert.ok(!seen.has(n.id))
      seen.add(n.id)
      n = tree.nodes.find((v) => v.id === n.parent)
      assert.ok(n)
    }
    assert.equal(n.id, 'project')
  }
})
test('same URLs in different workspaces stay separate and dynamic links never manufacture a destination', () => {
  const files = {}
  for (const p of ['apps/a', 'apps/b']) {
    files[p + '/package.json'] = '{"dependencies":{"nuxt":"^2"}}'
    files[p + '/pages/index.vue'] =
      "<template><div><nuxt-link to='/cart'>cart</nuxt-link><nuxt-link :to='next'>运行时目标</nuxt-link></div></template>"
    files[p + '/pages/cart.vue'] = '<template><div/></template>'
  }
  const { tree } = analyze(files)
  assert.equal(tree.links.length, 2)
  for (const l of tree.links) {
    const target = tree.nodes.find((n) => n.id === l.to)
    assert.equal(target.file.split('/')[1], l.file.split('/')[1])
  }
})
test('service and command-line projects expose verified entries without fabricating a home page', () => {
  const s = analyze({
    'package.json': '{"bin":{"check":"bin/check.js"}}',
    'bin/check.js': 'console.log("ok")',
    'src/main.js':
      "import express from 'express'; const app=express(); function hello(req,res){res.end()}; app.get('/ping',hello); app.listen(3000)",
  })
  assert.ok(
    s.tree.nodes.some((n) => n.kind === 'entry' && n.file === 'bin/check.js'),
  )
  assert.ok(!s.tree.nodes.some((n) => n.kind === 'page'))
  assert.deepEqual(
    s.tree.nodes.find((n) => n.kind === 'service').steps.map((e) => e.label),
    ['GET /ping', 'hello'],
  )
  const plain = analyze({}, [{ path: 'src/main.rs' }]).tree
  assert.equal(
    plain.nodes.find((n) => n.id === plain.start).file,
    'src/main.rs',
  )
  assert.equal(analyze({}).tree.nodes.length, 1)
})

test('Nuxt page data hooks are attached to the page and expose requests with source lines', () => {
  const s = analyze({
    'package.json': '{"name":"shop","dependencies":{"nuxt":"^2"}}',
    'nuxt.config.js': 'export default {}',
    'pages/index.vue':
      "<template><h1>首页</h1></template>\n<script>\nexport default {\n async asyncData({ $axios }) {return await $axios.$get('/api/home')}\n}\n</script>",
  })
  const home = s.tree.nodes.find((n) => n.id === s.tree.start),
    f = s.flows.find((f) => f.name.includes('asyncData'))
  assert.equal(s.tree.nodes.find((n) => n.flowId === f.id).parent, home.id)
  assert.deepEqual(
    f.steps.map((e) => e.type),
    ['route', 'lifecycle', 'handler', 'http'],
  )
  assert.equal(f.steps.at(-1).label, 'GET /api/home')
  assert.equal(f.steps.at(-1).line, 4)
})
