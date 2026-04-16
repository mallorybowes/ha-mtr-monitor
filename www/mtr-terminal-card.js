/**
 * mtr-terminal-card.js
 * Lovelace card — MTR-style terminal display.
 *
 * Replicates the classic `mtr` TUI layout: dark terminal background,
 * monospace columns (Host · Loss% · Snt · Last · Avg · Best · Wrst · StDev),
 * with full-row colour coding that updates live after every probe.
 *
 * Row colours:
 *   Green  — ok, low loss, normal RTT
 *   Amber  — degraded, or RTT exceeds amber threshold
 *   Red    — down / 100 % loss / RTT exceeds red threshold
 *   Grey   — no response (* * *)
 *
 * Click any row to open a 2-hour history popup for that hop.
 *
 * Place this file in:  config/www/mtr-terminal-card.js
 *
 * Register resource:
 *   URL: /local/mtr-terminal-card.js   Type: JavaScript module
 *
 * Usage:
 *   type: custom:mtr-terminal-card
 *   title: "Path to 8.8.8.8"
 *   destination_entity: binary_sensor.8_8_8_8_reachable   # optional
 *   columns: 12                                            # grid width 1-12, default 4
 *   rtt_sensors:
 *     - sensor.8_8_8_8_hop_1_rtt
 *     - ...
 *   loss_sensors:                                          # optional but recommended
 *     - sensor.8_8_8_8_hop_1_loss
 *     - ...
 *
 * Optional thresholds (override defaults):
 *   loss_amber: 10        # % loss  → amber  (default 10)
 *   loss_red:   50        # % loss  → red    (default 50)
 *   rtt_amber:  150       # ms avg  → amber  (default 150)
 *   rtt_red:    400       # ms avg  → red    (default 400)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Main card
// ─────────────────────────────────────────────────────────────────────────────

class MtrTerminalCard extends HTMLElement {
  set hass(hass) {
    if (!this.shadowRoot) this._build();
    this._hass = hass;
    this._render();
  }

  setConfig(config) {
    if (!config.rtt_sensors || !Array.isArray(config.rtt_sensors)) {
      throw new Error("rtt_sensors (array) required");
    }
    this._config = config;
  }

  // HA 2023.x grid sizing (masonry / sections).
  getLayoutOptions() {
    const cols = Math.min(12, Math.max(1, this._config?.columns ?? 4));
    const rows = Math.max(2, (this._config?.rtt_sensors?.length ?? 5) + 3);
    return { grid_columns: cols, grid_rows: rows, grid_min_columns: 2, grid_min_rows: 2 };
  }

  // HA 2024.x grid sizing (sections view).
  getGridOptions() {
    const cols = Math.min(12, Math.max(1, this._config?.columns ?? 4));
    const rows = Math.max(2, (this._config?.rtt_sensors?.length ?? 5) + 3);
    return { columns: cols, rows, min_columns: 2, min_rows: 2 };
  }

  // Legacy masonry height hint.
  getCardSize() {
    return Math.max(4, (this._config?.rtt_sensors?.length || 5) + 3);
  }

  // Both static (called by HA on the class) and instance (called by some HA versions on the element).
  static getConfigElement() { return document.createElement("mtr-terminal-card-editor"); }
  getConfigElement()        { return document.createElement("mtr-terminal-card-editor"); }

  static getStubConfig() {
    return {
      title: "My traceroute",
      columns: 8,
      destination_entity: "",
      rtt_sensors:  ["sensor.8_8_8_8_hop_1_rtt",  "sensor.8_8_8_8_hop_2_rtt"],
      loss_sensors: ["sensor.8_8_8_8_hop_1_loss", "sensor.8_8_8_8_hop_2_loss"],
    };
  }

  _build() {
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 8px;
          overflow: hidden;
          font-family: 'Courier New', 'Lucida Console', monospace;
        }

        /* ── Title bar ─────────────────────────────────────────── */
        .term-titlebar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 7px 12px;
          background: #161b22;
          border-bottom: 1px solid #30363d;
        }
        .term-dots { display: flex; gap: 6px; align-items: center; }
        .term-dot  { width: 11px; height: 11px; border-radius: 50%; }
        .term-dot.red    { background: #ff5f56; }
        .term-dot.yellow { background: #ffbd2e; }
        .term-dot.green  { background: #27c93f; }
        .term-title {
          font-size: 0.75rem; color: #8b949e; letter-spacing: 0.05em;
          flex: 1; text-align: center;
        }
        .term-badge {
          font-size: 0.65rem; letter-spacing: 0.08em;
          padding: 2px 8px; border-radius: 4px; font-weight: 700;
        }
        .term-badge.up   { color: #3fb950; border: 1px solid #3fb950; }
        .term-badge.down { color: #f85149; border: 1px solid #f85149; }
        .term-badge.deg  { color: #d29922; border: 1px solid #d29922; }
        .term-badge.unk  { color: #8b949e; border: 1px solid #30363d; }

        /* ── Column header ─────────────────────────────────────── */
        .mtr-header {
          display: grid; padding: 5px 10px 4px;
          border-bottom: 1px solid #21262d;
          font-size: 0.68rem; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: #8b949e;
        }
        .col-host {
          text-align: left; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; padding-right: 8px;
        }
        .col-num { text-align: right; white-space: nowrap; padding-left: 4px; }

        /* ── Data rows ─────────────────────────────────────────── */
        .mtr-row {
          display: grid; padding: 4px 10px;
          font-size: 0.73rem; cursor: pointer;
          transition: background 0.15s;
          border-bottom: 1px solid transparent;
        }
        .mtr-row:last-child { border-bottom: none; }
        .mtr-row:hover  { background: #1c2128; }
        .mtr-row:active { background: #21262d; }

        .mtr-row.ok  { color: #3fb950; }
        .mtr-row.deg { color: #d29922; }
        .mtr-row.bad { color: #f85149; }
        .mtr-row.unk { color: #484f58; }
        .mtr-row.dest { font-weight: 700; border-top: 1px solid #21262d; }

        .mtr-row.ok  .col-num { color: #2ea043; }
        .mtr-row.deg .col-num { color: #b68800; }
        .mtr-row.bad .col-num { color: #da3633; }
        .mtr-row.unk .col-num { color: #30363d; }

        .hop-idx {
          display: inline-block; width: 1.6em; text-align: right;
          margin-right: 4px; color: #484f58; font-size: 0.68rem;
        }
        .mtr-row.dest .hop-idx { color: #388bfd; }
        .no-resp { font-style: italic; }
        .loss-warn { color: #d29922 !important; }
        .loss-crit { color: #f85149 !important; }

        /* ── Footer ────────────────────────────────────────────── */
        .term-footer {
          display: flex; justify-content: space-between;
          padding: 5px 10px 7px;
          border-top: 1px solid #21262d;
          font-size: 0.62rem; color: #484f58; letter-spacing: 0.05em;
        }
      </style>
      <ha-card>
        <div class="term-titlebar">
          <div class="term-dots">
            <div class="term-dot red"></div>
            <div class="term-dot yellow"></div>
            <div class="term-dot green"></div>
          </div>
          <div class="term-title" id="term-title">My traceroute</div>
          <div class="term-badge unk" id="dest-badge">—</div>
        </div>
        <div class="mtr-header" id="mtr-header">
          <div class="col-host">Host</div>
          <div class="col-num">Loss%</div>
          <div class="col-num">Snt</div>
          <div class="col-num">Last</div>
          <div class="col-num">Avg</div>
          <div class="col-num">Best</div>
          <div class="col-num">Wrst</div>
          <div class="col-num">StDev</div>
        </div>
        <div id="mtr-body"></div>
        <div class="term-footer">
          <span id="proto-info">—</span>
          <span id="updated">—</span>
        </div>
      </ha-card>
    `;
    this._colDef = "1fr 4.5em 3.5em 5em 5em 5em 5em 5em";
    this.shadowRoot.getElementById("mtr-header").style.gridTemplateColumns = this._colDef;
  }

  _rowClass(status, lossPct, avgRtt, cfg) {
    const lossAmber = cfg.loss_amber ?? 10;
    const lossRed   = cfg.loss_red   ?? 50;
    const rttAmber  = cfg.rtt_amber  ?? 150;
    const rttRed    = cfg.rtt_red    ?? 400;
    if (status === "timeout"  || lossPct >= lossRed   || avgRtt >= rttRed)   return "bad";
    if (status === "degraded" || lossPct >= lossAmber || avgRtt >= rttAmber) return "deg";
    return "ok";
  }

  _render() {
    try { this._doRender(); }
    catch (e) { console.error("[mtr-terminal-card] render error:", e); }
  }

  _doRender() {
    const cfg  = this._config;
    const hass = this._hass;

    this.shadowRoot.getElementById("term-title").textContent = cfg.title || "My traceroute";

    // Destination badge
    const destState = cfg.destination_entity ? hass.states[cfg.destination_entity] : null;
    const badge = this.shadowRoot.getElementById("dest-badge");
    if (destState) {
      const dStatus = destState.attributes.status ||
        (destState.state === "on" ? "ok" : "timeout");
      badge.className = "term-badge";
      if      (dStatus === "ok")       { badge.classList.add("up");   badge.textContent = "UP"; }
      else if (dStatus === "degraded") { badge.classList.add("deg");  badge.textContent = "DEGRADED"; }
      else if (dStatus === "timeout")  { badge.classList.add("down"); badge.textContent = "DOWN"; }
      else                             { badge.classList.add("unk");  badge.textContent = "UNKNOWN"; }
    } else {
      badge.className = "term-badge unk";
      badge.textContent = "—";
    }

    const rttSensors  = cfg.rtt_sensors  || [];
    const lossSensors = cfg.loss_sensors || [];
    const numHops     = rttSensors.length;
    const body        = this.shadowRoot.getElementById("mtr-body");
    body.innerHTML    = "";
    let protoInfo     = "";

    for (let i = 0; i < numHops; i++) {
      const rttEntity  = rttSensors[i]  ? hass.states[rttSensors[i]]  : null;
      const lossEntity = lossSensors[i] ? hass.states[lossSensors[i]] : null;
      const attrs      = (rttEntity || lossEntity || { attributes: {} }).attributes;

      const hopNum   = attrs.hop_number   ?? (i + 1);
      const ip       = attrs.hop_ip       ?? null;
      const hostname = attrs.hop_hostname ?? null;
      const sent     = attrs.sent         ?? "—";
      const loss     = attrs.loss_pct    != null ? parseFloat(attrs.loss_pct)    : null;
      const avg      = attrs.avg_rtt_ms  != null ? parseFloat(attrs.avg_rtt_ms)  : null;
      const best     = attrs.min_rtt_ms  != null ? parseFloat(attrs.min_rtt_ms)  : null;
      const wrst     = attrs.max_rtt_ms  != null ? parseFloat(attrs.max_rtt_ms)  : null;
      const last     = attrs.last_rtt_ms != null ? parseFloat(attrs.last_rtt_ms) : null;
      const stddev   = attrs.jitter_ms   != null ? parseFloat(attrs.jitter_ms)   : null;
      const status   = attrs.status      ?? "unknown";
      const isLast   = (i === numHops - 1);

      const noResp = !ip && !hostname &&
        (!rttEntity || ["unavailable", "unknown", "none"].includes(rttEntity.state));

      if (!protoInfo && attrs.protocol) {
        protoInfo = attrs.protocol.toUpperCase();
        if (attrs.port && attrs.protocol !== "icmp") protoInfo += `:${attrs.port}`;
      }

      const rc = noResp ? "unk" : this._rowClass(status, loss ?? 0, avg ?? 0, cfg);

      const hostText = noResp
        ? `<span class="no-resp">(waiting for reply)</span>`
        : (hostname && hostname !== ip ? hostname : (ip || "—"));

      let lossCell = "—";
      if (loss != null) {
        const lossStr   = loss.toFixed(1) + "%";
        const lossAmber = cfg.loss_amber ?? 10;
        const lossRed   = cfg.loss_red   ?? 50;
        if      (loss >= lossRed)   lossCell = `<span class="loss-crit">${lossStr}</span>`;
        else if (loss >= lossAmber) lossCell = `<span class="loss-warn">${lossStr}</span>`;
        else                        lossCell = lossStr;
      }

      const row = document.createElement("div");
      row.className = `mtr-row ${rc}${isLast ? " dest" : ""}`;
      row.style.gridTemplateColumns = this._colDef;
      row.innerHTML = `
        <div class="col-host"><span class="hop-idx">${hopNum}.</span>${hostText}</div>
        <div class="col-num">${lossCell}</div>
        <div class="col-num">${sent}</div>
        <div class="col-num">${last   != null ? last.toFixed(1)   : "—"}</div>
        <div class="col-num">${avg    != null ? avg.toFixed(1)    : "—"}</div>
        <div class="col-num">${best   != null ? best.toFixed(1)   : "—"}</div>
        <div class="col-num">${wrst   != null ? wrst.toFixed(1)   : "—"}</div>
        <div class="col-num">${stddev != null ? stddev.toFixed(1) : "—"}</div>
      `;

      // Capture loop variable for the click closure.
      const hopIdx = i;
      row.addEventListener("click", () => this._showHopDetail(hopIdx));

      body.appendChild(row);
    }

    this.shadowRoot.getElementById("proto-info").textContent = protoInfo || "—";
    const lu = destState
      ? new Date(destState.last_updated).toLocaleTimeString()
      : (rttSensors[0] && hass.states[rttSensors[0]]
          ? new Date(hass.states[rttSensors[0]].last_updated).toLocaleTimeString()
          : "—");
    this.shadowRoot.getElementById("updated").textContent = `Updated: ${lu}`;
  }

  // ── Detail popup ──────────────────────────────────────────────────────────

  _showHopDetail(hopIdx) {
    const cfg  = this._config;
    const hass = this._hass;

    const rttId  = cfg.rtt_sensors?.[hopIdx];
    const lossId = cfg.loss_sensors?.[hopIdx];
    if (!rttId) return;

    const attrs   = hass.states[rttId]?.attributes ?? {};
    const hopNum  = attrs.hop_number   ?? (hopIdx + 1);
    const ip      = attrs.hop_ip       ?? "";
    const hostname = attrs.hop_hostname ?? "";
    const label   = hostname && hostname !== ip
      ? `${hostname} (${ip})`
      : (ip || rttId);
    const popupTitle = `Hop ${hopNum} — ${label}`;

    this._showGraphPopup(popupTitle, rttId, lossId, hass);
  }

  async _showGraphPopup(title, rttId, lossId, hass) {
    this._closePopup();

    // Build entity list for the history card.
    const entities = [{ entity: rttId }];
    if (lossId) entities.push({ entity: lossId });

    let card;

    // Try HA's card helper factory first.
    if (typeof window.loadCardHelpers === "function") {
      try {
        const helpers = await window.loadCardHelpers();
        // createCardElement is synchronous in HA; await handles both cases.
        card = helpers.createCardElement({
          type: "history-graph",
          title: title,
          entities,
          hours_to_show: 2,
        });
        card.hass = hass;
      } catch (e) {
        console.warn("[mtr-terminal-card] loadCardHelpers failed, falling back to more-info:", e);
        card = null;
      }
    }

    // If card creation failed, fall back to HA's native more-info dialog.
    if (!card) {
      this.dispatchEvent(new CustomEvent("hass-more-info", {
        detail: { entityId: rttId },
        bubbles: true,
        composed: true,
      }));
      return;
    }

    // ── Overlay styles appended to <head> (outside shadow DOM) ────────────
    const style = document.createElement("style");
    style.id = "mtr-popup-style";
    style.textContent = `
      #mtr-popup-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.72);
        z-index: 9999;
        display: flex; align-items: center; justify-content: center;
        padding: 16px;
        animation: mtr-fade-in 0.15s ease;
      }
      @keyframes mtr-fade-in { from { opacity:0 } to { opacity:1 } }

      #mtr-popup-dialog {
        background: var(--card-background-color, #1c1c1e);
        border-radius: 14px;
        width: min(700px, 96vw);
        max-height: 88vh;
        display: flex; flex-direction: column;
        box-shadow: 0 20px 60px rgba(0,0,0,0.6);
        overflow: hidden;
        animation: mtr-slide-up 0.18s ease;
      }
      @keyframes mtr-slide-up {
        from { transform: translateY(18px); opacity:0 }
        to   { transform: translateY(0);    opacity:1 }
      }

      #mtr-popup-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 14px 18px; gap: 12px; flex-shrink: 0;
        border-bottom: 1px solid var(--divider-color, #30363d);
        background: var(--secondary-background-color, #161b22);
      }
      #mtr-popup-title {
        font-family: 'Courier New', monospace;
        font-size: 0.9rem; font-weight: 700;
        color: var(--primary-text-color, #e6edf3);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #mtr-popup-meta {
        font-family: 'Courier New', monospace;
        font-size: 0.68rem; color: var(--secondary-text-color, #8b949e);
        white-space: nowrap; flex-shrink: 0;
      }
      #mtr-popup-close {
        background: none; border: 1px solid var(--divider-color, #30363d);
        border-radius: 6px; color: var(--secondary-text-color, #8b949e);
        font-size: 1.1rem; width: 28px; height: 28px; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: background 0.12s, color 0.12s;
      }
      #mtr-popup-close:hover {
        background: var(--error-color, #f85149);
        border-color: var(--error-color, #f85149); color: #fff;
      }
      #mtr-popup-body { overflow-y: auto; padding: 14px; flex: 1; }
    `;

    // ── DOM structure ──────────────────────────────────────────────────────
    const overlay = document.createElement("div");
    overlay.id = "mtr-popup-overlay";

    const dialog = document.createElement("div");
    dialog.id = "mtr-popup-dialog";

    const header = document.createElement("div");
    header.id = "mtr-popup-header";

    const titleSpan = document.createElement("span");
    titleSpan.id = "mtr-popup-title";
    titleSpan.textContent = title;

    const metaSpan = document.createElement("span");
    metaSpan.id = "mtr-popup-meta";
    metaSpan.textContent = "Last 2 hours";

    const closeBtn = document.createElement("button");
    closeBtn.id = "mtr-popup-close";
    closeBtn.title = "Close";
    closeBtn.textContent = "✕";

    header.appendChild(titleSpan);
    header.appendChild(metaSpan);
    header.appendChild(closeBtn);

    const body = document.createElement("div");
    body.id = "mtr-popup-body";
    body.appendChild(card);

    dialog.appendChild(header);
    dialog.appendChild(body);
    overlay.appendChild(dialog);

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    this._popupStyle   = style;
    this._popupOverlay = overlay;

    // Close on backdrop click, close button, or Escape.
    overlay.addEventListener("click", e => { if (e.target === overlay) this._closePopup(); });
    closeBtn.addEventListener("click", () => this._closePopup());
    this._popupKeyHandler = e => { if (e.key === "Escape") this._closePopup(); };
    document.addEventListener("keydown", this._popupKeyHandler);
  }

  _closePopup() {
    this._popupOverlay?.remove();
    this._popupStyle?.remove();
    if (this._popupKeyHandler) {
      document.removeEventListener("keydown", this._popupKeyHandler);
      this._popupKeyHandler = null;
    }
    this._popupOverlay = null;
    this._popupStyle   = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual card editor
// ─────────────────────────────────────────────────────────────────────────────

class MtrTerminalCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass   = null;
  }

  set hass(hass) {
    this._hass = hass;
  }

  setConfig(config) {
    try {
      this._config = {
        // Preserve the type field so config-changed events include it.
        type:               config.type               ?? "custom:mtr-terminal-card",
        title:              config.title              ?? "",
        columns:            config.columns            ?? 4,
        destination_entity: config.destination_entity ?? "",
        rtt_sensors:        Array.isArray(config.rtt_sensors)  ? [...config.rtt_sensors]  : [],
        loss_sensors:       Array.isArray(config.loss_sensors) ? [...config.loss_sensors] : [],
        loss_amber:         config.loss_amber         ?? 10,
        loss_red:           config.loss_red           ?? 50,
        rtt_amber:          config.rtt_amber          ?? 150,
        rtt_red:            config.rtt_red            ?? 400,
      };
      this._renderEditor();
    } catch (e) {
      console.error("[mtr-terminal-card-editor] setConfig error:", e);
      throw e;
    }
  }

  _fire() {
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: { ...this._config } },
      bubbles: true,
      composed: true,
    }));
  }

  _renderEditor() {
    const c = this._config;

    // ── Static structure & styles ──────────────────────────────────────────
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 4px 0; }
        .section-title {
          font-size: 0.75rem; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--secondary-text-color);
          margin: 18px 0 6px; padding-bottom: 4px;
          border-bottom: 1px solid var(--divider-color);
        }
        .field-row { margin-bottom: 10px; }
        label {
          display: block; font-size: 0.8rem;
          color: var(--secondary-text-color); margin-bottom: 3px;
        }
        input[type="text"], input[type="number"] {
          width: 100%; box-sizing: border-box;
          padding: 8px 10px; border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--secondary-background-color, #f5f5f5);
          color: var(--primary-text-color);
          font-size: 0.875rem; font-family: inherit;
        }
        input[type="text"]:focus, input[type="number"]:focus {
          outline: none; border-color: var(--primary-color);
        }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        .picker-row {
          display: flex; align-items: center; gap: 6px; margin-bottom: 6px;
        }
        .hop-num {
          font-size: 0.75rem; color: var(--secondary-text-color);
          min-width: 2em; text-align: right; flex-shrink: 0;
        }
        .picker-row input[type="text"] { flex: 1; margin: 0; }
        .remove-btn {
          background: none; border: 1px solid var(--error-color, #f44336);
          color: var(--error-color, #f44336); border-radius: 4px;
          width: 30px; height: 30px; cursor: pointer; font-size: 1.1rem;
          flex-shrink: 0; display: flex; align-items: center; justify-content: center;
        }
        .remove-btn:hover { background: var(--error-color, #f44336); color: #fff; }
        .add-btn {
          width: 100%; padding: 7px; margin-top: 4px; cursor: pointer;
          border: 1px dashed var(--primary-color); border-radius: 6px;
          background: none; color: var(--primary-color); font-size: 0.8rem;
        }
        .add-btn:hover { background: var(--primary-color); color: #fff; }
      </style>

      <div class="section-title">Basic</div>
      <div class="field-row">
        <label>Title</label>
        <input type="text" id="f-title">
      </div>
      <div class="field-row">
        <label>Destination Entity (optional)</label>
        <input type="text" id="f-dest" placeholder="binary_sensor.example_reachable">
      </div>
      <div class="field-row">
        <label>Card width — columns (1–12)</label>
        <input type="number" id="f-columns" min="1" max="12">
      </div>

      <div class="section-title">RTT Sensors (one per hop, in order)</div>
      <div id="rtt-list"></div>
      <button class="add-btn" id="add-rtt">＋ Add RTT sensor</button>

      <div class="section-title">Loss Sensors (optional, same order as RTT)</div>
      <div id="loss-list"></div>
      <button class="add-btn" id="add-loss">＋ Add Loss sensor</button>

      <div class="section-title">Colour Thresholds</div>
      <div class="two-col">
        <div class="field-row"><label>Loss % → amber</label><input type="number" id="f-loss-amber" min="0" max="100"></div>
        <div class="field-row"><label>Loss % → red</label>  <input type="number" id="f-loss-red"   min="0" max="100"></div>
        <div class="field-row"><label>RTT ms → amber</label><input type="number" id="f-rtt-amber"  min="0"></div>
        <div class="field-row"><label>RTT ms → red</label>  <input type="number" id="f-rtt-red"    min="0"></div>
      </div>
    `;

    // ── Set initial values ─────────────────────────────────────────────────
    this.shadowRoot.getElementById("f-title").value      = c.title;
    this.shadowRoot.getElementById("f-dest").value       = c.destination_entity;
    this.shadowRoot.getElementById("f-columns").value    = String(c.columns);
    this.shadowRoot.getElementById("f-loss-amber").value = String(c.loss_amber);
    this.shadowRoot.getElementById("f-loss-red").value   = String(c.loss_red);
    this.shadowRoot.getElementById("f-rtt-amber").value  = String(c.rtt_amber);
    this.shadowRoot.getElementById("f-rtt-red").value    = String(c.rtt_red);

    // ── Sensor lists ───────────────────────────────────────────────────────
    this._renderPickerList("rtt-list",  c.rtt_sensors,  "rtt");
    this._renderPickerList("loss-list", c.loss_sensors, "loss");

    // ── Listeners ─────────────────────────────────────────────────────────
    this._on("#f-title",      "change", e => { this._config.title              = e.target.value;                  this._fire(); });
    this._on("#f-dest",       "change", e => { this._config.destination_entity = e.target.value.trim();           this._fire(); });
    this._on("#f-columns",    "change", e => { this._config.columns            = parseInt(e.target.value)   || 4;  this._fire(); });
    this._on("#f-loss-amber", "change", e => { this._config.loss_amber         = parseFloat(e.target.value) || 10;  this._fire(); });
    this._on("#f-loss-red",   "change", e => { this._config.loss_red           = parseFloat(e.target.value) || 50;  this._fire(); });
    this._on("#f-rtt-amber",  "change", e => { this._config.rtt_amber          = parseFloat(e.target.value) || 150; this._fire(); });
    this._on("#f-rtt-red",    "change", e => { this._config.rtt_red            = parseFloat(e.target.value) || 400; this._fire(); });

    this._on("#add-rtt",  "click", () => {
      this._config.rtt_sensors.push("");
      this._renderPickerList("rtt-list",  this._config.rtt_sensors,  "rtt");
      this._fire();
    });
    this._on("#add-loss", "click", () => {
      this._config.loss_sensors.push("");
      this._renderPickerList("loss-list", this._config.loss_sensors, "loss");
      this._fire();
    });
  }

  _renderPickerList(containerId, sensors, kind) {
    const container = this.shadowRoot.getElementById(containerId);
    if (!container) return;
    container.innerHTML = "";

    const placeholder = kind === "rtt"
      ? "sensor.example_hop_N_rtt"
      : "sensor.example_hop_N_loss";

    sensors.forEach((entityId, idx) => {
      const row = document.createElement("div");
      row.className = "picker-row";

      const numLabel = document.createElement("span");
      numLabel.className   = "hop-num";
      numLabel.textContent = `${idx + 1}.`;

      const input = document.createElement("input");
      input.type        = "text";
      input.placeholder = placeholder.replace("N", idx + 1);
      input.value       = entityId;

      input.addEventListener("change", e => {
        this._config[`${kind}_sensors`][idx] = e.target.value.trim();
        this._fire();
      });

      const btn = document.createElement("button");
      btn.className   = "remove-btn";
      btn.title       = "Remove hop";
      btn.textContent = "×";
      btn.addEventListener("click", () => {
        this._config[`${kind}_sensors`].splice(idx, 1);
        this._renderPickerList(containerId, this._config[`${kind}_sensors`], kind);
        this._fire();
      });

      row.appendChild(numLabel);
      row.appendChild(input);
      row.appendChild(btn);
      container.appendChild(row);
    });
  }

  _on(selector, event, handler) {
    const el = this.shadowRoot.querySelector(selector);
    if (el) el.addEventListener(event, handler);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

customElements.define("mtr-terminal-card",        MtrTerminalCard);
customElements.define("mtr-terminal-card-editor", MtrTerminalCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type:        "mtr-terminal-card",
  name:        "MTR Terminal Card",
  description: "MTR-style terminal display with live per-hop colour coding.",
  preview:     false,
});
