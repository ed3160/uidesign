/* ============================================================ *
 *  How LLMs finish your sentence — lesson runtime               *
 *                                                                *
 *  Architecture                                                  *
 *  ────────────                                                  *
 *  - Server picks the active screen via window.__BOOT__.         *
 *    /learn/1 → tokens, /learn/2 → embeddings, etc.              *
 *    /quiz/N → q1/q2/q3, /results → results.                     *
 *  - "Continue" is a real page navigation to the next URL.       *
 *    Browser back works as you'd expect; the in-app back arrow   *
 *    just calls history.back().                                  *
 *  - Each screen entry POSTs to /api/track so the backend has a  *
 *    per-page record of what the user did.                       *
 *  - Drawing is SVG-first.                                       *
 * ============================================================ */

/* ─── Screen registry & navigation ────────────────────────────── */
const LEARN_SCREENS = ["tokens", "embeddings", "attention", "distribution", "loop", "lesson-complete"];
const QUIZ_SCREENS  = ["q1", "q2", "q3"];

const BOOT = window.__BOOT__ || { startScreen: "tokens", routeKind: "learn", routeN: 1 };
let LESSON = null;
let EMBED  = null;

function nextUrl() {
  if (BOOT.routeKind === "learn") {
    if (BOOT.routeN < LEARN_SCREENS.length) return `/learn/${BOOT.routeN + 1}`;
    return `/quiz/1`;
  }
  if (BOOT.routeKind === "quiz") {
    if (BOOT.routeN < QUIZ_SCREENS.length) return `/quiz/${BOOT.routeN + 1}`;
    return `/results`;
  }
  return "/";
}

function track(kind, data) {
  // Fire-and-forget. We don't gate UI on the response.
  $.ajax({
    url: "/api/track", method: "POST",
    contentType: "application/json",
    data: JSON.stringify({ kind, data: data || {} }),
  });
}

function goNext() { window.location.href = nextUrl(); }

/* ─── Progress bar — fraction of the full journey done ───────── */
function updateProgress() {
  const totalSteps = LEARN_SCREENS.length + QUIZ_SCREENS.length + 1; // +1 for results
  let idx = 0;
  if (BOOT.routeKind === "learn")   idx = BOOT.routeN;
  if (BOOT.routeKind === "quiz")    idx = LEARN_SCREENS.length + BOOT.routeN;
  if (BOOT.routeKind === "results") idx = totalSteps;
  $("#progress-fill").css("width", `${(idx / totalSteps) * 100}%`);
}

/* ─── Footer & feedback bars ─────────────────────────────────── */
function configureFooter() {
  const isQuiz = BOOT.routeKind === "quiz";
  const isResults = BOOT.routeKind === "results";
  if (isQuiz || isResults) {
    $("#footer-bar").addClass("is-hidden");
  } else {
    $("#continue-btn").text("Continue").off("click").on("click", goNext);
    $("#footer-bar").removeClass("is-hidden");
  }
}
function hideFeedback() { $("#feedback").attr("data-state", "hidden"); }
function showFeedback(ok, title, sub) {
  $("#feedback-icon").html(ok ? "&#10003;" : "&#10005;");
  $("#feedback-title").text(title);
  $("#feedback-sub").text(sub || "");
  $("#feedback").attr("data-state", ok ? "correct" : "incorrect");
  $("#footer-bar").addClass("is-hidden");
}
$(document).on("click", "#feedback-continue", () => { hideFeedback(); goNext(); });

/* ─── Tiny helpers ───────────────────────────────────────────── */
function svgNS(name, attrs = {}, children = []) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  for (const c of children) el.appendChild(c);
  return el;
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const fmtPct = (p) => (p * 100).toFixed(p < 0.01 ? 2 : (p < 0.1 ? 1 : 0)) + "%";
function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ============================================================ */
/* === BEAT 1 — Tokens ======================================== */
/* ============================================================ */
let tokensCurrent = [];
// 0 = leave every BPE token whole (cleanest state, fewest tokens)
// 100 = split every token down to individual characters (most tokens)
let tokensBreakPct = 0;

function initTokens() {
  // Force initial control state. Browsers (Firefox especially) restore form
  // values on back-nav even when the page itself is re-rendered, so the
  // slider could come back at whatever position the user left it. Same for
  // the text input.
  $("#vocab-slider").val(0);
  tokensBreakPct = 0;
  $("#token-input").val("The chef who trained in Paris finally opened her own restaurant.");

  $("#token-input").on("input", debounce(() => {
    tokenizeNow();
    track("tokens_edit", { text: $("#token-input").val() });
  }, 250));
  function updateSliderFill() {
    const $s = $("#vocab-slider");
    const pct = $s.val() + "%";
    $s[0].style.setProperty("--pct", pct);
  }
  $("#vocab-slider").on("input", debounce(() => {
    tokensBreakPct = parseInt($("#vocab-slider").val(), 10);
    updateSliderFill();
    drawTokens();
    track("vocab_slider", { value: tokensBreakPct });
  }, 80));
  updateSliderFill();
  tokenizeNow();
}

function tokenizeNow() {
  $.ajax({
    url: "/api/tokenize", method: "POST",
    contentType: "application/json",
    data: JSON.stringify({ text: $("#token-input").val() }),
  }).done(d => { tokensCurrent = d.tokens; drawTokens(); });
}

// breakPct=0 → real BPE (whole tokens); breakPct=100 → every token split
// down to its characters. Highest-ID tokens (rarer, merged later in BPE)
// break first as breakPct rises.
function applyVocabSize(tokens, breakPct) {
  if (breakPct <= 0 || tokens.length === 0) return tokens.map(t => ({ ...t, kind: "word" }));
  const sortedIdx = tokens.map((_, i) => i).sort((a, b) => tokens[b].id - tokens[a].id);
  const numToSplit = Math.floor(sortedIdx.length * breakPct / 100);
  const splitSet = new Set(sortedIdx.slice(0, numToSplit));
  const out = [];
  tokens.forEach((t, i) => {
    if (splitSet.has(i)) {
      for (const ch of t.text) out.push({ text: ch, id: -1, kind: "char" });
    } else {
      out.push({ ...t, kind: "word" });
    }
  });
  return out;
}

function drawTokens() {
  const sliced = applyVocabSize(tokensCurrent, tokensBreakPct);
  const $out = $("#tokens-out").empty();
  sliced.forEach((t, i) => {
    // Render token text verbatim — including its leading space.
    // CSS .tok { white-space: pre } preserves it; no decorative dot.
    $('<span class="tok"></span>')
      .attr("data-kind", t.kind)
      // Cap the cascade at ~360ms total — long staggers feel sluggish.
      .css("animation-delay", Math.min(i, 12) * 30 + "ms")
      .attr("title", t.id >= 0 ? `id ${t.id}` : "")
      .text(t.text)
      .appendTo($out);
  });
  $("#vocab-counter").text(`${sliced.length} tokens`);
}

/* ============================================================ */
/* === BEAT 2 — Embeddings ===================================== */
/* ============================================================ */
const EMBED_VIEW = { w: 800, h: 540, padding: 40 };

function projXY(xy) {
  return [
    EMBED_VIEW.padding + (xy[0] + 1) / 2 * (EMBED_VIEW.w - 2 * EMBED_VIEW.padding),
    EMBED_VIEW.padding + (1 - (xy[1] + 1) / 2) * (EMBED_VIEW.h - 2 * EMBED_VIEW.padding),
  ];
}
function unprojXY(px, py) {
  const x = (px - EMBED_VIEW.padding) / (EMBED_VIEW.w - 2 * EMBED_VIEW.padding) * 2 - 1;
  const y = 1 - (py - EMBED_VIEW.padding) / (EMBED_VIEW.h - 2 * EMBED_VIEW.padding) * 2;
  return [x, y];
}

function drawEmbedMap($svg) {
  const svg = $svg[0];
  svg.innerHTML = "";

  const defs = svgNS("defs");
  const marker = svgNS("marker", {
    id: "arrowhead", viewBox: "0 0 10 10", refX: 9, refY: 5,
    markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse",
  });
  marker.appendChild(svgNS("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#4285f4" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  const lineLayer = svgNS("g", { id: "embed-lines" });
  const dotLayer  = svgNS("g", { id: "embed-dots"  });
  const lblLayer  = svgNS("g", { id: "embed-labels"});
  svg.appendChild(lineLayer); svg.appendChild(dotLayer); svg.appendChild(lblLayer);

  Object.entries(EMBED.words).forEach(([w, info]) => {
    const [px, py] = projXY(info.xy);
    dotLayer.appendChild(svgNS("circle", {
      class: "embed-hit", cx: px, cy: py, r: 14,
      "data-word": w,
    }));
    dotLayer.appendChild(svgNS("circle", {
      class: `embed-dot cluster-${info.cluster}`,
      cx: px, cy: py, r: 5, "data-word": w,
    }));
    const lbl = svgNS("text", {
      class: "embed-label", x: px + 8, y: py + 3.5, "data-word": w,
    });
    lbl.textContent = w;
    lblLayer.appendChild(lbl);
  });
}

function initEmbeddings() {
  const $svg = $("#embed-svg");
  drawEmbedMap($svg);

  $svg.on("mouseover", ".embed-dot,.embed-hit,.embed-label", function (e) {
    highlightWord($svg, $(this).attr("data-word"));
    showTooltip(e, $(this).attr("data-word"));
  });
  $svg.on("mouseout", ".embed-dot,.embed-hit,.embed-label", function () {
    clearHighlight($svg);
    $("#embed-tooltip").prop("hidden", true);
  });
  $svg.on("mousemove", (e) => {
    if (!$("#embed-tooltip").prop("hidden")) moveTooltip(e);
  });

  $("#analogy-btn").on("click", () => {
    showAnalogy($svg, "king", "man", "woman");
    track("analogy", { which: "king-man+woman" });
  });
  $("#analogy-btn-2").on("click", () => {
    showAnalogy($svg, "paris", "france", "japan");
    track("analogy", { which: "paris-france+japan" });
  });
  $("#embed-reset").on("click", () => clearHighlight($svg, true));
}

function highlightWord($svg, w) {
  const info = EMBED.words[w]; if (!info) return;
  const svg = $svg[0];
  $svg.find(".embed-dot, .embed-label").addClass("is-faded").removeClass("is-highlight");
  $svg.find(`[data-word="${w}"]`).removeClass("is-faded").addClass("is-highlight");
  const lines = svg.querySelector("#embed-lines");
  lines.innerHTML = "";
  const [ax, ay] = projXY(info.xy);
  info.nn.slice(0, 5).forEach(n => {
    const target = EMBED.words[n]; if (!target) return;
    const [bx, by] = projXY(target.xy);
    lines.appendChild(svgNS("line", {
      class: "embed-line", x1: ax, y1: ay, x2: bx, y2: by,
    }));
    $svg.find(`[data-word="${n}"]`).removeClass("is-faded").addClass("is-highlight");
  });
}

function clearHighlight($svg, full = false) {
  $svg.find(".embed-dot, .embed-label").removeClass("is-faded").removeClass("is-highlight");
  const lines = $svg[0].querySelector("#embed-lines");
  if (lines) lines.innerHTML = "";
  if (full) $("#embed-tooltip").prop("hidden", true);
}

function showTooltip(e, w) {
  const info = EMBED.words[w]; if (!info) return;
  $("#embed-tooltip")
    .text(`${w}  ·  nearest: ${info.nn.slice(0, 3).join(", ")}`)
    .prop("hidden", false);
  moveTooltip(e);
}
function moveTooltip(e) {
  const $wrap = $("#embed-svg").parent();
  const off = $wrap.offset();
  $("#embed-tooltip").css({ left: e.pageX - off.left, top: e.pageY - off.top });
}

function showAnalogy($svg, a, b, c) {
  clearHighlight($svg);
  const wa = EMBED.words[a], wb = EMBED.words[b], wc = EMBED.words[c];
  if (!wa || !wb || !wc) return;

  const res = wa.vec.map((v, i) => v - wb.vec[i] + wc.vec[i]);
  const dot = (x, y) => x.reduce((s, v, i) => s + v * y[i], 0);
  const norm = (x) => Math.sqrt(dot(x, x));
  const exclude = new Set([a, b, c]);
  let best = null, bestSim = -2;
  for (const [w, info] of Object.entries(EMBED.words)) {
    if (exclude.has(w)) continue;
    const sim = dot(res, info.vec) / (norm(res) * norm(info.vec) + 1e-9);
    if (sim > bestSim) { bestSim = sim; best = w; }
  }

  const rx = clamp(wa.xy[0] - wb.xy[0] + wc.xy[0], -1, 1);
  const ry = clamp(wa.xy[1] - wb.xy[1] + wc.xy[1], -1, 1);
  const [pAx, pAy] = projXY(wa.xy);
  const [pBx, pBy] = projXY(wb.xy);
  const [pCx, pCy] = projXY(wc.xy);
  const [pRx, pRy] = projXY([rx, ry]);

  const svg = $svg[0];
  const lines = svg.querySelector("#embed-lines");
  lines.innerHTML = "";

  [a, b, c, best].forEach(w => $svg.find(`[data-word="${w}"]`).addClass("is-highlight"));
  $svg.find(".embed-dot, .embed-label").not(".is-highlight").addClass("is-faded");

  lines.appendChild(svgNS("line", {
    class: "embed-arrow", x1: pBx, y1: pBy, x2: pCx, y2: pCy,
    "stroke-dasharray": "4 4",
  }));
  lines.appendChild(svgNS("line", {
    class: "embed-arrow", x1: pAx, y1: pAy, x2: pRx, y2: pRy,
  }));
  const bestInfo = EMBED.words[best];
  const [bPx, bPy] = projXY(bestInfo.xy);

  lines.appendChild(svgNS("circle", {
    cx: pRx, cy: pRy, r: 4,
    style: "fill: var(--blue); opacity: 0.7;",
  }));
  lines.appendChild(svgNS("line", {
    x1: pRx, y1: pRy, x2: bPx, y2: bPy,
    style: "stroke: var(--green-deep); stroke-width: 1.5; stroke-dasharray: 2 3; opacity: 0.55;",
  }));
  lines.appendChild(svgNS("circle", {
    class: "embed-target-marker", cx: bPx, cy: bPy, r: 9,
  }));
  const lbl = svgNS("text", {
    class: "embed-label is-highlight",
    x: bPx + 12, y: bPy + 4,
    style: "fill: var(--green-deep); font-size: 14px;",
  });
  lbl.textContent = `≈ ${best}`;
  lines.appendChild(lbl);
}

/* ============================================================ */
/* === BEAT 3 — Attention ====================================== */
/* ============================================================ */
const ATTN_VIEW = { w: 900, h: 320 };
let currentVariant = "Paris";

function initAttention() {
  $("#variant-pills").on("click", ".variant-pill", function () {
    $("#variant-pills .variant-pill").removeClass("is-selected");
    $(this).addClass("is-selected");
    currentVariant = $(this).data("variant");
    track("attention_variant", { variant: currentVariant });
    renderAttention();
  });
  renderAttention();
}

function renderAttention() {
  const sent = LESSON.sentence;
  const tokens = [
    ...sent.prefix.slice(0, sent.swap_position),
    currentVariant,
    ...sent.suffix,
    sent.blank_label,
  ];
  const blankIdx = tokens.length - 1;
  const attn = LESSON.attention[currentVariant];

  const svg = document.getElementById("attn-svg");
  svg.innerHTML = "";

  const gap = 6, rowY = 220;
  const widths = tokens.map(t => Math.max(48, t.length * 11 + 22));
  const totalW = widths.reduce((a, b) => a + b + gap, -gap);
  const startX = (ATTN_VIEW.w - totalW) / 2;

  const xs = [];
  let cx = startX;
  tokens.forEach((t, i) => {
    const w = widths[i];
    xs.push(cx + w / 2);
    const isBlank = i === blankIdx;
    const isSwap = i === sent.swap_position;
    svg.appendChild(svgNS("rect", {
      class: `attn-token-rect ${isBlank ? "is-blank" : ""} ${isSwap ? "is-swap" : ""}`,
      x: cx, y: rowY, width: w, height: 34, rx: 8, ry: 8,
    }));
    const text = svgNS("text", {
      class: "attn-token-text",
      x: cx + w / 2, y: rowY + 22,
    });
    text.textContent = isBlank ? "?" : t;
    svg.appendChild(text);
    cx += w + gap;
  });

  const blankX = xs[blankIdx];
  const blankY = rowY;
  for (let k = 0; k < blankIdx; k++) {
    const tokenKey = (k === sent.swap_position) ? currentVariant : tokens[k];
    const a = attn[tokenKey] ?? 0;
    const tx = xs[k];
    const dx = blankX - tx;
    const arcH = Math.min(180, 60 + Math.abs(dx) * 0.45);
    const cx1 = tx + dx * 0.25;
    const cx2 = blankX - dx * 0.25;
    const yTop = rowY - arcH;
    svg.appendChild(svgNS("path", {
      class: "attn-arc",
      d: `M ${tx} ${rowY} C ${cx1} ${yTop}, ${cx2} ${yTop}, ${blankX} ${blankY}`,
      "stroke-width": Math.max(0.5, a * 22),
      "stroke-opacity": Math.min(0.85, 0.18 + a * 1.6),
    }));
    if (a >= 0.12) {
      const midX = (tx + blankX) / 2;
      const midY = yTop + 8;
      const txt = svgNS("text", {
        x: midX, y: midY,
        style: "font-size: 10.5px; fill: var(--ink-soft); text-anchor: middle; font-weight: 600;",
      });
      txt.textContent = (a * 100).toFixed(0) + "%";
      svg.appendChild(txt);
    }
  }

  const dist = LESSON.distributions[currentVariant];
  const $list = $("#attn-top-list").empty();
  dist.slice(0, 5).forEach(([w, p], idx) => {
    $('<li></li>')
      .toggleClass("is-leader", idx === 0)
      .css("animation-delay", (idx * 60) + "ms")
      .append(`<span>${w}</span>`)
      .append(`<span class="attn-top-pct">${fmtPct(p)}</span>`)
      .appendTo($list);
  });
}

/* ============================================================ */
/* === BEAT 4 — Distribution =================================== */
/* ============================================================ */
const DIST_VIEW = { w: 780, h: 360, rowH: 22, labelW: 110, padR: 56, padT: 16 };

function initDistribution() {
  // Reset dials in case the browser restored prior positions on back-nav.
  $("#dial-temp").val(100);
  $("#dial-topk").val(15);
  $("#dial-topp").val(100);

  ["dial-temp", "dial-topk", "dial-topp"].forEach(id => {
    $(`#${id}`).on("input", renderDist);
  });
  // Send a single tracking event per dial after the user pauses interacting.
  ["dial-temp", "dial-topk", "dial-topp"].forEach(id => {
    $(`#${id}`).on("change", () => track("dial_change", {
      id, value: $(`#${id}`).val(),
    }));
  });
  $("#roll-btn").on("click", () => { rollDist(); track("dist_roll", {}); });
  renderDist();
  const sent = LESSON.sentence;
  const prefix = [...sent.prefix.slice(0, sent.swap_position), "Paris", ...sent.suffix].join(" ");
  $("#roll-sentence").text(`${prefix} ___`);
}

function reshapeDist(base, T, k, p) {
  let probs = base.map(([w, x]) => [w, Math.pow(x, 1 / Math.max(T, 0.05))]);
  const s = probs.reduce((a, b) => a + b[1], 0);
  probs = probs.map(([w, x]) => [w, x / s]);

  probs = probs.map(([w, x], i) => [w, i < k ? x : 0]);

  const sortedIdx = probs.map((_, i) => i).sort((a, b) => probs[b][1] - probs[a][1]);
  let acc = 0;
  const keep = new Set();
  for (const i of sortedIdx) {
    if (probs[i][1] === 0) break;
    keep.add(i);
    acc += probs[i][1];
    if (acc >= p) break;
  }
  probs = probs.map(([w, x], i) => [w, keep.has(i) ? x : 0]);

  const s2 = probs.reduce((a, b) => a + b[1], 0) || 1;
  return probs.map(([w, x]) => [w, x / s2]);
}

function renderDist() {
  const base = LESSON.distributions["Paris"];
  const T = parseInt($("#dial-temp").val(), 10) / 100;
  const k = parseInt($("#dial-topk").val(), 10);
  const p = parseInt($("#dial-topp").val(), 10) / 100;
  $("#temp-val").text(T.toFixed(2));
  $("#topk-val").text(k);
  $("#topp-val").text(p.toFixed(2));

  const reshaped = reshapeDist(base, T, k, p);
  const maxP = Math.max(...reshaped.map(([, x]) => x), 0.01);
  const trackX = DIST_VIEW.labelW;
  const trackW = DIST_VIEW.w - DIST_VIEW.labelW - DIST_VIEW.padR;

  const svg = document.getElementById("dist-svg");
  svg.innerHTML = "";

  base.forEach(([w, _], i) => {
    const y = DIST_VIEW.padT + i * DIST_VIEW.rowH;
    const prob = reshaped[i][1];
    const isDead = prob === 0;
    const bw = isDead ? 4 : Math.max(2, (prob / maxP) * trackW);
    const isLeader = !isDead && prob === maxP;

    const lbl = svgNS("text", { class: "dist-label", x: trackX - 10, y: y + 14 });
    lbl.textContent = w;
    if (isDead) lbl.style.opacity = 0.4;
    svg.appendChild(lbl);

    svg.appendChild(svgNS("rect", {
      class: `dist-bar ${isDead ? "is-dead" : ""} ${isLeader ? "is-leader" : ""}`,
      x: trackX, y: y + 4, width: bw, height: DIST_VIEW.rowH - 8, rx: 4,
    }));

    const pct = svgNS("text", {
      class: "dist-pct",
      x: trackX + bw + 6, y: y + 14,
    });
    pct.textContent = isDead ? "—" : fmtPct(prob);
    svg.appendChild(pct);
  });

  if (k < base.length) {
    const ly = DIST_VIEW.padT + k * DIST_VIEW.rowH - 1;
    svg.appendChild(svgNS("line", {
      class: "dist-cutoff-line",
      x1: 8, y1: ly, x2: DIST_VIEW.w - 8, y2: ly,
    }));
    const tag = svgNS("text", {
      x: DIST_VIEW.w - 12, y: ly + 13,
      style: "font-size: 11px; fill: var(--blue-deep); text-anchor: end; font-weight: 700;",
    });
    tag.textContent = "top-k cutoff";
    svg.appendChild(tag);
  }
}

function rollDist() {
  const base = LESSON.distributions["Paris"];
  const T = parseInt($("#dial-temp").val(), 10) / 100;
  const k = parseInt($("#dial-topk").val(), 10);
  const p = parseInt($("#dial-topp").val(), 10) / 100;
  const reshaped = reshapeDist(base, T, k, p);
  const r = Math.random();
  let acc = 0, pick = reshaped[0][0];
  for (const [w, x] of reshaped) {
    acc += x;
    if (r < acc) { pick = w; break; }
  }
  const sent = LESSON.sentence;
  const prefix = [...sent.prefix.slice(0, sent.swap_position), "Paris", ...sent.suffix].join(" ");
  $("#roll-sentence").empty()
    .append(document.createTextNode(prefix + " "))
    .append($('<span class="roll-token-fly"></span>').text(pick))
    .append(document.createTextNode("."));
}

/* ============================================================ */
/* === BEAT 5 — Loop =========================================== */
/* ============================================================ */
let loopStep = 0;
let loopPlaying = false;
let loopTimer = null;
const LOOP_PICKED_BLANK = "restaurant";
const LOOP_CYCLE_MS = 2200;

function initLoop() {
  $("#loop-step-btn").on("click", () => {
    if (loopPlaying) return;
    track("loop_step", { step: loopStep });
    loopStepOnce();
  });
  $("#loop-play-btn").on("click", () => { track("loop_play", { playing: !loopPlaying }); toggleLoopPlay(); });
  $("#loop-reset-btn").on("click", () => { track("loop_reset", {}); loopStopAutoplay(); loopReset(); });
  loopReset();
}

function toggleLoopPlay() {
  if (loopPlaying) { loopStopAutoplay(); return; }
  if (loopStep >= LESSON.loop.length) loopReset();
  loopPlaying = true;
  $("#loop-play-btn").text("Pause");
  $("#loop-step-btn").prop("disabled", true);
  const tick = () => {
    if (!loopPlaying || loopStep >= LESSON.loop.length) { loopStopAutoplay(); return; }
    loopStepOnce();
    loopTimer = setTimeout(tick, LOOP_CYCLE_MS);
  };
  tick();
}

function loopStopAutoplay() {
  loopPlaying = false;
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  $("#loop-play-btn").text(loopStep >= LESSON.loop.length ? "Replay" : "Play");
  $("#loop-step-btn").prop("disabled", false);
}

function loopReset() {
  loopStep = 0;
  loopPlaying = false;
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null; }
  renderLoopSentence([]);
  $("#loop-mini-dist").empty();
  $("#loop-play-btn").text("Play");
  $("#loop-step-btn").prop("disabled", false);
}

function loopBaseWords() {
  const sent = LESSON.sentence;
  return [
    ...sent.prefix.slice(0, sent.swap_position),
    "Paris",
    ...sent.suffix,
    LOOP_PICKED_BLANK,
  ];
}

function renderLoopSentence(freshList) {
  const $s = $("#loop-sentence").empty();
  loopBaseWords().forEach(w => $('<span class="loop-word"></span>').text(w).appendTo($s));
  // Leading spaces in BPE tokens are preserved literally (CSS white-space: pre).
  // No · dot, no typewriter underscore — the green "fresh" tint already
  // signals which words just appeared.
  freshList.forEach((w, i) => {
    $('<span class="loop-word is-fresh"></span>')
      .text(w)
      .css("animation-delay", (i * 60) + "ms")
      .appendTo($s);
  });
}

function loopStepOnce() {
  if (loopStep >= LESSON.loop.length) return;
  const step = LESSON.loop[loopStep];
  const $d = $("#loop-mini-dist").empty();
  const max = step.options[0][1];
  step.options.slice(0, 5).forEach(([w, p], i) => {
    const isPick = w === step.pick;
    const $row = $('<div class="loop-mini-row"></div>')
      .toggleClass("is-pick", isPick)
      .css("animation-delay", (i * 60) + "ms");
    $('<div class="loop-mini-word"></div>').text(w).appendTo($row);
    const $track = $('<div class="loop-mini-track"></div>').appendTo($row);
    $('<div class="loop-mini-fill"></div>').appendTo($track);
    $('<div class="loop-mini-pct"></div>').text(fmtPct(p)).appendTo($row);
    $d.append($row);
    setTimeout(() => $row.find(".loop-mini-fill").css("width", (p / max * 100) + "%"), 80 + i * 60);
  });

  setTimeout(() => {
    loopStep++;
    const fresh = LESSON.loop.slice(0, loopStep).map(s => s.pick);
    renderLoopSentence(fresh);
    if (loopStep >= LESSON.loop.length) $("#loop-play-btn").text("Replay");
  }, 1100);
}

/* ============================================================ */
/* === QUIZ 1 — rank phrases by token count ==================== */
/* ============================================================ */
let q1Locked = false;

function initQ1() {
  q1Locked = false;
  $("#q1-feedback").prop("hidden", true);
  $("#q1-submit").prop("disabled", true).text("Submit").off("click").on("click", submitQ1);

  const candidates = LESSON.quiz1.candidates;
  const n = candidates.length;
  const $slots = $("#q1-slots").empty();
  for (let i = 0; i < n; i++) {
    const $row = $('<div class="rank-slot"></div>');
    $('<span class="rank-num"></span>').text(i + 1).appendTo($row);
    const $drop = $('<div class="rank-drop"></div>').attr("data-slot", i);
    $row.append($drop);
    $slots.append($row);
  }

  const order = [...candidates].sort(() => Math.random() - 0.5);
  const $bank = $("#q1-bank").empty();
  order.forEach(c => {
    const $card = $('<div class="rank-card"></div>').text(c).attr("data-id", c);
    $card.data("payload", c);
    makeDraggable($card);
    $bank.append($card);
  });

  $("#q1-slots .rank-drop").each(function () {
    const $drop = $(this);
    makeDropZone($drop, (src, $zone) => {
      if (q1Locked) return;
      const $src = $(src);
      const $existing = $zone.find(".rank-card");
      if ($existing.length) $bank.append($existing.removeClass("in-slot"));
      $zone.append($src.addClass("in-slot"));
      $zone.addClass("has-item");
      q1MaybeEnableSubmit();
    });
  });
  makeDropZone($bank, (src) => {
    if (q1Locked) return;
    const $src = $(src);
    const $old = $src.parent(".rank-drop");
    $bank.append($src.removeClass("in-slot"));
    if ($old.length) $old.removeClass("has-item");
    q1MaybeEnableSubmit();
  });
}

function q1MaybeEnableSubmit() {
  const filled = $("#q1-slots .rank-drop").has(".rank-card").length;
  $("#q1-submit").prop("disabled", filled !== LESSON.quiz1.candidates.length);
}

function submitQ1() {
  if (q1Locked) return;
  q1Locked = true;
  const order = [];
  $("#q1-slots .rank-drop").each(function () {
    const $c = $(this).find(".rank-card");
    if ($c.length) order.push($c.attr("data-id"));
  });

  $.ajax({
    url: "/api/quiz_check", method: "POST",
    contentType: "application/json",
    data: JSON.stringify({ qid: "q1", order }),
  }).done(res => {
    const truth = res.true_order;
    const counts = res.counts;
    $("#q1-slots .rank-drop").each(function (i) {
      const $c = $(this).find(".rank-card");
      if (!$c.length) return;
      const id = $c.attr("data-id");
      const cnt = counts[id];
      const truthCnt = counts[truth[i]];
      const right = cnt === truthCnt;
      $c.addClass(right ? "is-right" : "is-wrong")
        .append(`<span class="rank-count">${cnt} tok</span>`);
    });

    $("#q1-feedback")
      .removeClass("is-correct is-wrong")
      .addClass(res.correct ? "is-correct" : "is-wrong")
      .prop("hidden", false)
      .text(`${res.positions_correct}/${LESSON.quiz1.candidates.length} exact · ${res.pairs_right}/${res.pairs_total} pair orders correct.`);
    $("#q1-submit").text("Locked").prop("disabled", true);
    showFeedback(res.correct,
      res.correct ? "Token ranking matched." : "Order's off.",
      `${res.pairs_right}/${res.pairs_total} pair orderings correct.`);
  });
}

/* Drag-and-drop primitives. Used by Q1 and Q3-temp. */
let dragSrc = null;
function makeDraggable($el) {
  $el.attr("draggable", "true");
  const el = $el[0];
  el.addEventListener("dragstart", e => {
    dragSrc = el;
    $el.addClass("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", $el.data("payload") || "");
  });
  el.addEventListener("dragend", () => {
    $el.removeClass("is-dragging");
    dragSrc = null;
  });
}
function makeDropZone($zone, onDrop) {
  const el = $zone[0];
  el.addEventListener("dragenter", e => { e.preventDefault(); $zone.addClass("is-over"); });
  el.addEventListener("dragover",  e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
  el.addEventListener("dragleave", () => $zone.removeClass("is-over"));
  el.addEventListener("drop", e => {
    e.preventDefault();
    $zone.removeClass("is-over");
    if (dragSrc) onDrop(dragSrc, $zone);
  });
}

/* ============================================================ */
/* === QUIZ 2 — embedding navigation =========================== */
/* ============================================================ */
let q2Idx = 0;
let q2Answers = [];
let q2Marker = null;
let q2Locked = false;

function initQ2() {
  q2Idx = 0;
  q2Answers = [];

  // Build per-puzzle progress dots from the lesson data (no hardcoded count).
  const $dots = $("#q2-progress").empty();
  LESSON.quiz2.puzzles.forEach((_, i) => {
    $('<span class="q2-dot"></span>').toggleClass("is-active", i === 0).appendTo($dots);
  });

  renderQ2();
}

function renderQ2() {
  const puz = LESSON.quiz2.puzzles[q2Idx];
  $("#q2-title").text(
    puz.kind === "interpolate" ? "Where does it live?" :
    puz.kind === "extrapolate" ? "Follow the axis." :
    "Solve the analogy."
  );
  $("#q2-prompt").html(puz.prompt);
  $("#q2-progress .q2-dot").removeClass("is-active is-done").each(function (i) {
    if (i < q2Idx) $(this).addClass("is-done");
    else if (i === q2Idx) $(this).addClass("is-active");
  });
  $("#q2-submit").prop("disabled", true).text("Lock in answer").off("click");
  $("#q2-feedback").prop("hidden", true);

  const $svg = $("#q2-svg");
  drawEmbedMap($svg);
  const anchorSet = new Set(puz.anchors);
  $svg.find(".embed-dot").each(function () {
    const w = $(this).attr("data-word");
    if (!anchorSet.has(w)) $(this).attr("r", 2.5).css("opacity", 0.22);
    else $(this).attr("r", 9).addClass("q2-anchor-dot");
  });
  $svg.find(".embed-label").each(function () {
    const w = $(this).attr("data-word");
    if (!anchorSet.has(w)) $(this).remove();
    else $(this).addClass("q2-anchor-label");
  });

  if (puz.kind === "extrapolate") {
    const aw = EMBED.words[puz.anchors[0]];
    const bw = EMBED.words[puz.anchors[1]];
    const [pAx, pAy] = projXY(aw.xy);
    const [pBx, pBy] = projXY(bw.xy);
    $svg[0].querySelector("#embed-lines").appendChild(svgNS("line", {
      class: "embed-arrow", x1: pAx, y1: pAy, x2: pBx, y2: pBy,
    }));
  }

  q2Marker = null;
  q2Locked = false;
  $svg[0].onclick = (e) => {
    if (q2Locked) return;
    const pt = svgPoint($svg[0], e);
    if (!q2Marker) {
      q2Marker = svgNS("circle", { class: "q2-user-marker", cx: pt.x, cy: pt.y, r: 11 });
      $svg[0].appendChild(q2Marker);
    } else {
      q2Marker.setAttribute("cx", pt.x);
      q2Marker.setAttribute("cy", pt.y);
    }
    $("#q2-submit").prop("disabled", false);
  };

  $("#q2-submit").on("click", () => {
    if (!q2Marker) return;
    q2Locked = true;
    q2Marker.classList.add("is-locked");
    const cx = parseFloat(q2Marker.getAttribute("cx"));
    const cy = parseFloat(q2Marker.getAttribute("cy"));
    const xy = unprojXY(cx, cy);
    q2Answers.push({ kind: puz.kind, target: puz.target, x: xy[0], y: xy[1] });
    track("q2_subpick", { idx: q2Idx, target: puz.target, x: xy[0], y: xy[1] });
    revealQ2Target(puz, $svg, cx, cy);
  });
}

function svgPoint(svg, e) {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function revealQ2Target(puz, $svg, ux, uy) {
  const t = EMBED.words[puz.target];
  if (!t) return;
  const [tx, ty] = projXY(t.xy);
  $svg[0].appendChild(svgNS("circle", { class: "q2-target-marker", cx: tx, cy: ty, r: 9 }));
  const lbl = svgNS("text", {
    class: "embed-label is-highlight",
    x: tx + 12, y: ty + 4,
    style: "fill: var(--green-deep);",
  });
  lbl.textContent = puz.target;
  $svg[0].appendChild(lbl);
  $svg[0].appendChild(svgNS("line", {
    x1: ux, y1: uy, x2: tx, y2: ty,
    style: "stroke: var(--ink-soft); stroke-width: 2; stroke-dasharray: 4 4; opacity: 0.7;",
  }));

  const userXY = unprojXY(ux, uy);
  const d = Math.hypot(t.xy[0] - userXY[0], t.xy[1] - userXY[1]);
  const ok = d < 0.45;
  const isLast = q2Idx === LESSON.quiz2.puzzles.length - 1;
  $("#q2-feedback")
    .prop("hidden", false)
    .removeClass("is-correct is-wrong")
    .addClass(ok ? "is-correct" : "is-wrong")
    .empty()
    .append($('<div class="q-feedback-body"></div>').text(
      `${puz.target} · your distance ${d.toFixed(2)} — ${ok ? "in range." : "off."}`
    ))
    .append($('<button class="btn-ghost q-feedback-btn" id="q2-next"></button>')
      .text(isLast ? "Finish quiz" : "Next puzzle"));
  $("#q2-next").on("click", q2Advance);
  $("#q2-submit").prop("disabled", true).text("Locked");
}

function q2Advance() {
  q2Idx++;
  if (q2Idx >= LESSON.quiz2.puzzles.length) {
    $.ajax({
      url: "/api/quiz_check", method: "POST",
      contentType: "application/json",
      data: JSON.stringify({ qid: "q2", answers: q2Answers }),
    }).done(res => {
      const okCount = res.puzzles.filter(p => p.ok).length;
      showFeedback(res.correct,
        res.correct ? "Mapped it." : "Map a little off.",
        `${okCount} of ${LESSON.quiz2.puzzles.length} close to target. Avg score ${res.avg_score.toFixed(2)}.`);
    });
  } else {
    renderQ2();
  }
}

/* ============================================================ */
/* === QUIZ 3 — three sub-puzzles ============================== */
/* ============================================================ */
let q3Idx = 0;
let q3Answers = [];
let q3Pick = null;
let q3RankLocked = false;

function initQ3() {
  q3Idx = 0;
  q3Answers = [];

  // Dynamic per-puzzle progress dots, matching Q2.
  const $dots = $("#q3-progress").empty();
  LESSON.quiz3.puzzles.forEach((_, i) => {
    $('<span class="q2-dot"></span>').toggleClass("is-active", i === 0).appendTo($dots);
  });

  renderQ3();
}

function renderQ3() {
  const puzzles = LESSON.quiz3.puzzles;
  const puz = puzzles[q3Idx];
  $("#q3-title").text(
    puz.kind === "pick" ? "Pick the most likely." :
    puz.kind === "rank" ? "Rank by likelihood." :
    "Match the temperature."
  );
  $("#q3-prompt").text(
    puz.kind === "temp"
      ? `“${puz.prompt}” — three continuations, three temperatures.`
      : `“${puz.prompt}”`
  );

  $("#q3-progress .q2-dot").removeClass("is-active is-done").each(function (i) {
    if (i < q3Idx) $(this).addClass("is-done");
    else if (i === q3Idx) $(this).addClass("is-active");
  });

  $("#q3-feedback").prop("hidden", true);
  $("#q3-submit").prop("disabled", true).text("Lock in").off("click");

  const $stage = $("#q3-stage").empty();
  if (puz.kind === "pick") renderQ3Pick($stage, puz);
  if (puz.kind === "rank") renderQ3Rank($stage, puz);
  if (puz.kind === "temp") renderQ3Temp($stage, puz);
}

function renderQ3Pick($stage, puz) {
  q3Pick = null;
  const $grid = $('<div class="q3-pick-grid"></div>').appendTo($stage);
  const cards = [...puz.candidates].sort(() => Math.random() - 0.5);
  cards.forEach(c => {
    const $card = $('<div class="q3-pick-card"></div>').text(c).attr("data-id", c);
    $card.on("click", () => {
      $grid.find(".q3-pick-card").removeClass("is-selected");
      $card.addClass("is-selected");
      q3Pick = c;
      $("#q3-submit").prop("disabled", false);
    });
    $grid.append($card);
  });
  $("#q3-submit").on("click", () => submitQ3Pick(puz));
}

function submitQ3Pick(puz) {
  if (!q3Pick) return;
  q3Answers.push({ pick: q3Pick });
  track("q3_subpick", { idx: q3Idx, kind: "pick", pick: q3Pick });
  $("#q3-stage .q3-pick-card").each(function () {
    const id = $(this).attr("data-id");
    if (id === puz.answer) $(this).addClass("is-correct");
    else if (id === q3Pick) $(this).addClass("is-wrong");
  });
  const ok = q3Pick === puz.answer;
  $("#q3-submit").prop("disabled", true).text("Locked");
  showQ3Feedback(ok, puz.explain);
}

function renderQ3Rank($stage, puz) {
  q3RankLocked = false;
  const $wrap = $('<div class="rank-wrap"></div>').appendTo($stage);
  const $slots = $('<div class="rank-slots"></div>').appendTo($wrap);
  for (let i = 0; i < puz.candidates.length; i++) {
    const $row = $('<div class="rank-slot"></div>');
    $('<span class="rank-num"></span>').text(i + 1).appendTo($row);
    $('<div class="rank-drop"></div>').attr("data-slot", i).appendTo($row);
    $slots.append($row);
  }
  const $bank = $('<div class="rank-bank"></div>').appendTo($wrap);
  const shuffled = [...puz.candidates].sort(() => Math.random() - 0.5);
  shuffled.forEach(c => {
    const $card = $('<div class="rank-card"></div>').text(c).attr("data-id", c);
    $card.data("payload", c);
    makeDraggable($card);
    $bank.append($card);
  });

  $stage.find(".rank-drop").each(function () {
    const $drop = $(this);
    makeDropZone($drop, (src, $zone) => {
      if (q3RankLocked) return;
      const $src = $(src);
      const $existing = $zone.find(".rank-card");
      if ($existing.length) $bank.append($existing.removeClass("in-slot"));
      $zone.append($src.addClass("in-slot"));
      $zone.addClass("has-item");
      const filled = $stage.find(".rank-drop").has(".rank-card").length;
      $("#q3-submit").prop("disabled", filled !== puz.candidates.length);
    });
  });
  makeDropZone($bank, (src) => {
    if (q3RankLocked) return;
    const $src = $(src);
    const $old = $src.parent(".rank-drop");
    $bank.append($src.removeClass("in-slot"));
    if ($old.length) $old.removeClass("has-item");
    const filled = $stage.find(".rank-drop").has(".rank-card").length;
    $("#q3-submit").prop("disabled", filled !== puz.candidates.length);
  });

  $("#q3-submit").on("click", () => submitQ3Rank(puz));
}

function submitQ3Rank(puz) {
  const order = [];
  $("#q3-stage .rank-drop").each(function () {
    const $c = $(this).find(".rank-card");
    if ($c.length) order.push($c.attr("data-id"));
  });
  q3RankLocked = true;
  q3Answers.push({ order });
  track("q3_subpick", { idx: q3Idx, kind: "rank", order });
  $("#q3-stage .rank-drop").each(function (i) {
    const $c = $(this).find(".rank-card");
    if (!$c.length) return;
    const right = $c.attr("data-id") === puz.order[i];
    $c.addClass(right ? "is-right" : "is-wrong");
  });
  const positions = order.filter((c, i) => c === puz.order[i]).length;
  const ok = positions >= puz.order.length - 1;
  $("#q3-submit").prop("disabled", true).text("Locked");
  showQ3Feedback(ok, puz.explain);
}

function renderQ3Temp($stage, puz) {
  const $list = $('<div class="q3-temp-list"></div>').appendTo($stage);
  const samples = [...puz.samples].sort(() => Math.random() - 0.5);
  samples.forEach(s => {
    const $row = $('<div class="q3-temp-line"></div>');
    $('<div class="q3-temp-text"></div>').text(`"${s.text}"`).appendTo($row);
    $('<div class="q3-temp-drop"></div>')
      .attr("data-sample", s.text)
      .appendTo($row);
    $list.append($row);
  });
  const $bank = $('<div class="q3-temp-bank"></div>').appendTo($stage);
  const temps = [...puz.temps].sort(() => Math.random() - 0.5);
  temps.forEach(t => {
    const $chip = $('<div class="q3-temp-chip"></div>')
      .text(t.toFixed(1))
      .attr("data-temp", t);
    $chip.data("payload", t);
    makeDraggable($chip);
    $bank.append($chip);
  });

  $stage.find(".q3-temp-drop").each(function () {
    const $drop = $(this);
    makeDropZone($drop, (src, $zone) => {
      const $src = $(src);
      const $existing = $zone.find(".q3-temp-chip");
      if ($existing.length) $bank.append($existing.removeClass("in-slot"));
      $zone.append($src.addClass("in-slot"));
      $zone.addClass("has-item");
      const filled = $stage.find(".q3-temp-drop").has(".q3-temp-chip").length;
      $("#q3-submit").prop("disabled", filled !== puz.temps.length);
    });
  });
  makeDropZone($bank, (src) => {
    const $src = $(src);
    const $old = $src.parent(".q3-temp-drop");
    $bank.append($src.removeClass("in-slot"));
    if ($old.length) $old.removeClass("has-item");
    const filled = $stage.find(".q3-temp-drop").has(".q3-temp-chip").length;
    $("#q3-submit").prop("disabled", filled !== puz.temps.length);
  });

  $("#q3-submit").on("click", () => submitQ3Temp(puz));
}

function submitQ3Temp(puz) {
  const match = {};
  $("#q3-stage .q3-temp-drop").each(function () {
    const sample = $(this).attr("data-sample");
    const $chip = $(this).find(".q3-temp-chip");
    if ($chip.length) match[sample] = parseFloat($chip.attr("data-temp"));
  });
  q3Answers.push({ match });
  track("q3_subpick", { idx: q3Idx, kind: "temp", match });

  let hits = 0;
  puz.samples.forEach(s => {
    const $drop = $(`#q3-stage .q3-temp-drop[data-sample="${s.text}"]`);
    const given = match[s.text];
    const right = given !== undefined && Math.abs(given - s.temperature) < 0.01;
    $drop.addClass(right ? "is-right" : "is-wrong");
    if (right) hits++;
  });
  const ok = hits >= 2;
  $("#q3-submit").prop("disabled", true).text("Locked");
  showQ3Feedback(ok, puz.explain);
}

function showQ3Feedback(ok, explain) {
  const isLast = q3Idx === LESSON.quiz3.puzzles.length - 1;
  const btnLabel = isLast ? "Finish quiz" : "Next puzzle";
  $("#q3-feedback")
    .prop("hidden", false)
    .removeClass("is-correct is-wrong")
    .addClass(ok ? "is-correct" : "is-wrong")
    .empty()
    .append($('<div class="q-feedback-body"></div>').text(explain))
    .append($('<button class="btn-ghost q-feedback-btn" id="q3-next"></button>').text(btnLabel));
  $("#q3-next").on("click", q3Advance);
}

function q3Advance() {
  q3Idx++;
  if (q3Idx >= LESSON.quiz3.puzzles.length) {
    $.ajax({
      url: "/api/quiz_check", method: "POST",
      contentType: "application/json",
      data: JSON.stringify({ qid: "q3", answers: q3Answers }),
    }).done(res => {
      showFeedback(res.correct,
        res.correct ? "Probability whisperer." : "Some calibration left.",
        `${res.sub_correct} of 3 sub-puzzles solid.`);
    });
  } else {
    renderQ3();
  }
}

/* ============================================================ */
/* === Results ================================================ */
/* ============================================================ */
function renderResults() {
  $.get("/api/state").done(state => {
    const quiz = state.quiz || {};
    const score = state.score ?? Object.values(quiz).filter(q => q.correct).length;
    $("#results-score").text(score);
    let title = "Solid run.";
    let feedback = "You've got the core ideas. Give the lessons another pass if anything felt fuzzy.";
    if (score === 3) {
      title = "Perfect score.";
      feedback = "You really get how this works. Tokens, embeddings, attention: all clicked.";
    } else if (score === 2) {
      title = "Solid run.";
      feedback = "Two out of three is strong. Take another look at the one you missed and see if it makes more sense now.";
    } else if (score === 1) {
      title = "Good start.";
      feedback = "You got one. The lessons are still there. A second read-through usually makes the tricky parts land.";
    } else if (score === 0) {
      title = "Worth another try.";
      feedback = "No worries at all. Go back through the lessons at your own pace and try again when you're ready.";
    }
    $("#results-title").text(title);
    $("#results-feedback").text(feedback);

    const $b = $("#results-breakdown").empty();
    [["q1", "Token rank"], ["q2", "Embedding navigation"], ["q3", "Probability puzzles"]]
      .forEach(([k, label]) => {
        const got = quiz[k];
        const ok = got?.correct;
        const status = got ? (ok ? "✓ correct" : "✗ off") : "— not submitted";
        $('<div class="results-row"></div>')
          .toggleClass("is-correct", !!ok)
          .toggleClass("is-wrong", !!got && !ok)
          .append(`<span class="results-label">${label}</span>`)
          .append(`<span class="results-status">${status}</span>`)
          .appendTo($b);
      });
  });

  $("#results-retry").off("click").on("click", () => {
    $.ajax({
      url: "/api/start", method: "POST",
      contentType: "application/json", data: "{}",
    }).done(() => { window.location.href = "/learn/1"; });
  });
}

/* ============================================================ */
/* === Boot ================================================== */
/* ============================================================ */
function hydrate(name) {
  switch (name) {
    case "tokens":        return initTokens();
    case "embeddings":    return initEmbeddings();
    case "attention":     return initAttention();
    case "distribution":  return initDistribution();
    case "loop":          return initLoop();
    case "q1":            return initQ1();
    case "q2":            return initQ2();
    case "q3":            return initQ3();
    case "results":       return renderResults();
  }
}

// If the page was restored from bfcache, reload so the server is the source
// of truth again. Without this, navigating back from /results would show a
// stale 0/3 instead of the user's actual score.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) window.location.reload();
});

async function boot() {
  // Activate the screen the server told us to show.
  const screen = BOOT.startScreen;
  $(`.screen[data-screen="${screen}"]`).addClass("is-active");
  updateProgress();
  configureFooter();

  $("#close-btn").on("click", () => {
    if (confirm("End the lesson?")) window.location.href = "/";
  });
  $("#back-btn").on("click", () => {
    // Browser history is the source of truth; if there's no history, fall back home.
    if (window.history.length > 1) window.history.back();
    else window.location.href = "/";
  });

  // Tell the backend the user landed here. Results don't need lesson/embed.
  track("page_enter", { screen, route: location.pathname });

  if (screen === "results") {
    renderResults();
    return;
  }

  const fetches = [$.get("/api/lesson")];
  if (["embeddings", "q2"].includes(screen)) fetches.push($.get("/api/embeddings"));
  const [lesson, embed] = await Promise.all(fetches);
  LESSON = lesson;
  EMBED = embed || null;
  hydrate(screen);
}

$(boot);
