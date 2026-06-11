/**
 * Embedded Sync Server — see bottom of file for full route listing.
 *
 * IMPORTANT: The server shares the POS app's own SQLite database (pos.db).
 * This means every push from a terminal is immediately visible to the local
 * POS app — no secondary database, no separate sync step needed on the server.
 */
import http from 'http'
import { createHmac, randomBytes, randomUUID } from 'crypto'
import { settingsService } from '../services/settings.service'
import { getSqlite } from '../database/connection'
import { hashPin } from '../lib/pin'
import { getLanIp } from '../lib/network'
import {
  SYNC_TABLES, HAS_UPDATED_AT, MACHINE_SPECIFIC_SETTINGS, LWW_EXCLUDE_COLS,
  type SyncTable,
} from './sync.constants'

// ─── Types ────────────────────────────────────────────────────────────────────
type SyncRecord = Record<string, unknown>
type SyncPayload = Record<string, SyncRecord[]>

// ─── State ────────────────────────────────────────────────────────────────────
let server: http.Server | null = null

export interface EmbeddedServerStatus { running: boolean; port: number; ip: string }

// ─── Database ─────────────────────────────────────────────────────────────────
/**
 * Returns the shared POS database handle.
 * The embedded server operates directly on the same database as the POS app —
 * pushes from terminals are immediately visible to the local register.
 */
function getServerDb() {
  return getSqlite()
}

// ─── Sync helpers ─────────────────────────────────────────────────────────────
function getRecordsSince(table: SyncTable, since: string): SyncRecord[] {
  const db = getServerDb()
  const col = HAS_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'
  return db.prepare(`SELECT * FROM ${table} WHERE ${col} > ? ORDER BY ${col} ASC`).all(since) as SyncRecord[]
}

/**
 * Returns the set of column names that actually exist in `table`.
 * Querying PRAGMA table_info is cheap and is cached per call-site via the
 * prepared-statement cache that better-sqlite3 maintains internally.
 */
function getTableColumns(table: string): Set<string> {
  const db = getServerDb()
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(rows.map((r) => r.name))
}

function upsertRecords(table: SyncTable, records: SyncRecord[]): void {
  if (records.length === 0) return
  const db = getServerDb()
  if (table === 'settings') {
    const upsertSettings = db.transaction((rows: SyncRecord[]) => {
      for (const row of rows) {
        // Never let a terminal overwrite machine-specific settings on the server
        if (MACHINE_SPECIFIC_SETTINGS.has(row['key'] as string)) continue
        const existing = db.prepare('SELECT updated_at FROM settings WHERE key = ?').get(row['key']) as { updated_at: string } | undefined
        if (!existing || (row['updated_at'] as string) >= existing.updated_at) {
          db.prepare(`INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`)
            .run(row['key'], row['value'], row['updated_at'])
        }
      }
    })
    upsertSettings(records); return
  }

  // Intersect the pushed row keys with the columns that actually exist in the
  // server's DB. This makes sync resilient to minor schema version mismatches
  // (e.g. terminal has a newer column the server hasn't migrated to yet).
  const existingCols = getTableColumns(table)
  const sample = records[0]
  const cols = Object.keys(sample).filter((c) => existingCols.has(c))
  if (cols.length === 0) {
    console.warn(`[embedded-server] upsertRecords: no known columns for ${table} — skipping`)
    return
  }

  const placeholders = cols.map(() => '?').join(', ')
  const updateCol = HAS_UPDATED_AT.has(table) ? 'updated_at' : 'created_at'
  // Never overwrite LWW-excluded columns (e.g. inventory.quantity — it must
  // always be derived from inventory_adjustments, not from a pushed value).
  const lwwExclude = LWW_EXCLUDE_COLS[table as SyncTable] ?? new Set<string>()
  const setClauses = cols.filter((c) => c !== 'id' && !lwwExclude.has(c))
    .map((c) => `${c} = CASE WHEN excluded.${updateCol} >= COALESCE(${table}.${updateCol}, '') THEN excluded.${c} ELSE ${table}.${c} END`)
    .join(', ')
  const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${setClauses}`)
  const upsertMany = db.transaction((rows: SyncRecord[]) => {
    for (const row of rows) {
      try { stmt.run(cols.map((c) => row[c])) }
      catch (err) {
        const msg = (err as Error).message ?? ''
        if (msg.includes('UNIQUE constraint failed') && !msg.includes(`${table}.id`)) {
          console.warn(`[embedded-server] skipping ${table} record (secondary unique conflict): ${msg}`)
        } else { throw err }
      }
    }
  })
  upsertMany(records)
}

function recomputeServerInventory(productIds: string[]): void {
  if (productIds.length === 0) return
  const db = getServerDb()
  const now = new Date().toISOString()
  for (const productId of productIds) {
    const result = db.prepare(`SELECT COALESCE(SUM(quantity),0) as total FROM inventory_adjustments WHERE product_id=?`).get(productId) as { total: number } | undefined
    if (result == null) continue
    db.prepare(`UPDATE inventory SET quantity=?,updated_at=? WHERE product_id=?`).run(Math.max(0, result.total), now, productId)
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
const SESSION_SECRET = randomBytes(32).toString('hex')
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000

function createSessionToken(): string {
  const exp = (Date.now() + TOKEN_TTL_MS).toString()
  const sig = createHmac('sha256', SESSION_SECRET).update(exp).digest('hex')
  return Buffer.from(`${exp}.${sig}`).toString('base64url')
}

function validateSessionToken(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const dot = decoded.indexOf('.')
    if (dot < 0) return false
    const exp = decoded.slice(0, dot); const sig = decoded.slice(dot + 1)
    if (Date.now() > parseInt(exp, 10)) return false
    return sig === createHmac('sha256', SESSION_SECRET).update(exp).digest('hex')
  } catch { return false }
}

function validateAdminPin(pin: string): boolean {
  if (!pin) return false
  // Hash the supplied PIN once — all stored PINs (staff + dashboardAdminPin) are
  // SHA-256 hashed so we never compare plaintext against the database.
  let hashed: string
  try { hashed = hashPin(pin) } catch { return false }

  // 1. Check the main app's dashboardAdminPin setting (always available, even before any sync).
  //    This is the primary bootstrap path for a fresh server install.
  try {
    const appPin = settingsService.get('dashboardAdminPin')
    if (appPin && appPin === hashed) return true
  } catch { /* main db may not be initialised yet — fall through */ }
  // 2. Check central.db for any staff member with dashboard access enabled and matching PIN.
  try {
    const db = getServerDb()
    // Note: staff table does NOT have deleted_at — only is_active tracks soft deletes for staff
    const staffRow = db.prepare(
      `SELECT id FROM staff WHERE pin=? AND is_active=1 AND can_access_dashboard=1`
    ).get(hashed)
    if (staffRow) return true
    // 3. Legacy fallback: admin-role staff (before can_access_dashboard column existed).
    const adminRow = db.prepare(
      `SELECT id FROM staff WHERE pin=? AND role='admin' AND is_active=1`
    ).get(hashed)
    if (adminRow) return true
  } catch { /* central.db not ready */ }
  return false
}

function getBearerToken(req: http.IncomingMessage): string | null {
  const auth = req.headers['authorization']
  if (!auth || !auth.startsWith('Bearer ')) return null
  return auth.slice(7)
}

// ─── Dashboard HTML ───────────────────────────────────────────────────────────
// NOTE: this function body is injected by the build step below.
// Do not edit the placeholder — edit the Python injection in the repo.
function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kinetix POS Dashboard</title>
<style>
:root{--a:#3b82f6;--ad:#2563eb;--bg:#f1f5f9;--su:#fff;--b:#e2e8f0;--t:#1e293b;--mu:#64748b;--d:#ef4444;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--t);min-height:100vh;}
#login{display:flex;align-items:center;justify-content:center;min-height:100vh;}
.lcard{background:var(--su);border:1px solid var(--b);border-radius:12px;padding:40px;width:380px;box-shadow:0 4px 24px rgba(0,0,0,.08);}
.lcard h1{font-size:22px;font-weight:700;margin-bottom:4px;}
.lcard p{font-size:14px;color:var(--mu);margin-bottom:24px;}
.pdisp{font-size:28px;letter-spacing:12px;text-align:center;padding:14px;border:2px solid var(--b);border-radius:8px;margin-bottom:18px;min-height:64px;background:#f8fafc;font-family:monospace;}
.pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}
.pb{padding:16px;font-size:18px;font-weight:600;border:2px solid var(--b);border-radius:8px;background:var(--su);cursor:pointer;transition:border-color .15s,color .15s;}
.pb:hover{border-color:var(--a);color:var(--a);}
.pb.clr{background:#fef2f2;border-color:#fecaca;color:var(--d);}
.btn-login{width:100%;padding:13px;background:var(--a);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;}
.btn-login:hover{background:var(--ad);}
.lerr{color:var(--d);font-size:13px;text-align:center;margin-top:10px;min-height:20px;}
#app{display:none;height:100vh;flex-direction:column;}
.hdr{background:var(--su);border-bottom:1px solid var(--b);padding:0 24px;height:56px;display:flex;align-items:center;gap:12px;flex-shrink:0;}
.hdr-logo{font-size:17px;font-weight:700;}
.hdr-tag{font-size:11px;padding:2px 8px;background:#dbeafe;color:var(--a);border-radius:99px;font-weight:600;}
.sp{flex:1;}
.btn-out{font-size:13px;color:var(--mu);background:none;border:1px solid var(--b);padding:6px 14px;border-radius:6px;cursor:pointer;}
.btn-out:hover{color:var(--d);border-color:#fecaca;}
.body{display:flex;flex:1;overflow:hidden;}
.nav{width:192px;background:var(--su);border-right:1px solid var(--b);padding:12px 8px;flex-shrink:0;}
.ni{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;color:var(--mu);margin-bottom:2px;user-select:none;}
.ni:hover{background:#f1f5f9;color:var(--t);}
.ni.active{background:#dbeafe;color:var(--a);}
.ni svg{width:18px;height:18px;flex-shrink:0;}
.content{flex:1;overflow-y:auto;padding:24px;}
.page{display:none;}
.page.active{display:block;}
.ph{display:flex;align-items:center;gap:10px;margin-bottom:18px;}
.ph h2{font-size:20px;font-weight:700;}
.si{padding:8px 14px;border:1px solid var(--b);border-radius:8px;font-size:14px;width:220px;outline:none;font-family:inherit;}
.si:focus{border-color:var(--a);}
.btn{padding:9px 16px;border-radius:8px;font-size:14px;font-weight:500;cursor:pointer;border:none;}
.btn-sm{padding:5px 12px;font-size:12px;}
.btn-outline{background:none;border:1px solid var(--b);color:var(--t);}
.btn-outline:hover{border-color:var(--a);color:var(--a);}
.btn-add{background:var(--a);color:#fff;}
.btn-add:hover{background:var(--ad);}
.card{background:var(--su);border:1px solid var(--b);border-radius:10px;overflow:hidden;}
table{width:100%;border-collapse:collapse;font-size:14px;}
th{padding:10px 16px;text-align:left;font-size:11px;font-weight:600;color:var(--mu);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--b);background:#f8fafc;}
td{padding:11px 16px;border-bottom:1px solid var(--b);}
tr:last-child td{border-bottom:none;}
tr:hover td{background:#f8fafc;}
.pill{font-size:11px;padding:2px 8px;border-radius:99px;font-weight:600;}
.p-act{background:#dcfce7;color:#16a34a;}
.p-off{background:#f1f5f9;color:var(--mu);}
.p-comp{background:#dcfce7;color:#16a34a;}
.p-pend{background:#fef9c3;color:#ca8a04;}
.p-ref{background:#fee2e2;color:var(--d);}
.p-void{background:#f1f5f9;color:var(--mu);}
.low{color:var(--d);font-weight:600;}
.empty{text-align:center;padding:40px;color:var(--mu);font-size:14px;}
.loading{text-align:center;padding:40px;color:var(--mu);}
.ov{display:none;position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:200;align-items:center;justify-content:center;}
.ov.open{display:flex;}
.modal{background:var(--su);border-radius:12px;padding:28px;width:520px;max-width:96vw;max-height:92vh;overflow-y:auto;box-shadow:0 8px 40px rgba(0,0,0,.18);}
.modal h2{font-size:18px;font-weight:700;margin-bottom:18px;}
.fr{margin-bottom:13px;}
.fr label{display:block;font-size:13px;font-weight:500;margin-bottom:4px;}
.fr input,.fr select,.fr textarea{width:100%;padding:8px 12px;border:1px solid var(--b);border-radius:8px;font-size:14px;outline:none;font-family:inherit;}
.fr input:focus,.fr select:focus,.fr textarea:focus{border-color:var(--a);}
.fr textarea{min-height:70px;resize:vertical;}
.fg{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.mf{margin-top:18px;display:flex;gap:10px;justify-content:flex-end;}
</style>
</head>
<body>
<div id="login">
  <div class="lcard">
    <h1>Kinetix POS</h1>
    <p>Enter your admin PIN to access the dashboard</p>
    <div class="pdisp" id="pdisp">&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;&#x2500;</div>
    <div class="pgrid" id="pgrid"></div>
    <button class="btn-login" onclick="submitPin()">Sign In</button>
    <div class="lerr" id="lerr"></div>
  </div>
</div>
<div id="app">
  <header class="hdr">
    <span class="hdr-logo">Kinetix POS</span>
    <span class="hdr-tag">Web Dashboard</span>
    <span class="sp"></span>
    <button class="btn-out" onclick="logout()">Sign Out</button>
  </header>
  <div class="body">
    <nav class="nav">
      <div class="ni active" onclick="showPage('products',this)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 7H4a2 2 0 00-2 2v6a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>Products
      </div>
      <div class="ni" onclick="showPage('inventory',this)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 9h20M9 21V9"/></svg>Inventory
      </div>
      <div class="ni" onclick="showPage('orders',this)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>Orders
      </div>
      <div class="ni" onclick="showPage('customers',this)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>Customers
      </div>
    </nav>
    <main class="content">
      <div id="page-products" class="page active">
        <div class="ph"><h2>Products</h2><span class="sp"></span>
          <input class="si" placeholder="Search products..." oninput="searchProducts(this.value)">
          <button class="btn btn-add" onclick="openProductModal(null)">+ Add Product</button>
        </div>
        <div class="card"><table>
          <thead><tr><th>Name</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead>
          <tbody id="tProds"><tr><td colspan="7" class="loading">Loading...</td></tr></tbody>
        </table></div>
      </div>
      <div id="page-inventory" class="page">
        <div class="ph"><h2>Inventory</h2><span class="sp"></span>
          <input class="si" placeholder="Search products..." oninput="searchInventory(this.value)">
        </div>
        <div class="card"><table>
          <thead><tr><th>Product</th><th>SKU</th><th>Stock</th><th>Low Alert</th><th></th></tr></thead>
          <tbody id="tInv"><tr><td colspan="5" class="loading">Loading...</td></tr></tbody>
        </table></div>
      </div>
      <div id="page-orders" class="page">
        <div class="ph"><h2>Orders</h2><span class="sp"></span>
          <select class="si" style="width:140px" onchange="filterOrders()" id="oStatus">
            <option value="">All Statuses</option><option value="completed">Completed</option>
            <option value="pending">Pending</option><option value="refunded">Refunded</option><option value="voided">Voided</option>
          </select>
          <input type="date" class="si" style="width:152px" onchange="filterOrders()" id="oDate">
        </div>
        <div class="card"><table>
          <thead><tr><th>Order #</th><th>Date</th><th>Customer</th><th>Register</th><th>Total</th><th>Status</th><th></th></tr></thead>
          <tbody id="tOrders"><tr><td colspan="7" class="loading">Loading...</td></tr></tbody>
        </table></div>
      </div>
      <div id="page-customers" class="page">
        <div class="ph"><h2>Customers</h2><span class="sp"></span>
          <input class="si" placeholder="Search customers..." oninput="searchCustomers(this.value)">
          <button class="btn btn-add" onclick="openCustomerModal(null)">+ Add Customer</button>
        </div>
        <div class="card"><table>
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Points</th><th>Credit</th><th></th></tr></thead>
          <tbody id="tCust"><tr><td colspan="6" class="loading">Loading...</td></tr></tbody>
        </table></div>
      </div>
    </main>
  </div>
</div>
<div class="ov" id="mProd">
  <div class="modal">
    <h2 id="mProdTitle">Add Product</h2><input type="hidden" id="mProdId">
    <div class="fg">
      <div class="fr"><label>Name *</label><input id="pName" placeholder="Product name"></div>
      <div class="fr"><label>SKU *</label><input id="pSku" placeholder="SKU-001"></div>
      <div class="fr"><label>Barcode</label><input id="pBarcode" placeholder="Optional"></div>
      <div class="fr"><label>Category</label><select id="pCat"><option value="">-- None --</option></select></div>
      <div class="fr"><label>Price *</label><input id="pPrice" type="number" step="0.01" placeholder="0.00"></div>
      <div class="fr"><label>Cost Price</label><input id="pCost" type="number" step="0.01" placeholder="0.00"></div>
      <div class="fr"><label>Tax Rate %</label><input id="pTax" type="number" step="0.01" placeholder="0"></div>
      <div class="fr"><label>Active</label><select id="pActive"><option value="1">Yes</option><option value="0">No</option></select></div>
    </div>
    <div class="fr"><label>Description</label><textarea id="pDesc" placeholder="Optional"></textarea></div>
    <div class="mf">
      <button class="btn btn-outline" onclick="closeModal('mProd')">Cancel</button>
      <button class="btn btn-add" onclick="saveProduct()">Save Product</button>
    </div>
  </div>
</div>
<div class="ov" id="mAdj">
  <div class="modal" style="width:380px">
    <h2>Adjust Stock</h2><input type="hidden" id="adjPid">
    <div class="fr"><label>Product</label><input id="adjName" readonly style="background:#f8fafc"></div>
    <div class="fr"><label>Current Stock</label><input id="adjCur" readonly style="background:#f8fafc"></div>
    <div class="fr"><label>Type</label>
      <select id="adjType">
        <option value="receive">Receive -- Add to stock</option>
        <option value="adjustment">Set Exact Amount</option>
        <option value="loss">Loss / Shrinkage</option>
        <option value="return">Return -- Add to stock</option>
      </select>
    </div>
    <div class="fr"><label>Quantity</label><input id="adjQty" type="number" step="0.01" placeholder="0"></div>
    <div class="fr"><label>Note</label><input id="adjNote" placeholder="Optional reason"></div>
    <div class="mf">
      <button class="btn btn-outline" onclick="closeModal('mAdj')">Cancel</button>
      <button class="btn btn-add" onclick="saveAdjustment()">Apply</button>
    </div>
  </div>
</div>
<div class="ov" id="mCust">
  <div class="modal">
    <h2 id="mCustTitle">Add Customer</h2><input type="hidden" id="mCustId">
    <div class="fg">
      <div class="fr"><label>First Name *</label><input id="cFirst" placeholder="First"></div>
      <div class="fr"><label>Last Name *</label><input id="cLast" placeholder="Last"></div>
      <div class="fr"><label>Email</label><input id="cEmail" type="email" placeholder="email@example.com"></div>
      <div class="fr"><label>Phone</label><input id="cPhone" placeholder="Phone number"></div>
    </div>
    <div class="fr"><label>Address</label><textarea id="cAddr" style="min-height:60px" placeholder="Optional"></textarea></div>
    <div class="fr"><label>Notes</label><textarea id="cNotes" style="min-height:60px" placeholder="Optional"></textarea></div>
    <div class="mf">
      <button class="btn btn-outline" onclick="closeModal('mCust')">Cancel</button>
      <button class="btn btn-add" onclick="saveCustomer()">Save Customer</button>
    </div>
  </div>
</div>
<div class="ov" id="mOrder">
  <div class="modal" style="width:620px">
    <h2 id="mOrderTitle">Order Detail</h2>
    <div id="mOrderBody"></div>
    <div class="mf"><button class="btn btn-outline" onclick="closeModal('mOrder')">Close</button></div>
  </div>
</div>
<script>
var token=localStorage.getItem('kpos_dash_token')||'';
var allProducts=[],allInventory=[],allOrders=[],allCustomers=[],categories=[];
var pin='';
var pgEl=document.getElementById('pgrid');
[1,2,3,4,5,6,7,8,9,'X',0,'<'].forEach(function(k){
  var b=document.createElement('button');
  b.className='pb'+(k==='X'?' clr':'');
  b.textContent=k==='<'?'⌫':(k==='X'?'✕':String(k));
  b.onclick=function(){handleKey(k);};
  pgEl.appendChild(b);
});
function handleKey(k){
  if(k==='X'){pin='';}else if(k==='<'){pin=pin.slice(0,-1);}else if(pin.length<8){pin+=String(k);}
  document.getElementById('pdisp').textContent=pin?'●'.repeat(pin.length):'──────';
}
async function submitPin(){
  if(!pin)return;
  document.getElementById('lerr').textContent='';
  try{
    var r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin})});
    var j=await r.json();
    if(j.ok&&j.token){token=j.token;localStorage.setItem('kpos_dash_token',token);showApp();}
    else{pin='';document.getElementById('pdisp').textContent='──────';document.getElementById('lerr').textContent=j.error||'Invalid PIN';}
  }catch(e){document.getElementById('lerr').textContent='Connection error';}
}
function logout(){
  token='';localStorage.removeItem('kpos_dash_token');pin='';
  document.getElementById('pdisp').textContent='──────';
  document.getElementById('lerr').textContent='';
  document.getElementById('app').style.display='none';
  document.getElementById('login').style.display='flex';
}
async function showApp(){
  document.getElementById('login').style.display='none';
  document.getElementById('app').style.display='flex';
  await loadCategories();
  await Promise.all([loadProducts(),loadInventory(),loadOrders(),loadCustomers()]);
}
function api(path,opts){
  opts=opts||{};
  var hdrs=Object.assign({'Content-Type':'application/json','Authorization':'Bearer '+token},opts.headers||{});
  return fetch(path,Object.assign({},opts,{headers:hdrs})).then(function(r){
    if(r.status===401){logout();return{error:'Session expired'};}
    return r.json();
  });
}
function showPage(name,el){
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.ni').forEach(function(n){n.classList.remove('active');});
  document.getElementById('page-'+name).classList.add('active');
  el.classList.add('active');
}
async function loadCategories(){
  var d=await api('/api/categories');categories=d.categories||[];
  var sel=document.getElementById('pCat');sel.innerHTML='<option value="">-- None --</option>';
  categories.forEach(function(c){var o=document.createElement('option');o.value=c.id;o.textContent=c.name;sel.appendChild(o);});
}
async function loadProducts(){var d=await api('/api/products');allProducts=d.products||[];renderProducts(allProducts);}
function searchProducts(q){var l=q.toLowerCase();renderProducts(allProducts.filter(function(p){return p.name.toLowerCase().indexOf(l)>-1||p.sku.toLowerCase().indexOf(l)>-1;}));}
function renderProducts(list){
  var tb=document.getElementById('tProds');
  if(!list.length){tb.innerHTML='<tr><td colspan="7" class="empty">No products found</td></tr>';return;}
  tb.innerHTML=list.map(function(p){
    var stock=(p.stock!==null&&p.stock!==undefined)?(+p.stock).toFixed(2):'--';
    return '<tr><td><strong>'+esc(p.name)+'</strong></td>'+
      '<td style="font-family:monospace;font-size:12px">'+esc(p.sku)+'</td>'+
      '<td>'+esc(p.category_name||'--')+'</td>'+
      '<td>$'+(+p.base_price).toFixed(2)+'</td>'+
      '<td>'+stock+'</td>'+
      '<td><span class="pill '+(p.is_active?'p-act':'p-off')+'">'+(p.is_active?'Active':'Inactive')+'</span></td>'+
      '<td><button class="btn btn-sm btn-outline" onclick="editProduct(\\''+p.id+'\\')">Edit</button></td></tr>';
  }).join('');
}
function editProduct(id){var p=allProducts.find(function(x){return x.id===id;});if(p)openProductModal(p);}
function openProductModal(p){
  document.getElementById('mProdTitle').textContent=p?'Edit Product':'Add Product';
  document.getElementById('mProdId').value=p?p.id:'';
  document.getElementById('pName').value=p?p.name:'';
  document.getElementById('pSku').value=p?p.sku:'';
  document.getElementById('pBarcode').value=p?(p.barcode||''):'';
  document.getElementById('pPrice').value=p?p.base_price:'';
  document.getElementById('pCost').value=p?(p.cost_price||''):'';
  document.getElementById('pTax').value=p?(p.tax_rate||0):0;
  document.getElementById('pDesc').value=p?(p.description||''):'';
  document.getElementById('pActive').value=p?(p.is_active?'1':'0'):'1';
  document.getElementById('pCat').value=p?(p.category_id||''):'';
  document.getElementById('mProd').classList.add('open');
}
async function saveProduct(){
  var id=document.getElementById('mProdId').value;
  var body={name:document.getElementById('pName').value.trim(),sku:document.getElementById('pSku').value.trim(),barcode:document.getElementById('pBarcode').value.trim()||null,category_id:document.getElementById('pCat').value||null,base_price:parseFloat(document.getElementById('pPrice').value)||0,cost_price:parseFloat(document.getElementById('pCost').value)||null,tax_rate:parseFloat(document.getElementById('pTax').value)||0,description:document.getElementById('pDesc').value.trim()||null,is_active:parseInt(document.getElementById('pActive').value,10)};
  if(!body.name||!body.sku){alert('Name and SKU are required');return;}
  var r=await api(id?'/api/products/'+id:'/api/products',{method:id?'PUT':'POST',body:JSON.stringify(body)});
  if(r.error){alert(r.error);return;}
  closeModal('mProd');await loadProducts();await loadInventory();
}
async function loadInventory(){var d=await api('/api/inventory');allInventory=d.inventory||[];renderInventory(allInventory);}
function searchInventory(q){var l=q.toLowerCase();renderInventory(allInventory.filter(function(i){return i.product_name.toLowerCase().indexOf(l)>-1||i.sku.toLowerCase().indexOf(l)>-1;}));}
function renderInventory(list){
  var tb=document.getElementById('tInv');
  if(!list.length){tb.innerHTML='<tr><td colspan="5" class="empty">No inventory records</td></tr>';return;}
  tb.innerHTML=list.map(function(i){
    var low=+i.quantity<=+i.low_stock_threshold;
    return '<tr><td><strong>'+esc(i.product_name)+'</strong></td>'+
      '<td style="font-family:monospace;font-size:12px">'+esc(i.sku)+'</td>'+
      '<td class="'+(low?'low':'')+'">'+(+i.quantity).toFixed(2)+(low?' &#9888;':'')+'</td>'+
      '<td>'+(+i.low_stock_threshold).toFixed(0)+'</td>'+
      '<td><button class="btn btn-sm btn-outline" onclick="openAdjust(\\''+i.product_id+'\\')">Adjust</button></td></tr>';
  }).join('');
}
function openAdjust(pid){
  var inv=allInventory.find(function(i){return i.product_id===pid;});if(!inv)return;
  document.getElementById('adjPid').value=inv.product_id;
  document.getElementById('adjName').value=inv.product_name;
  document.getElementById('adjCur').value=(+inv.quantity).toFixed(2);
  document.getElementById('adjQty').value='';document.getElementById('adjNote').value='';
  document.getElementById('adjType').value='receive';
  document.getElementById('mAdj').classList.add('open');
}
async function saveAdjustment(){
  var pid=document.getElementById('adjPid').value;
  var type=document.getElementById('adjType').value;
  var qty=parseFloat(document.getElementById('adjQty').value);
  var note=document.getElementById('adjNote').value.trim();
  var cur=parseFloat(document.getElementById('adjCur').value);
  if(isNaN(qty)||qty===0){alert('Enter a valid quantity');return;}
  var delta=qty;
  if(type==='loss')delta=-Math.abs(qty);
  else if(type==='adjustment')delta=qty-cur;
  var r=await api('/api/inventory/adjust',{method:'POST',body:JSON.stringify({product_id:pid,type:type,quantity:delta,note:note})});
  if(r.error){alert(r.error);return;}
  closeModal('mAdj');await loadInventory();
}
async function loadOrders(){var d=await api('/api/orders');allOrders=d.orders||[];renderOrders(allOrders);}
function filterOrders(){
  var status=document.getElementById('oStatus').value;
  var date=document.getElementById('oDate').value;
  var list=allOrders;
  if(status)list=list.filter(function(o){return o.status===status;});
  if(date)list=list.filter(function(o){return o.created_at&&o.created_at.indexOf(date)===0;});
  renderOrders(list);
}
function renderOrders(list){
  var tb=document.getElementById('tOrders');
  if(!list.length){tb.innerHTML='<tr><td colspan="7" class="empty">No orders found</td></tr>';return;}
  var pmap={completed:'p-comp',pending:'p-pend',refunded:'p-ref',voided:'p-void'};
  tb.innerHTML=list.map(function(o){
    var st=o.status||'pending';
    return '<tr><td style="font-family:monospace">#'+esc(o.order_number)+'</td>'+
      '<td>'+fmtDate(o.created_at)+'</td>'+
      '<td>'+esc(o.customer_name||'Walk-in')+'</td>'+
      '<td>'+esc(o.terminal_id||'--')+'</td>'+
      '<td><strong>$'+(+o.total).toFixed(2)+'</strong></td>'+
      '<td><span class="pill '+(pmap[st]||'p-off')+'">'+st+'</span></td>'+
      '<td><button class="btn btn-sm btn-outline" onclick="viewOrder(\\''+o.id+'\\')">View</button></td></tr>';
  }).join('');
}
async function viewOrder(id){
  var d=await api('/api/orders/'+id);var o=d.order;if(!o)return;
  document.getElementById('mOrderTitle').textContent='Order #'+o.order_number;
  var items=(o.items||[]).map(function(i){
    return '<tr><td>'+esc(i.product_name)+(i.variant_name?' <em>('+esc(i.variant_name)+')</em>':'')+'</td>'+
      '<td style="font-family:monospace;font-size:12px">'+esc(i.sku)+'</td>'+
      '<td>'+i.quantity+'</td><td>$'+(+i.unit_price).toFixed(2)+'</td><td>$'+(+i.line_total).toFixed(2)+'</td></tr>';
  }).join('');
  document.getElementById('mOrderBody').innerHTML=
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;font-size:14px">'+
    '<div><strong>Date:</strong> '+fmtDate(o.created_at)+'</div>'+
    '<div><strong>Register:</strong> '+esc(o.terminal_id||'--')+'</div>'+
    '<div><strong>Customer:</strong> '+esc(o.customer_name||'Walk-in')+'</div>'+
    '<div><strong>Staff:</strong> '+esc(o.staff_name||'--')+'</div>'+
    '<div><strong>Discount:</strong> $'+(+o.discount_amount).toFixed(2)+'</div>'+
    '<div><strong>Tax:</strong> $'+(+o.tax_amount).toFixed(2)+'</div></div>'+
    '<div class="card" style="margin-bottom:14px"><table>'+
    '<thead><tr><th>Item</th><th>SKU</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>'+
    '<tbody>'+(items||'<tr><td colspan="5" class="empty">No items</td></tr>')+'</tbody></table></div>'+
    '<div style="text-align:right;font-size:15px">Total: <strong>$'+(+o.total).toFixed(2)+'</strong></div>';
  document.getElementById('mOrder').classList.add('open');
}
async function loadCustomers(){var d=await api('/api/customers');allCustomers=d.customers||[];renderCustomers(allCustomers);}
function searchCustomers(q){
  var l=q.toLowerCase();
  renderCustomers(allCustomers.filter(function(c){return(c.first_name+' '+c.last_name).toLowerCase().indexOf(l)>-1||(c.email||'').toLowerCase().indexOf(l)>-1||(c.phone||'').toLowerCase().indexOf(l)>-1;}));
}
function renderCustomers(list){
  var tb=document.getElementById('tCust');
  if(!list.length){tb.innerHTML='<tr><td colspan="6" class="empty">No customers found</td></tr>';return;}
  tb.innerHTML=list.map(function(c){
    return '<tr><td><strong>'+esc(c.first_name)+' '+esc(c.last_name)+'</strong></td>'+
      '<td>'+esc(c.email||'--')+'</td><td>'+esc(c.phone||'--')+'</td>'+
      '<td>'+(c.loyalty_points||0)+'</td><td>$'+(+(c.store_credit||0)).toFixed(2)+'</td>'+
      '<td><button class="btn btn-sm btn-outline" onclick="editCustomer(\\''+c.id+'\\')">Edit</button></td></tr>';
  }).join('');
}
function editCustomer(id){var c=allCustomers.find(function(x){return x.id===id;});if(c)openCustomerModal(c);}
function openCustomerModal(c){
  document.getElementById('mCustTitle').textContent=c?'Edit Customer':'Add Customer';
  document.getElementById('mCustId').value=c?c.id:'';
  document.getElementById('cFirst').value=c?c.first_name:'';
  document.getElementById('cLast').value=c?c.last_name:'';
  document.getElementById('cEmail').value=c?(c.email||''):'';
  document.getElementById('cPhone').value=c?(c.phone||''):'';
  document.getElementById('cAddr').value=c?(c.address||''):'';
  document.getElementById('cNotes').value=c?(c.notes||''):'';
  document.getElementById('mCust').classList.add('open');
}
async function saveCustomer(){
  var id=document.getElementById('mCustId').value;
  var body={first_name:document.getElementById('cFirst').value.trim(),last_name:document.getElementById('cLast').value.trim(),email:document.getElementById('cEmail').value.trim()||null,phone:document.getElementById('cPhone').value.trim()||null,address:document.getElementById('cAddr').value.trim()||null,notes:document.getElementById('cNotes').value.trim()||null};
  if(!body.first_name||!body.last_name){alert('First and last name are required');return;}
  var r=await api(id?'/api/customers/'+id:'/api/customers',{method:id?'PUT':'POST',body:JSON.stringify(body)});
  if(r.error){alert(r.error);return;}
  closeModal('mCust');await loadCustomers();
}
function closeModal(id){document.getElementById(id).classList.remove('open');}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmtDate(s){if(!s)return'--';try{return new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(s));}catch(e){return s;}}
document.querySelectorAll('.ov').forEach(function(m){m.addEventListener('click',function(e){if(e.target===m)m.classList.remove('open');});});
if(token){fetch('/api/products',{headers:{'Authorization':'Bearer '+token}}).then(function(r){if(r.status!==401)showApp();else{token='';localStorage.removeItem('kpos_dash_token');}}).catch(function(){});}
</script>
</body>
</html>`
}

// ─── Sync v2 helpers ─────────────────────────────────────────────────────────

/**
 * Query the server's sync_log for all change entries since `since` (exclusive),
 * then fetch the current row state for INSERT/UPDATE entries and collect row_ids
 * for DELETE entries.  Used by the /sync/v2/pull route.
 *
 * Returns at most 1 000 log entries per call so the response stays bounded.
 * Terminals that are far behind will catch up over multiple pull cycles.
 */
function getServerV2Changes(since: number): {
  records: Record<string, { upserts: SyncRecord[]; deletes: string[] }>
  maxServerSeq: number
} {
  const db = getServerDb()

  const entries = db.prepare(`
    SELECT seq, table_name, row_id, operation
    FROM sync_log
    WHERE seq > ?
    ORDER BY seq ASC
    LIMIT 1000
  `).all(since) as { seq: number; table_name: string; row_id: string; operation: string }[]

  if (entries.length === 0) return { records: {}, maxServerSeq: since }

  const maxServerSeq = entries[entries.length - 1].seq

  // Group by table, dedup row_ids — DELETE wins over pending INSERT/UPDATE for the same id
  const byTable = new Map<string, { upsertIds: Set<string>; deleteIds: Set<string> }>()
  for (const entry of entries) {
    if (!SYNC_TABLES.includes(entry.table_name as SyncTable)) continue
    if (!byTable.has(entry.table_name)) {
      byTable.set(entry.table_name, { upsertIds: new Set(), deleteIds: new Set() })
    }
    const group = byTable.get(entry.table_name)!
    if (entry.operation === 'DELETE') {
      group.deleteIds.add(entry.row_id)
      group.upsertIds.delete(entry.row_id)
    } else if (!group.deleteIds.has(entry.row_id)) {
      group.upsertIds.add(entry.row_id)
    }
  }

  const records: Record<string, { upserts: SyncRecord[]; deletes: string[] }> = {}

  for (const [table, { upsertIds, deleteIds }] of byTable) {
    const pkCol = table === 'settings' ? 'key' : 'id'
    const tableOut: { upserts: SyncRecord[]; deletes: string[] } = {
      upserts: [],
      deletes: [...deleteIds],
    }

    if (upsertIds.size > 0) {
      const ids = [...upsertIds]
      const placeholders = ids.map(() => '?').join(', ')
      try {
        let rows = db.prepare(
          `SELECT * FROM ${table} WHERE ${pkCol} IN (${placeholders})`
        ).all(ids) as SyncRecord[]
        if (table === 'settings') {
          rows = rows.filter((r) => !MACHINE_SPECIFIC_SETTINGS.has(r['key'] as string))
        }
        tableOut.upserts = rows
      } catch (err) {
        console.warn(`[embedded-server v2] pull: could not fetch from ${table}:`, (err as Error).message)
      }
    }

    if (tableOut.upserts.length > 0 || tableOut.deletes.length > 0) {
      records[table] = tableOut
    }
  }

  return { records, maxServerSeq }
}

// ─── API route handlers ───────────────────────────────────────────────────────
async function handleApiRoute(req: http.IncomingMessage, res: http.ServerResponse, url: string, method: string): Promise<void> {
  const db = getServerDb()
  const ts = () => new Date().toISOString()

  if (method === 'GET' && url === '/api/categories') {
    send(res, 200, { categories: db.prepare(`SELECT * FROM categories WHERE deleted_at IS NULL ORDER BY name`).all() }); return
  }
  if (method === 'GET' && url === '/api/products') {
    send(res, 200, { products: db.prepare(`SELECT p.*,c.name AS category_name,i.quantity AS stock,i.low_stock_threshold FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN inventory i ON i.product_id=p.id AND (i.variant_id IS NULL OR i.variant_id='') WHERE p.deleted_at IS NULL ORDER BY p.name`).all() }); return
  }
  if (method === 'POST' && url === '/api/products') {
    const b = await parseBody(req) as Record<string, unknown>
    if (!b.name || !b.sku) { send(res, 400, { error: 'name and sku required' }); return }
    const id = randomUUID(); const now = ts()
    try {
      db.prepare(`INSERT INTO products (id,name,sku,barcode,category_id,base_price,cost_price,tax_rate,description,is_active,is_composite,track_stock,units_per_pack,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,0,1,1,?,?)`)
        .run(id,b.name,b.sku,b.barcode??null,b.category_id??null,b.base_price??0,b.cost_price??null,b.tax_rate??0,b.description??null,b.is_active??1,now,now)
      db.prepare(`INSERT OR IGNORE INTO inventory (id,product_id,quantity,low_stock_threshold,created_at,updated_at) VALUES (?,?,0,5,?,?)`).run(randomUUID(),id,now,now)
      send(res, 200, { ok: true, id })
    } catch (err) { send(res, 400, { error: (err as Error).message }) }
    return
  }
  const putProduct = url.match(/^\/api\/products\/([^/]+)$/)
  if (method === 'PUT' && putProduct) {
    const id = putProduct[1]; const now = ts()
    const b = await parseBody(req) as Record<string, unknown>
    if (!b.name || !b.sku) { send(res, 400, { error: 'name and sku required' }); return }
    try {
      db.prepare(`UPDATE products SET name=?,sku=?,barcode=?,category_id=?,base_price=?,cost_price=?,tax_rate=?,description=?,is_active=?,updated_at=? WHERE id=?`)
        .run(b.name,b.sku,b.barcode??null,b.category_id??null,b.base_price??0,b.cost_price??null,b.tax_rate??0,b.description??null,b.is_active??1,now,id)
         send(res, 200, { ok: true })
    } catch (err) { send(res, 400, { error: (err as Error).message }) }
    return
  }
  if (method === 'GET' && url === '/api/inventory') {
    send(res, 200, { inventory: db.prepare(`SELECT i.*,p.name AS product_name,p.sku,p.track_stock FROM inventory i JOIN products p ON p.id=i.product_id WHERE p.deleted_at IS NULL AND p.track_stock=1 AND (i.variant_id IS NULL OR i.variant_id='') ORDER BY p.name`).all() }); return
  }
  if (method === 'POST' && url === '/api/inventory/adjust') {
    const b = await parseBody(req) as { product_id?: string; type?: string; quantity?: number; note?: string }
    if (!b.product_id || b.quantity == null) { send(res, 400, { error: 'product_id and quantity required' }); return }
    const now = ts()
    db.prepare(`INSERT INTO inventory_adjustments (id,product_id,type,quantity,note,created_at) VALUES (?,?,?,?,?,?)`).run(randomUUID(),b.product_id,b.type??'adjustment',b.quantity,b.note??null,now)
    recomputeServerInventory([b.product_id])
    send(res, 200, { ok: true }); return
  }
  if (method === 'GET' && url === '/api/orders') {
    send(res, 200, { orders: db.prepare(`SELECT o.*,CASE WHEN c.id IS NOT NULL THEN c.first_name||' '||c.last_name ELSE NULL END AS customer_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.deleted_at IS NULL ORDER BY o.created_at DESC LIMIT 500`).all() }); return
  }
  const getOrder = url.match(/^\/api\/orders\/([^/]+)$/)
  if (method === 'GET' && getOrder) {
    const id = getOrder[1]
    const order = db.prepare(`SELECT o.*,CASE WHEN c.id IS NOT NULL THEN c.first_name||' '||c.last_name ELSE NULL END AS customer_name,CASE WHEN s.id IS NOT NULL THEN s.first_name||' '||s.last_name ELSE NULL END AS staff_name FROM orders o LEFT JOIN customers c ON c.id=o.customer_id LEFT JOIN staff s ON s.id=o.staff_id WHERE o.id=?`).get(id) as Record<string, unknown> | undefined
    if (!order) { send(res, 404, { error: 'Order not found' }); return }
    const items = db.prepare(`SELECT * FROM order_items WHERE order_id=? AND (deleted_at IS NULL OR deleted_at='')`).all(id)
    send(res, 200, { order: { ...order, items } }); return
  }
  if (method === 'GET' && url === '/api/customers') {
    send(res, 200, { customers: db.prepare(`SELECT * FROM customers WHERE deleted_at IS NULL ORDER BY first_name,last_name`).all() }); return
  }
  if (method === 'POST' && url === '/api/customers') {
    const b = await parseBody(req) as Record<string, unknown>
    if (!b.first_name || !b.last_name) { send(res, 400, { error: 'first_name and last_name required' }); return }
    const id = randomUUID(); const now = ts()
    db.prepare(`INSERT INTO customers (id,first_name,last_name,email,phone,address,notes,loyalty_points,store_credit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,0,0,?,?)`).run(id,b.first_name,b.last_name,b.email??null,b.phone??null,b.address??null,b.notes??null,now,now)
    send(res, 200, { ok: true, id }); return
  }
  const putCustomer = url.match(/^\/api\/customers\/([^/]+)$/)
  if (method === 'PUT' && putCustomer) {
    const id = putCustomer[1]; const now = ts()
    const b = await parseBody(req) as Record<string, unknown>
    if (!b.first_name || !b.last_name) { send(res, 400, { error: 'first_name and last_name required' }); return }
    db.prepare(`UPDATE customers SET first_name=?,last_name=?,email=?,phone=?,address=?,notes=?,updated_at=? WHERE id=?`).run(b.first_name,b.last_name,b.email??null,b.phone??null,b.address??null,b.notes??null,now,id)
    send(res, 200, { ok: true }); return
  }
  send(res, 404, { error: 'Not found' })
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

/** Maximum body size for any single request: 50 MB (covers large sync payloads). */
const MAX_BODY_BYTES = 50 * 1024 * 1024

function parseBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = ''
    let byteCount = 0
    req.on('data', (chunk: Buffer) => {
      byteCount += chunk.length
      if (byteCount > MAX_BODY_BYTES) {
        req.destroy()
        reject(new Error('Request body too large (max 50 MB)'))
        return
      }
      data += chunk
    })
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch { reject(new Error('Invalid JSON')) } })
    req.on('error', reject)
  })
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) })
  res.end(json)
}

// ─── Request handler ──────────────────────────────────────────────────────────
function createHandler(apiKey: string) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    // Restrict CORS to same-origin / LAN clients — not the open web.
    const origin = req.headers['origin']
    if (origin) {
      // Allow only origins that share the same host (LAN IPs and localhost).
      // Browsers on external sites can't access the dashboard or sync routes.
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    const url = req.url?.split('?')[0] ?? '/'
    const method = req.method ?? 'GET'
    try {
      // Dashboard SPA
      if (method === 'GET' && (url === '/' || url === '/dashboard')) {
        const html = getDashboardHtml()
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html) })
        res.end(html); return
      }
      // Auth — no token required
      if (method === 'POST' && url === '/api/auth/login') {
        const body = await parseBody(req) as { pin?: string }
        if (!body.pin) { send(res, 400, { error: 'PIN required' }); return }
        if (!validateAdminPin(body.pin)) { send(res, 401, { error: 'Invalid PIN' }); return }
        send(res, 200, { ok: true, token: createSessionToken() }); return
      }
      // Protected dashboard API routes (session token)
      if (url.startsWith('/api/')) {
        const tok = getBearerToken(req)
        if (!tok || !validateSessionToken(tok)) { send(res, 401, { error: 'Unauthorized' }); return }
        await handleApiRoute(req, res, url, method); return
      }
      // ── Sync routes ────────────────────────────────────────────────────────
      // Open status endpoints — no auth required (used for connectivity probes).
      if (method === 'GET' && url === '/sync/status') {
        send(res, 200, { ok: true, version: '1.0.0', serverTime: new Date().toISOString() }); return
      }
      if (method === 'GET' && url === '/sync/v2/status') {
        send(res, 200, { ok: true, version: '2.0.0', protocol: 'seq', serverTime: new Date().toISOString() }); return
      }

      if (url.startsWith('/sync/')) {
        // All /sync/* routes beyond the status probes require the shared API key.
        if (apiKey) {
          const tok = getBearerToken(req)
          if (tok !== apiKey) { send(res, 401, { error: 'Invalid sync API key' }); return }
        }

        // ── v1 routes (legacy — kept live until all terminals migrate to v2) ──
        if (method === 'POST' && url === '/sync/pull') {
          const body = await parseBody(req) as { since?: string }
          if (!body.since || typeof body.since !== 'string') { send(res, 400, { error: '`since` is required' }); return }
          const records: SyncPayload = {}
          for (const table of SYNC_TABLES) {
            let rows = getRecordsSince(table, body.since)
            if (table === 'settings') rows = rows.filter((r) => !MACHINE_SPECIFIC_SETTINGS.has(r['key'] as string))
            if (rows.length > 0) records[table] = rows
          }
          const allSettings = (getServerDb().prepare(
            `SELECT * FROM settings`
          ).all() as SyncRecord[]).filter((r) => !MACHINE_SPECIFIC_SETTINGS.has(r['key'] as string))
          send(res, 200, { serverTime: new Date().toISOString(), records, baselineSettings: allSettings }); return
        }
        if (method === 'POST' && url === '/sync/push') {
          const body = await parseBody(req) as { terminalId?: string; records?: SyncPayload }
          if (!body.terminalId) { send(res, 400, { error: '`terminalId` is required' }); return }
          if (!body.records)    { send(res, 400, { error: '`records` is required' }); return }
          let total = 0
          const adjPids: string[] = []
          const skippedTables: { table: string; error: string }[] = []
          for (const table of SYNC_TABLES) {
            const rows = body.records[table]
            if (!Array.isArray(rows) || rows.length === 0) continue
            try {
              upsertRecords(table, rows)
              total += rows.length
              if (table === 'inventory_adjustments') {
                for (const row of rows) { const pid = row['product_id'] as string; if (pid) adjPids.push(pid) }
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err)
              console.error(`[embedded-server] /sync/push upsert failed for table "${table}":`, msg)
              skippedTables.push({ table, error: msg })
            }
          }
          if (adjPids.length > 0) recomputeServerInventory([...new Set(adjPids)])
          send(res, 200, {
            ok: skippedTables.length === 0,
            serverTime: new Date().toISOString(),
            rowsApplied: total,
            ...(skippedTables.length > 0 && { skippedTables }),
          }); return
        }

        // ── v2 routes — seq-based, no clock dependency ──────────────────────
        if (method === 'POST' && url === '/sync/v2/push') {
          const body = await parseBody(req) as {
            terminalId?: string
            maxSeq?: number
            records?: Record<string, { upserts?: SyncRecord[]; deletes?: string[] }>
          }
          if (!body.terminalId) { send(res, 400, { error: '`terminalId` is required' }); return }
          if (typeof body.maxSeq !== 'number') { send(res, 400, { error: '`maxSeq` must be a number' }); return }

          let rowsApplied = 0
          const adjPids: string[] = []

          for (const table of SYNC_TABLES) {
            const tablePayload = body.records?.[table]
            if (!tablePayload) continue

            // Apply upserts
            const upserts = tablePayload.upserts
            if (Array.isArray(upserts) && upserts.length > 0) {
              upsertRecords(table, upserts)
              rowsApplied += upserts.length
              if (table === 'inventory_adjustments') {
                for (const row of upserts) {
                  const pid = row['product_id'] as string; if (pid) adjPids.push(pid)
                }
              }
            }

            // Apply hard deletes (rare — most deletes are soft via deleted_at)
            const deletes = tablePayload.deletes
            if (Array.isArray(deletes) && deletes.length > 0) {
              const pkCol = table === 'settings' ? 'key' : 'id'
              const db = getServerDb()
              const placeholders = deletes.map(() => '?').join(', ')
              try {
                db.prepare(`DELETE FROM ${table} WHERE ${pkCol} IN (${placeholders})`).run(...deletes)
                rowsApplied += deletes.length
              } catch (err) {
                console.warn(`[embedded-server v2] delete failed for ${table}:`, (err as Error).message)
              }
            }
          }

          if (adjPids.length > 0) recomputeServerInventory([...new Set(adjPids)])

          send(res, 200, {
            ok: true,
            ackedSeq: body.maxSeq,
            rowsApplied,
            serverTime: new Date().toISOString(),
          })
          return
        }

        if (method === 'POST' && url === '/sync/v2/pull') {
          const body = await parseBody(req) as { terminalId?: string; since?: number }
          if (!body.terminalId) { send(res, 400, { error: '`terminalId` is required' }); return }
          if (typeof body.since !== 'number') { send(res, 400, { error: '`since` must be a number' }); return }

          const { records, maxServerSeq } = getServerV2Changes(body.since)
          send(res, 200, { ok: true, records, maxServerSeq, serverTime: new Date().toISOString() })
          return
        }
      }
      send(res, 404, { error: 'Not found' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[embedded-server] handler error:', msg)
      send(res, 500, { error: 'Internal server error' })
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Start the embedded sync + dashboard server. No-op if already running. */
export function startEmbeddedServer(port: number, apiKey: string): Promise<EmbeddedServerStatus> {
  return new Promise((resolve, reject) => {
    if (server) { resolve(getEmbeddedServerStatus()); return }
    server = http.createServer(createHandler(apiKey))
    server.on('error', (err) => { server = null; reject(err) })
    server.listen(port, '0.0.0.0', () => {
      console.log(`[embedded-server] listening on port ${port}`)
      resolve(getEmbeddedServerStatus())
    })
  })
}

/** Stop the embedded server gracefully. */
export function stopEmbeddedServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) { resolve(); return }
    // The server shares getSqlite() — do NOT close that handle here;
    // it is owned by the POS app and must stay open.
    server.close(() => { server = null; resolve() })
  })
}

/** Returns current status without starting/stopping the server. */
export function getEmbeddedServerStatus(): EmbeddedServerStatus {
  const addr = server?.address()
  const port = addr && typeof addr === 'object' ? addr.port : 3030
  return { running: server !== null, port, ip: getLanIp() }
}
