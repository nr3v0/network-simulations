# AB Scope — OVS `active-backup` MAC learning during VM live migration

The active-backup counterpart of [SLB Scope](../ovs-balance-slb/) and [LACP Scope](../ovs-lacp-balance-tcp/): same two nodes, four members each across two switches, same scenarios — but `bond_mode=active-backup`: one member carries everything, the other three drop every frame they receive (`BM_AB` in `ofproto/bond.c`).

## Scenarios

- **0 · How active-backup works** — one active member, backups accept nothing, no hashing, no switch cooperation needed (the only OVS mode documented as safe with members on different switches).
- **1 · Cold start → migration (happy path)** — GARP from the new host is a single MAC move; the old host relearns like any MAC move (no SLB loop rule).
- **2 · Lifecycle** — cold start → migrate → *N* failovers (selectable) → migrate back, with pod traffic throughout.
- **#1 Failover = RARP burst and MAC moves** — one learning RARP per local MAC on every failover; every MAC on the node moves on the switches.
- **#2 Failover into a dead backup** — carrier up, forwarding down: the new active member black-holes everything.
- **#3 `bond-primary` and link flapping** — primary returns, bond flips back, another RARP burst; updelay as mitigation.
- **#4 RARP-only announcement after migration** — accepted under active-backup; residual "no announcement" case.
- **#5 Kernel bond instead of OVS bond** — kernel active-backup announces only the bond's own IP (`num_grat_arp`), not VM MACs.

## Controls

- **Switches**: MLAG peer-link (shared MAC table) or Independent via core1.
- **Failovers** (Lifecycle only), prev/play/next/restart, timeline, scrubber, speed, pause-after-step, loop. Keyboard: space, ←/→.

## Sources

- OVS bonding docs: https://docs.openvswitch.org/en/stable/topics/bonding/
- `ovs-vswitchd.conf.db(5)`: https://www.openvswitch.org/support/dist-docs/ovs-vswitchd.conf.db.5.txt
- `ofproto/bond.c` (`bond_check_admissibility`, `BM_AB`): https://github.com/openvswitch/ovs/blob/master/ofproto/bond.c
- `lib/mac-learning.h`: https://github.com/openvswitch/ovs/blob/master/lib/mac-learning.h
- Linux kernel bonding.rst: https://www.kernel.org/doc/Documentation/networking/bonding.rst
- Red Hat OCP 4.22 network bonding considerations: https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/advanced_networking/network-bonding-considerations
- QEMU announce-self: https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html
- Design inspiration: https://raft.github.io/
