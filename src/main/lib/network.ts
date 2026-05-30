import { networkInterfaces } from 'os'

/**
 * Pattern matching adapter names that are almost certainly virtual/software
 * interfaces rather than real LAN cards.  Case-insensitive.
 *
 * Covers: Docker bridge, WSL, Hyper-V, VMware, VirtualBox, TAP/TUN (OpenVPN),
 * Teredo, ISATAP, and generic "loopback" aliases that some drivers expose.
 */
const VIRTUAL_ADAPTER =
  /docker|vethernet|wsl|vmware|virtualbox|loopback|pseudo|teredo|isatap|tap|tun|vpn/i

/**
 * Returns true for IP addresses in ranges that virtual/container software
 * commonly uses but that rarely represent a real physical LAN.
 *
 * - 172.17.x.x  — Docker default bridge
 * - 172.18–31.x.x — Docker custom networks
 * - 169.254.x.x — link-local / APIPA
 */
function isVirtualRange(ip: string): boolean {
  if (ip.startsWith('169.254.')) return true
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1], 10)
    if (second >= 16 && second <= 31) return true
  }
  return false
}

/**
 * Priority score for an IP address — lower is better.
 *   0 = 192.168.x.x  (most common home/office LAN)
 *   1 = 10.x.x.x     (corporate LAN)
 *   2 = everything else that passed the virtual-range filter
 */
function ipPriority(ip: string): number {
  if (ip.startsWith('192.168.')) return 0
  if (ip.startsWith('10.'))      return 1
  return 2
}

/**
 * Returns the best-guess LAN IPv4 addresses for this machine, sorted so that
 * the most likely "real" LAN IP comes first.
 *
 * Filters out:
 *  - Loopback (127.x.x.x) — always excluded by `!iface.internal`
 *  - Virtual adapter names (Docker, WSL, Hyper-V, VMware…)
 *  - IP ranges commonly used by virtual/container software
 */
export function getLanIps(): string[] {
  const nets = networkInterfaces()
  const result: string[] = []

  for (const [name, list] of Object.entries(nets)) {
    if (VIRTUAL_ADAPTER.test(name)) continue
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal && !isVirtualRange(iface.address)) {
        result.push(iface.address)
      }
    }
  }

  return result.sort((a, b) => ipPriority(a) - ipPriority(b))
}

/**
 * Returns the single best-guess LAN IP, or '127.0.0.1' if none found.
 */
export function getLanIp(): string {
  return getLanIps()[0] ?? '127.0.0.1'
}
