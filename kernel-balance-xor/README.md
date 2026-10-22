# XOR Scope — Linux kernel `balance-xor` (mode 2) MAC learning during VM live migration

Same two nodes, four ports each across two MLAG switches, same scenarios as the other simulations — but the bond is a **Linux kernel** bond (`mode=balance-xor`, `miimon=100`) enslaving eno1–eno4, with OVS `br-ex` owning `bond0` as a single port. Open vSwitch has no balance-xor mode; Red Hat documents OVS bonds (active-backup / balance-slb) and kernel bonding separately.

## Scenarios

- **0 · How balance-xor hashes** — no negotiation (static port-channel required), the `layer2` formula `(srcMAC[5] ^ dstMAC[5] ^ ethertype) mod slaves` worked out for each MAC, pods pinned to one slave, switch-side hashing, ARP vs IPv4 on different slaves.
- **1 · Cold start → migration (happy path)** — with a correct static LAG this is a single `Po-A → Po-B` MAC move, like LACP.
- **2 · Lifecycle** — cold start → migrate → *N* link failovers (selectable; hash modulo 3 remaps most flows) → migrate back.
- **#1 One port left out of the port-channel** — MAC flapping between the lone port and the LAG, duplicate and reflected broadcasts.
- **#2 No port-channel at all** — pointer to the **Plain ports** toggle: MAC flapping per destination/ethertype, every broadcast delivered four times, br-ex learning its own VMs behind the bond — while the bond reports four healthy slaves.
- **#3 Dead path, live carrier** — miimon never notices; `arp_interval` caveats in EtherChannel modes.
- **#4 layer2 pins north-south traffic** — one slave per source MAC behind a single gateway MAC; `layer3+4` what-if.
- **#5 RARP-only announcement** — accepted; residual "no announcement" case.
- **+ Member link down** — modulo remap, no MAC move.

## Controls

- **Switches**: Static port-channel (MLAG) or Plain ports (no LAG, same MLAG pair).
- **Hash**: `layer2` (default) or `layer3+4` — rebuilds every scenario.
- **Failovers** (Lifecycle only), prev/play/next/restart, timeline, scrubber, speed, pause-after-step, loop. Keyboard: space, ←/→.

## Sources

- Linux kernel bonding.rst: https://www.kernel.org/doc/Documentation/networking/bonding.rst
- OVS bonding docs (for comparison): https://docs.openvswitch.org/en/stable/topics/bonding/
- `lib/mac-learning.h` (br-ex learning): https://github.com/openvswitch/ovs/blob/master/lib/mac-learning.h
- Red Hat OCP 4.22 network bonding considerations: https://docs.redhat.com/en/documentation/openshift_container_platform/4.22/html/advanced_networking/network-bonding-considerations
- QEMU announce-self: https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html
- Design inspiration: https://raft.github.io/
