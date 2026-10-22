/* XOR Scope — Linux kernel bond balance-xor (mode 2) under br-ex: MAC learning visualizer */
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
  // Switch-side mode: false = the four ports are a static port-channel on the MLAG pair (Po-A / Po-B, "mode on");
  // true = the ports were never channel-grouped (plain trunk ports) — the bond cannot tell the difference.
  let indep = false;
  // Transmit hash policy: false = layer2 (default), true = layer3+4
  let l34 = false;
  const M = (e) => e;
  function dn(from, h, eno, to) {
    const H = HOST[h], px = H.px[eno], s = swOf(eno);
    const pts = [SW[from]];
    if (from !== s) pts.push(SW[s]); // MLAG peer-link in both modes
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
  const uniDown = (h, eno, to) => [CORE].concat(dn(swOf(eno), h, eno, to));
  const uniUp = (h, vm, eno) => join(up(h, vm, eno), toCore(swOf(eno)));

  // Broadcast that entered switch `s` from host `srcH` on member `srcEno`.
  // LAG mode: one copy to the other port-channel (member chosen by the switch) + core1, never back to the source LAG.
  // Plain-port mode: one copy out of EVERY other port — 3 reflections to the source host, 4 copies to the other host,
  // and the kernel bond accepts all of them (every slave is active in balance-xor).
  function lagFlood(s, srcH, dstEno, kind, t0, t1, o = {}) {
    const h2 = srcH === 'A' ? 'B' : 'A';
    if (!indep) {
      return [
        { pts: toCore(s), k: kind, t0, t1: t0 + (t1 - t0) * 0.5, end: 'ok', dash: o.dash },
        { pts: dn(s, h2, dstEno, o.to || 'local'), k: kind, t0, t1, end: o.end || 'ok', note: o.note, dash: o.dash },
      ];
    }
    const out = [{ pts: toCore(s), k: kind, t0, t1: t0 + (t1 - t0) * 0.5, end: 'ok', dash: o.dash }];
    for (const h of ['A', 'B']) for (const e of ENOS) {
      if (h === srcH && e === o.srcEno) continue;
      const refl = h === srcH;
      out.push({ pts: dn(s, h, e, 'local'), k: kind, t0, t1, end: 'ok', note: refl ? (o.reflNote || 'own frame!') : 'dup', dash: o.dash });
    }
    return out;
  }
  // Broadcast from north of the switches (core1): one copy per port-channel in LAG mode; one copy per port otherwise.
  function coreFlood(kind, enoA, enoB, t0, t1, o = {}) {
    const out = [];
    const tm = t0 + (t1 - t0) * 0.25;
    out.push({ pts: fromCore('sw1'), k: kind, t0, t1: tm, label: o.label, dash: o.dash });
    if (!indep) {
      [['A', enoA], ['B', enoB]].forEach(([h, e]) => out.push({ pts: dn('sw1', h, e, o.to || 'local'), k: kind, t0: tm, t1, end: (o.end && o.end[h]) || 'ok', note: o.note && o.note[h], dash: o.dash }));
    } else {
      for (const h of ['A', 'B']) for (const e of ENOS) out.push({ pts: dn('sw1', h, e, 'local'), k: kind, t0: tm, t1, end: 'ok', note: e === 'eno1' ? undefined : 'dup', dash: o.dash });
    }
    return out;
  }

  /* ---------------- Hash model ---------------- */
  // layer2: slave = (srcMAC[5] ^ dstMAC[5] ^ ethertype) mod slaves.  gw = …:fe, vm-web = …:01, vm-x = …:02, pods-A = …:0a, pods-B = …:0b
  // IPv4 (0x0800) leaves the low byte alone; ARP (0x0806) flips it by 6.
  const L2 = { web: 'eno4', webArp: 'eno2', x: 'eno1', pA: 'eno1', pB: 'eno2' };
  const F = (...m) => m.filter((e, i, a) => a.indexOf(e) === i).join('+');
  const flowsOf = (k) => (l34 ? ({ web: F('eno2', 'eno3'), x: F('eno1'), pA: F('eno1', 'eno2', 'eno3', 'eno4'), pB: F('eno1', 'eno2', 'eno3', 'eno4') })[k] : L2[k]);
  const webOut = () => (l34 ? 'eno2' : 'eno4'), webOut2 = () => (l34 ? 'eno3' : 'eno4'), webArp = () => (l34 ? 'eno2' : L2.webArp);
  const podOut = (h, alt) => (l34 ? alt : h === 'A' ? L2.pA : L2.pB);

  /* ---------------- Initial states ---------------- */
  const LK_ALL = () => ({ A: lkDefault(), B: lkDefault() });
  function lkDefault() { return { eno1: 'cur', eno2: 'cur', eno3: 'cur', eno4: 'cur' }; }
  const PO = (h) => (indep ? null : `Po-${h}`);
  const steady = () => fin({
    sw: { web: { port: indep ? `A·${webOut()}` : 'Po-A' }, x: { port: indep ? 'A·eno1' : 'Po-A' }, pA: { port: indep ? 'A·eno1' : 'Po-A' }, pB: { port: indep ? 'B·eno2' : 'Po-B' }, gw: { port: 'core1' } },
    A: { web: { port: 'local' }, x: { port: 'local' }, pA: { port: 'local' }, pB: { port: 'bond0' }, gw: { port: 'bond0' } },
    B: { web: { port: 'bond0' }, x: { port: 'bond0' }, pA: { port: 'bond0' }, pB: { port: 'local' }, gw: { port: 'bond0' } },
    hA: { web: flowsOf('web'), x: flowsOf('x'), pA: flowsOf('pA') }, hB: { pB: flowsOf('pB') },
    lk: LK_ALL(), down: {}, vm: 'A',
  });
  const converged = () => fin({
    sw: { web: { port: indep ? `B·${webOut()}` : 'Po-B' }, x: { port: indep ? 'A·eno1' : 'Po-A' }, pA: { port: indep ? 'A·eno1' : 'Po-A' }, pB: { port: indep ? 'B·eno2' : 'Po-B' }, gw: { port: 'core1' } },
    A: { web: { port: 'bond0' }, x: { port: 'local' }, pA: { port: 'local' }, pB: { port: 'bond0' }, gw: { port: 'bond0' } },
    B: { web: { port: 'local' }, x: { port: 'bond0' }, pA: { port: 'bond0' }, pB: { port: 'local' }, gw: { port: 'bond0' } },
    hA: { x: flowsOf('x'), pA: flowsOf('pA') }, hB: { web: flowsOf('web'), pB: flowsOf('pB') },
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
  function fin(s) { s.swx = { sw1: {}, sw2: {}, core: {} }; for (const k of Object.keys(s.sw)) applySw(s, k, s.sw[k]); return s; }
  // One MLAG-synced table in both modes; swx kept for compatibility with the renderer.
  function applySw(s, k, v) {
    if (v === null) { delete s.sw[k]; delete s.swx.sw1[k]; delete s.swx.sw2[k]; delete s.swx.core[k]; return; }
    const prev = s.sw[k];
    s.sw[k] = Object.assign({}, v);
    if (prev && prev.port !== v.port && prev.port !== 'core1' && v.port !== 'core1') s.sw[k].moved = true;
    s.swx.sw1[k] = s.sw[k]; s.swx.sw2[k] = s.sw[k]; s.swx.core[k] = { port: 'uplink' };
  }
  function patchSw(s, k, v) { if (s.sw[k]) Object.assign(s.sw[k], v); }

  /* ---------------- Decision trace helpers ---------------- */
  const D = (cls, where, html) => ({ cls, where, html });
  const fmt = (sec) => (sec < 0 ? `T−${Math.abs(sec)} s` : `T+${Number.isInteger(sec) ? sec : sec.toFixed(3)} s`);
  const swPortOf = (h, e) => (indep ? `${h}·${e}` : `Po-${h}`);

  /* ---------------- Reusable step builders ---------------- */
  let nReb = 2;
  function podTraffic(o = 0) {
    const out = [];
    const plan = [['A', 0, 'eno1', 'eno3'], ['B', 0.3, 'eno4', 'eno2']];
    plan.forEach(([h, d, e1, e2]) => {
      const t = o + d;
      out.push({ pts: uniUp(h, 'pods', podOut(h, e1)), k: 'pod', t0: t, t1: t + 0.3, end: null });
      out.push({ pts: uniDown(h, indep ? podOut(h, e1) : e2, 'pods'), k: 'pod', t0: t + 0.32, t1: t + 0.62, end: null });
    });
    return out;
  }
  const other = (h) => (h === 'A' ? 'B' : 'A');

  function coldStartSteps() {
    const a = webArp();
    return [
      { clock: 'T−60 s', title: 'Cold start: vm-web ARPs for its gateway', doc: 'balance-xor · transmit hash', dur: 5200,
        body: `<p>Nothing has learned vm-web yet. The kernel bond hashes the ARP ${l34 ? 'with <code>layer3+4</code> — for non-IP frames that falls back to the layer2 formula —' : 'with the default <code>layer2</code> policy: <code>srcMAC[5] ^ dstMAC[5] ^ ethertype</code>, modulo 4 slaves —'} onto <code>${a}</code>. ${swOf(a)} learns <code>vm-web → Po-A</code>: the switch was told these four ports are one static port-channel.</p><p>A LAG is one logical port, so the switch floods one copy to Po-B and one to core1, never back onto Po-A. Node B accepts it (every slave is active in balance-xor) and <code>br-ex</code> learns <code>vm-web → bond0</code>.</p>`,
        bodyI: `<p>Nothing has learned vm-web yet. The bond hashes the ARP onto <code>${a}</code> — but these ports were <b>never channel-grouped</b>, so ${swOf(a)} learns <code>vm-web → A·${a}</code>, a single port.</p><p>The switch floods the ARP out <b>every other port</b>: four copies reach Node B, three come straight back to Node A. balance-xor has no inactive slaves, so the kernel delivers all of them: Node B's br-ex sees four ARPs, and Node A's br-ex sees <b>its own VM's ARP arriving from bond0</b> and learns <code>vm-web → bond0</code> — wrong.</p>`,
        vm: 'A',
        frames: [{ pts: up('A', 'web', a), k: 'bcast', t0: 0.05, t1: 0.42, end: null, label: 'ARP who-has gw' }]
          .concat(lagFlood(swOf(a), 'A', 'eno3', 'bcast', 0.42, 0.9, { srcEno: a })).concat(podTraffic(0.3)),
        up: [{ at: 0.1, t: 'A', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.2, t: 'hA', k: 'web', v: flowsOf('web') }, { at: 0.4, t: 'sw', k: 'web', v: { port: swPortOf('A', a), fresh: true } }, { at: 0.86, t: 'B', k: 'web', v: { port: 'bond0', fresh: true } }]
          .concat(indep ? [{ at: 0.88, t: 'A', k: 'web', v: { port: 'bond0', wrong: true } }] : []),
        dec: indep
          ? [D('drop', 'Node A · eno1/eno3/eno4 (reflections)', 'all slaves active → <b>delivered</b>; br-ex relearns vm-web → <b>bond0</b> (loop)'), D('warn', 'Node B · all four', '4 × the same ARP delivered — <b>duplicates</b>')]
          : [D('ok', `${swOf(a)} · LAG forwarding`, 'ingress Po-A → learn <b>vm-web → Po-A</b>; flood to Po-B (one member) + uplink'), D('ok', 'Node B · eno3', 'slave active → <b>accept</b>; br-ex learns vm-web → bond0')] },
      { clock: 'T−59 s', title: 'The gateway answers, then broadcasts in turn', doc: 'Bond input', dur: 5200,
        body: `<p>The ARP reply is unicast. The switch picks a member of Po-A by <b>its own</b> hash policy — which need not match the bond's — and Node A accepts it on any slave, learning <code>gw → bond0</code>.</p><p>The gateway's broadcast ARP then reaches each port-channel once; both nodes learn <code>gw → bond0</code>.</p>`,
        bodyI: `<p>The ARP reply is unicast to the single port the switch learned, <code>A·${a}</code>, and Node A learns <code>gw → bond0</code>.</p><p>The gateway's broadcast ARP, however, is flooded out all eight host ports and <b>every copy is delivered</b>: each br-ex receives it four times. ARP, DHCP, ND and every other broadcast on the VLAN arrives in quadruplicate.</p>`,
        vm: 'A',
        frames: [{ pts: uniDown('A', indep ? a : 'eno4', 'web'), k: 'uni', t0: 0.05, t1: 0.5, end: 'ok', label: 'ARP reply → vm-web' }]
          .concat(coreFlood('bcast', 'eno1', 'eno2', 0.5, 0.95, { label: 'gw ARP who-has' })).concat(podTraffic(0.05)),
        up: [{ at: 0.1, t: 'sw', k: 'gw', v: { port: 'core1', fresh: true } }, { at: 0.45, t: 'A', k: 'gw', v: { port: 'bond0', fresh: true } }, { at: 0.9, t: 'B', k: 'gw', v: { port: 'bond0', fresh: true } }],
        dec: indep ? [D('warn', 'Node A, Node B · all slaves', 'broadcast ×4 → all <b>delivered</b> (no duplicate suppression outside active-backup/TLB/ALB)')] : [D('ok', 'Node A · eno4', 'unicast on an active slave → <b>accept</b>; learn gw → bond0')] },
    ];
  }

  function migrateSteps(from, to, member, base, firstTime) {
    const rev = from === 'B';
    const mig = rev ? MIG.slice().reverse() : MIG;
    const m = webArp(), sw = swOf(m), hTo = to === 'A' ? 'hA' : 'hB', hFrom = from === 'A' ? 'hA' : 'hB';
    const po = swPortOf(to, m), poOld = indep ? `${from}·${webOut()}` : `Po-${from}`;
    const recv = to === 'B' ? 'eno3' : 'eno1';
    return [
      { clock: fmt(base - 3), title: `Live migration ${from} → ${to}: pre-copy`, doc: 'Setup', dur: 3600,
        body: `<p>KubeVirt copies vm-web's memory to Node ${to}. vm-web keeps running on Node ${from}, so every table is still correct: switches → <code>${poOld}</code>, Node ${from} → <code>local</code>, Node ${to} → <code>bond0</code>.</p>`,
        vm: from, mig: true,
        frames: [0.05, 0.25, 0.45].map((t) => ({ pts: mig, k: 'mig', t0: t, t1: t + 0.45 })).concat(podTraffic(0.1)) },
      { clock: fmt(base), title: `Switchover: vm-web resumes on Node ${to}`, doc: 'Setup', dur: 3200,
        body: `<p>vm-web pauses on ${from} and resumes on ${to}. Every table is now wrong: the switches still point at <code>${poOld}</code>, Node ${from} thinks vm-web is local, Node ${to} thinks it is out the bond. Only an announcement from the new location can fix all three.</p>`,
        vm: ['move', 0.1, 0.7, rev ? 'rev' : 'fwd'], mig: true,
        frames: podTraffic(0.2),
        up: [{ at: 0.7, t: 'patch', tb: 'sw', k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: from, k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: to, k: 'web', v: { stale: true } }, { at: 0.7, t: hFrom, k: 'web', v: null }] },
      { clock: fmt(base + 0.002), title: `GARP leaves Node ${to} on ${m}`, doc: 'Bond output', dur: 4000,
        body: `<p>The gratuitous ARP enters <code>br-ex</code> from the local side: Node ${to} learns <code>vm-web → local</code>. The bond hashes it to <code>${m}</code>${indep ? '' : ` and ${sw} simply moves the entry <code>${poOld} → ${po}</code> — one MAC move, exactly like a single-NIC host`}.</p>${indep ? `<p>Without a port-channel, ${sw} learns <code>vm-web → ${po}</code>; vm-web's IPv4 frames will hash to <code>${webOut()}</code> and move it again. Every destination MAC and ethertype can land on a different port — the switch sees a MAC that <b>flaps</b>.</p>` : ''}`,
        vm: to,
        frames: [{ pts: up(to, 'web', m), k: 'garp', t0: 0.05, t1: 0.75, end: null, label: 'GARP' }].concat(podTraffic(0.3)),
        up: [{ at: 0.18, t: to, k: 'web', v: { port: 'local', lock: true, fresh: true } }, { at: 0.4, t: hTo, k: 'web', v: flowsOf('web') }, { at: 0.74, t: 'sw', k: 'web', v: { port: po, fresh: true } }],
        dec: [D(indep ? 'warn' : 'ok', sw, `src vm-web on ${po} (was ${poOld}) → <b>MAC move</b>${indep ? ' — and more to come as other frames hash elsewhere' : ''}`)] },
      { clock: fmt(base + 0.003), title: indep ? 'The GARP floods out every port — reflections included' : 'The GARP reaches the old host once — and is accepted', doc: 'Bond input', dur: 5200,
        body: `<p>The switch floods the GARP to core1 and to <code>${indep ? 'every other port' : `Po-${from}`}</code>. Node ${from} still has <code>vm-web → local</code>; balance-xor has no loop rule (that is SLB's), so it relearns <code>vm-web → bond0</code> like any MAC move.</p>${indep ? `<p>Node ${to} also receives its own GARP back on three slaves and <b>relearns vm-web → bond0</b> on br-ex — the bridge now believes its own VM is behind the bond, and local traffic to vm-web leaves the node.</p>` : `<p>Nothing comes back to Node ${to}: the switch never forwards a frame out the LAG it arrived on.</p>`}`,
        vm: to,
        frames: lagFlood(sw, to, recv, 'garp', 0.05, 0.75, { note: 'accepted', srcEno: m }).concat(podTraffic(0.35)),
        up: [{ at: 0.66, t: from, k: 'web', v: { port: 'bond0', fresh: true } }].concat(indep ? [{ at: 0.7, t: to, k: 'web', v: { port: 'bond0', wrong: true } }] : []),
        dec: indep
          ? [D('ok', `Node ${from}`, 'accept; relearn vm-web → <b>bond0</b>'), D('drop', `Node ${to} · reflections`, 'own GARP from bond0 → br-ex learns vm-web → <b>bond0</b> — local VM unreachable locally')]
          : [D('ok', `Node ${from} · ${recv}`, 'slave active → <b>accept</b>; learn vm-web local → <b>bond0</b>'), D('ok', `Node ${to}`, 'no reflected copy arrives')] },
      { clock: fmt(base + 0.01), title: indep ? 'Steady state: flapping, duplicates and a confused bridge' : `Converged on Node ${to}`, doc: 'Result', dur: 4000,
        body: indep
          ? `<p>Return traffic goes to whichever port last saw vm-web. Every broadcast arrives four times. Node ${to}'s br-ex alternates between <i>local</i> (when vm-web transmits) and <i>bond0</i> (when a reflection arrives). Many switches err-disable a port on this much MAC flapping. <b>This is what a missing or mismatched static port-channel looks like — and the bond itself reports nothing wrong.</b></p>`
          : `<p>The gateway reaches vm-web through <code>${po}</code>; the switch may use any member, and all of them are accepted. One GARP, one MAC move, both nodes corrected in milliseconds.</p>`,
        vm: to,
        frames: [{ pts: uniDown(to, indep ? m : to === 'B' ? 'eno2' : 'eno4', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }, { pts: uniUp(to, 'web', webOut()), k: 'uni', t0: 0.45, t1: 0.95, end: 'ok', label: 'vm-web → gw' }].concat(podTraffic(0.1)),
        up: [{ at: 0.1, t: 'patch', tb: 'sw', k: 'web', v: { stale: false } }, { at: 0.9, t: 'patch', tb: to, k: 'web', v: { lock: false } }].concat(indep ? [{ at: 0.6, t: 'sw', k: 'web', v: { port: `${to}·${webOut()}`, fresh: true } }, { at: 0.5, t: to, k: 'web', v: { port: 'local', fresh: true } }] : []) },
    ];
  }
  // Link failovers: a slave goes down, the hash is taken modulo the remaining count, flows remap; next time it returns.
  function failoverSteps(host, n, clock0) {
    const steps = [];
    const hk = host === 'A' ? 'hA' : 'hB';
    const order = ['eno3', 'eno1', 'eno4', 'eno2'];
    let prev = null;
    for (let i = 1; i <= n; i++) {
      const dead = order[(i - 1) % order.length];
      const remaining = ENOS.filter((e) => e !== dead);
      const t = clock0 + i * 20;
      const webNew = l34 ? F(remaining[1], remaining[2]) : remaining[(0xff) % 3];
      const podNew = l34 ? F(...remaining) : remaining[(host === 'A' ? 0xf4 : 0xf5) % 3];
      const ups = [{ at: 0.1, t: 'down', k: `${host}.${dead}`, v: true }, { at: 0.1, t: 'lk', k: host, v: Object.assign(lkDefault(), { [dead]: 'down' }) }, { at: 0.3, t: hk, k: 'web', v: webNew }, { at: 0.3, t: hk, k: host === 'A' ? 'pA' : 'pB', v: podNew }];
      if (prev) ups.unshift({ at: 0.02, t: 'down', k: `${host}.${prev}`, v: false });
      steps.push({ clock: `T+${t} s`, title: `Link failover ${i}/${n}: ${dead} down → hash modulo 3`, doc: 'bonding.rst · miimon', dur: 4600,
        body: `<p><code>${dead}</code> loses carrier; <code>miimon</code> (100 ms) marks it down. balance-xor has no buckets to shift: the hash is simply taken <b>modulo the new slave count</b>, so <i>most</i> flows on the node change slave at once — not just the ones that were on ${dead}. vm-web's traffic moves to <code>${webNew}</code>, the pods to <code>${podNew}</code>.</p><p>${indep ? `Each remapped MAC is a <b>MAC move</b> on the switch (vm-web: ${host}·${webOut()} → ${host}·${webNew}).` : 'To the switch nothing changes: every frame still arrives on <code>Po-' + host + '</code>. No MAC move, no stale entry.'}</p>`,
        vm: host,
        frames: [{ pts: uniUp(host, 'web', l34 ? remaining[1] : webNew), k: 'uni', t0: 0.4, t1: 0.9, end: 'ok', label: 'vm-web → gw' }, { pts: uniUp(host, 'pods', l34 ? remaining[0] : podNew), k: 'pod', t0: 0.5, t1: 0.95, end: 'ok' }],
        up: ups.concat(indep ? [{ at: 0.75, t: 'sw', k: 'web', v: { port: `${host}·${l34 ? remaining[1] : webNew}`, fresh: true } }] : []),
        dec: [D('warn', `Node ${host} bond0`, `slave count 4 → 3: hash mod 3 → vm-web <b>${webNew}</b>, pods <b>${podNew}</b>`), indep ? D('warn', 'switches', 'remapped MACs = <b>MAC moves</b> between ports') : D('ok', 'switches', `still <code>Po-${host}</code> — invisible`)] });
      prev = dead;
    }
    return steps;
  }
  function lifecycle() {
    const steps = []
      .concat(coldStartSteps())
      .concat(migrateSteps('A', 'B', 'eno3', 0, true))
      .concat(failoverSteps('B', nReb, 0))
      .concat(migrateSteps('B', 'A', 'eno2', nReb * 20 + 30, false));
    steps.push({ clock: `T+${nReb * 20 + 31} s`, title: 'Back on Node A — what the fabric saw', doc: 'Summary', dur: 4200,
      body: indep
        ? `<p>Two migrations and ${nReb} link failover${nReb === 1 ? '' : 's'} on ports that are not a port-channel: vm-web's MAC moved between switch ports on every announcement, every hash change and every reflection; every broadcast was delivered four times; and each node's br-ex repeatedly learned its own VM behind the bond. Nothing in <code>/proc/net/bonding/bond0</code> shows a problem.</p>`
        : `<p>Two migrations and ${nReb} link failover${nReb === 1 ? '' : 's'}: the switches saw exactly <b>two</b> MAC moves (<code>Po-A → Po-B → Po-A</code>). Failovers remapped most flows on the node but were invisible to the switches. The difference from LACP is only what is <i>not</i> there: nothing verified that the port-channel actually exists and matches the cabling.</p>`,
      vm: 'A',
      frames: [{ pts: uniDown('A', indep ? webOut() : 'eno2', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }].concat(podTraffic(0.1)) });
    return { id: 'life', n: '2', name: 'Lifecycle: migrate → link failover ×N → migrate back', init: coldStart, steps };
  }

  /* ---------------- Scenarios ---------------- */
  function buildScenarios() { return [
    {
      id: 'baseline', n: '0', name: 'How balance-xor hashes', init: () => { const s = steady(); applySw(s, 'web', null); applySw(s, 'x', null); applySw(s, 'pA', null); return s; },
      steps: [
        { clock: 'T−5 s', title: 'No negotiation: the bond trusts the cabling', doc: 'bonding.rst · switch configuration', dur: 4200,
          body: `<p>balance-xor is a Linux <b>kernel</b> bond mode (OVS has no equivalent; here it sits under <code>br-ex</code>). It sends no LACPDUs and expects nothing back: the kernel docs say these modes "generally require that the switch have the appropriate ports grouped together" — a <b>static</b> EtherChannel / port-channel (<code>mode on</code>) on the MLAG pair.</p><p>Nothing checks that the group exists, spans the right ports, or that both MLAG peers agree. All four slaves are simply <i>up</i> and active.</p>`,
          bodyI: `<p>balance-xor is a Linux kernel bond mode (OVS has no equivalent; here it sits under <code>br-ex</code>). It sends no LACPDUs and expects nothing back. In this mode of the simulation the switch ports were <b>never channel-grouped</b> — and the bond is perfectly happy: all four slaves up, all active.</p>`,
          vm: 'A', frames: podTraffic(0.1),
          dec: [D(indep ? 'warn' : 'ok', 'Node A bond0', '4 slaves up · mode 2 · no partner state to check')] },
        { clock: 'T+0.000 s', title: `${l34 ? 'layer3+4' : 'layer2'} hash: vm-web → ${webOut()}`, doc: 'xmit_hash_policy', dur: 3800,
          body: l34
            ? `<p>With <code>xmit_hash_policy=layer3+4</code> the slave is chosen from IPs and TCP/UDP ports, so a VM's connections spread over slaves (this one lands on <code>${webOut()}</code>) while any single connection stays on one slave.</p>`
            : `<p>With the default <code>layer2</code> policy the slave is <code>(srcMAC[5] ^ dstMAC[5] ^ ethertype) mod 4</code>. vm-web (…:01) talking to the gateway (…:fe): <code>0x01 ^ 0xfe = 0xff</code>, mod 4 = 3 → <code>eno4</code>. <b>Every</b> IPv4 frame from vm-web to the gateway — all of its north-south traffic — uses that one slave.</p>`,
          vm: 'A',
          frames: [{ pts: uniUp('A', 'web', webOut()), k: 'uni', t0: 0.05, t1: 0.7, end: 'ok', label: 'vm-web → gw' }],
          up: [{ at: 0.42, t: 'sw', k: 'web', v: { port: swPortOf('A', webOut()), fresh: true } }, { at: 0.1, t: 'hA', k: 'web', v: flowsOf('web') }],
          dec: [D('ok', 'Node A bond0 · xmit', l34 ? 'hash(IPs, ports) mod 4 → <b>' + webOut() + '</b>' : '0x01 ^ 0xfe ^ 0x00 = 0xff · 0xff mod 4 = 3 → <b>eno4</b>')] },
        { clock: 'T+0.001 s', title: `Pods: ${l34 ? 'spread per flow' : 'the whole pod network on one slave'}`, doc: 'xmit_hash_policy', dur: 4200,
          body: l34
            ? `<p>Pod flows share the node MAC but have distinct IPs and ports, so layer3+4 spreads them across all four slaves — the same benefit as LACP balance-tcp.</p>`
            : `<p>All pod traffic leaves br-ex with the node MAC (…:0a) toward the gateway: <code>0x0a ^ 0xfe = 0xf4</code>, mod 4 = 0 → <code>eno1</code>. The <b>entire Kubernetes pod network</b> of the node is pinned to one slave, exactly like SLB — and vm-x (…:02 → 0xfc, mod 4 = 0) shares it. layer2 balances only across MAC pairs; behind one gateway MAC that means "per source MAC", at best.</p>`,
          vm: 'A',
          frames: l34
            ? [['eno1', 0.05], ['eno3', 0.2], ['eno2', 0.35], ['eno4', 0.5]].map(([e, t]) => ({ pts: uniUp('A', 'pods', e), k: 'pod', t0: t, t1: t + 0.45, end: 'ok' }))
            : [{ pts: uniUp('A', 'pods', 'eno1'), k: 'pod', t0: 0.05, t1: 0.5, end: 'ok', label: 'pods → gw' }, { pts: uniUp('A', 'pods', 'eno1'), k: 'pod', t0: 0.25, t1: 0.7, end: null }, { pts: uniUp('A', 'x', 'eno1'), k: 'uni', t0: 0.45, t1: 0.9, end: 'ok', label: 'vm-x → gw' }],
          up: [{ at: 0.4, t: 'sw', k: 'pA', v: { port: swPortOf('A', 'eno1'), fresh: true } }, { at: 0.7, t: 'sw', k: 'x', v: { port: swPortOf('A', 'eno1'), fresh: true } }],
          dec: [D(l34 ? 'ok' : 'warn', 'Node A bond0 · xmit', l34 ? 'per-flow → eno1…eno4' : '0x0a ^ 0xfe = 0xf4 mod 4 = 0 → <b>eno1</b> for every pod flow; vm-x: 0xfc mod 4 = 0 → <b>eno1</b> too')] },
        { clock: 'T+0.002 s', title: 'Return traffic: the switch hashes its own way', doc: 'Bond input', dur: 3600,
          body: indep
            ? `<p>With individual ports the switch sends unicast to the one port it last learned the MAC on. As vm-web's frames hash to different ports for different destinations or ethertypes, that port keeps changing.</p>`
            : `<p>Inbound, the switch picks a Po-A member by its own policy (often src/dst IP); "the transmit policy of the two peers does not need to match". The bond accepts on any slave.</p>`,
          vm: 'A',
          frames: [{ pts: uniDown('A', indep ? webOut() : 'eno2', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }, { pts: uniDown('A', indep ? 'eno1' : 'eno3', 'pods'), k: 'pod', t0: 0.3, t1: 0.85, end: 'ok' }] },
        { clock: 'T+0.003 s', title: 'Same MAC, different ethertype, different slave', doc: 'layer2 formula', dur: 4200,
          body: `<p>The layer2 formula XORs the <b>ethertype</b> too. vm-web's ARP (0x0806) hashes to <code>${L2.webArp}</code> while its IPv4 (0x0800) uses <code>eno4</code>. ${indep ? '<b>On plain ports that is a MAC move on the switch every time vm-web ARPs.</b>' : 'Inside a port-channel this is harmless — Po-A is Po-A.'}</p>`,
          vm: 'A',
          frames: [{ pts: up('A', 'web', L2.webArp), k: 'bcast', t0: 0.05, t1: 0.42, end: null, label: 'ARP' }].concat(lagFlood('sw1', 'A', 'eno1', 'bcast', 0.42, 0.9, { srcEno: L2.webArp })),
          up: indep ? [{ at: 0.4, t: 'sw', k: 'web', v: { port: `A·${L2.webArp}`, fresh: true } }] : [],
          dec: [D(indep ? 'warn' : 'ok', 'Node A bond0 · xmit', `0x01 ^ 0xfe ^ 0x06 = 0xf9 · mod 4 = 1 → <b>${L2.webArp}</b>`)] },
      ],
    },
    {
      id: 'happy', n: '1', name: 'Cold start → migration (happy path)', init: coldStart,
      steps: [...coldStartSteps(), ...migrateSteps('A', 'B', 'eno3', 0, true)],
    },
    lifecycle(),
    {
      id: 'ex1', n: '#1', bad: true, name: 'One port left out of the port-channel', init: converged,
      steps: [
        { clock: 'T+0 s', whatif: 'Misconfiguration — B·eno3 is a plain trunk port, not in Po-B', title: 'A single un-grouped port splits the LAG', doc: 'Risk', dur: 5000,
          body: `<p>Three of Node B's ports are in <code>Po-B</code>; <code>B·eno3</code> was forgotten (wrong channel-group, or added after the fact). The bond cannot tell. Flows hashed to eno3 make sw2 learn their MACs on <b>the individual port</b>; flows on the other slaves re-learn them on Po-B. Each alternation is a MAC move.</p>`,
          vm: 'B',
          frames: [{ pts: uniUp('B', 'web', 'eno3'), k: 'uni', t0: 0.05, t1: 0.45, end: 'ok', label: 'vm-web → gw (eno3)' }, { pts: uniUp('B', 'web', 'eno4'), k: 'uni', t0: 0.5, t1: 0.9, end: 'ok', label: 'vm-web (eno4)' }],
          up: [{ at: 0.3, t: 'sw', k: 'web', v: { port: 'B·eno3 (single)', fresh: true } }, { at: 0.8, t: 'sw', k: 'web', v: { port: 'Po-B', fresh: true } }],
          dec: [D('warn', 'sw2', 'vm-web: Po-B → <b>B·eno3</b> → Po-B → … <b>MAC flapping</b>')] },
        { clock: 'T+0.01 s', whatif: 'Misconfiguration — B·eno3 is a plain trunk port, not in Po-B', title: 'Broadcasts now reach the node twice — and reflect', doc: 'Risk', dur: 5000,
          body: `<p>A broadcast from the gateway is sent once to Po-B and once to the lone port: two copies delivered. A broadcast from vm-web that leaves on a Po-B member is flooded back out <code>B·eno3</code> — a reflection the kernel accepts, so br-ex learns its own VM behind the bond. <b>Mitigate:</b> verify channel-group membership on all eight ports against the cabling; LACP would have refused to bundle the odd port.</p>`,
          vm: 'B',
          frames: [{ pts: fromCore('sw1'), k: 'bcast', t0: 0.05, t1: 0.25, label: 'gw ARP' }, { pts: dn('sw1', 'B', 'eno1', 'local'), k: 'bcast', t0: 0.25, t1: 0.65, end: 'ok' }, { pts: dn('sw1', 'B', 'eno3', 'local'), k: 'bcast', t0: 0.25, t1: 0.65, end: 'ok', note: 'dup' }, { pts: dn('sw1', 'A', 'eno2', 'local'), k: 'bcast', t0: 0.25, t1: 0.65, end: 'ok' }],
          dec: [D('warn', 'Node B br-ex', 'two copies of every broadcast; own broadcasts reflected via B·eno3')] },
      ],
    },
    {
      id: 'ex2', n: '#2', bad: true, name: 'No port-channel at all', init: coldStart,
      steps: [
        { clock: 'T+0 s', title: 'The full failure picture lives behind the toolbar toggle', doc: 'Risk', dur: 4600,
          body: `<p>Switch the toolbar to <b>Plain ports (no LAG)</b> and replay scenarios 0–2 to see what balance-xor does when nobody configured the static port-channel: MAC flapping between switch ports per destination and ethertype, every broadcast delivered four times, and each node's br-ex learning its own VMs behind the bond whenever a reflection arrives. The bond reports four healthy slaves throughout.</p>`,
          bodyI: `<p>You are in <b>Plain ports</b> mode: replay scenarios 0–2 for the detail. Summary: MAC flapping between switch ports per destination and ethertype, every broadcast delivered four times, each node's br-ex learning its own VMs behind the bond whenever a reflection arrives — while the bond reports four healthy slaves.</p>`,
          vm: 'A',
          frames: [{ pts: up('A', 'web', L2.webArp), k: 'bcast', t0: 0.05, t1: 0.4, end: null, label: 'ARP' }].concat(lagFlood('sw1', 'A', 'eno3', 'bcast', 0.4, 0.9, { srcEno: L2.webArp })),
          up: indep ? [{ at: 0.1, t: 'A', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.88, t: 'A', k: 'web', v: { port: 'bond0', wrong: true } }] : [{ at: 0.1, t: 'A', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.4, t: 'sw', k: 'web', v: { port: 'Po-A', fresh: true } }] },
      ],
    },
    {
      id: 'ex3', n: '#3', bad: true, name: 'Dead path, live carrier', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'miimon sees carrier, not forwarding', doc: 'bonding.rst · miimon / arp_interval', dur: 4800,
          body: `<p>A line-card hang or one-way fibre leaves <code>B·${webOut()}</code> with link but no forwarding. <code>miimon</code> only checks carrier, and there is no LACP heartbeat to notice. The slave stays active and every flow hashed to it — vm-web's north-south traffic, and under layer2 whichever MACs share the slot — is black-holed <b>indefinitely</b>.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', webOut()).slice(0, 6), k: 'uni', t0: 0.05, t1: 0.4, end: 'drop', note: 'black hole', label: 'vm-web → gw' }, { pts: up('B', 'web', webOut()).slice(0, 6), k: 'uni', t0: 0.4, t1: 0.75, end: 'drop' }].concat(podTraffic(0.3)),
          up: [{ at: 0.02, t: 'lk', k: 'B', v: Object.assign(lkDefault(), { [webOut()]: 'sil' }) }],
          dec: [D('drop', `Node B · ${webOut()}`, 'carrier up → slave active → frames sent, nothing arrives · <b>no timer will ever remove it</b>')] },
        { clock: 'T+∞', whatif: 'Hypothetical — arp_interval + arp_ip_target instead of miimon', title: 'ARP monitoring is the only detector — with a catch', doc: 'bonding.rst · arp_interval', dur: 4800,
          body: `<p>The ARP monitor can catch this by probing a target through each slave, but the kernel docs warn that in EtherChannel-compatible modes the switch must distribute replies across all links — with an XOR switch policy "all replies from the ARP targets will be received on the same link which could cause the other team members to fail". It also cannot be combined with miimon. <b>Mitigate:</b> accept the gap, or use LACP (3 s / 90 s detection).</p>`,
          vm: 'B',
          frames: [{ pts: uniUp('B', 'web', l34 ? 'eno2' : 'eno1'), k: 'uni', t0: 0.3, t1: 0.8, end: 'ok', label: 'vm-web → gw' }],
          up: [{ at: 0.1, t: 'lk', k: 'B', v: Object.assign(lkDefault(), { [webOut()]: 'down' }) }, { at: 0.1, t: 'down', k: `B.${webOut()}`, v: true }, { at: 0.2, t: 'hB', k: 'web', v: l34 ? F('eno2', 'eno1') : 'eno1' }] },
      ],
    },
    {
      id: 'ex4', n: '#4', bad: true, name: 'layer2 pins north-south traffic', init: steady,
      steps: [
        { clock: 'T+0 s', title: 'One gateway MAC → one slave per source MAC', doc: 'xmit_hash_policy=layer2', dur: 5000,
          body: `<p>Almost everything leaving an OpenShift node is addressed to the gateway MAC. Under layer2 the slave is fixed per <i>source</i> MAC: all pod traffic (node MAC) on one slave, each VM's entire traffic on one slave, and collisions by arithmetic (vm-x and the pods both land on <code>eno1</code>). Four links, but any single tenant sees one — the same limitation as balance-slb, without SLB's rebalancing.</p>`,
          vm: 'A',
          frames: [0, 0.12, 0.24].map((t) => ({ pts: uniUp('A', 'pods', 'eno1'), k: 'pod', t0: t, t1: t + 0.45, end: null })).concat([{ pts: uniUp('A', 'x', 'eno1'), k: 'uni', t0: 0.1, t1: 0.55, end: 'ok', label: 'vm-x → gw' }, { pts: uniUp('A', 'web', 'eno4'), k: 'uni', t0: 0.3, t1: 0.75, end: 'ok', label: 'vm-web → gw' }]),
          up: [{ at: 0.05, t: 'hA', k: 'web', v: 'eno4' }, { at: 0.05, t: 'hA', k: 'x', v: 'eno1' }, { at: 0.05, t: 'hA', k: 'pA', v: 'eno1' }],
          dec: [D('warn', 'Node A bond0 · xmit', 'pods 0xf4, vm-x 0xfc → mod 4 = 0 → <b>eno1</b>; vm-web 0xff → <b>eno4</b>; eno2/eno3 idle')] },
        { clock: 'T+0 s', whatif: 'Hypothetical — xmit_hash_policy=layer3+4 (or layer2+3)', title: 'layer3+4 spreads flows — with its own caveats', doc: 'xmit_hash_policy=layer3+4', dur: 5000,
          body: `<p>Hashing on IPs and ports spreads pod and VM flows across all slaves (use the <b>Hash</b> selector to replay every scenario this way). The kernel notes layer3+4 is "not fully 802.3ad compliant": fragmented and unfragmented packets of one conversation can take different slaves and arrive out of order. layer2+3 is compliant but still pins each VM↔gateway pair. The switch side needs a matching L3/L4 policy for inbound balance.</p>`,
          vm: 'A',
          frames: [['eno1', 0.05], ['eno3', 0.15], ['eno2', 0.25], ['eno4', 0.35]].map(([e, t]) => ({ pts: uniUp('A', 'pods', e), k: 'pod', t0: t, t1: t + 0.45, end: 'ok' })).concat([{ pts: uniUp('A', 'web', 'eno2'), k: 'uni', t0: 0.3, t1: 0.75, end: 'ok', label: 'vm-web flow 1' }, { pts: uniUp('A', 'web', 'eno3'), k: 'uni', t0: 0.45, t1: 0.9, end: 'ok', label: 'vm-web flow 2' }]),
          up: [{ at: 0.05, t: 'hA', k: 'web', v: 'eno2+eno3' }, { at: 0.05, t: 'hA', k: 'pA', v: 'eno1+eno2+eno3+eno4' }] },
      ],
    },
    {
      id: 'ex5', n: '#5', bad: true, name: 'RARP-only announcement after migration', init: justMigrated,
      steps: [
        { clock: 'T+0.002 s', title: 'The hypervisor announces with RARP, not GARP', doc: 'QEMU announce-self', dur: 5200,
          body: `<p>QEMU's self-announce is a <b>broadcast RARP</b>. SLB drops a non-GARP frame for a locally-learned MAC as a loop; balance-xor has no such rule. The RARP leaves Node B, the switches move <code>vm-web</code> to <code>${swPortOf('B', L2.webArp)}</code>${indep ? '' : ' (one MAC move)'}, and the copy delivered to Node A is accepted and learned.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', L2.webArp), k: 'rarp', t0: 0.05, t1: 0.42, end: null, label: 'RARP' }].concat(lagFlood('sw1', 'B', 'eno1', 'rarp', 0.42, 0.9, { note: 'accepted, learned', srcEno: L2.webArp })),
          up: [{ at: 0.1, t: 'B', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.2, t: 'hB', k: 'web', v: flowsOf('web') }, { at: 0.4, t: 'sw', k: 'web', v: { port: swPortOf('B', L2.webArp), fresh: true } }, { at: 0.86, t: 'A', k: 'web', v: { port: 'bond0', fresh: true } }],
          dec: [D('ok', 'Node A', 'slave active → <b>accept</b> regardless of frame type; br-ex: vm-web local → <b>bond0</b>')] },
        { clock: 'T+0.010 s', whatif: 'Hypothetical — no announcement at all after switchover', title: 'Residual risk: no announcement of any kind', doc: 'mac-aging-time', dur: 4600,
          body: `<p>If nothing is sent from the new location, the switches keep <code>vm-web → ${indep ? 'A·eno4' : 'Po-A'}</code> and deliver inbound traffic to Node A, whose <code>br-ex</code> still says <i>local</i> — into an empty slot — until vm-web transmits or entries age out (OVS default 300 s). Same exposure as any single-NIC host.</p>`,
          vm: 'B',
          frames: [{ pts: uniDown('A', 'eno4', 'web'), k: 'uni', t0: 0.05, t1: 0.6, end: 'drop', note: 'vm gone', label: 'gw → vm-web' }],
          up: [{ at: 0.02, t: 'sw', k: 'web', v: { port: swPortOf('A', 'eno4'), stale: true } }, { at: 0.02, t: 'A', k: 'web', v: { port: 'local', wrong: true } }, { at: 0.02, t: 'B', k: 'web', v: { port: 'bond0', wrong: true } }] },
      ],
    },
    {
      id: 'fail', n: '+', name: 'Related: member link down', init: converged,
      steps: failoverSteps('B', 1, -20).map((st) => Object.assign(st, { title: 'B·eno3 loses carrier: modulo-3 remap, no MAC move' })),
    },
  ]; }
  let SCEN = buildScenarios();

  const RISKS = [
    { sev: 'sev', tag: 'High', title: 'Nothing verifies the static port-channel', scen: 'ex2',
      html: `balance-xor sends and checks nothing. A missing channel-group, a port left out, or two MLAG peers disagreeing produces MAC flapping, quadruplicated broadcasts and bridges learning their own VMs behind the bond — while the bond shows four healthy slaves. <b>Mitigate:</b> audit channel-group membership on all eight ports against cabling before every node goes live; prefer LACP (802.3ad), which refuses to bundle a mismatched port.` },
    { sev: 'sev', tag: 'High', title: 'Dead paths are never detected', scen: 'ex3',
      html: `miimon checks carrier only; there is no heartbeat. A slave that links up but does not forward black-holes its share of flows indefinitely. ARP monitoring can help but is awkward in EtherChannel modes (the kernel docs warn that an XOR-hashing switch returns all probe replies on one link) and cannot run alongside miimon.` },
    { sev: '', tag: 'Medium', title: 'layer2 hashing pins everything behind one gateway MAC', scen: 'ex4',
      html: `The default policy picks a slave from source/destination MAC and ethertype. Toward one gateway MAC that means one slave per source MAC: the whole pod network on one link, each VM on one link, collisions by arithmetic. Use <code>xmit_hash_policy=layer3+4</code> (or layer2+3) and a matching switch policy; note layer3+4's ordering caveat with fragments.` },
    { sev: '', tag: 'Medium', title: 'A link failure remaps most flows, not just the failed ones', scen: 'fail',
      html: `The hash is taken modulo the slave count, so losing one of four slaves changes the slave for roughly three quarters of all flows, briefly reordering packets; the same happens when the link returns. Invisible to the switches (same LAG), visible to latency-sensitive workloads.` },
    { sev: 'ok', tag: 'Low', title: 'Migration behaves like LACP — when the LAG is right', scen: 'happy',
      html: `GARP or RARP, one MAC move (Po-A → Po-B), the old host accepts the flooded copy (no SLB loop rule), nothing is reflected. The only residual is a VM that stays silent after switchover.` },
    { sev: 'ok', tag: 'Expectation', title: 'Kernel bond, not OVS bond', scen: 'baseline',
      html: `This mode exists only as a Linux kernel bond beneath <code>br-ex</code>; Red Hat documents OVS bonds in active-backup or balance-slb and kernel bonding separately. OVS sees a single <code>bond0</code> port; all learning on the bridge is per bond, which is why OVS-side behaviour here matches LACP.` },
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
    pl.append(el('text', { x: 500, y: 196, 'text-anchor': 'middle', class: 'callout' }, 'static port-channel · Po-A, Po-B'));
    stat.append(pl);
    const npl = el('g', { id: 'nopeerlink', opacity: 0 });
    npl.append(el('text', { x: 500, y: 169, 'text-anchor': 'middle', class: 'callout' }, 'MLAG peer-link'));
    npl.append(el('text', { x: 500, y: 186, 'text-anchor': 'middle', class: 'callout', style: 'fill: var(--color-warning)' }, 'ports NOT channel-grouped'));
    npl.append(el('text', { x: 500, y: 203, 'text-anchor': 'middle', class: 'callout', style: 'fill: var(--color-warning)' }, 'each port learns alone'));
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
      stat.append(el('text', { x: H.cx, y: BR_TOP + 21, 'text-anchor': 'middle', class: 'lbl' }, 'br-ex · bond0 (kernel) balance-xor'));
      const bl = el('text', { x: H.cx, y: BR_TOP + 42, 'text-anchor': 'middle', class: 'sub mono' }, '');
      stat.append(bl); refs.brLine[h] = bl;
      // local
      stat.append(el('line', { x1: H.cx, y1: BR_TOP + 54, x2: H.cx, y2: LOC_Y - 15, class: 'link' }));
      stat.append(el('rect', { x: H.cx - 130, y: LOC_Y - 15, width: 260, height: 30, rx: 15, class: 'fdbport' }));
      stat.append(el('text', { x: H.cx, y: LOC_Y + 5, 'text-anchor': 'middle', class: 'sub' }, 'local · patch → br-int'));
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
      const e = swe;
      if (!e) { t.textContent = 'vm-web: unknown → flood'; t.style.fill = 'var(--color-warning)'; continue; }
      t.textContent = `vm-web → ${e.port}${e.moved && indep ? ' (moved)' : ''}`;
      t.style.fill = e.stale || (e.moved && indep) ? 'var(--color-warning)' : 'var(--color-text-muted)';
    }
    refs.coreLine.textContent = 'gw …:fe · VLAN 100 · MLAG port-channel'; refs.coreLine.style.fill = '';
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
    const key = JSON.stringify([indep, l34, s.sw, s.swx, s.A, s.B, s.hA, s.hB, s.lk, s.down, s.changed]);
    if (key === lastTblKey) return;
    lastTblKey = key;
    const ch = new Set(s.changed);
    const flags = (e) => (e ? `${e.lock ? '<span class="flag lock">GARP-LOCK</span>' : ''}${e.stale ? '<span class="flag stale">STALE</span>' : ''}${e.wrong ? '<span class="flag wrong">WRONG</span>' : ''}${e.moved ? '<span class="flag stale">MAC MOVE</span>' : ''}` : '');
    const cell = (e) => (e ? e.port + flags(e) : '<span style="color:var(--color-text-faint)" title="unknown → flood">—</span>');
    const row = (tb, k, e) => `<tr class="${ch.has(`${tb}.${k}`) ? 'changed' : ''}"><td>${MACN[k]}</td><td>${cell(e)}</td></tr>`;
    let swT;
    if (true) {
      swT = `<div class="tbl sw"><h4>sw1 + sw2 MAC table <small>${indep ? 'MLAG · ports individual' : 'MLAG · static Po-A, Po-B'}</small></h4><table><thead><tr><th>MAC</th><th>port</th></tr></thead><tbody>${ROWS.map((k) => row('sw', k, s.sw[k])).join('')}</tbody></table></div>`;
    } else {
      const r3 = (k) => `<tr class="${ch.has(`sw.${k}`) ? 'changed' : ''}"><td>${MACN[k]}</td><td>${cell(s.swx.sw1[k])}</td><td>${cell(s.swx.sw2[k])}</td><td class="${s.swx.core[k] && s.swx.core[k].moved ? 'moved' : ''}">${cell(s.swx.core[k])}</td></tr>`;
      swT = `<div class="tbl sw"><h4>Switch MAC tables <small>independent · VLAN 100</small></h4><table><thead><tr><th>MAC</th><th>sw1</th><th>sw2</th><th>core1</th></tr></thead><tbody>${ROWS.map(r3).join('')}</tbody></table></div>`;
    }
    const node = (h) => {
      const hk = h === 'A' ? 'hA' : 'hB';
      const nm = { web: 'vm-web', x: 'vm-x', pA: 'pods', pB: 'pods' };
      const hash = Object.entries(s[hk]).map(([k, m]) => `<span class="${ch.has(`${hk}.${k}`) ? 'flag new' : ''}">${nm[k]}→<b>${m}</b></span>`).join('') || '<span>—</span>';
      const LKN = { cur: 'active', sil: 'dead path', down: 'down' };
      const att = ENOS.filter((e) => s.lk[h][e] === 'cur').length;
      const downs = ENOS.filter((e) => s.lk[h][e] !== 'cur').map((e) => `<span class="flag ${s.lk[h][e] === 'ab' ? 'lock' : 'wrong'}">${e} ${LKN[s.lk[h][e]] || s.lk[h][e]}</span>`).join('');
      return `<div class="tbl"><h4>Node ${h} FDB <small>br-ex</small></h4><table><thead><tr><th>MAC</th><th>port</th></tr></thead><tbody>${ROWS.map((k) => row(h, k, s[h][k])).join('')}</tbody></table>
        <div class="meta"><span>slaves <b>${att}/4 up</b> · ${l34 ? 'layer3+4' : 'layer2'}</span>${downs}</div><div class="meta"><span>flows</span>${hash}</div></div>`;
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
  $('#hashSel').addEventListener('change', (e) => { l34 = e.target.value === 'l34'; rebuildScenarios(); lastStepIdx = -1; lastTblKey = ''; render(); });
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
