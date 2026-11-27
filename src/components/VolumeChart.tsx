import { useEffect, useRef } from 'react'
import { init, use } from 'echarts/core'
import { TreemapChart } from 'echarts/charts'
import { TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { FileListing } from '../desktop'
import { bytes, fmt } from './ui'

use([TreemapChart, TooltipComponent, CanvasRenderer])
export type VolumeTile = FileListing['nodes'][number] & {
  color: string
  other?: boolean
}
interface TileData {
  name: string
  value: number
  record: VolumeTile
}
export default function VolumeChart({
  nodes,
  total,
  pick,
}: {
  nodes: VolumeTile[]
  total: number
  pick: (n: VolumeTile) => void
}) {
  const root = useRef<HTMLDivElement>(null),
    selection = useRef(pick),
    chart = useRef<ReturnType<typeof init> | null>(null)
  selection.current = pick
  useEffect(() => {
    if (!root.current) return
    const instance = init(root.current)
    chart.current = instance
    const observer = new ResizeObserver(() => instance.resize())
    observer.observe(root.current)
    instance.on('click', (e) => {
      const tile = e.data as TileData | undefined
      if (tile?.record) selection.current(tile.record)
    })
    return () => {
      observer.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])
  useEffect(() => {
    chart.current?.setOption(
      {
        animation: false,
        tooltip: {
          renderMode: 'richText',
          confine: true,
          formatter: ({ data }: { data: TileData }) => {
            const n = data?.record
            if (!n) return ''
            const percent = total ? (100 * n.bytes) / total : 0
            return (
              n.name +
              '\n' +
              bytes(n.bytes) +
              ' · ' +
              (percent > 0 && percent < 0.1
                ? '<0.1'
                : percent.toLocaleString('zh-CN', {
                    maximumFractionDigits: 1,
                  })) +
              '%' +
              (n.folder || n.other ? ' · ' + fmt(n.count) + ' 个文件' : '')
            )
          },
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
            sort: 'desc',
            data: nodes.map((record) => ({
              name: record.name,
              value: record.bytes,
              record,
              itemStyle: { color: record.color },
            })),
            label: {
              show: true,
              position: 'insideTopLeft',
              formatter: ({ data }: { data: TileData }) =>
                data.name +
                (data.record.folder ? '/' : '') +
                '\n' +
                bytes(data.value),
              distance: 7,
              fontSize: 12,
              fontWeight: 550,
              color: '#352e38',
              lineHeight: 18,
              overflow: 'truncate',
            },
            itemStyle: {
              borderColor: '#fff',
              borderWidth: 1,
              borderRadius: 6,
              gapWidth: 3,
            },
            emphasis: {
              itemStyle: { borderColor: '#766479' },
              label: { color: '#241b2a' },
            },
          },
        ],
      },
      true,
    )
  }, [nodes, total])
  return (
    <div
      className="volumeCanvas"
      ref={root}
      role="img"
      aria-label={
        '按体积显示的矩形树图，共 ' +
        bytes(total) +
        '。可通过目录选择器、体积排行或文件清单浏览。'
      }
    />
  )
}
