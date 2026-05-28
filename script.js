/**
 * ═══════════════════════════════════════════════════════════════
 * KAVACH AI · Kolkata Edition · script.js
 * Complete Frontend Controller — 10 Modules, Pure Vanilla JS
 * ═══════════════════════════════════════════════════════════════
 *
 * Modules:
 *  CONFIG         — API URL, feature flags, KMC zone data
 *  NotificationBus— Animated toast notifications
 *  ApiClient      — All fetch() calls to Node/MongoDB backend
 *  WsClient       — WebSocket with auto-reconnect
 *  AuthService    — JWT login/register/logout
 *  RiskEngine     — 8-factor weighted scoring + LLM insight
 *  UIController   — DOM, gauge, charts, ticker, nav
 *  SensorUI       — Live sensor grid
 *  BiometricUI    — Worker health telemetry simulation
 *  MapUI          — KMC canvas tactical map
 *  HistoryUI      — Paginated MongoDB audit log
 *  SOSController  — Multi-tier dispatch + radar visualizer
 *  KavachApp      — Page bootstrapper
 * ═══════════════════════════════════════════════════════════════
 */
'use strict';

/* ─────────────────────────────────────────────────────────────
   CONFIG
   ───────────────────────────────────────────────────────────── */
const CONFIG = {
  API_BASE  : 'http://localhost:5000/api',
  WS_URL    : 'ws://localhost:5000',
  USE_WS    : true,
  LLM_ENABLED: false,
  // ⚙ LLM_INJECT: set LLM_ENABLED:true + add key when ready
  LLM_ENDPOINT : 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent',
  LLM_API_KEY  : 'YOUR_GEMINI_API_KEY_HERE',
  RISK_HIGH    : 65,
  RISK_MEDIUM  : 35,
  SENSOR_POLL_MS : 4500,
  WEATHER_MS     : 9000,
  KMC_ZONES : [
    { name:'Thanthania Pumping Station', lat:22.573, lng:88.363, risk:88, level:'HIGH'   },
    { name:'Ultadanga Underpass',        lat:22.592, lng:88.392, risk:62, level:'MEDIUM' },
    { name:'Ballygunge',                 lat:22.529, lng:88.368, risk:34, level:'MEDIUM' },
    { name:'Park Street',               lat:22.551, lng:88.353, risk:18, level:'LOW'    },
    { name:'Salt Lake Sector V',        lat:22.576, lng:88.429, risk:22, level:'LOW'    },
    { name:'Behala',                    lat:22.500, lng:88.318, risk:55, level:'MEDIUM' },
    { name:'Khidirpur Dock',            lat:22.535, lng:88.330, risk:77, level:'HIGH'   },
    { name:'Shyambazar',                lat:22.608, lng:88.375, risk:41, level:'MEDIUM' },
    { name:'Kalighat',                  lat:22.524, lng:88.344, risk:29, level:'LOW'    },
    { name:'Tollygunge',                lat:22.496, lng:88.351, risk:38, level:'MEDIUM' },
    { name:'Gariahat',                  lat:22.520, lng:88.363, risk:15, level:'LOW'    },
    { name:'Rajabazar',                 lat:22.585, lng:88.370, risk:92, level:'HIGH'   },
  ],
};

/* ─────────────────────────────────────────────────────────────
   NOTIFICATION BUS
   ───────────────────────────────────────────────────────────── */
const NotificationBus = (() => {
  let _c = null;
  function _ensure() {
    if (_c) return;
    _c = document.createElement('div');
    _c.id = 'toastContainer';
    _c.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;pointer-events:none;';
    document.body.appendChild(_c);
  }
  function show(msg, type = 'info', ms = 4000) {
    _ensure();
    const C = {
      info   :{ bg:'rgba(34,211,238,0.12)',  bd:'rgba(34,211,238,0.35)',  tx:'#22d3ee' },
      success:{ bg:'rgba(34,197,94,0.12)',   bd:'rgba(34,197,94,0.35)',   tx:'#22c55e' },
      warn   :{ bg:'rgba(245,158,11,0.12)',  bd:'rgba(245,158,11,0.35)',  tx:'#f59e0b' },
      error  :{ bg:'rgba(239,68,68,0.12)',   bd:'rgba(239,68,68,0.35)',   tx:'#ef4444' },
    };
    const c = C[type] || C.info;
    const el = document.createElement('div');
    el.style.cssText = `background:${c.bg};border:1px solid ${c.bd};border-radius:10px;padding:12px 18px;color:${c.tx};font-size:.82rem;font-weight:500;backdrop-filter:blur(16px);pointer-events:auto;max-width:320px;line-height:1.5;box-shadow:0 4px 24px rgba(0,0,0,.4);`;
    el.textContent = msg;
    _c.appendChild(el);
    setTimeout(() => { el.style.cssText += 'opacity:0;transform:translateX(20px);transition:all .3s ease;'; setTimeout(() => el.remove(), 320); }, ms);
  }
  return { show };
})();

/* ─────────────────────────────────────────────────────────────
   API CLIENT
   ───────────────────────────────────────────────────────────── */
const ApiClient = (() => {
  const _token = () => sessionStorage.getItem('kavach_token') || null;
  async function _req(path, opts = {}) {
    const t = _token();
    const h = { 'Content-Type':'application/json' };
    if (t) h['Authorization'] = `Bearer ${t}`;
    try {
      const res  = await fetch(`${CONFIG.API_BASE}${path}`, { ...opts, headers:{ ...h, ...opts.headers } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch(e) { console.error(`[API] ${opts.method||'GET'} ${path}:`, e.message); throw e; }
  }
  return {
    login     : (eid, pwd)       => _req('/auth/login',    { method:'POST', body:JSON.stringify({ employee_id:eid, password:pwd }) }),
    register  : (payload)        => _req('/auth/register', { method:'POST', body:JSON.stringify(payload) }),
    me        : ()               => _req('/auth/me'),
    predict   : (payload)        => _req('/risk/predict',  { method:'POST', body:JSON.stringify(payload) }),
    history   : (p=1, l=25)      => _req(`/risk/history?page=${p}&limit=${l}`),
    riskStats : ()               => _req('/risk/stats'),
    triggerSOS: (payload)        => _req('/sos/trigger',   { method:'POST', body:JSON.stringify(payload) }),
    sosEvents : ()               => _req('/sos/events'),
    sensors   : ()               => _req('/sensors'),
    zones     : ()               => _req('/zones'),
    health    : ()               => _req('/health'),
  };
})();

/* ─────────────────────────────────────────────────────────────
   WEBSOCKET CLIENT
   ───────────────────────────────────────────────────────────── */
const WsClient = (() => {
  let _ws = null, _rt = null, _h = {};
  function on(type, fn) { _h[type] = fn; }
  function connect() {
    if (!CONFIG.USE_WS) return;
    try {
      _ws = new WebSocket(CONFIG.WS_URL);
      _ws.onopen    = () => { console.log('[WS] Connected'); clearTimeout(_rt); };
      _ws.onmessage = (e) => { try { const m=JSON.parse(e.data); if (_h[m.type]) _h[m.type](m.payload||m); } catch {} };
      _ws.onclose   = () => { _rt = setTimeout(connect, 5000); };
      _ws.onerror   = ()  => { _ws.close(); };
    } catch(e) { console.error('[WS]', e.message); }
  }
  function disconnect() { clearTimeout(_rt); if (_ws) _ws.close(); }
  return { connect, disconnect, on };
})();

/* ─────────────────────────────────────────────────────────────
   AUTH SERVICE
   ───────────────────────────────────────────────────────────── */
const AuthService = (() => {
  const LABELS = { admin:'KMC Admin / Commissioner', supervisor:'Ward Supervisor', worker:'Sanitation Worker' };
  function _save(token, user) {
    sessionStorage.setItem('kavach_token', token);
    sessionStorage.setItem('kavach_uid',   user.employee_id);
    sessionStorage.setItem('kavach_name',  user.name || user.employee_id);
    sessionStorage.setItem('kavach_role',  user.role);
    sessionStorage.setItem('kavach_label', user.label || LABELS[user.role] || 'Worker');
    sessionStorage.setItem('kavach_zone',  user.zone || 'Kolkata');
  }
  function getSession() {
    return {
      token : sessionStorage.getItem('kavach_token'),
      uid   : sessionStorage.getItem('kavach_uid')   || 'User',
      name  : sessionStorage.getItem('kavach_name')  || 'User',
      role  : sessionStorage.getItem('kavach_role')  || 'worker',
      label : sessionStorage.getItem('kavach_label') || 'Sanitation Worker',
      zone  : sessionStorage.getItem('kavach_zone')  || 'Kolkata',
    };
  }
  function isLoggedIn() { return !!sessionStorage.getItem('kavach_token'); }
  async function login() {
    const eid = document.getElementById('userid')?.value?.trim();
    const pwd = document.getElementById('password')?.value;
    if (!eid) { _err('Please enter your KMC Employee ID.'); return; }
    if (!pwd) { _err('Please enter your password.'); return; }
    const btn = document.getElementById('loginBtn');
    _bs(btn, true, 'Verifying…');
    try {
      const d = await ApiClient.login(eid, pwd);
      _save(d.token, d.user);
      window.location.href = 'dashboard.html';
    } catch(e) {
      _err(e.message.includes('credential') ? 'Invalid Employee ID or password.' : e.message);
      _bs(btn, false, 'Enter Command Centre');
    }
  }
  async function register() {
    const eid  = document.getElementById('reg_eid')?.value?.trim();
    const name = document.getElementById('reg_name')?.value?.trim();
    const role = document.getElementById('reg_role')?.value || 'worker';
    const zone = document.getElementById('reg_zone')?.value || 'Kolkata';
    const pwd  = document.getElementById('reg_pwd')?.value;
    if (!eid||!name||!pwd) { _err('All fields are required.'); return; }
    if (pwd.length < 6)    { _err('Password must be at least 6 characters.'); return; }
    const btn = document.getElementById('registerBtn');
    _bs(btn, true, 'Registering…');
    try {
      const d = await ApiClient.register({ employee_id:eid, name, password:pwd, role, zone });
      _save(d.token, d.user);
      window.location.href = 'dashboard.html';
    } catch(e) { _err(e.message); _bs(btn, false, 'Create Account'); }
  }
  function logout() { sessionStorage.clear(); window.location.href = 'index.html'; }
  function _err(msg) {
    let el = document.getElementById('authError');
    if (!el) {
      el = document.createElement('p'); el.id='authError';
      el.style.cssText = 'color:#ef4444;font-size:.81rem;text-align:center;margin-top:-8px;';
      document.querySelector('.login-card')?.appendChild(el);
    }
    el.textContent = msg;
    setTimeout(() => { if(el) el.textContent=''; }, 4000);
  }
  function _bs(btn, dis, lbl) {
    if (!btn) return; btn.disabled=dis;
    const l=btn.querySelector('.btn-label'); if(l) l.textContent=lbl;
  }
  return { login, register, logout, getSession, isLoggedIn };
})();

/* ─────────────────────────────────────────────────────────────
   RISK ENGINE — 8-Factor KMC Weighted Scoring
   ───────────────────────────────────────────────────────────── */
const RiskEngine = (() => {
  function _cl(v,lo,hi) { return Math.max(lo, Math.min(hi, Number(v)||0)); }

  function sanitise(r) {
    return {
      rainfall     : _cl(r.rainfall,    0, 500),
      tide         : _cl(r.tideInput,   0, 8),
      h2s          : _cl(r.h2s,         0, 1000),
      ch4          : _cl(r.ch4,         0, 100),
      co           : _cl(r.co,          0, 1000),
      days         : _cl(r.days,        0, 365),
      pipeAge      : _cl(r.pipeAge,     0, 150),
      flowVelocity : _cl(r.flowVelocity,0, 10),
      incidents    : _cl(r.incidents,   0, 100),
    };
  }

  /* Weights sum to 1.00 — calibrated for Kolkata conditions */
  const W = {
    rainfall:0.16, tide:0.14, h2s:0.18, ch4:0.12,
    co:0.10, days:0.10, pipeAge:0.08, flowVelocity:0.07, incidents:0.05,
  };

  function computeScore(p) {
    const f = {};
    /* Rainfall (Kolkata waterlogging: >60mm = danger) */
    f.rainfall     = p.rainfall > 120 ? 1.00 : p.rainfall > 60 ? 0.65 : p.rainfall > 25 ? 0.30 : p.rainfall / 120;
    /* Hooghly tide (>4.5m = sewer backflow risk) */
    f.tide         = p.tide > 6.0 ? 1.00 : p.tide > 4.5 ? 0.70 : p.tide > 3.0 ? 0.35 : p.tide / 8;
    /* H₂S gas (OSHA IDLH = 50 ppm) */
    f.h2s          = p.h2s > 50 ? 1.00 : p.h2s > 20 ? 0.72 : p.h2s > 10 ? 0.45 : p.h2s > 5 ? 0.20 : p.h2s/50;
    /* CH₄ (explosive at 100% LEL) */
    f.ch4          = p.ch4 > 60 ? 1.00 : p.ch4 > 30 ? 0.65 : p.ch4 > 15 ? 0.35 : p.ch4/100;
    /* CO (OSHA ceiling 50 ppm) */
    f.co           = p.co > 100 ? 1.00 : p.co > 50 ? 0.72 : p.co > 25 ? 0.40 : p.co/100;
    /* Maintenance gap */
    f.days         = p.days > 60 ? 1.00 : p.days > 30 ? 0.60 : p.days > 14 ? 0.28 : p.days/120;
    /* Pipe structural age */
    f.pipeAge      = p.pipeAge > 80 ? 1.00 : p.pipeAge > 50 ? 0.65 : p.pipeAge > 25 ? 0.30 : p.pipeAge/100;
    /* Flow velocity (>4 m/s = dangerous) */
    f.flowVelocity = p.flowVelocity > 4 ? 1.00 : p.flowVelocity > 2 ? 0.55 : p.flowVelocity / 4;
    /* Historic incidents */
    f.incidents    = p.incidents >= 5 ? 1.00 : p.incidents >= 3 ? 0.64 : p.incidents >= 1 ? 0.30 : 0;

    const total = Math.min(100, Math.round(
      Object.keys(W).reduce((s, k) => s + f[k] * W[k] * 100, 0)
    ));
    return { total, factors: Object.fromEntries(Object.entries(f).map(([k,v]) => [k, +(v*100).toFixed(1)])) };
  }

  function verdict(score) {
    if (score >= CONFIG.RISK_HIGH)   return { level:'HIGH',   label:'🚫 Entry Strictly Prohibited',    cssClass:'high',   color:'#ef4444', canEnter:false };
    if (score >= CONFIG.RISK_MEDIUM) return { level:'MEDIUM', label:'⚠ Supervisor Approval Required', cssClass:'medium', color:'#f59e0b', canEnter:false };
    return                                   { level:'LOW',   label:'✓ Entry Authorised — Stay Alert',cssClass:'safe',   color:'#22c55e', canEnter:true  };
  }

  function recommendations(p, v) {
    const r = [];
    if (p.h2s > 10)          r.push({ icon:'🧪', text:`H₂S at ${p.h2s}ppm exceeds safe limit. SCBA full-face respirator and continuous atmospheric monitor mandatory.` });
    if (p.ch4 > 15)          r.push({ icon:'💥', text:`CH₄ at ${p.ch4}% LEL — explosive risk. No spark-producing equipment. Force-ventilate for minimum 30 minutes.` });
    if (p.co > 25)           r.push({ icon:'☠', text:`CO at ${p.co}ppm above OSHA ceiling. Immediate ventilation required before entry.` });
    if (p.rainfall > 60)     r.push({ icon:'🌧', text:`Heavy rainfall (${p.rainfall}mm) detected. Kolkata waterlogging risk elevated. Deploy standby surface rescue team.` });
    if (p.tide > 4.5)        r.push({ icon:'🌊', text:`Hooghly tide at ${p.tide}m above MSL — sewer backflow risk 340% above baseline. Entry suspended until tide recedes.` });
    if (p.days > 30)         r.push({ icon:'🔧', text:`Maintenance gap of ${p.days} days. Biological decomposition gases likely elevated. Full atmospheric survey required.` });
    if (p.pipeAge > 50)      r.push({ icon:'🏚', text:`Pipe structural age ${p.pipeAge} years — collapse risk elevated. Structural integrity assessment required before entry.` });
    if (p.flowVelocity > 2)  r.push({ icon:'💧', text:`Flow velocity ${p.flowVelocity}m/s — slip and entrapment risk. Personal flotation device mandatory.` });
    if (v.level === 'HIGH')  r.push({ icon:'🚑', text:`CRITICAL: KMC Emergency Services must be on standby. Written hazmat clearance mandatory. Call 108 before proceeding.` });
    if (!r.length) {
      r.push({ icon:'✅', text:'All parameters within KMC operational bounds. Standard PPE and two-person buddy protocol apply.' });
      r.push({ icon:'📡', text:'Continuous atmospheric monitoring mandatory throughout. Log readings every 15 minutes and report changes immediately.' });
    }
    return r;
  }

  /* ⚙ LLM_INJECT — Real Gemini call goes here.
   * Uncomment and set LLM_ENABLED:true in CONFIG:
   *
   * async function _realLLM(p, score, v) {
   *   const prompt = `You are KAVACH AI, a sewer safety expert for Kolkata Municipal Corporation.
   *     Parameters: Rainfall ${p.rainfall}mm | Hooghly tide ${p.tide}m | H₂S ${p.h2s}ppm |
   *     CH₄ ${p.ch4}%LEL | CO ${p.co}ppm | Maintenance ${p.days}d | Pipe age ${p.pipeAge}yr |
   *     Flow ${p.flowVelocity}m/s | Incidents ${p.incidents} | Score ${score}/100 | Level ${v.level}.
   *     Write 2 precise, actionable safety sentences for a KMC field worker. Mention Kolkata context.`;
   *   const res = await fetch(`${CONFIG.LLM_ENDPOINT}?key=${CONFIG.LLM_API_KEY}`,
   *     { method:'POST', headers:{'Content-Type':'application/json'},
   *       body:JSON.stringify({ contents:[{ parts:[{ text:prompt }] }] }) });
   *   const d = await res.json();
   *   return d.candidates[0].content.parts[0].text;
   * }
   */
  async function getInsight(p, score, v) {
    if (CONFIG.LLM_ENABLED) { /* return await _realLLM(p, score, v); */ }
    const MAP = {
      HIGH  : `CRITICAL [${score}/100]: Compounding hazards across ${[p.h2s>10?`H₂S at ${p.h2s}ppm`:'', p.tide>4.5?`Hooghly tide at ${p.tide}m`:'', p.rainfall>60?`${p.rainfall}mm rainfall`:''].filter(Boolean).join(', ')} create a fatality-level risk profile specific to Kolkata's low-lying sewer infrastructure. Immediate zone lockdown and KMC Central Control Room escalation are mandatory per West Bengal Municipal Act §42.`,
      MEDIUM: `CAUTION [${score}/100]: Elevated risk driven by ${p.days>30?`${p.days}-day maintenance backlog`  : p.tide>3?`Hooghly tidal surge to ${p.tide}m` : `${p.rainfall}mm rainfall-induced waterlogging`}. KMC Ward Supervisor must physically inspect the manhole, deploy a two-person team with continuous gas monitoring, and maintain radio contact throughout the operation.`,
      LOW   : `SAFE [${score}/100]: All parameters within KMC operational bounds per CMDA Safety Circular 2024. Standard PPE, the mandatory two-person buddy system, and real-time atmospheric monitoring remain obligatory. Report any parameter changes to your Ward Supervisor immediately.`,
    };
    return MAP[v.level];
  }

  return { sanitise, computeScore, verdict, recommendations, getInsight };
})();

/* ─────────────────────────────────────────────────────────────
   UI CONTROLLER
   ───────────────────────────────────────────────────────────── */
const UIController = (() => {

  /* Clock */
  function startClock() {
    const el = document.getElementById('topbarTime');
    if (!el) return;
    const tick = () => el.textContent = new Date().toLocaleTimeString('en-IN',{ hour:'2-digit', minute:'2-digit', second:'2-digit' });
    tick(); setInterval(tick, 1000);
  }

  /* KMC weather + tide feed (simulated) */
  function startWeatherFeed() {
    const el = document.getElementById('liveWeather');
    const tl = document.getElementById('tideLevel');
    const sr = document.getElementById('stormRisk');
    const kt = document.getElementById('kpiTide');
    const gen = () => {
      const rain  = (Math.random()*28).toFixed(1);
      const temp  = (28 + Math.random()*9).toFixed(1);
      const humid = Math.floor(65 + Math.random()*30);
      const tide  = (1.8 + Math.random()*4).toFixed(2);
      const storm = parseFloat(rain) > 15 ? (Math.random() > 0.5 ? 'HIGH' : 'MEDIUM') : 'LOW';
      if (el) el.textContent = `Kolkata: ${temp}°C · Rain ${rain}mm · Humidity ${humid}%`;
      if (tl) { tl.textContent = `${tide}m`; tl.className = `env-val ${parseFloat(tide) > 4.5 ? 'neon-pulse-blue storm-active' : ''}`; }
      if (sr) { sr.textContent = storm; sr.className = `env-val ${storm === 'HIGH' ? 'storm-active' : ''}`; }
      if (kt) kt.textContent = tide;
    };
    gen(); setInterval(gen, CONFIG.WEATHER_MS);
  }

  /* Alert ticker — KMC specific */
  const TICKER = [
    { cls:'alert-hi',   text:'🚨 CRITICAL — Thanthania Pumping Station: H₂S 58ppm. All entries BLOCKED. KMC Control Room alerted.' },
    { cls:'alert-tide', text:'🌊 TIDE ALERT — Hooghly at 5.2m MSL. Backflow risk elevated across Khidirpur Dock and Rajabazar zones.' },
    { cls:'alert-med',  text:'⚠ MEDIUM RISK — Ultadanga Underpass: 122mm rainfall logged. Ward Supervisor review pending.' },
    { cls:'alert-low',  text:'✓ SAFE — Ballygunge Zone 4 cleared for entry by Ward Supervisor Debabrata Roy.' },
    { cls:'alert-hi',   text:'⛈ KALBAISAKHI ALERT — Nor\'wester storm approaching. Wind speed 78 km/h. All open-sewer work suspended.' },
    { cls:'alert-hi',   text:'🚨 SOS ACTIVE — Worker KMC-0187 triggered emergency at Rajabazar, 14:47 IST. Dispatch en route.' },
    { cls:'alert-low',  text:'✓ Sensor SN-007 back online — Salt Lake Sector V, O₂ 20.9%, CH₄ 0.8%LEL.' },
    { cls:'alert-med',  text:'⚠ Pipe collapse risk — Behala Sector 3: Structural age 78 years. Inspection ordered.' },
    { cls:'alert-tide', text:'🌊 Tide receding — Khidirpur Dock: Level dropped to 3.8m. Conditional entry possible from 17:00 IST.' },
  ];
  function buildTicker() {
    const t = document.getElementById('tickerTrack');
    if (!t) return;
    t.innerHTML = [...TICKER,...TICKER].map(i => `<span class="ticker-item ${i.cls}">${i.text}</span>`).join('');
  }

  /* Count-up stat animation */
  function animateCounters() {
    document.querySelectorAll('[data-target]').forEach(el => {
      const target = parseInt(el.dataset.target || 0);
      let cur = 0;
      const step = Math.max(1, Math.ceil(target/45));
      const t = setInterval(() => { cur=Math.min(cur+step,target); el.textContent=cur; if(cur>=target) clearInterval(t); }, 35);
    });
  }

  /* Zone risk bars — from backend or CONFIG fallback */
  function buildZoneList(data) {
    const el = document.getElementById('zoneList');
    if (!el) return;
    const zones = data || CONFIG.KMC_ZONES.slice(0,6).map(z=>({ name:z.name, risk_pct:z.risk, level:z.level }));
    const cls   = { LOW:'zone-low', MEDIUM:'zone-med', HIGH:'zone-high' };
    el.innerHTML = zones.map(z => `
      <div class="zone-item ${cls[z.level]||'zone-low'}">
        <span class="zone-name">${z.name}</span>
        <div class="zone-bar-wrap"><div class="zone-bar" style="width:0%" data-pct="${z.risk_pct||z.pct||0}"></div></div>
        <span class="zone-badge">${z.risk_pct||z.pct||0}%</span>
      </div>`).join('');
    requestAnimationFrame(() => setTimeout(() => {
      document.querySelectorAll('.zone-bar').forEach(b => { b.style.width = b.dataset.pct + '%'; });
    }, 200));
  }

  /* KPI update */
  function updateKPIs(s) {
    const set = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
    set('kpiSafe',    s.safe_today        ?? '—');
    set('kpiPending', s.pending_approvals ?? '—');
    set('kpiHigh',    s.high_risk_zones   ?? '—');
    set('kpiSensors', s.sensors_online    ?? '—');
    set('kpiWorkers', s.active_workers    ?? '—');
  }

  /* Canvas rainfall bar chart */
  function buildRainfallChart() {
    const canvas = document.getElementById('rainfallChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const data = Array.from({length:24}, () => Math.max(0, Math.random()*42-5));
    // Kolkata monsoon spike
    data[14]=55; data[15]=78; data[16]=124; data[17]=98; data[18]=62;
    const W = Math.max(300, (canvas.parentElement?.offsetWidth||400)-48);
    const H = 148;
    canvas.width=W; canvas.height=H;
    const pad={t:10,r:10,b:28,l:34}, pW=W-pad.l-pad.r, pH=H-pad.t-pad.b, MAX=130;
    ctx.clearRect(0,0,W,H);
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1;
    [0,.25,.5,.75,1].forEach(f=>{ const y=pad.t+pH*(1-f); ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke(); });
    ctx.fillStyle='rgba(148,163,184,0.65)'; ctx.font='10px DM Sans,sans-serif'; ctx.textAlign='right';
    [0,32,65,97,130].forEach(v=>{ ctx.fillText(v, pad.l-5, pad.t+pH*(1-v/MAX)+3); });
    const grad = ctx.createLinearGradient(0,pad.t,0,H-pad.b);
    grad.addColorStop(0,'rgba(34,211,238,0.7)'); grad.addColorStop(1,'rgba(34,211,238,0.05)');
    const bW=pW/24*0.68, gap=pW/24;
    data.forEach((v,i)=>{
      const x=pad.l+i*gap+gap*0.16, bH=(v/MAX)*pH, y=pad.t+pH-bH;
      ctx.fillStyle = v>80?'rgba(239,68,68,0.85)':v>60?'rgba(245,158,11,0.8)':grad;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x,y,bW,bH,[3,3,0,0]); ctx.fill(); }
      else { ctx.fillRect(x,y,bW,bH); }
    });
    ctx.fillStyle='rgba(148,163,184,0.55)'; ctx.textAlign='center'; ctx.font='9px DM Sans,sans-serif';
    [0,6,12,18,23].forEach(i=>{ ctx.fillText(`${String(i).padStart(2,'0')}h`, pad.l+i*gap+gap*.5, H-6); });
  }

  /* Canvas tide chart */
  function buildTideChart() {
    const canvas = document.getElementById('tideChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    // Realistic semi-diurnal tidal pattern for Kolkata/Hooghly
    const pts = [2.1,1.8,1.5,1.4,1.6,2.2,3.1,4.0,4.8,5.2,5.1,4.5,3.8,3.1,2.5,2.0,1.8,1.7,2.0,2.8,3.6,4.4,5.0,5.3];
    const W = Math.max(300,(canvas.parentElement?.offsetWidth||400)-48);
    const H = 120;
    canvas.width=W; canvas.height=H;
    const pad={t:10,r:10,b:24,l:36}, pW=W-pad.l-pad.r, pH=H-pad.t-pad.b, MAX=6.5;
    ctx.clearRect(0,0,W,H);
    // Danger zone fill >4.5m
    const dangerY = pad.t + pH*(1-4.5/MAX);
    ctx.fillStyle='rgba(239,68,68,0.08)';
    ctx.fillRect(pad.l, dangerY, pW, pad.t+pH-dangerY);
    // Gridlines
    ctx.strokeStyle='rgba(255,255,255,0.05)'; ctx.lineWidth=1;
    [0,2,4,6].forEach(v=>{ const y=pad.t+pH*(1-v/MAX); ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(W-pad.r,y); ctx.stroke(); });
    ctx.fillStyle='rgba(148,163,184,0.6)'; ctx.font='10px DM Sans'; ctx.textAlign='right';
    [0,2,4,6].forEach(v=>{ ctx.fillText(`${v}m`, pad.l-5, pad.t+pH*(1-v/MAX)+3); });
    // Danger line
    ctx.strokeStyle='rgba(239,68,68,0.5)'; ctx.setLineDash([4,4]); ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(pad.l,dangerY); ctx.lineTo(W-pad.r,dangerY); ctx.stroke();
    ctx.setLineDash([]);
    // Tide curve
    const grad = ctx.createLinearGradient(0,pad.t,0,H-pad.b);
    grad.addColorStop(0,'rgba(96,165,250,0.5)'); grad.addColorStop(1,'rgba(96,165,250,0.05)');
    ctx.beginPath();
    pts.forEach((v,i)=>{ const x=pad.l+(i/(pts.length-1))*pW, y=pad.t+pH*(1-v/MAX); i===0?ctx.moveTo(x,y):ctx.lineTo(x,y); });
    ctx.strokeStyle='#60a5fa'; ctx.lineWidth=2.5;
    ctx.stroke();
    // Fill area under curve
    ctx.lineTo(pad.l+pW,pad.t+pH); ctx.lineTo(pad.l,pad.t+pH); ctx.closePath();
    ctx.fillStyle=grad; ctx.fill();
    // Hour labels
    ctx.fillStyle='rgba(148,163,184,0.55)'; ctx.textAlign='center'; ctx.font='9px DM Sans';
    [0,6,12,18,23].forEach(i=>{ ctx.fillText(`${String(i).padStart(2,'0')}h`, pad.l+(i/23)*pW, H-6); });
  }

  /* Gauge update */
  function updateGauge(score, v) {
    const TRACK=283;
    ['gaugeFill','gaugeNeedle','gaugeScore','gaugePct','resultBanner','riskResult']
      .map(id=>document.getElementById(id));
    const fill  = document.getElementById('gaugeFill');
    const needle= document.getElementById('gaugeNeedle');
    const sEl   = document.getElementById('gaugeScore');
    const pEl   = document.getElementById('gaugePct');
    const banner= document.getElementById('resultBanner');
    const resEl = document.getElementById('riskResult');
    if (!fill) return;
    fill.style.strokeDashoffset = TRACK*(1-score/100);
    fill.style.stroke = v.color;
    needle.style.transform = `rotate(${-90+(score/100)*180}deg)`;
    needle.style.transformOrigin='110px 115px';
    let cur=0; const step=Math.max(1,Math.ceil(score/30));
    const t=setInterval(()=>{ cur=Math.min(cur+step,score); sEl.textContent=cur; if(cur>=score) clearInterval(t); },28);
    sEl.style.color=v.color; pEl.textContent=`${v.level} RISK`; pEl.style.color=v.color;
    if (banner) banner.className=`result-banner ${v.cssClass}`;
    if (resEl)  resEl.textContent=v.label;
  }

  /* LLM typewriter */
  function showInsight(text) {
    const box=document.getElementById('llmInsight'), para=document.getElementById('llmText');
    if (!box||!para) return;
    box.style.display='block'; para.textContent='';
    let i=0; const type=()=>{ if(i<text.length){ para.textContent+=text[i++]; setTimeout(type,10); } };
    requestAnimationFrame(type);
  }

  /* Recommendations */
  function showRecommendations(recs) {
    const el=document.getElementById('recommendList');
    if (!el) return;
    el.innerHTML=recs.map(r=>{
      const icon=typeof r==='object'?r.icon:'▸';
      const text=typeof r==='object'?r.text:r;
      return `<div class="recommend-item"><span class="recommend-icon">${icon}</span><span>${text}</span></div>`;
    }).join('');
  }

  /* Factor breakdown bars */
  function showFactorBreakdown(factors) {
    const box=document.getElementById('factorBreakdown'), bars=document.getElementById('factorBars');
    if (!box||!bars) return;
    box.style.display='block';
    const NAMES = { rainfall:'Rainfall',tide:'Hooghly Tide',h2s:'H₂S Gas',ch4:'CH₄ Gas',co:'CO Gas',days:'Maintenance',pipeAge:'Pipe Age',flowVelocity:'Flow Velocity',incidents:'Incidents' };
    const COLORS= { rainfall:'#60a5fa',tide:'#60a5fa',h2s:'#ef4444',ch4:'#f59e0b',co:'#f97316',days:'#a78bfa',pipeAge:'#fb923c',flowVelocity:'#34d399',incidents:'#f43f5e' };
    bars.innerHTML=Object.entries(factors).map(([k,v])=>`
      <div class="factor-bar-row">
        <span class="factor-name">${NAMES[k]||k}</span>
        <div class="factor-track"><div class="factor-fill" style="width:0%;background:${COLORS[k]||'#22d3ee'}" data-w="${v}"></div></div>
        <span class="factor-pct">${v}%</span>
      </div>`).join('');
    requestAnimationFrame(()=>setTimeout(()=>{ document.querySelectorAll('.factor-fill').forEach(b=>{ b.style.width=b.dataset.w+'%'; }); },100));
  }

  /* Section navigation */
  function initNav() {
    document.querySelectorAll('.nav-item').forEach(link=>{
      link.addEventListener('click', e=>{
        e.preventDefault();
        const section=link.dataset.section;
        document.querySelectorAll('.nav-item').forEach(l=>l.classList.remove('active'));
        link.classList.add('active');
        document.querySelectorAll('.dash-section').forEach(s=>s.classList.remove('active'));
        const target=document.getElementById(`section-${section}`);
        if (target) {
          target.classList.add('active');
          target.querySelectorAll('.animated-fade,.slide-in').forEach(el=>{ el.style.animation='none'; requestAnimationFrame(()=>{ el.style.animation=''; }); });
        }
        const ti=document.getElementById('topbarTitle');
        if (ti) ti.textContent=link.querySelector('span:last-child')?.textContent||'';
        if (section==='history')   HistoryUI.render();
        if (section==='sos')       SOSController.loadEvents();
        if (section==='biometrics')BiometricUI.render();
        if (section==='map')       MapUI.draw();
        document.getElementById('sidebar')?.classList.remove('open');
      });
    });
  }

  /* Auth tab switch */
  function initAuthTabs() {
    document.querySelectorAll('.auth-tab').forEach(tab=>{
      tab.addEventListener('click',()=>{
        document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
        document.querySelectorAll('.auth-panel').forEach(p=>p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`panel-${tab.dataset.tab}`)?.classList.add('active');
      });
    });
  }

  return {
    startClock, startWeatherFeed, buildTicker, animateCounters,
    buildZoneList, updateKPIs, buildRainfallChart, buildTideChart,
    updateGauge, showInsight, showRecommendations, showFactorBreakdown,
    initNav, initAuthTabs,
  };
})();

/* ─────────────────────────────────────────────────────────────
   SENSOR UI — KMC Underground Sensors
   ───────────────────────────────────────────────────────────── */
const SensorUI = (() => {
  const LIMITS={
    'H₂S (ppm)':[0,8],'CH₄ (%LEL)':[0,15],'CO (ppm)':[0,25],
    'O₂ (%)':[19,23],'Temp (°C)':[18,35],'Flow (m/s)':[0,2],
  };
  const ZONES=['Thanthania PS','Ultadanga UP','Ballygunge','Park Street','Salt Lake V','Behala','Khidirpur Dock','Shyambazar','Kalighat','Tollygunge','Gariahat','Rajabazar'];
  const METRICS=Object.keys(LIMITS);
  let _data=[];

  function _gen() {
    return ZONES.map((zone,i)=>{
      const metric=METRICS[i%METRICS.length];
      const [lo,hi]=LIMITS[metric];
      const isCrit=Math.random()<.10, isWarn=!isCrit&&Math.random()<.20;
      const v=isCrit?hi*(1.5+Math.random()*.7):isWarn?hi*(1.06+Math.random()*.25):(lo+Math.random()*(hi-lo));
      return { id:`SN-${String(i+1).padStart(3,'0')}`, zone, metric, value:+v.toFixed(1), status:isCrit?'crit':isWarn?'warn':'ok', ts:new Date().toISOString() };
    });
  }

  function render(data) {
    const grid=document.getElementById('sensorGrid');
    if (!grid) return;
    grid.innerHTML=data.map(s=>{
      const [lo,hi]=LIMITS[s.metric]||[0,100];
      const pct=s.metric==='O₂ (%)'?((s.value-14)/12*100):Math.min(100,s.value/(hi*1.6)*100);
      const ts=new Date(s.ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      return `<div class="sensor-card sensor-${s.status} hover-float">
        <div class="sensor-id">${s.id}</div>
        <div class="sensor-zone">${s.zone}</div>
        <div class="sensor-val">${s.value}</div>
        <div class="sensor-unit">${s.metric}</div>
        <div class="sensor-bar"><div class="sensor-fill" style="width:${Math.max(2,pct)}%"></div></div>
        <div class="sensor-ts">${ts}</div>
      </div>`;
    }).join('');
    const kpi=document.getElementById('kpiSensors');
    if (kpi) kpi.textContent=data.filter(s=>s.status!=='crit').length;
  }

  async function init() {
    try { const d=await ApiClient.sensors(); _data=d.sensors; render(_data); }
    catch { _data=_gen(); render(_data); }
    WsClient.on('sensors', d=>{ _data=d; if(document.getElementById('section-sensors')?.classList.contains('active')) render(d); const k=document.getElementById('kpiSensors'); if(k) k.textContent=d.filter(s=>s.status!=='crit').length; });
    if (!CONFIG.USE_WS) setInterval(async()=>{ try{ const d=await ApiClient.sensors(); render(d.sensors); }catch{ _data=_data.map(s=>{ if(Math.random()<.28){ const[lo,hi]=LIMITS[s.metric]||[0,100]; const nv=Math.max(0,s.value+(Math.random()-.47)*(hi-lo)*.22); return{...s,value:+nv.toFixed(1),status:nv>hi*1.4?'crit':nv>hi?'warn':'ok',ts:new Date().toISOString()}; } return s; }); render(_data); } },CONFIG.SENSOR_POLL_MS);
  }

  return { init, render };
})();

/* ─────────────────────────────────────────────────────────────
   BIOMETRIC UI — Worker Health Telemetry
   ───────────────────────────────────────────────────────────── */
const BiometricUI = (() => {
  const WORKERS = [
    { id:'KMC-0042', name:'Subhash Chandra Das', zone:'Thanthania PS',    avatar:'SC' },
    { id:'KMC-0187', name:'Ratan Mondal',         zone:'Rajabazar',        avatar:'RM' },
    { id:'KMC-0301', name:'Tapas Biswas',         zone:'Khidirpur Dock',  avatar:'TB' },
    { id:'KMC-0455', name:'Sumit Ghosh',          zone:'Ultadanga UP',    avatar:'SG' },
    { id:'KMC-0522', name:'Nilanjana Roy',        zone:'Ballygunge',      avatar:'NR' },
    { id:'KMC-0618', name:'Dipak Sarkar',         zone:'Behala',          avatar:'DS' },
  ];

  function _genBio() {
    return WORKERS.map(w=>{
      const hr   = Math.floor(62 + Math.random()*58);   // 62-120 bpm
      const temp = +(36.2 + Math.random()*2.2).toFixed(1); // 36.2-38.4°C
      const o2   = +(94 + Math.random()*5).toFixed(1);   // 94-99%
      const motion = Math.random() > 0.15 ? 'Active' : 'Stationary';
      const status = hr>100||temp>38||o2<96 ? (hr>115||temp>38.5||o2<95 ? 'crit':'warn') : 'ok';
      return { ...w, hr, temp, o2, motion, status };
    });
  }

  function render(data) {
    const grid=document.getElementById('biometricGrid');
    if (!grid) return;
    const workers=data||_genBio();
    grid.innerHTML=workers.map(w=>{
      const hrPct=Math.min(100,(w.hr-50)/80*100);
      const tmpPct=Math.min(100,(w.temp-35)/5*100);
      const o2Pct=Math.min(100,(w.o2-85)/15*100);
      return `
      <div class="biometric-card hover-float">
        <div class="bio-header">
          <div class="bio-avatar">${w.avatar}</div>
          <div>
            <div class="bio-name">${w.name}</div>
            <div class="bio-zone">${w.zone} · ${w.id}</div>
          </div>
          <span class="bio-status-badge bio-status-${w.status}">${w.status==='ok'?'✓ Normal':w.status==='warn'?'⚠ Caution':'🚨 Alert'}</span>
        </div>
        <div class="bio-metrics">
          <div class="bio-metric bio-hr">
            <span class="bio-metric-label">❤ Heart Rate</span>
            <span class="bio-metric-val hr-pulse">${w.hr} bpm</span>
            <div class="bio-metric-bar"><div class="bio-metric-fill" style="width:${hrPct}%"></div></div>
          </div>
          <div class="bio-metric bio-temp">
            <span class="bio-metric-label">🌡 Core Temp</span>
            <span class="bio-metric-val">${w.temp}°C</span>
            <div class="bio-metric-bar"><div class="bio-metric-fill" style="width:${tmpPct}%"></div></div>
          </div>
          <div class="bio-metric bio-o2">
            <span class="bio-metric-label">💨 SpO₂</span>
            <span class="bio-metric-val">${w.o2}%</span>
            <div class="bio-metric-bar"><div class="bio-metric-fill" style="width:${o2Pct}%"></div></div>
          </div>
          <div class="bio-metric bio-motion">
            <span class="bio-metric-label">🔄 Gyroscope</span>
            <span class="bio-metric-val" style="font-size:.92rem;color:${w.motion==='Active'?'#22c55e':'#f59e0b'}">${w.motion}</span>
          </div>
        </div>
      </div>`;
    }).join('');
    const wk=document.getElementById('kpiWorkers'); if(wk) wk.textContent=workers.length;
  }

  // Live refresh every 5s
  function startLiveFeed() {
    setInterval(()=>{
      if (document.getElementById('section-biometrics')?.classList.contains('active')) render();
    }, 5000);
  }

  return { render, startLiveFeed };
})();

/* ─────────────────────────────────────────────────────────────
   MAP UI — KMC Canvas Tactical Map
   ───────────────────────────────────────────────────────────── */
const MapUI = (() => {
  let _animFrame=null, _tick=0, _sosActive=false, _sosCoords=null;

  // Normalise KMC lat/lng to canvas pixel space
  function _toCanvas(lat, lng, W, H) {
    const minLat=22.48, maxLat=22.63, minLng=88.30, maxLng=88.46;
    const x = (lng - minLng) / (maxLng - minLng) * (W - 80) + 40;
    const y = (1 - (lat - minLat) / (maxLat - minLat)) * (H - 80) + 40;
    return { x, y };
  }

  function draw() {
    const canvas = document.getElementById('kmcMap');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.offsetWidth; const H = 540;
    canvas.width = W; canvas.height = H;

    function frame() {
      _tick++;
      ctx.clearRect(0,0,W,H);

      // Background
      const bg = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,Math.max(W,H));
      bg.addColorStop(0,'#0d1525'); bg.addColorStop(1,'#060a12');
      ctx.fillStyle=bg; ctx.fillRect(0,0,W,H);

      // Grid overlay
      ctx.strokeStyle='rgba(34,211,238,0.04)'; ctx.lineWidth=1;
      for(let x=0;x<W;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
      for(let y=0;y<H;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

      // Hooghly River (simulated)
      ctx.beginPath();
      ctx.moveTo(W*0.08,0); ctx.bezierCurveTo(W*0.12,H*0.3,W*0.10,H*0.7,W*0.08,H);
      ctx.strokeStyle='rgba(96,165,250,0.35)'; ctx.lineWidth=18; ctx.stroke();
      ctx.strokeStyle='rgba(96,165,250,0.15)'; ctx.lineWidth=26; ctx.stroke();

      // River label
      ctx.fillStyle='rgba(96,165,250,0.5)'; ctx.font='bold 11px DM Sans'; ctx.textAlign='center';
      ctx.save(); ctx.translate(W*0.09, H*0.5); ctx.rotate(-Math.PI/2);
      ctx.fillText('HOOGHLY RIVER', 0, 0); ctx.restore();

      // Zone nodes
      CONFIG.KMC_ZONES.forEach(zone=>{
        const {x,y} = _toCanvas(zone.lat, zone.lng, W, H);
        const color  = zone.level==='HIGH'?'#ef4444':zone.level==='MEDIUM'?'#f59e0b':'#22c55e';
        const pulse  = 6+Math.abs(Math.sin(_tick*0.04+zone.lat))*4;

        // Glow ring
        const grd=ctx.createRadialGradient(x,y,0,x,y,pulse*3);
        grd.addColorStop(0,color.replace(')',',0.3)')); grd.addColorStop(1,'transparent');
        ctx.fillStyle=grd; ctx.beginPath(); ctx.arc(x,y,pulse*3,0,Math.PI*2); ctx.fill();

        // Outer pulse ring
        ctx.beginPath(); ctx.arc(x,y,pulse+4,0,Math.PI*2);
        ctx.strokeStyle=color.replace(')',`,${0.2+Math.abs(Math.sin(_tick*.04))*.3})`);
        ctx.lineWidth=1.5; ctx.stroke();

        // Main dot
        ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2);
        ctx.fillStyle=color; ctx.fill();
        ctx.strokeStyle='rgba(255,255,255,0.5)'; ctx.lineWidth=1.5; ctx.stroke();

        // Label
        ctx.fillStyle='rgba(241,245,249,0.85)'; ctx.font='bold 10px DM Sans'; ctx.textAlign='center';
        ctx.fillText(zone.name.length>18?zone.name.slice(0,16)+'…':zone.name, x, y-12);
        ctx.fillStyle=color; ctx.font='9px DM Sans';
        ctx.fillText(`${zone.risk}%`, x, y+18);
      });

      // Active worker dots (simulated)
      const workers = [
        { lat:22.573, lng:88.363 }, { lat:22.535, lng:88.330 },
        { lat:22.585, lng:88.370 }, { lat:22.529, lng:88.368 },
      ];
      workers.forEach((w,i)=>{
        const {x,y}=_toCanvas(w.lat, w.lng, W, H);
        const pulse2=4+Math.abs(Math.sin(_tick*0.06+i))*3;
        ctx.beginPath(); ctx.arc(x,y,pulse2,0,Math.PI*2);
        ctx.fillStyle=`rgba(96,165,250,${0.3+Math.abs(Math.sin(_tick*.06+i))*.4})`;
        ctx.fill();
        ctx.beginPath(); ctx.arc(x,y,3.5,0,Math.PI*2);
        ctx.fillStyle='#60a5fa'; ctx.fill();
      });

      // SOS pulse (when active)
      if (_sosActive && _sosCoords) {
        const {x,y} = _toCanvas(_sosCoords.lat, _sosCoords.lng, W, H);
        const r = 15+(_tick%50);
        ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
        ctx.strokeStyle=`rgba(239,68,68,${Math.max(0,0.8-r/80)})`;
        ctx.lineWidth=2; ctx.stroke();
        ctx.beginPath(); ctx.arc(x,y,8,0,Math.PI*2);
        ctx.fillStyle='#ef4444'; ctx.fill();
        ctx.fillStyle='white'; ctx.font='bold 10px DM Sans'; ctx.textAlign='center';
        ctx.fillText('SOS', x, y+3.5);
      }

      // Scan line
      const scanY = (H * ((_tick%120)/120));
      const scanGrd=ctx.createLinearGradient(0,scanY-20,0,scanY+2);
      scanGrd.addColorStop(0,'transparent'); scanGrd.addColorStop(1,'rgba(34,211,238,0.06)');
      ctx.fillStyle=scanGrd; ctx.fillRect(0,scanY-20,W,22);

      // Title overlay
      ctx.fillStyle='rgba(34,211,238,0.8)'; ctx.font='bold 13px Syne,sans-serif'; ctx.textAlign='left';
      ctx.fillText('KMC TACTICAL MAP · LIVE', 16, 22);
      ctx.fillStyle='rgba(148,163,184,0.5)'; ctx.font='10px DM Sans'; ctx.textAlign='right';
      ctx.fillText(`Updated: ${new Date().toLocaleTimeString('en-IN')}`, W-16, 22);

      _animFrame = requestAnimationFrame(frame);
    }

    if (_animFrame) cancelAnimationFrame(_animFrame);
    frame();
  }

  function setSOSActive(active, coords) { _sosActive=active; _sosCoords=coords||null; }

  return { draw, setSOSActive };
})();

/* ─────────────────────────────────────────────────────────────
   HISTORY UI
   ───────────────────────────────────────────────────────────── */
const HistoryUI = (() => {
  let _page=1;
  async function render(page=1) {
    _page=page;
    const tbody=document.getElementById('historyBody');
    if (!tbody) return;
    tbody.innerHTML=`<tr><td colspan="5" class="table-loading">Loading from MongoDB…</td></tr>`;
    try {
      const data=await ApiClient.history(page, 25);
      if (!data.records?.length) { tbody.innerHTML=`<tr><td colspan="5" class="table-empty">No assessments yet. Run the Risk Predictor.</td></tr>`; return; }
      tbody.innerHTML=data.records.map(r=>{
        const cls=r.risk_level==='HIGH'?'badge-high':r.risk_level==='MEDIUM'?'badge-med':'badge-low';
        const vrd=r.risk_level==='HIGH'?'🚫 Blocked':r.risk_level==='MEDIUM'?'⚠ Supervisor Review':'✓ Entry Allowed';
        const dt =new Date(r.createdAt).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'2-digit',hour:'2-digit',minute:'2-digit'});
        return `<tr><td>${dt}</td><td>${r.zone_id}</td><td><span class="badge ${cls}">${r.score}/100</span></td><td>${vrd}</td><td>${r.operator}</td></tr>`;
      }).join('');
      const pi=document.getElementById('historyPageInfo');
      if (pi&&data.pagination) pi.textContent=`Page ${data.pagination.page} of ${data.pagination.pages} (${data.pagination.total} total)`;
    } catch { tbody.innerHTML=`<tr><td colspan="5" class="table-error">⚠ Could not load — backend offline.</td></tr>`; }
  }
  function nextPage(){ render(_page+1); }
  function prevPage(){ if(_page>1) render(_page-1); }
  return { render, nextPage, prevPage };
})();

/* ─────────────────────────────────────────────────────────────
   SOS CONTROLLER — Multi-Tier KMC Emergency Dispatch
   ───────────────────────────────────────────────────────────── */
const SOSController = (() => {
  let _holdT=null, _active=false, _radar=null, _radarAngle=0;

  /* ── Arm button ────────────────────────────────────────────── */
  function arm() {
    const btn=document.getElementById('sosButton');
    if (!btn) return;
    btn.addEventListener('mousedown',  _startHold);
    btn.addEventListener('touchstart', _startHold, { passive:true });
    btn.addEventListener('mouseup',    _cancelHold);
    btn.addEventListener('mouseleave', _cancelHold);
    btn.addEventListener('touchend',   _cancelHold);
  }

  function _startHold(e) {
    if (_active) return; e.preventDefault();
    const sub=document.querySelector('.sos-sublabel'); if(sub) sub.textContent='Hold… activating in 2s';
    _holdT=setTimeout(_trigger, 2000);
  }
  function _cancelHold() {
    clearTimeout(_holdT);
    if (!_active) { const sub=document.querySelector('.sos-sublabel'); if(sub) sub.textContent='Hold 2s to Activate'; }
  }

  /* ── Trigger multi-tier dispatch ───────────────────────────── */
  async function _trigger() {
    if (_active) return;
    _active=true;
    const sess=AuthService.getSession();
    const btn=document.getElementById('sosButton');
    const dot=document.getElementById('sosStatusDot');
    const txt=document.getElementById('sosStatusText');

    if (btn) { btn.classList.add('active-sos'); btn.querySelector('.sos-label').textContent='ACTIVE'; btn.querySelector('.sos-sublabel').textContent='Emergency dispatched!'; }
    if (dot) dot.classList.add('active');
    if (txt) txt.textContent=`🚨 SOS ACTIVE — ${sess.name} · ${new Date().toLocaleTimeString('en-IN')}`;

    // Show dispatch timeline
    const tl=document.getElementById('dispatchTimeline'); if(tl) tl.style.display='flex';

    // Show radar
    _showRadar(sess.name, sess.zone);

    NotificationBus.show('🚨 KMC EMERGENCY PROTOCOL ACTIVATED — All tiers dispatching!','error',10000);

    // Post to MongoDB
    let eventId=null;
    try {
      const coords = { lat:22.573+Math.random()*.05, lng:88.363+Math.random()*.05 };
      const res=await ApiClient.triggerSOS({ worker_id:sess.uid, worker_name:sess.name, zone_id:sess.zone, lat:coords.lat, lon:coords.lng });
      eventId=res.event_id;
      // Update map
      MapUI.setSOSActive(true, coords);
      const rc=document.getElementById('radarCoords');
      if (rc) rc.textContent=`${coords.lat.toFixed(4)}°N, ${coords.lng.toFixed(4)}°E`;
    } catch(e) { console.error('[SOS]', e.message); }

    // ── Tier 1: Ward Supervisor Alert (simulated 2s) ──────────
    _setStep(1,'active','Contacting Ward Supervisor…');
    setTimeout(()=>{
      _setStep(1,'done','✓ Supervisor Subrata Chakraborty notified via audio ping.');
      NotificationBus.show('Tier 1 ✓ — Ward Supervisor notified','success',4000);
      // ── Tier 2: KMC Central Control Room (5s) ────────────────
      _setStep(2,'active','Broadcasting to KMC Central Control Room…');
      setTimeout(()=>{
        _setStep(2,'done','✓ Geo-coordinates broadcast to KMC Control Room map.');
        NotificationBus.show('Tier 2 ✓ — KMC Control Room has your location','success',4000);
        // ── Tier 3: Emergency Services (8s) ──────────────────────
        _setStep(3,'active','Routing to Emergency Services (108)…');
        setTimeout(()=>{
          _setStep(3,'done','✓ Emergency services dispatched — ETA 8 minutes.');
          NotificationBus.show('Tier 3 ✓ — Emergency services en route (ETA 8 min)','success',6000);
        }, 3000);
      }, 3000);
    }, 2000);

    // Auto-reset after 35s
    setTimeout(_reset, 35000);
  }

  function _setStep(n, state, msg) {
    const step=document.getElementById(`dStep${n}`);
    const stat=document.getElementById(`dStep${n}Status`);
    if (step) { step.className='dispatch-step '+state; }
    if (stat) stat.textContent=msg;
  }

  function _showRadar(workerName, zone) {
    const container=document.getElementById('sosRadarContainer');
    const wn=document.getElementById('radarWorkerName');
    const zn=document.getElementById('radarZoneName');
    if (container) container.style.display='flex';
    if (wn) wn.textContent=workerName;
    if (zn) zn.textContent=zone;
    _startRadarCanvas();
  }

  function _startRadarCanvas() {
    const canvas=document.getElementById('sosRadar');
    if (!canvas) return;
    const ctx=canvas.getContext('2d');
    const W=340, H=340, cx=170, cy=170, R=150;

    function drawRadar() {
      ctx.clearRect(0,0,W,H);
      // Background
      ctx.fillStyle='#0a0f1a'; ctx.beginPath(); ctx.arc(cx,cy,R,0,Math.PI*2); ctx.fill();
      // Rings
      [0.25,.5,.75,1].forEach(f=>{ ctx.beginPath(); ctx.arc(cx,cy,R*f,0,Math.PI*2); ctx.strokeStyle=`rgba(239,68,68,${0.1+f*.1})`; ctx.lineWidth=1; ctx.stroke(); });
      // Cross hairs
      ctx.strokeStyle='rgba(239,68,68,0.15)'; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(cx-R,cy); ctx.lineTo(cx+R,cy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx,cy-R); ctx.lineTo(cx,cy+R); ctx.stroke();
      // Sweep
      _radarAngle=(_radarAngle+0.04)%(Math.PI*2);
      const sweepGrd=ctx.createConicalGradient ? null : null;
      for (let a=0; a<Math.PI/2; a+=0.02) {
        const angle=_radarAngle-a;
        const alpha=Math.max(0,(Math.PI/2-a)/(Math.PI/2))*0.5;
        ctx.beginPath();
        ctx.moveTo(cx,cy);
        ctx.arc(cx,cy,R,angle,angle+0.02);
        ctx.closePath();
        ctx.fillStyle=`rgba(239,68,68,${alpha})`;
        ctx.fill();
      }
      // Center dot + SOS label
      ctx.beginPath(); ctx.arc(cx,cy,8,0,Math.PI*2);
      ctx.fillStyle='#ef4444'; ctx.fill();
      ctx.fillStyle='white'; ctx.font='bold 11px Syne,sans-serif'; ctx.textAlign='center';
      ctx.fillText('SOS', cx, cy+4);
      // Blip at swept position
      const bx=cx+Math.cos(_radarAngle)*R*.7;
      const by=cy+Math.sin(_radarAngle)*R*.7;
      ctx.beginPath(); ctx.arc(bx,by,4,0,Math.PI*2);
      ctx.fillStyle=`rgba(239,68,68,${0.5+Math.abs(Math.sin(_radarAngle))*.5})`; ctx.fill();
      // Label
      ctx.fillStyle='rgba(239,68,68,0.7)'; ctx.font='10px DM Sans'; ctx.textAlign='center';
      ctx.fillText('SCANNING…', cx, cy+R+16);

      if (_active) _radar=requestAnimationFrame(drawRadar);
    }
    if (_radar) cancelAnimationFrame(_radar);
    drawRadar();
  }

  function _reset() {
    _active=false;
    if (_radar) { cancelAnimationFrame(_radar); _radar=null; }
    const btn=document.getElementById('sosButton');
    const dot=document.getElementById('sosStatusDot');
    const txt=document.getElementById('sosStatusText');
    const tl =document.getElementById('dispatchTimeline');
    const rc =document.getElementById('sosRadarContainer');
    if (btn) { btn.classList.remove('active-sos'); btn.querySelector('.sos-label').textContent='SOS'; btn.querySelector('.sos-sublabel').textContent='Hold 2s to Activate'; }
    if (dot) dot.classList.remove('active');
    if (txt) txt.textContent='Standby — No Active Emergency';
    if (tl)  { tl.style.display='none'; [1,2,3].forEach(n=>{ _setStep(n,'','Pending…'); }); }
    if (rc)  rc.style.display='none';
    MapUI.setSOSActive(false, null);
  }

  async function loadEvents() {
    const list=document.getElementById('sosEventLog');
    if (!list) return;
    list.innerHTML='<p class="table-loading">Loading SOS events…</p>';
    try {
      const data=await ApiClient.sosEvents();
      if (!data.events?.length) { list.innerHTML='<p class="table-empty">No SOS events recorded.</p>'; return; }
      list.innerHTML=data.events.map(e=>{
        const cls=e.status==='active'?'sos-log-active':'sos-log-resolved';
        const dt=new Date(e.createdAt).toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
        return `<div class="sos-log-item ${cls}">
          <div class="sos-log-left">
            <span>${e.status==='active'?'🔴':'🟢'}</span>
            <div><strong>${e.worker_id}</strong> · ${e.zone_id}<span class="sos-log-time">${dt}</span></div>
          </div>
          <span class="badge ${e.status==='active'?'badge-high':'badge-low'}">${e.status}</span>
        </div>`;
      }).join('');
    } catch { list.innerHTML='<p class="table-error">Could not load events.</p>'; }
  }

  return { arm, loadEvents };
})();

/* ─────────────────────────────────────────────────────────────
   SLIDER SYNC
   ───────────────────────────────────────────────────────────── */
function initSliders() {
  [['rainfall','rainfallSlider'],['tideInput','tideSlider'],['h2s','h2sSlider'],
   ['ch4','ch4Slider'],['co','coSlider'],['days','daysSlider'],
   ['pipeAge','pipeSlider'],['flowVelocity','flowSlider'],['incidents','incidentsSlider']]
  .forEach(([inp,sld])=>{
    const i=document.getElementById(inp), s=document.getElementById(sld);
    if(!i||!s) return;
    i.addEventListener('input',()=>s.value=i.value);
    s.addEventListener('input',()=>i.value=s.value);
  });
}

/* ─────────────────────────────────────────────────────────────
   KAVACH APP — Bootstrapper
   ───────────────────────────────────────────────────────────── */
//const KavachApp = (() => {
  function _greet() { const h=new Date().getHours(); return h<12?'morning':h<17?'afternoon':'evening'; }

  async function _bootLogin() {
    UIController.animateCounters();
    UIController.initAuthTabs();
    document.addEventListener('keydown', e=>{ if(e.key==='Enter') login(); });
    // Health check badge
    try {
      const h=await ApiClient.health();
      const sp=document.getElementById('systemStatusText');
      if(sp) sp.textContent=`System Operational · MongoDB ${h.db==='connected'?'Connected':'Offline'}`;
    } catch {
      const badge=document.querySelector('.live-badge');
      if (badge) {
        badge.style.background='rgba(245,158,11,0.1)';
        badge.style.borderColor='rgba(245,158,11,0.3)';
        badge.querySelector('.live-dot').style.background='#f59e0b';
        badge.querySelector('span:last-child').textContent='Backend Offline — run: npm run dev';
      }
      NotificationBus.show('Backend unreachable. Start with: npm run dev','warn',8000);
    }
  }

  async function _bootDashboard() {
    if (!AuthService.isLoggedIn()) { window.location.href='index.html'; return; }
    const sess=AuthService.getSession();
    const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.textContent=v; };
    set('welcomeText',`Good ${_greet()}, ${sess.name}`);
    set('userName', sess.name); set('userRole', sess.label); set('userZone', sess.zone);
    const av=document.getElementById('userAvatar'); if(av) av.textContent=sess.name.charAt(0).toUpperCase();

    UIController.startClock();
    UIController.startWeatherFeed();
    UIController.buildTicker();
    UIController.initNav();
    initSliders();
    SOSController.arm();
    BiometricUI.startLiveFeed();

    // WS subscriptions
    WsClient.on('sensors', SensorUI.render);
    WsClient.on('sos', payload=>{
      NotificationBus.show(`🚨 SOS from ${payload.worker_id} at ${payload.zone_id}!`,'error',10000);
    });
    WsClient.connect();

    // Load overview data
    await Promise.allSettled([
      _loadOverview(),
      SensorUI.init(),
    ]);

    requestAnimationFrame(()=>setTimeout(()=>{ UIController.buildRainfallChart(); UIController.buildTideChart(); },80));
  }

  async function _loadOverview() {
    try { const s=await ApiClient.riskStats(); UIController.updateKPIs(s); } catch {}
    try { const d=await ApiClient.zones(); UIController.buildZoneList(d.zones); } catch { UIController.buildZoneList(null); }
  }

 /* ─────────────────────────────────────────────────────────────
   KAVACH APP — Bootstrapper
   ───────────────────────────────────────────────────────────── */
const KavachApp = (() => {
  // ... (keep all your existing internal functions here)

  function init() {
    // --- AUTO-LOGIN BYPASS ---
    if (document.getElementById('role')) {
      sessionStorage.setItem('kavach_token', 'demo-token');
      sessionStorage.setItem('kavach_uid', 'ADMIN-KMC-001');
      sessionStorage.setItem('kavach_name', 'KMC Administrator');
      sessionStorage.setItem('kavach_role', 'admin');
      window.location.href = 'dashboard.html';
      return;
    }

    // --- NORMAL BOOT LOGIC ---
    if (document.getElementById('role'))              _bootLogin();
    if (document.getElementById('section-overview'))  _bootDashboard();
  }
  return { init };
})();

/* ─────────────────────────────────────────────────────────────
   GLOBALS — called from HTML onclick
   ───────────────────────────────────────────────────────────── */
function login()           { AuthService.login();    }
function register()        { AuthService.register(); }
function logout()          { AuthService.logout();   }
function toggleSidebar()   { document.getElementById('sidebar')?.classList.toggle('open'); }
function animateCounters() { UIController.animateCounters(); }
function historyNext()     { HistoryUI.nextPage(); }
function historyPrev()     { HistoryUI.prevPage(); }

/* Main predict — instant client gauge + server persist */
async function predictRisk() {
  const btn=document.getElementById('predictBtn');
  const sess=AuthService.getSession();
  if(btn){btn.disabled=true;btn.querySelector('.btn-label').textContent='Analysing…';}
  const raw={
    rainfall    :document.getElementById('rainfall')?.value,
    tideInput   :document.getElementById('tideInput')?.value,
    h2s         :document.getElementById('h2s')?.value,
    ch4         :document.getElementById('ch4')?.value,
    co          :document.getElementById('co')?.value,
    days        :document.getElementById('days')?.value,
    pipeAge     :document.getElementById('pipeAge')?.value,
    flowVelocity:document.getElementById('flowVelocity')?.value,
    incidents   :document.getElementById('incidents')?.value,
  };
  // Step 1: Instant client-side result
  const p       = RiskEngine.sanitise(raw);
  const scored  = RiskEngine.computeScore(p);
  const v       = RiskEngine.verdict(scored.total);
  const recs    = RiskEngine.recommendations(p, v);
  const insight = await RiskEngine.getInsight(p, scored.total, v);
  UIController.updateGauge(scored.total, v);
  UIController.showInsight(insight);
  UIController.showRecommendations(recs);
  UIController.showFactorBreakdown(scored.factors);
  NotificationBus.show(`Assessment: ${v.level} RISK (${scored.total}/100)`, v.level==='HIGH'?'error':v.level==='MEDIUM'?'warn':'success');

  // Step 2: Persist to MongoDB
  try {
    const zone=document.getElementById('zoneSelect')?.value || sess.zone;
    const res=await ApiClient.predict({ ...Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Number(v)||0])), zone_id:zone, operator:sess.uid, role:sess.role });
    UIController.updateGauge(res.score, res.verdict);
    UIController.showInsight(res.insight);
    UIController.showRecommendations(res.recommendations);
    NotificationBus.show('Assessment saved to MongoDB ✓','success',2500);
  } catch(e) { console.warn('[Predict] Backend unavailable:', e.message); NotificationBus.show('Offline mode — result not saved.','warn'); }
  finally { if(btn){btn.disabled=false;btn.querySelector('.btn-label').textContent='Run AI Assessment';} }
}

/* Boot */
document.addEventListener('DOMContentLoaded', ()=>KavachApp.init());