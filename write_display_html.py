path = r"/sessions/intelligent-admiring-hypatia/mnt/POS/src/main/display/customer-display.ts"
with open(path, 'r', encoding='utf-8') as f:
    src = f.read()

# ── 1. Add POST /send-email endpoint to the HTTP server ──────────────────────
old_events = """      if (pathname === '/events') {
        handleSseRequest(req, res)
        return
      }

      if (pathname === '/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(lastData))
        return
      }

      // Default: self-contained display page
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(getDisplayHtml())"""

new_events = """      if (pathname === '/events') {
        handleSseRequest(req, res)
        return
      }

      if (pathname === '/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(lastData))
        return
      }

      // Customer email submission from the network display page
      if (pathname === '/send-email' && req.method === 'POST') {
        handleEmailPost(req, res)
        return
      }

      // Default: self-contained display page
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(getDisplayHtml())"""

if old_events not in src:
    print("ERROR: events block not found")
    exit(1)
src = src.replace(old_events, new_events, 1)

# ── 2. Add handleEmailPost function before handleSseRequest ──────────────────
old_sse = "function handleSseRequest(req: http.IncomingMessage, res: http.ServerResponse): void {"

new_sse = r"""function handleEmailPost(req: http.IncomingMessage, res: http.ServerResponse): void {
  let body = ''
  req.on('data', (chunk) => { body += chunk.toString() })
  req.on('end', async () => {
    try {
      const { to, type } = JSON.parse(body) as { to: string; type: 'receipt' | 'invoice' }
      if (!to || !lastData.completedReceiptHtml || !lastData.orderNumber) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: false, error: 'No completed order available' }))
        return
      }
      // Import email service dynamically to avoid circular dep issues
      const { sendReceiptEmail, sendInvoiceEmail } = await import('./email-bridge')
      const result = type === 'invoice'
        ? await sendInvoiceEmail(to, lastData.completedReceiptHtml, lastData.orderNumber)
        : await sendReceiptEmail(to, lastData.completedReceiptHtml, lastData.orderNumber)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(result))
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: false, error: String(err) }))
    }
  })
}

function handleSseRequest(req: http.IncomingMessage, res: http.ServerResponse): void {"""

if "function handleSseRequest" not in src:
    print("ERROR: handleSseRequest not found")
    exit(1)
src = src.replace("function handleSseRequest(req: http.IncomingMessage, res: http.ServerResponse): void {", new_sse, 1)

# ── 3. Replace getDisplayHtml() with updated version ─────────────────────────
# Find the start and end of getDisplayHtml
start_marker = "// ─── Self-contained network display HTML ─────────────────────────────────────\n\n/** Returns a single-file HTML page that connects to /events and renders the display. */\nfunction getDisplayHtml(): string {"
end_marker = "\n}\n"

start_idx = src.find(start_marker)
if start_idx == -1:
    print("ERROR: getDisplayHtml start not found")
    exit(1)

# Find the closing brace - it's the last closing brace of the function
# Count braces from after "function getDisplayHtml(): string {"
fn_start = src.find("{", start_idx + len(start_marker) - 1)
depth = 0
pos = fn_start
while pos < len(src):
    if src[pos] == '{':
        depth += 1
    elif src[pos] == '}':
        depth -= 1
        if depth == 0:
            fn_end = pos
            break
    pos += 1

old_fn = src[start_idx:fn_end+1]

new_fn = r"""// ─── Self-contained network display HTML ─────────────────────────────────────

/** Returns a single-file HTML page that connects to /events and renders the display. */
function getDisplayHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Customer Display</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0f172a; --surface: #1e293b; --border: #334155;
    --accent: #3b82f6; --accent-light: #60a5fa; --green: #10b981;
    --text: #f8fafc; --muted: #94a3b8; --radius: 12px;
  }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; height: 100dvh; display: flex; flex-direction: column; overflow: hidden; user-select: none; }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 16px 28px; background: var(--surface); border-bottom: 1px solid var(--border); flex-shrink: 0; gap: 16px; }
  .header-logo-img { height: 44px; max-width: 160px; object-fit: contain; }
  .header-name { font-size: 22px; font-weight: 800; color: var(--accent-light); letter-spacing: -0.5px; }
  .header-time { font-size: 16px; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 32px 48px; overflow: hidden; }
  .idle-icon { font-size: 72px; margin-bottom: 20px; opacity: 0.3; }
  .idle-title { font-size: 36px; font-weight: 700; color: var(--muted); text-align: center; }
  .idle-sub { font-size: 18px; color: var(--border); margin-top: 8px; text-align: center; }
  .shopping-layout { width: 100%; max-width: 900px; display: flex; flex-direction: column; gap: 20px; height: 100%; }
  .customer-greeting { font-size: 18px; color: var(--accent-light); font-weight: 600; text-align: center; }
  .items-list { flex: 1; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 0; }
  .item-row { display: flex; align-items: center; padding: 12px 20px; gap: 12px; border-bottom: 1px solid var(--border); }
  .item-row:last-child { border-bottom: none; }
  .item-name { flex: 1; font-size: 17px; font-weight: 500; }
  .item-qty { font-size: 15px; color: var(--muted); min-width: 40px; text-align: center; }
  .item-price { font-size: 17px; font-weight: 700; color: var(--accent-light); min-width: 80px; text-align: right; }
  .totals { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px 24px; }
  .totals-row { display: flex; justify-content: space-between; align-items: center; padding: 6px 0; font-size: 16px; color: var(--muted); }
  .totals-row.discount { color: #34d399; }
  .totals-row.total { font-size: 26px; font-weight: 800; color: var(--text); border-top: 1px solid var(--border); padding-top: 14px; margin-top: 6px; }
  .totals-row.alt { font-size: 14px; color: var(--muted); padding-top: 2px; }
  .payment-layout { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 24px; }
  .spinner { width: 64px; height: 64px; border: 4px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
  .payment-amount { font-size: 52px; font-weight: 900; color: var(--accent-light); }
  /* Complete */
  .complete-layout { text-align: center; display: flex; flex-direction: column; align-items: center; gap: 20px; width: 100%; max-width: 480px; }
  .complete-check { width: 80px; height: 80px; border-radius: 50%; background: var(--green); display: flex; align-items: center; justify-content: center; font-size: 42px; animation: pop 0.3s cubic-bezier(0.34,1.56,0.64,1); }
  .complete-title { font-size: 36px; font-weight: 800; color: var(--green); }
  .complete-change { font-size: 26px; color: var(--muted); }
  .complete-change strong { color: var(--text); font-size: 30px; }
  .loyalty-badge { background: #7c3aed22; border: 1px solid #7c3aed66; color: #a78bfa; border-radius: 999px; padding: 8px 20px; font-size: 16px; font-weight: 600; }
  /* Email panel */
  .email-panel { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .email-label { font-size: 18px; font-weight: 600; color: var(--muted); text-align: center; }
  .email-type-toggle { display: flex; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
  .email-type-btn { flex: 1; padding: 10px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; background: var(--surface); color: var(--muted); transition: background 0.15s, color 0.15s; }
  .email-type-btn.active { background: var(--accent); color: #fff; }
  .email-row { display: flex; gap: 10px; }
  .email-input { flex: 1; background: #0f172a; border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; color: var(--text); font-size: 16px; outline: none; }
  .email-input:focus { border-color: var(--accent); }
  .email-send-btn { padding: 12px 20px; background: var(--accent); color: #fff; font-size: 16px; font-weight: 700; border: none; border-radius: 10px; cursor: pointer; white-space: nowrap; }
  .email-send-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .email-feedback { text-align: center; font-size: 14px; min-height: 20px; }
  .email-feedback.ok { color: #34d399; }
  .email-feedback.err { color: #f87171; }
  .email-sent { background: #10b98122; border: 1px solid #10b98144; border-radius: var(--radius); padding: 16px 24px; color: #34d399; font-size: 20px; font-weight: 700; text-align: center; }
  /* Footer */
  .footer { padding: 12px 28px; background: var(--surface); border-top: 1px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .footer-text { font-size: 13px; color: var(--border); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
</style>
</head>
<body>
<header class="header">
  <div id="header-left" style="display:flex;align-items:center;gap:12px">
    <img id="logo-img" class="header-logo-img" src="" alt="" style="display:none"/>
    <div id="store-name" class="header-name">POS System</div>
  </div>
  <div class="header-time" id="clock"></div>
</header>
<main class="main" id="main-area"></main>
<footer class="footer"><span class="footer-text">Thank you for shopping with us</span></footer>

<script>
(function () {
  'use strict';

  // Clock
  function updateClock() {
    document.getElementById('clock').textContent =
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  updateClock();
  setInterval(updateClock, 1000);

  function fmt(amount, symbol) {
    return (symbol || '$') + Number(amount || 0).toFixed(2);
  }
  function esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Email UI state
  var emailType = 'receipt';
  var emailSent = false;

  function render(data) {
    if (!data) return;

    // Store name + logo
    if (data.storeName) document.getElementById('store-name').textContent = data.storeName;
    if (data.logoBase64) {
      var img = document.getElementById('logo-img');
      img.src = data.logoBase64;
      img.style.display = 'block';
      document.getElementById('store-name').style.display = 'none';
    }

    // Background
    if (data.displayBgColor) document.body.style.backgroundColor = data.displayBgColor;
    if (data.displayBgImage !== undefined) {
      document.body.style.backgroundImage = data.displayBgImage ? 'url(' + data.displayBgImage + ')' : 'none';
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundPosition = 'center';
    }

    var area = document.getElementById('main-area');

    switch (data.state) {
      case 'idle':
        area.innerHTML = '<div class="idle-icon">🛍️</div><div class="idle-title">Welcome!</div><div class="idle-sub">Please place your items on the counter</div>';
        break;

      case 'shopping': {
        var items = data.items || [];
        var sym = data.symbol || '$';
        var itemRows = items.map(function(item) {
          return '<div class="item-row"><div class="item-name">' + esc(item.name) + '</div><div class="item-qty">× ' + item.quantity + '</div><div class="item-price">' + fmt(item.lineTotal, sym) + '</div></div>';
        }).join('');
        var discountRow = (data.discountAmount || 0) > 0 ? '<div class="totals-row discount"><span>Discount</span><span>-' + fmt(data.discountAmount, sym) + '</span></div>' : '';
        var taxRow = (data.tax || 0) > 0 ? '<div class="totals-row"><span>Tax</span><span>' + fmt(data.tax, sym) + '</span></div>' : '';
        var altRow = data.altTotal != null && data.altCurrency ? '<div class="totals-row alt"><span>≈ ' + esc(data.altCurrency) + '</span><span>' + fmt(data.altTotal, data.altSymbol) + '</span></div>' : '';
        var greeting = data.customer ? '<div class="customer-greeting">Welcome back, ' + esc(data.customer) + '! 👋</div>' : '';
        area.innerHTML = '<div class="shopping-layout">' + greeting +
          '<div class="items-list">' + (itemRows || '<div style="padding:24px;text-align:center;color:var(--muted)">No items yet</div>') + '</div>' +
          '<div class="totals"><div class="totals-row"><span>Subtotal</span><span>' + fmt(data.subtotal, sym) + '</span></div>' + discountRow + taxRow +
          '<div class="totals-row total"><span>Total</span><span>' + fmt(data.total, sym) + '</span></div>' + altRow + '</div></div>';
        break;
      }

      case 'payment_processing': {
        var sym2 = data.symbol || '$';
        area.innerHTML = '<div class="payment-layout"><div class="spinner"></div><div style="font-size:32px;font-weight:700">Processing Payment</div><div class="payment-amount">' + fmt(data.total, sym2) + '</div><div style="color:var(--muted);font-size:18px">Please follow the terminal prompts</div></div>';
        break;
      }

      case 'complete': {
        // Reset email state for new order
        emailSent = false;
        emailType = 'receipt';
        var sym3 = data.changeSymbol || '$';
        var changeRow = (data.change || 0) > 0 ? '<div class="complete-change">Change: <strong>' + fmt(data.change, sym3) + '</strong></div>' : '';
        var loyaltyRow = (data.loyaltyEarned || 0) > 0 ? '<div class="loyalty-badge">🎁 +' + data.loyaltyEarned + ' loyalty points earned!</div>' : '';
        var hasReceipt = !!(data.completedReceiptHtml && data.orderNumber);
        var emailSection = hasReceipt ? buildEmailPanel() : '';
        area.innerHTML = '<div class="complete-layout"><div class="complete-check">✓</div><div class="complete-title">Thank You!</div>' + changeRow + loyaltyRow + emailSection + '</div>';
        if (hasReceipt) wireEmailPanel(data);
        break;
      }
    }
  }

  function buildEmailPanel() {
    return '<div class="email-panel" id="email-panel">' +
      '<div class="email-label">Get your receipt by email</div>' +
      '<div class="email-type-toggle">' +
        '<button class="email-type-btn active" id="btn-receipt" onclick="setEmailType(\'receipt\')">Receipt</button>' +
        '<button class="email-type-btn" id="btn-invoice" onclick="setEmailType(\'invoice\')">Invoice</button>' +
      '</div>' +
      '<div class="email-row">' +
        '<input id="email-input" class="email-input" type="email" placeholder="your@email.com" autocomplete="email"/>' +
        '<button id="email-send" class="email-send-btn" onclick="submitEmail()">Send</button>' +
      '</div>' +
      '<div id="email-feedback" class="email-feedback"></div>' +
    '</div>';
  }

  window.setEmailType = function(type) {
    emailType = type;
    var rb = document.getElementById('btn-receipt');
    var ib = document.getElementById('btn-invoice');
    if (!rb || !ib) return;
    rb.classList.toggle('active', type === 'receipt');
    ib.classList.toggle('active', type === 'invoice');
  };

  window.submitEmail = function() {
    var input = document.getElementById('email-input');
    var btn = document.getElementById('email-send');
    var fb = document.getElementById('email-feedback');
    if (!input || !btn || !fb) return;
    var email = input.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fb.textContent = 'Please enter a valid email address';
      fb.className = 'email-feedback err';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Sending…';
    fb.textContent = '';
    fetch('/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: email, type: emailType })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
      if (result.success) {
        var panel = document.getElementById('email-panel');
        if (panel) panel.outerHTML = '<div class="email-sent">✓ Email sent to ' + esc(email) + '</div>';
      } else {
        fb.textContent = result.error || 'Failed to send. Check email settings.';
        fb.className = 'email-feedback err';
        btn.disabled = false;
        btn.textContent = 'Send';
      }
    })
    .catch(function() {
      fb.textContent = 'Network error — please try again';
      fb.className = 'email-feedback err';
      btn.disabled = false;
      btn.textContent = 'Send';
    });
  };

  function wireEmailPanel(data) {
    var input = document.getElementById('email-input');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') window.submitEmail();
      });
    }
  }

  // SSE with reconnect
  var retryDelay = 1000;
  function connect() {
    var es = new EventSource('/events');
    es.onopen = function() { retryDelay = 1000; };
    es.onmessage = function(e) {
      try { render(JSON.parse(e.data)); } catch(err) { /* ignore */ }
    };
    es.onerror = function() {
      es.close();
      setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    };
  }

  fetch('/state').then(function(r){return r.json();}).then(render).catch(function(){}).finally(connect);
}());
</script>
</body>
</html>`;
}"""

# Replace old function
src = src[:start_idx] + new_fn + src[fn_end+1:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(src)
print("Done")
