/* SLB Scope — OVS balance-slb MAC learning visualizer */
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
      vm: { web: [160, VM_Y], x: [340, VM_Y] } },
    B: { x0: 520, x1: 980, cx: 750, name: 'NODE B', role: 'migration target',
      px: { eno1: 585, eno2: 680, eno3: 820, eno4: 915 },
      att: { eno1: 300, eno2: 335, eno3: 740, eno4: 775 },
      vm: { web: [750, VM_Y] } },
  };
  const ENOS = ['eno1', 'eno2', 'eno3', 'eno4'];
  const swOf = (e) => (e === 'eno1' || e === 'eno2' ? 'sw1' : 'sw2');
  const MIG = [[160, 621], [160, 672], [750, 672], [750, 621]];

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
  function dn(from, h, eno, to) {
    const H = HOST[h], px = H.px[eno], s = swOf(eno);
    const pts = [SW[from]];
    if (from !== s) pts.push(SW[s]);
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

  /* ---------------- Initial states ---------------- */
  const steady = () => ({
    sw: { web: { port: 'A·eno2' }, x: { port: 'A·eno4' }, gw: { port: 'core1' } },
    A: { web: { port: 'local' }, x: { port: 'local' }, gw: { port: 'bond0' } },
    B: { web: { port: 'bond0' }, x: { port: 'bond0' }, gw: { port: 'bond0' } },
    hA: { web: 'eno2', x: 'eno4' }, hB: {},
    act: { A: 'eno1', B: 'eno1' }, down: {}, vm: 'A',
  });
  const converged = () => ({
    sw: { web: { port: 'B·eno3' }, x: { port: 'A·eno4' }, gw: { port: 'core1' } },
    A: { web: { port: 'bond0' }, x: { port: 'local' }, gw: { port: 'bond0' } },
    B: { web: { port: 'local' }, x: { port: 'bond0' }, gw: { port: 'bond0' } },
    hA: { x: 'eno4' }, hB: { web: 'eno3' },
    act: { A: 'eno1', B: 'eno1' }, down: {}, vm: 'B',
  });
  const justMigrated = () => {
    const s = steady(); s.vm = 'B';
    s.sw.web.stale = true; s.A.web.stale = true; s.B.web.stale = true; delete s.hA.web;
    return s;
  };

  /* ---------------- Decision trace helpers ---------------- */
  const D = (cls, where, html) => ({ cls, where, html });

  /* ---------------- Scenarios ---------------- */
  const SCEN = [
    {
      id: 'baseline', n: '0', name: 'How SLB pins & learns', init: () => { const s = steady(); delete s.sw.web; return s; },
      steps: [
        { clock: 'T+0.000 s', title: 'vm-web transmits — SLB picks a member by source MAC', doc: 'Bond packet output', dur: 3600,
          body: `<p>For every frame leaving the bond, OVS hashes <b>source MAC + VLAN</b> into one of 256 buckets. vm-web's bucket maps to <code>eno2</code>, so every frame vm-web sends on VLAN 100 leaves on eno2 toward sw1.</p><p>sw1 has never seen vm-web, so it learns <code>vm-web → A·eno2</code>. That learned port is the only thing steering return traffic — the switch has no idea a bond exists.</p>`,
          frames: [{ pts: join(up('A', 'web', 'eno2'), toCore('sw1')), k: 'uni', t0: 0.05, t1: 0.7, end: 'ok', label: 'unicast → gw' }],
          up: [{ at: 0.42, t: 'sw', k: 'web', v: { port: 'A·eno2', fresh: true } }],
          dec: [D('ok', 'Node A bond0 · output', 'hash(<code>…:01</code>, VLAN 100) → bucket → <b>eno2</b>. Bucket was unassigned, so OVS chose a member arbitrarily.')] },
        { clock: 'T+0.001 s', title: 'Return traffic follows the switch’s MAC table', doc: 'Bond packet input', dur: 3600,
          body: `<p>The gateway replies to vm-web. sw1 forwards it out <code>A·eno2</code>. SLB <b>accepts unicast on any member</b>, so it is delivered.</p><p>Note what is <i>not</i> happening: there is no negotiation. Ingress and egress line up only because the switch learned from egress.</p>`,
          frames: [{ pts: join(fromCore('sw1'), dn('sw1', 'A', 'eno2', 'web')), k: 'uni', t0: 0.05, t1: 0.8, end: 'ok', label: 'unicast → vm-web' }],
          dec: [D('ok', 'Node A · eno2 (non-active)', 'dst is unicast → no active-member filter. src <code>gw</code> learned on <b>bond0</b> = ingress port → <b>admit</b>.')] },
        { clock: 'T+0.002 s', title: 'Different MAC, different member — even a different switch', doc: 'SLB bonding', dur: 3400,
          body: `<p>vm-x hashes to <code>eno4</code>, which is cabled to <b>sw2</b>. This is how SLB spreads load: per source MAC, across all four links and both MLAG peers.</p><p>A single MAC never uses more than one link at a time. Host/pod traffic on <code>br-ex</code> shares one MAC, so it is never balanced.</p>`,
          frames: [{ pts: join(up('A', 'x', 'eno4'), toCore('sw2')), k: 'uni', t0: 0.05, t1: 0.7, end: 'ok', label: 'unicast → gw' }],
          up: [{ at: 0.4, t: 'sw', k: 'x', v: { port: 'A·eno4', fresh: true } }] },
        { clock: 'T+10 s', title: 'Rebalance: a bucket moves from eno2 to eno3', doc: 'Bond packet output · rebalance', dur: 3200,
          body: `<p>Every 10 s OVS compares per-member load over roughly the last minute. If the busiest member carries ≥1 Mbps and ≥3% more than the lightest, and holds ≥2 buckets, it shifts one bucket.</p><p>vm-web's bucket moves to <code>eno3</code> (sw2). <b>No learning packet is sent</b> for a rebalance — the switch still points at A·eno2. That is harmless only because unicast is accepted on any member.</p>`,
          frames: [], up: [{ at: 0.3, t: 'hA', k: 'web', v: 'eno3' }, { at: 0.3, t: 'patch', tb: 'sw', k: 'web', v: { stale: true } }],
          dec: [D('warn', 'Node A bond0 · rebalance', 'bucket(vm-web) <b>eno2 → eno3</b>. Return path on sw1/A·eno2 is now asymmetric until vm-web sends again.')] },
        { clock: 'T+10.01 s', title: 'Next frame drags the MAC across MLAG peers', doc: 'SLB bonding', dur: 3800,
          body: `<p>vm-web's next frame leaves on eno3 → sw2. The MLAG pair sees <code>vm-web</code> <b>move</b> from a sw1 port to a sw2 port and updates the synced table.</p><p>Every rebalance and every migration is a MAC move to the switches. Platforms with MAC-move / flap detection can log, throttle, or block these.</p>`,
          frames: [{ pts: join(up('A', 'web', 'eno3'), toCore('sw2')), k: 'uni', t0: 0.05, t1: 0.7, end: 'ok', label: 'unicast → gw' }],
          up: [{ at: 0.42, t: 'sw', k: 'web', v: { port: 'A·eno3', fresh: true } }] },
      ],
    },
    {
      id: 'happy', n: '1', name: 'Happy path: migration + GARP', init: steady,
      steps: [
        { clock: 'T−3 s', title: 'Live migration: pre-copy', doc: 'Setup', dur: 3600,
          body: `<p>KubeVirt copies vm-web's memory to Node B over the migration network. vm-web keeps running on Node A, so every MAC table in the fabric is still correct:</p><p>sw1/sw2 → <code>A·eno2</code> · Node A → <code>local</code> · Node B → <code>bond0</code>.</p>`,
          vm: 'A', mig: true,
          frames: [0.05, 0.25, 0.45].map((t) => ({ pts: MIG, k: 'mig', t0: t, t1: t + 0.45 })) },
        { clock: 'T+0.000 s', title: 'Switchover: vm-web resumes on Node B', doc: 'Setup', dur: 3200,
          body: `<p>The VM pauses on A and resumes on B. At this instant <b>every</b> table that matters is wrong: the switches send vm-web's traffic to Node A, Node A thinks vm-web is local, and Node B thinks it is out the bond.</p><p>Only an announcement from vm-web's new location can fix all three.</p>`,
          vm: ['move', 0.1, 0.7], mig: true,
          up: [{ at: 0.7, t: 'patch', tb: 'sw', k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: 'A', k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: 'B', k: 'web', v: { stale: true } }, { at: 0.7, t: 'hA', k: 'web', v: null }] },
        { clock: 'T+0.002 s', title: 'Gratuitous ARP leaves Node B — learned locally and locked', doc: 'SLB complication #5', dur: 4000,
          body: `<p>vm-web (or ovn-controller, if it knows the VM's IP) sends a <b>gratuitous ARP</b>. It enters <code>br-phy</code> from the local patch port, so Node B learns <code>vm-web → local</code> and <b>locks the entry for 5 s</b> against GARPs arriving on the bond.</p><p>The bond picks <code>eno3</code> for vm-web's bucket (first use → arbitrary). sw2 learns <code>vm-web → B·eno3</code>.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', 'eno3'), k: 'garp', t0: 0.05, t1: 0.75, end: null, label: 'GARP' }],
          up: [{ at: 0.18, t: 'B', k: 'web', v: { port: 'local', lock: true, fresh: true } }, { at: 0.4, t: 'hB', k: 'web', v: 'eno3' }, { at: 0.74, t: 'sw', k: 'web', v: { port: 'B·eno3', fresh: true } }],
          dec: [D('ok', 'Node B br-phy · ingress local', 'GARP on a <b>non-bond</b> port → learn <code>vm-web → local</code>, set <b>GARP lock (5 s)</b>.'), D('ok', 'Node B bond0 · output', 'hash(vm-web) → <b>eno3</b> (not the active member).')] },
        { clock: 'T+0.003 s', title: 'Switches flood the GARP to every member on both nodes', doc: 'SLB complications #2, #4, #5', dur: 5200,
          body: `<p>The GARP is broadcast, so the MLAG pair floods it to all 7 other host ports. Watch each node’s bond decide:</p><p><b>Node A</b> accepts it only on its active member (eno1). vm-web is learned <i>local</i> there, which would normally mean "loop, drop" — but a GARP is the exception, so A relearns <code>vm-web → bond0</code>.</p><p><b>Node B</b> receives its own GARP back on eno1. It is a GARP, but the entry is locked → dropped. Without the lock B would relearn vm-web on the bond.</p>`,
          vm: 'B',
          frames: flood('sw2', 'B.eno3', 'garp', {
            'A.eno1': { to: 'local', end: 'ok', note: 'GARP exception' },
            'B.eno1': { to: 'adm', end: 'drop', note: 'locked' },
          }, 0.05, 0.75, { core: true }),
          up: [{ at: 0.66, t: 'A', k: 'web', v: { port: 'bond0', fresh: true } }],
          dec: [
            D('ok', 'Node A · eno1 (active)', 'broadcast on active ✓ · src vm-web learned on <b>local</b> ≠ bond0 · is GARP ✓ · not locked → <b>admit, relearn → bond0</b>'),
            D('drop', 'Node A · eno2/3/4, Node B · eno2/4', 'broadcast on non-active member → <b>drop</b> (complication #2)'),
            D('drop', 'Node B · eno1 (active)', 'src learned on <b>local</b> · is GARP ✓ · entry <b>GARP-locked</b> → <b>drop</b> (complication #5)'),
          ] },
        { clock: 'T+0.010 s', title: 'Converged — both directions work', doc: 'Result', dur: 4400,
          body: `<p>The gateway reaches vm-web through sw2 → B·eno3. vm-x on Node A now looks up vm-web → <code>bond0</code>, so its frames leave on its own bucket (eno4) and the switch delivers them to B·eno3.</p><p>One GARP fixed three tables in a few milliseconds. This is the only path the design is built for.</p>`,
          vm: 'B',
          frames: [
            { pts: join(fromCore('sw2'), dn('sw2', 'B', 'eno3', 'web')), k: 'uni', t0: 0.05, t1: 0.65, end: 'ok', label: 'gw → vm-web' },
            { pts: join(up('A', 'x', 'eno4'), dn('sw2', 'B', 'eno3', 'web')), k: 'uni', t0: 0.15, t1: 0.85, end: 'ok', label: 'vm-x → vm-web' },
          ],
          up: [{ at: 0.1, t: 'patch', tb: 'sw', k: 'web', v: { stale: false } }] },
        { clock: 'T+5.0 s', title: 'GARP lock expires', doc: 'SLB complication #5', dur: 2800,
          body: `<p>After 5 s the lock clears. From here vm-web's entry behaves normally and is refreshed by its own traffic. It ages out after <code>mac-aging-time</code> idle (upstream default 300 s).</p>`,
          vm: 'B', up: [{ at: 0.3, t: 'patch', tb: 'B', k: 'web', v: { lock: false } }] },
      ],
    },
    {
      id: 'ex1', n: '#1', bad: true, name: 'Unknown unicast → duplicates', init: () => { const s = converged(); delete s.sw.web; return s; },
      steps: [
        { clock: 'T+0 s', title: 'The switches have forgotten vm-web', doc: 'SLB complication #1', dur: 3000,
          body: `<p>vm-web is quiet, so the MLAG pair's entry ages out — or the table is flushed by a topology change (peer-link flap, STP TCN, link bounce). The OVS nodes still know where vm-web is; the switches don't.</p>`,
          vm: 'B' },
        { clock: 'T+0.001 s', title: 'Gateway sends unicast → switches flood it to all 8 members', doc: 'SLB complication #1', dur: 5200,
          body: `<p>Unknown unicast is flooded to every port in the VLAN — all four of Node B's members included. SLB accepts unicast on <b>any</b> member, so <b>vm-web receives four copies</b> of the same frame.</p><p>Node A accepts its copies too, but its FDB says vm-web is out bond0 — the same port it arrived on — so it discards them.</p><p class="warnline">OVS documents this and does not solve it.</p>`,
          vm: 'B',
          frames: [{ pts: fromCore('sw1'), k: 'uni', t0: 0.02, t1: 0.2, label: 'gw → vm-web' }].concat(flood('sw1', null, 'uni', {
            'B.eno1': { to: 'web', end: 'ok' }, 'B.eno2': { to: 'web', end: 'ok' }, 'B.eno3': { to: 'web', end: 'ok', note: '×4 copies' }, 'B.eno4': { to: 'web', end: 'ok' },
            'A.eno1': { to: 'br', end: 'drop' }, 'A.eno2': { to: 'br', end: 'drop' }, 'A.eno3': { to: 'br', end: 'drop' }, 'A.eno4': { to: 'br', end: 'drop', note: 'dst = in-port' },
          }, 0.2, 0.85)),
          dec: [
            D('drop', 'Node B · eno1–eno4', 'dst unicast → accepted on every member · src gw on bond0 = ingress → <b>admit ×4 → vm-web gets duplicates</b>'),
            D('ok', 'Node A · eno1–eno4', 'admitted, but dst vm-web → <b>bond0</b> = ingress bundle → not forwarded'),
          ] },
        { clock: 'T+0.002 s', title: 'Flooding stops once vm-web speaks', doc: 'SLB complication #1', dur: 3600,
          body: `<p>As soon as vm-web transmits, sw2 learns <code>vm-web → B·eno3</code> and unicast is delivered once. Exposure is the window between the switch forgetting a MAC and that MAC sending again — worst for silent or receive-mostly VMs.</p>`,
          vm: 'B',
          frames: [{ pts: join(up('B', 'web', 'eno3'), toCore('sw2')), k: 'uni', t0: 0.05, t1: 0.7, end: 'ok', label: 'vm-web reply' }],
          up: [{ at: 0.45, t: 'sw', k: 'web', v: { port: 'B·eno3', fresh: true } }] },
      ],
    },
    {
      id: 'ex2', n: '#2', bad: true, name: 'Inbound broadcast', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'Gateway broadcasts an ARP request', doc: 'SLB complication #2', dur: 5000,
          body: `<p>A broadcast from outside the bond is flooded to all eight members — four copies per node. To avoid duplicating it four times, SLB accepts multicast/broadcast <b>only on the active member</b> and drops it on the rest.</p><p>Note the active member (eno1) is unrelated to vm-web's hash member (eno3). Broadcast in and unicast in take different links.</p>`,
          vm: 'B',
          frames: [{ pts: fromCore('sw1'), k: 'bcast', t0: 0.02, t1: 0.2, label: 'ARP who-has' }].concat(flood('sw1', null, 'bcast', {
            'A.eno1': { to: 'x', end: 'ok' }, 'B.eno1': { to: 'web', end: 'ok', note: '1 copy' }, 'B.eno3': { to: 'adm', end: 'drop', note: 'non-active' },
          }, 0.2, 0.85)),
          dec: [D('ok', 'Node A · eno1, Node B · eno1 (active)', 'broadcast on active member → <b>admit</b>, one copy per node'), D('drop', 'every other member', 'broadcast on non-active member → <b>drop</b>')] },
        { clock: 'T+0 s', whatif: 'Hypothetical — active member’s switch port is misconfigured', title: 'Risk: one link carries all inbound broadcast', doc: 'Derived risk', dur: 5000,
          body: `<p>Suppose B·eno1 keeps carrier but VLAN 100 is missing on that switch port (trunk mismatch, MLAG config drift). The only copy SLB would accept never arrives; the other three are discarded as non-active.</p><p><b>Result:</b> ARP, DHCP and IPv6 ND to Node B's VMs fail silently while unicast keeps working. Nothing in OVS detects it — the member is up.</p>`,
          vm: 'B',
          frames: [{ pts: fromCore('sw1'), k: 'bcast', t0: 0.02, t1: 0.2, label: 'ARP who-has', dash: true }].concat(flood('sw1', null, 'bcast', {
            'A.eno1': { to: 'x', end: 'ok' }, 'B.eno1': { to: 'att', end: 'drop', note: 'VLAN not trunked' },
          }, 0.2, 0.85, { dash: true })),
          dec: [D('drop', 'Node B · eno1 (active)', 'carrier up, but frame never delivered by the switch'), D('drop', 'Node B · eno2/3/4', 'non-active → <b>drop</b> → vm-web never sees the ARP')] },
      ],
    },
    {
      id: 'ex3', n: '#3', bad: true, name: 'Outbound broadcast reflection', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'vm-web broadcasts on its hash member, eno3', doc: 'SLB complication #3', dur: 3600,
          body: `<p>vm-web sends an ARP request. Like every frame from vm-web, it leaves on its hash member <code>eno3</code> — which is <b>not</b> the active member.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', 'eno3'), k: 'bcast', t0: 0.05, t1: 0.8, label: 'ARP who-has' }] },
        { clock: 'T+0.001 s', title: 'The switches flood it straight back into Node B', doc: 'SLB complication #3', dur: 5400,
          body: `<p>The flood returns on B's other three members — including the active member, which <i>does</i> accept broadcast. Without special handling vm-web would hear its own broadcast and Node B would relearn vm-web on bond0.</p><p>SLB drops any frame arriving on the bond whose <b>source MAC is learned on a different port</b>. vm-web is learned <code>local</code> → "looped back" → drop. This is why SLB depends critically on MAC learning (and why it is incompatible with <code>flood_vlans</code>).</p>`,
          vm: 'B',
          frames: flood('sw2', 'B.eno3', 'bcast', {
            'B.eno1': { to: 'adm', end: 'drop', note: 'looped back' }, 'A.eno1': { to: 'x', end: 'ok' },
          }, 0.05, 0.75, { core: true }),
          dec: [
            D('drop', 'Node B · eno1 (active)', 'broadcast on active ✓ · src vm-web learned on <b>local</b> ≠ bond0 · not a GARP → <b>drop</b> — <code>SLB bond thinks this packet looped back</code>'),
            D('ok', 'Node A · eno1 (active)', 'src vm-web learned on <b>bond0</b> = ingress → <b>admit</b>, delivered to vm-x'),
          ] },
      ],
    },
    {
      id: 'ex4', n: '#4', bad: true, name: 'No GARP after migration', init: steady,
      steps: [
        { clock: 'T+0.000 s', title: 'Switchover — tables are stale', doc: 'SLB complication #4', dur: 3200,
          body: `<p>Same migration as the happy path. vm-web resumes on Node B and every table still points at Node A.</p>`,
          vm: ['move', 0.1, 0.7], mig: true,
          up: [{ at: 0.7, t: 'patch', tb: 'sw', k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: 'A', k: 'web', v: { stale: true } }, { at: 0.7, t: 'patch', tb: 'B', k: 'web', v: { stale: true } }, { at: 0.7, t: 'hA', k: 'web', v: null }] },
        { clock: 'T+0.002 s', title: 'Only a RARP is sent (or the GARP is lost)', doc: 'SLB complication #4', dur: 4000,
          body: `<p>QEMU's post-migration self-announce is a broadcast <b>RARP</b> (ethertype 0x8035), and ovn-controller also sends RARP when it doesn't know the port's IP. OVS's GARP exception only matches ARP, so a RARP gets <b>no special treatment and no lock</b>.</p><p>Node B learns <code>vm-web → local</code>. sw2 learns <code>vm-web → B·eno3</code> — RARP is enough for the physical switches.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', 'eno3'), k: 'rarp', t0: 0.05, t1: 0.75, label: 'RARP' }],
          up: [{ at: 0.18, t: 'B', k: 'web', v: { port: 'local', fresh: true } }, { at: 0.4, t: 'hB', k: 'web', v: 'eno3' }, { at: 0.74, t: 'sw', k: 'web', v: { port: 'B·eno3', fresh: true } }],
          dec: [D('warn', 'Node B br-phy · ingress local', '<code>is_gratuitous_arp()</code> requires ethertype ARP → RARP is <b>not</b> a GARP → learn local, <b>no lock</b>')] },
        { clock: 'T+0.003 s', title: 'Node A discards the RARP as a reflection', doc: 'SLB complication #4', dur: 5000,
          body: `<p>The flood reaches Node A's active member. Node A still has vm-web learned on its <b>local</b> port, so a frame from vm-web arriving on the bond looks exactly like a reflection — and it is not a GARP, so there is no exception.</p><p><b>Node A's entry stays <code>local</code>.</b> Nothing else will correct it.</p>`,
          vm: 'B',
          frames: flood('sw2', 'B.eno3', 'rarp', {
            'A.eno1': { to: 'adm', end: 'drop', note: 'looped back' }, 'B.eno1': { to: 'adm', end: 'drop' },
          }, 0.05, 0.75, { core: true }),
          up: [{ at: 0.7, t: 'patch', tb: 'A', k: 'web', v: { stale: false, wrong: true } }, { at: 0.7, t: 'patch', tb: 'sw', k: 'web', v: { stale: false } }],
          dec: [D('drop', 'Node A · eno1 (active)', 'broadcast on active ✓ · src vm-web learned on <b>local</b> ≠ bond0 · not a GARP → <b>drop</b>. Dropped frames never reach MAC learning.')] },
        { clock: 'T+0.010 s', title: 'North-south works — so it looks "mostly fine"', doc: 'SLB complication #4', dur: 3600,
          body: `<p>The gateway reaches vm-web via sw2 → B·eno3. Monitoring from outside the cluster may show no outage at all.</p>`,
          vm: 'B',
          frames: [{ pts: join(fromCore('sw2'), dn('sw2', 'B', 'eno3', 'web')), k: 'uni', t0: 0.05, t1: 0.75, end: 'ok', label: 'gw → vm-web' }] },
        { clock: 'T+0.020 s', title: 'Node A black-holes vm-web in both directions', doc: 'SLB complication #4', dur: 5400,
          body: `<p><b>vm-x → vm-web:</b> Node A's br-phy looks up vm-web → <code>local</code>, the port the frame came in on, and discards it.</p><p><b>vm-web → vm-x:</b> the reply arrives on A·eno4; source vm-web is "learned elsewhere" → dropped as a loop.</p><p>Anything on Node A — or any path that crosses Node A's br-phy — loses vm-web.</p>`,
          vm: 'B',
          frames: [
            { pts: localUp('A', 'x'), k: 'uni', t0: 0.05, t1: 0.4, end: 'drop', note: 'dst = in-port', label: 'vm-x → vm-web' },
            { pts: join(up('B', 'web', 'eno3'), dn('sw2', 'A', 'eno4', 'adm')), k: 'uni', t0: 0.35, t1: 0.9, end: 'drop', note: 'looped back', label: 'vm-web → vm-x' },
          ],
          dec: [D('drop', 'Node A br-phy · from vm-x', 'dst vm-web → <b>local</b> = ingress port → not forwarded'), D('drop', 'Node A · eno4', 'unicast, src vm-web learned on <b>local</b> ≠ bond0 → <b>drop</b>')] },
        { clock: 'T+mac-aging-time', title: 'Recovery only when Node A’s entry ages out', doc: 'SLB complication #4', dur: 4200,
          body: `<p>The OVS doc cites a delay of up to 60 s. In current OVS the window is the bridge's <code>mac-aging-time</code> (upstream default <b>300 s</b>, range 15–3600 s) counted from vm-web's last frame on Node A — the dropped frames never refresh or fix it.</p><p>Once the entry expires, vm-x's next frame floods out the bond, reaches vm-web, and the reply is learned correctly on bond0.</p>`,
          vm: 'B',
          frames: [{ pts: join(up('A', 'x', 'eno4'), dn('sw2', 'B', 'eno3', 'web')), k: 'uni', t0: 0.35, t1: 0.9, end: 'ok', label: 'vm-x → vm-web' }],
          up: [{ at: 0.2, t: 'A', k: 'web', v: null }, { at: 0.95, t: 'A', k: 'web', v: { port: 'bond0', fresh: true } }] },
      ],
    },
    {
      id: 'ex5', n: '#5', bad: true, name: 'Reflected GARP & 5 s lock', init: justMigrated,
      steps: [
        { clock: 'T+0.002 s', title: 'GARP from the local port arms the lock', doc: 'SLB complication #5', dur: 3800,
          body: `<p>vm-web has just landed on Node B, whose FDB still says <code>vm-web → bond0</code>. The GARP comes in from the local port, so B moves the entry to <code>local</code> and <b>locks it for 5 s</b>.</p><p>The hash puts vm-web on <code>eno3</code>, not on the active member eno1. That combination is what makes this complication possible.</p>`,
          vm: 'B',
          frames: [{ pts: up('B', 'web', 'eno3'), k: 'garp', t0: 0.05, t1: 0.75, label: 'GARP' }],
          up: [{ at: 0.18, t: 'B', k: 'web', v: { port: 'local', lock: true, fresh: true } }, { at: 0.4, t: 'hB', k: 'web', v: 'eno3' }, { at: 0.74, t: 'sw', k: 'web', v: { port: 'B·eno3', fresh: true } }] },
        { clock: 'T+0.003 s', title: 'Reflection lands on B’s active member — the lock drops it', doc: 'SLB complication #5', dur: 5000,
          body: `<p>The switches flood the GARP back to B·eno1. It passes the active-member check, its source is learned elsewhere (local), and it <i>is</i> a GARP — so the complication #4 exception would normally admit it and relearn vm-web on bond0.</p><p>The 5 s lock is what turns that into a drop.</p>`,
          vm: 'B',
          frames: flood('sw2', 'B.eno3', 'garp', {
            'A.eno1': { to: 'local', end: 'ok' }, 'B.eno1': { to: 'adm', end: 'drop', note: 'locked' },
          }, 0.05, 0.75, { core: true }),
          up: [{ at: 0.66, t: 'A', k: 'web', v: { port: 'bond0', fresh: true } }],
          dec: [D('drop', 'Node B · eno1 (active)', 'broadcast on active ✓ · src learned on local · is GARP ✓ · <code>mac_entry_is_grat_arp_locked()</code> ✓ → <b>drop</b>')] },
        { clock: 'T+0.003 s', whatif: 'Hypothetical — what would happen without the 5 s GARP lock', title: 'Without the lock: Node B black-holes its own VM', doc: 'SLB complication #5', dur: 5000,
          body: `<p>If the reflected GARP were admitted, Node B would learn <code>vm-web → bond0</code>. Every frame for vm-web — including the gateway's — would then arrive on the bond and be discarded because its destination is "out the port it came in on".</p><p>The VM would be unreachable on the node it is running on.</p>`,
          vm: 'B',
          frames: [
            { pts: dn('sw2', 'B', 'eno1', 'br'), k: 'garp', t0: 0.0, t1: 0.3, end: 'ok', note: 'admitted', dash: true },
            { pts: join(fromCore('sw2'), dn('sw2', 'B', 'eno3', 'br')), k: 'uni', t0: 0.4, t1: 0.9, end: 'drop', note: 'dst = in-port', label: 'gw → vm-web', dash: true },
          ],
          up: [{ at: 0.3, t: 'B', k: 'web', v: { port: 'bond0', wrong: true, fresh: true } }] },
        { clock: 'T+0.004 s', title: 'Reality: entry stays local, traffic flows', doc: 'SLB complication #5', dur: 3600,
          body: `<p>With the lock, B keeps <code>vm-web → local</code> and the gateway's traffic is delivered. If vm-web's bucket had been on the active member, the switch would never have returned the GARP on that port and the other members would have dropped it as non-active — the lock only matters when hash member ≠ active member.</p>`,
          vm: 'B',
          frames: [{ pts: join(fromCore('sw2'), dn('sw2', 'B', 'eno3', 'web')), k: 'uni', t0: 0.15, t1: 0.8, end: 'ok', label: 'gw → vm-web' }],
          up: [{ at: 0.05, t: 'B', k: 'web', v: { port: 'local', lock: true } }] },
        { clock: 'T+5.0 s', title: 'Lock expires — a residual window remains', doc: 'SLB complication #5', dur: 3400,
          body: `<p>After 5 s the lock is gone. Every new GARP from vm-web re-arms it because it enters from the local port first. The residual edge case: a GARP for vm-web's MAC arriving on B's active member <i>from the network</i> more than 5 s after the last local one would be accepted and move the entry to bond0.</p>`,
          vm: 'B', up: [{ at: 0.3, t: 'patch', tb: 'B', k: 'web', v: { lock: false } }] },
      ],
    },
    {
      id: 'fail', n: '+', name: 'Related: member failover', init: converged,
      steps: [
        { clock: 'T+0 s', title: 'eno3 loses carrier on Node B', doc: 'Enabling and disabling members', dur: 3400,
          body: `<p>After <code>bond-downdelay</code>, OVS disables eno3 and immediately reassigns its buckets — vm-web moves to <code>eno4</code>. sw2 also flushes MACs on the dead port, so it no longer knows vm-web.</p><p>Set <code>bond-updelay</code> longer than the switch's STP forwarding delay, or a recovering link gets load before the switch forwards on it.</p>`,
          vm: 'B',
          up: [{ at: 0.2, t: 'down', k: 'B.eno3', v: true }, { at: 0.5, t: 'hB', k: 'web', v: 'eno4' }, { at: 0.5, t: 'sw', k: 'web', v: null }] },
        { clock: 'T+0.001 s', title: 'OVS sends RARP learning packets for local MACs', doc: 'Enabling and disabling members', dur: 5000,
          body: `<p>For every MAC learned on a non-bond port, OVS sends a <b>RARP</b> out the newly chosen member. sw2 learns <code>vm-web → B·eno4</code>.</p><p>Other SLB nodes that already learned vm-web on their bond accept it normally. Because these are RARPs, not GARPs, they would <b>not</b> correct a stale "local" entry on another node — the same limitation as complication #4.</p>`,
          vm: 'B',
          frames: [{ pts: [[HOST.B.cx, BR_C], [HOST.B.px.eno4, ADM_Y], [HOST.B.px.eno4, PORT_Y], [HOST.B.att.eno4, ATT_Y], SW.sw2], k: 'rarp', t0: 0.03, t1: 0.35, label: 'learning RARP' }]
            .concat(flood('sw2', 'B.eno4', 'rarp', { 'B.eno3': { skip: true }, 'A.eno1': { to: 'local', end: 'ok' }, 'B.eno1': { to: 'adm', end: 'drop', note: 'looped back' } }, 0.35, 0.85, { core: true })),
          up: [{ at: 0.34, t: 'sw', k: 'web', v: { port: 'B·eno4', fresh: true } }] },
        { clock: 'T+0.010 s', title: 'Inbound traffic follows the new member', doc: 'Enabling and disabling members', dur: 3400,
          body: `<p>The gateway reaches vm-web via sw2 → B·eno4. Failover is fast because the node with the dead link is the one that announces.</p>`,
          vm: 'B',
          frames: [{ pts: join(fromCore('sw2'), dn('sw2', 'B', 'eno4', 'web')), k: 'uni', t0: 0.05, t1: 0.75, end: 'ok', label: 'gw → vm-web' }] },
      ],
    },
  ];

  const RISKS = [
    { sev: 'sev', tag: 'High', title: 'A migration without a real GARP strands the VM from its old node', scen: 'ex4',
      html: `vm-web stays reachable from outside, but is cut off from workloads on (or traffic crossing) the source node until that node's br-phy entry ages out — the OVS doc cites up to 60 s; upstream <code>mac-aging-time</code> defaults to 300 s. QEMU's announce and OVN (without a known IP) send RARP, which the exception ignores. <b>Mitigate:</b> capture on the source node during a migration to prove which frames arrive; prefer guest-announce-capable virtio drivers; validate any aging/announce tuning with Red Hat before changing operator-managed bridges.` },
    { sev: 'sev', tag: 'High', title: 'Members on two different switches', scen: 'baseline',
      html: `Upstream OVS states active-backup is the only bond mode that supports members on different upstream switches. This design works only because the MLAG pair behaves as one L2 switch (shared chassis ID, synced MAC table, standalone trunk ports). <b>Mitigate:</b> get Red Hat to confirm supportability of this exact topology, and test peer-link failure.` },
    { sev: '', tag: 'Medium', title: 'Unknown-unicast flooding delivers ×4 duplicates', scen: 'ex1',
      html: `Any time the switches lose a MAC, the VM receives one copy per member. OVS does not prevent it. <b>Mitigate:</b> keep switch MAC aging ≥ host ARP timeouts, keep host ports as STP edge ports, and keep the MLAG peer-link stable to avoid flushes.` },
    { sev: '', tag: 'Medium', title: 'One active member carries all inbound broadcast', scen: 'ex2',
      html: `ARP, DHCP and ND are accepted on only one link per node. If that link's upstream path is impaired while carrier stays up, broadcast fails silently while unicast works. <b>Mitigate:</b> identical VLAN trunking on all 8 ports, and check <code>ovs-appctl bond/show</code> to know which member is active.` },
    { sev: '', tag: 'Medium', title: 'Rebalancing and failover look like MAC flapping', scen: 'baseline',
      html: `Every 10 s a bucket may move between a sw1 port and a sw2 port. Switch MAC-move / loop-protection features can log, throttle or block the MAC. <b>Mitigate:</b> tune flap thresholds for host ports; <code>bond-rebalance-interval=0</code> stops rebalancing but keeps failover.` },
    { sev: '', tag: 'Medium', title: 'Loop suppression depends on MAC learning', scen: 'ex3',
      html: `Reflected broadcasts are dropped only because the source MAC is learned locally. Anything that disables or bypasses learning (e.g. <code>flood_vlans</code>) or churns the table (default <code>mac-table-size</code> 8192) weakens that protection.` },
    { sev: 'ok', tag: 'Low', title: '5-second GARP lock window', scen: 'ex5',
      html: `The lock stops a node relearning its own VM on the bond. It is re-armed by every local GARP; residual exposure is a network-sourced GARP for the same MAC arriving on the active member after 5 s.` },
    { sev: 'ok', tag: 'Expectation', title: 'Only VM MACs are balanced', scen: 'baseline',
      html: `Pod and host traffic on <code>br-ex</code> uses one MAC + VLAN and always uses one member. SLB adds bandwidth only across many VM MACs on localnet networks.` },
  ];

  /* ---------------- Timeline flattening ---------------- */
  let S = null; // current scenario
  function prep(sc) {
    let t = 0;
    sc.steps.forEach((st) => { st.start = t; t += st.dur; st.end = t; (st.frames ||= []); (st.up ||= []); });
    sc.total = t;
  }
  SCEN.forEach(prep);

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
    if (u.t === 'patch') { if (s[u.tb][u.k]) Object.assign(s[u.tb][u.k], u.v); return; }
    if (u.t === 'down') { s.down[u.k] = u.v; return; }
    if (u.t === 'hA' || u.t === 'hB') { if (u.v === null) delete s[u.t][u.k]; else s[u.t][u.k] = u.v; return; }
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
    stat.append(el('rect', { x: 370, y: 32, width: 260, height: 54, rx: 8, class: 'box sw' }));
    stat.append(el('text', { x: 500, y: 55, 'text-anchor': 'middle', class: 'lbl' }, 'core1 · gateway'));
    stat.append(el('text', { x: 500, y: 75, 'text-anchor': 'middle', class: 'sub mono' }, 'gw …:fe · VLAN 100'));
    // core links
    for (const s of ['sw1', 'sw2']) stat.append(el('line', { x1: s === 'sw1' ? 420 : 580, y1: 86, x2: SW[s][0], y2: 157, class: 'link' }));
    // peer link
    stat.append(el('line', { x1: 392, y1: 175, x2: 608, y2: 175, class: 'link', 'stroke-dasharray': '6 4' }));
    stat.append(el('text', { x: 500, y: 166, 'text-anchor': 'middle', class: 'callout' }, 'MLAG peer-link'));
    stat.append(el('text', { x: 500, y: 196, 'text-anchor': 'middle', class: 'callout' }, 'shared chassis-ID · synced MACs'));
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
      stat.append(el('text', { x: H.cx, y: BR_TOP + 21, 'text-anchor': 'middle', class: 'lbl' }, 'br-phy · bond0 balance-slb'));
      const bl = el('text', { x: H.cx, y: BR_TOP + 42, 'text-anchor': 'middle', class: 'sub mono' }, '');
      stat.append(bl); refs.brLine[h] = bl;
      // local
      stat.append(el('line', { x1: H.cx, y1: BR_TOP + 54, x2: H.cx, y2: LOC_Y - 15, class: 'link' }));
      stat.append(el('rect', { x: H.cx - 130, y: LOC_Y - 15, width: 260, height: 30, rx: 15, class: 'fdbport' }));
      stat.append(el('text', { x: H.cx, y: LOC_Y + 5, 'text-anchor': 'middle', class: 'sub' }, 'local · patch → br-ex → br-int'));
    }
    // vm-x (fixed on A)
    vmBox(HOST.A.vm.x, 'vm-x', '…:02', false);
    stat.append(el('line', { x1: HOST.A.vm.x[0], y1: VM_Y - 23, x2: HOST.A.cx + 60, y2: LOC_Y + 15, class: 'link' }));
    // vm-web ghost slots
    for (const h of ['A', 'B']) {
      const [x, y] = HOST[h].vm.web;
      stat.append(el('line', { x1: x, y1: y - 23, x2: HOST[h].cx - (h === 'A' ? 60 : 0), y2: LOC_Y + 15, class: 'link' }));
      stat.append(el('rect', { x: x - 66, y: y - 23, width: 132, height: 46, rx: 8, class: 'vm ghost' }));
    }
    // migration path
    const mp = el('path', { d: 'M' + MIG.map((p) => p.join(',')).join(' L'), class: 'link', 'stroke-dasharray': '3 5', id: 'migpath', opacity: 0 });
    stat.append(mp);
    const mt = el('text', { x: 455, y: 695, 'text-anchor': 'middle', class: 'callout', id: 'miglbl', opacity: 0 }, 'live-migration network');
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
  const MACN = { web: 'vm-web', x: 'vm-x', gw: 'gw' };
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
      pos = at(MIG, f);
      const edge = Math.min(f, 1 - f) * 8; // shrink while travelling the migration path
      scale = 1 - 0.5 * Math.min(1, edge);
    } else pos = HOST[v].vm.web;
    vmWeb.setAttribute('transform', `translate(${pos[0]},${pos[1]}) scale(${scale.toFixed(3)})`);
    $('#migpath').setAttribute('opacity', st.mig ? 1 : 0);
    $('#miglbl').setAttribute('opacity', st.mig ? 1 : 0);

    // NIC states
    const hashB = s.hB.web, hashA = s.hA.web;
    for (const h of ['A', 'B']) for (const e of ENOS) {
      const r = refs.nic[`${h}.${e}`];
      const cls = ['nic'];
      if (s.act[h] === e) cls.push('active');
      if ((h === 'A' && hashA === e && (v === 'A')) || (h === 'B' && hashB === e && v === 'B')) cls.push('hashed');
      if (s.down[`${h}.${e}`]) cls.push('down');
      r.setAttribute('class', cls.join(' '));
      const cab = document.getElementById(`cab-${h}-${e}`);
      cab.setAttribute('stroke-dasharray', s.down[`${h}.${e}`] ? '4 4' : '');
      cab.style.stroke = s.down[`${h}.${e}`] ? 'var(--color-error)' : '';
    }

    // switch & br lines
    const swe = s.sw.web;
    for (const sw of ['sw1', 'sw2']) {
      const t = refs.swLine[sw];
      if (!swe) { t.textContent = 'vm-web: unknown → flood'; t.style.fill = 'var(--color-warning)'; continue; }
      const own = swOf(swe.port.split('·')[1] || '') === sw && swe.port !== 'core1';
      t.textContent = own ? `vm-web → ${swe.port}` : 'vm-web → via peer-link';
      t.style.fill = swe.stale ? 'var(--color-warning)' : 'var(--color-text-muted)';
    }
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
      $('#stepTitle').textContent = st.title;
      $('#stepBody').innerHTML = st.body;
      $('#docref').textContent = st.doc || '';
      $('#decision').innerHTML = (st.dec || []).map((d) => `<div class="dec ${d.cls}"><b>${d.where}</b><br>${d.html}</div>`).join('');
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
    const key = JSON.stringify([s.sw, s.A, s.B, s.hA, s.hB, s.down, s.changed]);
    if (key === lastTblKey) return;
    lastTblKey = key;
    const ch = new Set(s.changed);
    const flags = (e) => (e ? `${e.lock ? '<span class="flag lock">GARP-LOCK</span>' : ''}${e.stale ? '<span class="flag stale">STALE</span>' : ''}${e.wrong ? '<span class="flag wrong">WRONG</span>' : ''}` : '');
    const row = (tb, k, e) => `<tr class="${ch.has(`${tb}.${k}`) ? 'changed' : ''}"><td>${MACN[k]}</td><td>${e ? e.port + flags(e) : '<span style="color:var(--color-text-faint)">—</span>'}</td></tr>`;
    const swT = `<div class="tbl sw"><h4>sw1 + sw2 MAC table <small>MLAG-synced · VLAN 100</small></h4><table><thead><tr><th>MAC</th><th>port</th></tr></thead><tbody>${['web', 'x', 'gw'].map((k) => row('sw', k, s.sw[k])).join('')}</tbody></table></div>`;
    const node = (h) => {
      const hk = h === 'A' ? 'hA' : 'hB';
      const hash = Object.entries(s[hk]).map(([k, m]) => `<span class="${ch.has(`${hk}.${k}`) ? 'flag new' : ''}">${k === 'web' ? 'vm-web' : 'vm-x'}→<b>${m}</b></span>`).join(' ') || '<span>—</span>';
      const downs = ENOS.filter((e) => s.down[`${h}.${e}`]).map((e) => `<span class="flag wrong">${e} down</span>`).join('');
      return `<div class="tbl"><h4>Node ${h} FDB <small>br-phy</small></h4><table><thead><tr><th>MAC</th><th>port</th></tr></thead><tbody>${['web', 'x', 'gw'].map((k) => row(h, k, s[h][k])).join('')}</tbody></table>
        <div class="meta"><span>active <b>${s.act[h]}</b></span>${downs}</div><div class="meta"><span>hash ${hash}</span></div></div>`;
    };
    $('#tables').innerHTML = swT + node('A') + node('B');
  }

  /* ---------------- Scenario chrome ---------------- */
  function buildNav() {
    const nav = $('#scenarios');
    nav.innerHTML = SCEN.map((sc) => `<button data-id="${sc.id}" class="${sc.bad ? 'bad' : ''}" aria-pressed="false"><span class="n">${sc.n}</span>${sc.name}</button>`).join('');
    nav.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) load(b.dataset.id, true); });
  }
  function load(id, autoplay) {
    S = SCEN.find((x) => x.id === id) || SCEN[0];
    document.querySelectorAll('#scenarios button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === S.id)));
    $('#track').innerHTML = S.steps.map((st, k) => `<span class="${S.bad ? 'bad' : ''}" title="${k + 1}. ${st.title.replace(/"/g, '&quot;')}" data-k="${k}"><i></i></span>`).join('');
    T = 0; lastStepIdx = -1; lastTblKey = ''; holdAt = null;
    render();
    setPlaying(!!autoplay);
  }
  $('#track').addEventListener('click', (e) => { const sp = e.target.closest('span'); if (!sp) return; T = S.steps[+sp.dataset.k].start; holdAt = null; render(); setPlaying(true); });

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

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(64, now - last); last = now;
    if (playing) {
      T += dt * speed;
      if (holdAt != null && T >= holdAt) { T = holdAt; setPlaying(false); }
      if (T >= S.total - 1) { T = S.total - 1; setPlaying(false); }
      render();
    }
    requestAnimationFrame(tick);
  }

  $('#play').addEventListener('click', () => {
    if (!playing) { const i = stepIndex(T); if (T >= S.steps[i].end - 2 && i < S.steps.length - 1) { T = S.steps[i + 1].start; } }
    setPlaying(!playing); render();
  });
  $('#next').addEventListener('click', () => { const i = stepIndex(T); if (i < S.steps.length - 1) { T = S.steps[i + 1].start; render(); setPlaying(true); } else { T = S.total - 1; render(); setPlaying(false); } });
  $('#prev').addEventListener('click', () => { const i = stepIndex(T); const st = S.steps[i]; T = (T - st.start > 600 || i === 0) ? st.start : S.steps[i - 1].start; render(); setPlaying(true); });
  $('#restart').addEventListener('click', () => { T = 0; lastStepIdx = -1; render(); setPlaying(true); });
  $('#scrub').addEventListener('input', (e) => { setPlaying(false); T = (e.target.value / 1000) * (S.total - 1); render(); });
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
