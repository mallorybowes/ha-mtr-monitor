/**
 * mtr-traceroute-card.js
 * Lovelace card — Destination + all hops (full MTR view).
 *
 * Place this file in:  config/www/mtr-traceroute-card.js
 *
 * Then in your dashboard resources add:
 *   /local/mtr-traceroute-card.js  (type: module)
 *
 * Usage:
 *   type: custom:mtr-traceroute-card
 *   title: "Path to 8.8.8.8"
 *   # Provide hop sensors as arrays (index 0 = hop 1):
 *   rtt_sensors:
 *     - sensor.8_8_8_8_hop_1_rtt
 *     - sensor.8_8_8_8_hop_2_rtt
 *     - ...
 *   loss_sensors:
 *     - sensor.8_8_8_8_hop_1_loss
 *     - sensor.8_8_8_8_hop_2_loss
 *     - ...
 *   destination_entity: binary_sensor.8_8_8_8_reachable
 *
 * All hop data (ip, hostname, jitter, etc.) is read from sensor attributes.
 */

const RTT_SCALE_MAX = 200;   // ms — bar is 100% at this value

class MtrTracerouteCard extends HTMLElement {
  set hass(hass) {
    if (!this.content) this._build();
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.rtt_sensors || !Array.isArray(config.rtt_sensors)) {
      throw new Error("rtt_sensors (array) required");
    }
    this._config = config;
  }

  _build() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 0; overflow: hidden; }

        .card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 14px 16px 10px;
          border-bottom: 1px solid var(--divider-color);
          background: var(--card-background-color);
        }
        .card-title {
          font-family: 'Courier New', monospace;
          font-size: 0.95rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--primary-text-color);
        }
        .dest-badge {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 3px 10px;
          border-radius: 12px;
          font-family: monospace;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .dest-badge.up   { background:#1b5e2022; color:#43a047; border:1px solid #43a047; }
        .dest-badge.down { background:#b71c1c22; color:#ef5350; border:1px solid #ef5350; }
        .dest-badge.deg  { background:#e6510022; color:#ff9800; border:1px solid #ff9800; }
        .dest-badge.unk  { background:#37474f22; color:#90a4ae; border:1px solid #546e7a; }
        .dot { width:7px; height:7px; border-radius:50%; background:currentColor; display:inline-block; }

        .table-wrap { overflow-x: auto; }
        table {
          width: 100%;
          border-collapse: collapse;
          font-family: 'Courier New', monospace;
          font-size: 0.75rem;
        }
        thead tr {
          background: var(--secondary-background-color);
        }
        th {
          padding: 7px 10px;
          text-align: left;
          font-size: 0.65rem;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--secondary-text-color);
          white-space: nowrap;
        }
        th.num { text-align: right; }
        td {
          padding: 7px 10px;
          border-bottom: 1px solid var(--divider-color);
          vertical-align: middle;
          white-space: nowrap;
        }
        td.right { text-align: right; }
        tr.dest-row td { font-weight: 700; background: var(--secondary-background-color); }
        tr:hover td { background: var(--secondary-background-color); }

        .hop-num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px; height: 22px;
          border-radius: 50%;
          font-size: 0.7rem;
          font-weight: 700;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          border: 1px solid var(--divider-color);
        }
        .hop-num.dest-hop {
          background: #1565c033;
          color: #42a5f5;
          border-color: #42a5f5;
        }

        .host-cell { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
        .ip-line { color: var(--secondary-text-color); font-size: 0.68rem; }

        .bar-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
          min-width: 80px;
        }
        .bar-bg {
          flex: 1;
          height: 5px;
          border-radius: 3px;
          background: var(--secondary-background-color);
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          border-radius: 3px;
          transition: width 0.4s ease;
        }
        .bar-fill.ok  { background: #43a047; }
        .bar-fill.deg { background: #ff9800; }
        .bar-fill.bad { background: #ef5350; }

        .status-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .status-dot.ok  { background: #43a047; }
        .status-dot.deg { background: #ff9800; }
        .status-dot.bad { background: #ef5350; }
        .status-dot.unk { background: #546e7a; }

        .no-resp { color: var(--disabled-text-color); font-style: italic; }

        .footer {
          padding: 8px 16px;
          font-family: monospace;
          font-size: 0.65rem;
          color: var(--secondary-text-color);
          border-top: 1px solid var(--divider-color);
          display: flex;
          justify-content: space-between;
        }
      </style>
      <ha-card>
        <div class="card-header">
          <span class="card-title" id="card-title">MTR Path</span>
          <span class="dest-badge unk" id="dest-badge"><span class="dot"></span><span id="dest-text">UNKNOWN</span></span>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Host</th>
                <th class="num">Loss%</th>
                <th class="num">Snt</th>
                <th class="num">Last</th>
                <th class="num">Avg</th>
                <th class="num">Min</th>
                <th class="num">Max</th>
                <th class="num">Jit</th>
                <th>RTT</th>
              </tr>
            </thead>
            <tbody id="tbody"></tbody>
          </table>
        </div>
        <div class="footer">
          <span id="proto-info">—</span>
          <span id="updated">—</span>
        </div>
      </ha-card>
    `;
    this.content = this.shadowRoot.querySelector("ha-card");
  }

  _statusClass(status, lossPct) {
    if (status === "ok") return "ok";
    if (status === "degraded") return "deg";
    if (status === "timeout" || lossPct >= 100) return "bad";
    return "unk";
  }

  _render() {
    const cfg = this._config;
    const hass = this._hass;

    this.shadowRoot.getElementById("card-title").textContent = cfg.title || "MTR Path";

    const destState = cfg.destination_entity ? hass.states[cfg.destination_entity] : null;

    // Destination badge
    const destBadge = this.shadowRoot.getElementById("dest-badge");
    const destText  = this.shadowRoot.getElementById("dest-text");
    if (destState) {
      const dStatus = destState.attributes.status || (destState.state === "on" ? "ok" : "timeout");
      destBadge.className = "dest-badge";
      if (dStatus === "ok")        { destBadge.classList.add("up");   destText.textContent = "UP"; }
      else if (dStatus === "degraded") { destBadge.classList.add("deg"); destText.textContent = "DEGRADED"; }
      else if (dStatus === "timeout")  { destBadge.classList.add("down"); destText.textContent = "DOWN"; }
      else                              { destBadge.classList.add("unk"); destText.textContent = "UNKNOWN"; }
    }

    const rttSensors  = cfg.rtt_sensors  || [];
    const lossSensors = cfg.loss_sensors || [];
    const numHops = rttSensors.length;

    const tbody = this.shadowRoot.getElementById("tbody");
    tbody.innerHTML = "";

    let protoInfo = "";

    for (let i = 0; i < numHops; i++) {
      const rttEntity  = rttSensors[i]  ? hass.states[rttSensors[i]]  : null;
      const lossEntity = lossSensors[i] ? hass.states[lossSensors[i]] : null;

      // Gather attributes (prefer rtt sensor, fallback loss sensor)
      const attrs = (rttEntity || lossEntity || {attributes:{}}).attributes;

      const hopNum    = attrs.hop_number  || (i + 1);
      const ip        = attrs.hop_ip       || null;
      const hostname  = attrs.hop_hostname || null;
      const sent      = attrs.sent         != null ? attrs.sent : "—";
      const loss      = attrs.loss_pct     != null ? parseFloat(attrs.loss_pct)  : null;
      const avg       = attrs.avg_rtt_ms   != null ? parseFloat(attrs.avg_rtt_ms)  : null;
      const min_r     = attrs.min_rtt_ms   != null ? parseFloat(attrs.min_rtt_ms)  : null;
      const max_r     = attrs.max_rtt_ms   != null ? parseFloat(attrs.max_rtt_ms)  : null;
      const last      = attrs.last_rtt_ms  != null ? parseFloat(attrs.last_rtt_ms) : null;
      const jitter    = attrs.jitter_ms    != null ? parseFloat(attrs.jitter_ms)  : null;
      const status    = attrs.status       || "unknown";

      const isLastHop = (i === numHops - 1);
      const sc = this._statusClass(status, loss);

      if (!protoInfo && attrs.protocol) {
        protoInfo = attrs.protocol.toUpperCase();
        if (attrs.port && attrs.protocol !== "icmp") protoInfo += `:${attrs.port}`;
      }

      const noResp = (!ip && (!rttEntity || rttEntity.state === "unavailable"));

      // Bar width for avg RTT
      const barPct = avg != null ? Math.min(100, (avg / RTT_SCALE_MAX) * 100) : 0;

      const tr = document.createElement("tr");
      if (isLastHop) tr.className = "dest-row";

      tr.innerHTML = `
        <td><span class="hop-num${isLastHop ? " dest-hop" : ""}">${hopNum}</span></td>
        <td class="host-cell">
          ${noResp
            ? '<span class="no-resp">* * *</span>'
            : `<div>${hostname || ip || "—"}</div>${hostname && ip ? `<div class="ip-line">${ip}</div>` : ""}`
          }
        </td>
        <td class="right">${loss != null ? loss.toFixed(1)+"%" : "—"}</td>
        <td class="right">${sent}</td>
        <td class="right">${last != null ? last.toFixed(1) : "—"}</td>
        <td class="right">${avg  != null ? avg.toFixed(1)  : "—"}</td>
        <td class="right">${min_r  != null ? min_r.toFixed(1)  : "—"}</td>
        <td class="right">${max_r  != null ? max_r.toFixed(1)  : "—"}</td>
        <td class="right">${jitter != null ? jitter.toFixed(1) : "—"}</td>
        <td>
          <div class="bar-wrap">
            <div class="status-dot ${sc}"></div>
            <div class="bar-bg">
              <div class="bar-fill ${sc}" style="width:${barPct}%"></div>
            </div>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    }

    // Footer
    this.shadowRoot.getElementById("proto-info").textContent = protoInfo || "—";
    const lu = destState
      ? new Date(destState.last_updated).toLocaleTimeString()
      : "—";
    this.shadowRoot.getElementById("updated").textContent = `Updated: ${lu}`;
  }

  getCardSize() {
    return Math.max(3, (this._config?.rtt_sensors?.length || 5) + 2);
  }

  static getStubConfig() {
    return {
      title: "Path to 8.8.8.8",
      destination_entity: "binary_sensor.8_8_8_8_reachable",
      rtt_sensors: ["sensor.8_8_8_8_hop_1_rtt"],
      loss_sensors: ["sensor.8_8_8_8_hop_1_loss"],
    };
  }
}

customElements.define("mtr-traceroute-card", MtrTracerouteCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "mtr-traceroute-card",
  name: "MTR Traceroute Card",
  description: "Shows full hop-by-hop MTR path with RTT bars (full view).",
});
