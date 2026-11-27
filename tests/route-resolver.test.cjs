const { test } = require('node:test')
const assert = require('node:assert/strict')
const { analyzeCode } = require('../engine/trace.cjs')
const { analyzeUpgrades } = require('../engine/upgrades.cjs')

test('nested imported routes and static Vite aliases locate the handler', () => {
  const texts = new Map([
    [
      'vite.config.ts',
      "import {defineConfig} from 'vite'; export default defineConfig({resolve:{alias:{'@':new URL('./src',import.meta.url).pathname}}})",
    ],
    [
      'src/routes.ts',
      "import View from '@/View.vue'; export const routes=[{path:'/parent',children:[{path:'child',component:View}]}]",
    ],
    [
      'src/router.ts',
      "import { createRouter } from 'vue-router'; import {routes} from './routes'; createRouter({routes})",
    ],
    [
      'src/View.vue',
      "<template><button @click='save'>保存</button></template><script setup>function save(){localStorage.setItem('test','1')}</script>",
    ],
  ])
  texts.set(
    'vite.config.ts',
    "import {defineConfig} from 'vite'; export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}}})",
  )
  const s = analyzeCode(texts, [])
  assert.equal(s.flows[0].url, '/parent/child')
  assert.equal(s.flows[0].steps.at(-1).type, 'storage')
  assert.ok(s.imports.some((e) => e.to === 'src/View.vue'))
})

test('commented migration examples do not trigger a Worker finding', () => {
  const texts = new Map([
    ['package.json', '{"name":"demo","devDependencies":{"vite":"^4"}}'],
    [
      'package-lock.json',
      '{"lockfileVersion":3,"packages":{"node_modules/vite":{"version":"4.5.14"}}}',
    ],
    [
      'vite.config.ts',
      '// worker: { plugins: [] }\nexport default {worker:{plugins:()=>[]}}',
    ],
  ])
  const report = analyzeUpgrades(texts, ['package.json'])
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0].status, 'unknown')
})
