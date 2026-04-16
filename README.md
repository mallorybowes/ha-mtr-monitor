# MTR-like Network Monitor — Home Assistant Custom Integration

Monitor a destination host and every hop along the path, exactly like the
`mtr` command-line tool, directly inside Home Assistant.

This is vibeware so use appropriately.  No guarantees.  YMMV...

[Demo.webm](https://github.com/user-attachments/assets/55da6fe9-55ef-483f-b149-5603f33bd35a)

The single route bar graph shows each hop as a segment of the line.  Each segment
dynamically changes size and color based on the latest rtt values.

The mtr classic card tries to replicate the original mtr gui interface.  Clicking
on a hop will bring up the last 2 hour history graph.

---

## Features

| Feature | Details |
|---|---|
| **Protocols** | ICMP echo · TCP SYN · UDP datagram |
| **Per-hop metrics** | RTT (last / avg / min / max), jitter, packet loss %, sent/received counts |
| **Reverse DNS** | Hostnames resolved for each hop |
| **Four dashboard cards** | Destination · Traffic Light · Route Bar · Terminal (mtr-style TUI) |
| **HA entities** | Binary sensors (reachable / hop health) + Sensors (RTT ms / loss %) |
| **Config flow** | Full UI setup — no YAML editing required |
| **Rate limiting** | Configurable inter-packet delay (e.g. 1 packet every 5 s) |
| **Live options** | Change protocol, port, interval, TTL, rate limit without restarting HA |

---

## Requirements

* Home Assistant 2026.4.0 or newer
* The HA host must have network access to the destination
* **ICMP and UDP probes require root / `CAP_NET_RAW`** on the HA host
  (Home Assistant OS and Supervised installations run as root by default)
* TCP probes work without elevated privileges

---

## Installation

### Via HACS (recommended)

1. Open **HACS** → **Integrations** → ⋮ → **Custom repositories**
2. Add `https://github.com/mallorybowes/ha-mtr-monitor` (category: Integration)
3. Install **MTR Network Monitor**
4. Restart Home Assistant

### Manual

1. Copy the `custom_components/mtr_monitor/` folder into your
   `config/custom_components/` directory.
2. Copy `www/mtr-destination-card.js`, `www/mtr-trafficlight-card.js`,
   `www/mtr-route-bar-card.js`, and `www/mtr-terminal-card.js` into your
   `config/www/` directory.
3. Restart Home Assistant.

---

## Dashboard Card Setup

After installing, register the JS resources so the Lovelace cards are available.
There are **four cards** included — register all four:

**Home Assistant 2026.4.0+ (new dashboard editor)**

1. Open any dashboard and click **Edit dashboard** (pencil icon).
2. Click the ⋮ menu → **Manage resources**.
3. Click **Add resource** for each file:
   - URL: `/local/mtr-destination-card.js` — Resource type: **JavaScript module**
   - URL: `/local/mtr-trafficlight-card.js` — Resource type: **JavaScript module**
   - URL: `/local/mtr-route-bar-card.js` — Resource type: **JavaScript module**
   - URL: `/local/mtr-terminal-card.js` — Resource type: **JavaScript module**
4. Save and reload the page.

**Alternative (works in all versions)**

1. Go to **Settings → Dashboards**.
2. Click ⋮ (top-right) → **Resources**.
3. Add the four entries above.

---

## Configuration

Go to **Settings → Devices & Services → Add Integration → MTR Network Monitor**

| Field | Default | Description |
|---|---|---|
| Monitor Name | — | Friendly name shown in HA |
| Destination Host / IP | — | Hostname or IP to monitor |
| Protocol | `icmp` | `icmp`, `tcp`, or `udp` |
| Port | 80 | Used for TCP/UDP probes only |
| Polling Interval | 60 s | Seconds between full MTR sweeps |
| Max Hops | 30 | Maximum TTL (traceroute depth) |
| Ping Count | 3 | Probes sent per hop per sweep |
| Timeout | 2 s | Per-probe timeout in seconds |
| Packet Interval | 0 s | Minimum delay between individual probe packets (rate limiting). Set to e.g. `5` to send at most one packet every 5 seconds. `0` disables rate limiting. |

---

## Entities Created

For a monitor named **"8.8.8.8"** with 8 hops discovered:

### Binary Sensors

| Entity | Description |
|---|---|
| `binary_sensor.8_8_8_8_reachable` | Destination up/down (CONNECTIVITY class) |
| `binary_sensor.8_8_8_8_hop_1_problem` | Hop 1 has packet loss ≥ 10% (PROBLEM class) |
| … | … |
| `binary_sensor.8_8_8_8_hop_8_problem` | Hop 8 problem sensor |

### Sensors

| Entity | Unit | Description |
|---|---|---|
| `sensor.8_8_8_8_hop_N_rtt` | ms | Average RTT to hop N |
| `sensor.8_8_8_8_hop_N_loss` | % | Packet loss to hop N |

Every RTT sensor carries these attributes:

```
hop_number, hop_ip, hop_hostname,
last_rtt_ms, avg_rtt_ms, min_rtt_ms, max_rtt_ms,
jitter_ms, sent, received, loss_pct,
protocol, port, status
```

Status values: `ok` · `degraded` · `timeout` · `no_response`

---

## Dashboard Cards

### Card 1: `mtr-destination-card` (Simple / Destination Only)

Shows a single status badge plus four metric tiles for the destination.

```yaml
type: custom:mtr-destination-card
title: "8.8.8.8 (Google DNS)"
destination_entity: binary_sensor.8_8_8_8_reachable
rtt_entity: sensor.8_8_8_8_hop_8_rtt       # last hop
loss_entity: sensor.8_8_8_8_hop_8_loss
```

### Card 2: `mtr-trafficlight-card` (Traffic Light View)

Shows a proper traffic light (red/yellow/green) for the destination, followed by a
compact row per hop — each row has a glowing status dot in traffic-light colours,
the hop number, hostname / IP, average RTT, and packet loss.

```yaml
type: custom:mtr-trafficlight-card
title: "8.8.8.8 (Google DNS)"
destination_entity: binary_sensor.8_8_8_8_reachable
rtt_entity: sensor.8_8_8_8_hop_8_rtt       # last hop — used for dest metrics
loss_entity: sensor.8_8_8_8_hop_8_loss
rtt_sensors:
  - sensor.8_8_8_8_hop_1_rtt
  - sensor.8_8_8_8_hop_2_rtt
  - sensor.8_8_8_8_hop_3_rtt
  # … one entry per hop
loss_sensors:
  - sensor.8_8_8_8_hop_1_loss
  - sensor.8_8_8_8_hop_2_loss
  - sensor.8_8_8_8_hop_3_loss
```

Traffic light colours for both the destination light and hop dots:

| Colour | Meaning |
|--------|---------|
| Green  | `ok` — no packet loss, normal RTT |
| Amber  | `degraded` — partial loss or elevated RTT |
| Red    | `timeout` / 100 % loss — destination or hop unreachable |
| Grey   | No response (`* * *`) or status unknown |

### Card 3: `mtr-route-bar-card` (Route Bar)

Visualises the entire path as a single horizontal segmented bar.  Each segment
represents one hop — its **width is proportional to that hop's average RTT** and
its **colour follows the traffic-light scale**.  Hover over any segment for a
tooltip showing the full RTT breakdown (avg / last / min / max / jitter) and loss %.

```yaml
type: custom:mtr-route-bar-card
title: "Current Route to 8.8.8.8"
rtt_sensors:
  - sensor.8_8_8_8_hop_1_rtt
  - sensor.8_8_8_8_hop_2_rtt
  - sensor.8_8_8_8_hop_3_rtt
  # … one entry per hop
loss_sensors:                   # optional
  - sensor.8_8_8_8_hop_1_loss
  - sensor.8_8_8_8_hop_2_loss
  - sensor.8_8_8_8_hop_3_loss
rtt_amber: 50                   # ms — below this = green  (default 50)
rtt_red:   150                  # ms — above this = red    (default 150)
```

| Option | Default | Description |
|--------|---------|-------------|
| `rtt_sensors` | — | **Required.** One RTT sensor entity per hop, in order |
| `loss_sensors` | — | Optional. Loss sensors shown in hover tooltip |
| `title` | _(none)_ | Card heading |
| `rtt_amber` | `50` | RTT threshold (ms) above which a segment turns amber |
| `rtt_red` | `150` | RTT threshold (ms) above which a segment turns red |

Segment colour logic: grey if the hop has no data, is timed out, or sent no
response; red if status is `degraded` or avg RTT ≥ `rtt_red`; amber if avg RTT ≥
`rtt_amber`; green otherwise.  When all hops have valid RTT data the bar uses
proportional widths; if any hop has no data all segments are equal width.

### Card 4: `mtr-terminal-card` (Terminal / MTR TUI)

Replicates the classic `mtr` terminal interface — dark background, monospace
columns, and full-row colour coding that updates live after every probe.

**Columns:** Host · Loss% · Snt · Last · Avg · Best · Wrst · StDev

**Click any row** to open a 2-hour history popup for that hop's RTT and loss sensors.

```yaml
type: custom:mtr-terminal-card
title: "Path to 8.8.8.8"
destination_entity: binary_sensor.8_8_8_8_reachable   # optional — drives titlebar badge
columns: 8                                             # grid width 1–12 (default 4)
rtt_sensors:
  - sensor.8_8_8_8_hop_1_rtt
  - sensor.8_8_8_8_hop_2_rtt
  - sensor.8_8_8_8_hop_3_rtt
  # … one entry per hop
loss_sensors:                                          # optional but recommended
  - sensor.8_8_8_8_hop_1_loss
  - sensor.8_8_8_8_hop_2_loss
  - sensor.8_8_8_8_hop_3_loss
# Optional threshold overrides:
loss_amber: 10     # % loss → amber row  (default 10)
loss_red:   50     # % loss → red row    (default 50)
rtt_amber:  150    # ms avg → amber row  (default 150)
rtt_red:    400    # ms avg → red row    (default 400)
```

| Option | Default | Description |
|--------|---------|-------------|
| `rtt_sensors` | — | **Required.** One RTT sensor entity per hop, in order |
| `loss_sensors` | — | Optional. Enables the Loss% column and click-to-history popup |
| `destination_entity` | — | Optional. Binary sensor that drives the UP/DEGRADED/DOWN badge in the titlebar |
| `title` | `My traceroute` | Title shown in the terminal titlebar |
| `columns` | `4` | Dashboard grid width (1–12) |
| `loss_amber` | `10` | Loss % threshold for amber row colour |
| `loss_red` | `50` | Loss % threshold for red row colour |
| `rtt_amber` | `150` | Avg RTT (ms) threshold for amber row colour |
| `rtt_red` | `400` | Avg RTT (ms) threshold for red row colour |

Row colour precedence: a row turns **red** if status is `timeout`, loss ≥ `loss_red`,
or avg RTT ≥ `rtt_red`; **amber** if status is `degraded`, loss ≥ `loss_amber`, or
avg RTT ≥ `rtt_amber`; **green** otherwise.  Hops with no response show in grey
with `(waiting for reply)`.

See `sample-dashboard.yaml` for a complete example.

---

## Automations / Alerts

Use the binary sensors in standard HA automations:

```yaml
# Alert when destination goes down
trigger:
  - platform: state
    entity_id: binary_sensor.8_8_8_8_reachable
    to: "off"
    for: "00:02:00"
action:
  - service: notify.mobile_app
    data:
      message: "8.8.8.8 is unreachable!"

# Alert when any hop degrades
trigger:
  - platform: state
    entity_id: binary_sensor.8_8_8_8_hop_3_problem
    to: "on"
action:
  - service: notify.mobile_app
    data:
      message: "Hop 3 is experiencing packet loss"
```

---

## Protocol Notes

### ICMP
* Uses raw IP sockets — requires root/`CAP_NET_RAW`
* Most reliable, identical to standard `ping` and `mtr`
* Works through most routers (some silently drop ICMP)

### TCP
* Sends SYN packets with escalating TTL
* No elevated privileges needed for the connect() itself
* Raw recv socket for intermediate hops also needs `CAP_NET_RAW`;
  the code falls back gracefully to a connect-only probe if unavailable
* Best for monitoring services (web servers, etc.)
* Port 443 (HTTPS) or port 80 (HTTP) are common choices

### UDP
* Sends UDP datagrams with escalating TTL (classic Unix `traceroute`)
* Requires root/`CAP_NET_RAW`
* Uses high port numbers by default; set to a specific service port
  if needed

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| All hops show `* * *` | No `CAP_NET_RAW` | Run HA as root or grant capability |
| Destination unreachable at startup | DNS resolution failed | Check network / DNS from HA host |
| Entities not appearing | Hop count varies per sweep | Reload integration after first sweep |
| TCP probes show only destination | Intermediate routers don't reply to TCP | Use ICMP instead |

---

## License

CC0 1.0 Universal License — feel free to adapt and redistribute.
