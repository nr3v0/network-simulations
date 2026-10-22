# SLB Scope — OVS `balance-slb` MAC learning during VM live migration

A step-by-step animated model of how an Open vSwitch `balance-slb` bond (4 members, 2 per upstream switch) learns and re-learns MAC addresses when a VM live-migrates between two nodes — including the pitfalls in the OVS bonding documentation.

## Scenarios

- **0 · How SLB pins & learns** — source-MAC hashing to members, the active-member broadcast rule, pod-network (br-ex) traffic, hash rebalance.
- **1 · Cold start → migration (happy path)** — initial ARP learning on both nodes, then a live migration with GARP.
- **2 · Lifecycle** — cold start → migrate A→B → *N* hash rebalances (selectable 0–6, cycling across members and switches) → migrate B→A, with Kubernetes pod traffic flowing throughout.
- **#1–#5** — the SLB complications from the OVS docs: unknown-unicast duplicates, inbound broadcast on non-active members, outbound broadcast reflection, no GARP after migration, reflected GARP & the 5 s lock.
- **+ Member failover** — related behaviour when a member link drops.

## Controls

- **Switches**: MLAG peer-link (one synced MAC table) or independent switches joined only via `core1` (separate tables, MAC moves on the core).
- **Rebalances** (Lifecycle only): number of hash rebalances before the second migration.
- Prev / play / next / restart, step timeline, scrubber, speed, pause-after-each-step, loop with 1.5 s restart. Keyboard: space, ←/→.

## Model assumptions & sources

See the lists at the bottom of the page. Key references:

- OVS bonding docs: https://docs.openvswitch.org/en/stable/topics/bonding/
- `ofproto/ofproto-dpif-xlate.c` (GARP exception, "SLB bond thinks this packet looped back"): https://github.com/openvswitch/ovs/blob/master/ofproto/ofproto-dpif-xlate.c
- `lib/mac-learning.h` (300 s idle age, 5 s gratuitous-ARP lock): https://github.com/openvswitch/ovs/blob/master/lib/mac-learning.h
- QEMU post-migration self-announce (RARP): https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html
- Raft visualization (inspiration): https://raft.github.io/

## Running

Static files only — open `index.html` or `python3 -m http.server` in this folder.
