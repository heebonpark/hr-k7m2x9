/**
 * 홈레이더(HomeRadar) — 부동산 청약 · 분양가 · 경쟁률 · 당첨가점 · 착공 · 공동주택 분석 앱
 * Clean-room standalone SPA (Zero dependencies, CORS * direct browser API support)
 */

const LS_KEY = {
  apiKey: 'homeradar_data_go_key',
  stars: 'homeradar_stars_v1',
  theme: 'homeradar_theme',
};

const CHOSUNG = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
const $ = (id) => document.getElementById(id);

const state = {
  data: { generatedAt: '', listings: [], starts: [], complexes: [] },
  stars: new Set(),
  tab: 'listings',
  filters: {
    q: '',
    area: '',
    kind: '',
    sort: 'pub',
    openOnly: false,
    starOnly: false,
  },
  compSort: 'rate',
  startSub: 'gyeyang',
  startQ: '',
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function getCho(str) {
  let out = '';
  for (const ch of String(str || '')) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += (code >= 0 && code <= 11171) ? CHOSUNG[Math.floor(code / 588)] : ch.toLowerCase();
  }
  return out;
}

function normalizeKey(raw) {
  const clean = String(raw || '').replace(/\s+/g, '');
  if (!clean) return '';
  try {
    const dec = clean.includes('%') ? decodeURIComponent(clean) : clean;
    return encodeURIComponent(dec);
  } catch {
    return clean.includes('%') ? clean : encodeURIComponent(clean);
  }
}

function maskKey(raw) {
  const s = String(raw || '').replace(/\s+/g, '');
  if (!s) return '미입력';
  if (s.length <= 16) return `${s.slice(0, 4)}… (${s.length}자)`;
  return `${s.slice(0, 7)}…${s.slice(-7)} (${s.length}자)`;
}

function fmtPriceMan(man) {
  if (!man || man <= 0) return '-';
  if (man >= 10000) return `${(man / 10000).toFixed(2).replace(/\.00$/, '')}억`;
  return `${Math.round(man).toLocaleString('ko-KR')}만`;
}

function getTodayYmd() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getListingStatus(it) {
  const today = getTodayYmd();
  if (!it.rcptEnd && !it.rcptBgn) return { key: 'unknown', label: '일정 확인', cls: 'b-closed', dday: 999 };
  const bgn = it.rcptBgn || it.rcptEnd;
  const end = it.rcptEnd || it.rcptBgn;
  if (today > end) return { key: 'closed', label: '접수마감', cls: 'b-closed', dday: 999 };
  const diffEnd = Math.round((new Date(end) - new Date(today)) / 86400000);
  if (today >= bgn && today <= end) return { key: 'open', label: diffEnd === 0 ? '오늘마감!' : `접수중 D-${diffEnd}`, cls: 'b-open', dday: diffEnd };
  const diffBgn = Math.round((new Date(bgn) - new Date(today)) / 86400000);
  return { key: 'soon', label: `접수 D-${diffBgn}`, cls: 'b-soon', dday: diffBgn };
}

let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function downloadCsv(rows, filename) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + rows.map((r) => r.map(q).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(`⬇ ${filename} 다운로드 완료`);
}

// =========================================================================
// 1. Load Data & Theme/Stars Persistence
// =========================================================================
function initTheme() {
  const saved = localStorage.getItem(LS_KEY.theme) || 'light';
  document.documentElement.dataset.theme = saved;
  $('btnTheme').textContent = saved === 'dark' ? '☀️' : '🌙';
}

function loadStars() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY.stars) || '[]');
    state.stars = new Set(Array.isArray(arr) ? arr : []);
  } catch {
    state.stars = new Set();
  }
  updateStarChip();
}

function toggleStar(id) {
  if (state.stars.has(id)) state.stars.delete(id);
  else state.stars.add(id);
  localStorage.setItem(LS_KEY.stars, JSON.stringify([...state.stars]));
  updateStarChip();
  renderListings();
}

function updateStarChip() {
  $('chipStarOnly').textContent = `⭐ 관심단지 (${state.stars.size})`;
}

function hydrateData(payload) {
  state.data = payload;
  if (payload.defaultApiKey) {
    const existing = (localStorage.getItem(LS_KEY.apiKey) || '').replace(/\s+/g, '');
    if (!existing) {
      localStorage.setItem(LS_KEY.apiKey, payload.defaultApiKey);
    }
    const curKey = localStorage.getItem(LS_KEY.apiKey) || payload.defaultApiKey;
    if ($('apiKeyInput')) $('apiKeyInput').value = curKey;
    if ($('keyMaskText')) $('keyMaskText').textContent = `현재 저장 키: ${maskKey(curKey)} (자동 적용됨)`;
  }
  state.data.listings.forEach((it) => {
    it._search = `${it.name} ${it.area} ${it.addr} ${it.builder} ${it.subKind}`.toLowerCase();
    it._cho = getCho(`${it.name} ${it.area} ${it.builder}`);
  });

  const stamp = payload.generatedAt ? payload.generatedAt.slice(0, 16).replace('T', ' ') : '-';
  $('snapshotBadge').textContent = `데이터 기준: ${stamp}`;

  // Populate area dropdown
  const areas = [...new Set(state.data.listings.map((x) => x.area).filter(Boolean))].sort();
  const sel = $('areaSelect');
  const cur = sel.value;
  sel.innerHTML = '<option value="">전국 시·도 전체</option>' + areas.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  sel.value = cur;

  renderKpis();
  renderListings();
  renderCompTable();
  renderStartsTable();
  updateScoreCalculator();
}

// =========================================================================
// 0. WebCrypto AES-256-GCM Private Vault (IndexedDB Key Persistence)
// =========================================================================
const VAULT_CANARY = 'HOMERADAR-VAULT-OK-V1';
const vaultIdb = (() => {
  let p = null;
  const open = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('homeradar_vault_db', 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('k')) r.result.createObjectStore('k'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = (m, f) => open().then((db) => new Promise((res, rej) => {
    const t = db.transaction('k', m);
    const q = f(t.objectStore('k'));
    t.oncomplete = () => res(q?.result);
    t.onerror = () => rej(t.error);
  }));
  return {
    get: () => tx('readonly', (s) => s.get('key')).catch(() => null),
    set: (v) => tx('readwrite', (s) => s.put(v, 'key')).catch(() => {}),
    del: () => tx('readwrite', (s) => s.delete('key')).catch(() => {}),
  };
})();

function b64ToBytes(b64) {
  const bin = atob(b64);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

async function deriveVaultKey(password, saltB64, iter) {
  const bk = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBytes(saltB64), iterations: iter, hash: 'SHA-256' },
    bk,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

async function verifyVaultKey(key, vault) {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(vault.checkIv) }, key, b64ToBytes(vault.checkCt));
    return new TextDecoder().decode(pt) === VAULT_CANARY;
  } catch {
    return false;
  }
}

async function decryptVaultPayload(key, vault) {
  const res = await fetch(`./data/realestate.enc?v=${encodeURIComponent(vault.salt.slice(0, 8))}`);
  if (!res.ok) throw new Error(`realestate.enc 로드 실패 (${res.status})`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const gz = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(0, 12) }, key, buf.subarray(12));
  const ds = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(ds).text());
}

async function loadInitialSnapshot() {
  try {
    const vRes = await fetch('./data/vault.json', { cache: 'no-store' });
    if (vRes.ok) {
      const vault = await vRes.json();
      $('btnLockNow').classList.remove('hidden');
      $('btnLockNow').onclick = async () => { await vaultIdb.del(); location.reload(); };

      const cachedKey = await vaultIdb.get();
      if (cachedKey && await verifyVaultKey(cachedKey, vault)) {
        const payload = await decryptVaultPayload(cachedKey, vault);
        hydrateData(payload);
        return;
      }

      // Show Lock Gate
      $('lockGate').classList.remove('hidden');
      $('lockPass').focus();
      $('lockForm').onsubmit = async (e) => {
        e.preventDefault();
        const pw = $('lockPass').value;
        $('lockErr').textContent = '복호화 확인 중…';
        try {
          const key = await deriveVaultKey(pw, vault.salt, vault.iter);
          if (!(await verifyVaultKey(key, vault))) {
            $('lockErr').textContent = '비밀번호가 일치하지 않습니다.';
            return;
          }
          if ($('lockRemember').checked) await vaultIdb.set(key);
          const payload = await decryptVaultPayload(key, vault);
          $('lockGate').classList.add('hidden');
          hydrateData(payload);
        } catch (err) {
          $('lockErr').textContent = `복호화 오류: ${err.message}`;
        }
      };
      return;
    }
  } catch {
    // fallback to plain json in local dev
  }

  try {
    const res = await fetch('./data/realestate.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    hydrateData(payload);
  } catch (err) {
    $('listingsGrid').innerHTML = `<div style="padding:30px; grid-column:1/-1; text-align:center; color:#dc2626;">초기 데이터 로드 실패: ${esc(err.message)}</div>`;
  }
}

// =========================================================================
// 2. Tab 1: 청약 분양 (Listings)
// =========================================================================
function renderKpis() {
  const list = state.data.listings;
  const aptCnt = list.filter((x) => x.kind === 'apt').length;
  const remCnt = list.filter((x) => x.kind === 'remndr').length;
  const urbCnt = list.filter((x) => x.kind === 'urbty').length;
  const activeCnt = list.filter((x) => {
    const st = getListingStatus(x);
    return st.key === 'open' || st.key === 'soon';
  }).length;

  const pyVals = list.filter((x) => x.kind === 'apt' && x.avgPyeongPrice > 0).map((x) => x.avgPyeongPrice);
  const avgPy = pyVals.length ? Math.round(pyVals.reduce((a, b) => a + b, 0) / pyVals.length) : 0;

  $('kpiTotal').textContent = `${list.length.toLocaleString('ko-KR')}건`;
  $('kpiSubBreak').textContent = `APT ${aptCnt} · 줍줍 ${remCnt} · 오피스텔 ${urbCnt}`;
  $('kpiActive').textContent = `${activeCnt}건`;
  $('kpiRemndr').textContent = `${remCnt}건`;
  $('kpiAvgPy').textContent = avgPy ? `${avgPy.toLocaleString('ko-KR')}만원` : '-';
}

function getFilteredListings() {
  const { q, area, kind, sort, openOnly, starOnly } = state.filters;
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);

  const matched = state.data.listings.filter((it) => {
    if (kind && it.kind !== kind) return false;
    if (area && it.area !== area) return false;
    if (starOnly && !state.stars.has(it.id)) return false;
    if (openOnly) {
      const st = getListingStatus(it);
      if (st.key !== 'open' && st.key !== 'soon') return false;
    }
    for (const t of tokens) {
      if (/^[ㄱ-ㅎ]+$/.test(t)) {
        if (!it._cho.includes(t)) return false;
      } else {
        if (!it._search.includes(t)) return false;
      }
    }
    return true;
  });

  matched.sort((a, b) => {
    if (sort === 'close') return getListingStatus(a).dday - getListingStatus(b).dday;
    if (sort === 'units') return (b.units || 0) - (a.units || 0);
    if (sort === 'py_asc') return (a.avgPyeongPrice || 999999) - (b.avgPyeongPrice || 999999);
    if (sort === 'rate') return (b.maxRate ?? -1) - (a.maxRate ?? -1);
    return String(b.pubDate || '').localeCompare(String(a.pubDate || ''));
  });
  return matched;
}

function renderListings() {
  const list = getFilteredListings();
  $('matchCount').textContent = list.length.toLocaleString('ko-KR');
  const grid = $('listingsGrid');

  if (!list.length) {
    grid.innerHTML = '<div style="padding:36px; grid-column:1/-1; text-align:center; color:var(--text-muted);">조건에 맞는 청약 공고가 없습니다. 필터를 조정해 보세요.</div>';
    return;
  }

  grid.innerHTML = list.slice(0, 80).map((it) => {
    const st = getListingStatus(it);
    const kindCls = it.kind === 'remndr' ? 'b-remndr' : it.kind === 'urbty' ? 'b-urbty' : 'b-apt';
    const kindLbl = it.kind === 'remndr' ? '🔥 무순위 줍줍' : it.kind === 'urbty' ? `🏙 ${it.subKind}` : `🏢 ${it.subKind}`;
    const saved = state.stars.has(it.id);

    const priceStr = it.minPrice > 0
      ? (it.minPrice === it.maxPrice ? fmtPriceMan(it.minPrice) : `${fmtPriceMan(it.minPrice)}~${fmtPriceMan(it.maxPrice)}`)
      : '공고 확인';
    const pyStr = it.avgPyeongPrice > 0 ? `${it.avgPyeongPrice.toLocaleString('ko-KR')}만/평` : '-';
    const rateStr = it.maxRate !== null && it.maxRate > 0
      ? `${it.maxRate.toFixed(1)} : 1`
      : (it.minWinScore ? `가점 ${it.minWinScore}점~` : `${it.units ? it.units.toLocaleString('ko-KR') + '세대' : '-'}`);
    const moveStr = it.moveIn && it.moveIn.length === 6 ? `${it.moveIn.slice(0, 4)}.${it.moveIn.slice(4, 6)} 입주` : (it.pubDate || '-');

    return `
      <article class="prop-card" data-open-id="${esc(it.id)}">
        <div>
          <div class="prop-head">
            <div class="badge-row">
              <span class="badge ${kindCls}">${esc(kindLbl)}</span>
              <span class="badge ${st.cls}">${esc(st.label)}</span>
              <span class="badge b-closed">${esc(it.area)}</span>
            </div>
            <button type="button" class="btn-star ${saved ? 'saved' : ''}" data-star-id="${esc(it.id)}" aria-label="관심단지 토글">${saved ? '★' : '☆'}</button>
          </div>
          <div class="prop-title" style="margin-top:8px;">${esc(it.name)}</div>
          <div class="prop-sub">${esc(it.builder)} · ${esc(it.addr || it.area)}</div>
        </div>

        <div class="prop-metrics">
          <div>
            <div class="pm-k">분양가 범위</div>
            <div class="pm-v">${esc(priceStr)}</div>
          </div>
          <div>
            <div class="pm-k">평균 평당가</div>
            <div class="pm-v" style="color:var(--primary);">${esc(pyStr)}</div>
          </div>
          <div>
            <div class="pm-k">${it.maxRate > 0 ? '1순위 최고경쟁률' : '규모 / 커트라인'}</div>
            <div class="pm-v ${it.maxRate >= 10 ? 'hot' : ''}">${esc(rateStr)}</div>
          </div>
        </div>

        <div class="muted" style="display:flex; justify-content:space-between; gap:8px;">
          <span>접수: ${esc(it.rcptBgn || '-')} ~ ${esc(it.rcptEnd || '-')}</span>
          <span>${esc(moveStr)}</span>
        </div>
      </article>
    `;
  }).join('');
}

// =========================================================================
// 3. Detail Modal (Models + Competition + Winning Scores)
// =========================================================================
function openDetail(id) {
  const it = state.data.listings.find((x) => x.id === id);
  if (!it) return;
  const st = getListingStatus(it);
  const kindCls = it.kind === 'remndr' ? 'b-remndr' : it.kind === 'urbty' ? 'b-urbty' : 'b-apt';

  $('dmBadges').innerHTML = `
    <span class="badge ${kindCls}">${esc(it.subKind)}</span>
    <span class="badge ${st.cls}">${esc(st.label)}</span>
    <span class="badge b-closed">${esc(it.area)}</span>
  `;
  $('dmTitle').textContent = it.name;
  $('dmSub').textContent = `${it.builder} · ${it.addr || it.area}`;

  const moveFmt = it.moveIn && it.moveIn.length === 6 ? `${it.moveIn.slice(0, 4)}년 ${it.moveIn.slice(4, 6)}월` : '-';
  $('dmSummary').innerHTML = [
    ['총 공급세대', it.units ? `${it.units.toLocaleString('ko-KR')}세대` : '-'],
    ['평균 평당가', it.avgPyeongPrice ? `${it.avgPyeongPrice.toLocaleString('ko-KR')}만` : '-'],
    ['당첨자 발표', it.winDate || '-'],
    ['입주 예정', moveFmt],
  ].map(([k, v]) => `<div><div class="pm-k">${k}</div><div class="pm-v">${esc(v)}</div></div>`).join('');

  const mapQ = encodeURIComponent(it.addr || it.name);
  $('dmLinks').innerHTML = `
    <a class="btn btn-primary btn-sm" href="${esc(it.pblancUrl)}" target="_blank" rel="noopener">🏛 청약홈 공고 원문 ↗</a>
    ${it.homeUrl ? `<a class="btn btn-outline btn-sm" href="${esc(it.homeUrl)}" target="_blank" rel="noopener">🌐 분양 홈페이지 ↗</a>` : ''}
    <a class="btn btn-outline btn-sm" href="https://map.naver.com/p/search/${mapQ}" target="_blank" rel="noopener">📍 네이버지도</a>
    <a class="btn btn-outline btn-sm" href="https://map.kakao.com/?q=${mapQ}" target="_blank" rel="noopener">🗺 카카오맵</a>
  `;

  $('dmModelsWrap').innerHTML = it.models?.length
    ? `<h4 style="margin:0 0 8px;">💰 주택형별 분양가 · 평당가 (${it.models.length}개 타입)</h4>
       <div class="table-wrap" style="border:1px solid var(--border); border-radius:8px;">
         <table class="data-table">
           <thead><tr><th>주택형</th><th class="num">공급면적(㎡)</th><th class="num">공급세대(특공)</th><th class="num">최고 분양가</th><th class="num">3.3㎡ 평당가</th></tr></thead>
           <tbody>${it.models.map((m) => `
             <tr>
               <td><strong>${esc(m.ty)}</strong></td>
               <td class="num">${m.ar || '-'}</td>
               <td class="num">${m.supply} (${m.spSupply})</td>
               <td class="num"><strong>${fmtPriceMan(m.priceMan)}</strong></td>
               <td class="num pos">${m.pyeongPrice ? m.pyeongPrice.toLocaleString('ko-KR') + '만' : '-'}</td>
             </tr>`).join('')}
           </tbody>
         </table>
       </div>`
    : '<div class="muted">※ 주택형별 세부 분양가 데이터는 청약홈 공고 원문에서 확인하세요.</div>';

  $('dmCompWrap').innerHTML = it.comps?.length
    ? `<h4 style="margin:0 0 8px;">🔥 주택형별 청약 경쟁률</h4>
       <div class="table-wrap" style="border:1px solid var(--border); border-radius:8px;">
         <table class="data-table">
           <thead><tr><th>주택형</th><th>순위 / 지역</th><th class="num">공급</th><th class="num">접수</th><th class="num">경쟁률</th></tr></thead>
           <tbody>${it.comps.slice(0, 15).map((c) => `
             <tr>
               <td><strong>${esc(c.ty)}</strong></td>
               <td>${c.rank}순위 · ${esc(c.reside)}</td>
               <td class="num">${c.supply}</td>
               <td class="num">${c.req.toLocaleString('ko-KR')}</td>
               <td class="num ${c.rateNum >= 5 ? 'hot' : ''}">${esc(c.rateStr)}</td>
             </tr>`).join('')}
           </tbody>
         </table>
       </div>`
    : '';

  $('dmScoreWrap').innerHTML = it.scores?.length
    ? `<h4 style="margin:0 0 8px;">🏆 당첨 가점 커트라인 (최저 / 평균 / 최고)</h4>
       <div class="table-wrap" style="border:1px solid var(--border); border-radius:8px;">
         <table class="data-table">
           <thead><tr><th>주택형</th><th>지역</th><th class="num">최저 가점</th><th class="num">평균 가점</th><th class="num">최고 가점</th></tr></thead>
           <tbody>${it.scores.slice(0, 15).map((s) => `
             <tr>
               <td><strong>${esc(s.ty)}</strong></td>
               <td>${esc(s.reside)}</td>
               <td class="num pos">${s.low ?? '-'}점</td>
               <td class="num">${s.avg ?? '-'}점</td>
               <td class="num">${s.top ?? '-'}점</td>
             </tr>`).join('')}
           </tbody>
         </table>
       </div>`
    : '';

  $('detailModal').classList.add('open');
}

// =========================================================================
// 4. Tab 2: 경쟁률 · 당첨가점 랭킹
// =========================================================================
function renderCompTable() {
  const rows = state.data.listings.filter((x) => x.maxRate !== null || x.minWinScore !== null);
  rows.sort((a, b) => {
    if (state.compSort === 'score') return (b.avgWinScore || 0) - (a.avgWinScore || 0);
    if (state.compSort === 'req') return (b.totalReq || 0) - (a.totalReq || 0);
    return (b.maxRate || 0) - (a.maxRate || 0);
  });

  const maxR = Math.max(1, ...rows.map((x) => x.maxRate || 0));
  const tbody = $('compTbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:28px; color:var(--text-muted);">경쟁률·가점 집계 데이터가 없습니다.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.slice(0, 60).map((it, idx) => {
    const pct = it.maxRate ? Math.min(100, Math.round((Math.log10(it.maxRate + 1) / Math.log10(maxR + 1)) * 100)) : 0;
    return `
      <tr style="cursor:pointer;" data-comp-id="${esc(it.id)}">
        <td><strong>${idx + 1}</strong></td>
        <td>
          <div><strong>${esc(it.name)}</strong></div>
          <div class="muted">${esc(it.area)} · ${esc(it.builder)} · 공고 ${esc(it.pubDate || '-')}</div>
        </td>
        <td class="num">${it.units ? it.units.toLocaleString('ko-KR') + '세대' : '-'}</td>
        <td class="num">${it.avgPyeongPrice ? it.avgPyeongPrice.toLocaleString('ko-KR') + '만' : '-'}</td>
        <td class="num" style="min-width:130px;">
          <div class="${it.maxRate >= 10 ? 'hot' : 'pos'}">${it.maxRate !== null ? it.maxRate.toFixed(2) + ' : 1' : '-'}</div>
          <div class="bar-bg"><div class="bar-fg" style="width:${pct}%"></div></div>
        </td>
        <td class="num">${it.totalReq ? it.totalReq.toLocaleString('ko-KR') + '건' : '-'}</td>
        <td class="num"><strong>${it.minWinScore ?? '-'}</strong> / ${it.avgWinScore ?? '-'}점</td>
      </tr>
    `;
  }).join('');
}

// =========================================================================
// 5. Tab 3: 착공 · 공동주택 단지
// =========================================================================
function getFilteredStarts() {
  const q = state.startQ.trim().toLowerCase();
  if (state.startSub === 'kapt') {
    return state.data.complexes.filter((c) => {
      if (!q) return true;
      return `${c.name} ${c.sido} ${c.sgg} ${c.dong} ${c.code}`.toLowerCase().includes(q);
    });
  }
  const srcMatch = state.startSub === 'songpa' ? '서울 송파구' : '인천 계양구';
  return state.data.starts.filter((s) => {
    if (s.source !== srcMatch) return false;
    if (!q) return true;
    return `${s.name} ${s.addr} ${s.usage} ${s.builder}`.toLowerCase().includes(q);
  });
}

function renderStartsTable() {
  const list = getFilteredStarts();
  $('startCount').textContent = list.length.toLocaleString('ko-KR');
  const tbody = $('startsTbody');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:28px; color:var(--text-muted);">표시할 데이터가 없습니다.</td></tr>';
    return;
  }

  if (state.startSub === 'kapt') {
    tbody.innerHTML = list.slice(0, 120).map((c) => {
      const addr = `${c.sido} ${c.sgg} ${c.dong}`.trim();
      return `
        <tr>
          <td><span class="badge b-apt">K-apt 단지</span></td>
          <td><strong>${esc(c.name)}</strong></td>
          <td><a href="https://map.naver.com/p/search/${encodeURIComponent(addr + ' ' + c.name)}" target="_blank" rel="noopener" style="text-decoration:underline;">${esc(addr)} ↗</a></td>
          <td class="muted">의무관리대상 공동주택</td>
          <td class="num"><code>${esc(c.code)}</code></td>
          <td class="muted">-</td>
        </tr>
      `;
    }).join('');
    return;
  }

  tbody.innerHTML = list.slice(0, 120).map((s) => `
    <tr>
      <td><span class="badge b-soon">${esc(s.source)}</span></td>
      <td><strong>${esc(s.name)}</strong><div class="muted">${esc(s.usage)}</div></td>
      <td><a href="https://map.naver.com/p/search/${encodeURIComponent(s.addr || s.name)}" target="_blank" rel="noopener" style="text-decoration:underline;">${esc(s.addr || '-')} ↗</a></td>
      <td>${esc(s.builder || '-')}</td>
      <td class="num"><strong>${s.areaM2 ? Math.round(s.areaM2).toLocaleString('ko-KR') + '㎡' : '-'}</strong></td>
      <td>${esc(s.startDate || '-')}</td>
    </tr>
  `).join('');
}

async function fetchKaptForSelectedRegion() {
  const key = normalizeKey($('apiKeyInput').value || localStorage.getItem(LS_KEY.apiKey) || '');
  if (!key) {
    showToast('실시간 조회를 위해 [🔌 실시간 API · 진단] 탭에서 인증키를 먼저 저장해 주세요.');
    switchTab('api');
    return;
  }
  const sgg = $('kaptSggSelect').value;
  showToast(`K-apt 공동주택(${sgg}) 조회 중…`);
  try {
    const r = await fetch(`https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4?serviceKey=${key}&sigunguCode=${sgg}&pageNo=1&numOfRows=80&type=json`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const raw = j?.response?.body?.items;
    const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.item) ? raw.item : raw?.item ? [raw.item] : [];
    const byCode = new Map(state.data.complexes.map((x) => [x.code, x]));
    arr.forEach((x) => {
      if (!x.kaptCode) return;
      byCode.set(x.kaptCode, {
        code: x.kaptCode,
        name: String(x.kaptName || '').trim(),
        sido: String(x.as1 || '').trim(),
        sgg: String(x.as2 || '').trim(),
        dong: String(x.as3 || '').trim(),
        bjdCode: String(x.bjdCode || '').trim(),
      });
    });
    state.data.complexes = [...byCode.values()];
    state.startSub = 'kapt';
    document.querySelectorAll('#startSubChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.sub === 'kapt'));
    renderStartsTable();
    showToast(`✅ ${arr.length}개 공동주택 단지를 불러왔습니다!`);
  } catch (e) {
    showToast(`조회 실패: ${e.message}`);
  }
}

// =========================================================================
// 6. Tab 4: 청약 가점(84점) & 평당가·대출 계산기
// =========================================================================
function initCalculators() {
  const homelessOpts = [
    [0, '미성년 / 유주택 (0점)'], [2, '1년 미만 (2점)'], [4, '1년 이상 ~ 2년 미만 (4점)'],
    [6, '2년 ~ 3년 (6점)'], [8, '3년 ~ 4년 (8점)'], [10, '4년 ~ 5년 (10점)'],
    [12, '5년 ~ 6년 (12점)'], [14, '6년 ~ 7년 (14점)'], [16, '7년 ~ 8년 (16점)'],
    [18, '8년 ~ 9년 (18점)'], [20, '9년 ~ 10년 (20점)'], [22, '10년 ~ 11년 (22점)'],
    [24, '11년 ~ 12년 (24점)'], [26, '12년 ~ 13년 (26점)'], [28, '13년 ~ 14년 (28점)'],
    [30, '14년 ~ 15년 (30점)'], [32, '15년 이상 (32점 만점)'],
  ];
  const depsOpts = [
    [5, '0명 (5점)'], [10, '1명 (10점)'], [15, '2명 (15점)'],
    [20, '3명 (20점)'], [25, '4명 (25점)'], [30, '5명 (30점)'], [35, '6명 이상 (35점 만점)'],
  ];
  const bankOpts = [
    [1, '6개월 미만 (1점)'], [2, '6개월 ~ 1년 (2점)'], [3, '1년 ~ 2년 (3점)'],
    [4, '2년 ~ 3년 (4점)'], [5, '3년 ~ 4년 (5점)'], [6, '4년 ~ 5년 (6점)'],
    [7, '5년 ~ 6년 (7점)'], [8, '6년 ~ 7년 (8점)'], [9, '7년 ~ 8년 (9점)'],
    [10, '8년 ~ 9년 (10점)'], [11, '9년 ~ 10년 (11점)'], [12, '10년 ~ 11년 (12점)'],
    [13, '11년 ~ 12년 (13점)'], [14, '12년 ~ 13년 (14점)'], [15, '13년 ~ 14년 (15점)'],
    [16, '14년 ~ 15년 (16점)'], [17, '15년 이상 (17점 만점)'],
  ];

  $('calcHomeless').innerHTML = homelessOpts.map(([v, l]) => `<option value="${v}" ${v === 20 ? 'selected' : ''}>${l}</option>`).join('');
  $('calcDeps').innerHTML = depsOpts.map(([v, l]) => `<option value="${v}" ${v === 20 ? 'selected' : ''}>${l}</option>`).join('');
  $('calcBank').innerHTML = bankOpts.map(([v, l]) => `<option value="${v}" ${v === 12 ? 'selected' : ''}>${l}</option>`).join('');

  ['calcHomeless', 'calcDeps', 'calcBank'].forEach((id) => $(id).addEventListener('change', updateScoreCalculator));
  ['loanPrice', 'loanArea', 'loanLtv', 'loanRate', 'loanYears'].forEach((id) => $(id).addEventListener('input', updateLoanCalculator));

  updateLoanCalculator();
}

function updateScoreCalculator() {
  const h = Number($('calcHomeless').value || 0);
  const d = Number($('calcDeps').value || 0);
  const b = Number($('calcBank').value || 0);
  const total = h + d + b;

  $('calcTotalScore').textContent = `${total}점`;
  $('calcScoreBreak').textContent = `무주택 ${h} + 부양 ${d} + 통장 ${b}`;

  const withScore = state.data.listings.filter((x) => x.minWinScore !== null);
  const passable = withScore.filter((x) => total >= x.minWinScore).sort((a, b2) => b2.minWinScore - a.minWinScore);
  $('calcPassSummary').textContent = withScore.length
    ? `최근 가점 공개 ${withScore.length}개 중 ${passable.length}개 단지 커트라인 통과`
    : '가점 데이터 로딩 중';

  const box = $('calcMatchList');
  if (!passable.length) {
    box.innerHTML = '<div class="muted">현재 가점으로 최저 커트라인을 통과한 최근 단지가 없습니다. (무순위 줍줍·추첨제 활용 추천!)</div>';
    return;
  }
  box.innerHTML = passable.slice(0, 12).map((it) => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 10px; border:1px solid var(--border); border-radius:8px; cursor:pointer; font-size:0.82rem;" data-open-id="${esc(it.id)}">
      <div><strong>${esc(it.name)}</strong> <span class="muted">(${esc(it.area)})</span></div>
      <span class="badge b-open">최저 ${it.minWinScore}점 / 평균 ${it.avgWinScore ?? '-'}점</span>
    </div>
  `).join('');
}

function updateLoanCalculator() {
  const priceMan = Math.max(0, Number($('loanPrice').value) || 0);
  const areaM2 = Math.max(1, Number($('loanArea').value) || 1);
  const ltv = Math.min(80, Math.max(0, Number($('loanLtv').value) || 0));
  const ratePct = Math.max(0.1, Number($('loanRate').value) || 4.0);
  const years = Math.max(1, Number($('loanYears').value) || 30);

  const pyeong = areaM2 / 3.3058;
  const pyPrice = Math.round(priceMan / pyeong);
  const loanMan = Math.round(priceMan * (ltv / 100));
  const equityMan = priceMan - loanMan;

  const r = ratePct / 100 / 12;
  const n = years * 12;
  const monthlyMan = loanMan > 0 ? Math.round((loanMan * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)) : 0;

  $('loanMonthly').textContent = `${monthlyMan.toLocaleString('ko-KR')}만원`;
  $('loanPyPrice').textContent = `${pyPrice.toLocaleString('ko-KR')}만원/평`;
  $('loanEquity').textContent = fmtPriceMan(equityMan);
  $('loanDetailNote').textContent = `• 공급 약 ${pyeong.toFixed(1)}평형 · 대출금 ${fmtPriceMan(loanMan)} (LTV ${ltv}%) · ${years}년 만기 연 ${ratePct}% 기준`;
}

// =========================================================================
// 7. Tab 5: 6개 부동산 공공 API 실시간 진단 & 브라우저 새로고침
// =========================================================================
function initApiTab() {
  const saved = localStorage.getItem(LS_KEY.apiKey) || '';
  $('apiKeyInput').value = saved;
  $('keyMaskText').textContent = `현재 저장 키: ${maskKey(saved)}`;

  $('btnToggleEye').onclick = () => {
    const inp = $('apiKeyInput');
    inp.type = inp.type === 'password' ? 'text' : 'password';
  };
  $('btnSaveKey').onclick = () => {
    const k = $('apiKeyInput').value.replace(/\s+/g, '');
    if (k) {
      localStorage.setItem(LS_KEY.apiKey, k);
      $('keyMaskText').textContent = `현재 저장 키: ${maskKey(k)}`;
      showToast('공공데이터포털 인증키 저장 완료');
    } else {
      localStorage.removeItem(LS_KEY.apiKey);
      $('keyMaskText').textContent = '현재 저장 키: 미입력';
      showToast('인증키 삭제');
    }
  };
  $('btnDiagAll').onclick = runSixApiDiagnostic;
  $('btnRefreshLive').onclick = runLiveRefreshAll;
}

async function runSixApiDiagnostic() {
  const raw = ($('apiKeyInput').value || localStorage.getItem(LS_KEY.apiKey) || '').replace(/\s+/g, '');
  if (!raw) {
    showToast('공공데이터포털 일반 인증키를 먼저 입력해 주세요.');
    $('apiKeyInput').focus();
    return;
  }
  localStorage.setItem(LS_KEY.apiKey, raw);
  $('keyMaskText').textContent = `현재 저장 키: ${maskKey(raw)}`;
  const k = normalizeKey(raw);

  $('apiLogBox').textContent = '🩺 6개 부동산 공공 API 연결 상태를 동시에 점검 중입니다…';
  const targets = [
    { name: '청약홈 APT 분양', url: `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail?page=1&perPage=1&serviceKey=${k}`, cnt: (j) => j?.totalCount },
    { name: '주택형별 분양가 모델', url: `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl?page=1&perPage=1&serviceKey=${k}`, cnt: (j) => j?.totalCount },
    { name: '무순위 줍줍 · 오피스텔', url: `https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail?page=1&perPage=1&serviceKey=${k}`, cnt: (j) => j?.totalCount },
    { name: '청약 경쟁률 · 당첨가점', url: `https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet?page=1&perPage=1&serviceKey=${k}`, cnt: (j) => j?.totalCount },
    { name: 'K-apt 공동주택 (V4)', url: `https://apis.data.go.kr/1613000/AptListService4/getSigunguAptList4?serviceKey=${k}&sigunguCode=28245&pageNo=1&numOfRows=1&type=json`, cnt: (j) => j?.response?.body?.totalCount },
    { name: '계양·송파 신축 착공', url: `https://api.odcloud.kr/api/15100714/v1/uddi:58a57b5e-1fda-4b69-bd16-e31a58fc6798?page=1&perPage=1&serviceKey=${k}`, cnt: (j) => j?.totalCount },
  ];

  const results = await Promise.all(targets.map(async (t) => {
    const t0 = performance.now();
    try {
      const r = await fetch(t.url);
      const ms = Math.round(performance.now() - t0);
      const j = r.ok ? await r.json().catch(() => null) : null;
      const total = j ? t.cnt(j) : 0;
      return { name: t.name, ok: r.ok, status: r.status, ms, total };
    } catch (e) {
      return { name: t.name, ok: false, status: 0, ms: 0, err: e.message };
    }
  }));

  const okCnt = results.filter((r) => r.ok).length;
  $('diagResultBoard').innerHTML = results.map((r) => `
    <div class="diag-card ${r.ok ? 'diag-ok' : r.status === 403 ? 'diag-warn' : 'diag-err'}">
      <div style="font-weight:800;">${r.ok ? '🟢' : r.status === 403 ? '🟡' : '🔴'} ${esc(r.name)}</div>
      <div style="margin-top:3px; font-weight:700;">${r.ok ? `HTTP 200 · ${r.ms}ms` : `오류 (HTTP ${r.status || 'NET'})`}</div>
      <div class="muted">${r.ok ? `전체 ${Number(r.total || 0).toLocaleString('ko-KR')}건 조회 가능` : (r.err || '인증키 또는 활용신청 확인')}</div>
    </div>
  `).join('');

  $('apiLogBox').textContent = `[진단 완료 ${new Date().toTimeString().slice(0, 8)}] 6개 중 ${okCnt}개 API 정상 연결!`;
  showToast(`6개 부동산 API 진단 완료 (${okCnt}/6 정상)`);
}

async function runLiveRefreshAll() {
  const raw = ($('apiKeyInput').value || localStorage.getItem(LS_KEY.apiKey) || '').replace(/\s+/g, '');
  if (!raw) {
    showToast('공공데이터포털 일반 인증키를 먼저 입력해 주세요.');
    return;
  }
  localStorage.setItem(LS_KEY.apiKey, raw);
  const k = normalizeKey(raw);
  const log = $('apiLogBox');
  log.textContent = '🔄 브라우저에서 최신 청약·분양가·경쟁률·가점 실시간 수신 중…';

  try {
    const [aptR, remR, urbR, mdlR, compR, scoreR] = await Promise.all([
      fetch(`https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail?page=1&perPage=60&serviceKey=${k}`).then((r) => r.json()),
      fetch(`https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getRemndrLttotPblancDetail?page=1&perPage=30&serviceKey=${k}`).then((r) => r.json()),
      fetch(`https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getUrbtyOfctlLttotPblancDetail?page=1&perPage=30&serviceKey=${k}`).then((r) => r.json()),
      fetch(`https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancMdl?page=1&perPage=250&serviceKey=${k}`).then((r) => r.json()),
      fetch(`https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/getAPTLttotPblancCmpet?page=1&perPage=250&serviceKey=${k}`).then((r) => r.json()),
      fetch(`https://api.odcloud.kr/api/ApplyhomeInfoCmpetRtSvc/v1/getAptLttotPblancScore?page=1&perPage=200&serviceKey=${k}`).then((r) => r.json()),
    ]);

    const mdlMap = new Map();
    for (const m of (mdlR?.data || [])) {
      const id = String(m.HOUSE_MANAGE_NO || m.PBLANC_NO || '');
      const priceMan = Number(String(m.LTTOT_TOP_AMOUNT || 0).replace(/[^0-9]/g, '')) || 0;
      const ar = Number(m.SUPLY_AR || 0);
      const pyeongPrice = priceMan > 0 && ar > 0 ? Math.round(priceMan / (ar / 3.3058)) : 0;
      if (!mdlMap.has(id)) mdlMap.set(id, []);
      mdlMap.get(id).push({ ty: m.HOUSE_TY, ar: Number(ar.toFixed(2)), priceMan, pyeongPrice, supply: Number(m.SUPLY_HSHLDCO || 0) + Number(m.SPSPLY_HSHLDCO || 0), spSupply: Number(m.SPSPLY_HSHLDCO || 0) });
    }
    const compMap = new Map();
    for (const c of (compR?.data || [])) {
      const id = String(c.HOUSE_MANAGE_NO || c.PBLANC_NO || '');
      const rNum = String(c.CMPET_RATE || '').includes('△') ? 0 : (Number(String(c.CMPET_RATE || 0).replace(/[^0-9.]/g, '')) || 0);
      if (!compMap.has(id)) compMap.set(id, []);
      compMap.get(id).push({ ty: c.HOUSE_TY, rank: Number(c.SUBSCRPT_RANK_CODE || 1), reside: c.RESIDE_SENM || '', supply: Number(c.SUPLY_HSHLDCO || 0), req: Number(String(c.REQ_CNT || 0).replace(/[^0-9]/g, '')) || 0, rateStr: c.CMPET_RATE || '-', rateNum: rNum });
    }
    const scoreMap = new Map();
    for (const s of (scoreR?.data || [])) {
      const id = String(s.HOUSE_MANAGE_NO || s.PBLANC_NO || '');
      const toN = (v) => { const n = Number(String(v || '').replace(/[^0-9.]/g, '')); return n > 0 ? n : null; };
      if (!scoreMap.has(id)) scoreMap.set(id, []);
      scoreMap.get(id).push({ ty: s.HOUSE_TY, reside: s.RESIDE_SENM || '', low: toN(s.LWET_SCORE), avg: toN(s.AVRG_SCORE), top: toN(s.TOP_SCORE) });
    }

    const byId = new Map(state.data.listings.map((x) => [x.id, x]));
    const mergeKind = (arr, kind) => {
      for (const x of (arr || [])) {
        const manageNo = String(x.HOUSE_MANAGE_NO || x.PBLANC_NO || '');
        const models = mdlMap.get(manageNo) || [];
        const comps = compMap.get(manageNo) || [];
        const scores = scoreMap.get(manageNo) || [];
        const prices = models.map((m) => m.priceMan).filter((v) => v > 0);
        const pyPrices = models.map((m) => m.pyeongPrice).filter((v) => v > 0);
        const lowScores = scores.map((s) => s.low).filter((v) => v !== null);
        const avgScores = scores.map((s) => s.avg).filter((v) => v !== null);
        const addr = String(x.HSSPLY_ADRES || '').trim();
        const area = String(x.SUBSCRPT_AREA_CODE_NM || (addr.split(/\s+/)[0] || '').replace(/(특별시|광역시|특별자치시|특별자치도|도)$/, '')).trim() || '기타';
        const id = `${kind}:${manageNo}`;
        byId.set(id, {
          id, manageNo, kind,
          subKind: String(x.HOUSE_DTL_SECD_NM || (kind === 'remndr' ? '무순위·줍줍' : kind === 'urbty' ? '오피스텔·도시형' : '민영APT')).trim(),
          name: String(x.HOUSE_NM || '').trim(),
          area, addr,
          units: Number(x.TOT_SUPLY_HSHLDCO || 0),
          builder: String(x.CNSTRCT_ENTRPS_NM || x.BSNS_MBY_NM || '-').trim(),
          pubDate: String(x.RCRIT_PBLANC_DE || '').slice(0, 10),
          rcptBgn: String(x.RCEPT_BGNDE || x.SUBSCRPT_RCEPT_BGNDE || '').slice(0, 10),
          rcptEnd: String(x.RCEPT_ENDDE || x.SUBSCRPT_RCEPT_ENDDE || '').slice(0, 10),
          winDate: String(x.PRZWNER_PRESNATN_DE || '').slice(0, 10),
          moveIn: String(x.MVN_PREARNGE_YM || '').trim(),
          homeUrl: String(x.HMPG_ADRES || '').trim(),
          pblancUrl: String(x.PBLANC_URL || 'https://www.applyhome.co.kr/').trim(),
          minPrice: prices.length ? Math.min(...prices) : 0,
          maxPrice: prices.length ? Math.max(...prices) : 0,
          avgPyeongPrice: pyPrices.length ? Math.round(pyPrices.reduce((a, b) => a + b, 0) / pyPrices.length) : 0,
          maxRate: comps.length ? Math.max(...comps.map((c) => c.rateNum)) : null,
          totalReq: comps.filter((c) => c.rank === 1).reduce((a, b) => a + b.req, 0),
          minWinScore: lowScores.length ? Math.min(...lowScores) : null,
          avgWinScore: avgScores.length ? Number((avgScores.reduce((a, b) => a + b, 0) / avgScores.length).toFixed(1)) : null,
          models, comps, scores,
        });
      }
    };

    mergeKind(aptR?.data, 'apt');
    mergeKind(remR?.data, 'remndr');
    mergeKind(urbR?.data, 'urbty');

    hydrateData({ ...state.data, generatedAt: new Date().toISOString(), listings: [...byId.values()] });
    log.textContent = `✅ 실시간 새로고침 완료! (총 ${byId.size}개 청약 공고 반영 · ${new Date().toTimeString().slice(0, 8)})`;
    showToast(`✅ 실시간 청약 데이터 ${byId.size}건 반영 완료!`);
  } catch (e) {
    log.textContent = `⚠ 실시간 새로고침 실패: ${e.message}`;
    showToast(`새로고침 실패: ${e.message}`);
  }
}

// =========================================================================
// 8. Navigation & Event Bindings
// =========================================================================
function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $('tabListings').classList.toggle('hidden', tab !== 'listings');
  $('tabComp').classList.toggle('hidden', tab !== 'comp');
  $('tabStarts').classList.toggle('hidden', tab !== 'starts');
  $('tabCalc').classList.toggle('hidden', tab !== 'calc');
  $('tabApi').classList.toggle('hidden', tab !== 'api');
}

function bindEvents() {
  document.querySelectorAll('.nav-tab').forEach((b) => {
    b.addEventListener('click', () => switchTab(b.dataset.tab));
  });

  $('btnTheme').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem(LS_KEY.theme, next);
    $('btnTheme').textContent = next === 'dark' ? '☀️' : '🌙';
  });

  let qTimer = null;
  $('qInput').addEventListener('input', (e) => {
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { state.filters.q = e.target.value; renderListings(); }, 100);
  });
  $('areaSelect').addEventListener('change', (e) => { state.filters.area = e.target.value; renderListings(); });
  $('sortSelect').addEventListener('change', (e) => { state.filters.sort = e.target.value; renderListings(); });

  $('kindChips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip');
    if (!btn) return;
    if (btn.id === 'chipOpenOnly') {
      state.filters.openOnly = !state.filters.openOnly;
      btn.classList.toggle('active', state.filters.openOnly);
    } else if (btn.id === 'chipStarOnly') {
      state.filters.starOnly = !state.filters.starOnly;
      btn.classList.toggle('active', state.filters.starOnly);
    } else if (btn.dataset.kind !== undefined) {
      state.filters.kind = btn.dataset.kind;
      document.querySelectorAll('#kindChips .chip[data-kind]').forEach((c) => c.classList.toggle('active', c === btn));
    }
    renderListings();
  });

  $('btnReset').addEventListener('click', () => {
    state.filters = { q: '', area: '', kind: '', sort: 'pub', openOnly: false, starOnly: false };
    $('qInput').value = '';
    $('areaSelect').value = '';
    $('sortSelect').value = 'pub';
    document.querySelectorAll('#kindChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.kind === ''));
    renderListings();
  });

  $('listingsGrid').addEventListener('click', (e) => {
    const starBtn = e.target.closest('[data-star-id]');
    if (starBtn) { e.stopPropagation(); toggleStar(starBtn.dataset.starId); return; }
    const card = e.target.closest('[data-open-id]');
    if (card) openDetail(card.dataset.openId);
  });

  $('calcMatchList').addEventListener('click', (e) => {
    const row = e.target.closest('[data-open-id]');
    if (row) openDetail(row.dataset.openId);
  });

  $('compSort').addEventListener('change', (e) => { state.compSort = e.target.value; renderCompTable(); });
  $('compTbody').addEventListener('click', (e) => {
    const tr = e.target.closest('[data-comp-id]');
    if (tr) openDetail(tr.dataset.compId);
  });

  $('startSubChips').addEventListener('click', (e) => {
    const btn = e.target.closest('.chip[data-sub]');
    if (!btn) return;
    state.startSub = btn.dataset.sub;
    document.querySelectorAll('#startSubChips .chip').forEach((c) => c.classList.toggle('active', c === btn));
    renderStartsTable();
  });
  $('startSearch').addEventListener('input', (e) => { state.startQ = e.target.value; renderStartsTable(); });
  $('btnFetchKaptRegion').addEventListener('click', fetchKaptForSelectedRegion);

  $('btnCsvListings').addEventListener('click', () => {
    const list = getFilteredListings();
    const rows = [['유형', '단지명', '시도', '주소', '시공사', '세대수', '최저분양가(만)', '최고분양가(만)', '평균평당가(만)', '1순위최고경쟁률', '최저당첨가점', '접수시작', '접수마감', '입주예정', '공고URL']];
    list.forEach((x) => rows.push([x.subKind, x.name, x.area, x.addr, x.builder, x.units, x.minPrice, x.maxPrice, x.avgPyeongPrice, x.maxRate ?? '', x.minWinScore ?? '', x.rcptBgn, x.rcptEnd, x.moveIn, x.pblancUrl]));
    downloadCsv(rows, `홈레이더_청약분양_${getTodayYmd()}.csv`);
  });

  $('btnCsvStarts').addEventListener('click', () => {
    const list = getFilteredStarts();
    if (state.startSub === 'kapt') {
      const rows = [['단지코드', '단지명', '시도', '시군구', '읍면동']];
      list.forEach((c) => rows.push([c.code, c.name, c.sido, c.sgg, c.dong]));
      downloadCsv(rows, `홈레이더_공동주택단지_${getTodayYmd()}.csv`);
    } else {
      const rows = [['출처', '건물명', '용도', '소재지', '시공사/규모', '연면적(㎡)', '착공/승인일']];
      list.forEach((s) => rows.push([s.source, s.name, s.usage, s.addr, s.builder, s.areaM2, s.startDate]));
      downloadCsv(rows, `홈레이더_착공현황_${getTodayYmd()}.csv`);
    }
  });

  $('btnCloseDetail').addEventListener('click', () => $('detailModal').classList.remove('open'));
  $('detailModal').addEventListener('click', (e) => { if (e.target === $('detailModal')) $('detailModal').classList.remove('open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('detailModal').classList.remove('open'); });
}

async function init() {
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
  initTheme();
  loadStars();
  initCalculators();
  initApiTab();
  bindEvents();
  await loadInitialSnapshot();
}

init();
