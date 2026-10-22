# network-simulations

Interactive, browser-based simulations of network behaviour. Each simulation is a self-contained static site (plain HTML/CSS/JS, no build step).

**Live (GitHub Pages):** https://nr3v0.github.io/network-simulations/

- SLB Scope: https://nr3v0.github.io/network-simulations/ovs-balance-slb/
- LACP Scope: https://nr3v0.github.io/network-simulations/ovs-lacp-balance-tcp/

| Folder | Simulation |
|---|---|
| [`ovs-lacp-balance-tcp/`](ovs-lacp-balance-tcp/) | **LACP Scope** — the same topology with an 802.3ad `balance-tcp` bond: per-flow hashing, migration as a single port-channel MAC move, rebalances invisible to the switches, and the LACP-specific failure modes (un-negotiated day 0, MLAG peer-link loss → two LACP systems, slow timers, elephant flows). |
| [`ovs-balance-slb/`](ovs-balance-slb/) | **SLB Scope** — MAC learning on an Open vSwitch `balance-slb` bond across 4 ports / 2 switches during VM live migration: cold start, happy path, every complication from the OVS bonding docs, member failover, and a lifecycle run (migrate → hash rebalance ×N → migrate back). Toggle MLAG peer-link vs. independent switches, step through frames Raft-visualization style, and watch per-node FDBs and switch MAC tables update. |

## Running locally

```sh
python3 -m http.server 8765
# open http://127.0.0.1:8765/  (landing page linking both simulations)
```
