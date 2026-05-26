import { Router } from 'express'
import { getRecordsSince, upsertRecords } from '../database'
import { SYNC_TABLES, type PushRequest, type PullRequest, type PullResponse, type StatusResponse } from '../types'

export const syncRouter = Router()

/** GET /sync/status — health check */
syncRouter.get('/status', (_req, res) => {
  const body: StatusResponse = {
    ok: true,
    version: process.env['npm_package_version'] ?? '1.0.0',
    serverTime: new Date().toISOString()
  }
  res.json(body)
})

/**
 * POST /sync/pull
 * Returns all records changed after `since` for each requested table.
 * Terminals should store the returned `serverTime` and use it as `since` on the next pull.
 */
syncRouter.post('/pull', (req, res) => {
  const { since } = req.body as PullRequest

  if (!since || typeof since !== 'string') {
    res.status(400).json({ error: '`since` is required (ISO timestamp)' })
    return
  }

  try {
    const records: PullResponse['records'] = {}
    for (const table of SYNC_TABLES) {
      const rows = getRecordsSince(table, since)
      if (rows.length > 0) records[table] = rows
    }

    const response: PullResponse = {
      serverTime: new Date().toISOString(),
      records
    }
    res.json(response)
  } catch (err) {
    console.error('[sync/pull]', err)
    res.status(500).json({ error: 'Internal server error during pull' })
  }
})

/**
 * POST /sync/push
 * Accepts a batch of changed records from a terminal and upserts them.
 * Uses last-write-wins: the server only overwrites a row if the incoming
 * updated_at is >= the server's current updated_at for that row.
 */
syncRouter.post('/push', (req, res) => {
  const { terminalId, records } = req.body as PushRequest

  if (!terminalId || typeof terminalId !== 'string') {
    res.status(400).json({ error: '`terminalId` is required' })
    return
  }

  if (!records || typeof records !== 'object') {
    res.status(400).json({ error: '`records` payload is required' })
    return
  }

  try {
    let totalRows = 0
    for (const table of SYNC_TABLES) {
      const rows = records[table]
      if (Array.isArray(rows) && rows.length > 0) {
        upsertRecords(table, rows)
        totalRows += rows.length
      }
    }
    console.log(`[sync/push] terminal=${terminalId} rows=${totalRows} at=${new Date().toISOString()}`)
    res.json({ ok: true, serverTime: new Date().toISOString(), rowsApplied: totalRows })
  } catch (err) {
    console.error('[sync/push]', err)
    res.status(500).json({ error: 'Internal server error during push' })
  }
})
