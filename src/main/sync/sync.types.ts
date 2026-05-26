/** Sync status reported to the renderer via IPC. */
export type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'disabled'

export interface SyncState {
  status: SyncStatus
  lastSyncAt: string | null   // ISO timestamp of last successful sync
  error: string | null
  pendingChanges: number      // approximate count of unsynced local rows
}

export type SyncRecord = Record<string, unknown>
export type SyncPayload = Record<string, SyncRecord[]>

export interface PullResponse {
  serverTime: string
  records: SyncPayload
}

export interface PushResponse {
  ok: boolean
  serverTime: string
  rowsApplied: number
}
