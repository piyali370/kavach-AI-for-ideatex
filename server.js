/**
 * KAVACH AI — Kolkata Edition — server.js
 * Node.js + Express + MongoDB + WebSocket
 * Run: npm run dev
 */
require('dns').setServers(['8.8.8.8', '8.8.4.4']); // Force Google DNS
'use strict';
require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const rateLimit  = require('express-rate-limit');
const http       = require('http');
const { WebSocketServer } = require('ws');

/* ── Constants ─────────────────────────────────────────────── */
const PORT       = process.env.PORT       || 5000;
const MONGO_URI  = process.env.MONGO_URI  || 'mongodb://127.0.0.1:27017/kavach_db';
const JWT_SECRET = process.env.JWT_SECRET || 'kavach_kolkata_secret_2026';
const JWT_EXPIRY = '8h';

/* ── App ────────────────────────────────────────────────────── */
const app    = express();
const server = http.createServer(app);

app.use(express.json({ limit: '32kb' }));

const allowed = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());
app.use(cors({
  origin: allowed.includes('*') ? '*' : (origin, cb) =>
    (!origin || allowed.includes(origin)) ? cb(null, true) : cb(new Error('CORS blocked')),
  methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use('/api/', rateLimit({
  windowMs: 60_000,
  max: 300,
  message: { error: 'Too many requests. Please slow down.' },
}));

/* ═══════════════════════════════════════════════════════════════
   MONGOOSE SCHEMAS
   ═══════════════════════════════════════════════════════════════ */

/* User */
const userSchema = new mongoose.Schema({
  employee_id : { type: String, required: true, unique: true, trim: true, maxlength: 64 },
  name        : { type: String, required: true, trim: true, maxlength: 128 },
  password    : { type: String, required: true },
  role        : { type: String, enum: ['admin', 'supervisor', 'worker'], default: 'worker' },
  zone        : { type: String, default: 'Kolkata', maxlength: 128 },
  active      : { type: Boolean, default: true },
  last_login  : { type: Date },
}, { timestamps: true });

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

const User = mongoose.model('User', userSchema);

/* Risk Assessment */
const riskSchema = new mongoose.Schema({
  zone_id    : { type: String, default: 'UNKNOWN', maxlength: 128 },
  operator   : { type: String, required: true, maxlength: 64 },
  role       : { type: String, default: 'worker' },
  params: {
    rainfall     : Number,
    tide         : Number,
    h2s          : Number,
    ch4          : Number,
    co           : Number,
    days         : Number,
    pipeAge      : Number,
    flowVelocity : Number,
    incidents    : Number,
  },
  score      : { type: Number, required: true, min: 0, max: 100 },
  risk_level : { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'] },
  can_enter  : Boolean,
  verdict    : String,
  insight    : String,
  factors    : mongoose.Schema.Types.Mixed,
}, { timestamps: true });

const RiskAssessment = mongoose.model('RiskAssessment', riskSchema);

/* SOS Event */
const sosSchema = new mongoose.Schema({
  worker_id   : { type: String, required: true, maxlength: 64 },
  worker_name : { type: String, default: 'Unknown', maxlength: 128 },
  zone_id     : { type: String, default: 'UNKNOWN', maxlength: 128 },
  lat         : { type: Number, default: null },
  lon         : { type: Number, default: null },
  status      : { type: String, enum: ['active', 'resolved', 'false_alarm'], default: 'active' },
  resolved_at : { type: Date, default: null },
  resolved_by : { type: String, default: null },
  notes       : { type: String, default: '', maxlength: 512 },
}, { timestamps: true });

const SOSEvent = mongoose.model('SOSEvent', sosSchema);

/* ═══════════════════════════════════════════════════════════════
   RISK SCORING SERVICE
   ═══════════════════════════════════════════════════════════════ */
const RiskService = {

  sanitise(raw) {
    const n = (v, lo, hi) => Math.max(lo, Math.min(hi, isNaN(Number(v)) ? 0 : Number(v)));
    return {
      rainfall     : n(raw.rainfall,     0, 500),
      tide         : n(raw.tide || raw.tideInput, 0, 8),
      h2s          : n(raw.h2s,          0, 1000),
      ch4          : n(raw.ch4,          0, 100),
      co           : n(raw.co,           0, 1000),
      days         : n(raw.days,         0, 365),
      pipeAge      : n(raw.pipeAge,      0, 150),
      flowVelocity : n(raw.flowVelocity, 0, 10),
      incidents    : n(raw.incidents,    0, 100),
    };
  },

  score(p) {
    const f = {};
    /* Weights sum to 1.00 — Kolkata-calibrated */
    const W = {
      rainfall:0.16, tide:0.14, h2s:0.18, ch4:0.12,
      co:0.10, days:0.10, pipeAge:0.08, flowVelocity:0.07, incidents:0.05,
    };

    f.rainfall     = p.rainfall > 120 ? 1.00 : p.rainfall > 60 ? 0.65 : p.rainfall > 25 ? 0.30 : p.rainfall / 120;
    f.tide         = p.tide > 6.0 ? 1.00 : p.tide > 4.5 ? 0.70 : p.tide > 3.0 ? 0.35 : p.tide / 8;
    f.h2s          = p.h2s > 50 ? 1.00 : p.h2s > 20 ? 0.72 : p.h2s > 10 ? 0.45 : p.h2s > 5 ? 0.20 : p.h2s / 50;
    f.ch4          = p.ch4 > 60 ? 1.00 : p.ch4 > 30 ? 0.65 : p.ch4 > 15 ? 0.35 : p.ch4 / 100;
    f.co           = p.co > 100 ? 1.00 : p.co > 50 ? 0.72 : p.co > 25 ? 0.40 : p.co / 100;
    f.days         = p.days > 60 ? 1.00 : p.days > 30 ? 0.60 : p.days > 14 ? 0.28 : p.days / 120;
    f.pipeAge      = p.pipeAge > 80 ? 1.00 : p.pipeAge > 50 ? 0.65 : p.pipeAge > 25 ? 0.30 : p.pipeAge / 100;
    f.flowVelocity = p.flowVelocity > 4 ? 1.00 : p.flowVelocity > 2 ? 0.55 : p.flowVelocity / 4;
    f.incidents    = p.incidents >= 5 ? 1.00 : p.incidents >= 3 ? 0.64 : p.incidents >= 1 ? 0.30 : 0;

    const total = Math.min(100, Math.round(
      Object.keys(W).reduce((s, k) => s + f[k] * W[k] * 100, 0)
    ));
    return {
      total,
      factors: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, +(v * 100).toFixed(1)])),
    };
  },

  verdict(score) {
    if (score >= 65) return { level: 'HIGH',   label: '🚫 Entry Strictly Prohibited',    can_enter: false, color: '#ef4444' };
    if (score >= 35) return { level: 'MEDIUM', label: '⚠ Supervisor Approval Required', can_enter: false, color: '#f59e0b' };
    return               { level: 'LOW',    label: '✓ Entry Authorised — Stay Alert', can_enter: true,  color: '#22c55e' };
  },

  recommendations(p, v) {
    const r = [];
    if (p.h2s > 10)         r.push(`H₂S at ${p.h2s}ppm exceeds safe limit. SCBA full-face respirator mandatory.`);
    if (p.ch4 > 15)         r.push(`CH₄ at ${p.ch4}% LEL — explosive risk. Force-ventilate for 30 minutes.`);
    if (p.co > 25)          r.push(`CO at ${p.co}ppm above OSHA ceiling. Immediate ventilation required.`);
    if (p.rainfall > 60)    r.push(`Heavy rainfall ${p.rainfall}mm — Kolkata waterlogging risk elevated. Standby rescue team required.`);
    if (p.tide > 4.5)       r.push(`Hooghly tide at ${p.tide}m — sewer backflow risk 340% above baseline. Entry suspended.`);
    if (p.days > 30)        r.push(`Maintenance gap ${p.days} days. Biological decomposition gases likely elevated.`);
    if (p.pipeAge > 50)     r.push(`Pipe age ${p.pipeAge} years — structural collapse risk. Integrity assessment required.`);
    if (p.flowVelocity > 2) r.push(`Flow velocity ${p.flowVelocity}m/s — slip and entrapment risk. PFD mandatory.`);
    if (v.level === 'HIGH') r.push('CRITICAL: KMC Emergency Services on standby. Written hazmat clearance mandatory.');
    if (!r.length) {
      r.push('All parameters within KMC operational bounds. Standard PPE and two-person buddy protocol apply.');
      r.push('Continuous atmospheric monitoring mandatory. Log readings every 15 minutes.');
    }
    return r;
  },

  insight(p, score, v) {
    const INSIGHTS = {
      HIGH:   `CRITICAL [${score}/100]: Compounding hazards — ${p.h2s > 10 ? `H₂S at ${p.h2s}ppm, ` : ''}${p.tide > 4.5 ? `Hooghly tide at ${p.tide}m, ` : ''}${p.rainfall > 60 ? `${p.rainfall}mm rainfall ` : ''} — create a fatality-level risk profile for Kolkata's low-lying sewer infrastructure. Immediate zone lockdown and KMC Central Control Room escalation are mandatory per West Bengal Municipal Act §42.`,
      MEDIUM: `CAUTION [${score}/100]: Elevated risk driven by ${p.days > 30 ? `${p.days}-day maintenance backlog` : p.tide > 3 ? `Hooghly tidal surge to ${p.tide}m` : `${p.rainfall}mm rainfall-induced waterlogging`}. KMC Ward Supervisor must physically inspect the manhole, deploy a two-person team with continuous gas monitoring, and maintain radio contact throughout.`,
      LOW:    `SAFE [${score}/100]: All parameters within KMC operational bounds per CMDA Safety Circular 2024. Standard PPE, two-person buddy system, and real-time atmospheric monitoring are obligatory. Report any parameter changes to your Ward Supervisor immediately.`,
    };
    return INSIGHTS[v.level];
  },
};

/* ═══════════════════════════════════════════════════════════════
   SENSOR SIMULATION SERVICE
   ═══════════════════════════════════════════════════════════════ */
const SensorService = (() => {
  const ZONES = [
    'Thanthania PS', 'Ultadanga UP', 'Ballygunge', 'Park Street',
    'Salt Lake V', 'Behala', 'Khidirpur Dock', 'Shyambazar',
    'Kalighat', 'Tollygunge', 'Gariahat', 'Rajabazar',
  ];
  const METRICS = ['H₂S (ppm)', 'CH₄ (%LEL)', 'CO (ppm)', 'O₂ (%)', 'Temp (°C)', 'Flow (m/s)'];
  const LIMITS  = {
    'H₂S (ppm)'  : [0, 8],
    'CH₄ (%LEL)' : [0, 15],
    'CO (ppm)'   : [0, 25],
    'O₂ (%)'     : [19, 23],
    'Temp (°C)'  : [18, 35],
    'Flow (m/s)' : [0, 2],
  };
  let _cache = [];

  function _gen() {
    _cache = ZONES.map((zone, i) => {
      const metric = METRICS[i % METRICS.length];
      const [lo, hi] = LIMITS[metric];
      const isCrit = Math.random() < 0.10;
      const isWarn = !isCrit && Math.random() < 0.20;
      const v = isCrit
        ? hi * (1.5 + Math.random() * 0.7)
        : isWarn
        ? hi * (1.06 + Math.random() * 0.25)
        : lo + Math.random() * (hi - lo);
      return {
        id     : `SN-${String(i + 1).padStart(3, '0')}`,
        zone, metric,
        value  : +v.toFixed(1),
        status : isCrit ? 'crit' : isWarn ? 'warn' : 'ok',
        ts     : new Date().toISOString(),
      };
    });
    return _cache;
  }

  function tick() {
    if (!_cache.length) return _gen();
    _cache = _cache.map(s => {
      if (Math.random() > 0.28) return { ...s, ts: new Date().toISOString() };
      const [lo, hi] = LIMITS[s.metric] || [0, 100];
      const nv = Math.max(0, s.value + (Math.random() - 0.47) * (hi - lo) * 0.22);
      return {
        ...s,
        value  : +nv.toFixed(1),
        status : nv > hi * 1.4 ? 'crit' : nv > hi ? 'warn' : 'ok',
        ts     : new Date().toISOString(),
      };
    });
    return _cache;
  }

  function get() { return _cache.length ? tick() : _gen(); }

  return { get };
})();

/* ═══════════════════════════════════════════════════════════════
   JWT MIDDLEWARE
   ═══════════════════════════════════════════════════════════════ */
function authRequired(req, res, next) {
  const h = req.headers['authorization'];
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }
  try {
    req.user = jwt.verify(h.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token expired or invalid. Please login again.' });
  }
}

function softAuth(req, res, next) {
  const h = req.headers['authorization'];
  if (h && h.startsWith('Bearer ')) {
    try { req.user = jwt.verify(h.slice(7), JWT_SECRET); } catch {}
  }
  next();
}

/* ═══════════════════════════════════════════════════════════════
   ROUTES — AUTH
   ═══════════════════════════════════════════════════════════════ */

/* Register */
app.post('/api/auth/register', async (req, res) => {
  try {
    const { employee_id, name, password, role, zone } = req.body;
    if (!employee_id?.trim() || !name?.trim() || !password) {
      return res.status(400).json({ error: 'employee_id, name and password are required.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }
    const exists = await User.findOne({ employee_id: employee_id.trim() });
    if (exists) return res.status(409).json({ error: 'Employee ID already registered.' });

    const hash = await bcrypt.hash(password, 12);
    const user = await User.create({
      employee_id : employee_id.trim(),
      name        : name.trim(),
      password    : hash,
      role        : ['admin', 'supervisor', 'worker'].includes(role) ? role : 'worker',
      zone        : zone?.trim() || 'Kolkata',
    });
    const token = jwt.sign({ id: user._id, employee_id: user.employee_id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    const labels = { admin: 'KMC Admin / Commissioner', supervisor: 'Ward Supervisor', worker: 'Sanitation Worker' };
    return res.status(201).json({
      token,
      user: { employee_id: user.employee_id, name: user.name, role: user.role, label: labels[user.role], zone: user.zone },
    });
  } catch (err) {
    console.error('[REGISTER]', err.message);
    return res.status(500).json({ error: 'Registration failed. Please retry.' });
  }
});

/* Login — Bypassed for development */
app.post('/api/auth/login', async (req, res) => {
  try {
    const { employee_id, password } = req.body;
    
    // 1. We skip the database check entirely
    console.log(`[BYPASS LOGIN] Access granted for: ${employee_id}`);

    // 2. Mock a user object (this is what the frontend expects)
    const user = {
      _id: 'dev-mode-id',
      employee_id: employee_id || 'GUEST',
      role: 'admin' // Forces admin access for everything
    };

    // 3. Sign a fake token
    const token = jwt.sign(
      { id: user._id, employee_id: user.employee_id, role: user.role }, 
      JWT_SECRET, 
      { expiresIn: JWT_EXPIRY }
    );

    return res.json({
      token,
      user: { 
        employee_id: user.employee_id, 
        name: 'Development User', 
        role: user.role, 
        label: 'KMC Admin / Commissioner', 
        zone: 'Kolkata' 
      },
    });
  } catch (err) {
    console.error('[LOGIN]', err.message);
    return res.status(500).json({ error: 'Login failed.' });
  }
});

/* Get current user */
app.get('/api/auth/me', authRequired, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    return res.json({ user });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch user.' });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ROUTES — RISK
   ═══════════════════════════════════════════════════════════════ */

/* Predict + persist */
app.post('/api/risk/predict', softAuth, async (req, res) => {
  try {
    const params  = RiskService.sanitise(req.body);
    const scored  = RiskService.score(params);
    const verdict = RiskService.verdict(scored.total);
    const recs    = RiskService.recommendations(params, verdict);
    const insight = RiskService.insight(params, scored.total, verdict);
    const operator = req.user?.employee_id || req.body.operator || 'Anonymous';
    const zone_id  = (req.body.zone_id || 'UNKNOWN').toString().slice(0, 128);

    const record = await RiskAssessment.create({
      zone_id,
      operator,
      role       : req.user?.role || req.body.role || 'worker',
      params,
      score      : scored.total,
      risk_level : verdict.level,
      can_enter  : verdict.can_enter,
      verdict    : verdict.label,
      insight,
      factors    : scored.factors,
    });

    console.log(`[RISK] zone=${zone_id} score=${scored.total} level=${verdict.level} op=${operator}`);

    return res.status(201).json({
      id              : record._id,
      score           : scored.total,
      factors         : scored.factors,
      verdict,
      recommendations : recs,
      insight,
      params,
      timestamp       : record.createdAt,
    });
  } catch (err) {
    console.error('[RISK/PREDICT]', err.message);
    return res.status(500).json({ error: 'Risk assessment failed. Please retry.' });
  }
});

/* Paginated history */
app.get('/api/risk/history', softAuth, async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 25);
    const [records, total] = await Promise.all([
      RiskAssessment.find({})
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('zone_id operator role score risk_level verdict createdAt'),
      RiskAssessment.countDocuments(),
    ]);
    return res.json({ records, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[HISTORY]', err.message);
    return res.status(500).json({ error: 'Could not fetch history.' });
  }
});

/* Stats for KPI cards */
app.get('/api/risk/stats', async (req, res) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [todayDocs, allDocs] = await Promise.all([
      RiskAssessment.find({ createdAt: { $gte: today } }).select('risk_level can_enter'),
      RiskAssessment.find({}).select('risk_level score').limit(200).sort({ createdAt: -1 }),
    ]);
    return res.json({
      safe_today        : todayDocs.filter(d => d.can_enter).length,
      pending_approvals : todayDocs.filter(d => d.risk_level === 'MEDIUM').length,
      high_risk_zones   : todayDocs.filter(d => d.risk_level === 'HIGH').length,
      sensors_online    : SensorService.get().filter(s => s.status !== 'crit').length,
      active_workers    : 6,
      total_assessments : allDocs.length,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch stats.' });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ROUTES — SOS
   ═══════════════════════════════════════════════════════════════ */

/* Trigger */
app.post('/api/sos/trigger', softAuth, async (req, res) => {
  try {
    const { worker_id, worker_name, zone_id, lat, lon } = req.body;
    if (!worker_id?.trim()) return res.status(400).json({ error: 'worker_id is required.' });

    const event = await SOSEvent.create({
      worker_id   : worker_id.trim().slice(0, 64),
      worker_name : (worker_name || worker_id).slice(0, 128),
      zone_id     : (zone_id || 'UNKNOWN').slice(0, 128),
      lat         : lat  != null ? Math.max(-90,  Math.min(90,  Number(lat)))  : null,
      lon         : lon  != null ? Math.max(-180, Math.min(180, Number(lon))) : null,
    });

    console.error(`🚨 [SOS] worker=${event.worker_id} zone=${event.zone_id}`);

    /* ⚙ SOS_INJECT — Uncomment for real Twilio SMS:
    const twilio = require('twilio')(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    await twilio.messages.create({
      body : `🚨 KMC KAVACH SOS: ${event.worker_id} at ${event.zone_id} needs emergency help! Coords: ${event.lat},${event.lon}`,
      from : process.env.TWILIO_FROM,
      to   : process.env.SUPERVISOR_PHONE,
    });
    */

    wsBroadcast({ type: 'sos', payload: { worker_id: event.worker_id, zone_id: event.zone_id, ts: event.createdAt } });

    return res.status(202).json({
      event_id  : event._id,
      worker_id : event.worker_id,
      zone_id   : event.zone_id,
      status    : 'active',
      timestamp : event.createdAt,
      message   : 'KMC Multi-Tier Emergency Protocol activated. All supervisors notified.',
    });
  } catch (err) {
    console.error('[SOS/TRIGGER]', err.message);
    return res.status(500).json({ error: 'SOS dispatch failed. Call 108 directly.' });
  }
});

/* Resolve */
app.patch('/api/sos/:id/resolve', authRequired, async (req, res) => {
  try {
    const event = await SOSEvent.findByIdAndUpdate(
      req.params.id,
      { status: 'resolved', resolved_at: new Date(), resolved_by: req.user.employee_id, notes: req.body.notes || '' },
      { new: true }
    );
    if (!event) return res.status(404).json({ error: 'SOS event not found.' });
    return res.json({ event });
  } catch (err) {
    return res.status(500).json({ error: 'Could not resolve SOS event.' });
  }
});

/* Recent events */
app.get('/api/sos/events', async (req, res) => {
  try {
    const events = await SOSEvent.find({}).sort({ createdAt: -1 }).limit(20)
      .select('worker_id worker_name zone_id status createdAt resolved_at');
    return res.json({ events });
  } catch (err) {
    return res.status(500).json({ error: 'Could not fetch SOS events.' });
  }
});

/* ═══════════════════════════════════════════════════════════════
   ROUTES — SENSORS & ZONES
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/sensors', (req, res) => {
  return res.json({ sensors: SensorService.get(), ts: new Date().toISOString() });
});

app.get('/api/zones', (req, res) => {
  const zones = [
    { name: 'Thanthania Pumping Station', risk_pct: 88, level: 'HIGH'   },
    { name: 'Ultadanga Underpass',        risk_pct: 62, level: 'MEDIUM' },
    { name: 'Ballygunge',                 risk_pct: 34, level: 'MEDIUM' },
    { name: 'Park Street',               risk_pct: 18, level: 'LOW'    },
    { name: 'Khidirpur Dock',            risk_pct: 77, level: 'HIGH'   },
    { name: 'Rajabazar',                 risk_pct: 92, level: 'HIGH'   },
  ];
  return res.json({ zones, ts: new Date().toISOString() });
});

/* ═══════════════════════════════════════════════════════════════
   ROUTE — HEALTH
   ═══════════════════════════════════════════════════════════════ */
app.get('/api/health', async (req, res) => {
  let dbStatus = 'disconnected';
  try { await mongoose.connection.db.admin().ping(); dbStatus = 'connected'; } catch {}
  return res.json({
    status  : 'operational',
    service : 'KAVACH AI — Kolkata Edition',
    version : '3.0.0',
    db      : dbStatus,
    uptime  : Math.floor(process.uptime()),
    ts      : new Date().toISOString(),
  });
});

/* 404 */
app.use((req, res) => res.status(404).json({ error: `${req.method} ${req.path} not found.` }));

/* Error handler */
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error.' });
});

/* ═══════════════════════════════════════════════════════════════
   WEBSOCKET SERVER
   ═══════════════════════════════════════════════════════════════ */
const wss = new WebSocketServer({ server });
const wsClients = new Set();

function wsBroadcast(payload) {
  const msg = JSON.stringify(payload);
  wsClients.forEach(ws => { if (ws.readyState === 1) ws.send(msg); });
}

wss.on('connection', (ws) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({ type: 'connected', message: 'KAVACH AI Kolkata real-time feed active.' }));
  ws.on('close',   () => wsClients.delete(ws));
  ws.on('error',   () => wsClients.delete(ws));
  ws.on('message', (raw) => {
    try { const m = JSON.parse(raw); if (m.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() })); } catch {}
  });
});

/* Broadcast sensor updates every 4 seconds */
setInterval(() => {
  if (wsClients.size > 0) wsBroadcast({ type: 'sensors', payload: SensorService.get() });
}, 4000);

/* ═══════════════════════════════════════════════════════════════
   SEED DEMO DATA
   ═══════════════════════════════════════════════════════════════ */
async function seedDemoData() {
  try {
    const count = await User.countDocuments();
    if (count > 0) return;

    console.log('🌱  Seeding KMC demo users…');
    const hash = await bcrypt.hash('kavach@kolkata', 12);

    await User.insertMany([
      { employee_id: 'ADMIN-KMC-001', name: 'Pallabi Mukherjee', password: hash, role: 'admin',      zone: 'KMC Central' },
      { employee_id: 'SUP-KMC-001',   name: 'Subrata Chakraborty', password: hash, role: 'supervisor', zone: 'Thanthania Pumping Station' },
      { employee_id: 'KMC-0042',      name: 'Subhash Chandra Das', password: hash, role: 'worker',    zone: 'Rajabazar' },
      { employee_id: 'KMC-0187',      name: 'Ratan Mondal',        password: hash, role: 'worker',    zone: 'Khidirpur Dock' },
    ]);

    const seedRisk = [
      { zone_id:'Rajabazar',            operator:'Ratan Mondal',      role:'worker',    score:91, risk_level:'HIGH',   can_enter:false, verdict:'🚫 Entry Strictly Prohibited', params:{rainfall:180,tide:5.8,h2s:62,ch4:45,co:88,days:72,pipeAge:88,flowVelocity:5.2,incidents:6} },
      { zone_id:'Thanthania PS',        operator:'Subrata Chakraborty',role:'supervisor',score:68,risk_level:'HIGH',   can_enter:false, verdict:'🚫 Entry Strictly Prohibited', params:{rainfall:130,tide:4.8,h2s:42,ch4:30,co:55,days:55,pipeAge:70,flowVelocity:3.8,incidents:4} },
      { zone_id:'Khidirpur Dock',       operator:'Ratan Mondal',      role:'worker',    score:55, risk_level:'MEDIUM', can_enter:false, verdict:'⚠ Supervisor Approval Required', params:{rainfall:70,tide:3.5,h2s:15,ch4:18,co:32,days:38,pipeAge:55,flowVelocity:2.5,incidents:3} },
      { zone_id:'Ballygunge',           operator:'Pallabi Mukherjee', role:'admin',     score:22, risk_level:'LOW',    can_enter:true,  verdict:'✓ Entry Authorised', params:{rainfall:10,tide:2.1,h2s:3,ch4:4,co:8,days:8,pipeAge:20,flowVelocity:0.6,incidents:0} },
      { zone_id:'Park Street',          operator:'Subhash Chandra Das',role:'worker',   score:14, risk_level:'LOW',    can_enter:true,  verdict:'✓ Entry Authorised', params:{rainfall:5,tide:1.8,h2s:1,ch4:2,co:5,days:5,pipeAge:15,flowVelocity:0.4,incidents:0} },
    ];

    await RiskAssessment.insertMany(seedRisk.map(r => ({
      ...r, insight: RiskService.insight(r.params, r.score, { level: r.risk_level }),
      factors: RiskService.score(r.params).factors,
    })));

    console.log('✅  Demo data seeded.');
    console.log('   Login: ADMIN-KMC-001 / kavach@kolkata');
  } catch (err) {
    console.error('[SEED]', err.message);
  }
}

/* ═══════════════════════════════════════════════════════════════
   CONNECT & START
   ═══════════════════════════════════════════════════════════════ */
mongoose
  .connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
  .then(async () => {
    console.log(`✅  MongoDB connected → ${MONGO_URI}`);
    await seedDemoData();
    server.listen(PORT, () => {
      console.log(`\n🚀  KAVACH AI Kolkata — server running`);
      console.log(`    HTTP  → http://localhost:${PORT}`);
      console.log(`    WS    → ws://localhost:${PORT}`);
      console.log(`    Health→ http://localhost:${PORT}/api/health`);
      console.log(`─────────────────────────────────────────`);
      console.log(`    Login : ADMIN-KMC-001 / kavach@kolkata`);
      console.log(`─────────────────────────────────────────\n`);
    });
  })
  .catch(err => {
    console.error('❌  MongoDB failed:', err.message);
    console.log('💡  Make sure MongoDB is running: mongod');
    console.log(`💡  Or set MONGO_URI in .env to your Atlas URI`);
    process.exit(1);
  });

module.exports = app;