# MTR-like Network Monitor — Home Assistant Custom Integration

Monitor a destination host and every hop along the path, exactly like the
`mtr` command-line tool, directly inside Home Assistant.

---

## Features

| Feature | Details |
|---|---|
| **Protocols** | ICMP echo · TCP SYN · UDP datagram |
| **Per-hop metrics** | RTT (last / avg / min / max), jitter, packet loss %, sent/received counts |
| **Reverse DNS** | Hostnames resolved for each hop |
| **Two dashboard cards** | Destination-only (simple) · Full traceroute (detailed) |
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
2. Copy `www/mtr-destination-card.js` and `www/mtr-traceroute-card.js`
   into your `config/www/` directory.
3. Restart Home Assistant.

---

## Dashboard Card Setup

After installing, register the JS resources so the Lovelace cards are available:

**Home Assistant 2026.4.0+ (new dashboard editor)**

1. Open any dashboard and click **Edit dashboard** (pencil icon).
2. Click the ⋮ menu → **Manage resources**.
3. Click **Add resource** for each file:
   - URL: `/local/mtr-destination-card.js` — Resource type: **JavaScript module**
   - URL: `/local/mtr-traceroute-card.js` — Resource type: **JavaScript module**
4. Save and reload the page.

**Alternative (works in all versions)**

1. Go to **Settings → Dashboards**.
2. Click ⋮ (top-right) → **Resources**.
3. Add the two entries above.

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

### Card 2: `mtr-traceroute-card` (Full MTR View)

Renders a full hop table matching the `mtr` TUI output with animated RTT
bars and colour-coded status dots.

```yaml
type: custom:mtr-traceroute-card
title: "Path to 8.8.8.8"
destination_entity: binary_sensor.8_8_8_8_reachable
rtt_sensors:
  - sensor.8_8_8_8_hop_1_rtt
  - sensor.8_8_8_8_hop_2_rtt
  - sensor.8_8_8_8_hop_3_rtt
  # … add one entry per hop
loss_sensors:
  - sensor.8_8_8_8_hop_1_loss
  - sensor.8_8_8_8_hop_2_loss
  - sensor.8_8_8_8_hop_3_loss
```

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

MIT License — feel free to adapt and redistribute.
