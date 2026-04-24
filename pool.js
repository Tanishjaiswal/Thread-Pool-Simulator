const PRIORITY_MAP = { CRITICAL: 4, HIGH: 3, NORMAL: 2, LOW: 1 };
const PRIORITY_NAMES = { 4: 'CRITICAL', 3: 'HIGH', 2: 'NORMAL', 1: 'LOW' };
const MAX_QUEUE = 30;
const TICK_MS   = 80;

class ThreadPoolEngine {
  constructor() {
    this.workers    = [];
    this.queue      = [];
    this.completed  = 0;
    this.rejected   = 0;
    this.taskSeq    = 0;
    this.paused     = false;
    this.tickTimer  = null;
    this.startTime  = Date.now();

    this._listeners = {};
  }

  // ── Event bus ──────────────────────────────────────────
  on(event, fn) {
    if (!this._listeners[event]) this._listeners[event] = [];
    this._listeners[event].push(fn);
  }
  emit(event, data) {
    (this._listeners[event] || []).forEach(fn => fn(data));
  }

  // ── Initialisation ─────────────────────────────────────
  start(coreSize) {
    this._initWorkers(coreSize);
    this.tickTimer = setInterval(() => this._tick(), TICK_MS);
    this.emit('log', { type: 'info', msg: `Pool started with ${coreSize} worker threads.` });
  }

  _initWorkers(n) {
    this.workers = [];
    for (let i = 0; i < n; i++) this.workers.push(this._makeWorker(i + 1));
    this.emit('workersChanged', this.workers);
  }

  _makeWorker(id) {
    return { id, state: 'idle', task: null, progress: 0, elapsed: 0, duration: 0 };
  }

  // ── Task submission ────────────────────────────────────
  submit(priorityName, count = 1) {
    if (this.paused) {
      for (let i = 0; i < count; i++) {
        this.rejected++;
        this.emit('log', { type: 'warn', msg: `Task rejected — pool is paused.` });
      }
      this.emit('metricsChanged', this._metrics());
      return;
    }
    for (let i = 0; i < count; i++) {
      if (this.queue.length >= MAX_QUEUE) {
        this.rejected++;
        this.emit('log', { type: 'warn', msg: `Queue full (${MAX_QUEUE}) — task rejected.` });
        continue;
      }
      const id   = ++this.taskSeq;
      const pval = PRIORITY_MAP[priorityName] || 2;
      const task = { id, name: `${priorityName[0].toLowerCase()}-${id}`, priority: pval, priorityName, seq: id };
      this.queue.push(task);
      this.emit('log', { type: 'submit', msg: `Submitted ${task.name} [${priorityName}]` });
    }
    this._sortQueue();
    this.emit('queueChanged', this.queue);
    this.emit('metricsChanged', this._metrics());
  }

  burst() {
    const n = parseInt(document.getElementById('burst-size').value);
    const pris = ['CRITICAL', 'HIGH', 'NORMAL', 'NORMAL', 'LOW'];
    for (let i = 0; i < n; i++) {
      const p = pris[Math.floor(Math.random() * pris.length)];
      this.submit(p, 1);
    }
    this.emit('log', { type: 'scale', msg: `Burst: ${n} tasks submitted.` });
  }

  // ── Scaling ────────────────────────────────────────────
  setSize(n) {
    const old = this.workers.length;
    if (n > old) {
      const add = n - old;
      for (let i = 0; i < add; i++) this.workers.push(this._makeWorker(old + i + 1));
      this.emit('log', { type: 'scale', msg: `Scale-UP: +${add} threads → pool size ${this.workers.length}` });
    } else if (n < old) {
      let removed = 0;
      for (let i = this.workers.length - 1; i >= 0 && this.workers.length > n; i--) {
        if (this.workers[i].state === 'idle') {
          this.workers.splice(i, 1);
          removed++;
        }
      }
      if (removed) this.emit('log', { type: 'scale', msg: `Scale-DOWN: removed ${removed} idle threads → pool size ${this.workers.length}` });
    }
    this.emit('workersChanged', this.workers);
    this.emit('metricsChanged', this._metrics());
  }

  // ── Control ────────────────────────────────────────────
  togglePause() {
    this.paused = !this.paused;
    this.emit('stateChanged', this.paused ? 'PAUSED' : 'RUNNING');
    this.emit('log', { type: this.paused ? 'warn' : 'scale', msg: this.paused ? 'Pool PAUSED.' : 'Pool RESUMED.' });
  }

  reset() {
    this.queue     = [];
    this.completed = 0;
    this.rejected  = 0;
    this.taskSeq   = 0;
    this.paused    = false;
    this.workers.forEach(w => { w.state = 'idle'; w.task = null; w.progress = 0; w.elapsed = 0; });
    this.emit('stateChanged', 'RUNNING');
    this.emit('workersChanged', this.workers);
    this.emit('queueChanged', this.queue);
    this.emit('metricsChanged', this._metrics());
    this.emit('log', { type: 'scale', msg: '--- Pool reset ---' });
  }

  runScenario() {
    this.emit('log', { type: 'scale', msg: '--- Scenario: priority storm ---' });
    const steps = [
      () => { for (let i = 0; i < 5; i++) this.submit('LOW'); },
      () => { for (let i = 0; i < 4; i++) this.submit('NORMAL'); },
      () => { for (let i = 0; i < 4; i++) this.submit('LOW'); },
      () => { for (let i = 0; i < 3; i++) this.submit('HIGH'); },
      () => { this.submit('CRITICAL'); this.submit('CRITICAL'); },
      () => { for (let i = 0; i < 3; i++) this.submit('NORMAL'); },
      () => { this.emit('log', { type: 'info', msg: 'Scenario complete — watching drain.' }); }
    ];
    steps.forEach((fn, i) => setTimeout(fn, i * 600));
  }

  // ── Core tick ──────────────────────────────────────────
  _tick() {
    if (this.paused) return;
    const dur = parseInt(document.getElementById('task-dur').value);
    let changed = false;

    // Progress busy workers
    this.workers.forEach(w => {
      if (w.state !== 'busy') return;
      w.elapsed += TICK_MS;
      w.progress = Math.min(100, (w.elapsed / w.duration) * 100);
      if (w.elapsed >= w.duration) {
        this.completed++;
        this.emit('log', { type: 'done', msg: `T-${w.id} finished ${w.task.name}` });
        w.state = 'idle'; w.task = null; w.progress = 0; w.elapsed = 0;
        changed = true;
      }
    });

    // Assign queued tasks to idle workers
    const sorted = [...this.queue].sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    for (const w of this.workers) {
      if (w.state !== 'idle' || sorted.length === 0) continue;
      const task = sorted.shift();
      const qi = this.queue.findIndex(t => t.id === task.id);
      if (qi >= 0) this.queue.splice(qi, 1);
      w.state    = 'busy';
      w.task     = task;
      w.progress = 0;
      w.elapsed  = 0;
      w.duration = dur + (Math.random() * dur * 0.3 | 0) - (dur * 0.15 | 0);
      this.emit('log', { type: 'exec', msg: `T-${w.id} → ${task.name} [${task.priorityName}]` });
      changed = true;
    }

    if (changed) {
      this.emit('queueChanged', this.queue);
    }
    this.emit('workersChanged', this.workers);
    this.emit('metricsChanged', this._metrics());
  }

  _sortQueue() {
    this.queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
  }

  _metrics() {
    const active = this.workers.filter(w => w.state === 'busy').length;
    const util   = this.workers.length ? active / this.workers.length : 0;
    return {
      active,
      queued:    this.queue.length,
      completed: this.completed,
      rejected:  this.rejected,
      util,
      poolSize:  this.workers.length
    };
  }

  getUptime() {
    return Date.now() - this.startTime;
  }
}

const pool = new ThreadPoolEngine();
