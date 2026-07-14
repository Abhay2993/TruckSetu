/**
 * Ops/admin console — the humans behind the platform.
 *
 * One self-contained HTML page served by this API (no separate deploy) that
 * watches what the app produces: live SOS alerts, open disputes, KYC state,
 * fraud alerts and the WhatsApp outbox. Guarded by OPS_KEY (env; dev default
 * below) — a shared secret, deliberately simpler than user JWTs, because
 * this runs on an internal desk, not the public app.
 */

import { Request } from 'express';

export const OPS_KEY = process.env.OPS_KEY ?? 'trucksetu-ops';

export function opsAuthorized(req: Request): boolean {
  return req.headers['x-ops-key'] === OPS_KEY || req.query.key === OPS_KEY;
}

export const OPS_CONSOLE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TruckSetu Ops</title>
<style>
  :root { --navy:#0F2A5C; --saffron:#F5820D; --ground:#F4F6FA; --surface:#fff; --border:#E2E7F0;
          --text:#16223A; --muted:#5B6A85; --danger:#C62828; --ok:#1E8E3E; --warn:#B26A00; }
  * { box-sizing: border-box; }
  body { margin:0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: var(--ground); color: var(--text); }
  header { background: var(--navy); color:#fff; padding: 14px 22px; display:flex; align-items:center; gap:12px; }
  header h1 { font-size: 17px; margin:0; } header h1 b { color: var(--saffron); }
  header .tag { font-size: 12px; opacity:.75; margin-left:auto; }
  main { max-width: 1100px; margin: 0 auto; padding: 18px 22px 60px; display:grid; gap:18px;
         grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); }
  section { background: var(--surface); border:1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
  h2 { font-size: 13px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin: 0 0 10px; display:flex; gap:8px; align-items:center;}
  h2 .count { background: var(--danger); color:#fff; border-radius: 999px; font-size: 11px; padding: 1px 8px; }
  h2 .count.zero { background: var(--ok); }
  .row { border-top: 1px solid var(--border); padding: 8px 0; font-size: 13.5px; display:flex; gap:10px; align-items:center; }
  .row .grow { flex:1; } .row .sub { color: var(--muted); font-size: 12px; }
  .pill { font-size: 11px; font-weight: 700; border-radius: 999px; padding: 2px 8px; }
  .pill.red { background:#FDE7E7; color: var(--danger);} .pill.amber { background:#FFF3DF; color: var(--warn);} .pill.green { background:#E3F4E8; color: var(--ok);}
  button { border: 1px solid var(--border); background: var(--surface); border-radius: 8px; padding: 5px 10px; font-size: 12px; font-weight: 700; cursor: pointer; }
  button:hover { border-color: var(--saffron); color: var(--saffron); }
  .empty { color: var(--muted); font-size: 13px; padding: 10px 0; font-style: italic; }
</style>
</head>
<body>
<header><h1>Truck<b>Setu</b> Ops Console</h1><span class="tag" id="meta">loading…</span></header>
<main id="main"></main>
<script>
const KEY = new URLSearchParams(location.search).get('key') || '';
async function api(path, opts) {
  const r = await fetch(path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY), opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
function esc(s){const d=document.createElement('div');d.textContent=String(s??'');return d.innerHTML;}
function ago(t){const m=Math.round((Date.now()-t)/60000);return m<1?'now':m<60?m+'m ago':Math.round(m/60)+'h ago';}
async function act(path){ try { await api(path, {method:'POST'}); } catch(e){ alert(e.message); } render(); }
async function render(){
  let d;
  try { d = await api('/v1/ops/summary'); } catch(e){ document.getElementById('main').innerHTML = '<section><div class="empty">'+esc(e.message)+'</div></section>'; return; }
  document.getElementById('meta').textContent = d.sseClients + ' live app(s) · ' + d.userCount + ' users · refreshed ' + new Date().toLocaleTimeString();
  const sec = (title, count, rows) =>
    '<section><h2>' + title + ' <span class="count' + (count? '':' zero') + '">' + count + '</span></h2>' + (rows || '<div class="empty">Nothing to act on.</div>') + '</section>';
  document.getElementById('main').innerHTML =
    sec('🚨 SOS — live', d.sos.length, d.sos.map(a =>
      '<div class="row"><div class="grow"><b>'+esc(a.phone)+'</b><div class="sub">'+ (a.latitude? a.latitude.toFixed(3)+', '+a.longitude.toFixed(3) : 'no fix') +' · '+ago(a.at)+'</div></div>'+
      '<button onclick="act(\\'/v1/ops/sos/'+a.id+'/resolve\\')">Mark safe</button></div>').join('')) +
    sec('⚖️ Disputes — open', d.disputes.length, d.disputes.map(x =>
      '<div class="row"><div class="grow"><b>'+esc(x.reason.replace('_',' '))+'</b> · '+esc(x.shipmentId)+'<div class="sub">'+esc(x.detail||'no detail')+' · by '+esc(x.raisedByRole)+' · '+ago(x.at)+'</div></div>'+
      '<button onclick="act(\\'/v1/ops/disputes/'+x.id+'/resolve?resolution=released\\')">Release</button>'+
      '<button onclick="act(\\'/v1/ops/disputes/'+x.id+'/resolve?resolution=refunded\\')">Refund</button></div>').join('')) +
    sec('🕵️ Fraud alerts', d.fraud.length, d.fraud.map(f =>
      '<div class="row"><span class="pill red">'+esc(f.kind.replace('_',' '))+'</span><div class="grow">'+esc(f.detail)+'<div class="sub">'+ago(f.at)+'</div></div></div>').join('')) +
    sec('🪪 KYC', d.kycPending.length, d.kycPending.map(u =>
      '<div class="row"><div class="grow"><b>'+esc(u.phone)+'</b><div class="sub">'+esc(u.name||'unnamed')+' · '+esc(u.role||'no role')+'</div></div>'+
      '<button onclick="act(\\'/v1/ops/kyc/'+u.id+'/verify\\')">Verify</button></div>').join('')) +
    sec('💬 WhatsApp outbox', d.whatsapp.length, d.whatsapp.map(w =>
      '<div class="row"><span class="pill '+(w.mode==='cloud-api'?'green':'amber')+'">'+esc(w.mode)+'</span><div class="grow">'+esc(w.text.slice(0,90))+'<div class="sub">→ '+esc(w.to)+' · '+ago(w.at)+'</div></div></div>').join(''));
}
render();
setInterval(render, 10000);
</script>
</body>
</html>`;
