(function(){
"use strict";

/* ===================== PERSISTENT STATS ===================== */
const STATS_KEY = "stats";
const DEFAULT_DIFF_STATS = { played:0, best:0, lost:0 };
let stats = {
  played:0, lost:0, bestScore:0, currentStreak:0, bestStreak:0,
  totalHintsUsed:0, totalUndosUsed:0,
  byDiff:{ easy:{...DEFAULT_DIFF_STATS}, medium:{...DEFAULT_DIFF_STATS}, hard:{...DEFAULT_DIFF_STATS}, expert:{...DEFAULT_DIFF_STATS}, genius:{...DEFAULT_DIFF_STATS} }
};
// Snapshot of the puzzle that most recently ended (win or loss), shown on
// the Statistics screen's "Current Puzzle" tab.
let lastPuzzle = null;

// NOTE: this file runs as a standalone, deployed site (not inside the
// Claude artifact sandbox), so persistence uses plain localStorage instead
// of window.storage — same approach chesspi's script.js uses for settings
// and stats (see chessPiComprehensiveStats / chessPiSettings).
async function loadStats(){
  try{
    const raw = localStorage.getItem(STATS_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      // Merge (not overwrite) so a save from an earlier version of the game
      // that's missing newer fields (streaks, lost counts, etc.) doesn't
      // leave them undefined and break future increments.
      const byDiff = {};
      Object.keys(stats.byDiff).forEach(k=>{
        byDiff[k] = { ...DEFAULT_DIFF_STATS, ...(stats.byDiff[k]||{}), ...((parsed.byDiff||{})[k]||{}) };
      });
      stats = { ...stats, ...parsed, byDiff };
    }
  }catch(e){ /* no stats yet */ }
  renderWelcomeStats();
}
async function saveStats(){
  try{ localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }catch(e){}
}
function renderWelcomeStats(){
  const el = document.getElementById("welcome-stats");
  if(stats.played > 0){
    el.textContent = `Puzzles solved: ${stats.played}  ·  Best score: ${stats.bestScore}`;
  } else {
    el.textContent = "Your first puzzle is waiting.";
  }
}
function formatDuration(seconds){
  if(seconds==null || isNaN(seconds)) return "-";
  seconds = Math.max(0, Math.round(seconds));
  const m = Math.floor(seconds/60), s = seconds%60;
  return `${m}:${s.toString().padStart(2,"0")}`;
}

/* ===================== PLAYER IDENTITY (for the leaderboard) ===================== */
const IDENTITY_KEY = "player-identity";
let identity = null; // {id, name}

async function loadIdentity(){
  try{
    const raw = localStorage.getItem(IDENTITY_KEY);
    if(raw) identity = JSON.parse(raw);
  }catch(e){ /* not set yet */ }
}
async function saveIdentity(name){
  identity = { id: identity?.id || ("p" + Date.now() + Math.random().toString(36).slice(2,8)), name };
  try{ localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity)); }catch(e){}
}

/* ===================== LEADERBOARD (shared — backed by the Netlify function
   + Blobs store, so every player's entry is really visible to everyone,
   the same way chesspi's get-leaderboard.js / submit-score.js work) ===================== */
async function submitScore(){
  if(!identity) return; // only players who've set a name are listed
  const entry = {
    id: identity.id, name: identity.name,
    bestScore: stats.bestScore, puzzlesSolved: stats.played, puzzlesLost: stats.lost||0,
    bestStreak: stats.bestStreak||0, updatedAt: Date.now(),
  };
  try{
    await fetch('/.netlify/functions/submit-score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      signal: AbortSignal.timeout(10000)
    });
  }catch(e){ /* offline, ignore */ }
}

async function fetchLeaderboard(){
  const response = await fetch('/.netlify/functions/get-leaderboard', { signal: AbortSignal.timeout(10000) });
  if(!response.ok) throw new Error('get-leaderboard returned status ' + response.status);
  const data = await response.json();
  return (data && data.leaderboard) || [];
}

async function renderLeaderboard(){
  const noteEl = document.getElementById("leaderboard-note");
  const listEl = document.getElementById("leaderboard-list");
  const nameRow = document.getElementById("leaderboard-name-row");
  if(!noteEl || !listEl) return;

  nameRow.style.display = identity ? "none" : "flex";
  noteEl.style.display = "block";
  noteEl.textContent = "Loading\u2026";
  listEl.innerHTML = "";

  let entries = [];
  try{
    entries = await fetchLeaderboard();
  }catch(e){
    noteEl.textContent = "Couldn't load the leaderboard right now.";
    return;
  }

  if(entries.length === 0){
    noteEl.textContent = identity ? "No players yet \u2014 be the first!" : "Add a name below to join the leaderboard.";
    return;
  }
  noteEl.style.display = "none";

  listEl.innerHTML = entries.map((e,i)=>{
    const rank = i+1;
    const medal = rank<=3 ? ["&#129351;","&#129352;","&#129353;"][rank-1] : `#${rank}`;
    const isMe = identity && e.id === identity.id;
    return `
      <li class="leaderboard-item${rank<=3?" leaderboard-top rank-"+rank:""}${isMe?" leaderboard-me":""}">
        <div class="leaderboard-rank${rank<=3?" leaderboard-medal":""}">${medal}</div>
        <div class="leaderboard-info">
          <div class="leaderboard-name">${escapeHtml(e.name || "Guest")}</div>
          <div class="leaderboard-meta">Best score ${e.bestScore||0} &middot; ${e.puzzlesSolved||0} solved &middot; streak ${e.bestStreak||0}</div>
        </div>
      </li>`;
  }).join("");
}
function escapeHtml(s){
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

/* ===================== STATISTICS MODAL ===================== */
function renderStatsModal(){
  const setText = (id,val)=>{ const el = document.getElementById(id); if(el) el.textContent = val; };

  // Current Puzzle tab
  if(lastPuzzle){
    setText("current-result", lastPuzzle.result);
    setText("current-difficulty", lastPuzzle.difficulty);
    setText("current-time", lastPuzzle.time);
    setText("current-score", lastPuzzle.result==="Solved" ? `+${lastPuzzle.score}` : "0");
    setText("current-features-used", `${lastPuzzle.hintsUsed} hints, ${lastPuzzle.undosUsed} undos`);
  } else {
    ["current-result","current-difficulty","current-time","current-score","current-features-used"].forEach(id=>setText(id,"-"));
  }

  // Best Records tab
  const curDiffStats = stats.byDiff[currentDiff];
  setText("best-score-diff", curDiffStats ? curDiffStats.best : 0);
  setText("best-score-overall", stats.bestScore || 0);
  setText("best-streak", stats.bestStreak || 0);

  // Overall Statistics tab
  const totalRuns = (stats.played||0) + (stats.lost||0);
  const solveRate = totalRuns>0 ? Math.round((stats.played/totalRuns)*100) : 0;
  setText("total-solved", stats.played||0);
  setText("total-lost", stats.lost||0);
  setText("solve-rate", `${solveRate}%`);
  setText("current-streak", stats.currentStreak||0);
  setText("total-features-used", `${stats.totalHintsUsed||0} hints, ${stats.totalUndosUsed||0} undos`);

  const diffListEl = document.getElementById("diff-stats-list");
  if(diffListEl){
    diffListEl.innerHTML = Object.keys(DIFFS).map(key=>{
      const d = stats.byDiff[key] || {...DEFAULT_DIFF_STATS};
      const attempts = d.played + (d.lost||0);
      return `<div class="diff-stat-item"><span class="diff-label">${DIFFS[key].label}:</span><span class="diff-value">${d.played}/${attempts} solved &middot; best ${d.best}</span></div>`;
    }).join("");
  }
}

/* ===================== END-OF-GAME MODAL NAVIGATION ===================== */
let returnOverlayId = null;
function openEndGameModal(id, fromOverlayId){
  returnOverlayId = fromOverlayId;
  document.getElementById(fromOverlayId).classList.remove("active");
  document.getElementById(id).classList.add("active");
}
function closeEndGameModal(id){
  document.getElementById(id).classList.remove("active");
  if(returnOverlayId) document.getElementById(returnOverlayId).classList.add("active");
}
document.querySelectorAll("[data-open-stats]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    renderStatsModal();
    openEndGameModal("overlay-stats", btn.getAttribute("data-open-stats"));
  });
});
document.querySelectorAll("[data-open-leaderboard]").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    openEndGameModal("overlay-leaderboard", btn.getAttribute("data-open-leaderboard"));
    renderLeaderboard();
  });
});
document.getElementById("stats-back-btn")?.addEventListener("click", ()=> closeEndGameModal("overlay-stats"));
document.getElementById("leaderboard-back-btn")?.addEventListener("click", ()=> closeEndGameModal("overlay-leaderboard"));

document.querySelectorAll(".tab-button").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    document.querySelectorAll(".tab-button").forEach(b=>b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(c=>c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.getAttribute("data-tab")+"-tab")?.classList.add("active");
  });
});

document.getElementById("leaderboard-name-save")?.addEventListener("click", async ()=>{
  const input = document.getElementById("leaderboard-name-input");
  const name = (input.value||"").trim().slice(0,20);
  if(!name) return;
  await saveIdentity(name);
  await submitScore();
  renderLeaderboard();
});

/* ===================== NAVIGATION ===================== */
function showView(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo(0,0);
  document.body.classList.toggle("game-active", id === "view-game");
  if(id === "view-game"){
    requestAnimationFrame(()=>{ scheduleFit(); });
  } else {
    stopTimer();
  }
}
document.querySelectorAll("[data-nav]").forEach(el=>{
  el.addEventListener("click", ()=> showView(el.getAttribute("data-nav")));
});
document.getElementById("btn-start").addEventListener("click", ()=> showView("view-theme"));

/* ===================== PI NETWORK PAYMENTS ===================== */
// Real Pi Network payment integration: Pi SDK on the client, three thin
// Netlify functions (approve / complete / cancel) proxying the Pi Platform
// API on the server, and get-progress / save-progress to persist what a
// player has unlocked against their Pi account. Same pattern as chesspi's
// script.js (Pi.init → Pi.authenticate → Pi.createPayment → server
// approve/complete), just adapted to this game's items and prices, which
// keep the exact figures already laid out in the Pi Features screen below.
const ownedFeatures = {
  levels: new Set(),      // e.g. "expert", "genius" — permanent, individually-purchased unlocks
  themes: new Set(),      // e.g. "aurora", "sepia"  — permanent, individually-purchased unlocks
  toggles: new Set(),     // "zen", "custom"          — permanent, individually-purchased unlocks
  passExpiresAt: null,    // timestamp (ms) the Genius Pass's temporary access runs out, or null
};
const PASS_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // Genius Pass grants 30 days of access per payment

// The pass is a *renting*, not a permanent unlock: while it's active it
// grants access to everything below on top of whatever's permanently
// owned, and once it lapses only the permanently-owned items stay
// unlocked. This is what actually lets "π 4.99 / month" behave like a
// real recurring pass despite the Pi SDK only supporting one-time
// payments — the player just has to come back and pay again to renew.
function hasActivePass(){
  return !!(ownedFeatures.passExpiresAt && Date.now() < ownedFeatures.passExpiresAt);
}

// Local cache so unlocks survive a reload even before/without a Pi login —
// mirrors chesspi's loadPlayerProgressFromLocalCache()/save...ToLocalCache().
const OWNED_KEY = "ownedFeatures";
function loadOwnedFromLocalCache(){
  try{
    const raw = localStorage.getItem(OWNED_KEY);
    if(!raw) return;
    const parsed = JSON.parse(raw);
    (parsed.levels||[]).forEach(v=>ownedFeatures.levels.add(v));
    (parsed.themes||[]).forEach(v=>ownedFeatures.themes.add(v));
    (parsed.toggles||[]).forEach(v=>ownedFeatures.toggles.add(v));
    ownedFeatures.passExpiresAt = (typeof parsed.passExpiresAt === 'number') ? parsed.passExpiresAt : null;
  }catch(e){ /* nothing cached yet */ }
}
function saveOwnedToLocalCache(){
  try{
    localStorage.setItem(OWNED_KEY, JSON.stringify({
      levels:[...ownedFeatures.levels], themes:[...ownedFeatures.themes],
      toggles:[...ownedFeatures.toggles], passExpiresAt: ownedFeatures.passExpiresAt
    }));
  }catch(e){}
}


let toastTimer = null;
function showToast(msg){
  const el = document.getElementById("pi-toast");
  if(!el) return;
  el.textContent = msg;
  el.classList.add("show");
  if(toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove("show"), 2600);
}

/* ---- Pi identity ---- */
let piAccessToken = null;
let piUserUid = null;
let piUsername = null;

try{
  if (typeof Pi !== "undefined") {
    Pi.init({ version: "2.0", sandbox: false }); // set sandbox:true while testing in the Pi Sandbox
  } else {
    console.error("Pi SDK script not loaded — payment features will be unavailable.");
  }
}catch(e){ console.error("Pi.init failed:", e); }

// Called by the Pi SDK if it finds a payment from a previous session that
// never finished. Without resolving it here, Pi Network keeps blocking
// ALL new payments ("Pending Payment Found") until this one is handled.
async function resolveIncompletePayment(payment){
  console.log("Incomplete payment found, attempting to auto-resolve it:", payment);
  const hasTxid = payment && payment.transaction && payment.transaction.txid;
  async function cancelPayment(){
    const response = await fetch('/.netlify/functions/cancel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentId: payment.identifier }),
      signal: AbortSignal.timeout(10000)
    });
    if(!response.ok) throw new Error('Cancel endpoint returned status ' + response.status);
  }
  try{
    if(hasTxid){
      // The payment actually went through on-chain — tell our backend to
      // mark it complete rather than losing track of it.
      const response = await fetch('/.netlify/functions/complete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paymentId: payment.identifier, txid: payment.transaction.txid }),
        signal: AbortSignal.timeout(10000)
      });
      if(!response.ok) throw new Error('Complete endpoint returned status ' + response.status);
    } else {
      // No on-chain transaction was ever made — most likely it was
      // approved in an interrupted session. Re-approving would fail (Pi
      // rejects a second approval), so cancel it to unblock new payments.
      await cancelPayment();
    }
  }catch(err){
    console.error('Primary resolution failed, trying cancel as a fallback:', err);
    try{ await cancelPayment(); }
    catch(err2){
      console.error('Fallback cancel also failed:', err2);
      showToast("A stuck payment from last time couldn't be resolved automatically. Try again shortly.");
    }
  }
}

async function authenticateWithPi(){
  if (typeof Pi === "undefined") throw new Error("Pi SDK isn't available — open this app inside Pi Browser to pay with Pi.");
  const auth = await Pi.authenticate(['username', 'payments'], resolveIncompletePayment);
  if(auth && auth.accessToken && auth.user){
    piAccessToken = auth.accessToken;
    piUserUid = auth.user.uid;
    piUsername = auth.user.username || null;
  }
  return auth;
}

// Pulls this player's Pi-linked purchases from the backend and merges
// (union) them into whatever's cached locally, so nothing already unlocked
// is ever lost — same merge strategy as chesspi's fetchProgressFromServer().
async function fetchOwnedFromServer(){
  if(!piAccessToken) return;
  try{
    const response = await fetch('/.netlify/functions/get-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: piAccessToken }),
      signal: AbortSignal.timeout(10000)
    });
    if(!response.ok) throw new Error('get-progress returned status ' + response.status);
    const server = await response.json();
    (server.unlockedLevels||[]).forEach(v=>ownedFeatures.levels.add(v));
    (server.unlockedThemes||[]).forEach(v=>ownedFeatures.themes.add(v));
    (server.unlockedToggles||[]).forEach(v=>ownedFeatures.toggles.add(v));
    // Take whichever expiry is further out — the server's merge already
    // does this too, but this guards against a stale local cache winning.
    if(typeof server.passExpiresAt === 'number'){
      ownedFeatures.passExpiresAt = Math.max(ownedFeatures.passExpiresAt || 0, server.passExpiresAt);
    }
    saveOwnedToLocalCache();
    renderDiffList(); renderThemeGrid(); renderPiToggles(); renderPiLevels(); renderPiPassStatus();
  }catch(err){ console.error('fetchOwnedFromServer failed (using local cache only):', err); }
}

// Pushes the current local entitlements up to the backend. Safe to call
// anytime; silently no-ops without a verified Pi identity.
async function syncOwnedToServer(){
  saveOwnedToLocalCache();
  if(!piAccessToken) return;
  try{
    await fetch('/.netlify/functions/save-progress', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: piAccessToken,
        progress: {
          unlockedLevels: [...ownedFeatures.levels],
          unlockedThemes: [...ownedFeatures.themes],
          unlockedToggles: [...ownedFeatures.toggles],
          passExpiresAt: ownedFeatures.passExpiresAt
        }
      }),
      signal: AbortSignal.timeout(10000)
    });
  }catch(err){ console.error('syncOwnedToServer failed (entitlement stays cached locally for now):', err); }
}

// Silently authenticates with Pi (if available) on load and pulls the
// player's saved purchases. Wrapped so it never blocks or breaks the game
// outside Pi Browser (regular browser testing, permission declined, etc).
async function initializePiIdentityAndOwnership(){
  loadOwnedFromLocalCache();
  renderDiffList(); renderThemeGrid(); renderPiToggles(); renderPiLevels(); renderPiPassStatus();
  try{
    if (typeof Pi === "undefined") return;
    await authenticateWithPi();
    await fetchOwnedFromServer();
  }catch(err){ console.error('Pi identity init failed (continuing with local entitlements only):', err); }
}

// The pass has no server push notification when it lapses — it's just a
// timestamp — so this checks every minute whether it just crossed that
// timestamp while the app is open, and re-locks anything that was only
// available through it. A page reload after expiry catches this too via
// the isLocked checks in each render function, this just covers a long
// idle session that's still open when it happens.
let _passWasActive = null;
function checkPassExpiryTick(){
  const active = hasActivePass();
  if(_passWasActive !== null && _passWasActive !== active){
    enforceThemeAccess();
    renderDiffList(); renderThemeGrid(); renderPiToggles(); renderPiLevels();
  }
  _passWasActive = active;
  renderPiPassStatus();
}
setInterval(checkPassExpiryTick, 60000);

// Prevents double-tapping a price button from firing two separate
// Pi.createPayment() calls (which could open two payment prompts, or in
// the worst case risk a double charge).
let isProcessingPayment = false;
function setPaymentButtonsBusy(busy){
  document.querySelectorAll('.pi-price-btn, #pi-pass-btn').forEach(el=>{
    el.style.pointerEvents = busy ? 'none' : '';
    if(!el.disabled) el.style.opacity = busy ? '0.6' : '';
  });
}

/**
 * Runs one real Pi purchase end-to-end: authenticate → open the native Pi
 * payment sheet → our approve/complete Netlify functions → Pi Platform
 * API. Resolves once the payment is fully completed on-chain, rejects on
 * cancel ("canceled") or any error.
 */
function purchaseWithPi(productId, label, priceInPi){
  return new Promise((resolve, reject)=>{
    if(isProcessingPayment){ reject(new Error('A payment is already in progress.')); return; }
    isProcessingPayment = true;
    setPaymentButtonsBusy(true);
    (async ()=>{
      try{
        await authenticateWithPi();
        const paymentData = {
          amount: priceInPi,
          memo: `Cross Math — ${label}`,
          metadata: { productId }
        };
        const callbacks = {
          onReadyForServerApproval: async function(paymentId){
            try{
              const response = await fetch('/.netlify/functions/approve', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentId }),
                signal: AbortSignal.timeout(10000)
              });
              if(!response.ok) throw new Error('Approval failed');
            }catch(error){
              console.error('Approval error:', error);
              showToast('Payment approval failed: ' + error.message);
            }
          },
          onReadyForServerCompletion: async function(paymentId, txid){
            try{
              const response = await fetch('/.netlify/functions/complete', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ paymentId, txid }),
                signal: AbortSignal.timeout(10000)
              });
              if(!response.ok) throw new Error('Completion failed');
              resolve({ paymentId, txid });
            }catch(error){
              console.error('Completion error:', error);
              reject(error);
            }finally{
              isProcessingPayment = false;
              setPaymentButtonsBusy(false);
            }
          },
          onCancel: function(paymentId){
            console.log('Payment canceled:', paymentId);
            isProcessingPayment = false;
            setPaymentButtonsBusy(false);
            reject(new Error('canceled'));
          },
          onError: function(error, payment){
            console.error('Payment error:', error, payment);
            isProcessingPayment = false;
            setPaymentButtonsBusy(false);
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        };
        Pi.createPayment(paymentData, callbacks);
      }catch(error){
        isProcessingPayment = false;
        setPaymentButtonsBusy(false);
        reject(error);
      }
    })();
  });
}

/**
 * Buys one feature (level / theme / toggle) with real Pi. This is what the
 * old client-side-only preview used to fake: it now authenticates, opens
 * the native Pi payment sheet, waits for our backend to approve + complete
 * the payment against the Pi Platform API, and only then grants and
 * persists the unlock.
 */
async function buyFeature(key, label, price, onSuccess){
  try{
    showToast(`Opening Pi payment for "${label}" (\u03c0 ${price})\u2026`);
    await purchaseWithPi(key, label, price);
    onSuccess();
    await syncOwnedToServer();
    showToast(`Payment complete — "${label}" unlocked!`);
  }catch(err){
    if(err && err.message === 'canceled'){ showToast('Payment canceled.'); }
    else { console.error('buyFeature failed:', err); showToast('Payment failed: ' + (err && err.message ? err.message : 'unknown error')); }
  }
}

/**
 * Buys the Genius Pass. The Pi Payments SDK only supports one-time
 * payments, not recurring billing, so a real subscription isn't possible —
 * but a renting model is: each π 4.99 payment grants full access for 30
 * days (extending from the current expiry if it's already active, so
 * renewing early never loses time), and access is re-checked continuously
 * (see hasActivePass()/checkPassExpiryTick()) so it actually locks back up
 * once the 30 days run out, same as the "pay again next month" behavior
 * you'd get from a true subscription.
 */
async function buyPass(){
  try{
    showToast('Opening Pi payment for the Genius Pass (\u03c0 4.99)\u2026');
    await purchaseWithPi('pass', 'Genius Pass (30 days)', 4.99);
    const base = hasActivePass() ? ownedFeatures.passExpiresAt : Date.now();
    ownedFeatures.passExpiresAt = base + PASS_DURATION_MS;
    renderDiffList(); renderThemeGrid(); renderPiToggles(); renderPiPassStatus();
    await syncOwnedToServer();
    showToast('Payment complete — everything unlocked for 30 days!');
  }catch(err){
    if(err && err.message === 'canceled'){ showToast('Payment canceled.'); }
    else { console.error('buyPass failed:', err); showToast('Payment failed: ' + (err && err.message ? err.message : 'unknown error')); }
  }
}

// Updates the pass button's label to reflect whether it's currently
// active (and how many days are left) or lapsed and needs renewing. The
// button stays clickable either way — renewing early just extends it.
function renderPiPassStatus(){
  const btn = document.getElementById("pi-pass-btn");
  if(!btn) return;
  if(hasActivePass()){
    const msLeft = ownedFeatures.passExpiresAt - Date.now();
    const daysLeft = Math.max(1, Math.ceil(msLeft / (24*60*60*1000)));
    btn.textContent = `Active \u2014 ${daysLeft}d left \u00b7 Renew with \u03c0`;
  } else {
    btn.textContent = "Subscribe with \u03c0";
  }
}
function renderPiToggles(){
  const zenName = document.getElementById("pi-name-zen");
  const customName = document.getElementById("pi-name-custom");
  const zenUnlocked = ownedFeatures.toggles.has("zen") || hasActivePass();
  const customUnlocked = ownedFeatures.toggles.has("custom") || hasActivePass();
  document.querySelectorAll('[data-buy="zen"]').forEach(b=>{
    if(zenUnlocked){ b.textContent = ownedFeatures.toggles.has("zen") ? "Owned" : "Included"; b.classList.add("owned"); b.disabled = true; }
    else { b.textContent = "\u03c0 1.5"; b.classList.remove("owned"); b.disabled = false; }
  });
  document.querySelectorAll('[data-buy="custom"]').forEach(b=>{
    if(customUnlocked){ b.textContent = ownedFeatures.toggles.has("custom") ? "Owned" : "Included"; b.classList.add("owned"); b.disabled = true; }
    else { b.textContent = "\u03c0 2"; b.classList.remove("owned"); b.disabled = false; }
  });
  if(zenName){
    const tag = zenName.querySelector(".owned-tag");
    if(tag) tag.remove();
    if(zenUnlocked) zenName.insertAdjacentHTML("beforeend", ` <span class="owned-tag">${ownedFeatures.toggles.has("zen") ? "Owned" : "Pass"}</span>`);
  }
  if(customName){
    const tag = customName.querySelector(".owned-tag");
    if(tag) tag.remove();
    if(customUnlocked) customName.insertAdjacentHTML("beforeend", ` <span class="owned-tag">${ownedFeatures.toggles.has("custom") ? "Owned" : "Pass"}</span>`);
  }
}
function renderPiLevels(){
  const wrap = document.getElementById("pi-levels");
  if(!wrap) return;
  wrap.innerHTML = "";
  ["hard","expert","genius"].forEach(key=>{
    const d = DIFFS[key];
    const ownedPermanently = ownedFeatures.levels.has(key);
    const unlockedViaPass = !ownedPermanently && hasActivePass();
    const unlocked = ownedPermanently || unlockedViaPass;
    const card = document.createElement("div");
    card.className = "pi-card";
    card.innerHTML = `
      <div class="pi-icon">&#128274;</div>
      <div class="pi-info">
        <div class="name">${d.label} level ${ownedPermanently ? '<span class="owned-tag">Owned</span>' : unlockedViaPass ? '<span class="owned-tag">Pass</span>' : ""}</div>
        <div class="desc">${d.desc}</div>
        ${unlocked ? "" : `<button class="try-link" data-try="${key}">Try 1 puzzle free</button>`}
      </div>
      <button class="pi-price-btn ${unlocked ? "owned":""}" data-buy="level:${key}" ${unlocked?"disabled":""}>
        ${ownedPermanently ? "Owned" : unlockedViaPass ? "Included" : `<span class="pi-symbol">&pi;</span> ${d.price}`}
      </button>
    `;
    wrap.appendChild(card);
  });
}
document.getElementById("pi-levels")?.addEventListener("click", (e)=>{
  const tryBtn = e.target.closest("[data-try]");
  if(tryBtn){
    currentDiff = tryBtn.getAttribute("data-try");
    startNewGame();
    showView("view-game");
  }
});
document.body.addEventListener("click", (e)=>{
  const btn = e.target.closest("[data-buy]");
  if(!btn || btn.disabled) return;
  const key = btn.getAttribute("data-buy");
  if(key === "pass"){ buyPass(); return; }
  if(key.startsWith("level:")){
    const lvl = key.split(":")[1];
    const d = DIFFS[lvl];
    buyFeature(key, d.label+" level", d.price, ()=>{ ownedFeatures.levels.add(lvl); renderDiffList(); renderPiLevels(); });
    return;
  }
  if(key.startsWith("theme:")) return; // handled by the theme card's own click handler
  if(key === "zen" || key === "custom"){
    const label = key === "zen" ? "Zen Mode" : "Custom Puzzle Generator";
    const price = key === "zen" ? 1.5 : 2;
    buyFeature(key, label, price, ()=>{ ownedFeatures.toggles.add(key); renderPiToggles(); });
    return;
  }
  const consumables = {
    hints3:  { label:"+3 Hints",       price:0.5 },
    undos3:  { label:"+3 Undos",       price:0.5 },
    lives:   { label:"Refill lives",   price:0.75 },
    time30:  { label:"+30 seconds",    price:0.5 },
  };
  if(consumables[key]){
    const c = consumables[key];
    buyConsumable(key, c.label, c.price);
  }
});

// One-off boosts (hints/undos/lives/time) apply straight to the puzzle in
// progress. If the store was opened from the main menu with no puzzle
// active yet, they're queued and applied automatically the moment the
// next puzzle starts (see newPuzzleRound()) — a paid purchase should never
// just be lost because there was nothing to apply it to yet.
let pendingConsumables = { hints:0, undos:0, refillLives:false, extraSeconds:0 };
function applyConsumable(key){
  if(key === 'hints3'){
    if(game){ game.hintsLeft += 3; updateFooter(); }
    else pendingConsumables.hints += 3;
  } else if(key === 'undos3'){
    if(game){ game.undosLeft += 3; updateFooter(); }
    else pendingConsumables.undos += 3;
  } else if(key === 'lives'){
    if(game){ game.lives = DIFFS[currentDiff].lives; renderHearts(); }
    else pendingConsumables.refillLives = true;
  } else if(key === 'time30'){
    if(game){ game.timeLeft = (game.timeLeft||0) + 30; updateTimerDisplay(); }
    else pendingConsumables.extraSeconds += 30;
  }
}
async function buyConsumable(key, label, price){
  try{
    showToast(`Opening Pi payment for "${label}" (\u03c0 ${price})\u2026`);
    await purchaseWithPi(key, label, price);
    applyConsumable(key);
    showToast(`Payment complete — ${label} applied!`);
  }catch(err){
    if(err && err.message === 'canceled'){ showToast('Payment canceled.'); }
    else { console.error('buyConsumable failed:', err); showToast('Payment failed: ' + (err && err.message ? err.message : 'unknown error')); }
  }
}

/* ===================== THEMES ===================== */
const THEMES = [
  {id:"ledger", name:"Ledger", desc:"Crisp graph-paper light", swatches:["#EEF1F6","#3B5BDB","#E8A33D"]},
  {id:"chalk", name:"Chalkboard", desc:"Dark mode, easy on the eyes", swatches:["#141A26","#6EA8FF","#F2B84B"]},
  {id:"ocean", name:"Ocean", desc:"Cool teal & sand", swatches:["#E8F5F5","#0E9594","#EFA85C"]},
  {id:"plum", name:"Plum", desc:"Warm rose & ink", swatches:["#F7ECF2","#C43D6B","#E8A33D"]},
  {id:"aurora", name:"Aurora", desc:"Neon violet on deep indigo", swatches:["#0B0F2E","#8B6BFF","#FF6FB0"], locked:true, price:1.5},
  {id:"sepia", name:"Sepia", desc:"Warm vintage paper", swatches:["#F1E6D0","#9C6B3E","#C98A3D"], locked:true, price:1.5},
];
let currentTheme = "ledger";

function renderThemeGrid(){
  renderThemeGridInto("theme-grid", false);
  renderThemeGridInto("pi-theme-grid", true);
}
// If the equipped theme was only available through the Genius Pass and the
// pass just lapsed, fall back to the default theme rather than leaving an
// inaccessible theme visually applied.
function enforceThemeAccess(){
  const t = THEMES.find(x=>x.id===currentTheme);
  if(t && t.locked && !ownedFeatures.themes.has(t.id) && !hasActivePass()){
    currentTheme = "ledger";
    document.body.setAttribute("data-theme", "ledger");
  }
}
function renderThemeGridInto(wrapId, storeMode){
  const wrap = document.getElementById(wrapId);
  if(!wrap) return;
  wrap.innerHTML = "";
  THEMES.forEach(t=>{
    const ownedPermanently = ownedFeatures.themes.has(t.id);
    const unlockedViaPass = t.locked && !ownedPermanently && hasActivePass();
    const isLocked = t.locked && !ownedPermanently && !unlockedViaPass;
    const card = document.createElement("div");
    card.className = "theme-card" + (t.id===currentTheme ? " selected":"") + (isLocked ? " locked":"");
    card.innerHTML = `
      <div class="swatch-row">${t.swatches.map(s=>`<div class="swatch" style="background:${s}"></div>`).join("")}</div>
      <div class="name">${t.name} ${unlockedViaPass ? '<span class="owned-tag">Pass</span>' : ""}</div>
      <div class="desc">${t.desc}</div>
      ${isLocked ? `<div class="lock-chip">&#128274; <span class="pi-symbol">&pi;</span> ${t.price}</div>` : ""}
      <div class="check">&#10003;</div>
    `;
    card.addEventListener("click", ()=>{
      if(isLocked){
        if(storeMode){
          buyFeature("theme:"+t.id, `${t.name} theme`, t.price, ()=>{ ownedFeatures.themes.add(t.id); renderThemeGrid(); });
        } else {
          showView("view-pi-store");
        }
        return;
      }
      currentTheme = t.id;
      document.body.setAttribute("data-theme", t.id);
      renderThemeGrid();
    });
    wrap.appendChild(card);
  });
}

/* ===================== DIFFICULTY CONFIG ===================== */
const DIFFS = {
  easy:   { label:"Easy",   badge:"E", k:3, ops:["+","-"],         range:[1,12], maxVal:60,  blanks:4,  lives:5, hints:1, undos:1, base:50,  timeLimit:90,  desc:"Small numbers. Addition and subtraction only." },
  medium: { label:"Medium", badge:"M", k:3, ops:["+","-","*"],     range:[1,15], maxVal:150, blanks:6,  lives:4, hints:2, undos:2, base:80,  timeLimit:120, desc:"Same size grid, now with multiplication." },
  hard:   { label:"Hard",   badge:"H", k:4, ops:["+","-","*","/"], range:[1,9],  maxVal:200, blanks:9,  lives:3, hints:2, undos:2, base:120, timeLimit:180, desc:"A bigger grid with all four operations.", price:1.25 },
  expert: { label:"Expert", badge:"X", k:4, ops:["+","-","*","/"], range:[1,9],  maxVal:300, blanks:14, lives:2, hints:0, undos:0, base:160, timeLimit:240, desc:"Maximum blanks, no hints or undos. No room for error.", price:2 },
  genius: { label:"Genius", badge:"G", k:5, ops:["+","-","*","/"], range:[1,9],  maxVal:400, blanks:18, lives:2, hints:0, undos:0, base:240, timeLimit:300, desc:"A full 5\u00d75 grid. No hints, no undos, no room for error.", price:3.5 },
};
let currentDiff = "medium";

function renderDiffList(){
  const wrap = document.getElementById("diff-list");
  wrap.innerHTML = "";
  Object.keys(DIFFS).forEach(key=>{
    const d = DIFFS[key];
    const best = stats.byDiff[key] ? stats.byDiff[key].best : 0;
    const isLocked = !!d.price && !ownedFeatures.levels.has(key) && !hasActivePass();
    const card = document.createElement("div");
    card.className = "diff-card diff-"+key + (isLocked ? " locked":"");
    card.innerHTML = `
      <div class="badge">${isLocked ? "&#128274;" : d.badge}</div>
      <div class="info">
        <div class="name">${d.label}</div>
        <div class="desc">${d.desc}</div>
        ${isLocked ? `<div class="lock-chip"><span class="pi-symbol">&pi;</span> ${d.price} to unlock</div>` : (best ? `<div class="best">Best score: ${best}</div>` : "")}
      </div>
      <div class="chev">&rsaquo;</div>
    `;
    card.addEventListener("click", ()=>{
      if(isLocked){ showView("view-pi-store"); return; }
      currentDiff = key;
      startNewGame();
      showView("view-game");
    });
    wrap.appendChild(card);
  });
}

/* ===================== PUZZLE GENERATOR (BACKTRACKING) ===================== */
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }

function applyOp(a, op, b){
  switch(op){
    case "+": return a+b;
    case "-": return a-b;
    case "*": return a*b;
    case "/":
      if(b===0) return null;
      if(a % b !== 0) return null;
      return a/b;
  }
  return null;
}
/**
 * Evaluates an operand/operator chain honoring standard order of operations:
 * every x and / is resolved first (left to right among themselves), and only
 * then are the remaining + and - folded in (left to right). Every intermediate
 * result — at either pass — must stay an integer within [1, maxVal], the same
 * bounds enforced by applyOp/the original left-to-right version.
 */
function evalChain(operands, ops, maxVal){
  if(operands[0]<1 || operands[0]>maxVal) return null;

  // Pass 1: collapse every * and / on the fly, left to right.
  const vals = [operands[0]];
  const pendingOps = []; // the +/- ops that survive to pass 2
  for(let i=0;i<ops.length;i++){
    const op = ops[i];
    const b = operands[i+1];
    if(op==="*" || op==="/"){
      const a = vals[vals.length-1];
      const r = applyOp(a, op, b);
      if(r===null || !Number.isInteger(r) || r<1 || r>maxVal) return null;
      vals[vals.length-1] = r;
    } else {
      vals.push(b);
      pendingOps.push(op);
    }
  }

  // Pass 2: fold the remaining + and - left to right.
  let acc = vals[0];
  for(let i=0;i<pendingOps.length;i++){
    const r = applyOp(acc, pendingOps[i], vals[i+1]);
    if(r===null || !Number.isInteger(r) || r<1 || r>maxVal) return null;
    acc = r;
  }
  return acc;
}
function allOpCombos(opsAllowed, n){
  if(n===0) return [[]];
  let combos=[[]];
  for(let i=0;i<n;i++){
    const next=[];
    for(const c of combos) for(const op of opsAllowed) next.push([...c, op]);
    combos = next;
  }
  return combos;
}
function shuffleCopy(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

/**
 * Builds a full cross-math grid with true backtracking search (depth-first,
 * with constraint checks + undo at every cell) instead of random generate-and-test.
 * Everything runs locally in the browser — no server needed; a k x k grid
 * (k is at most 4) is tiny, so a well-pruned backtracking search resolves it
 * essentially instantly.
 *
 * Search order:
 *   1) Fill the (k-1) x (k-1) block of free operand cells row by row.
 *      As soon as a row's operands are complete, immediately try operator
 *      combos for that row so we discover dead ends (and backtrack) as early
 *      as possible, instead of only validating at the very end.
 *   2) Once all rows are placed, solve each column's operator chain in turn
 *      (its operands are already fixed by step 1 — no freedom left there).
 *   3) Finally solve the bottom-right cell, which must simultaneously satisfy
 *      the last row's equation and the last column's equation.
 * At every step, a "no duplicate number in the same row" constraint is
 * enforced immediately, so invalid branches are pruned as early as possible
 * rather than discovered after the whole grid is built.
 */
function generatePuzzle(k, opsAllowed, numRange, maxVal, maxSteps){
  maxSteps = maxSteps || (k>=5 ? 800000 : 300000);
  let steps = 0;

  const V = Array.from({length:k}, ()=>Array(k).fill(null));
  const opRow = Array.from({length:k}, ()=>null);
  const opCol = Array.from({length:k}, ()=>null);
  // rowUsed[r] / colUsed[c]: values already placed in that row/column so far,
  // kept in sync via placeCell/clearCell below so no number repeats down a
  // column either, not just across a row.
  const rowUsed = Array.from({length:k}, ()=>new Set());
  const colUsed = Array.from({length:k}, ()=>new Set());

  function placeCell(r,c,v){ V[r][c]=v; rowUsed[r].add(v); colUsed[c].add(v); }
  function clearCell(r,c){ const v=V[r][c]; if(v!==null){ rowUsed[r].delete(v); colUsed[c].delete(v); } V[r][c]=null; }

  const candidateValues = [];
  for(let v=numRange[0]; v<=numRange[1]; v++) candidateValues.push(v);
  const opCombos = allOpCombos(opsAllowed, k-2); // shared shape for both row & column chains

  const freeCount = (k-1)*(k-1); // free operand cells
  const colCount  = k-1;         // columns whose result still needs solving
  // total "cells" to decide = freeCount + colCount + 1 (the final corner)

  function solveFreeCell(idx){
    const r = Math.floor(idx/(k-1));
    const c = idx % (k-1);

    for(const v of shuffleCopy(candidateValues)){
      steps++;
      if(steps > maxSteps) return false;
      if(rowUsed[r].has(v) || colUsed[c].has(v)) continue; // no repeat in this row OR this column
      placeCell(r,c,v);

      if(c === k-2){
        // last operand of this row -> immediately try to complete the row's equation
        for(const combo of shuffleCopy(opCombos)){
          const rres = evalChain(V[r].slice(0,k-1), combo, maxVal);
          if(rres===null) continue;
          if(rowUsed[r].has(rres) || colUsed[k-1].has(rres)) continue; // unique in the row, unique in the last column
          placeCell(r,k-1,rres);
          opRow[r] = combo;
          if(solve(idx+1)) return true;
          clearCell(r,k-1);
          opRow[r] = null;
        }
      } else {
        if(solve(idx+1)) return true;
      }
      clearCell(r,c); // undo before trying the next candidate value
    }
    return false;
  }

  function solveColumn(idx){
    const c = idx - freeCount;
    const operands = [];
    for(let r=0;r<k-1;r++) operands.push(V[r][c]);

    for(const combo of shuffleCopy(opCombos)){
      steps++;
      if(steps > maxSteps) return false;
      const cres = evalChain(operands, combo, maxVal);
      if(cres===null) continue;
      if(colUsed[c].has(cres) || rowUsed[k-1].has(cres)) continue; // unique in this column, unique in the bottom row
      placeCell(k-1,c,cres);
      opCol[c] = combo;
      if(solve(idx+1)) return true;
      clearCell(k-1,c);
      opCol[c] = null;
    }
    return false; // backtrack — this column has no valid operators given current grid
  }

  function solveCorner(){
    const rowOperands = V[k-1].slice(0,k-1);
    const colOperands = [];
    for(let r=0;r<k-1;r++) colOperands.push(V[r][k-1]);

    for(const cr of shuffleCopy(opCombos)){
      steps++;
      if(steps > maxSteps) return false;
      const rres = evalChain(rowOperands, cr, maxVal);
      if(rres===null) continue;
      if(rowUsed[k-1].has(rres) || colUsed[k-1].has(rres)) continue; // unique in last row AND last column
      for(const cc of shuffleCopy(opCombos)){
        const cres = evalChain(colOperands, cc, maxVal);
        if(cres===rres){
          placeCell(k-1,k-1,rres);
          opRow[k-1] = cr;
          opCol[k-1] = cc;
          return true;
        }
      }
    }
    return false;
  }

  function solve(idx){
    if(idx < freeCount) return solveFreeCell(idx);
    if(idx < freeCount + colCount) return solveColumn(idx);
    return solveCorner();
  }

  const ok = solve(0);
  if(!ok) return null;
  return { V, opRow, opCol, k };
}

/* ===================== GAME STATE ===================== */
let game = null; // {puzzle, blanks:Set("r,c"), values:{}, selected, bank:[], undoStack, lives, hintsLeft, undosLeft, stage, score, mistakesThisPuzzle}
let sessionStage = 1;
let sessionScore = 0;

function opSymbol(op){ return op==="*" ? "&times;" : op==="/" ? "&divide;" : op; }

function startNewGame(){
  sessionStage = 1;
  sessionScore = 0;
  newPuzzleRound();
}

function newPuzzleRound(){
  const cfg = DIFFS[currentDiff];
  const budgets = cfg.k >= 5 ? [800000, 2500000, 6000000] : [300000, 1000000, 3000000];
  let puzzle = generatePuzzle(cfg.k, cfg.ops, cfg.range, cfg.maxVal, budgets[0]);
  if(!puzzle) puzzle = generatePuzzle(cfg.k, cfg.ops, cfg.range, cfg.maxVal, budgets[1]);
  if(!puzzle) puzzle = generatePuzzle(cfg.k, cfg.ops, cfg.range, cfg.maxVal, budgets[2]);
  const k = cfg.k;

  // pick blank cells among the k*k value cells
  const allCells = [];
  for(let r=0;r<k;r++) for(let c=0;c<k;c++) allCells.push(r+","+c);
  shuffleArr(allCells);
  const blanks = new Set(allCells.slice(0, Math.min(cfg.blanks, allCells.length)));

  // build bank: correct answers + a few distractors that never collide with
  // an actual answer value (or each other) — a distractor that matched an
  // answer would let a mis-placed tile register as "correct" by accident.
  const answers = [...blanks].map(key=>{
    const [r,c] = key.split(",").map(Number);
    return puzzle.V[r][c];
  });
  const usedValues = new Set(answers);
  const distractorCount = Math.max(2, Math.round(answers.length/2));
  const distractors = [];
  for(let i=0;i<distractorCount;i++){
    let d = null;
    for(let attempt=0; attempt<20; attempt++){
      let candidate = answers[randInt(0,answers.length-1)] + randInt(-3,3);
      if(candidate<1) candidate = randInt(1,9);
      if(!usedValues.has(candidate)){ d = candidate; break; }
    }
    if(d===null){
      // fallback: the +-3 jitter kept landing on taken values — sweep for any free one
      for(let v=1; v<=99; v++){ if(!usedValues.has(v)){ d = v; break; } }
    }
    usedValues.add(d);
    distractors.push(d);
  }
  const bankValues = answers.concat(distractors);
  shuffleArr(bankValues);

  game = {
    puzzle, k, blanks,
    filled: {},           // key -> {value, tileId}
    bank: bankValues.map((v,i)=>({id:"t"+i, value:v, used:false})),
    selected: null,
    undoStack: [],
    lives: cfg.lives,
    hintsLeft: cfg.hints,
    undosLeft: cfg.undos,
    mistakes: 0,
    elapsedSeconds: 0,
  };

  // Apply anything bought via the Pi store before a puzzle was active.
  if(pendingConsumables.hints){ game.hintsLeft += pendingConsumables.hints; pendingConsumables.hints = 0; }
  if(pendingConsumables.undos){ game.undosLeft += pendingConsumables.undos; pendingConsumables.undos = 0; }
  if(pendingConsumables.refillLives){ game.lives = cfg.lives; pendingConsumables.refillLives = false; }

  document.getElementById("diff-pill").textContent = cfg.label;
  document.getElementById("stat-stage").textContent = sessionStage;
  document.getElementById("stat-score").textContent = sessionScore;
  renderHearts();
  renderGrid();
  renderBank();
  updateFooter();
  scheduleFit();
  startTimer();
}

/* ===================== TIMER ===================== */
let timerInterval = null;
function startTimer(){
  stopTimer();
  const cfg = DIFFS[currentDiff];
  game.timeLeft = cfg.timeLimit;
  if(pendingConsumables.extraSeconds){ game.timeLeft += pendingConsumables.extraSeconds; pendingConsumables.extraSeconds = 0; }
  updateTimerDisplay();
  timerInterval = setInterval(()=>{
    game.timeLeft -= 1;
    game.elapsedSeconds = (game.elapsedSeconds || 0) + 1;
    if(game.timeLeft <= 0){
      game.timeLeft = 0;
      updateTimerDisplay();
      onTimeUp();
      return;
    }
    updateTimerDisplay();
  }, 1000);
}
function stopTimer(){
  if(timerInterval){ clearInterval(timerInterval); timerInterval = null; }
}
function updateTimerDisplay(){
  if(!game || game.timeLeft==null) return;
  const m = Math.floor(game.timeLeft / 60);
  const s = game.timeLeft % 60;
  const el = document.getElementById("stat-time");
  if(el){
    el.textContent = `${m}:${s.toString().padStart(2,"0")}`;
    el.classList.toggle("urgent", game.timeLeft <= 10);
  }
}
function onTimeUp(){
  // time penalty mirrors a wrong tile: costs one life
  game.lives -= 1;
  renderHearts();
  if(game.lives<=0){
    showLose(); // ends the run — stopTimer() runs inside showLose()
  } else {
    startTimer(); // a fresh countdown to keep solving the same puzzle
  }
}

function shuffleArr(arr){
  for(let i=arr.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [arr[i],arr[j]] = [arr[j],arr[i]];
  }
}

function renderHearts(){
  const cfg = DIFFS[currentDiff];
  let s = "";
  for(let i=0;i<cfg.lives;i++) s += i<game.lives ? "&hearts;" : "&#9825;";
  document.getElementById("stat-hearts").innerHTML = s;
}

function renderGrid(){
  const k = game.k;
  const dim = 2*k - 1;
  const gridEl = document.getElementById("grid");
  gridEl.style.gridTemplateColumns = `repeat(${dim}, var(--cell-size, 52px))`;
  gridEl.style.gridTemplateRows = `repeat(${dim}, var(--cell-size, 52px))`;
  gridEl.innerHTML = "";

  for(let row=0; row<dim; row++){
    for(let col=0; col<dim; col++){
      const cell = document.createElement("div");
      if(row%2===0 && col%2===0){
        const r = row/2, c = col/2;
        const key = r+","+c;
        cell.classList.add("gcell");
        if(game.blanks.has(key)){
          cell.classList.add("blank");
          cell.dataset.key = key;
          const f = game.filled[key];
          if(f){
            cell.classList.add("filled");
            cell.textContent = f.value;
          } else {
            cell.textContent = "";
          }
          if(game.selected === key) cell.classList.add("selected");
          cell.addEventListener("click", ()=> onBlankClick(key));
        } else {
          cell.classList.add("given");
          cell.textContent = game.puzzle.V[r][c];
        }
      } else if(row%2===0 && col%2===1){
        const r = row/2, gapIdx = (col-1)/2;
        cell.classList.add(gapIdx === k-2 ? "eq" : "op");
        cell.innerHTML = gapIdx === k-2 ? "=" : opSymbol(game.puzzle.opRow[r][gapIdx]);
      } else if(row%2===1 && col%2===0){
        const c = col/2, gapIdx = (row-1)/2;
        cell.classList.add(gapIdx === k-2 ? "eq" : "op");
        cell.innerHTML = gapIdx === k-2 ? "=" : opSymbol(game.puzzle.opCol[c][gapIdx]);
      } else {
        cell.style.visibility = "hidden";
      }
      gridEl.appendChild(cell);
    }
  }
}

function renderBank(){
  const bankEl = document.getElementById("bank");
  bankEl.innerHTML = "";
  game.bank.forEach(t=>{
    const tile = document.createElement("div");
    tile.className = "tile" + (t.used ? " used" : "");
    tile.textContent = t.value;
    tile.dataset.id = t.id;
    tile.addEventListener("click", ()=> onTileClick(t.id));
    bankEl.appendChild(tile);
  });
}

function fitGameLayout(){
  if(!game) return;
  const panel = document.querySelector(".grid-panel");
  const gridEl = document.getElementById("grid");
  const bankEl = document.getElementById("bank");
  if(!panel || !gridEl) return;

  const dim = 2*game.k - 1;
  const panelStyle = getComputedStyle(panel);
  const padX = parseFloat(panelStyle.paddingLeft) + parseFloat(panelStyle.paddingRight);
  const padY = parseFloat(panelStyle.paddingTop) + parseFloat(panelStyle.paddingBottom);
  const availW = panel.clientWidth - padX;
  const availH = panel.clientHeight - padY;
  if(availW <= 0 || availH <= 0) return;

  const gap = dim >= 7 ? 3 : 4;
  let cell = Math.floor(Math.min((availW - gap*(dim-1)) / dim, (availH - gap*(dim-1)) / dim));
  cell = Math.max(20, Math.min(cell, 58));

  gridEl.style.setProperty("--cell-size", cell + "px");
  gridEl.style.setProperty("--cell-gap", gap + "px");
  gridEl.style.setProperty("--cell-font", Math.max(10, Math.round(cell*0.36)) + "px");
  gridEl.style.gridTemplateColumns = `repeat(${dim}, ${cell}px)`;
  gridEl.style.gridTemplateRows = `repeat(${dim}, ${cell}px)`;

  if(bankEl && game.bank.length){
    const n = game.bank.length;
    const availBankW = bankEl.clientWidth || panel.clientWidth;
    const tGap = 8;
    let tileSize = Math.min(cell, 52);
    let cols = Math.max(1, Math.floor((availBankW + tGap) / (tileSize + tGap)));
    let rows = Math.ceil(n / cols);
    while(rows > 2 && tileSize > 24){
      tileSize -= 2;
      cols = Math.max(1, Math.floor((availBankW + tGap) / (tileSize + tGap)));
      rows = Math.ceil(n / cols);
    }
    document.documentElement.style.setProperty("--tile-size", tileSize + "px");
    document.documentElement.style.setProperty("--tile-font", Math.max(11, Math.round(tileSize*0.36)) + "px");
    document.documentElement.style.setProperty("--tile-gap", (tileSize < 40 ? 6 : 8) + "px");
  }
}

let fitRAF = null;
function scheduleFit(){
  if(fitRAF) cancelAnimationFrame(fitRAF);
  fitRAF = requestAnimationFrame(()=>{
    fitGameLayout();
    requestAnimationFrame(fitGameLayout); // second pass to converge after reflow
  });
}
window.addEventListener("resize", scheduleFit);
window.addEventListener("orientationchange", scheduleFit);

function updateFooter(){
  document.getElementById("undo-count").textContent = game.undosLeft;
  document.getElementById("hint-count").textContent = game.hintsLeft;
  document.getElementById("btn-undo").disabled = game.undosLeft<=0 || game.undoStack.length===0;
  document.getElementById("btn-hint").disabled = game.hintsLeft<=0 || blanksRemaining()===0;
}

function blanksRemaining(){
  let n = 0;
  game.blanks.forEach(key=>{ if(!game.filled[key]) n++; });
  return n;
}

function onBlankClick(key){
  if(game.filled[key]){
    // return tile to bank
    const f = game.filled[key];
    const tile = game.bank.find(t=>t.id===f.tileId);
    if(tile) tile.used = false;
    delete game.filled[key];
    game.selected = key;
    renderGrid(); renderBank(); updateFooter();
    return;
  }
  game.selected = (game.selected === key) ? null : key;
  renderGrid();
}

function onTileClick(tileId){
  if(!game.selected) return;
  const tile = game.bank.find(t=>t.id===tileId);
  if(!tile || tile.used) return;
  const key = game.selected;
  const [r,c] = key.split(",").map(Number);
  const correct = game.puzzle.V[r][c];

  tile.used = true;
  game.filled[key] = { value: tile.value, tileId: tile.id };
  game.undoStack.push(key);
  game.selected = null;
  renderGrid(); renderBank();

  const cellEl = document.querySelector(`.gcell[data-key="${key}"]`);
  if(tile.value === correct){
    if(cellEl) cellEl.classList.add("correct");
    updateFooter();
    if(blanksRemaining()===0){
      setTimeout(checkPuzzleComplete, 300);
    }
  } else {
    if(cellEl) cellEl.classList.add("wrong");
    game.lives -= 1;
    renderHearts();
    setTimeout(()=>{
      // wrong tile bounces back to bank
      tile.used = false;
      delete game.filled[key];
      game.undoStack = game.undoStack.filter(k=>k!==key);
      renderGrid(); renderBank(); updateFooter();
      if(game.lives<=0) showLose();
    }, 500);
  }
}

function checkPuzzleComplete(){
  // all filled and all correct (wrong ones already bounce back, so completeness implies correctness)
  stopTimer();
  const cfg = DIFFS[currentDiff];
  const hintsUsed = cfg.hints - game.hintsLeft;
  const undosUsed = cfg.undos - game.undosLeft;
  const penalty = hintsUsed * 10;
  const earned = Math.max(20, cfg.base - penalty);
  sessionScore += earned;
  sessionStage += 1;
  document.getElementById("win-score").textContent = `+${earned} points`;
  document.getElementById("overlay-win").classList.add("active");

  stats.played += 1;
  stats.currentStreak = (stats.currentStreak||0) + 1;
  stats.bestStreak = Math.max(stats.bestStreak||0, stats.currentStreak);
  stats.totalHintsUsed = (stats.totalHintsUsed||0) + hintsUsed;
  stats.totalUndosUsed = (stats.totalUndosUsed||0) + undosUsed;
  if(sessionScore > stats.bestScore) stats.bestScore = sessionScore;
  if(!stats.byDiff[currentDiff]) stats.byDiff[currentDiff] = {...DEFAULT_DIFF_STATS};
  stats.byDiff[currentDiff].played += 1;
  if(sessionScore > stats.byDiff[currentDiff].best) stats.byDiff[currentDiff].best = sessionScore;

  lastPuzzle = {
    result:"Solved", difficulty:cfg.label, score:earned, sessionScore,
    time:formatDuration(game.elapsedSeconds), hintsUsed, undosUsed,
  };
  saveStats();
  submitScore();
}

function showLose(){
  stopTimer();
  document.getElementById("overlay-lose").classList.add("active");

  const cfg = DIFFS[currentDiff];
  stats.lost = (stats.lost||0) + 1;
  stats.currentStreak = 0;
  if(!stats.byDiff[currentDiff]) stats.byDiff[currentDiff] = {...DEFAULT_DIFF_STATS};
  stats.byDiff[currentDiff].lost = (stats.byDiff[currentDiff].lost||0) + 1;

  lastPuzzle = {
    result:"Lost", difficulty:cfg.label, score:0, sessionScore,
    time: game ? formatDuration(game.elapsedSeconds) : "-",
    hintsUsed: game ? (cfg.hints - game.hintsLeft) : 0,
    undosUsed: game ? (cfg.undos - game.undosLeft) : 0,
  };
  saveStats();
  submitScore();
}

/* ---- footer buttons ---- */
document.getElementById("btn-undo").addEventListener("click", ()=>{
  if(game.undosLeft<=0 || game.undoStack.length===0) return;
  const key = game.undoStack.pop();
  const f = game.filled[key];
  if(f){
    const tile = game.bank.find(t=>t.id===f.tileId);
    if(tile) tile.used = false;
    delete game.filled[key];
    game.undosLeft -= 1;
    renderGrid(); renderBank(); updateFooter();
  }
});

document.getElementById("btn-hint").addEventListener("click", ()=>{
  if(game.hintsLeft<=0) return;
  const remaining = [...game.blanks].filter(k=>!game.filled[k]);
  if(remaining.length===0) return;
  const key = remaining[randInt(0, remaining.length-1)];
  const [r,c] = key.split(",").map(Number);
  const correct = game.puzzle.V[r][c];
  let tile = game.bank.find(t=>!t.used && t.value===correct);
  if(!tile){
    tile = { id:"hint"+Date.now(), value:correct, used:false };
    game.bank.push(tile);
  }
  tile.used = true;
  game.filled[key] = { value: correct, tileId: tile.id };
  game.hintsLeft -= 1;
  renderGrid(); renderBank(); updateFooter();
  const cellEl = document.querySelector(`.gcell[data-key="${key}"]`);
  if(cellEl) cellEl.classList.add("correct");
  if(blanksRemaining()===0) setTimeout(checkPuzzleComplete, 300);
});

document.getElementById("btn-restart").addEventListener("click", ()=>{
  newPuzzleRound();
});
document.getElementById("btn-next").addEventListener("click", ()=>{
  document.getElementById("overlay-win").classList.remove("active");
  newPuzzleRound();
});
document.getElementById("btn-retry").addEventListener("click", ()=>{
  document.getElementById("overlay-lose").classList.remove("active");
  sessionScore = 0; sessionStage = 1;
  newPuzzleRound();
});

/* ===================== INIT ===================== */
initializePiIdentityAndOwnership(); // loads cached/Pi-synced purchases, then renders levels/themes/toggles
loadIdentity();
loadStats().then(()=> renderDiffList());
})();
