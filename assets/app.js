/* ── State ───────────────────────────────────────────────── */
let DATA = null;           // full manifest
let activeSongId = null;
let searchQuery = "";
let sortKey = "default";

/* ── Boot ────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("data.json");
    if (!res.ok) throw new Error(res.statusText);
    DATA = await res.json();
  } catch (e) {
    document.getElementById("main").innerHTML =
      `<div class="welcome"><div class="icon">⚠️</div>
       <h2>Could not load data.json</h2><p>${e.message}</p></div>`;
    return;
  }

  // Stats in header
  document.getElementById("stat-songs").textContent = DATA.n_songs;
  document.getElementById("stat-pairs").textContent = DATA.n_pairs;

  // Wire controls
  document.getElementById("search").addEventListener("input", e => {
    searchQuery = e.target.value.toLowerCase();
    renderSongList();
  });

  document.getElementById("sort-select").addEventListener("change", e => {
    sortKey = e.target.value;
    if (activeSongId) renderPairs(activeSongId);
  });

  renderSongList();
  showWelcome();
});

/* ── Sidebar ─────────────────────────────────────────────── */
function renderSongList() {
  const list = document.getElementById("song-list");
  let songs = DATA.songs;

  if (searchQuery) {
    songs = songs.filter(s =>
      s.title.toLowerCase().includes(searchQuery) ||
      s.song_id.toLowerCase().includes(searchQuery)
    );
  }

  list.innerHTML = songs.map(s => {
    const nPairs = s.pairs.length;
    const bpms = [...new Set(s.pairs.map(p => Math.round(p.bpm)))].join(", ");
    const active = s.song_id === activeSongId ? " active" : "";
    return `<li class="song-item${active}" data-id="${s.song_id}" onclick="selectSong('${s.song_id}')">
      <div class="song-title">${s.title}</div>
      <div class="song-meta">${nPairs} pair${nPairs !== 1 ? "s" : ""} · ${bpms} BPM</div>
    </li>`;
  }).join("");

  if (!songs.length) {
    list.innerHTML = `<li style="padding:20px 14px;color:var(--muted);font-size:13px">No songs match</li>`;
  }
}

/* ── Song selection ──────────────────────────────────────── */
function selectSong(songId) {
  activeSongId = songId;
  // Update active state in sidebar
  document.querySelectorAll(".song-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === songId);
  });
  renderPairs(songId);
}

/* ── Main panel ──────────────────────────────────────────── */
function showWelcome() {
  document.getElementById("main").innerHTML = `
    <div class="welcome">
      <div class="icon">🎹</div>
      <h2>MIDI-GPT Transition Examples</h2>
      <p>Select a song from the sidebar to browse AI-generated transitions.
         Each pair shows ground-truth and transcription-conditioned generations
         with piano-roll visualizations and evaluation metrics.</p>
    </div>`;
}

function renderPairs(songId) {
  const song = DATA.songs.find(s => s.song_id === songId);
  if (!song) return;

  let pairs = [...song.pairs];

  // Sort
  if (sortKey === "f1_desc")       pairs.sort((a, b) => b.metrics.mean_note_f1 - a.metrics.mean_note_f1);
  else if (sortKey === "f1_asc")   pairs.sort((a, b) => a.metrics.mean_note_f1 - b.metrics.mean_note_f1);
  else if (sortKey === "jsd_asc")  pairs.sort((a, b) => a.metrics.pitch_jsd - b.metrics.pitch_jsd);
  else if (sortKey === "jsd_desc") pairs.sort((a, b) => b.metrics.pitch_jsd - a.metrics.pitch_jsd);
  else if (sortKey === "penalty")  pairs.sort((a, b) => b.metrics.cross_cross_penalty_per_tok - a.metrics.cross_cross_penalty_per_tok);

  const main = document.getElementById("main");
  main.innerHTML = `
    <div class="main-header">
      <h1>${song.title}</h1>
      <div class="sub">${pairs.length} pair${pairs.length !== 1 ? "s" : ""} · piano-roll transition videos</div>
    </div>
    <div class="pair-grid">
      ${pairs.map(p => renderPairCard(p)).join("")}
    </div>`;

  // After render, init videos
  pairs.forEach(p => initCard(p.pair_id));
}

/* ── Pair card HTML ──────────────────────────────────────── */
function renderPairCard(pair) {
  const pairNum = pair.pair_id.match(/__pair(\d+)$/)?.[1] ?? "?";
  const m = pair.metrics;

  // Instruments
  const insts = [...new Map(pair.instruments.map(i => [i.family, i])).values()];
  const instBadges = insts.map(i =>
    `<span class="badge inst">${i.is_drum ? "🥁" : "🎸"} ${i.family}</span>`
  ).join("");

  // Video tabs
  const tabs = [
    { key: "gt_gen00", label: "GT · Gen 1", cls: "gt" },
    { key: "gt_gen01", label: "GT · Gen 2", cls: "gt" },
    { key: "tr_gen00", label: "TR · Gen 1", cls: "tr" },
    { key: "tr_gen01", label: "TR · Gen 2", cls: "tr" },
  ].filter(t => pair.videos.includes(t.key));

  const tabBtns = tabs.map((t, i) =>
    `<button class="tab-btn ${t.cls}${i === 0 ? " active" : ""}"
             onclick="switchTab('${pair.pair_id}','${t.key}',this)">${t.label}</button>`
  ).join("");

  // Metrics
  const jsds = [
    { label: "Pitch JSD",    val: m.pitch_jsd },
    { label: "Onset JSD",    val: m.onset_jsd },
    { label: "Duration JSD", val: m.duration_jsd },
    { label: "Velocity JSD", val: m.velocity_jsd },
  ];
  const jsdMax = 0.6;
  const jsdRows = jsds.map(j => {
    const pct = Math.min(100, (j.val / jsdMax) * 100).toFixed(1);
    const cls = j.val < 0.15 ? "good" : j.val < 0.35 ? "mid" : "bad";
    return `<span class="jsd-label">${j.label}</span>
            <div class="jsd-bar-wrap"><div class="jsd-bar ${cls}" style="width:${pct}%"></div></div>
            <span class="jsd-val">${j.val.toFixed(3)}</span>`;
  }).join("");

  // Cross-score matrix (per-token values)
  const gtgt = m.cross_gt_ctx_gt_per_tok ?? 0;
  const gttr = m.cross_gt_ctx_tr_per_tok ?? 0;
  const trgt = m.cross_tr_ctx_gt_per_tok ?? 0;
  const trtr = m.cross_tr_ctx_tr_per_tok ?? 0;
  const fmtScore = v => (v === null || v === undefined) ? "—" : v.toFixed(2);

  // Cross-penalty (per token)
  const penalty = m.cross_cross_penalty_per_tok ?? (gttr - gtgt);
  const penaltyCls = penalty > -0.3 ? "good" : penalty > -0.7 ? "mid" : "bad";

  // Note F1
  const f1 = m.mean_note_f1 ?? 0;
  const f1Pct = (f1 * 100).toFixed(1);

  return `
<div class="pair-card" id="card-${pair.pair_id}">
  <div class="card-header">
    <div>
      <div class="pair-label">Pair ${pairNum}</div>
      <div class="badges">
        <span class="badge bpm">♩ ${pair.bpm} BPM</span>
        <span class="badge gap">⏸ ${pair.gap_bars} gap bars</span>
        <span class="badge gap">⊞ ${pair.window_bars}W bars</span>
        ${pair.transcribed ? '<span class="badge tr">transcribed</span>' : ""}
        ${instBadges}
      </div>
    </div>
  </div>

  <div class="video-section">
    <div class="tab-bar">${tabBtns}</div>
    <div class="video-wrap">
      <div class="video-loading" id="vload-${pair.pair_id}">Loading…</div>
      <video id="vid-${pair.pair_id}" controls preload="none" style="display:none"
             oncanplay="document.getElementById('vload-${pair.pair_id}').style.display='none';this.style.display='block'">
      </video>
    </div>
  </div>

  <div class="metrics-section">
    <div class="metrics-toggle" onclick="toggleMetrics('${pair.pair_id}',this)">
      <span class="toggle-label">Metrics</span>
      <span class="chevron">▾</span>
    </div>
    <div class="metrics-body hidden" id="mblock-${pair.pair_id}">

      <div>
        <div class="metric-group-title">M1 — Distribution Similarity (GT vs TR, lower = more similar)</div>
        <div class="jsd-grid">${jsdRows}</div>
      </div>

      <div>
        <div class="metric-group-title">M4 — Cross-Score Matrix (per-token log-prob)</div>
        <div class="cross-matrix">
          <div class="cm-corner"></div>
          <div class="cm-head">GT Gen</div>
          <div class="cm-head">TR Gen</div>
          <div class="cm-row-label">GT Ctx</div>
          <div class="cm-cell diag"><span class="cm-val">${fmtScore(gtgt)}</span><span class="cm-sub">GT↔GT</span></div>
          <div class="cm-cell off"> <span class="cm-val">${fmtScore(gttr)}</span><span class="cm-sub">GT→TR</span></div>
          <div class="cm-row-label">TR Ctx</div>
          <div class="cm-cell off"> <span class="cm-val">${fmtScore(trgt)}</span><span class="cm-sub">TR→GT</span></div>
          <div class="cm-cell diag"><span class="cm-val">${fmtScore(trtr)}</span><span class="cm-sub">TR↔TR</span></div>
        </div>
        <div style="margin-top:8px">
          <div class="cross-penalty">
            <span class="cp-label">Cross-score penalty (GT model: TR gen − GT gen, per token)</span>
            <span class="cp-val ${penaltyCls}">${penalty.toFixed(3)}</span>
          </div>
        </div>
      </div>

      <div>
        <div class="metric-group-title">M5 — Transcription Quality</div>
        <div class="f1-row">
          <span class="f1-label">Note F1</span>
          <div class="f1-bar-wrap"><div class="f1-bar" style="width:${f1Pct}%"></div></div>
          <span class="f1-val">${f1.toFixed(3)}</span>
        </div>
      </div>

    </div>
  </div>
</div>`;
}

/* ── Card interactions ───────────────────────────────────── */
function initCard(pairId) {
  // Load the first available video
  const vid = document.getElementById(`vid-${pairId}`);
  if (!vid) return;
  const firstBtn = document.querySelector(`#card-${pairId} .tab-btn`);
  if (firstBtn) {
    const key = firstBtn.getAttribute("onclick").match(/'([^']+)','([^']+)'/)?.[2];
    if (key) setVideo(pairId, key);
  }
}

function setVideo(pairId, conditionKey) {
  const vid = document.getElementById(`vid-${pairId}`);
  const loader = document.getElementById(`vload-${pairId}`);
  if (!vid || !loader) return;

  const src = `videos/${pairId}/${conditionKey}.mp4`;
  if (vid.dataset.src === src) return;

  vid.dataset.src = src;
  vid.style.display = "none";
  loader.style.display = "flex";
  loader.textContent = "Loading…";

  vid.src = src;
  vid.load();

  vid.onerror = () => {
    loader.textContent = "Video not available";
  };
}

function switchTab(pairId, conditionKey, btn) {
  // Update active tab button
  const card = document.getElementById(`card-${pairId}`);
  card.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  setVideo(pairId, conditionKey);
}

function toggleMetrics(pairId, toggleEl) {
  const block = document.getElementById(`mblock-${pairId}`);
  const isOpen = !block.classList.contains("hidden");
  block.classList.toggle("hidden", isOpen);
  toggleEl.classList.toggle("open", !isOpen);
}
