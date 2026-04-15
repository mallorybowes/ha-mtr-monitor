/**
 * mtr-destination-card.js
 * Lovelace card — Destination status only (simple view).
 *
 * Place this file in:  config/www/mtr-destination-card.js
 *
 * Then in your dashboard resources add:
 *   /local/mtr-destination-card.js  (type: module)
 *
 * Usage:
 *   type: custom:mtr-destination-card
 *   title: "8.8.8.8 Status"
 *   destination_entity: binary_sensor.8_8_8_8_reachable
 *   rtt_entity: sensor.8_8_8_8_hop_X_rtt        # last hop RTT sensor
 *   loss_entity: sensor.8_8_8_8_hop_X_loss       # last hop loss sensor
 */

class MtrDestinationCard extends HTMLElement {
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
          padding: 16px;
          background: var(--card-background-color);
        }
        .header {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 14px;
        }
        .title {
          font-size: 1rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          color: var(--primary-text-color);
        }
        .badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 12px;
          font-size: 0.72rem;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
        }
        .badge.up   { background: #1b5e2022; color: #43a047; border: 1px solid #43a047; }
        .badge.down { background: #b71c1c22; color: #ef5350; border: 1px solid #ef5350; }
        .badge.deg  { background: #e65100aa; color: #ff9800; border: 1px solid #ff9800; }
        .badge.unk  { background: #37474f22; color: #90a4ae; border: 1px solid #546e7a; }
        .metrics {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
          gap: 10px;
        }
        .metric {
          background: var(--secondary-background-color);
          border-radius: 8px;
          padding: 10px 12px;
          text-align: center;
        }
        .metric .val {
          font-size: 1.35rem;
          font-weight: 700;
          color: var(--primary-text-color);
        }
        .metric .lbl {
          font-size: 0.65rem;
          color: var(--secondary-text-color);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-top: 2px;
        }
        .proto-badge {
          font-size: 0.65rem;
          padding: 2px 7px;
          border-radius: 4px;
          background: var(--secondary-background-color);
          color: var(--secondary-text-color);
          border: 1px solid var(--divider-color);
          letter-spacing: 0.08em;
        }
        .meta {
          margin-top: 10px;
          font-size: 0.7rem;
          color: var(--secondary-text-color);
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
      </style>
      <ha-card>
        <div class="header">
          <span class="title" id="title">—</span>
          <span class="badge unk" id="badge">UNKNOWN</span>
          <span class="proto-badge" id="proto">—</span>
        </div>
        <div class="metrics">
          <div class="metric"><div class="val" id="rtt">—</div><div class="lbl">Avg RTT</div></div>
          <div class="metric"><div class="val" id="loss">—</div><div class="lbl">Loss</div></div>
          <div class="metric"><div class="val" id="jitter">—</div><div class="lbl">Jitter</div></div>
          <div class="metric"><div class="val" id="hops">—</div><div class="lbl">Hops</div></div>
        </div>
        <div class="meta">
          <span id="ip">—</span>
          <span id="updated">—</span>
        </div>
      </ha-card>
    `;
    this.content = this.shadowRoot.querySelector("ha-card");
  }

  _render() {
    const cfg = this._config;
    const hass = this._hass;

    const destState = hass.states[cfg.destination_entity];
    const rttState = cfg.rtt_entity ? hass.states[cfg.rtt_entity] : null;
    const lossState = cfg.loss_entity ? hass.states[cfg.loss_entity] : null;

    // Title
    this.shadowRoot.getElementById("title").textContent =
      cfg.title || (destState ? destState.attributes.friendly_name : "Destination");

    if (!destState) return;

    const attrs = destState.attributes;
    const isOn = destState.state === "on";
    const status = attrs.status || (isOn ? "ok" : "timeout");

    // Badge
    const badge = this.shadowRoot.getElementById("badge");
    badge.className = "badge";
    if (status === "ok")        { badge.classList.add("up");   badge.textContent = "UP"; }
    else if (status === "degraded") { badge.classList.add("deg"); badge.textContent = "DEGRADED"; }
    else if (status === "timeout")  { badge.classList.add("down"); badge.textContent = "DOWN"; }
    else                             { badge.classList.add("unk"); badge.textContent = "UNKNOWN"; }

    // Protocol
    let protoText = (attrs.protocol || "").toUpperCase();
    if (attrs.port && attrs.protocol !== "icmp") protoText += `:${attrs.port}`;
    this.shadowRoot.getElementById("proto").textContent = protoText;

    // Metrics
    const rtt = rttState ? parseFloat(rttState.state) : parseFloat(attrs.avg_rtt_ms);
    const loss = lossState ? parseFloat(lossState.state) : parseFloat(attrs.loss_pct);
    const jitter = parseFloat(attrs.jitter_ms);
    const hops = attrs.total_hops;

    this.shadowRoot.getElementById("rtt").textContent    = isNaN(rtt)    ? "—" : `${rtt.toFixed(1)} ms`;
    this.shadowRoot.getElementById("loss").textContent   = isNaN(loss)   ? "—" : `${loss.toFixed(1)}%`;
    this.shadowRoot.getElementById("jitter").textContent = isNaN(jitter) ? "—" : `${jitter.toFixed(1)} ms`;
    this.shadowRoot.getElementById("hops").textContent   = hops != null  ? hops : "—";

    // Meta
    this.shadowRoot.getElementById("ip").textContent = attrs.hop_ip || attrs.hop_hostname || "—";
    const lu = destState.last_updated ? new Date(destState.last_updated).toLocaleTimeString() : "—";
    this.shadowRoot.getElementById("updated").textContent = `Updated: ${lu}`;
  }

  getCardSize() { return 3; }

  static getConfigElement() {
    return document.createElement("mtr-destination-card-editor");
  }

  static getStubConfig() {
    return {
      title: "Destination Status",
      destination_entity: "binary_sensor.example_reachable",
    };
  }
}

customElements.define("mtr-destination-card", MtrDestinationCard);
window.customCards = window.customCards || [];
window.customCards.push({
  type: "mtr-destination-card",
  name: "MTR Destination Card",
  description: "Shows destination reachability status (simple view).",
});
