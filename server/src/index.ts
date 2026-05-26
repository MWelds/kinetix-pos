import express from 'express'
import cors from 'cors'
import { getDb } from './database'
import { syncRouter } from './routes/sync'
import { requireApiKey } from './middleware/auth'

const PORT = parseInt(process.env['PORT'] ?? '3030', 10)
const HOST = process.env['HOST'] ?? '0.0.0.0'

const app = express()

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }))          // LAN access from terminals
app.use(express.json({ limit: '10mb' })) // sync payloads can be large on first run

// ── Routes ──────────────────────────────────────────────────────────────────
app.use('/sync', requireApiKey, syncRouter)

app.get('/', (_req, res) => {
  res.json({ name: 'Kinetix POS Sync Server', status: 'running' })
})

// ── Start ────────────────────────────────────────────────────────────────────
try {
  getDb() // initialise + migrate DB on startup
  console.log('[server] Database ready')
} catch (err) {
  console.error('[server] Database init failed:', err)
  process.exit(1)
}

app.listen(PORT, HOST, () => {
  console.log(`[server] Kinetix POS Sync Server listening on http://${HOST}:${PORT}`)
  console.log(`[server] API key protection: ${process.env['SYNC_API_KEY'] ? 'ENABLED' : 'DISABLED (set SYNC_API_KEY env var to enable)'}`)
})

export default app
