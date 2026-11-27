const path = require('node:path')
const { execFileSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
async function build() {
  const { packager } = await import('@electron/packager')
  const version = require('electron/package.json').version
  const paths = await packager({
    dir: root,
    name: 'RepoAlmanac',
    appBundleId: 'app.repoalmanac.desktop',
    appVersion: require('../package.json').version,
    out: path.join(root, 'release'),
    overwrite: true,
    electronVersion: version,
    download: { checksums: require('electron/checksums.json') },
    prune: true,
    icon: path.join(root, 'assets', 'app-icon'),
    ignore: [
      // Ship only the runtime tree. The renderer is already bundled by Vite.
      /^\/(?!package\.json$|(?:assets|desktop|dist|engine|node_modules|shared)(?:\/|$))[^/]+/,
      /^\/assets\/(?!app-icon\.png$)/,
    ],
  })
  if (process.platform === 'darwin') {
    for (const output of paths) {
      const bundle = path.join(output, 'RepoAlmanac.app')
      execFileSync(
        '/usr/bin/codesign',
        ['--force', '--deep', '--sign', '-', '--timestamp=none', bundle],
        { stdio: 'inherit' },
      )
      execFileSync(
        '/usr/bin/codesign',
        ['--verify', '--deep', '--strict', bundle],
        { stdio: 'inherit' },
      )
    }
  }
  console.log(paths.join('\n'))
}
build().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
