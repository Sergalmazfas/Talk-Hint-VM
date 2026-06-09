// ---------------------------------------------------------------------------
// Human-readable DB save-health status page.
//
// /api/health already exposes everything on-call needs (per-table write
// success/failure counters under `writes`, the alerter's per-table state under
// `writeHealthAlerts`, and channel readiness under `alertChannels`) — but only
// as raw JSON. This page renders that same payload as a color-coded table so a
// non-technical on-call person can confirm at a glance whether database saves
// are healthy, without parsing JSON or waiting for the next SMS/email.
//
// The HTML is fully self-contained (no build step, no external assets) and
// fetches /api/health client-side, so it works identically in dev and prod and
// always reflects the live endpoint. It auto-refreshes on a short interval.
// ---------------------------------------------------------------------------

export const HEALTH_STATUS_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Database Save Health</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f3f4f6;
      color: #111827;
      padding: 24px;
      line-height: 1.45;
    }
    .wrap { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .sub { color: #6b7280; font-size: 14px; margin-bottom: 20px; }
    .banner {
      border-radius: 10px;
      padding: 16px 20px;
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 20px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .banner.ok { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
    .banner.bad { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
    .banner.unknown { background: #fef9c3; color: #854d0e; border: 1px solid #fde047; }
    .dot { width: 14px; height: 14px; border-radius: 50%; flex: none; }
    .dot.ok { background: #16a34a; }
    .dot.bad { background: #dc2626; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
    th, td { text-align: left; padding: 12px 14px; font-size: 14px; border-bottom: 1px solid #f0f0f0; }
    th { background: #f9fafb; color: #374151; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
    tr:last-child td { border-bottom: none; }
    .pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 600; }
    .pill.ok { background: #dcfce7; color: #166534; }
    .pill.bad { background: #fee2e2; color: #991b1b; }
    .num { font-variant-numeric: tabular-nums; }
    .fail { color: #b91c1c; font-weight: 600; }
    .muted { color: #9ca3af; }
    .section-title { font-size: 16px; font-weight: 600; margin: 28px 0 10px; }
    .channels { display: flex; gap: 12px; flex-wrap: wrap; }
    .chan { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 16px; font-size: 14px; min-width: 200px; }
    .chan .name { font-weight: 600; margin-bottom: 4px; }
    .err { background: #fff; border: 1px solid #fca5a5; border-radius: 8px; padding: 8px 10px; margin-top: 6px; font-size: 12px; color: #7f1d1d; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
    .footer { margin-top: 22px; color: #9ca3af; font-size: 13px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
    button { font: inherit; padding: 7px 14px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; cursor: pointer; }
    button:hover { background: #f9fafb; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Database Save Health</h1>
    <div class="sub">Are we successfully saving data to the database? This page checks itself every 30 seconds.</div>

    <div id="banner" class="banner unknown"><span class="dot"></span><span id="banner-text">Loading…</span></div>

    <div class="section-title">Per-table status</div>
    <table>
      <thead>
        <tr>
          <th>Table</th>
          <th>Status</th>
          <th>Saved OK</th>
          <th>Failed</th>
          <th>Last alert</th>
          <th>Last recovery</th>
        </tr>
      </thead>
      <tbody id="rows">
        <tr><td colspan="6" class="muted">Loading…</td></tr>
      </tbody>
    </table>

    <div id="errors"></div>

    <div class="section-title">Alert channels</div>
    <div id="channels" class="channels"><div class="muted">Loading…</div></div>

    <div class="footer">
      <span id="updated">—</span>
      <button id="refresh" data-testid="button-refresh">Refresh now</button>
    </div>
  </div>

  <script>
    function fmtTime(iso) {
      if (!iso) return '<span class="muted">never</span>';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '<span class="muted">—</span>';
      const diff = Date.now() - d.getTime();
      const mins = Math.round(diff / 60000);
      let rel;
      if (mins < 1) rel = 'just now';
      else if (mins < 60) rel = mins + ' min ago';
      else if (mins < 1440) rel = Math.round(mins / 60) + ' h ago';
      else rel = Math.round(mins / 1440) + ' d ago';
      return d.toLocaleString() + ' <span class="muted">(' + rel + ')</span>';
    }

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function render(data) {
      const writes = data.writes || {};
      const alerts = data.writeHealthAlerts || {};
      const tables = Array.from(new Set([...Object.keys(writes), ...Object.keys(alerts)])).sort();

      let anyAlerting = false;
      const rowsEl = document.getElementById('rows');
      const errorsEl = document.getElementById('errors');
      rowsEl.innerHTML = '';
      errorsEl.innerHTML = '';

      if (tables.length === 0) {
        rowsEl.innerHTML = '<tr><td colspan="6" class="muted">No tables have recorded any saves yet.</td></tr>';
      }

      for (const t of tables) {
        const w = writes[t] || { writeSuccesses: 0, writeFailures: 0 };
        const a = alerts[t] || {};
        const alerting = !!a.alerting;
        if (alerting) anyAlerting = true;

        const statusPill = alerting
          ? '<span class="pill bad">⚠ Alerting</span>'
          : '<span class="pill ok">✓ Healthy</span>';

        const tr = document.createElement('tr');
        tr.setAttribute('data-testid', 'row-table-' + t);
        tr.innerHTML =
          '<td><strong>' + esc(t) + '</strong></td>' +
          '<td data-testid="status-' + esc(t) + '">' + statusPill + '</td>' +
          '<td class="num">' + (w.writeSuccesses || 0) + '</td>' +
          '<td class="num ' + ((w.writeFailures || 0) > 0 ? 'fail' : 'muted') + '">' + (w.writeFailures || 0) + '</td>' +
          '<td>' + fmtTime(a.lastAlertAt) + '</td>' +
          '<td>' + fmtTime(a.lastRecoveryAt) + '</td>';
        rowsEl.appendChild(tr);

        if (w.lastError && (w.writeFailures || 0) > 0) {
          const e = w.lastError;
          const div = document.createElement('div');
          div.className = 'err';
          div.textContent = 'Last error on "' + t + '" (' + (e.operation || '?') + ', ' +
            (e.at || '?') + ')' + (e.isSchemaDrift ? ' [SCHEMA DRIFT]' : '') + ': ' + (e.message || '');
          errorsEl.appendChild(div);
        }
      }

      // Top banner — overall verdict.
      const banner = document.getElementById('banner');
      const bannerText = document.getElementById('banner-text');
      const dot = banner.querySelector('.dot');
      banner.className = 'banner ' + (anyAlerting ? 'bad' : 'ok');
      dot.className = 'dot ' + (anyAlerting ? 'bad' : 'ok');
      bannerText.textContent = anyAlerting
        ? 'Some database saves are FAILING — see the highlighted tables below.'
        : 'All database saves are healthy.';

      // Alert channels.
      const ch = data.alertChannels || {};
      const channelsEl = document.getElementById('channels');
      channelsEl.innerHTML = '';
      function chanCard(name, c) {
        const ready = c && c.ready;
        const configured = c && c.configured;
        const state = ready ? '<span class="pill ok">Ready</span>'
          : configured ? '<span class="pill bad">Not ready</span>'
          : '<span class="pill" style="background:#e5e7eb;color:#6b7280">Off</span>';
        const missing = (c && c.missing && c.missing.length)
          ? '<div class="muted" style="margin-top:6px;font-size:12px">Missing: ' + esc(c.missing.join(', ')) + '</div>'
          : '';
        return '<div class="chan"><div class="name">' + name + '</div>' + state + missing + '</div>';
      }
      if (ch.disabled) {
        channelsEl.innerHTML = '<div class="chan"><div class="name">Alerting disabled</div>' +
          '<span class="pill bad">Off</span><div class="muted" style="margin-top:6px;font-size:12px">DISABLE_WRITE_HEALTH_ALERTS=true</div></div>';
      } else {
        channelsEl.innerHTML = chanCard('SMS', ch.sms) + chanCard('Email', ch.email);
        if (ch.anyReady === false) {
          channelsEl.innerHTML += '<div class="chan" style="border-color:#fca5a5"><div class="name fail">No working channel</div>' +
            '<div class="muted" style="font-size:12px">Alerts will only appear in server logs.</div></div>';
        }
      }

      document.getElementById('updated').textContent =
        'Last checked: ' + new Date().toLocaleTimeString() +
        (data.timestamp ? ' · server time ' + new Date(data.timestamp).toLocaleTimeString() : '');
    }

    async function load() {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const data = await res.json();
        render(data);
      } catch (err) {
        const banner = document.getElementById('banner');
        const bannerText = document.getElementById('banner-text');
        banner.className = 'banner unknown';
        bannerText.textContent = 'Could not reach the health endpoint: ' + (err && err.message ? err.message : err);
      }
    }

    document.getElementById('refresh').addEventListener('click', load);
    load();
    setInterval(load, 30000);
  </script>
</body>
</html>`;
