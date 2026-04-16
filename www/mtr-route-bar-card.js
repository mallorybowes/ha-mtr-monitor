// mtr-route-bar-card.js
// A Home Assistant Lovelace card showing the MTR route as a single
// horizontal segmented bar.  Each segment = one hop; width ∝ RTT;
// colour = traffic-light (green / amber / red / grey).
// Mouseover tooltip shows hop number, IP, hostname and RTT.
//
// Installation:
//   1. Copy to config/www/mtr-route-bar-card.js
//   2. Add as a JavaScript module resource: /local/mtr-route-bar-card.js
//   3. Reload the dashboard page.
//
// Basic YAML:
//   type: custom:mtr-route-bar-card
//   title: "Current Route to Google DNS"
//   rtt_sensors:
//     - sensor.8_8_8_8_hop_1_rtt
//     - sensor.8_8_8_8_hop_2_rtt
//     ...
//   rtt_amber: 50      # ms — below this = green (default 50)
//   rtt_red:   150     # ms — above this = red   (default 150)

// ── guard against double registration ────────────────────────────────────────
if (!window.__mtrRouteBarCardDefined) {
  window.__mtrRouteBarCardDefined = true;

  // ── helpers ──────────────────────────────────────────────────────────────
  const CARD_TYPE = "mtr-route-bar-card";
  const EDITOR_TYPE = "mtr-route-bar-card-editor";

  const DEFAULT_AMBER = 50;
  const DEFAULT_RED   = 150;

  function segmentColor(status, avgRtt, amberMs, redMs) {
    if (!avgRtt || status === "timeout" || status === "no_response") return "#9e9e9e"; // grey
    if (status === "degraded" || avgRtt >= redMs)   return "#f44336"; // red
    if (avgRtt >= amberMs)                           return "#ff9800"; // amber
    return "#4caf50";                                                   // green
  }

  function fmtRtt(v) {
    if (v == null) return "–";
    return Number(v).toFixed(1) + " ms";
  }

  // ── main card ─────────────────────────────────────────────────────────────
  class MtrRouteBarCard extends HTMLElement {
    constructor() {
      super();
      this._config  = {};
      this._hass    = null;
      this._tooltip = null;
    }

    // ── HA lifecycle ────────────────────────────────────────────────────────
    setConfig(config) {
      if (!config.rtt_sensors || !config.rtt_sensors.length) {
        throw new Error("mtr-route-bar-card: rtt_sensors is required.");
      }
      this._config = { ...config };
      if (!this.shadowRoot) this._build();
      if (this._hass) this._render();
    }

    set hass(hass) {
      this._hass = hass;
      if (!this.shadowRoot) return;
      this._render();
    }

    getCardSize()      { return 2; }
    getLayoutOptions() { return { grid_columns: 4, grid_rows: 2, grid_min_columns: 2, grid_min_rows: 1 }; }
    getGridOptions()   { return { columns: 4, rows: 2, min_columns: 2, min_rows: 1 }; }

    static getConfigElement() { return document.createElement(EDITOR_TYPE); }
    getConfigElement()        { return document.createElement(EDITOR_TYPE); }
    static getStubConfig() {
      return {
        title: "Route Monitor",
        rtt_sensors: [],
        rtt_amber: DEFAULT_AMBER,
        rtt_red:   DEFAULT_RED,
      };
    }

    // ── shadow DOM skeleton ─────────────────────────────────────────────────
    _build() {
      const root = this.attachShadow({ mode: "open" });
      root.innerHTML = `
        <style>
          :host { display: block; }
          ha-card {
            padding: 12px 16px 16px;
            box-sizing: border-box;
          }
          .card-header {
            font-size: 1.1em;
            font-weight: 500;
            color: var(--primary-text-color);
            margin-bottom: 10px;
            user-select: none;
          }
          .bar-wrap {
            width: 100%;
            height: 28px;
            display: flex;
            border-radius: 6px;
            overflow: hidden;
            gap: 2px;
            background: var(--divider-color, #333);
          }
          .seg {
            height: 100%;
            min-width: 4px;
            cursor: default;
            transition: filter 0.15s;
            position: relative;
          }
          .seg:hover { filter: brightness(1.25); }
          /* tooltip */
          .tt {
            position: fixed;
            z-index: 9999;
            background: rgba(0,0,0,0.85);
            color: #fff;
            padding: 6px 10px;
            border-radius: 5px;
            font-size: 0.8em;
            pointer-events: none;
            white-space: nowrap;
            line-height: 1.5;
            display: none;
          }
          .empty {
            color: var(--secondary-text-color);
            font-size: 0.85em;
            text-align: center;
            padding: 8px 0;
          }
        </style>
        <ha-card>
          <div class="card-header" id="title"></div>
          <div class="bar-wrap" id="bar"></div>
          <div class="tt" id="tt"></div>
        </ha-card>
      `;

      // tooltip element lives inside shadow root but positioned fixed
      this._tooltip = root.getElementById("tt");
    }

    // ── render ───────────────────────────────────────────────────────────────
    _render() {
      if (!this.shadowRoot || !this._hass) return;
      const root   = this.shadowRoot;
      const cfg    = this._config;
      const hass   = this._hass;
      const amberMs = cfg.rtt_amber ?? DEFAULT_AMBER;
      const redMs   = cfg.rtt_red   ?? DEFAULT_RED;

      root.getElementById("title").textContent = cfg.title || "";

      const sensors = cfg.rtt_sensors || [];
      const bar     = root.getElementById("bar");

      if (!sensors.length) {
        bar.innerHTML = `<div class="empty">No rtt_sensors configured.</div>`;
        return;
      }

      // collect hop data
      const hops = sensors.map((entityId, i) => {
        const state = hass.states[entityId];
        if (!state) return { idx: i + 1, avgRtt: null, status: "unknown", ip: "?", host: "?" };
        const a = state.attributes || {};
        return {
          idx:    (a.hop_number ?? i + 1),
          avgRtt: parseFloat(a.avg_rtt_ms) || null,
          lastRtt:parseFloat(a.last_rtt_ms) || null,
          minRtt: parseFloat(a.min_rtt_ms) || null,
          maxRtt: parseFloat(a.max_rtt_ms) || null,
          jitter: parseFloat(a.jitter_ms)  || null,
          loss:   parseFloat(a.loss_pct)   || 0,
          status: a.status || "unknown",
          ip:     a.hop_ip       || entityId,
          host:   a.hop_hostname || a.hop_ip || entityId,
        };
      });

      // total RTT for proportional widths; fall back to equal widths
      const total = hops.reduce((s, h) => s + (h.avgRtt || 0), 0);
      const useProportional = total > 0;

      // rebuild bar segments
      bar.innerHTML = "";
      const tt = this._tooltip;

      hops.forEach((hop) => {
        const seg = document.createElement("div");
        seg.className = "seg";

        const color = segmentColor(hop.status, hop.avgRtt, amberMs, redMs);
        seg.style.backgroundColor = color;

        if (useProportional && hop.avgRtt) {
          seg.style.flex = `${hop.avgRtt} 1 0`;
        } else {
          seg.style.flex = "1 1 0";
        }

        // tooltip events
        seg.addEventListener("mouseenter", (e) => {
          const lines = [
            `Hop ${hop.idx}`,
            `IP: ${hop.ip}`,
          ];
          if (hop.host && hop.host !== hop.ip) lines.push(`Host: ${hop.host}`);
          lines.push(`Avg RTT: ${fmtRtt(hop.avgRtt)}`);
          if (hop.lastRtt != null) lines.push(`Last:    ${fmtRtt(hop.lastRtt)}`);
          if (hop.minRtt != null)  lines.push(`Min:     ${fmtRtt(hop.minRtt)}`);
          if (hop.maxRtt != null)  lines.push(`Max:     ${fmtRtt(hop.maxRtt)}`);
          if (hop.jitter != null)  lines.push(`Jitter:  ${fmtRtt(hop.jitter)}`);
          lines.push(`Loss: ${hop.loss.toFixed(1)} %`);
          if (hop.status !== "ok") lines.push(`Status: ${hop.status}`);

          tt.innerHTML = lines.join("<br>");
          tt.style.display = "block";
          this._positionTt(e);
        });

        seg.addEventListener("mousemove", (e) => this._positionTt(e));

        seg.addEventListener("mouseleave", () => {
          tt.style.display = "none";
        });

        bar.appendChild(seg);
      });
    }

    _positionTt(e) {
      const tt = this._tooltip;
      const pad = 12;
      let x = e.clientX + pad;
      let y = e.clientY + pad;
      // keep inside viewport
      const tw = tt.offsetWidth  || 200;
      const th = tt.offsetHeight || 80;
      if (x + tw > window.innerWidth  - 4) x = e.clientX - tw - pad;
      if (y + th > window.innerHeight - 4) y = e.clientY - th - pad;
      tt.style.left = x + "px";
      tt.style.top  = y + "px";
    }
  }

  // ── visual editor ──────────────────────────────────────────────────────────
  class MtrRouteBarCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._config = {};
    }

    set hass(h) { this._hass = h; }

    setConfig(config) {
      try {
        this._config = { type: CARD_TYPE, ...config };
        this._renderEditor();
      } catch (e) { console.error(EDITOR_TYPE, e); }
    }

    _fire() {
      this.dispatchEvent(new CustomEvent("config-changed", {
        detail: { config: { ...this._config } },
        bubbles: true,
        composed: true,
      }));
    }

    _renderEditor() {
      const cfg = this._config;
      const root = this.shadowRoot;

      root.innerHTML = `
        <style>
          .row { display: flex; flex-direction: column; margin-bottom: 12px; }
          label { font-size: 0.8em; color: var(--secondary-text-color); margin-bottom: 3px; }
          input[type="text"], input[type="number"] {
            width: 100%;
            box-sizing: border-box;
            background: var(--card-background-color, #1c1c1e);
            color: var(--primary-text-color, #fff);
            border: 1px solid var(--divider-color, #444);
            border-radius: 4px;
            padding: 6px 8px;
            font-size: 0.9em;
          }
          .threshold-row { display: flex; gap: 12px; }
          .threshold-row .row { flex: 1; }
          h4 { margin: 16px 0 6px; font-size: 0.9em; color: var(--primary-text-color); }
          .sensor-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
          .sensor-row { display: flex; align-items: center; gap: 6px; }
          .sensor-row input { flex: 1; }
          .del-btn {
            background: none;
            border: none;
            color: var(--error-color, #f44336);
            cursor: pointer;
            font-size: 1.1em;
            line-height: 1;
            padding: 2px 4px;
          }
          .add-btn {
            background: none;
            border: 1px dashed var(--divider-color, #555);
            border-radius: 4px;
            color: var(--primary-text-color);
            cursor: pointer;
            padding: 4px 10px;
            font-size: 0.85em;
            margin-top: 2px;
          }
        </style>

        <div class="row">
          <label>Title</label>
          <input id="inp-title" type="text" placeholder="Route Monitor">
        </div>

        <div class="threshold-row">
          <div class="row">
            <label>Amber threshold (ms)</label>
            <input id="inp-amber" type="number" min="0" step="1" placeholder="${DEFAULT_AMBER}">
          </div>
          <div class="row">
            <label>Red threshold (ms)</label>
            <input id="inp-red" type="number" min="0" step="1" placeholder="${DEFAULT_RED}">
          </div>
        </div>

        <h4>RTT Sensors</h4>
        <div class="sensor-list" id="rtt-list"></div>
        <button class="add-btn" id="rtt-add">+ Add RTT sensor</button>

        <h4>Loss Sensors <span style="font-weight:normal;font-size:0.9em">(optional)</span></h4>
        <div class="sensor-list" id="loss-list"></div>
        <button class="add-btn" id="loss-add">+ Add loss sensor</button>
      `;

      // set values as JS properties (NOT innerHTML attr)
      root.getElementById("inp-title").value = cfg.title  || "";
      root.getElementById("inp-amber").value = cfg.rtt_amber != null ? cfg.rtt_amber : "";
      root.getElementById("inp-red").value   = cfg.rtt_red   != null ? cfg.rtt_red   : "";

      this._renderSensorList("rtt-list",  cfg.rtt_sensors  || [], "rtt");
      this._renderSensorList("loss-list", cfg.loss_sensors || [], "loss");

      // wire simple fields
      root.getElementById("inp-title").addEventListener("change", (e) => {
        this._config.title = e.target.value;
        this._fire();
      });
      root.getElementById("inp-amber").addEventListener("change", (e) => {
        const v = parseFloat(e.target.value);
        this._config.rtt_amber = isNaN(v) ? DEFAULT_AMBER : v;
        this._fire();
      });
      root.getElementById("inp-red").addEventListener("change", (e) => {
        const v = parseFloat(e.target.value);
        this._config.rtt_red = isNaN(v) ? DEFAULT_RED : v;
        this._fire();
      });

      root.getElementById("rtt-add").addEventListener("click", () => {
        this._config.rtt_sensors = [...(this._config.rtt_sensors || []), ""];
        this._renderSensorList("rtt-list", this._config.rtt_sensors, "rtt");
        this._fire();
      });
      root.getElementById("loss-add").addEventListener("click", () => {
        this._config.loss_sensors = [...(this._config.loss_sensors || []), ""];
        this._renderSensorList("loss-list", this._config.loss_sensors, "loss");
        this._fire();
      });
    }

    _renderSensorList(containerId, sensors, kind) {
      const list = this.shadowRoot.getElementById(containerId);
      if (!list) return;
      list.innerHTML = "";

      sensors.forEach((val, i) => {
        const row = document.createElement("div");
        row.className = "sensor-row";

        const lbl = document.createElement("span");
        lbl.style.cssText = "font-size:0.75em;color:var(--secondary-text-color);min-width:32px";
        lbl.textContent = `${i + 1}.`;

        const inp = document.createElement("input");
        inp.type = "text";
        inp.placeholder = `sensor.example_hop_${i + 1}_${kind}`;
        inp.value = val;   // JS property, not attribute

        inp.addEventListener("change", (e) => {
          const arr = [...(this._config[`${kind}_sensors`] || [])];
          arr[i] = e.target.value.trim();
          this._config[`${kind}_sensors`] = arr;
          this._fire();
        });

        const del = document.createElement("button");
        del.className = "del-btn";
        del.textContent = "×";
        del.title = "Remove";
        del.addEventListener("click", () => {
          const arr = [...(this._config[`${kind}_sensors`] || [])];
          arr.splice(i, 1);
          this._config[`${kind}_sensors`] = arr;
          this._renderSensorList(containerId, arr, kind);
          this._fire();
        });

        row.appendChild(lbl);
        row.appendChild(inp);
        row.appendChild(del);
        list.appendChild(row);
      });
    }
  }

  // ── register ───────────────────────────────────────────────────────────────
  customElements.define(CARD_TYPE,   MtrRouteBarCard);
  customElements.define(EDITOR_TYPE, MtrRouteBarCardEditor);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type:        CARD_TYPE,
    name:        "MTR Route Bar Card",
    description: "Segmented RTT bar — each hop is a coloured segment proportional to its latency.",
    preview:     false,
    documentationURL: "https://github.com/mallorybowes/ha-mtr-monitor",
  });
}
