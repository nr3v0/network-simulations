# LACP Scope — OVS `balance-tcp` (802.3ad) MAC learning during VM live migration

The LACP counterpart of [SLB Scope](../ovs-balance-slb/): same two nodes, four members each across two switches, same scenarios — but the bond is `bond_mode=balance-tcp lacp=active`, so the switches see one port-channel per node.

## Scenarios

- **0 · How LACP + balance-tcp works** — LACP negotiation, per-flow (L2/L3/L4) hashing, same MAC on several members without a MAC move, pod traffic spread across members, rebalance invisible to the switches, broadcast once per LAG (never reflected).
- **1 · Cold start → migration (happy path)** — GARP is a single `Po-A → Po-B` MAC move; the old host accepts the flooded copy without any SLB loop logic.
- **2 · Lifecycle** — cold start → migrate → *N* rebalances (selectable) → migrate back.
- **#1 LACP not negotiated (day 0)** — bond disabled until the switch side is ready; `lacp-fallback-ab` what-if.
- **#2 MLAG peer-link failure → two LACP systems** — OVS attaches only the lead aggregator (`lacp_update_attached`); half the links, silently.
- **#3 Silent failure & LACP timers** — carrier-up/forwarding-down member black-holes buckets for 3 × 30 s (slow) vs 3 × 1 s (fast).
- **#4 RARP-only announcement** — no longer a problem under LACP; residual "no announcement at all" case.
- **#5 Hash polarization & elephant flows** — one flow, one link.
- **+ Member link down** — immediate failover, no MAC move.

## Controls

- **Switches**: MLAG (one LACP system-ID, Po-A/Po-B span both switches) or Independent (two system-IDs; only the sw1 members attach).
- **Rebalances** (Lifecycle only), prev/play/next/restart, timeline, scrubber, speed, pause-after-step, loop. Keyboard: space, ←/→.

## Sources

- OVS bonding docs: https://docs.openvswitch.org/en/stable/topics/bonding/
- `ovs-vswitchd.conf.db(5)`: https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.conf.db.5.txt
- `ofproto/bond.c` (`bond_check_admissibility`): https://github.com/openvswitch/ovs/blob/master/ofproto/bond.c
- `lib/lacp.c` (`lacp_update_attached`, timers): https://github.com/openvswitch/ovs/blob/master/lib/lacp.c
- `lib/mac-learning.h`: https://github.com/openvswitch/ovs/blob/master/lib/mac-learning.h
- QEMU announce-self: https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html

## Running

Static files only — open `index.html` or `python3 -m http.server` in the repository root.
