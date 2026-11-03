# SLB Scope — OVS `balance-slb` MAC learning during VM live migration

A step-by-step animated model of how an Open vSwitch `balance-slb` bond (4 members, 2 per upstream switch) learns and re-learns MAC addresses when a VM live-migrates between two nodes — including the pitfalls in the OVS bonding documentation.

## Scenarios

- **0 · How SLB pins & learns** — source-MAC hashing to members, the active-member broadcast rule, pod-network (br-ex) traffic, hash rebalance.
- **1 · Cold start → migration (happy path)** — initial ARP learning on both nodes, then a live migration announced the way the **Announcement** controls say: QEMU's RARP, the guest's gratuitous ARP or IPv6 neighbour advertisement, and (optionally) ovn-controller's gratuitous ARPs. With no gratuitous ARP at all the run ends with the old node stranded.
- **2 · Lifecycle** — cold start → migrate A→B → *N* hash rebalances (selectable 0–6, cycling across members and switches) → migrate B→A, with Kubernetes pod traffic flowing throughout.
- **#0–#4** — the SLB complications, numbered as in the OVS bonding doc (its list starts at 0): unknown-unicast duplicates, inbound broadcast on non-active members, outbound broadcast reflection, no GARP after migration, reflected GARP & the 5 s lock.
- **+ Member failover** — related behaviour when a member link drops.
- **+ Second move inside the lock** — vm-web lands on Node B and migrates back to Node A 3.5 s later. Node B's GARP lock (≈6 s with guest announcements, ≈21 s when ovn-controller repeats its own) makes it ignore the genuine move; whether it recovers in seconds or only at `mac-aging-time` depends on the Announcement controls.

## Controls

- **Switches**: MLAG peer-link (one synced MAC table) or independent switches joined only via `core1` (separate tables, MAC moves on the core).
- **Rebalances** (Lifecycle only): number of hash rebalances before the second migration.
- **Announcement** (happy path, lifecycle, #3, second move): RARP + gratuitous ARP (virtio IPv4 guest), RARP + neighbour advertisement (IPv6-only guest), or RARP only. **OVN knows the IP (NAD subnets)** adds ovn-controller's gratuitous ARPs at ≈1, 2, 4, 8 and 16 s.
- Prev / play / next / restart, step timeline, scrubber, speed, pause-after-each-step, loop with 1.5 s restart. Keyboard: space, ←/→.

## Model assumptions & sources

See the lists at the bottom of the page. Key references:

- OVS bonding docs: https://docs.openvswitch.org/en/stable/topics/bonding/
- `ofproto/ofproto-dpif-xlate.c` (GARP exception, "SLB bond thinks this packet looped back"): https://github.com/openvswitch/ovs/blob/master/ofproto/ofproto-dpif-xlate.c
- `lib/mac-learning.h` (300 s idle age, 5 s gratuitous-ARP lock): https://github.com/openvswitch/ovs/blob/master/lib/mac-learning.h
- QEMU post-migration self-announce (RARP): https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html and `net/announce.c` (RARP plus the NIC's own announce, i.e. virtio guest-announce): https://github.com/qemu/qemu/blob/master/net/announce.c
- OVN `controller/garp_rarp.c` and `controller/pinctrl.c` (GARP when the port has IPv4, else RARP; 5 announcements, backoff 1 → 16 s): https://github.com/ovn-org/ovn/blob/main/controller/garp_rarp.c
- OVN-Kubernetes: LSP addresses carry IPs only with IPAM; migration target port enabled when the target domain is ready: https://github.com/openshift/ovn-kubernetes/blob/main/go-controller/pkg/ovn/base_network_controller_user_defined.go
- Raft visualization (inspiration): https://raft.github.io/

## Running

Static files only — open `index.html` or `python3 -m http.server` in this folder.
