import { useEffect, useRef } from 'react'
import { init, use } from 'echarts/core'
import { TreemapChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { bytes, Empty } from './ui'
use([TreemapChart, TooltipComponent, CanvasRenderer])
const colors = [
  '#655394',
  '#347578',
  '#975731',
  '#456a9b',
  '#925672',
  '#686493',
  '#4c725e',
  '#72536e',
]
export default function VolumeChart({ nodes, pick }: any) {
  const root = useRef<HTMLDivElement>(null)
  const selection = useRef(pick)
  selection.current = pick
  const chart = useRef<ReturnType<typeof init> | null>(null)
  useEffect(() => {
    if (!root.current) return
    const instance = init(root.current)
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(root.current)
    instance.on('click', (e: any) => {
      if (e.data?.record) selection.current(e.data.record)
    })
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])
  useEffect(() => {
    const data = nodes.map((record: any, i: number) => ({
      name: record.name,
      value: record.bytes,
      itemStyle: { color: colors[i % colors.length] },
      record,
    }))
    chart.current?.setOption(
      {
        animation: false,
        tooltip: {
          renderMode: 'richText',
          formatter: (e: any) => e.name + ' · ' + bytes(e.value),
        },
        series: [
          {
            type: 'treemap',
            breadcrumb: { show: false },
            roam: false,
            nodeClick: false,
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            visibleMin: 0,
            data,
            sort: 'desc',
            label: {
              show: true,
              position: 'insideTopLeft',
              formatter: (e: any) =>
                (e.data?.record?.folder ? '▸ ' : '') +
                e.name +
                '\n' +
                bytes(e.value),
              fontSize: 12,
              color: '#ffffff',
              lineHeight: 19,
              overflow: 'truncate',
            },
            itemStyle: { borderColor: '#ffffff', borderWidth: 1, gapWidth: 1 },
          },
        ],
      },
      true,
    )
  }, [nodes])
  return (
    <div className="treemap">
      <div ref={root} style={{ height: '100%', width: '100%' }} />
      {!nodes.length && (
        <div style={{ position: 'absolute', inset: 0 }}>
          <Empty>当前范围没有非空文件</Empty>
        </div>
      )}
    </div>
  )
}
