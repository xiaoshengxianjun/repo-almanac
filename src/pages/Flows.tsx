import { FeatureExplorer } from './FeatureExplorer'

export function Flows(props: Parameters<typeof FeatureExplorer>[0]) {
  return (
    <>
      <div className="pageIntro">
        <h1>业务流程</h1>
        <p>从入口展开页面、组件与操作。选择节点，查看数据链路和对应源码。</p>
      </div>
      <FeatureExplorer {...props} />
    </>
  )
}
