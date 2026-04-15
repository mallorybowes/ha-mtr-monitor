/**
 * mtr-trafficlight-card.js
 * Lovelace card — Traffic-light destination status + per-hop indicator rows.
 *
 * Place this file in:  config/www/mtr-trafficlight-card.js
 *
 * Then in your dashboard resources add:
 *   /local/mtr-trafficlight-card.js  (type: module)
 *
 * Usage:
 *   type: custom:mtr-trafficlight-card
 *   title: "8.8.8.8"
 *   destination_entity: binary_sensor.8_8_8_8_reachable
 *   rtt_entity: sensor.8_8_8_8_hop_8_rtt       # last-hop RTT sensor (for dest metrics)
 *   loss_entity: sensor.8_8_8_8_hop_8_loss      # last-hop loss sensor (for dest metrics)
 *   rtt_sensors:                                 # one per hop, in order
 *     - sensor.8_8_8_8_hop_1_rtt
 *     - sensor.8_8_8_8_hop_2_rtt
 *   loss_sensors:                                # optional but recommended
 *     - sensor.8_8_8_8_hop_1_loss
 *     - sensor.8_8_8_8_hop_2_loss
 */

class MtrTrafficLightCard extends HTMLElement {
  set hass(hass) {
    if (!this.content) this._build();
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.destination_entity) throw new Error("destination_entity required");
    this._config = config;
  }

  _build() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          font-family: 'Courier New', monospace;
          background: var(--card-background-color);
          overflow: hidden;
        }

        /* ── Card header ───────────────────────────────────────── */
        .card-header {
          padding: 14px 16px 0;
          font-size: 0.95rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--primary-text-color);
        }

        /* ── Destination section ───────────────────────────────── */
        .dest-section {
          display: flex;
          align-items: center;
          gap: 20px;
          padding: 16px 20px 14px;
        }

        /* Traffic light housing */
        .traffic-light {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 7px;
          background: #1c1c1c;
          border-radius: 18px;
          padding: 12px 10px;
          border: 2px solid #3a3a3a;
          box-shadow: inset 0 2px 6px rgba(0,0,0,0.5);
          flex-shrink: 0;
        }
        .tl-light {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          transition: background 0.3s ease, box-shadow 0.3s ease;
        }
        /* Dim (off) states */
        .tl-light.red-off    { background: #4a1010; box-shadow: inset 0 1px 3px rgba(0,0,0,0.6); }
        .tl-light.yellow-off { background: #4a3500; box-shadow: inset 0 1px 3px rgba(0,0,0,0.6); }
        .tl-light.green-off  { background: #0d3d0d; box-shadow: inset 0 1px 3px rgba(0,0,0,0.6); }
        /* Lit states */
        .tl-light.red-on    { background: #ef5350; box-shadow: 0 0 14px 5px rgba(239,83,80,0.55), inset 0 1px 2px rgba(255,255,255,0.2); }
        .tl-light.yellow-on { background: #ffb300; box-shadow: 0 0 14px 5px rgba(255,179,0,0.55),  inset 0 1px 2px rgba(255,255,255,0.2); }
        .tl-light.green-on  { background: #43a047; box-shadow: 0 0 14px 5px rgba(67,160,71,0.55),  inset 0 1px 2px rgba(255,255,255,0.2); }

        /* Destination info alongside the light */
        .dest-info {
          flex: 1;
          min-width: 0;
        }
        .dest-name {
          font-size: 1.05rem;
          font-weight: 700;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin-bottom: 4px;
        }
        .dest-status-label {
          font-size: 0.8rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          margin-bottom: 10px;
        }
        .dest-status-label.up   { color: #43a047; }
        .dest-status-label.deg  { color: #ffb300; }
        .dest-status-label.down { color: #ef5350; }
        .dest-status-label.unk  { color: #78909c; }

        .dest-metrics {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
        }
        .metric-chip {
          background: var(--secondary-background-color);
          border-radius: 6px;
          padding: 5px 10px;
          text-align: center;
          min-width: 64px;
        }
        .metric-chip .val {
          font-size: 1rem;
          font-weight: 700;
          color: var(--primary-text-color);
        }
        .metric-chip .lbl {
          font-size: 0.6rem;
          color: var(--secondary-text-color);
          letter-spacing: 0.09em;
          text-transform: uppercase;
          margin-top: 1px;
        }

        /* ── Divider ───────────────────────────────────────────── */
        .divider {
          border: none;
          border-top: 1px solid var(--divider-color);
          margin: 0 16px;
        }

        /* ── Hop list ──────────────────────────────────────────── */
        .hop-list {
          padding: 8px 0 4px;
        }
        .hop-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 5px 16px;
          transition: background 0.15s;
          min-height: 36px;
        }
        .hop-row:hover { background: var(--secondary-background-color); }
        .hop-row.dest-hop { background: var(--secondary-background-color); }

        /* Per-hop traffic light indicator (single dot, traffic-light colours) */
        .hop-indicator {
          width: 16px;
          height: 16px;
          border-radius: 50%;
          flex-shrink: 0;
          transition: background 0.3s, box-shadow 0.3s;
        }
        .hop-indicator.ok  {
          background: #43a047;
          box-shadow: 0 0 7px 2px rgba(67,160,71,0.5);
        }
        .hop-indicator.deg {
          background: #ffb300;
          box-shadow: 0 0 7px 2px rgba(255,179,0,0.5);
        }
        .hop-indicator.bad {
          background: #ef5350;
          box-shadow: 0 0 7px 2px rgba(239,83,80,0.5);
        }
        .hop-indicator.unk {
          background: #546e7a;
          box-shadow: none;
        }

        .hop-num {
          font-size: 0.7rem;
          color: var(--secondary-text-color);
          width: 18px;
          text-align: right;
          flex-shrink: 0;
        }
        .hop-num.dest { color: #42a5f5; font-weight: 700; }

        .hop-host {
          flex: 1;
          min-width: 0;
          overflow: hidden;
        }
        .hop-hostname {
          font-size: 0.78rem;
          color: var(--primary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hop-hostname.no-resp {
          color: var(--disabled-text-color);
          font-style: italic;
        }
        .hop-ip {
          font-size: 0.65rem;
          color: var(--secondary-text-color);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .hop-rtt {
          font-size: 0.75rem;
          color: var(--primary-text-color);
          text-align: right;
          white-space: nowrap;
          flex-shrink: 0;
          min-width: 58px;
        }
        .hop-loss {
          font-size: 0.75rem;
          text-align: right;
          white-space: nowrap;
          flex-shrink: 0;
          min-width: 42px;
        }
        .hop-loss.loss-ok  { color: var(--secondary-text-color); }
        .hop-loss.loss-deg { color: #ffb300; }
        .hop-loss.loss-bad { color: #ef5350; }

        /* ── Footer ────────────────────────────────────────────── */
        .footer {
          padding: 6px 16px 10px;
          font-size: 0.65rem;
          color: var(--secondary-text-color);
          display: flex;
          justify-content: space-between;
          border-top: 1px solid var(--divider-color);
          margin-top: 4px;
        }
      </style>
      <ha-card>
        <div class="card-header" id="card-header"></div>

        <div class="dest-section">
          <div class="traffic-light" id="traffic-light">
            <div class="tl-light red-off"    id="tl-red"></div>
            <div class="tl-light yellow-off" id="tl-yellow"></div>
            <div class="tl-light green-off"  id="tl-green"></div>
          </div>
          <div class="dest-info">
            <div class="dest-name"         id="dest-name">—</div>
            <div class="dest-status-label unk" id="dest-status">UNKNOWN</div>
            <div class="dest-metrics">
              <div class="metric-chip"><div class="val" id="dest-rtt">—</div><div class="lbl">Avg RTT</div></div>
              <div class="metric-chip"><div class="val" id="dest-loss">—</div><div class="lbl">Loss</div></div>
              <div class="metric-chip"><div class="val" id="dest-hops">—</div><div class="lbl">Hops</div></div>
            </div>
          </div>
        </div>

        <hr class="divider">

        <div class="hop-list" id="hop-list"></div>

        <div class="footer">
          <span id="proto-info">—</span>
          <span id="updated">—</span>
        </div>
      </ha-card>
    `;
    this.content = this.shadowRoot.querySelector("ha-card");
  }

  // Returns { sc: "ok"|"deg"|"bad"|"unk", lossClass: "loss-ok"|"loss-deg"|"loss-bad" }
  _classify(status, lossPct) {
    let sc;
    if (status === "ok")                      sc = "ok";
    else if (status === "degraded")           sc = "deg";
    else if (status === "timeout" || lossPct >= 100) sc = "bad";
    else                                      sc = "unk";

    let lossClass = "loss-ok";
    if (lossPct != null) {
      if (lossPct >= 50)      lossClass = "loss-bad";
      else if (lossPct >= 10) lossClass = "loss-deg";
    }
    return { sc, lossClass };
  }

  _render() {
    const cfg  = this._config;
    const hass = this._hass;

    // Card header
    this.shadowRoot.getElementById("card-header").textContent = cfg.title || "MTR Traffic Light";

    // ── Destination ─────────────────────────────────────────────
    const destState = hass.states[cfg.destination_entity];
    const rttState  = cfg.rtt_entity  ? hass.states[cfg.rtt_entity]  : null;
    const lossState = cfg.loss_entity ? hass.states[cfg.loss_entity] : null;

    const destAttrs = destState ? destState.attributes : {};
    const dStatus   = destAttrs.status || (destState && destState.state === "on" ? "ok" : "timeout");

    // Destination label
    this.shadowRoot.getElementById("dest-name").textContent =
      cfg.title || destAttrs.friendly_name || cfg.destination_entity;

    // Traffic light bulbs
    const tlRed    = this.shadowRoot.getElementById("tl-red");
    const tlYellow = this.shadowRoot.getElementById("tl-yellow");
    const tlGreen  = this.shadowRoot.getElementById("tl-green");

    tlRed.className    = "tl-light red-off";
    tlYellow.className = "tl-light yellow-off";
    tlGreen.className  = "tl-light green-off";

    const statusEl = this.shadowRoot.getElementById("dest-status");
    statusEl.className = "dest-status-label";

    if (dStatus === "ok") {
      tlGreen.className = "tl-light green-on";
      statusEl.classList.add("up");
      statusEl.textContent = "UP";
    } else if (dStatus === "degraded") {
      tlYellow.className = "tl-light yellow-on";
      statusEl.classList.add("deg");
      statusEl.textContent = "DEGRADED";
    } else if (dStatus === "timeout") {
      tlRed.className = "tl-light red-on";
      statusEl.classList.add("down");
      statusEl.textContent = "DOWN";
    } else {
      statusEl.classList.add("unk");
      statusEl.textContent = "UNKNOWN";
    }

    // Destination metrics
    const dRtt  = rttState  ? parseFloat(rttState.state)   : parseFloat(destAttrs.avg_rtt_ms);
    const dLoss = lossState ? parseFloat(lossState.state)  : parseFloat(destAttrs.loss_pct);
    this.shadowRoot.getElementById("dest-rtt").textContent  = isNaN(dRtt)  ? "—" : `${dRtt.toFixed(1)} ms`;
    this.shadowRoot.getElementById("dest-loss").textContent = isNaN(dLoss) ? "—" : `${dLoss.toFixed(1)}%`;
    this.shadowRoot.getElementById("dest-hops").textContent = destAttrs.total_hops ?? "—";

    // ── Hop rows ─────────────────────────────────────────────────
    const rttSensors  = cfg.rtt_sensors  || [];
    const lossSensors = cfg.loss_sensors || [];
    const numHops = rttSensors.length;

    const hopList = this.shadowRoot.getElementById("hop-list");
    hopList.innerHTML = "";

    let protoInfo = "";

    for (let i = 0; i < numHops; i++) {
      const rttEntity  = rttSensors[i]  ? hass.states[rttSensors[i]]  : null;
      const lossEntity = lossSensors[i] ? hass.states[lossSensors[i]] : null;

      const attrs   = (rttEntity || lossEntity || { attributes: {} }).attributes;
      const hopNum  = attrs.hop_number || (i + 1);
      const ip      = attrs.hop_ip       || null;
      const hostname= attrs.hop_hostname || null;
      const avg     = attrs.avg_rtt_ms != null ? parseFloat(attrs.avg_rtt_ms) : null;
      const loss    = attrs.loss_pct   != null ? parseFloat(attrs.loss_pct)  : null;
      const status  = attrs.status || "unknown";
      const isLast  = (i === numHops - 1);
      const noResp  = !ip && (!rttEntity || rttEntity.state === "unavailable");

      if (!protoInfo && attrs.protocol) {
        protoInfo = attrs.protocol.toUpperCase();
        if (attrs.port && attrs.protocol !== "icmp") protoInfo += `:${attrs.port}`;
      }

      const { sc, lossClass } = this._classify(status, loss);

      // Host display: prefer hostname, show ip as secondary if both exist
      let hostPrimary, hostSecondary;
      if (noResp) {
        hostPrimary = null;
      } else if (hostname && ip && hostname !== ip) {
        hostPrimary   = hostname;
        hostSecondary = ip;
      } else {
        hostPrimary   = hostname || ip || "—";
        hostSecondary = null;
      }

      const row = document.createElement("div");
      row.className = `hop-row${isLast ? " dest-hop" : ""}`;

      row.innerHTML = `
        <div class="hop-indicator ${noResp ? "unk" : sc}"></div>
        <div class="hop-num${isLast ? " dest" : ""}">${hopNum}</div>
        <div class="hop-host">
          ${noResp
            ? `<div class="hop-hostname no-resp">* * *</div>`
            : `<div class="hop-hostname">${hostPrimary}</div>${hostSecondary ? `<div class="hop-ip">${hostSecondary}</div>` : ""}`
          }
        </div>
        <div class="hop-rtt">${avg != null ? avg.toFixed(1) + " ms" : "—"}</div>
        <div class="hop-loss ${noResp ? "loss-ok" : lossClass}">${loss != null ? loss.toFixed(1) + "%" : "—"}</div>
      `;
      hopList.appendChild(row);
    }

    // ── Footer ────────────────────────────────────────────────────
    this.shadowRoot.getElementById("proto-info").textContent = protoInfo || "—";
    const lu = destState
      ? new Date(destState.last_updated).toLocaleTimeString()
      : "—";
    this.shadowRoot.getElementById("updated").textContent = `Updated: ${lu}`;
  }

  getCardSize() {
    return Math.max(4, (this._config?.rtt_sensors?.length || 5) + 3);
  }

  static getStubConfig() {
    return {
      title: "8.8.8.8",
      destination_entity: "binary_sensor.8_8_8_8_reachable",
      rtt_entity:  "sensor.8_8_8_8_hop_8_rtt",
      loss_entity: "sensor.8_8_8_8_hop_8_loss",
      rtt_sensors:  ["sensor.8_8_8_8_hop_1_rtt",  "sensor.8_8_8_8_hop_2_rtt"],
      loss_sensors: ["sensor.8_8_8_8_hop_1_loss", "sensor.8_8_8_8_hop_2_loss"],
    };
  }
}

customElements.define("mtr-trafficlight-card", MtrTrafficLightCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "mtr-trafficlight-card",
  name: "MTR Traffic Light Card",
  description: "Traffic-light destination status with per-hop indicator rows.",
});
