function updateClock() {
  const ms = pool.getUptime();
  const h  = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m  = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s  = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  document.getElementById('clock').textContent = `${h}:${m}:${s}`;
}
setInterval(updateClock, 1000);

// ── Workers ────────────────────────────────────────────
pool.on('workersChanged', workers => {
  const grid = document.getElementById('workers-grid');
  const active = workers.filter(w => w.state === 'busy').length;

  document.getElementById('worker-count').textContent =
    `${active} / ${workers.length} active`;

  // Sync DOM to worker list
  workers.forEach(w => {
    let el = document.getElementById('worker-' + w.id);
    if (!el) {
      el = document.createElement('div');
      el.id = 'worker-' + w.id;
      el.className = 'worker idle';
      el.innerHTML = `
        <div class="worker-header">
          <span class="worker-id">T-${w.id}</span>
          <span class="worker-state">IDLE</span>
        </div>
        <div class="worker-task"></div>
        <div class="worker-track"><div class="worker-bar"></div></div>
      `;
      grid.appendChild(el);
    }

    // Update state
    el.className = 'worker ' + w.state;
    el.querySelector('.worker-state').textContent = w.state.toUpperCase();
    el.querySelector('.worker-task').textContent  = w.task ? w.task.name : '';
    el.querySelector('.worker-bar').style.width   = Math.round(w.progress) + '%';
  });

  // Remove excess DOM nodes
  const ids = new Set(workers.map(w => 'worker-' + w.id));
  Array.from(grid.children).forEach(child => {
    if (!ids.has(child.id)) grid.removeChild(child);
  });
});

// ── Queue ──────────────────────────────────────────────
pool.on('queueChanged', queue => {
  const flow = document.getElementById('queue-flow');
  const cap  = document.getElementById('cap-bar');
  const capT = document.getElementById('cap-text');
  const MAX  = 30;
  const pct  = queue.length / MAX;

  capT.textContent = `${queue.length} / ${MAX}`;
  cap.style.width  = (pct * 100).toFixed(1) + '%';
  cap.className = 'cap-bar-fill' + (pct > 0.85 ? ' danger' : pct > 0.6 ? ' warn' : '');

  if (queue.length === 0) {
    flow.innerHTML = '<span class="empty-queue">no pending tasks</span>';
    return;
  }
  // Render sorted queue (highest priority first)
  const sorted = [...queue].sort((a, b) => b.priority - a.priority || a.seq - b.seq);
  flow.innerHTML = sorted.map(t =>
    `<span class="task-tag tag-${t.priorityName}">${t.name}</span>`
  ).join('');
});

// ── Metrics ────────────────────────────────────────────
pool.on('metricsChanged', m => {
  document.getElementById('m-active').textContent  = m.active;
  document.getElementById('m-queue').textContent   = m.queued;
  document.getElementById('m-done').textContent    = m.completed;
  document.getElementById('m-reject').textContent  = m.rejected;

  const pct = Math.round(m.util * 100);
  document.getElementById('util-pct').textContent = pct + '%';
  const bar = document.getElementById('util-bar');
  bar.style.width  = pct + '%';
  bar.className = 'bar-fill' + (pct > 85 ? ' danger' : pct > 60 ? ' warn' : '');
});

// ── State ──────────────────────────────────────────────
pool.on('stateChanged', state => {
  const dot   = document.getElementById('status-dot');
  const text  = document.getElementById('status-text');
  const pbtn  = document.getElementById('pause-btn');
  dot.className  = 'status-dot ' + (state === 'PAUSED' ? 'paused' : '');
  text.textContent = state;
  pbtn.innerHTML = state === 'PAUSED'
    ? `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,2 10,6 2,10" fill="currentColor"/></svg> Resume`
    : `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="3" height="8" fill="currentColor"/><rect x="7" y="2" width="3" height="8" fill="currentColor"/></svg> Pause`;
});

// ── Log ────────────────────────────────────────────────
pool.on('log', ({ type, msg }) => {
  const box  = document.getElementById('log-scroll');
  const now  = new Date();
  const time = now.toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const ms   = String(now.getMilliseconds()).padStart(3, '0');

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.innerHTML = `<span class="log-time">${time}.${ms}</span><span class="log-msg">${msg}</span>`;
  box.prepend(entry);

  // Keep log bounded
  while (box.children.length > 200) box.removeChild(box.lastChild);
});

function clearLog() {
  document.getElementById('log-scroll').innerHTML = '';
}

// ── Slider bindings ────────────────────────────────────
document.getElementById('core-size').addEventListener('input', function () {
  document.getElementById('core-out').textContent = this.value;
  pool.setSize(+this.value);
});

document.getElementById('task-dur').addEventListener('input', function () {
  document.getElementById('dur-val').textContent = this.value + 'ms';
});

document.getElementById('burst-size').addEventListener('input', function () {
  document.getElementById('burst-val').textContent = this.value;
});

// ── Boot ───────────────────────────────────────────────
const initialCoreSize = +document.getElementById('core-size').value;
pool.start(initialCoreSize);
