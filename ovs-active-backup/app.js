/* AB Scope — OVS active-backup MAC learning visualizer */
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
  // to: 'att' | 'adm' | 'br' | 'local' | vmKey
  let indep = false; // switch interconnect mode: false = MLAG peer-link, true = independent switches via core1
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

  // Flood from a switch to every host-facing member except `src` ("A.eno3").
  function flood(from, src, kind, spec, t0, t1, opts = {}) {
    const out = [];
    for (const h of ['A', 'B']) for (const e of ENOS) {
      const id = `${h}.${e}`;
      if (id === src) continue;
      const s = spec[id] || { to: 'adm', end: 'drop' };
      if (s.skip) continue;
      out.push({ pts: dn(from, h, e, s.to), k: kind, t0, t1, end: s.end, note: s.note, dash: opts.dash });
    }
    if (opts.core) out.push({ pts: toCore(from), k: kind, t0, t1: t0 + (t1 - t0) * 0.5, end: 'ok', dash: opts.dash });
    return out;
  }

  // Flood that originates north of the switches (from core1). MLAG: core1 hands it to one switch (port-channel hash),
  // which relays it over the peer-link. Independent: core1 floods to both switches in parallel.
  function coreFlood(kind, spec, t0, t1, opts = {}) {
    if (!indep) {
      const tm = t0 + (t1 - t0) * 0.2;
      return [{ pts: fromCore('sw1'), k: kind, t0, t1: tm, label: opts.label, dash: opts.dash }].concat(flood('sw1', null, kind, spec, tm, t1, opts));
    }
    const out = [];
    let first = true;
    for (const h of ['A', 'B']) for (const e of ENOS) {
      const id = `${h}.${e}`;
      const sp = spec[id] || { to: 'adm', end: 'drop' };
      if (sp.skip) continue;
      out.push({ pts: [CORE].concat(dn(swOf(e), h, e, sp.to)), k: kind, t0, t1, end: sp.end, note: sp.note, dash: opts.dash, label: first ? opts.label : undefined });
      first = false;
    }
    return out;
  }

  /* ---------------- Initial states ---------------- */
  // sw entries describe where the fabric last learned a MAC: 'X·enoN' (host port), 'core1' (north of the switches)
  const steady = () => fin({
    sw: { web: { port: 'A·eno1' }, x: { port: 'A·eno1' }, pA: { port: 'A·eno1' }, pB: { port: 'B·eno1' }, gw: { port: 'core1' } },
    A: { web: { port: 'local' }, x: { port: 'local' }, pA: { port: 'local' }, pB: { port: 'bond0' }, gw: { port: 'bond0' } },
    B: { web: { port: 'bond0' }, x: { port: 'bond0' }, pA: { port: 'bond0' }, pB: { port: 'local' }, gw: { port: 'bond0' } },
    hA: {}, hB: {},
    act: { A: 'eno1', B: 'eno1' }, down: {}, vm: 'A',
  });
  const converged = () => fin({
    sw: { web: { port: 'B·eno1' }, x: { port: 'A·eno1' }, pA: { port: 'A·eno1' }, pB: { port: 'B·eno1' }, gw: { port: 'core1' } },
    A: { web: { port: 'bond0' }, x: { port: 'local' }, pA: { port: 'local' }, pB: { port: 'bond0' }, gw: { port: 'bond0' } },
    B: { web: { port: 'local' }, x: { port: 'bond0' }, pA: { port: 'bond0' }, pB: { port: 'local' }, gw: { port: 'bond0' } },
    hA: {}, hB: {},
    act: { A: 'eno1', B: 'eno1' }, down: {}, vm: 'B',
  });
  const justMigrated = () => {
    const s = steady(); s.vm = 'B';
    patchSw(s, 'web', { stale: true }); s.A.web.stale = true; s.B.web.stale = true;
    return s;
  };
  // Cold start: nothing has learned vm-web or the gateway yet (vm-x and pods are already known)
  const coldStart = () => {
    const s = steady();
    applySw(s, 'web', null); applySw(s, 'gw', null);
    delete s.A.web; delete s.B.web; delete s.A.gw; delete s.B.gw;
    return s;
  };
  function fin(s) { s.swx = { sw1: {}, sw2: {}, core: {} }; for (const k of Object.keys(s.sw)) applySw(s, k, s.sw[k]); return s; }
  // Independent-switch view: each switch and core1 learn on their own
  function applySw(s, k, v) {
    if (v === null) { delete s.sw[k]; delete s.swx.sw1[k]; delete s.swx.sw2[k]; delete s.swx.core[k]; return; }
    s.sw[k] = Object.assign({}, v);
    const port = v.port;
    if (port === 'core1') { s.swx.sw1[k] = { port: 'core1', fresh: v.fresh }; s.swx.sw2[k] = { port: 'core1', fresh: v.fresh }; s.swx.core[k] = { port: 'uplink', fresh: v.fresh }; return; }
    const own = swOf(port.split('·')[1]), other = own === 'sw1' ? 'sw2' : 'sw1';
    s.swx[own][k] = { port, fresh: v.fresh };
    const prev = s.swx.core[k];
    s.swx.core[k] = { port: own, fresh: v.fresh, moved: !!(prev && prev.port !== own) };
    if (v.uni) { // unicast toward core1: the other switch never sees the frame
      if (s.swx[other][k] && s.swx[other][k].port !== 'core1') s.swx[other][k].stale = true;
    } else s.swx[other][k] = { port: 'core1', fresh: v.fresh };
  }
  function patchSw(s, k, v) {
    if (s.sw[k]) Object.assign(s.sw[k], v);
    for (const t of ['sw1', 'sw2', 'core']) if (s.swx[t][k]) Object.assign(s.swx[t][k], v);
  }

  /* ---------------- Decision trace helpers ---------------- */
  const D = (cls, where, html) => ({ cls, where, html });



  /* ---------------- Reusable step builders ---------------- */
  let nReb = 2; // user-selectable number of failovers in the lifecycle scenario
  const fmt = (sec) => (sec < 0 ? `T−${Math.abs(sec)} s` : `T+${Number.isInteger(sec) ? sec : sec.toFixed(3)} s`);
  const other = (h) => (h === 'A' ? 'B' : 'A');
  // Spec for a flood reaching host h: accepted on the active member only, everything else dropped as "backup".
  function abSpec(s, overrides = {}) {
    const spec = {};
    for (const h of ['A', 'B']) for (const e of ENOS) spec[`${h}.${e}`] = s.act[h] === e ? { to: 'local', end: 'ok' } : { to: 'adm', end: 'drop', note: 'backup' };
    return Object.assign(spec, overrides);
  }
  // Background Kubernetes pod traffic — on the active member, like everything else.
  function podTraffic(o = 0, act = { A: 'eno1', B: 'eno1' }) {
    const out = [];
    [['A', 0], ['B', 0.3]].forEach(([h, d]) => {
      const t = o + d, e = act[h], s = swOf(e);
      out.push({ pts: join(up(h, 'pods', e), toCore(s)), k: 'pod', t0: t, t1: t + 0.3, end: null });
      out.push({ pts: join(fromCore(s), dn(s, h, e, 'pods')), k: 'pod', t0: t + 0.32, t1: t + 0.62, end: null });
    });
    return out;
  }
  const swPort = (h, e) => `${h}·${e}`;

  function coldStartSteps(act = { A: 'eno1', B: 'eno1' }) {
    const a = act.A, b = act.B, sA = swOf(a), sB = swOf(b);
    const s0 = { act };
    return [
      { clock: 'T−60 s', title: 'Cold start: vm-web ARPs for its gateway on the active member', doc: 'Bond packet output', dur: 5200,
        body: `<p>Active-backup has no hash: <b>every</b> frame from every MAC on the node leaves on the one active member, <code>${a}</code>. ${sA} learns <code>vm-web → ${swPort('A', a)}</code>.</p><p>The switch floods the ARP to every other port. Node B accepts the copy on its active member <code>${b}</code> and learns <code>vm-web → bond0</code>; the copies on the backup members of both nodes are <b>dropped unconditionally</b> — OVS "drops all packets which arrive on backup members". No learning-table trick is needed to suppress the reflection.</p>`,
        bodyI: `<p>Active-backup has no hash: every frame from every MAC on the node leaves on the one active member, <code>${a}</code>. ${sA} learns <code>vm-web → ${swPort('A', a)}</code>, core1 learns it toward ${sA}, and the flood crosses core1 to reach sw2's ports.</p><p>Node B accepts the copy on its active member and learns <code>vm-web → bond0</code>; every copy on a backup member is dropped unconditionally. Because only one member per node ever talks, having members on two independent switches is <b>supported</b> in this mode — the only OVS mode where it is.</p>`,
        vm: 'A',
        frames: [{ pts: up('A', 'web', a), k: 'bcast', t0: 0.05, t1: 0.42, end: null, label: 'ARP who-has gw' }]
          .concat(flood(sA, `A.${a}`, 'bcast', abSpec(s0), 0.42, 0.9, { core: true })).concat(podTraffic(0.3, act)),
        up: [{ at: 0.1, t: 'A', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.4, t: 'sw', k: 'web', v: { port: swPort('A', a), fresh: true } }, { at: 0.86, t: 'B', k: 'web', v: { port: 'bond0', fresh: true } }],
        dec: [D('ok', `Node B · ${b} (active)`, 'bond_check_admissibility: active member → <b>BV_ACCEPT</b>; learn vm-web → bond0'), D('drop', 'Node A, Node B · backup members', 'BM_AB: "active-backup bond received packet on backup member" → <b>drop</b>')] },
      { clock: 'T−59 s', title: 'The gateway answers, then broadcasts in turn', doc: 'Bond packet input', dur: 5200,
        body: `<p>The ARP reply is unicast; the switch sends it to the port it learned vm-web on — the active member — and Node A learns <code>gw → bond0</code>. The gateway's own broadcast ARP then arrives on all four members of each node: one copy accepted on the active member, three dropped. Node B learns <code>gw → bond0</code> too.</p>`,
        vm: 'A',
        frames: [{ pts: join(fromCore(sA), dn(sA, 'A', a, 'web')), k: 'uni', t0: 0.05, t1: 0.5, end: 'ok', label: 'ARP reply → vm-web' }]
          .concat(coreFlood('bcast', abSpec(s0), 0.5, 0.95, { label: 'gw ARP who-has' })).concat(podTraffic(0.05, act)),
        up: [{ at: 0.1, t: 'sw', k: 'gw', v: { port: 'core1', fresh: true } }, { at: 0.45, t: 'A', k: 'gw', v: { port: 'bond0', fresh: true } }, { at: 0.9, t: 'B', k: 'gw', v: { port: 'bond0', fresh: true } }],
        dec: [D('ok', `Node A · ${a} (active)`, 'unicast on active member → <b>accept</b>; learn gw → bond0'), D('drop', 'all backup members', 'broadcast on backup → <b>drop</b> (no duplicates reach the bridge)')] },
    ];
  }

  // Five steps that move vm-web from `from` to `to`. `act` = current active member per node.
  function migrateSteps(from, to, base, act, firstTime) {
    const rev = from === 'B';
    const mig = rev ? MIG.slice().reverse() : MIG;
    const aTo = act[to], aFrom = act[from], sTo = swOf(aTo), sFrom = swOf(aFrom);
    const port = swPort(to, aTo), portOld = swPort(from, aFrom);
    const cross = sTo !== sFrom;
    return [
      { clock: fmt(base - 3), title: `Live migration ${from} → ${to}: pre-copy`, doc: 'Setup', dur: 3600,
        body: `<p>KubeVirt copies vm-web's memory to Node ${to}. vm-web keeps running on Node ${from}, so every table is still correct: switches → <code>${portOld}</code>, Node ${from} → <code>local</code>, Node ${to} → <code>bond0</code>.</p>`,
        vm: from, mig: true,
        frames: [0.05, 0.25, 0.45].map((t) => ({ pts: mig, k: 'mig', t0: t, t1: t + 0.45 })).concat(podTraffic(0.1, act)) },
      { clock: fmt(base), title: `Switchover: vm-web resumes on Node ${to}`, doc: 'Setup', dur: 3200,
        body: `<p>vm-web pauses on ${from} and resumes on ${to}. Every table is now wrong: the switches still point at <code>${portOld}</code>, Node ${from} thinks vm-web is local, Node ${to} thinks it is out the bond. Only an announcement from the new location can fix all three — same as in any bond mode.</p>`,
        vm: ['move', 0.1, 0.7, rev ? 'rev' : 'fwd'], mig: true,
        frames: podTraffic(0.2, act),
        up: [{ at: 0.7, t: 'patch', tb: 'sw', k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: from, k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: to, k: 'web', v: { stale: true } }] },
      { clock: fmt(base + 0.002), title: `GARP leaves Node ${to} on its active member ${aTo}`, doc: 'Bond packet output', dur: 4000,
        body: `<p>The gratuitous ARP enters <code>br-phy</code> from the local port: Node ${to} learns <code>vm-web → local</code> (and arms the 5 s GARP lock). There is nothing to choose — it leaves on <code>${aTo}</code>.</p><p>${sTo} sees vm-web on <code>${port}</code> and moves the entry${cross ? ' — a MAC move between the two switches' : ' — a MAC move between two of its ports'}.${indep && cross ? ' core1 records a MAC move too; the other switch will be corrected by the flood.' : ''}</p>`,
        vm: to,
        frames: [{ pts: up(to, 'web', aTo), k: 'garp', t0: 0.05, t1: 0.75, end: null, label: 'GARP' }].concat(podTraffic(0.3, act)),
        up: [{ at: 0.18, t: to, k: 'web', v: { port: 'local', lock: true, fresh: true } }, { at: 0.74, t: 'sw', k: 'web', v: { port, fresh: true } }],
        dec: [D('ok', `${sTo}`, `src vm-web on ${port} (was ${portOld}) → <b>MAC move</b>`)] },
      { clock: fmt(base + 0.003), title: 'The GARP floods to every port; only active members accept it', doc: 'Bond packet input', dur: 5200,
        body: `<p>Node ${from} receives the GARP on all four members. The three backups drop it unconditionally; the active member accepts it. Node ${from} still has <code>vm-web → local</code>, but active-backup has no "looped back" check — that exists only in SLB — so it relearns <code>vm-web → bond0</code> like any MAC move.</p><p>Node ${to}'s own reflections land on its backup members and are dropped there; the GARP lock never comes into play.</p>`,
        vm: to,
        frames: flood(sTo, `${to}.${aTo}`, 'garp', abSpec({ act }, { [`${from}.${aFrom}`]: { to: 'local', end: 'ok', note: 'active' } }), 0.05, 0.75, { core: true }).concat(podTraffic(0.35, act)),
        up: [{ at: 0.66, t: from, k: 'web', v: { port: 'bond0', fresh: true } }],
        dec: [D('ok', `Node ${from} · ${aFrom} (active)`, 'BM_AB active member → <b>BV_ACCEPT</b>; learn vm-web local → <b>bond0</b>'), D('drop', `Node ${to} · backups`, 'reflected GARP on backup members → <b>drop</b>')] },
      { clock: fmt(base + 0.01), title: `Converged on Node ${to}`, doc: 'Result', dur: 4000,
        body: `<p>The gateway reaches vm-web through <code>${port}</code>. One GARP, one MAC move per switch, both nodes corrected in milliseconds — and all of it on a single link per node.</p>`,
        vm: to,
        frames: [{ pts: join(fromCore(sTo), dn(sTo, to, aTo, 'web')), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }, { pts: join(up(to, 'web', aTo), toCore(sTo)), k: 'uni', t0: 0.45, t1: 0.95, end: 'ok', label: 'vm-web → gw' }].concat(podTraffic(0.1, act)),
        up: [{ at: 0.1, t: 'patch', tb: 'sw', k: 'web', v: { stale: false } }, { at: 0.9, t: 'patch', tb: to, k: 'web', v: { lock: false } }] },
    ];
  }
  // Failover: active member of `host` goes down, next member takes over, learning RARPs re-teach the switches.
  function failoverSteps(host, n, clock0, act0) {
    const cycle = ['eno1', 'eno2', 'eno3', 'eno4'];
    const steps = [];
    const act = Object.assign({}, act0);
    let idx = cycle.indexOf(act[host]);
    const locals = host === 'B' ? [['web', 'vm-web'], ['pB', 'pods-B']] : [['x', 'vm-x'], ['pA', 'pods-A']];
    for (let i = 1; i <= n; i++) {
      const cur = cycle[idx]; idx = (idx + 1) % cycle.length; const nxt = cycle[idx];
      const sOld = swOf(cur), sNew = swOf(nxt), cross = sOld !== sNew, t = clock0 + i * 20;
      const prevDown = i > 1 ? cycle[(idx + 2) % 4] : null;
      const a2 = Object.assign({}, act, { [host]: nxt });
      const ups = [{ at: 0.1, t: 'down', k: `${host}.${cur}`, v: true }, { at: 0.2, t: 'act', k: host, v: nxt }];
      if (prevDown) ups.push({ at: 0.05, t: 'down', k: `${host}.${prevDown}`, v: false });
      locals.forEach(([k], j) => ups.push({ at: 0.55 + j * 0.1, t: 'sw', k, v: { port: swPort(host, nxt), fresh: true } }));
      steps.push({ clock: `T+${t} s`, title: `Failover ${i}/${n} on Node ${host}: ${cur} → ${nxt}${cross ? ' (other switch)' : ''}`, doc: 'Enabling and disabling members · learning packets', dur: 5200,
        body: `<p><code>${cur}</code> loses carrier. OVS disables it at once and picks the next enabled member, <code>${nxt}</code>, as active. Then it sends a <b>gratuitous learning packet — a RARP — for every MAC learned on a port other than the bond</b> (here vm-web${host === 'B' ? '' : ' is not local; vm-x'} and the pod MAC) out the new member.</p><p>${cross
          ? (indep ? `${sNew} learns the MACs on <code>${swPort(host, nxt)}</code>; the RARPs are broadcast, so they flood through core1 and also correct ${sOld} — core1 logs a <b>MAC move</b> per MAC.` : `The MLAG pair sees every one of those MACs <b>move</b> from a ${sOld} port to a ${sNew} port.`)
          : `${sNew} moves the MACs between two of its own ports.`} With many VMs on the node, a single failover is a burst of RARPs and MAC moves.</p>`,
        vm: host === 'B' ? 'B' : 'B',
        frames: locals.map(([k, name], j) => ({ pts: join(up(host, k === 'web' ? 'web' : k === 'x' ? 'x' : 'pods', nxt), toCore(sNew)), k: 'rarp', t0: 0.3 + j * 0.15, t1: 0.8 + j * 0.15, end: 'ok', label: `RARP ${name}` })).concat(podTraffic(0.05, a2)),
        up: ups,
        dec: [D('warn', `Node ${host} bond0`, `carrier down on ${cur} → active = <b>${nxt}</b>; bundle_send_learning_packets(): one RARP per local MAC`), cross ? D('warn', indep ? 'core1' : `${sOld} + ${sNew} (MLAG)`, `${locals.map((l) => l[1]).join(', ')}: <b>MAC move</b> ${sOld} → ${sNew}`) : D('ok', sNew, `${locals.map((l) => l[1]).join(', ')}: ${swPort(host, cur)} → ${swPort(host, nxt)} within one switch`)] });
      act[host] = nxt;
    }
    return { steps, act };
  }
  function lifecycle() {
    const act0 = { A: 'eno1', B: 'eno1' };
    const fo = failoverSteps('B', nReb, 0, act0);
    const steps = []
      .concat(coldStartSteps(act0))
      .concat(migrateSteps('A', 'B', 0, act0, true))
      .concat(fo.steps)
      .concat(migrateSteps('B', 'A', nReb * 20 + 30, fo.act, false));
    steps.push({ clock: `T+${nReb * 20 + 31} s`, title: 'Back on Node A — what the fabric saw', doc: 'Summary', dur: 4200,
      body: `<p>Two migrations and ${nReb} failover${nReb === 1 ? '' : 's'}: vm-web's MAC changed switch port <b>${2 + nReb}</b> times, and each failover also moved every other MAC on Node B. Every one of those moves was announced (GARP by the hypervisor, RARP by OVS) — active-backup never relies on a VM's next frame.</p><p>Pod traffic always shared the single active link with every VM on the node.</p>`,
      vm: 'A',
      frames: [{ pts: join(fromCore('sw1'), dn('sw1', 'A', 'eno1', 'web')), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }].concat(podTraffic(0.1, fo.act)) });
    return { id: 'life', n: '2', name: 'Lifecycle: migrate → failover ×N → migrate back', init: coldStart, steps };
  }

  /* ---------------- Scenarios ---------------- */
  function buildScenarios() { return [
    {
      id: 'baseline', n: '0', name: 'How active-backup works', init: () => { const s = steady(); applySw(s, 'web', null); applySw(s, 'x', null); applySw(s, 'pA', null); return s; },
      steps: [
        { clock: 'T+0.000 s', title: 'Everything leaves on the active member', doc: 'Bond packet output', dur: 4600,
          body: `<p>There is no hashing. vm-web, vm-x and every pod flow on Node A leave on <code>eno1</code>, and sw1 learns all three MACs on <code>A·eno1</code>. The other three members carry nothing; they exist only to take over.</p><p>Per-node bandwidth is one link, for VMs and pods alike.</p>`,
          vm: 'A',
          frames: [['web', 0.05, 'vm-web → gw'], ['x', 0.25, 'vm-x → gw'], ['pods', 0.45, 'pods → gw']].map(([vm, t, l]) => ({ pts: join(up('A', vm, 'eno1'), toCore('sw1')), k: vm === 'pods' ? 'pod' : 'uni', t0: t, t1: t + 0.5, end: 'ok', label: l })),
          up: [{ at: 0.3, t: 'sw', k: 'web', v: { port: 'A·eno1', fresh: true, uni: true } }, { at: 0.5, t: 'sw', k: 'x', v: { port: 'A·eno1', fresh: true, uni: true } }, { at: 0.7, t: 'sw', k: 'pA', v: { port: 'A·eno1', fresh: true, uni: true } }],
          dec: [D('ok', 'Node A bond0 · output', 'bond_choose_output_member: BM_AB → <b>active member eno1</b> for every frame')] },
        { clock: 'T+0.001 s', title: 'Return traffic follows the switch’s single learned port', doc: 'Bond packet input', dur: 3600,
          body: `<p>The switch has one port per MAC — the active member — so unicast always arrives there and is accepted. Ingress and egress line up by construction.</p>`,
          vm: 'A',
          frames: [{ pts: join(fromCore('sw1'), dn('sw1', 'A', 'eno1', 'web')), k: 'uni', t0: 0.05, t1: 0.6, end: 'ok', label: 'gw → vm-web' }, { pts: join(fromCore('sw1'), dn('sw1', 'A', 'eno1', 'pods')), k: 'pod', t0: 0.3, t1: 0.85, end: 'ok' }],
          dec: [D('ok', 'Node A · eno1 (active)', 'bond->active_member == member → <b>BV_ACCEPT</b>')] },
        { clock: 'T+0.002 s', title: 'Backup members drop everything they receive', doc: 'Bond packet input', dur: 5000,
          body: `<p>A broadcast from the gateway is flooded to all four members of each node. Only the active member's copy is admitted; the backups drop theirs, unicast or broadcast, "similar to how Linux bonding handles active-backup bonds".</p><p>This is what makes the mode safe on <b>two independent switches</b>: a backup port can be anywhere, it will never inject a duplicate.</p>`,
          vm: 'A',
          frames: coreFlood('bcast', abSpec({ act: { A: 'eno1', B: 'eno1' } }), 0.05, 0.9, { label: 'gw ARP who-has' }),
          dec: [D('ok', 'Node A · eno1, Node B · eno1', 'active → <b>accept</b>'), D('drop', 'eno2, eno3, eno4 on both nodes', 'backup member → <b>drop</b>')] },
        { clock: 'T+0.003 s', title: 'Reflections of our own broadcast land on backups — dropped', doc: 'Bond packet input', dur: 5000,
          body: `<p>vm-web's own ARP comes back from the switch on <code>eno2–eno4</code>. In SLB this is the case that needs MAC-learning-based loop detection; here the copies arrive on backup members and are dropped before any of that logic runs.</p>`,
          vm: 'A',
          frames: [{ pts: up('A', 'web', 'eno1'), k: 'bcast', t0: 0.05, t1: 0.4, end: null, label: 'ARP' }].concat(flood('sw1', 'A.eno1', 'bcast', abSpec({ act: { A: 'eno1', B: 'eno1' } }), 0.4, 0.9, { core: true })),
          dec: [D('drop', 'Node A · eno2, eno3, eno4', 'reflected copy on backup → <b>drop</b>'), D('ok', 'Node B · eno1', 'accept, learn vm-web → bond0')] },
      ],
    },
    {
      id: 'happy', n: '1', name: 'Cold start → migration (happy path)', init: coldStart,
      steps: [...coldStartSteps(), ...migrateSteps('A', 'B', 0, { A: 'eno1', B: 'eno1' }, true)],
    },
    lifecycle(),
    {
      id: 'ex1', n: '#1', bad: true, name: 'Failover = RARP burst & MAC moves', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'Active member fails: one RARP per learned MAC', doc: 'Enabling and disabling members', dur: 5200,
          body: `<p>B·eno1 loses carrier. OVS makes <code>eno2</code> active and sends a learning RARP <b>for each MAC learned on a non-bond port</b>: vm-web, the pod MAC, and every other VM on the node. A node with 100 VMs emits 100 RARPs; each is a MAC move on the switches.</p><p>The switch also flushed its entries for the dead port, so until the RARPs land, inbound traffic for those MACs is flooded or black-holed.</p>`,
          vm: 'B',
          frames: [{ pts: join(up('B', 'web', 'eno2'), toCore('sw1')), k: 'rarp', t0: 0.3, t1: 0.75, end: 'ok', label: 'RARP vm-web' }, { pts: join(up('B', 'pods', 'eno2'), toCore('sw1')), k: 'rarp', t0: 0.45, t1: 0.9, end: 'ok', label: 'RARP pods-B' }],
          up: [{ at: 0.1, t: 'down', k: 'B.eno1', v: true }, { at: 0.2, t: 'act', k: 'B', v: 'eno2' }, { at: 0.15, t: 'sw', k: 'web', v: null }, { at: 0.15, t: 'sw', k: 'pB', v: null }, { at: 0.6, t: 'sw', k: 'web', v: { port: 'B·eno2', fresh: true } }, { at: 0.75, t: 'sw', k: 'pB', v: { port: 'B·eno2', fresh: true } }],
          dec: [D('warn', 'Node B bond0', 'eno1 disabled → active = <b>eno2</b>; bundle_send_learning_packets() → RARP × (MACs learned on local ports)'), D('warn', 'sw1', 'port B·eno1 down → <b>flush</b>; relearn from RARPs on B·eno2')] },
        { clock: 'T+20 s', title: 'Second failure crosses switches', doc: 'Enabling and disabling members', dur: 5200,
          body: `<p>If eno2 fails as well, eno3 on <b>sw2</b> takes over and the whole node's MAC set moves to the other switch.${indep ? ' Without a peer-link, core1 records a MAC move for every MAC and sw1 is corrected only because the RARPs are broadcast and flood back through core1.' : ' The MLAG pair updates its synced table; platforms with MAC-move rate limiting may throttle a large burst.'}</p><p><b>Mitigate:</b> keep the first two members on different switches so a single-switch failure costs one failover, not two; ask the switch vendor about MAC-move thresholds.</p>`,
          vm: 'B',
          frames: [{ pts: join(up('B', 'web', 'eno3'), toCore('sw2')), k: 'rarp', t0: 0.3, t1: 0.75, end: 'ok', label: 'RARP vm-web' }, { pts: join(up('B', 'pods', 'eno3'), toCore('sw2')), k: 'rarp', t0: 0.45, t1: 0.9, end: 'ok', label: 'RARP pods-B' }],
          up: [{ at: 0.1, t: 'down', k: 'B.eno2', v: true }, { at: 0.2, t: 'act', k: 'B', v: 'eno3' }, { at: 0.6, t: 'sw', k: 'web', v: { port: 'B·eno3', fresh: true } }, { at: 0.75, t: 'sw', k: 'pB', v: { port: 'B·eno3', fresh: true } }],
          dec: [D('warn', indep ? 'core1' : 'sw1 + sw2 (MLAG)', 'vm-web, pods-B: <b>MAC move</b> sw1 → sw2')] },
      ],
    },
    {
      id: 'ex2', n: '#2', bad: true, name: 'Failover into a dead backup', init: converged,
      steps: [
        { clock: 'T−1 h', whatif: 'Latent fault — backup port has carrier but no working path', title: 'Nothing ever tests a backup', doc: 'Risk', dur: 4600,
          body: `<p>Backups drop everything and send nothing, so a backup whose upstream is broken looks identical to a healthy one: VLAN 100 missing from the trunk on <code>B·eno2</code>, a mis-patched cable, a port err-disabled on the far side of a media converter. There is no LACP to validate the path and no traffic to notice it. <code>bond/show</code> says <i>enabled</i>.</p>`,
          vm: 'B',
          frames: podTraffic(0.1, { A: 'eno1', B: 'eno1' }),
          up: [{ at: 0.02, t: 'patch', tb: 'B', k: 'web', v: {} }] },
        { clock: 'T+0 s', title: 'The active member fails — straight into the hole', doc: 'Risk', dur: 5200,
          body: `<p>eno1 drops, eno2 becomes active, RARPs leave — and go nowhere. Return traffic from the gateway is sent to B·eno2 by the switch (or flooded) and is never delivered. vm-web and every pod on Node B are offline <b>until a human intervenes</b>; OVS sees a perfectly healthy enabled member.</p><p><b>Mitigate:</b> validate every backup port's VLAN config identically to the active one; periodically force failovers in maintenance windows; or use a mode with path validation (LACP).</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', 'eno2').slice(0, 6), k: 'rarp', t0: 0.3, t1: 0.6, end: 'drop', note: 'no VLAN 100', label: 'RARP vm-web' }, { pts: join(fromCore('sw1'), dn('sw1', 'B', 'eno2', 'att')), k: 'uni', t0: 0.55, t1: 0.95, end: 'drop', note: 'no VLAN 100', label: 'gw → vm-web' }],
          up: [{ at: 0.1, t: 'down', k: 'B.eno1', v: true }, { at: 0.2, t: 'act', k: 'B', v: 'eno2' }, { at: 0.15, t: 'sw', k: 'web', v: null }, { at: 0.15, t: 'sw', k: 'pB', v: null }, { at: 0.3, t: 'patch', tb: 'B', k: 'web', v: { wrong: true } }],
          dec: [D('drop', 'B·eno2 switch port', 'VLAN 100 not allowed on trunk → RARP and all data <b>dropped at the switch</b>'), D('warn', 'Node B bond0', 'active = eno2, enabled = true — <b>no fault visible to OVS</b>')] },
      ],
    },
    {
      id: 'ex3', n: '#3', bad: true, name: 'bond-primary & link flapping', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'eno1 flaps: failover to eno2', doc: 'bond-primary · updelay', dur: 4200,
          body: `<p>With <code>other_config:bond-primary=eno1</code> the primary is re-selected <b>whenever it is up</b>. A flapping transceiver on eno1 therefore produces two failovers per flap: away from eno1 when it drops, back to eno1 when it returns — each with its RARP burst and MAC moves.</p>`,
          vm: 'B',
          frames: [{ pts: join(up('B', 'web', 'eno2'), toCore('sw1')), k: 'rarp', t0: 0.3, t1: 0.75, end: 'ok', label: 'RARP vm-web' }, { pts: join(up('B', 'pods', 'eno2'), toCore('sw1')), k: 'rarp', t0: 0.45, t1: 0.9, end: null }],
          up: [{ at: 0.1, t: 'down', k: 'B.eno1', v: true }, { at: 0.2, t: 'act', k: 'B', v: 'eno2' }, { at: 0.6, t: 'sw', k: 'web', v: { port: 'B·eno2', fresh: true } }, { at: 0.75, t: 'sw', k: 'pB', v: { port: 'B·eno2', fresh: true } }] },
        { clock: 'T+2 s', title: 'eno1 returns: preempted back, another burst', doc: 'bond-primary', dur: 4200,
          body: `<p>Carrier comes back and, after <code>updelay</code> (default 0 ms), eno1 is primary again. Another set of RARPs, another MAC move per MAC. Repeat every few seconds and the switches' MAC-move protection may start dropping or err-disabling the port.</p><p><b>Mitigate:</b> a generous <code>updelay</code> (longer than the switch's STP forwarding delay, as the OVS docs advise), or no <code>bond-primary</code> at all so a recovered link simply becomes a backup.</p>`,
          vm: 'B',
          frames: [{ pts: join(up('B', 'web', 'eno1'), toCore('sw1')), k: 'rarp', t0: 0.3, t1: 0.75, end: 'ok', label: 'RARP vm-web' }, { pts: join(up('B', 'pods', 'eno1'), toCore('sw1')), k: 'rarp', t0: 0.45, t1: 0.9, end: null }],
          up: [{ at: 0.1, t: 'down', k: 'B.eno1', v: false }, { at: 0.2, t: 'act', k: 'B', v: 'eno1' }, { at: 0.6, t: 'sw', k: 'web', v: { port: 'B·eno1', fresh: true } }, { at: 0.75, t: 'sw', k: 'pB', v: { port: 'B·eno1', fresh: true } }],
          dec: [D('warn', 'Node B bond0', 'primary eno1 enabled → bond_choose_active_member() → <b>eno1</b> again; RARP burst #2')] },
      ],
    },
    {
      id: 'ex4', n: '#4', bad: true, name: 'RARP-only announcement after migration', init: justMigrated,
      steps: [
        { clock: 'T+0.002 s', title: 'The hypervisor announces with RARP, not GARP', doc: 'QEMU announce-self', dur: 5200,
          body: `<p>QEMU's self-announce is a <b>broadcast RARP</b>; OVN sends GARP only for ports whose IP it knows. In SLB this was the top risk, because a non-GARP frame for a locally-learned MAC is dropped as a loop at the old host.</p><p>Active-backup has no such rule: the old host accepts the RARP on its active member and relearns <code>vm-web → bond0</code>; the switches move the MAC. The copies on backup members are dropped, as always.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', 'eno1'), k: 'rarp', t0: 0.05, t1: 0.42, end: null, label: 'RARP' }].concat(flood('sw1', 'B.eno1', 'rarp', abSpec({ act: { A: 'eno1', B: 'eno1' } }, { 'A.eno1': { to: 'local', end: 'ok', note: 'active, learned' } }), 0.42, 0.9, { core: true })),
          up: [{ at: 0.1, t: 'B', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.4, t: 'sw', k: 'web', v: { port: 'B·eno1', fresh: true } }, { at: 0.86, t: 'A', k: 'web', v: { port: 'bond0', fresh: true } }],
          dec: [D('ok', 'Node A · eno1 (active)', 'BM_AB → <b>BV_ACCEPT</b> regardless of frame type; mac_learning: local → <b>bond0</b>')] },
        { clock: 'T+0.010 s', whatif: 'Hypothetical — no announcement at all after switchover', title: 'Residual risk: no announcement of any kind', doc: 'mac-aging-time', dur: 4600,
          body: `<p>If nothing is sent from the new location, the switches keep <code>vm-web → A·eno1</code> and deliver inbound traffic to Node A, whose <code>br-phy</code> still says <i>local</i> — into an empty slot — until vm-web transmits or the entries age out (OVS default 300 s). Same exposure as any single-NIC host.</p>`,
          vm: 'B',
          frames: [{ pts: join(fromCore('sw1'), dn('sw1', 'A', 'eno1', 'web')), k: 'uni', t0: 0.05, t1: 0.6, end: 'drop', note: 'vm gone', label: 'gw → vm-web' }],
          up: [{ at: 0.02, t: 'sw', k: 'web', v: { port: 'A·eno1', stale: true } }, { at: 0.02, t: 'A', k: 'web', v: { port: 'local', wrong: true } }, { at: 0.02, t: 'B', k: 'web', v: { port: 'bond0', wrong: true } }] },
      ],
    },
    {
      id: 'ex5', n: '#5', bad: true, name: 'Kernel bond instead of OVS bond', init: converged,
      steps: [
        { clock: 'T+0 s', whatif: 'Variant — Linux kernel active-backup bond under br-ex (no br-phy)', title: 'Kernel failover announces the node, not the VMs', doc: 'bonding.rst · num_grat_arp', dur: 5200,
          body: `<p>With a <b>kernel</b> active-backup bond, failover sends gratuitous ARPs only for the bond's own IP (and VLAN sub-interfaces). The kernel knows nothing about VM MACs behind <code>br-ex</code>, so <b>no learning packet</b> is sent for vm-web. The switch flushed B·eno1's entries when the port dropped; vm-web is now <i>unknown</i>.</p>`,
          vm: 'B',
          frames: [{ pts: join(up('B', 'pods', 'eno2'), toCore('sw1')), k: 'garp', t0: 0.3, t1: 0.75, end: 'ok', label: 'GARP node IP' }],
          up: [{ at: 0.1, t: 'down', k: 'B.eno1', v: true }, { at: 0.2, t: 'act', k: 'B', v: 'eno2' }, { at: 0.15, t: 'sw', k: 'web', v: null }, { at: 0.15, t: 'sw', k: 'pB', v: null }, { at: 0.7, t: 'sw', k: 'pB', v: { port: 'B·eno2', fresh: true } }],
          dec: [D('ok', 'sw1', 'pods-B (node MAC) relearned from the kernel GARP'), D('warn', 'sw1', 'vm-web: <b>unknown</b> — nothing announced it')] },
        { clock: 'T+0.01 s', title: 'vm-web depends on unknown-unicast flooding', doc: 'Risk', dur: 5200,
          body: `<p>Inbound traffic for vm-web is now <b>flooded</b>. ${indep ? 'core1 still points at sw1; sw1 floods to its live ports and the copy on B·eno2 is accepted — it works, but the whole VLAN sees vm-web\'s traffic until vm-web transmits and is relearned.' : 'The MLAG pair floods it to every port; the copy on the new active member is accepted, so connectivity survives, at the cost of flooding vm-web\'s traffic VLAN-wide until it transmits.'} If the failure did <i>not</i> drop the switch port (host-side NIC fault), nothing is flushed and vm-web is black-holed until aging.</p><p><b>Mitigate:</b> prefer the OVS bond for VM-heavy nodes (RARP per MAC on failover), or accept that VM reachability after failover rests on switch flush + flooding.</p>`,
          vm: 'B',
          frames: coreFlood('uni', abSpec({ act: { A: 'eno1', B: 'eno2' } }, { 'A.eno1': { to: 'local', end: 'ok', note: 'flooded copy' } }), 0.05, 0.9, { label: 'gw → vm-web (unknown)' }),
          up: [{ at: 0.85, t: 'sw', k: 'web', v: { port: 'B·eno2', fresh: true } }],
          dec: [D('warn', 'switches', 'dst vm-web unknown → <b>flood</b> to all ports'), D('ok', 'Node B · eno2 (active)', 'accept; vm-web relearned by the switch only when it replies')] },
      ],
    },
  ]; }
  let SCEN = buildScenarios();

  const RISKS = [
    { sev: 'sev', tag: 'High', title: 'A backup is never tested until you need it', scen: 'ex2',
      html: `Backup members send nothing and drop everything, so a backup port with a missing VLAN, bad patch or broken upstream is indistinguishable from a healthy one until failover — when the node goes dark with OVS reporting a healthy member. <b>Mitigate:</b> identical, audited trunk config on all ports; scheduled forced failovers; or a mode with path validation (LACP).` },
    { sev: 'sev', tag: 'High', title: 'One link per node, for everything', scen: 'baseline',
      html: `Every VM and every pod flow on the node shares the single active member. Four 25G ports give 25G. If bandwidth is the reason for bonding, active-backup does not deliver it; it buys only fault tolerance.` },
    { sev: '', tag: 'Medium', title: 'Failover is a burst of RARPs and MAC moves', scen: 'ex1',
      html: `OVS sends one learning RARP per MAC learned on local ports — every VM plus the node MAC. With members on two switches the burst is a cross-switch MAC move per MAC (and a core1 move without a peer-link). Switch MAC-move protection may rate-limit or err-disable. <b>Mitigate:</b> know the switch thresholds; put the first two members on different switches so one switch failure is one failover.` },
    { sev: '', tag: 'Medium', title: 'bond-primary turns a flapping link into repeated failovers', scen: 'ex3',
      html: `With <code>bond-primary</code> the primary is re-selected whenever it comes up, so each flap is two failovers and two RARP bursts. <b>Mitigate:</b> set <code>updelay</code> above the switch forwarding delay, or leave <code>bond-primary</code> unset.` },
    { sev: '', tag: 'Medium', title: 'Kernel active-backup does not announce VM MACs', scen: 'ex5',
      html: `A Linux kernel bond under <code>br-ex</code> sends GARPs for the node IP only. VM reachability after failover then relies on the switch flushing the dead port and flooding — which does not happen for host-side faults that leave the switch port up. The OVS bond sends a RARP per learned MAC instead.` },
    { sev: 'ok', tag: 'Low', title: 'Migration behaves like a single-NIC host', scen: 'ex4',
      html: `GARP or RARP, the old host accepts the announcement on its active member (no SLB loop rule) and the switches see one MAC move. Reflected copies land on backups and are dropped. The only residual is a VM that stays silent after switchover.` },
    { sev: 'ok', tag: 'Expectation', title: 'Independent switches are fine here', scen: 'baseline',
      html: `This is the one OVS mode that upstream documents as supporting members on different upstream switches: only one member talks, backups never inject duplicates. Toggle <b>Independent</b> to see failover and migration without a peer-link — the cost is MAC moves on core1 instead of inside an MLAG pair.` },
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
    if (u.t === 'act') { s.act[u.k] = u.v; return; }
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
    pl.append(el('text', { x: 500, y: 196, 'text-anchor': 'middle', class: 'callout' }, 'shared chassis-ID · synced MACs'));
    stat.append(pl);
    const npl = el('g', { id: 'nopeerlink', opacity: 0 });
    npl.append(el('text', { x: 500, y: 169, 'text-anchor': 'middle', class: 'callout' }, 'no peer-link'));
    npl.append(el('text', { x: 500, y: 186, 'text-anchor': 'middle', class: 'callout' }, 'separate MAC tables'));
    npl.append(el('text', { x: 500, y: 203, 'text-anchor': 'middle', class: 'callout' }, 'L2 only via core1'));
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
      stat.append(el('text', { x: H.cx, y: BR_TOP + 21, 'text-anchor': 'middle', class: 'lbl' }, 'br-phy · bond0 active-backup'));
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
    for (const h of ['A', 'B']) for (const e of ENOS) {
      const r = refs.nic[`${h}.${e}`];
      const cls = ['nic'];
      if (s.act[h] === e) cls.push('active', 'hashed'); else cls.push('backup');
      if (s.down[`${h}.${e}`]) cls.push('down');
      r.setAttribute('class', cls.join(' '));
      const cab = document.getElementById(`cab-${h}-${e}`);
      cab.setAttribute('stroke-dasharray', s.down[`${h}.${e}`] ? '4 4' : '');
      cab.style.stroke = s.down[`${h}.${e}`] ? 'var(--color-error)' : '';
    }

    // switch & core lines
    $('#peerlink').setAttribute('opacity', indep ? 0 : 1);
    $('#nopeerlink').setAttribute('opacity', indep ? 1 : 0);
    const swe = s.sw.web;
    for (const sw of ['sw1', 'sw2']) {
      const t = refs.swLine[sw];
      const e = indep ? s.swx[sw].web : swe;
      if (!e) { t.textContent = 'vm-web: unknown → flood'; t.style.fill = 'var(--color-warning)'; continue; }
      if (indep) t.textContent = e.port === 'core1' ? 'vm-web → core1 uplink' : `vm-web → ${e.port}`;
      else { const own = e.port !== 'core1' && swOf(e.port.split('·')[1]) === sw; t.textContent = own ? `vm-web → ${e.port}` : 'vm-web → via peer-link'; }
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
    const key = JSON.stringify([indep, s.sw, s.swx, s.A, s.B, s.act, s.down, s.changed]);
    if (key === lastTblKey) return;
    lastTblKey = key;
    const ch = new Set(s.changed);
    const flags = (e) => (e ? `${e.lock ? '<span class="flag lock">GARP-LOCK</span>' : ''}${e.stale ? '<span class="flag stale">STALE</span>' : ''}${e.wrong ? '<span class="flag wrong">WRONG</span>' : ''}${e.moved ? '<span class="flag stale">MAC MOVE</span>' : ''}` : '');
    const cell = (e) => (e ? e.port + flags(e) : '<span style="color:var(--color-text-faint)" title="unknown → flood">—</span>');
    const row = (tb, k, e) => `<tr class="${ch.has(`${tb}.${k}`) ? 'changed' : ''}"><td>${MACN[k]}</td><td>${cell(e)}</td></tr>`;
    let swT;
    if (!indep) {
      swT = `<div class="tbl sw"><h4>sw1 + sw2 MAC table <small>MLAG-synced · VLAN 100</small></h4><table><thead><tr><th>MAC</th><th>port</th></tr></thead><tbody>${ROWS.map((k) => row('sw', k, s.sw[k])).join('')}</tbody></table></div>`;
    } else {
      const r3 = (k) => `<tr class="${ch.has(`sw.${k}`) ? 'changed' : ''}"><td>${MACN[k]}</td><td>${cell(s.swx.sw1[k])}</td><td>${cell(s.swx.sw2[k])}</td><td class="${s.swx.core[k] && s.swx.core[k].moved ? 'moved' : ''}">${cell(s.swx.core[k])}</td></tr>`;
      swT = `<div class="tbl sw"><h4>Switch MAC tables <small>independent · VLAN 100</small></h4><table><thead><tr><th>MAC</th><th>sw1</th><th>sw2</th><th>core1</th></tr></thead><tbody>${ROWS.map(r3).join('')}</tbody></table></div>`;
    }
    const node = (h) => {
      const hk = h === 'A' ? 'hA' : 'hB';
      const nm = { web: 'vm-web', x: 'vm-x', pA: 'pods', pB: 'pods' };
      const downs = ENOS.filter((e) => s.down[`${h}.${e}`]).map((e) => `<span class="flag wrong">${e} down</span>`).join('');
      return `<div class="tbl"><h4>Node ${h} FDB <small>br-phy</small></h4><table><thead><tr><th>MAC</th><th>port</th></tr></thead><tbody>${ROWS.map((k) => row(h, k, s[h][k])).join('')}</tbody></table>
        <div class="meta"><span class="${ch.has(`act.${h}`) ? 'flag new' : ''}">active <b>${s.act[h]}</b></span><span>backups drop all rx</span>${downs}</div></div>`;
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
