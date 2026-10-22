/* LACP Scope — OVS balance-tcp (802.3ad / LACP) MAC learning visualizer */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (s) => document.querySelector(s);

  /* ---------------- Geometry ---------------- */
  const CORE = [500, 86];
  const SW = { sw1: [280, 182], sw2: [720, 182] };
  const ATT_Y = 207, PORT_Y = 350, ADM_Y = 398, BR_TOP = 440, BR_C = 466, LOC_Y = 530, VM_Y = 598;
  const HOST = {
    A: { x0: 20, x1: 480, cx: 250, name: 'NODE A', role: 'migration source',
      px: { eno1: 85, eno2: 180, eno3: 320, eno4: 415 },
      att: { eno1: 225, eno2: 260, eno3: 665, eno4: 700 },
      vm: { web: [150, VM_Y], x: [300, VM_Y], pods: [425, VM_Y] } },
    B: { x0: 520, x1: 980, cx: 750, name: 'NODE B', role: 'migration target',
      px: { eno1: 585, eno2: 680, eno3: 820, eno4: 915 },
      att: { eno1: 300, eno2: 335, eno3: 740, eno4: 775 },
      vm: { web: [700, VM_Y], pods: [925, VM_Y] } },
  };
  const ENOS = ['eno1', 'eno2', 'eno3', 'eno4'];
  const swOf = (e) => (e === 'eno1' || e === 'eno2' ? 'sw1' : 'sw2');
  const MIG = [[150, 621], [150, 672], [700, 672], [700, 621]];

  /* ---------------- Path helpers ---------------- */
  const join = (...parts) => parts.reduce((acc, p) => {
    if (!acc.length) return p.slice();
    const l = acc[acc.length - 1], f = p[0];
    return acc.concat(l[0] === f[0] && l[1] === f[1] ? p.slice(1) : p);
  }, []);
  function up(h, vm, eno) {
    const H = HOST[h], px = H.px[eno];
    return [H.vm[vm], [H.cx, LOC_Y], [H.cx, BR_C], [px, ADM_Y], [px, PORT_Y], [H.att[eno], ATT_Y], SW[swOf(eno)]];
  }
  // Switch interconnect mode: false = MLAG pair (one LACP system-ID, Po-A/Po-B span both switches),
  // true = independent switches (two LACP system-IDs → OVS attaches only the lead aggregator, on sw1).
  let indep = false;
  // Member actually used: with independent switches only the sw1 members are attached, so sw2 choices fold onto sw1.
  const M = (e) => (indep ? ({ eno3: 'eno1', eno4: 'eno2' }[e] || e) : e);
  // to: 'att' | 'adm' | 'br' | 'local' | vmKey
  function dn(from, h, eno, to) {
    const H = HOST[h], px = H.px[eno], s = swOf(eno);
    const pts = [SW[from]];
    if (from !== s) { if (indep) pts.push(CORE); pts.push(SW[s]); }
    pts.push([H.att[eno], ATT_Y]);
    if (to === 'att') return pts;
    pts.push([px, PORT_Y], [px, ADM_Y]);
    if (to === 'adm') return pts;
    pts.push([H.cx, BR_TOP]);
    if (to === 'br') return pts;
    pts.push([H.cx, BR_C], [H.cx, LOC_Y]);
    if (to === 'local') return pts;
    pts.push(H.vm[to]);
    return pts;
  }
  const fromCore = (s) => [CORE, SW[s]];
  const toCore = (s) => [SW[s], CORE];
  const localUp = (h, vm) => { const H = HOST[h]; return [H.vm[vm], [H.cx, LOC_Y], [H.cx, BR_C], [H.cx, BR_TOP]]; };
  // Unicast from core1 to host h: core1 picks a switch (its own port-channel hash), the switch picks a member of Po-h (its LAG hash).
  const uniDown = (h, eno, to) => { const e = M(eno); return [CORE].concat(dn(swOf(e), h, e, to)); };
  // Frame from the bond up to core1 on member eno.
  const uniUp = (h, vm, eno) => { const e = M(eno); return join(up(h, vm, e), toCore(swOf(e))); };

  // Broadcast that entered switch `s` from host `srcH`. A LAG is one logical port, so the switch sends ONE copy to the other
  // host's port-channel (on the member its hash picks) and one to core1 — never back onto the source port-channel.
  function lagFlood(s, srcH, dstEno, kind, t0, t1, o = {}) {
    const h2 = srcH === 'A' ? 'B' : 'A', e2 = M(dstEno);
    const out = [
      { pts: toCore(s), k: kind, t0, t1: t0 + (t1 - t0) * 0.5, end: 'ok', dash: o.dash },
      { pts: dn(s, h2, e2, o.to || 'local'), k: kind, t0, t1, end: o.end || 'ok', note: o.note, dash: o.dash },
    ];
    if (indep) { // core1 also floods to sw2, whose host ports are not in any bundle
      const tm = t0 + (t1 - t0) * 0.5;
      out.push({ pts: [CORE, SW.sw2, [HOST[h2].att.eno3, ATT_Y]], k: kind, t0: tm, t1, end: 'drop', note: 'not attached', dash: o.dash });
    }
    return out;
  }
  // Broadcast from north of the switches (core1): one copy per port-channel.
  function coreFlood(kind, enoA, enoB, t0, t1, o = {}) {
    const out = [];
    const list = [['A', M(enoA)], ['B', M(enoB)]];
    if (!indep) {
      const tm = t0 + (t1 - t0) * 0.25;
      out.push({ pts: fromCore('sw1'), k: kind, t0, t1: tm, label: o.label, dash: o.dash });
      list.forEach(([h, e]) => out.push({ pts: dn('sw1', h, e, o.to || 'local'), k: kind, t0: tm, t1, end: (o.end && o.end[h]) || 'ok', note: o.note && o.note[h], dash: o.dash }));
    } else {
      list.forEach(([h, e], i) => out.push({ pts: [CORE].concat(dn('sw1', h, e, o.to || 'local')), k: kind, t0, t1, end: (o.end && o.end[h]) || 'ok', note: o.note && o.note[h], dash: o.dash, label: i === 0 ? o.label : undefined }));
      out.push({ pts: [CORE, SW.sw2, [HOST.B.att.eno4, ATT_Y]], k: kind, t0, t1, end: 'drop', note: 'not attached', dash: o.dash });
    }
    return out;
  }

  /* ---------------- Initial states ---------------- */
  // sw entries: where the fabric last learned a MAC — 'Po-A' / 'Po-B' (a port-channel) or 'core1'. `sw` = which switch's
  // aggregator carries it (only meaningful without MLAG).
  const LK_ALL = () => ({ A: lkDefault(), B: lkDefault() });
  function lkDefault() { return indep ? { eno1: 'cur', eno2: 'cur', eno3: 'mis', eno4: 'mis' } : { eno1: 'cur', eno2: 'cur', eno3: 'cur', eno4: 'cur' }; }
  const F = (...m) => m.map(M).filter((e, i, a) => a.indexOf(e) === i).join('+');
  const steady = () => fin({
    sw: { web: { port: 'Po-A' }, x: { port: 'Po-A' }, pA: { port: 'Po-A' }, pB: { port: 'Po-B' }, gw: { port: 'core1' } },
    A: { web: { port: 'local' }, x: { port: 'local' }, pA: { port: 'local' }, pB: { port: 'bond0' }, gw: { port: 'bond0' } },
    B: { web: { port: 'bond0' }, x: { port: 'bond0' }, pA: { port: 'bond0' }, pB: { port: 'local' }, gw: { port: 'bond0' } },
    hA: { web: F('eno2', 'eno3'), x: F('eno4'), pA: F('eno1', 'eno2', 'eno3', 'eno4') }, hB: { pB: F('eno1', 'eno2', 'eno3', 'eno4') },
    lk: LK_ALL(), down: {}, vm: 'A',
  });
  const converged = () => fin({
    sw: { web: { port: 'Po-B' }, x: { port: 'Po-A' }, pA: { port: 'Po-A' }, pB: { port: 'Po-B' }, gw: { port: 'core1' } },
    A: { web: { port: 'bond0' }, x: { port: 'local' }, pA: { port: 'local' }, pB: { port: 'bond0' }, gw: { port: 'bond0' } },
    B: { web: { port: 'local' }, x: { port: 'bond0' }, pA: { port: 'bond0' }, pB: { port: 'local' }, gw: { port: 'bond0' } },
    hA: { x: F('eno4'), pA: F('eno1', 'eno2', 'eno3', 'eno4') }, hB: { web: F('eno3', 'eno1'), pB: F('eno1', 'eno2', 'eno3', 'eno4') },
    lk: LK_ALL(), down: {}, vm: 'B',
  });
  const justMigrated = () => {
    const s = steady(); s.vm = 'B';
    patchSw(s, 'web', { stale: true }); s.A.web.stale = true; s.B.web.stale = true; delete s.hA.web;
    return s;
  };
  const coldStart = () => {
    const s = steady();
    applySw(s, 'web', null); applySw(s, 'gw', null);
    delete s.A.web; delete s.B.web; delete s.A.gw; delete s.B.gw; delete s.hA.web;
    return s;
  };
  // Day 0: LACP configured on the hosts, nothing negotiated yet
  const unnegotiated = () => {
    const s = coldStart();
    for (const h of ['A', 'B']) for (const e of ENOS) s.lk[h][e] = 'def';
    return s;
  };
  function fin(s) { s.swx = { sw1: {}, sw2: {}, core: {} }; for (const k of Object.keys(s.sw)) applySw(s, k, s.sw[k]); return s; }
  function applySw(s, k, v) {
    if (v === null) { delete s.sw[k]; delete s.swx.sw1[k]; delete s.swx.sw2[k]; delete s.swx.core[k]; return; }
    s.sw[k] = Object.assign({}, v);
    const port = v.port;
    if (port === 'core1') { s.swx.sw1[k] = { port: 'core1', fresh: v.fresh }; s.swx.sw2[k] = { port: 'core1', fresh: v.fresh }; s.swx.core[k] = { port: 'uplink', fresh: v.fresh }; return; }
    const own = v.sw || 'sw1', other = own === 'sw1' ? 'sw2' : 'sw1';
    s.swx[own][k] = { port, fresh: v.fresh };
    const prev = s.swx.core[k];
    s.swx.core[k] = { port: own, fresh: v.fresh, moved: !!(prev && prev.port !== own) };
    if (v.uni) { if (s.swx[other][k] && s.swx[other][k].port !== 'core1') s.swx[other][k].stale = true; }
    else s.swx[other][k] = { port: 'core1', fresh: v.fresh };
  }
  function patchSw(s, k, v) {
    if (s.sw[k]) Object.assign(s.sw[k], v);
    for (const t of ['sw1', 'sw2', 'core']) if (s.swx[t][k]) Object.assign(s.swx[t][k], v);
  }

  /* ---------------- Decision trace helpers ---------------- */
  const D = (cls, where, html) => ({ cls, where, html });
  const fmt = (sec) => (sec < 0 ? `T−${Math.abs(sec)} s` : `T+${Number.isInteger(sec) ? sec : sec.toFixed(3)} s`);

  /* ---------------- Reusable step builders ---------------- */
  let nReb = 2;
  // Background Kubernetes pod traffic: under balance-tcp every pod flow is hashed on L3/L4, so the pods on one node use all
  // attached members at once. Return traffic is spread by the switch's own LAG hash.
  function podTraffic(o = 0, opts = {}) {
    const out = [];
    const plan = [['A', 0, 'eno1', 'eno3'], ['B', 0.3, 'eno4', 'eno2']];
    plan.forEach(([h, d, e1, e2]) => {
      const t = o + d;
      const dead = opts.dead && opts.dead.h === h;
      const u1 = M(e1), d1 = M(e2);
      out.push({ pts: uniUp(h, 'pods', u1), k: 'pod', t0: t, t1: t + 0.3, end: dead && dead.e === u1 ? 'drop' : null });
      out.push({ pts: uniDown(h, d1, 'pods'), k: 'pod', t0: t + 0.32, t1: t + 0.62, end: null });
    });
    return out;
  }
  function lacpdus(h, t0, t1, members = ENOS) {
    return members.map((e, i) => ({ pts: [[HOST[h].px[e], PORT_Y - 15], [HOST[h].att[e], ATT_Y], SW[swOf(e)]], k: 'lacp', t0: t0 + i * 0.04, t1, end: null }));
  }
  const other = (h) => (h === 'A' ? 'B' : 'A');

  function coldStartSteps() {
    return [
      { clock: 'T−60 s', title: 'Cold start: vm-web ARPs for its gateway', doc: 'Bond packet output · LAG flooding', dur: 5200,
        body: `<p>Nothing has learned vm-web yet. Its ARP request is hashed on L3/L4 to one member — <code>${M('eno2')}</code> — and enters sw1. sw1 learns <code>vm-web → Po-A</code>: a <b>port-channel</b>, not a physical port.</p><p>A LAG is one logical port, so the switch floods exactly <b>one</b> copy to Po-B (on the member its own hash picks) and one to core1 — and <b>never back onto Po-A</b>. Node B learns <code>vm-web → bond0</code>. There is no reflection and no duplicate for OVS to filter.</p>`,
        bodyI: `<p>Nothing has learned vm-web yet. Its ARP request is hashed to <code>eno2</code> — only the two sw1 members are attached, because sw1 and sw2 present different LACP system-IDs and OVS attaches a single aggregator.</p><p>sw1 learns <code>vm-web → Po-A</code> and floods one copy to Po-B and one to core1. core1 floods on to sw2, but sw2's host ports are not in any bundle, so OVS drops whatever arrives there.</p>`,
        vm: 'A',
        frames: [{ pts: up('A', 'web', M('eno2')), k: 'bcast', t0: 0.05, t1: 0.42, end: null, label: 'ARP who-has gw' }]
          .concat(lagFlood('sw1', 'A', 'eno3', 'bcast', 0.42, 0.9)).concat(podTraffic(0.3)),
        up: [{ at: 0.1, t: 'A', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.2, t: 'hA', k: 'web', v: F('eno2') }, { at: 0.4, t: 'sw', k: 'web', v: { port: 'Po-A', fresh: true } }, { at: 0.86, t: 'B', k: 'web', v: { port: 'bond0', fresh: true } }],
        dec: [D('ok', 'sw1 · LAG forwarding', 'ingress Po-A → learn <b>vm-web → Po-A</b>; flood to Po-B (one member) + uplink; <b>not</b> back to Po-A'), D('ok', `Node B · ${M('eno3')}`, 'LACP negotiated → <b>accept on any attached member</b>; learn vm-web → bond0')] },
      { clock: 'T−59 s', title: 'The gateway answers, then broadcasts in turn', doc: 'Bond packet input', dur: 5200,
        body: `<p>The ARP reply is unicast. core1 picks a switch, that switch picks a member of Po-A — here <code>${M('eno4')}</code> — and Node A accepts it and learns <code>gw → bond0</code>. Which member the frame arrives on is the switch's choice and <b>irrelevant to OVS</b>.</p><p>When the gateway broadcasts an ARP of its own, each port-channel receives one copy on one member. Both nodes learn <code>gw → bond0</code>. Every table in the fabric now agrees.</p>`,
        vm: 'A',
        frames: [{ pts: uniDown('A', 'eno4', 'web'), k: 'uni', t0: 0.05, t1: 0.5, end: 'ok', label: 'ARP reply → vm-web' }]
          .concat(coreFlood('bcast', 'eno1', 'eno2', 0.5, 0.95, { label: 'gw ARP who-has' })).concat(podTraffic(0.05)),
        up: [{ at: 0.1, t: 'sw', k: 'gw', v: { port: 'core1', fresh: true } }, { at: 0.45, t: 'A', k: 'gw', v: { port: 'bond0', fresh: true } }, { at: 0.9, t: 'B', k: 'gw', v: { port: 'bond0', fresh: true } }],
        dec: [D('ok', `Node A · ${M('eno4')}`, 'unicast on an attached member → <b>accept</b>; learn gw → bond0'), D('ok', `Node A · ${M('eno1')}, Node B · ${M('eno2')}`, 'broadcast — one copy per LAG, accepted on whichever member it lands on; Node B learns gw → bond0')] },
    ];
  }

  // Five steps that move vm-web from `from` to `to`, announcing on `member`.
  function migrateSteps(from, to, member, base, firstTime) {
    const rev = from === 'B';
    const mig = rev ? MIG.slice().reverse() : MIG;
    const m = M(member), sw = swOf(m), hTo = to === 'A' ? 'hA' : 'hB', hFrom = from === 'A' ? 'hA' : 'hB';
    const po = `Po-${to}`, poOld = `Po-${from}`;
    const recv = M(to === 'B' ? 'eno3' : 'eno1'); // member of the OLD host's LAG the switch delivers the flood on
    return [
      { clock: fmt(base - 3), title: `Live migration ${from} → ${to}: pre-copy`, doc: 'Setup', dur: 3600,
        body: `<p>KubeVirt copies vm-web's memory to Node ${to}. vm-web keeps running on Node ${from}, so every table is still correct: switches → <code>${poOld}</code>, Node ${from} → <code>local</code>, Node ${to} → <code>bond0</code>. Pod flows keep using all attached members on both nodes.</p>`,
        vm: from, mig: true,
        frames: [0.05, 0.25, 0.45].map((t) => ({ pts: mig, k: 'mig', t0: t, t1: t + 0.45 })).concat(podTraffic(0.1)) },
      { clock: fmt(base), title: `Switchover: vm-web resumes on Node ${to}`, doc: 'Setup', dur: 3200,
        body: `<p>vm-web pauses on ${from} and resumes on ${to}. Every table is now wrong: the switches still point at <code>${poOld}</code>, Node ${from} thinks vm-web is local, Node ${to} thinks it is out the bond. LACP changes nothing here — only an announcement from the new location can fix all three.</p>`,
        vm: ['move', 0.1, 0.7, rev ? 'rev' : 'fwd'], mig: true,
        frames: podTraffic(0.2),
        up: [{ at: 0.7, t: 'patch', tb: 'sw', k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: from, k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: to, k: 'web', v: { stale: true } }, { at: 0.7, t: hFrom, k: 'web', v: null }] },
      { clock: fmt(base + 0.002), title: `GARP leaves Node ${to} on ${m}: a plain MAC move for the switches`, doc: 'Bond packet output', dur: 4000,
        body: `<p>The gratuitous ARP enters <code>br-phy</code> from the local port: Node ${to} learns <code>vm-web → local</code> (and arms the 5 s GARP lock, which will never be needed). The bond hashes the frame to <code>${m}</code>.</p><p>${sw} sees vm-web arrive on <code>${po}</code> and simply moves the entry <code>${poOld} → ${po}</code>. Because the pair sees two port-channels rather than eight ports, a migration is <b>one</b> MAC move — the same event any single-NIC host would cause.</p>`,
        vm: to,
        frames: [{ pts: up(to, 'web', m), k: 'garp', t0: 0.05, t1: 0.75, end: null, label: 'GARP' }].concat(podTraffic(0.3)),
        up: [{ at: 0.18, t: to, k: 'web', v: { port: 'local', lock: true, fresh: true } }, { at: 0.4, t: hTo, k: 'web', v: F(member, to === 'B' ? 'eno1' : 'eno3') }, { at: 0.74, t: 'sw', k: 'web', v: { port: po, fresh: true } }],
        dec: [D('ok', `${sw} · LAG forwarding`, `src vm-web on ${po} (was ${poOld}) → <b>MAC move</b> within the MLAG table, no flap`)] },
      { clock: fmt(base + 0.003), title: 'The GARP reaches the old host once — and is simply accepted', doc: 'Bond packet input · LACP', dur: 5200,
        body: `<p>The switch floods the GARP to core1 and once to <code>${poOld}</code>, on <code>${recv}</code>. Node ${from} still has <code>vm-web → local</code>, which under SLB would trigger the "looped back" drop and need the GARP exception. With LACP negotiated, OVS <b>accepts every frame on every attached member</b> — no loop logic — so Node ${from} relearns <code>vm-web → bond0</code> like any MAC move.</p><p>Nothing comes back to Node ${to}: the switch never forwards a frame out the LAG it arrived on.</p>`,
        vm: to,
        frames: lagFlood(sw, to, recv, 'garp', 0.05, 0.75, { note: 'any member' }).concat(podTraffic(0.35)),
        up: [{ at: 0.66, t: from, k: 'web', v: { port: 'bond0', fresh: true } }],
        dec: [D('ok', `Node ${from} · ${recv}`, 'LACP_NEGOTIATED → <b>BV_ACCEPT</b> (no "moved" check) · learn vm-web local → <b>bond0</b>'), D('ok', `Node ${to}`, 'no reflected copy arrives; the 5 s GARP lock has nothing to do')] },
      { clock: fmt(base + 0.01), title: `Converged on Node ${to}`, doc: 'Result', dur: 4000,
        body: `<p>The gateway reaches vm-web through <code>${po}</code>; the switch may hand each return flow to a different member, and all of them are accepted. One GARP, one MAC move, both nodes corrected in milliseconds.</p>`,
        vm: to,
        frames: [{ pts: uniDown(to, to === 'B' ? 'eno2' : 'eno4', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }, { pts: uniUp(to, 'web', m), k: 'uni', t0: 0.45, t1: 0.95, end: 'ok', label: 'vm-web → gw' }].concat(podTraffic(0.1)),
        up: [{ at: 0.1, t: 'patch', tb: 'sw', k: 'web', v: { stale: false } }, { at: 0.9, t: 'patch', tb: to, k: 'web', v: { lock: false } }] },
    ];
  }
  function rebalanceSteps(host, start, n, clock0) {
    const cycle = indep ? ['eno1', 'eno2'] : ['eno3', 'eno4', 'eno2', 'eno1'];
    const steps = [];
    let cur = M(start), idx = cycle.indexOf(cur);
    const hk = host === 'A' ? 'hA' : 'hB', po = `Po-${host}`;
    for (let i = 1; i <= n; i++) {
      idx = (idx + 1) % cycle.length;
      const nxt = cycle[idx], cross = swOf(cur) !== swOf(nxt);
      const t = clock0 + i * 10;
      steps.push({ clock: `T+${t} s`, title: `Rebalance ${i}/${n}: bucket ${cur} → ${nxt}${cross ? ' (other switch)' : ''}`, doc: 'Bond packet output · rebalance', dur: 4200,
        body: `<p>Every 10 s OVS compares per-member load and may shift one of the 256 L3/L4 hash buckets. vm-web's busiest flow moves from <code>${cur}</code> to <code>${nxt}</code>${cross ? ' — physically on the other MLAG peer' : ''}.</p><p>The switches notice <b>nothing</b>: the frame still arrives on <code>${po}</code>, the entry is unchanged, there is no MAC move, no stale table and no window of asymmetric return traffic. Rebalancing under LACP is purely a host-local decision.</p>`,
        vm: host,
        frames: [{ pts: uniUp(host, 'web', nxt), k: 'uni', t0: 0.3, t1: 0.9, end: 'ok', label: 'vm-web → gw' }].concat(podTraffic(0.05)),
        up: [{ at: 0.15, t: hk, k: 'web', v: F(nxt, host === 'B' ? 'eno1' : 'eno3') }],
        dec: [D('ok', `Node ${host} bond0 · rebalance`, `bucket(flow) <b>${cur} → ${nxt}</b>; switch entry stays <code>vm-web → ${po}</code>`)] });
      cur = nxt;
    }
    return { steps, last: cur };
  }
  function lifecycle() {
    const reb = rebalanceSteps('B', 'eno3', nReb, 0);
    const steps = []
      .concat(coldStartSteps())
      .concat(migrateSteps('A', 'B', 'eno3', 0, true))
      .concat(reb.steps)
      .concat(migrateSteps('B', 'A', 'eno2', nReb * 10 + 30, false));
    steps.push({ clock: `T+${nReb * 10 + 31} s`, title: 'Back on Node A — what the fabric saw', doc: 'Summary', dur: 4200,
      body: `<p>Two migrations and ${nReb} rebalance${nReb === 1 ? '' : 's'}: the switches saw exactly <b>two</b> MAC moves (<code>Po-A → Po-B → Po-A</code>) — the rebalances were invisible, and no frame was ever reflected or duplicated.</p><p>Pod traffic was spread across every attached member the whole time, in both directions.</p>`,
      vm: 'A',
      frames: [{ pts: uniDown('A', 'eno2', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }].concat(podTraffic(0.1)) });
    return { id: 'life', n: '2', name: 'Lifecycle: migrate → rebalance ×N → migrate back', init: coldStart, steps };
  }

  /* ---------------- Scenarios ---------------- */
  function buildScenarios() { return [
    {
      id: 'baseline', n: '0', name: 'How LACP + balance-tcp works', init: () => { const s = steady(); applySw(s, 'web', null); for (const h of ['A', 'B']) for (const e of ENOS) s.lk[h][e] = 'def'; return s; },
      steps: [
        { clock: 'T−5 s', title: 'LACP negotiation: four links, one partner', doc: 'LACP bonding', dur: 4200,
          body: `<p>Each member exchanges LACPDUs with the switch it is cabled to. Both MLAG peers advertise the <b>same system-ID</b>, so all four partners match and OVS attaches all four members to one aggregator; the switches bundle their four ports into <code>Po-A</code>.</p><p>Until this completes most switches keep the ports blocked (see #1). Afterwards, per the OVS docs, "there is no need for special handling of received packets".</p>`,
          bodyI: `<p>Each member exchanges LACPDUs with the switch it is cabled to. sw1 and sw2 are <b>not</b> an MLAG pair, so they advertise different system-IDs. OVS picks a lead member (lowest LACP priority / port-id → <code>eno1</code>) and attaches only members whose partner matches: <code>eno1</code> and <code>eno2</code>. eno3/eno4 stay out of sync; sw2 keeps them out of its bundle.</p>`,
          vm: 'A',
          frames: lacpdus('A', 0.05, 0.5).concat(lacpdus('B', 0.15, 0.6)),
          up: [{ at: 0.55, t: 'lk', k: 'A', v: lkDefault() }, { at: 0.65, t: 'lk', k: 'B', v: lkDefault() }],
          dec: [D('ok', 'Node A lacp', indep ? 'lead = eno1 (partner sw1) · eno2 partner == lead → <b>attached</b> · eno3/eno4 partner ≠ lead → <b>not attached</b>' : 'all partners share one system-ID → <b>4/4 attached</b>, negotiated')],
          decI: [D('warn', 'Node A lacp', 'lead = eno1 (partner sw1) · eno2 partner == lead → <b>attached</b> · eno3/eno4 partner ≠ lead → <b>not attached</b> (lacp_update_attached)')] },
        { clock: 'T+0.000 s', title: 'vm-web transmits — balance-tcp picks a member per flow', doc: 'Bond packet output', dur: 3600,
          body: `<p>For every frame leaving the bond, OVS hashes <b>L2 + L3 + L4</b> (MACs, IPs, ports) into one of 256 buckets. This TCP flow lands on <code>${M('eno2')}</code>.</p><p>sw1 learns <code>vm-web → Po-A</code>. The physical port is irrelevant to the switch — the LAG is the port.</p>`,
          vm: 'A',
          frames: [{ pts: uniUp('A', 'web', 'eno2'), k: 'uni', t0: 0.05, t1: 0.7, end: 'ok', label: 'flow 1 → gw' }],
          up: [{ at: 0.42, t: 'sw', k: 'web', v: { port: 'Po-A', fresh: true } }, { at: 0.1, t: 'hA', k: 'web', v: F('eno2') }],
          dec: [D('ok', 'Node A bond0 · output', `hash(src/dst MAC, IPs, TCP ports) → bucket → <b>${M('eno2')}</b>`)] },
        { clock: 'T+0.001 s', title: 'Same MAC, second flow, different member — no MAC move', doc: 'Bond packet output', dur: 3600,
          body: `<p>vm-web opens a second connection. It hashes to <code>${M('eno3')}</code>${indep ? '' : ' on the <b>other switch</b>'}. One VM now uses two links at once — the thing SLB can never do.</p><p>The switch table does not change: both frames arrived on <code>Po-A</code>. Under SLB this would have been a MAC move between switch ports.</p>`,
          vm: 'A',
          frames: [{ pts: uniUp('A', 'web', 'eno3'), k: 'uni', t0: 0.05, t1: 0.7, end: 'ok', label: 'flow 2 → gw' }],
          up: [{ at: 0.1, t: 'hA', k: 'web', v: F('eno2', 'eno3') }],
          dec: [D('ok', `${swOf(M('eno3'))} · LAG forwarding`, 'src vm-web on Po-A — already learned → <b>no change</b>')] },
        { clock: 'T+0.002 s', title: 'Return traffic: the switch hashes too, OVS accepts anywhere', doc: 'Bond packet input', dur: 3600,
          body: `<p>Replies for the two flows come back on whichever members the <b>switch's</b> hash picks — not necessarily the ones OVS sent on. Ingress and egress are independent, and that is fine: with LACP negotiated OVS accepts every frame on every attached member.</p>`,
          vm: 'A',
          frames: [{ pts: uniDown('A', 'eno4', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'flow 1 ← gw' }, { pts: uniDown('A', 'eno1', 'web'), k: 'uni', t0: 0.3, t1: 0.85, end: 'ok', label: 'flow 2 ← gw' }],
          dec: [D('ok', `Node A · ${M('eno4')}, ${M('eno1')}`, 'bond_check_admissibility: LACP_NEGOTIATED, member enabled → <b>BV_ACCEPT</b>')] },
        { clock: 'T+0.003 s', title: 'Pod network: one MAC, but many flows — now balanced', doc: 'Bond packet output', dur: 4000,
          body: `<p>Every pod flow leaves <code>br-ex</code> with the node's MAC, yet each has its own IPs and ports, so the flows spread over all attached members. Under SLB the whole pod network was pinned to one link; under balance-tcp it uses ${indep ? 'both' : 'all four'}.</p>`,
          vm: 'A',
          frames: [['eno1', 0.05], ['eno3', 0.2], ['eno2', 0.35], ['eno4', 0.5]].map(([e, t]) => ({ pts: uniUp('A', 'pods', e), k: 'pod', t0: t, t1: t + 0.45, end: 'ok' })).concat([{ pts: uniDown('A', 'eno2', 'pods'), k: 'pod', t0: 0.5, t1: 0.95, end: null }]),
          dec: [D('ok', 'Node A bond0 · output', `hash(node MAC, pod/dst IPs, ports) → <b>${indep ? 'eno1 or eno2' : 'eno1…eno4'}</b> per flow`)] },
        { clock: 'T+10 s', title: 'Rebalance: a bucket moves — the switches do not notice', doc: 'Bond packet output · rebalance', dur: 3600,
          body: `<p>Every 10 s OVS may shift one bucket from the busiest member to the lightest. vm-web's flow 1 moves from <code>${M('eno2')}</code> to <code>${M('eno4')}</code>.</p><p>No learning packet is sent and none is needed: the switch entry is still <code>vm-web → Po-A</code>. There is no stale port and no asymmetric window — the SLB "MAC flapping" risk does not exist.</p>`,
          vm: 'A',
          frames: [{ pts: uniUp('A', 'web', 'eno4'), k: 'uni', t0: 0.3, t1: 0.9, end: 'ok', label: 'flow 1 → gw' }],
          up: [{ at: 0.2, t: 'hA', k: 'web', v: F('eno4', 'eno3') }],
          dec: [D('ok', 'Node A bond0 · rebalance', `bucket(flow 1) <b>${M('eno2')} → ${M('eno4')}</b>; switch table unchanged`)] },
        { clock: 'T+10.01 s', title: 'Broadcast from the VM: one copy per LAG, never reflected', doc: 'LAG flooding', dur: 5000,
          body: `<p>vm-web sends an ARP request. It leaves on one member and the switch floods it once to <code>Po-B</code> and once to core1 — <b>not</b> to the other three members of Po-A. OVS's SLB rules (accept broadcast on one member only, drop "looped back" frames) are simply not in play; with LACP every arriving frame is admitted.</p>`,
          vm: 'A',
          frames: [{ pts: up('A', 'web', M('eno3')), k: 'bcast', t0: 0.05, t1: 0.42, end: null, label: 'ARP' }].concat(lagFlood(swOf(M('eno3')), 'A', 'eno1', 'bcast', 0.42, 0.9)),
          dec: [D('ok', `${swOf(M('eno3'))} · LAG forwarding`, 'flood to every port except the ingress <b>LAG</b>: Po-B (one member) + uplink'), D('ok', `Node B · ${M('eno1')}`, 'broadcast on an attached member → <b>accept</b> (no active-member rule)')] },
      ],
    },
    {
      id: 'happy', n: '1', name: 'Cold start → migration (happy path)', init: coldStart,
      steps: [...coldStartSteps(), ...migrateSteps('A', 'B', 'eno3', 0, true)],
    },
    lifecycle(),
    {
      id: 'ex1', n: '#1', bad: true, name: 'LACP not negotiated (day 0)', init: unnegotiated,
      steps: [
        { clock: 'T+0 s', title: 'Hosts configured for LACP, switch ports not yet', doc: 'OVS docs · LACP bonding', dur: 4200,
          body: `<p>OVS sends LACPDUs on all four members and hears nothing back: the switch team has not configured the port-channels yet (or the ports are plain access ports). Every member is <b>defaulted</b>, the bond is <b>not negotiated</b>.</p><p>With the default <code>lacp-fallback-ab=false</code>, OVS <b>disables the bond</b>: nothing is sent and anything received is dropped. The OVS docs call out that this interruption "may be relatively long, if different people are responsible for managing the switches and the OVS host".</p>`,
          vm: 'A',
          frames: lacpdus('A', 0.05, 0.4).concat(lacpdus('B', 0.1, 0.45)).concat([{ pts: localUp('A', 'web'), k: 'bcast', t0: 0.5, t1: 0.8, end: 'drop', note: 'no enabled member', label: 'ARP' }]),
          dec: [D('drop', 'Node A bond0 · output', 'lacp_status = CONFIGURED, fallback off → no enabled member → <b>drop</b>'), D('drop', 'Node A · any member', 'bond_check_admissibility: LACP_CONFIGURED, !lacp_fallback_ab → <b>BV_DROP</b>')] },
        { clock: 'T+1 s', title: 'And the switch side blocks too', doc: 'OVS docs · LACP bonding', dur: 4000,
          body: `<p>Once the switch ports <i>are</i> configured for LACP but the bundle has not formed, most switches keep them blocked as well. Inbound frames die at the port. The node is unreachable from both directions until the handshake completes — including the Kubernetes node itself, not just VMs.</p>`,
          vm: 'A',
          frames: [{ pts: [CORE, SW.sw1, [HOST.A.att.eno1, ATT_Y]], k: 'uni', t0: 0.05, t1: 0.5, end: 'drop', note: 'port blocked', label: 'gw → node A' }, { pts: [CORE, SW.sw2, [HOST.B.att.eno4, ATT_Y]], k: 'uni', t0: 0.25, t1: 0.7, end: 'drop', note: 'port blocked' }] },
        { clock: 'T+1 s', whatif: 'Hypothetical — other_config:lacp-fallback-ab=true', title: 'With lacp-fallback-ab: active-backup on one link', doc: 'vswitch.conf.db · lacp-fallback-ab', dur: 4600,
          body: `<p>With <code>lacp-fallback-ab=true</code>, defaulted members are still attached and the bond behaves as <b>active-backup</b>: all traffic on one member (<code>eno1</code>), the rest idle. This only helps while the switch port forwards as an individual port — if the switch blocks un-negotiated LACP ports, fallback changes nothing.</p><p>"In both the cases, once the partner switch is configured to LACP mode, the bond will use LACP."</p>`,
          vm: 'A',
          frames: [{ pts: uniUp('A', 'web', 'eno1'), k: 'uni', t0: 0.05, t1: 0.5, end: 'ok', label: 'vm-web → gw' }, { pts: [CORE].concat(dn('sw1', 'A', 'eno1', 'web')), k: 'uni', t0: 0.45, t1: 0.9, end: 'ok', label: 'gw → vm-web' }],
          up: [{ at: 0.02, t: 'lk', k: 'A', v: { eno1: 'ab', eno2: 'def', eno3: 'def', eno4: 'def' } }, { at: 0.03, t: 'A', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.3, t: 'sw', k: 'web', v: { port: 'A·eno1 (no LAG)', fresh: true } }, { at: 0.05, t: 'hA', k: 'web', v: 'eno1' }],
          dec: [D('warn', 'Node A lacp', 'all members DEFAULTED + fallback_ab → attached, bond mode <b>active-backup</b>, active = eno1')] },
        { clock: 'T+120 s', title: 'Switch configured → LACP converges, all four attach', doc: 'LACP bonding', dur: 4200,
          body: `<p>The port-channels come up on the switches, LACPDUs flow both ways, and within a few exchanges every member is <b>current</b> and attached. From here on the bond is a normal 4-link LAG. <b>Mitigate:</b> sequence day-0 work so the switch side is ready first, or enable fallback and accept single-link bandwidth until it is.</p>`,
          vm: 'A',
          frames: lacpdus('A', 0.05, 0.4).concat(lacpdus('B', 0.1, 0.45)).concat([{ pts: uniUp('A', 'web', 'eno3'), k: 'uni', t0: 0.55, t1: 0.95, end: 'ok', label: 'vm-web → gw' }]),
          up: [{ at: 0.45, t: 'lk', k: 'A', v: lkDefault() }, { at: 0.5, t: 'lk', k: 'B', v: lkDefault() }, { at: 0.5, t: 'sw', k: 'web', v: { port: 'Po-A', fresh: true } }, { at: 0.5, t: 'hA', k: 'web', v: F('eno3') }] },
      ],
    },
    {
      id: 'ex2', n: '#2', bad: true, name: 'MLAG peer-link failure → two LACP systems', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'The peer-link fails: sw1 and sw2 stop being one system', doc: 'LACP · partner system-ID', dur: 4200,
          body: `<p>LACP across two switches works only because MLAG makes them one LACP partner. When the peer-link goes down, the pair splits. Typically the secondary (<b>sw2</b>) suspends its MLAG member ports or starts advertising its own system-ID; either way the LACPDUs Node B receives on <code>eno3/eno4</code> no longer match the ones on <code>eno1/eno2</code>.</p>`,
          bodyI: `<p>In <b>Independent</b> mode this scenario is the steady state: sw1 and sw2 already present different system-IDs, so eno3/eno4 were never attached. The steps below show how OVS gets there from a working MLAG.</p>`,
          vm: 'B', pl: 'fail',
          frames: lacpdus('B', 0.3, 0.7, ['eno3', 'eno4']).concat(podTraffic(0.05)),
          up: [{ at: 0.6, t: 'lk', k: 'B', v: { eno1: 'cur', eno2: 'cur', eno3: 'mis', eno4: 'mis' } }, { at: 0.6, t: 'lk', k: 'A', v: { eno1: 'cur', eno2: 'cur', eno3: 'mis', eno4: 'mis' } }],
          dec: [D('warn', 'Node B lacp', 'partner.sys_id on eno3/eno4 ≠ lead\'s partner → <code>lacp_update_attached</code> sets <b>attached = false</b>')] },
        { clock: 'T+0.1 s', title: 'Flows on the detached members are dropped until they rehash', doc: 'Bond packet output / input', dur: 4600,
          body: `<p>Until OVS has processed the change, frames hashed to <code>eno3</code> are still sent — and the switch, with the port out of the bundle, drops them or returns nothing. Inbound frames the switch still delivers on eno3/eno4 are dropped by OVS: "we drop packets on disabled members".</p><p>Then the buckets move to <code>eno1/eno2</code>. The bond is up, with <b>half its links</b> and all traffic on one switch.</p>`,
          vm: 'B', pl: 'fail',
          frames: [{ pts: up('B', 'web', 'eno3').slice(0, 6), k: 'uni', t0: 0.05, t1: 0.35, end: 'drop', note: 'not attached', label: 'vm-web → gw' }, { pts: [CORE, SW.sw2, [HOST.B.att.eno4, ATT_Y], [HOST.B.px.eno4, PORT_Y], [HOST.B.px.eno4, ADM_Y]], k: 'uni', t0: 0.15, t1: 0.5, end: 'drop', note: 'disabled member' }, { pts: join(up('B', 'web', 'eno2'), toCore('sw1')), k: 'uni', t0: 0.55, t1: 0.95, end: 'ok', label: 'vm-web → gw' }],
          up: [{ at: 0.5, t: 'hB', k: 'web', v: 'eno2+eno1' }, { at: 0.5, t: 'hB', k: 'pB', v: 'eno1+eno2' }, { at: 0.5, t: 'hA', k: 'pA', v: 'eno1+eno2' }, { at: 0.5, t: 'hA', k: 'x', v: 'eno1' }],
          dec: [D('drop', 'Node B · eno4 (input)', 'member not enabled → <b>BV_DROP</b>'), D('warn', 'Node B bond0 · output', 'buckets on eno3/eno4 reassigned to <b>eno1/eno2</b>')] },
        { clock: 'T+1 s', title: 'Degraded but up — and silent about it', doc: 'Risk', dur: 4200,
          body: `<p>Everything works at 50% capacity through sw1 alone. Nothing in Kubernetes is unhealthy; only <code>ovs-appctl lacp/show</code> or <code>bond/show</code> reveals two members "not attached". If sw1 now fails too, the lead flips to eno3 (partner sw2) and traffic moves — after LACP timers (#3).</p><p><b>Mitigate:</b> monitor LACP state on both ends, alert on MLAG peer-link health, and make sure the MLAG system-ID is identical on both peers.</p>`,
          vm: 'B', pl: 'fail',
          frames: [{ pts: [CORE].concat(dn('sw1', 'B', 'eno1', 'web')), k: 'uni', t0: 0.05, t1: 0.5, end: 'ok', label: 'gw → vm-web' }, { pts: uniUp('B', 'pods', 'eno2'), k: 'pod', t0: 0.1, t1: 0.5, end: 'ok' }, { pts: uniUp('A', 'pods', 'eno1'), k: 'pod', t0: 0.3, t1: 0.7, end: 'ok' }] },
      ],
    },
    {
      id: 'ex3', n: '#3', bad: true, name: 'Silent failure & LACP timers', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'A link stays up but stops forwarding', doc: 'lacp-time', dur: 4600,
          body: `<p>A switch line-card hangs, a transceiver fails one-way, or a port is errdisabled without dropping carrier: <code>B·eno3</code> keeps link but LACPDUs stop arriving. OVS has no carrier event, so the member stays <b>enabled</b> and buckets keep sending into the hole — vm-web's flow and every pod flow hashed to eno3 are black-holed.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', M('eno3')).slice(0, 6), k: 'uni', t0: 0.05, t1: 0.4, end: 'drop', note: 'black hole', label: 'vm-web → gw' }, { pts: up('B', 'pods', M('eno3')).slice(0, 6), k: 'pod', t0: 0.3, t1: 0.65, end: 'drop' }, { pts: uniUp('B', 'pods', 'eno1'), k: 'pod', t0: 0.5, t1: 0.9, end: 'ok' }],
          up: [{ at: 0.02, t: 'lk', k: 'B', v: indep ? { eno1: 'cur', eno2: 'sil', eno3: 'mis', eno4: 'mis' } : { eno1: 'cur', eno2: 'cur', eno3: 'sil', eno4: 'cur' } }],
          dec: [D('drop', `Node B · ${M('eno3')}`, 'carrier up · LACP rx timer running · still <b>enabled</b> → frames sent, nothing arrives')] },
        { clock: 'T+90 s', title: 'Slow timers: 3 × 30 s before OVS reacts', doc: 'lacp-time = slow (default)', dur: 4600,
          body: `<p>With the default <code>lacp-time=slow</code>, LACPDUs are expected every 30 s and a member is marked <b>expired</b> after three misses — <b>90 s</b> — then defaulted and detached. Only then do its buckets move. For those 90 s part of vm-web's traffic and roughly a quarter of the node's pod flows are gone, while everything else looks healthy.</p>`,
          vm: 'B',
          frames: [{ pts: uniUp('B', 'web', 'eno4'), k: 'uni', t0: 0.5, t1: 0.95, end: 'ok', label: 'vm-web → gw' }].concat(podTraffic(0.4)),
          up: [{ at: 0.2, t: 'lk', k: 'B', v: indep ? { eno1: 'cur', eno2: 'exp', eno3: 'mis', eno4: 'mis' } : { eno1: 'cur', eno2: 'cur', eno3: 'exp', eno4: 'cur' } }, { at: 0.45, t: 'hB', k: 'web', v: F('eno4', 'eno1') }, { at: 0.45, t: 'hB', k: 'pB', v: F('eno1', 'eno2', 'eno4') }],
          dec: [D('warn', `Node B lacp · ${M('eno3')}`, 'rx timer = LACP_RX_MULTIPLIER (3) × 30 000 ms → <b>expired → defaulted → not attached</b>'), D('ok', 'Node B bond0', 'buckets reassigned; switch side removed the port from Po-B via its own timeout')] },
        { clock: 'T+3 s', whatif: 'Hypothetical — other_config:lacp-time=fast on host and switch', title: 'Fast timers: the same failure lasts 3 s', doc: 'lacp-time = fast', dur: 4200,
          body: `<p>With <code>lacp-time=fast</code> (and the equivalent on the switch) heartbeats are every 1 s and the member is expired after <b>3 s</b>. The black-hole window shrinks 30×. <b>Mitigate:</b> set fast timers on both ends; consider <code>bond-detect-mode=miimon</code> only as a complement, since it does not catch a forwarding-plane failure either.</p>`,
          vm: 'B',
          frames: [{ pts: uniUp('B', 'web', 'eno4'), k: 'uni', t0: 0.2, t1: 0.65, end: 'ok', label: 'vm-web → gw' }].concat(podTraffic(0.1)),
          dec: [D('ok', `Node B lacp · ${M('eno3')}`, 'rx timer = 3 × 1 000 ms → detached after <b>3 s</b>')] },
      ],
    },
    {
      id: 'ex4', n: '#4', bad: true, name: 'RARP-only announcement after migration', init: justMigrated,
      steps: [
        { clock: 'T+0.002 s', title: 'The hypervisor announces with RARP, not GARP', doc: 'QEMU announce-self', dur: 5200,
          body: `<p>After switchover QEMU's self-announce is a <b>broadcast RARP</b>, and OVN sends GARP only for ports whose IP it knows. Under SLB this was the top risk: a RARP arriving at the old host for a MAC it thinks is local is dropped as a loop, leaving Node A stale for up to the aging time.</p><p>Under LACP there is no loop rule. The RARP leaves Node B, the switches move <code>vm-web</code> to <code>Po-B</code>, and the single copy delivered to Po-A is <b>accepted and learned</b> by Node A like any other frame.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', M('eno4')), k: 'rarp', t0: 0.05, t1: 0.42, end: null, label: 'RARP' }].concat(lagFlood(swOf(M('eno4')), 'B', 'eno1', 'rarp', 0.42, 0.9, { note: 'accepted, learned' })),
          up: [{ at: 0.1, t: 'B', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.2, t: 'hB', k: 'web', v: F('eno4') }, { at: 0.4, t: 'sw', k: 'web', v: { port: 'Po-B', fresh: true } }, { at: 0.86, t: 'A', k: 'web', v: { port: 'bond0', fresh: true } }],
          dec: [D('ok', `Node A · ${M('eno1')}`, 'LACP_NEGOTIATED → <b>BV_ACCEPT</b> regardless of frame type; mac_learning: vm-web local → <b>bond0</b>'), D('ok', 'switches', 'any frame from vm-web on Po-B → <b>MAC move Po-A → Po-B</b>')] },
        { clock: 'T+0.010 s', title: 'Converged — the GARP-vs-RARP distinction no longer matters', doc: 'Result', dur: 4000,
          body: `<p>Everything that SLB needed the GARP exception for is handled by the switch not reflecting frames onto their source LAG. Any frame from the VM's new location — GARP, RARP, or its first data packet — corrects every table.</p>`,
          vm: 'B',
          frames: [{ pts: uniDown('B', 'eno2', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }, { pts: [HOST.A.vm.x, [HOST.A.cx, LOC_Y], [HOST.A.cx, BR_C], [HOST.A.px[M('eno3')], ADM_Y], [HOST.A.px[M('eno3')], PORT_Y], [HOST.A.att[M('eno3')], ATT_Y], SW[swOf(M('eno3'))]].concat(dn(swOf(M('eno3')), 'B', M('eno4'), 'web').slice(1)), k: 'uni', t0: 0.4, t1: 0.95, end: 'ok', label: 'vm-x → vm-web' }],
          up: [{ at: 0.05, t: 'patch', tb: 'sw', k: 'web', v: { stale: false } }, { at: 0.05, t: 'patch', tb: 'A', k: 'web', v: { stale: false } }, { at: 0.05, t: 'patch', tb: 'B', k: 'web', v: { stale: false } }] },
        { clock: 'T+0.010 s', whatif: 'Hypothetical — no announcement at all after switchover', title: 'Residual risk: no announcement of any kind', doc: 'mac-aging-time', dur: 4600,
          body: `<p>If nothing is sent from the new location (announce disabled, guest silent), the switches keep <code>vm-web → Po-A</code> and deliver inbound traffic to Node A, whose <code>br-phy</code> still says <i>local</i> — into an empty slot. This clears as soon as vm-web transmits anything, or after aging (OVS default 300 s). That is the same exposure as a single-NIC host; LACP neither adds to nor removes it.</p>`,
          vm: 'B',
          frames: [{ pts: uniDown('A', 'eno2', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'drop', note: 'vm gone', label: 'gw → vm-web' }],
          up: [{ at: 0.02, t: 'sw', k: 'web', v: { port: 'Po-A', stale: true } }, { at: 0.02, t: 'A', k: 'web', v: { port: 'local', wrong: true } }, { at: 0.02, t: 'B', k: 'web', v: { port: 'bond0', wrong: true } }] },
      ],
    },
    {
      id: 'ex5', n: '#5', bad: true, name: 'Hash polarization & elephant flows', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'One flow never spans two links', doc: 'balance-tcp hashing', dur: 4600,
          body: `<p>Per-flow hashing keeps packets in order, so a single TCP connection — a storage mount, a backup stream, a live-migration transfer — is capped at <b>one link's</b> bandwidth no matter how many members the bond has. Here a 10 Gb elephant flow saturates <code>${M('eno3')}</code> while the other links idle.</p>`,
          vm: 'B',
          frames: [0, 0.12, 0.24, 0.36, 0.48].map((t) => ({ pts: uniUp('B', 'web', 'eno3'), k: 'uni', t0: t, t1: t + 0.4, end: null, label: t === 0 ? 'elephant flow' : undefined })).concat(podTraffic(0.2)) ,
          dec: [D('warn', 'Node B bond0 · output', `one 5-tuple → one bucket → <b>${M('eno3')}</b>; rebalancing cannot split a flow`)] },
        { clock: 'T+10 s', title: 'Rebalance can only move whole buckets away from it', doc: 'bond_rebalance', dur: 4200,
          body: `<p>OVS sees ${M('eno3')} overloaded and migrates <i>other</i> buckets off it, so the pod flows that shared the link move. The elephant stays. Also note the two sides hash independently — the switch's return-path hash (often L3 only) may stack several flows on one member regardless of what OVS does.</p><p><b>Mitigate:</b> set expectations that LACP gives N × bandwidth only across many flows; use <code>bond-rebalance-interval</code> and switch hash-mode consistently.</p>`,
          vm: 'B',
          frames: [0, 0.15, 0.3].map((t) => ({ pts: uniUp('B', 'web', 'eno3'), k: 'uni', t0: t, t1: t + 0.4, end: null })).concat([{ pts: uniUp('B', 'pods', 'eno4'), k: 'pod', t0: 0.3, t1: 0.7, end: 'ok' }, { pts: uniUp('B', 'pods', 'eno1'), k: 'pod', t0: 0.45, t1: 0.85, end: 'ok' }]),
          up: [{ at: 0.25, t: 'hB', k: 'pB', v: F('eno1', 'eno2', 'eno4') }] },
      ],
    },
    {
      id: 'fail', n: '+', name: 'Related: member link down', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'B·eno3 loses carrier: disabled at once, buckets move', doc: 'Enabling and disabling members', dur: 4600,
          body: `<p>A real link-down is the easy case. OVS disables the member immediately (subject to <code>downdelay</code>), LACP on the switch drops the port from <code>Po-B</code>, and vm-web's bucket moves to <code>${M('eno4')}</code>. OVS also sends its "gratuitous learning packet" — a RARP per local MAC — on the new member; for a LAG partner that is redundant but harmless, since the MAC is still on Po-B.</p>`,
          vm: 'B',
          frames: [{ pts: uniUp('B', 'web', 'eno4'), k: 'rarp', t0: 0.4, t1: 0.75, end: 'ok', label: 'learning RARP' }].concat(podTraffic(0.3)),
          up: [{ at: 0.2, t: 'down', k: `B.${M('eno3')}`, v: true }, { at: 0.2, t: 'lk', k: 'B', v: indep ? { eno1: 'cur', eno2: 'down', eno3: 'mis', eno4: 'mis' } : { eno1: 'cur', eno2: 'cur', eno3: 'down', eno4: 'cur' } }, { at: 0.35, t: 'hB', k: 'web', v: F('eno4', 'eno1') }, { at: 0.35, t: 'hB', k: 'pB', v: F('eno1', 'eno2', 'eno4') }],
          dec: [D('ok', 'Node B bond0', `carrier down → member disabled → buckets → <b>${M('eno4')}</b>; bundle_send_learning_packets()`), D('ok', 'switches', 'port leaves Po-B; entry <code>vm-web → Po-B</code> unchanged — <b>no MAC move</b>')] },
        { clock: 'T+0.01 s', title: 'Return traffic re-hashes on the switch side', doc: 'Result', dur: 4000,
          body: `<p>The switch's LAG hash now spreads Po-B traffic over the three remaining members. No table changed anywhere; the only loss was in-flight frames on the dead link. Compare SLB, where the same event is a MAC move on the switches and may need the learning RARP to be honoured.</p>`,
          vm: 'B',
          frames: [{ pts: uniDown('B', 'eno2', 'web'), k: 'uni', t0: 0.05, t1: 0.55, end: 'ok', label: 'gw → vm-web' }, { pts: uniDown('B', 'eno1', 'pods'), k: 'pod', t0: 0.3, t1: 0.8, end: 'ok' }] },
      ],
    },
  ]; }
  let SCEN = buildScenarios();

  const RISKS = [
    { sev: 'sev', tag: 'High', title: 'LACP across two switches needs MLAG — and depends on it staying healthy', scen: 'ex2',
      html: `A LAG must terminate on one LACP system. With MLAG/vPC the pair presents one system-ID and all four members attach. If the peer-link fails, or the two peers are ever configured with different system-IDs, OVS attaches only the aggregator of its lead member: two links on one switch, silently. Switch the toolbar to <b>Independent</b> to see that steady state. <b>Mitigate:</b> verify identical MLAG system-ID/priority on both peers, monitor <code>ovs-appctl lacp/show</code> for "attached: false", alert on peer-link state.` },
    { sev: 'sev', tag: 'High', title: 'Day-0 ordering: the bond is dead until LACP negotiates', scen: 'ex1',
      html: `With default <code>lacp-fallback-ab=false</code> an un-negotiated bond drops everything in both directions, and most switches block LACP ports until the bundle forms. A node (not just its VMs) is unreachable until host and switch config both exist. <b>Mitigate:</b> configure the switch first; consider <code>lacp-fallback-ab=true</code> only if the switch forwards individual ports while LACP is down; test the ordering before rolling out to many nodes.` },
    { sev: '', tag: 'Medium', title: 'Slow LACP timers leave silent failures undetected for 90 s', scen: 'ex3',
      html: `A member that keeps carrier but stops forwarding is only removed after 3 missed LACPDUs: 90 s with the default <code>lacp-time=slow</code>, 3 s with <code>fast</code>. During that window every bucket hashed to it — part of each VM's flows and about a quarter of pod flows — is black-holed. <b>Mitigate:</b> <code>other_config:lacp-time=fast</code> on the bond and fast rate on the switch ports.` },
    { sev: '', tag: 'Medium', title: 'One flow, one link: elephant flows do not spread', scen: 'ex5',
      html: `balance-tcp hashes per flow; a single connection is capped at one link and rebalancing can only move other buckets off it. The switch hashes return traffic independently (often L3-only), so the two directions may use different members. <b>Mitigate:</b> set bandwidth expectations per flow, align switch hash mode (L3+L4) with the host, keep <code>bond-rebalance-interval</code> at a sane value.` },
    { sev: 'ok', tag: 'Low', title: 'Migration still needs a frame from the new location', scen: 'ex4',
      html: `Any frame — GARP, RARP or data — corrects the switches (one MAC move, Po-A → Po-B) and the old host, because LACP admits everything on attached members and the switch never reflects onto the source LAG. The SLB-specific RARP black hole is gone; the only residual is a VM that stays silent after switchover, which ages out at 300 s like on any host.` },
    { sev: 'ok', tag: 'Low', title: 'Rebalancing and failover are invisible to the switches', scen: 'life',
      html: `Buckets move between members of the same port-channel, so there is no MAC move, no flap detection, no stale return path. The learning RARPs OVS sends after a member failure are redundant for a LAG partner but harmless.` },
    { sev: 'ok', tag: 'Expectation', title: 'Pod traffic is finally balanced — per flow', scen: 'baseline',
      html: `The <b>pods</b> square still shares the node MAC, but every flow has its own L3/L4 tuple, so pod traffic uses all attached members in both directions. Expect N × bandwidth for many flows, 1 × for any single flow.` },
    { sev: 'ok', tag: 'Expectation', title: 'Supportability and switch features', scen: 'baseline',
      html: `802.3ad on the OpenShift <code>br-ex</code>/<code>br-phy</code> bond is the mode Red Hat documents alongside active-backup; confirm the exact MLAG + OVS LACP combination (system-ID handling, <code>lacp-time</code>, suspend-individual behaviour) with Red Hat and the switch vendor before cut-over.` },
  ];

  /* ---------------- Timeline flattening ---------------- */
  let S = null; // current scenario
  function prep(sc) {
    let t = 0;
    sc.steps.forEach((st) => { st.start = t; t += st.dur; st.end = t; (st.frames ||= []); (st.up ||= []); });
    sc.total = t;
  }
  SCEN.forEach(prep);
  function rebuildScenarios() {
    const id = S ? S.id : 'happy';
    SCEN = buildScenarios(); SCEN.forEach(prep);
    S = SCEN.find((x) => x.id === id) || SCEN[0];
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function stateAt(sc, T) {
    const s = clone(sc.init());
    const changed = [];
    for (const st of sc.steps) {
      if (st.start > T) break;
      for (const u of st.up) {
        const at = st.start + u.at * st.dur;
        if (at > T) continue;
        apply(s, u);
        if (T - at < 1400) changed.push(u.tb ? `${u.tb}.${u.k}` : `${u.t}.${u.k}`);
      }
    }
    s.changed = changed;
    return s;
  }
  function apply(s, u) {
    if (u.t === 'patch') { if (u.tb === 'sw') patchSw(s, u.k, u.v); else if (s[u.tb][u.k]) Object.assign(s[u.tb][u.k], u.v); return; }
    if (u.t === 'down') { s.down[u.k] = u.v; return; }
    if (u.t === 'lk') { s.lk[u.k] = Object.assign({}, u.v); return; }
    if (u.t === 'hA' || u.t === 'hB') { if (u.v === null) delete s[u.t][u.k]; else s[u.t][u.k] = u.v; return; }
    if (u.t === 'sw') { applySw(s, u.k, u.v); return; }
    if (u.t === 'swx') { for (const [tbl, v] of Object.entries(u.v)) { if (v === null) delete s.swx[tbl][u.k]; else s.swx[tbl][u.k] = Object.assign({}, v); } return; }
    if (u.v === null) delete s[u.t][u.k]; else s[u.t][u.k] = Object.assign({}, u.v);
  }

  /* ---------------- Static SVG ---------------- */
  function el(tag, attrs = {}, text) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text != null) e.textContent = text;
    return e;
  }
  const stat = $('#static');
  const dyn = $('#dyn');
  const refs = { nic: {}, swLine: {}, brLine: {}, vmA: null, vmB: null };

  function drawStatic() {
    // core
    stat.append(el('rect', { x: 330, y: 32, width: 340, height: 54, rx: 8, class: 'box sw' }));
    stat.append(el('text', { x: 500, y: 55, 'text-anchor': 'middle', class: 'lbl' }, 'core1 · gateway'));
    const cl = el('text', { x: 500, y: 75, 'text-anchor': 'middle', class: 'sub mono' }, 'gw …:fe · VLAN 100');
    stat.append(cl); refs.coreLine = cl;
    // core links
    for (const s of ['sw1', 'sw2']) stat.append(el('line', { x1: s === 'sw1' ? 400 : 600, y1: 86, x2: SW[s][0], y2: 157, class: 'link' }));
    // peer link
    const pl = el('g', { id: 'peerlink' });
    pl.append(el('line', { x1: 392, y1: 175, x2: 608, y2: 175, class: 'link', 'stroke-dasharray': '6 4' }));
    pl.append(el('text', { x: 500, y: 166, 'text-anchor': 'middle', class: 'callout' }, 'MLAG peer-link'));
    pl.append(el('text', { x: 500, y: 196, 'text-anchor': 'middle', class: 'callout' }, 'one LACP system-ID · Po-A, Po-B'));
    stat.append(pl);
    const npl = el('g', { id: 'nopeerlink', opacity: 0 });
    npl.append(el('text', { x: 500, y: 169, 'text-anchor': 'middle', class: 'callout' }, 'no MLAG'));
    npl.append(el('text', { x: 500, y: 186, 'text-anchor': 'middle', class: 'callout' }, 'two LACP system-IDs'));
    npl.append(el('text', { x: 500, y: 203, 'text-anchor': 'middle', class: 'callout' }, 'only sw1 links attach'));
    stat.append(npl);
    // switches
    for (const s of ['sw1', 'sw2']) {
      const [x, y] = SW[s];
      stat.append(el('rect', { x: x - 112, y: y - 25, width: 224, height: 50, rx: 8, class: 'box sw' }));
      stat.append(el('text', { x, y: y - 5, 'text-anchor': 'middle', class: 'lbl' }, s));
      const t = el('text', { x, y: y + 15, 'text-anchor': 'middle', class: 'sub mono' }, '');
      stat.append(t); refs.swLine[s] = t;
    }
    // hosts
    for (const h of ['A', 'B']) {
      const H = HOST[h];
      // cables first
      for (const e of ENOS) stat.append(el('line', { x1: H.att[e], y1: ATT_Y, x2: H.px[e], y2: PORT_Y - 15, class: 'link', id: `cab-${h}-${e}` }));
      stat.append(el('rect', { x: H.x0, y: 320, width: H.x1 - H.x0, height: 338, rx: 12, class: 'host' }));
      stat.append(el('text', { x: H.x0 + 16, y: 646, class: 'lbl' }, H.name));
      stat.append(el('text', { x: H.x0 + 92, y: 646, class: 'sub' }, '· ' + H.role));
      // bond bracket
      stat.append(el('rect', { x: H.px.eno1 - 30, y: ADM_Y - 6, width: H.px.eno4 - H.px.eno1 + 60, height: 12, rx: 6, class: 'fdbport' }));
      for (const e of ENOS) {
        const r = el('rect', { x: H.px[e] - 34, y: PORT_Y - 15, width: 68, height: 30, rx: 6, class: 'nic' });
        stat.append(r); refs.nic[`${h}.${e}`] = r;
        stat.append(el('text', { x: H.px[e], y: PORT_Y + 5, 'text-anchor': 'middle', class: 'mono' }, e));
        stat.append(el('line', { x1: H.px[e], y1: PORT_Y + 15, x2: H.px[e], y2: ADM_Y - 6, class: 'link' }));
      }
      // br-phy
      stat.append(el('line', { x1: H.cx, y1: ADM_Y + 6, x2: H.cx, y2: BR_TOP, class: 'link' }));
      stat.append(el('rect', { x: H.cx - 160, y: BR_TOP, width: 320, height: 54, rx: 8, class: 'box' }));
      stat.append(el('text', { x: H.cx, y: BR_TOP + 21, 'text-anchor': 'middle', class: 'lbl' }, 'br-phy · bond0 balance-tcp · lacp=active'));
      const bl = el('text', { x: H.cx, y: BR_TOP + 42, 'text-anchor': 'middle', class: 'sub mono' }, '');
      stat.append(bl); refs.brLine[h] = bl;
      // local
      stat.append(el('line', { x1: H.cx, y1: BR_TOP + 54, x2: H.cx, y2: LOC_Y - 15, class: 'link' }));
      stat.append(el('rect', { x: H.cx - 130, y: LOC_Y - 15, width: 260, height: 30, rx: 15, class: 'fdbport' }));
      stat.append(el('text', { x: H.cx, y: LOC_Y + 5, 'text-anchor': 'middle', class: 'sub' }, 'local · patch → br-ex → br-int'));
    }
    // vm-x (fixed on A)
    vmBox(HOST.A.vm.x, 'vm-x', '…:02', false);
    stat.append(el('line', { x1: HOST.A.vm.x[0], y1: VM_Y - 23, x2: HOST.A.cx + 40, y2: LOC_Y + 15, class: 'link' }));
    // pod-network squares (all Kubernetes pod traffic on the node, via br-ex with the node MAC)
    for (const h of ['A', 'B']) {
      const [x, y] = HOST[h].vm.pods;
      stat.append(el('line', { x1: x, y1: y - 36, x2: HOST[h].cx + 110, y2: LOC_Y + 15, class: 'link' }));
      stat.append(el('rect', { x: x - 36, y: y - 36, width: 72, height: 72, rx: 6, class: 'pod' }));
      stat.append(el('text', { x, y: y - 6, 'text-anchor': 'middle', class: 'lbl' }, 'pods'));
      stat.append(el('text', { x, y: y + 11, 'text-anchor': 'middle', class: 'sub mono' }, 'br-ex'));
      stat.append(el('text', { x, y: y + 27, 'text-anchor': 'middle', class: 'sub mono' }, h === 'A' ? '…:0a' : '…:0b'));
    }
    // vm-web ghost slots
    for (const h of ['A', 'B']) {
      const [x, y] = HOST[h].vm.web;
      stat.append(el('line', { x1: x, y1: y - 23, x2: HOST[h].cx - (h === 'A' ? 60 : 20), y2: LOC_Y + 15, class: 'link' }));
      stat.append(el('rect', { x: x - 66, y: y - 23, width: 132, height: 46, rx: 8, class: 'vm ghost' }));
    }
    // migration path
    const mp = el('path', { d: 'M' + MIG.map((p) => p.join(',')).join(' L'), class: 'link', 'stroke-dasharray': '3 5', id: 'migpath', opacity: 0 });
    stat.append(mp);
    const mt = el('text', { x: 425, y: 695, 'text-anchor': 'middle', class: 'callout', id: 'miglbl', opacity: 0 }, 'live-migration network');
    stat.append(mt);
  }
  function vmBox([x, y], name, mac, dynamic) {
    const g = el('g', dynamic ? { id: 'vmweb' } : {});
    g.append(el('rect', { x: x - 66, y: y - 23, width: 132, height: 46, rx: 8, class: 'vm' }));
    g.append(el('text', { x, y: y - 3, 'text-anchor': 'middle', class: 'lbl' }, name));
    g.append(el('text', { x, y: y + 15, 'text-anchor': 'middle', class: 'sub mono' }, mac));
    stat.append(g);
    return g;
  }
  drawStatic();
  const vmWeb = vmBox([0, 0], 'vm-web', '…:01', true); // drawn at origin, positioned via transform

  /* ---------------- Polyline sampling ---------------- */
  function lenOf(pts) { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; }
  function at(pts, f) {
    const L = lenOf(pts) * f; let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + d >= L) { const r = d ? (L - acc) / d : 0; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * r, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * r]; }
      acc += d;
    }
    return pts[pts.length - 1];
  }
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  /* ---------------- Rendering ---------------- */
  const MACN = { web: 'vm-web', x: 'vm-x', pA: 'pods-A', pB: 'pods-B', gw: 'gw' };
  const ROWS = ['web', 'x', 'pA', 'pB', 'gw'];
  let T = 0, playing = false, speed = 1, holdAt = null, lastStepIdx = -1;

  function stepIndex(T) {
    const st = S.steps;
    for (let i = 0; i < st.length; i++) if (T < st[i].end) return i;
    return st.length - 1;
  }

  function render() {
    const i = stepIndex(T), st = S.steps[i];
    const lf = Math.min(1, Math.max(0, (T - st.start) / st.dur));
    const s = stateAt(S, T);

    // VM position
    let pos = HOST[s.vm].vm.web;
    const v = st.vm || s.vm;
    let scale = 1;
    if (Array.isArray(v)) {
      const f = ease(Math.min(1, Math.max(0, (lf - v[1]) / (v[2] - v[1]))));
      pos = at(v[3] === 'rev' ? MIG.slice().reverse() : MIG, f);
      const edge = Math.min(f, 1 - f) * 8; // shrink while travelling the migration path
      scale = 1 - 0.5 * Math.min(1, edge);
    } else pos = HOST[v].vm.web;
    vmWeb.setAttribute('transform', `translate(${pos[0]},${pos[1]}) scale(${scale.toFixed(3)})`);
    $('#migpath').setAttribute('opacity', st.mig ? 1 : 0);
    $('#miglbl').setAttribute('opacity', st.mig ? 1 : 0);

    // NIC states
    const hashB = String(s.hB.web || '').split('+'), hashA = String(s.hA.web || '').split('+');
    for (const h of ['A', 'B']) for (const e of ENOS) {
      const r = refs.nic[`${h}.${e}`];
      const cls = ['nic'];
      const lk = s.lk[h][e];
      if (lk === 'cur') cls.push('att'); else if (lk === 'ab') cls.push('active'); else if (lk !== 'down') cls.push('noatt');
      if ((h === 'A' && hashA.includes(e) && (v === 'A')) || (h === 'B' && hashB.includes(e) && v === 'B')) cls.push('hashed');
      if (s.down[`${h}.${e}`]) cls.push('down');
      r.setAttribute('class', cls.join(' '));
      const cab = document.getElementById(`cab-${h}-${e}`);
      cab.setAttribute('stroke-dasharray', s.down[`${h}.${e}`] ? '4 4' : '');
      cab.style.stroke = s.down[`${h}.${e}`] ? 'var(--color-error)' : '';
    }

    // switch & core lines
    $('#peerlink').setAttribute('opacity', indep ? 0 : 1);
    $('#peerlink').classList.toggle('fail', st.pl === 'fail');
    $('#nopeerlink').setAttribute('opacity', indep ? 1 : 0);
    const swe = s.sw.web;
    for (const sw of ['sw1', 'sw2']) {
      const t = refs.swLine[sw];
      const e = indep ? s.swx[sw].web : swe;
      if (!e) { t.textContent = 'vm-web: unknown → flood'; t.style.fill = 'var(--color-warning)'; continue; }
      if (indep) t.textContent = e.port === 'core1' ? 'vm-web → core1 uplink' : `vm-web → ${e.port}`;
      else t.textContent = `vm-web → ${e.port}`;
      t.style.fill = e.stale ? 'var(--color-warning)' : 'var(--color-text-muted)';
    }
    const ce = s.swx.core.web;
    if (indep) {
      refs.coreLine.textContent = ce ? `gw …:fe · vm-web → ${ce.port}${ce.moved ? ' (MAC move)' : ''}` : 'gw …:fe · vm-web: unknown → flood';
      refs.coreLine.style.fill = ce && ce.moved ? 'var(--color-warning)' : ce ? 'var(--color-text-muted)' : 'var(--color-warning)';
    } else { refs.coreLine.textContent = 'gw …:fe · VLAN 100 · MLAG port-channel'; refs.coreLine.style.fill = ''; }
    for (const h of ['A', 'B']) {
      const e = s[h].web, t = refs.brLine[h];
      if (!e) { t.textContent = 'fdb vm-web: (none)'; t.style.fill = 'var(--color-text-faint)'; continue; }
      t.textContent = `fdb vm-web → ${e.port}${e.lock ? '  [GARP-lock]' : ''}`;
      t.style.fill = e.wrong ? 'var(--color-error)' : e.stale ? 'var(--color-warning)' : e.lock ? 'var(--color-garp)' : 'var(--color-text-muted)';
    }

    // dynamic frames
    dyn.replaceChildren();
    const ended = [];
    for (const fr of st.frames) {
      if (lf < fr.t0) continue;
      const f = (lf - fr.t0) / (fr.t1 - fr.t0);
      if (f < 1) {
        const p = at(fr.pts, ease(Math.max(0, f)));
        if (fr.dash) dyn.append(el('circle', { cx: p[0], cy: p[1], r: 10, fill: 'none', stroke: 'var(--color-warning)', 'stroke-dasharray': '3 2' }));
        dyn.append(el('circle', { cx: p[0], cy: p[1], r: 7, class: `frame ${fr.k}` }));
        if (fr.label && f < 0.82) {
          const left = p[0] > 820;
          const tx = el('text', { x: p[0] + (left ? -12 : 12), y: p[1] - 10, 'text-anchor': left ? 'end' : 'start', class: 'mono', style: `fill: var(--color-${fr.k === 'uni' ? 'primary' : fr.k}); font-weight:600` }, fr.label);
          dyn.append(tx);
        }
      } else if (fr.end) {
        ended.push(fr);
      }
    }
    // end markers, spread when several frames finish at the same point
    const groups = new Map();
    for (const fr of ended) {
      const pe = fr.pts[fr.pts.length - 1];
      const key = pe.join(',');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(fr);
    }
    for (const [key, list] of groups) {
      const pe = key.split(',').map(Number);
      let base = pe;
      if (pe[1] === LOC_Y) base = [pe[0] + 148, pe[1]];
      else if (pe[1] === VM_Y) base = [pe[0] + 50, pe[1] - 23];
      const n = list.length;
      list.forEach((fr, k) => {
        const p = [base[0] + (k - (n - 1) / 2) * 24, base[1]];
        const ok = fr.end === 'ok';
        dyn.append(el('circle', { cx: p[0], cy: p[1], r: 10, class: `markbg ${fr.end}` }));
        dyn.append(el('text', { x: p[0], y: p[1] + 5, 'text-anchor': 'middle', class: `mark ${fr.end}` }, ok ? '✓' : '✕'));
      });
      const notes = [];
      for (const f of list) if (f.note && !notes.some((n) => n.note === f.note)) notes.push({ note: f.note, ok: f.end === 'ok' });
      const below = pe[1] === ATT_Y || pe[1] === ADM_Y;
      notes.forEach((nt, k) => {
        const nx = Math.min(985, Math.max(15, base[0]));
        const ny = (below ? base[1] + 29 : base[1] - 18) + (below ? 1 : -1) * k * 23;
        const w = nt.note.length * 8.6 + 12;
        dyn.append(el('rect', { x: nx - w / 2, y: ny - 14, width: w, height: 20, rx: 4, fill: 'var(--color-surface)', stroke: nt.ok ? 'var(--color-garp)' : 'var(--color-error)', 'stroke-width': 1 }));
        dyn.append(el('text', { x: nx, y: ny + 1, 'text-anchor': 'middle', class: 'mono', style: `fill: ${nt.ok ? 'var(--color-garp)' : 'var(--color-error)'}` }, nt.note));
      });
    }

    // narration (only when step changes)
    if (i !== lastStepIdx) {
      lastStepIdx = i;
      $('#stepTitle').textContent = (indep && st.titleI) ? st.titleI : st.title;
      $('#stepBody').innerHTML = (indep && st.bodyI) ? st.bodyI : st.body;
      $('#docref').textContent = st.doc || '';
      $('#decision').innerHTML = ((indep && st.decI) || st.dec || []).map((d) => `<div class="dec ${d.cls}"><b>${d.where}</b><br>${d.html}</div>`).join('');
      $('#whatif').hidden = !st.whatif;
      if (st.whatif) $('#whatif').textContent = st.whatif;
      [...$('#track').children].forEach((c, k) => c.classList.toggle('cur', k === i));
    }
    $('#clock').textContent = `${st.clock}  ·  step ${i + 1}/${S.steps.length}`;

    // tables
    renderTables(s);

    // timeline
    [...$('#track').children].forEach((c, k) => {
      const sk = S.steps[k];
      const p = Math.min(1, Math.max(0, (T - sk.start) / sk.dur));
      c.firstChild.style.width = (p * 100).toFixed(1) + '%';
    });
    $('#scrub').value = Math.round((T / S.total) * 1000);
    $('#prev').disabled = T <= 0;
  }

  let lastTblKey = '';
  function renderTables(s) {
    const key = JSON.stringify([indep, s.sw, s.swx, s.A, s.B, s.hA, s.hB, s.lk, s.down, s.changed]);
    if (key === lastTblKey) return;
    lastTblKey = key;
    const ch = new Set(s.changed);
    const flags = (e) => (e ? `${e.lock ? '<span class="flag lock">GARP-LOCK</span>' : ''}${e.stale ? '<span class="flag stale">STALE</span>' : ''}${e.wrong ? '<span class="flag wrong">WRONG</span>' : ''}${e.moved ? '<span class="flag stale">MAC MOVE</span>' : ''}` : '');
    const cell = (e) => (e ? e.port + flags(e) : '<span style="color:var(--color-text-faint)" title="unknown → flood">—</span>');
    const row = (tb, k, e) => `<tr class="${ch.has(`${tb}.${k}`) ? 'changed' : ''}"><td>${MACN[k]}</td><td>${cell(e)}</td></tr>`;
    let swT;
    if (!indep) {
      swT = `<div class="tbl sw"><h4>sw1 + sw2 MAC table <small>MLAG · VLAN 100 · Po-x = port-channel</small></h4><table><thead><tr><th>MAC</th><th>port</th></tr></thead><tbody>${ROWS.map((k) => row('sw', k, s.sw[k])).join('')}</tbody></table></div>`;
    } else {
      const r3 = (k) => `<tr class="${ch.has(`sw.${k}`) ? 'changed' : ''}"><td>${MACN[k]}</td><td>${cell(s.swx.sw1[k])}</td><td>${cell(s.swx.sw2[k])}</td><td class="${s.swx.core[k] && s.swx.core[k].moved ? 'moved' : ''}">${cell(s.swx.core[k])}</td></tr>`;
      swT = `<div class="tbl sw"><h4>Switch MAC tables <small>independent · VLAN 100</small></h4><table><thead><tr><th>MAC</th><th>sw1</th><th>sw2</th><th>core1</th></tr></thead><tbody>${ROWS.map(r3).join('')}</tbody></table></div>`;
    }
    const node = (h) => {
      const hk = h === 'A' ? 'hA' : 'hB';
      const nm = { web: 'vm-web', x: 'vm-x', pA: 'pods', pB: 'pods' };
      const hash = Object.entries(s[hk]).map(([k, m]) => `<span class="${ch.has(`${hk}.${k}`) ? 'flag new' : ''}">${nm[k]}→<b>${m}</b></span>`).join('') || '<span>—</span>';
      const LKN = { cur: 'attached', mis: 'partner mismatch', def: 'defaulted', exp: 'expired', sil: 'no LACPDU', ab: 'fallback A/B', down: 'down' };
      const att = ENOS.filter((e) => s.lk[h][e] === 'cur').length;
      const downs = ENOS.filter((e) => s.lk[h][e] !== 'cur').map((e) => `<span class="flag ${s.lk[h][e] === 'ab' ? 'lock' : 'wrong'}">${e} ${LKN[s.lk[h][e]] || s.lk[h][e]}</span>`).join('');
      return `<div class="tbl"><h4>Node ${h} FDB <small>br-phy</small></h4><table><thead><tr><th>MAC</th><th>port</th></tr></thead><tbody>${ROWS.map((k) => row(h, k, s[h][k])).join('')}</tbody></table>
        <div class="meta"><span>lacp <b>${att}/4 attached</b></span>${downs}</div><div class="meta"><span>flows</span>${hash}</div></div>`;
    };
    $('#tables').innerHTML = swT + node('A') + node('B');
  }

  /* ---------------- Scenario chrome ---------------- */
  function buildNav() {
    const nav = $('#scenarios');
    const btn = (sc) => `<button data-id="${sc.id}" class="${sc.bad ? 'bad' : ''}" aria-pressed="false"><span class="n">${sc.n}</span>${sc.name}</button>`;
    const walk = SCEN.filter((sc) => ['baseline', 'happy', 'life'].includes(sc.id)), rest = SCEN.filter((sc) => !walk.includes(sc));
    nav.innerHTML = `<div class="row">${walk.map(btn).join('')}</div><div class="row">${rest.map(btn).join('')}</div>`;
    nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) load(b.dataset.id, true); });
  }
  function load(id, autoplay) {
    cancelLoop();
    S = SCEN.find((x) => x.id === id) || SCEN[0];
    document.querySelectorAll('#scenarios button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === S.id)));
    $('#lifeOpt').hidden = S.id !== 'life';
    $('#track').innerHTML = S.steps.map((st, k) => `<span class="${S.bad ? 'bad' : ''}" title="${k + 1}. ${st.title.replace(/"/g, '&quot;')}" data-k="${k}"><i></i></span>`).join('');
    T = 0; lastStepIdx = -1; lastTblKey = ''; holdAt = null;
    render();
    setPlaying(!!autoplay);
  }
  $('#track').addEventListener('click', (e) => { cancelLoop(); const sp = e.target.closest('span'); if (!sp) return; T = S.steps[+sp.dataset.k].start; holdAt = null; render(); setPlaying(true); });

  function setPlaying(p) {
    playing = p;
    $('#play').setAttribute('aria-label', p ? 'Pause' : 'Play');
    $('#playIcon').innerHTML = p ? '<path d="M7 4h4v16H7zM14 4h4v16h-4z"/>' : '<path d="M7 4l13 8-13 8z"/>';
    if (p) {
      if (T >= S.total - 1) { T = 0; lastStepIdx = -1; }
      const i = stepIndex(T);
      holdAt = $('#hold').checked ? S.steps[i].end - 1 : null;
      last = performance.now();
    }
  }

  let last = performance.now(), loopTimer = null;
  function cancelLoop() { if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; } }
  function scheduleLoop() {
    cancelLoop();
    $('#clock').textContent += '  ·  restarting in 1.5 s';
    loopTimer = setTimeout(() => { loopTimer = null; T = 0; lastStepIdx = -1; render(); setPlaying(true); }, 1500);
  }
  function tick(now) {
    const dt = Math.min(64, now - last); last = now;
    if (playing) {
      T += dt * speed;
      let ended = false;
      if (holdAt != null && T >= holdAt) { T = holdAt; setPlaying(false); ended = stepIndex(T) === S.steps.length - 1; }
      if (T >= S.total - 1) { T = S.total - 1; setPlaying(false); ended = true; }
      render();
      if (ended && $('#loop').checked) scheduleLoop();
    }
    requestAnimationFrame(tick);
  }
  $('#nreb').addEventListener('change', (e) => { nReb = +e.target.value; rebuildScenarios(); load('life', true); });
  $('#loop').addEventListener('change', (e) => { if (!e.target.checked) cancelLoop(); else if (!playing && T >= S.total - 2) scheduleLoop(); });
  $('#modeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    indep = b.dataset.mode === 'indep';
    document.querySelectorAll('#modeSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    rebuildScenarios(); lastStepIdx = -1; lastTblKey = ''; render();
  });

  $('#play').addEventListener('click', () => {
    cancelLoop();
    if (!playing) { const i = stepIndex(T); if (T >= S.steps[i].end - 2 && i < S.steps.length - 1) { T = S.steps[i + 1].start; } }
    setPlaying(!playing); render();
  });
  $('#next').addEventListener('click', () => { cancelLoop(); const i = stepIndex(T); if (i < S.steps.length - 1) { T = S.steps[i + 1].start; render(); setPlaying(true); } else { T = S.total - 1; render(); setPlaying(false); } });
  $('#prev').addEventListener('click', () => { cancelLoop(); const i = stepIndex(T); const st = S.steps[i]; T = (T - st.start > 600 || i === 0) ? st.start : S.steps[i - 1].start; render(); setPlaying(true); });
  $('#restart').addEventListener('click', () => { cancelLoop(); T = 0; lastStepIdx = -1; render(); setPlaying(true); });
  $('#scrub').addEventListener('input', (e) => { cancelLoop(); setPlaying(false); T = (e.target.value / 1000) * (S.total - 1); render(); });
  $('#speed').addEventListener('change', (e) => { speed = +e.target.value; });
  $('#hold').addEventListener('change', (e) => { if (!e.target.checked) holdAt = null; else if (playing) holdAt = S.steps[stepIndex(T)].end - 1; });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('select,input')) return;
    if (e.code === 'Space') { e.preventDefault(); $('#play').click(); }
    if (e.key === 'ArrowRight') $('#next').click();
    if (e.key === 'ArrowLeft') $('#prev').click();
  });

  // Risks
  $('#risks').innerHTML = RISKS.map((r) => `<div class="risk"><h4><span class="pill ${r.sev}">${r.tag}</span>${r.title}</h4><div>${r.html}</div><button class="jump" data-id="${r.scen}">Show in visualization →</button></div>`).join('');
  $('#risks').addEventListener('click', (e) => { const b = e.target.closest('.jump'); if (!b) return; load(b.dataset.id, true); window.scrollTo({ top: 0, behavior: 'smooth' }); });

  buildNav();
  const hash = location.hash.replace('#', '');
  load(SCEN.some((s) => s.id === hash) ? hash : 'happy', false);
  requestAnimationFrame(tick);
})();
