import type { Request, Response, NextFunction } from 'express'

/**
 * Simple API-key middleware.
 * The key is set via the SYNC_API_KEY environment variable.
 * Clients must send it in the Authorization header:
 *   Authorization: Bearer <key>
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env['SYNC_API_KEY']

  // If no key is configured the server is open (dev/LAN-only mode).
  if (!apiKey) {
    next()
    return
  }

  const header = req.headers['authorization'] ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (token !== apiKey) {
    res.status(401).json({ error: 'Unauthorized — invalid or missing API key' })
    return
  }

  next()
}
