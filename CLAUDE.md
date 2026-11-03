# CLAUDE.md — guide for AI agents working in this repository

This file is read by Claude Code (and other agents via `AGENTS.md`). It explains what the project is, how it is built, and the rules to follow when changing it. Keep it accurate: update it whenever the structure, conventions or verified facts below change.

## What this repository is

Interactive, RaftScope-style (https://raft.github.io/) step-through visualizations of how **OpenShift node bonds learn and re-learn MAC addresses** across four NICs and two switches during cold start, VM live migration, rebalancing, failover and misconfiguration. Audience: platform and network teams who need to understand bond behaviour and risks (built for a customer conversation about OVS `balance-slb` on OpenShift Virtualization).

Four simulations, one shared topology (Node A / Node B, four members each; eno1/eno2 → sw1, eno3/eno4 → sw2; sw1/sw2 are an MLAG pair uplinked to core1 which holds the gateway MAC):

| Folder | Name | Bond |
|---|---|---|
| `ovs-balance-slb/` | SLB Scope | OVS `balance-slb` (source-MAC hashing, no switch cooperation) |
| `ovs-lacp-balance-tcp/` | LACP Scope | OVS `balance-tcp` + LACP (802.3ad) |
| `ovs-active-backup/` | AB Scope | OVS `active-backup` |
| `kernel-balance-xor/` | XOR Scope | Linux **kernel** bond `balance-xor` (mode 2) under `br-ex` — OVS has no such mode |

Live: https://nr3v0.github.io/network-simulations/ (GitHub Pages, legacy build from `main`, root; `.nojekyll` present). Every push to `main` republishes automatically.

## Repository layout

```
index.html                 landing page (dark cards linking the four sims; inline CSS tokens)
README.md                  user-facing overview + live links
CLAUDE.md / AGENTS.md      this guide (AGENTS.md points here)
docs/                      perplexity-computer-transcript.md — full build transcript of the original session
.nojekyll                  make GitHub Pages serve files as-is
<sim>/index.html           page: header + scenario tabs (two rows) + toolbar + SVG stage + narration/tables + risks + assumptions + sources
<sim>/style.css            sim-specific styles (topology classes, legend chips, tables)
<sim>/base.css             shared design tokens (colors, type, spacing) — identical across sims
<sim>/app.js               the whole simulation: geometry, path helpers, state model, scenarios, renderer, controls
<sim>/README.md            per-sim scenario list, controls and sources
```

No build step, no dependencies, no framework. Plain ES2020 in an IIFE, SVG generated at runtime. Fonts are loaded from Fontshare/Google (General Sans, JetBrains Mono) with system fallbacks.

## Running and testing

```sh
python3 -m http.server 8765          # from repo root
# http://127.0.0.1:8765/<sim>/index.html
node -e "new Function(require('fs').readFileSync('<sim>/app.js','utf8'))"   # syntax check
```

QA expectation before committing any `app.js` change (do this with Playwright/headless Chromium, or manually):

1. Load each affected sim; **zero** `pageerror`/console errors.
2. Walk every scenario tab (`#scenarios button[data-id]`) and every timeline step (`#track span[data-k]`) in **both** switch modes (`#modeSeg button[data-mode="mlag"|"indep"]`); for XOR also both `#hashSel` values (`l2`, `l34`); for lifecycle also a couple of `#nreb` values.
3. Visually check at 1440 px and 375 px (no horizontal overflow: `document.documentElement.scrollWidth === clientWidth`).
4. Confirm animated dots ride the drawn lines (links are drawn in `drawStatic()`; dots follow point lists from the path helpers — the two must stay geometrically consistent).
5. After pushing, poll `gh api repos/nr3v0/network-simulations/pages --jq .status` until `built`, then open the live URL in a fresh browser context.

## How a simulation works (shared engine)

All four `app.js` files descend from the SLB engine; SLB/AB share the "per-port flood" flavour, LACP/XOR share the "LAG flood" flavour. Section order inside each file:

1. **Geometry** — SVG viewBox `1000×704`. `CORE=[500,86]` (core box x 330–670, y 32–86), `SW.sw1=[280,182]`, `SW.sw2=[720,182]` (boxes 224×50), per-host `HOST[h].px` (NIC x), `att` (where each cable meets its switch at `ATT_Y=207`), `vm` positions (`VM_Y=598`), `PORT_Y/ADM_Y/BR_TOP/BR_C/LOC_Y` rungs. `MIG` is the dashed migration path at y=672.
2. **Path helpers** — `up(h,vm,eno)`, `dn(from,h,eno,to)`, `toCore(s)`, `fromCore(s)`, `viaCore(pts)`, `localUp`, plus flood builders (`flood`/`coreFlood` in SLB/AB, `lagFlood`/`coreFlood`/`uniUp`/`uniDown` in LACP/XOR). `UPL[s]` holds the uplink waypoints (switch top centre → core box lower corner) so frames follow the drawn uplinks. Cross-switch frames go over the peer-link (`SW[from] → SW[s]`) in MLAG mode and via core1 (`UPL` → `CORE` → `UPL`) in independent mode (SLB/AB/LACP). `join()` concatenates point lists, de-duplicating shared endpoints.
3. **State model** — `sw` (switch MAC table rows `web,x,pA,pB,gw` → `{port, fresh?, stale?, moved?, lock?, wrong?}`), `swx` (per-switch tables sw1/sw2/core used in independent mode), `A`/`B` (per-node bridge FDBs), `hA`/`hB` (hash/flow strings e.g. `'eno2+eno3'`), `act` (active member, SLB/AB), `lk` (member link state, LACP/XOR: `cur,mis,def,exp,sil,ab,down`), `down` (`'B.eno3': true`), `vm` (`'A'|'B'`). Initial-state factories: `steady()`, `converged()`, `justMigrated()`, `coldStart()`; mutate via `applySw`, `patchSw`.
4. **Step builders** — `coldStartSteps()`, `migrateSteps(from,to,…)`, `rebalanceSteps`/`failoverSteps`, `podTraffic(offset)`, `lifecycle()`. A **step** is `{clock, title, [titleI], body, [bodyI], doc, dur, frames, up, dec, [decI], [whatif], vm, [mig], [pl]}` — the `…I` variants are used in independent/plain-port mode. **frames** are `{pts, k, t0, t1, end, note, label, dash}` with `k ∈ uni|bcast|garp|rarp|nd|mig|pod|lacp` (`nd` = IPv6 neighbour advertisement, SLB/AB), `t0/t1` as fractions of the step, `end ∈ 'ok'|'drop'|null`. **up** entries are timed state mutations `{at, t:'sw'|'A'|'B'|'hA'|'hB'|'patch'|'down'|'act'|'lk'|'swx', k, v}`. **dec** entries are decision-trace cards `D(cls, where, html)` with `cls ∈ ok|warn|drop`.
5. **Scenarios** — `buildScenarios()` returns `[{id, n, name, bad?, init, steps}]`. Ids: `baseline, happy, life, ex1…ex5, fail`; SLB also has `relock` (second move inside the GARP lock — SLB-specific, since only SLB drops reflections by the learned-port rule). In SLB the `ex1…ex5` tabs are labelled `#0…#4` to match the OVS doc's SLB complication list, which starts at 0 (`<ol start="0">`); the ids stay `ex1…ex5`. Other sims number their own complication lists from #1. `buildNav()` renders two tab rows: `[baseline, happy, life]` and the rest. `RISKS` drives the risk cards (each links to a scenario). Scenarios are rebuilt when mode/hash/N changes (`rebuildScenarios()`), because step text depends on those settings.
6. **Timeline/renderer** — steps are flattened to a global clock; `stateAt(k)` recomputes state by replaying `up` entries; `render()` draws dynamic SVG (`dyn` group) over static SVG (`stat` group), positions dots by arc length (`lenOf`/`at`), shows labels (below the dot when y < 100 to avoid the core box text), drop/accept markers, the what-if banner, tables (switch table + Node A/B FDBs) and the decision trace.
7. **Controls** — `#modeSeg`, `#hashSel` (XOR), `#lifeOpt/#nreb` (lifecycle tab only), `#annOpt/#ann` + `#ovnOpt/#ovnIp` (SLB: happy, life, ex4, relock; AB: happy, life — the post-migration announcement model; `announceSteps()` in SLB and `laterAnnouncements()` in AB build the steps from `ann`/`ovnIp`), `#prev/#play/#next/#restart`, `#track` (step chips), `#scrub`, `#speed`, `#hold` (pause after each step), `#loop` (restart after 1.5 s). Keyboard: space, ←/→. CSS `[hidden]{display:none!important}`.

### Conventions

- Keep the four sims **structurally parallel** (same ids, same controls, same section order) so they can be compared side by side; when adding a control or scenario type to one, consider all four.
- Narration must stay **faithful to the sources** below. Prefer quoting/paraphrasing the OVS source, OVS docs or kernel `bonding.rst`; mark anything speculative as a hypothetical (`whatif`). Do not invent switch behaviour.
- Time in the animation is compressed; the `clock` string is the only wall-clock reference and must stay plausible (e.g. OVS MAC idle 300 s, SLB rebalance 10 s, LACP fast 1 s / slow 30 s timers ×3).
- MAC naming: `vm-web …:01`, `vm-x …:02`, `pods-A …:0a`, `pods-B …:0b`, gateway `…:fe`. The XOR layer2 hash values in the narration are computed from these (keep them consistent if you change MACs).
- Styling: use the CSS custom properties in `base.css`; do not hardcode colours. Mobile: segment buttons wrap at ≤720 px; nothing may overflow at 375 px.
- Cite sources in the page's **Sources** section with full URLs; keep the per-sim `README.md` in sync with scenarios and controls.
- Commit messages: imperative, one line summary; group related changes. Author identity is configured locally; never override it.

## Verified technical facts the sims rely on (with sources)

- OVS `ofproto/bond.c` `bond_check_admissibility`: LACP negotiated → accept on any enabled member; LACP configured but not negotiated → drop unless `lacp-fallback-ab`; active-backup drops everything received on backup members; SLB drops frames whose source MAC was learned on another port ("if moved") except gratuitous ARP. https://github.com/openvswitch/ovs/blob/master/ofproto/bond.c
- OVS `lib/lacp.c`: members whose partner system-ID/key differ from the lead's are detached; fast/slow timers 1 s / 30 s, expiry ×3. https://github.com/openvswitch/ovs/blob/master/lib/lacp.c
- OVS `lib/mac-learning.h`: 300 s idle timeout, 5 s gratuitous-ARP lock, 8192 entries. https://github.com/openvswitch/ovs/blob/master/lib/mac-learning.h
- OVS bonding docs: learning RARP per locally-learned MAC when a member is disabled; active-backup is the only mode documented for members on different switches; SLB complications numbered 0–4 in the doc; LACP needs no special receive handling; `lacp-fallback-ab`. https://docs.openvswitch.org/en/stable/topics/bonding/
- `ovs-vswitchd.conf.db(5)`: `balance-tcp` requires LACP; `lacp-time`, `bond-primary`, `all-members-active`, `bond-rebalance-interval`. https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.conf.db.5.txt
- Linux `bonding.rst`: `balance-xor` slave = (srcMAC XOR dstMAC XOR ethertype) mod slaves; `xmit_hash_policy` layer2 / layer2+3 / layer3+4 (layer3+4 "not fully 802.3ad compliant"); xor/rr/broadcast need switch port grouping; `miimon` default 100 ms; `arp_interval` caveats; active-backup GARP only for the bond's own IP; `primary`/`primary_reselect`. https://www.kernel.org/doc/Documentation/networking/bonding.rst
- Red Hat OCP 4.22 bonding considerations: OVS bonding supports `active-backup` or `balance-slb`; kernel bonding is separate; `fail_over_mac=0` only. https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/advanced_networking/network-bonding-considerations
- QEMU `announce-self` = broadcast RARP after migration. https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html
- QEMU `net/announce.c`: after incoming migration `qemu_announce_self()` runs unconditionally; each round sends a RARP (`announce_self_create()`, ethertype 0x8035) **and** calls the NIC's own announce callback. virtio-net uses it to ask a guest that negotiated `VIRTIO_NET_F_GUEST_ANNOUNCE` + `CTRL_VQ` to announce itself. Defaults (`migration/options.c`): 5 rounds, initial 50 ms, step 100 ms, max 550 ms. https://github.com/qemu/qemu/blob/master/net/announce.c · https://github.com/qemu/qemu/blob/master/hw/net/virtio-net.c
- Linux guest on `NETDEV_NOTIFY_PEERS`: gratuitous ARP for each IPv4 address (unconditional since 2011) and `ndisc_send_unsol_na()` for IPv6. https://github.com/torvalds/linux/blob/master/net/ipv6/ndisc.c
- OVS `ofproto-dpif-xlate.c` `is_gratuitous_arp()`: requires `dl_type == ETH_TYPE_ARP`, broadcast dst, and an ARP reply or a request with sender IP = target IP. RARP and IPv6 ND never match, so they get neither the SLB exception nor the lock. `mac-learning.c`: the lock is set only by a GARP from a non-bond port; a locked entry ignores GARPs from bond ports. https://github.com/openvswitch/ovs/blob/master/ofproto/ofproto-dpif-xlate.c
- OVN sends GARP for localnet VIFs with a known IP. https://mail.openvswitch.org/pipermail/ovs-dev/2019-September/362322.html — confirmed in source: `controller/garp_rarp.c` announces VIF ports bound to this chassis on datapaths with a localnet port; GARP if the port has an IPv4 address, RARP otherwise (IPv6-only → RARP, no ND); first announcement 1 s after the entry is created. `controller/pinctrl.c` `send_garp_rarp()`: backoff doubles from 1 s to `garp-max-timeout-sec` (default 16 s) → at most 5 announcements at ≈+1, +2, +4, +8, +16 s. https://github.com/ovn-org/ovn/blob/main/controller/garp_rarp.c · https://github.com/ovn-org/ovn/blob/main/controller/pinctrl.c
- OVN-Kubernetes: LSP `addresses` are `"MAC IP…"` only when the pod annotation carries IPs (localnet NAD with `subnets`); otherwise MAC only, so OVN sends RARPs. For KubeVirt migration on layer2/localnet networks the target pod's LSP is created disabled and enabled only when the target domain is ready, so OVN's announcements start after switchover. https://github.com/openshift/ovn-kubernetes/blob/main/go-controller/pkg/ovn/base_network_controller_pods.go · https://github.com/openshift/ovn-kubernetes/blob/main/go-controller/pkg/ovn/base_network_controller_user_defined.go
- Consequence used by SLB Scope: every local GARP renews the 5 s lock, so the lock lasts ≈6 s after switchover with guest announcements and ≈21 s when OVN repeats its GARPs; a genuine move away inside that window is ignored by the node the VM left.

## History

The project was built in a single Perplexity Computer session (October–November 2026); the full transcript, including every user request and the reasoning behind design choices, is in `docs/perplexity-computer-transcript.md`. Read it when a question is "why was it done this way?".
