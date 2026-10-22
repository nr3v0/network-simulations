# network-simulations

Interactive, browser-based simulations of network behaviour. Each simulation is a self-contained static site (plain HTML/CSS/JS, no build step) — open `index.html` or serve the folder with any static web server.

| Folder | Simulation |
|---|---|
| [`ovs-balance-slb/`](ovs-balance-slb/) | **SLB Scope** — MAC learning on an Open vSwitch `balance-slb` bond across 4 ports / 2 switches during VM live migration: cold start, happy path, every complication from the OVS bonding docs, member failover, and a lifecycle run (migrate → hash rebalance ×N → migrate back). Toggle MLAG peer-link vs. independent switches, step through frames Raft-visualization style, and watch per-node FDBs and switch MAC tables update. |

## Running locally

```sh
cd ovs-balance-slb
python3 -m http.server 8765
# open http://127.0.0.1:8765/
```
