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
  /** All non-machine-specific settings from the server, regardless of timestamp.
   *  Used to bootstrap terminals that were set up after the server's settings were
   *  last written (logo, address, currency, etc. would otherwise never arrive). */
  baselineSettings?: SyncRecord[]
}

export interface PushResponse {
  ok: boolean
  serverTime: string
  rowsApplied: number
}
