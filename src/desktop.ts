import type { scanProject } from '../engine/scan.cjs'
import type { readSource } from '../engine/storage.cjs'

export type Snapshot = ReturnType<typeof scanProject> & { id: string }
export interface WorkspaceState {
  snapshot: Snapshot | null
  progress: { phase: string; fileCount: number; bytes: number } | null
  hasIndex: boolean
}
export type WorkspaceEvent = Partial<WorkspaceState> & { error?: string }
export interface ModelSettings {
  url: string
  model: string
  hasKey: boolean
  dataDirectory: string
}
export interface FileRow {
  path: string
  bytes: number
  kind: string
}
export interface FileListing {
  businessAncestor: string
  n: number
  bytes: number
  rows: FileRow[]
  nodes: {
    name: string
    bytes: number
    count: number
    folder: number
    kind: string
  }[]
}
interface DesktopApi {
  state(): Promise<WorkspaceState>
  subscribe(listener: (event: WorkspaceEvent) => void): () => void
  choose(): Promise<boolean>
  closeProject(): Promise<void>
  refresh(id: string): Promise<boolean>
  cancel(): Promise<void>
  clear(): Promise<void>
  files(
    id: string,
    options: {
      query?: string
      folder?: string
      page?: number
      business?: boolean
    },
  ): Promise<FileListing>
  source(
    id: string,
    location: { file: string; line?: number },
  ): Promise<ReturnType<typeof readSource>>
  report(id: string): Promise<boolean>
  copy(text: string): Promise<void>
  settings(): Promise<ModelSettings>
  configure(settings: {
    url: string
    model: string
    key?: string
  }): Promise<ModelSettings>
  explain(
    id: string,
    type: 'flow' | 'upgrade',
    entryId: string,
  ): Promise<{ text: string; evidenceIds: number[] }[]>
}
declare global {
  interface Window {
    almanac: DesktopApi
  }
}
export const api = window.almanac
export function tidy(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
