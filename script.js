// ============================================
//  MULTI-MARKET DIGIT SCANNER
//  Decimals hardcoded per market (from live observation)
// ============================================

const APP_ID = 1089;
const WS_URL = `wss://api.derivws.com/trading/v1/options/ws/public`;

const MARKETS = [
  { symbol: "R_10",     name: "Volatility 10",      short: "V10",      decimals: 3 },
  { symbol: "R_25",     name: "Volatility 25",      short: "V25",      decimals: 3 },
  { symbol: "R_50",     name: "Volatility 50",      short: "V50",      decimals: 4 },
  { symbol: "R_75",     name: "Volatility 75",      short: "V75",      decimals: 4 },
  { symbol: "R_100",    name: "Volatility 100",     short: "V100",     decimals: 2 },
  { symbol: "1HZ10V",   name: "Volatility 10 (1s)", short: "V10 1s",   decimals: 2 },
  { symbol: "1HZ25V",   name: "Volatility 25 (1s)", short: "V25 1s",   decimals: 2 },
  { symbol: "1HZ50V",   name: "Volatility 50 (1s)", short: "V50 1s",   decimals: 2 },
  { symbol: "1HZ75V",   name: "Volatility 75 (1s)", short: "V75 1s",   decimals: 2 },
  { symbol: "1HZ100V",  name: "Volatility 100 (1s)", short: "V100 1s", decimals: 2 },
];

const MIN_TICKS_FOR_SIGNAL = 20;

// State per market
const state = {};
MARKETS.forEach((m) => {
  state[m.symbol] = {
    digits: new Array(10).fill(0),
    total: 0,
    lastQuote: null,
    lastDigit: null,
    hotDigit: null,
    hotPct: 0,
    hotDev: 0,
    decimals: m.decimals,
  };
});

// DOM
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const marketGrid = document.getElementById("marketGrid");
const totalTicksAllEl = document.getElementById("totalTicksAll");
const hottestMarketEl = document.getElementById("hottestMarket");
const strongestSignalEl = document.getElementById("strongestSignal");
const lastUpdateEl = document.getElementById("lastUpdate");

let ws = null;

// ---- BUILD CARDS ----
function buildCards() {
  marketGrid.innerHTML = MARKETS.map((m) => `
    <div class="market-card" id="card-${m.symbol}" data-symbol="${m.symbol}">
      <div class="mc-header">
        <div>
          <div class="mc-symbol">${m.short}</div>
          <span class="mc-symbol-sub">${m.name}</span>
        </div>
        <div class="mc-ticks" id="ticks-${m.symbol}">0</div>
      </div>

      <div class="mc-price" id="price-${m.symbol}">—</div>

      <div class="mc-hotcold">
        <div class="mc-hc-col hot">
          <div class="mc-hc-title">🔥 Hot</div>
          <div id="hot-${m.symbol}">
            <div class="mc-hc-empty">waiting…</div>
          </div>
        </div>
        <div class="mc-hc-col cold">
          <div class="mc-hc-title">❄️ Cold</div>
          <div id="cold-${m.symbol}">
            <div class="mc-hc-empty">waiting…</div>
          </div>
        </div>
      </div>

      <div class="mc-label">Distribution</div>
      <div class="mc-bars" id="bars-${m.symbol}">
        ${Array.from({ length: 10 }, (_, i) => `<div class="mc-bar" data-bar="${i}"></div>`).join("")}
      </div>
      <div class="mc-bar-labels">
        ${Array.from({ length: 10 }, (_, i) => `<span>${i}</span>`).join("")}
      </div>
    </div>
  `).join("");
}

// ---- WEBSOCKET ----
function connect() {
  setStatus("connecting", "Connecting…");
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    setStatus("connected", "Live");
    subscribeAll();
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.error) {
      console.warn("Deriv error:", data.error.message || data.error);
      return;
    }

    if (data.msg_type === "tick" && data.tick) {
      handleTick(data.tick);
    }
  };

  ws.onerror = () => setStatus("error", "Connection error");
  ws.onclose = () => {
    setStatus("error", "Disconnected — retrying…");
    setTimeout(connect, 3000);
  };
}

function subscribeAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ forget_all: "ticks" }));
  MARKETS.forEach((m) => {
    ws.send(JSON.stringify({ ticks: m.symbol, subscribe: 1 }));
  });
}

// ---- TICK HANDLER ----
function handleTick(tick) {
  const symbol = tick.symbol;
  const s = state[symbol];
  if (!s) return;

  // Use the hardcoded decimals for this market
  const quoteStr = tick.quote.toFixed(s.decimals);
  const lastDigit = parseInt(quoteStr.slice(-1), 10);

  s.digits[lastDigit]++;
  s.total++;
  s.lastQuote = quoteStr;
  s.lastDigit = lastDigit;

  renderCard(symbol);
  renderGlobal();
}

// ---- RENDER CARD ----
function renderCard(symbol) {
  const s = state[symbol];
  const card = document.getElementById(`card-${symbol}`);
  if (!card) return;

  document.getElementById(`ticks-${symbol}`).textContent = s.total.toLocaleString();

  const sorted = s.digits
    .map((count, digit) => ({
      digit,
      count,
      pct: s.total > 0 ? (count / s.total) * 100 : 0,
    }))
    .sort((a, b) => b.pct - a.pct);

  const hot = sorted.slice(0, 3);
  const cold = sorted.slice(-3).reverse();

  let hotDigit = null, hotPct = 0, hotDev = 0;
  if (s.total >= MIN_TICKS_FOR_SIGNAL) {
    for (let d = 0; d < 10; d++) {
      const pct = (s.digits[d] / s.total) * 100;
      const dev = Math.abs(pct - 10);
      if (dev > hotDev) { hotDev = dev; hotPct = pct; hotDigit = d; }
    }
  }
  s.hotDigit = hotDigit; s.hotPct = hotPct; s.hotDev = hotDev;

  const priceEl = document.getElementById(`price-${symbol}`);
  if (s.lastQuote !== null) {
    const isHotDigit = hotDev >= 3 && hotPct > 10 && s.lastDigit === hotDigit;
    priceEl.innerHTML = `${s.lastQuote} <span class="mc-digit ${isHotDigit ? "hot" : ""}">${s.lastDigit}</span>`;
  }

  const hotEl = document.getElementById(`hot-${symbol}`);
  const coldEl = document.getElementById(`cold-${symbol}`);

  if (s.total < MIN_TICKS_FOR_SIGNAL) {
    const remaining = MIN_TICKS_FOR_SIGNAL - s.total;
    hotEl.innerHTML = `<div class="mc-hc-empty">waiting… (${remaining})</div>`;
    coldEl.innerHTML = `<div class="mc-hc-empty">waiting… (${remaining})</div>`;
  } else {
    hotEl.innerHTML = hot.map((h) => `
      <div class="mc-hc-row">
        <span class="mc-hc-digit">${h.digit}</span>
        <span class="mc-hc-pct">${h.pct.toFixed(1)}%</span>
      </div>
    `).join("");
    coldEl.innerHTML = cold.map((c) => `
      <div class="mc-hc-row">
        <span class="mc-hc-digit">${c.digit}</span>
        <span class="mc-hc-pct">${c.pct.toFixed(1)}%</span>
      </div>
    `).join("");
  }

  const barsEl = document.getElementById(`bars-${symbol}`);
  if (barsEl) {
    const maxCount = Math.max(...s.digits, 1);
    barsEl.querySelectorAll(".mc-bar").forEach((bar, i) => {
      const pct = s.total > 0 ? (s.digits[i] / s.total) * 100 : 0;
      const h = (s.digits[i] / maxCount) * 100;
      bar.style.height = Math.max(2, h) + "%";
      bar.classList.remove("hot", "cold");
      if (s.total >= MIN_TICKS_FOR_SIGNAL) {
        if (pct > 13) bar.classList.add("hot");
        else if (pct < 7) bar.classList.add("cold");
      }
    });
  }

  card.classList.remove("is-hot");
  if (s.total >= MIN_TICKS_FOR_SIGNAL && hotDev >= 4 && hotPct > 10) {
    card.classList.add("is-hot");
  }
}

// ---- GLOBAL STATS ----
function renderGlobal() {
  let totalAll = 0;
  let hottestMarket = null;
  let hottestPct = 0;
  let strongestSignal = null;
  let strongestDev = 0;

  MARKETS.forEach((m) => {
    const s = state[m.symbol];
    totalAll += s.total;

    if (s.total >= MIN_TICKS_FOR_SIGNAL) {
      for (let d = 0; d < 10; d++) {
        const pct = (s.digits[d] / s.total) * 100;
        if (pct > hottestPct) {
          hottestPct = pct;
          hottestMarket = `${m.short} · ${d} (${pct.toFixed(1)}%)`;
        }
      }
      if (s.hotDev && s.hotDev > strongestDev) {
        strongestDev = s.hotDev;
        strongestSignal = `${m.short} · ${s.hotPct > 10 ? "🔥" : "❄️"} ${s.hotDigit} (${s.hotPct.toFixed(1)}%)`;
      }
    }
  });

  totalTicksAllEl.textContent = totalAll.toLocaleString();
  hottestMarketEl.textContent = hottestMarket || "—";
  strongestSignalEl.textContent = strongestSignal || "—";

  const now = new Date();
  lastUpdateEl.textContent = now.toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function setStatus(stateName, text) {
  statusText.textContent = text;
  statusDot.classList.remove("connected", "error");
  if (stateName === "connected") statusDot.classList.add("connected");
  if (stateName === "error") statusDot.classList.add("error");
}

// ---- BOOT ----
buildCards();
connect();

setInterval(() => {
  if (totalTicksAllEl.textContent !== "0") renderGlobal();
}, 1000);