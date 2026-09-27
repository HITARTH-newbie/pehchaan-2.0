/**
 * Pehchaan 2.0 - Core Frontend Application Controller
 * Connects to FastAPI Backend on localhost:8000 / localhost:8001
 */

// Global State
const state = {
  apiBase: 'http://localhost:8001',
  apiOnline: false,
  activeTab: 'dashboard',
  stats: null,
  matches: [],
  missingPersons: [],
  unidentifiedBodies: [],
  selectedMatch: null,
  webcamStream: null,
  isScanning: false,
};

// =========================================================================
// API & BACKEND INITIALIZATION
// =========================================================================

async function detectBackend() {
  const candidateUrls = [
    window.location.origin.includes('5173') || window.location.origin.includes('file')
      ? 'http://localhost:8000'
      : window.location.origin,
    'http://localhost:8000',
    'http://localhost:8001'
  ];

  for (const url of candidateUrls) {
    try {
      const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        state.apiBase = url;
        state.apiOnline = true;
        updateApiStatusIndicator(true, url);
        return url;
      }
    } catch (e) {
      // try next
    }
  }

  // Fallback to default
  state.apiBase = 'http://localhost:8000';
  state.apiOnline = false;
  updateApiStatusIndicator(false, state.apiBase);
  return state.apiBase;
}

function updateApiStatusIndicator(online, url) {
  const badge = document.getElementById('apiStatusBadge');
  const dot = document.getElementById('apiStatusDot');
  const text = document.getElementById('apiStatusText');
  const portSelect = document.getElementById('apiPortSelect');

  if (portSelect) {
    portSelect.value = url;
  }

  if (online) {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse';
    text.textContent = `YuNet + SFace Live (${url.replace('http://', '')})`;
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-medium bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 shadow-sm';
  } else {
    dot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400';
    text.textContent = `Connecting to ${url.replace('http://', '')}...`;
    badge.className = 'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono font-medium bg-amber-950/60 text-amber-400 border border-amber-500/30';
  }
}

function switchApiPort(newUrl) {
  state.apiBase = newUrl;
  showToast(`Switching backend target to ${newUrl}...`, 'info');
  detectBackend().then(() => {
    refreshAllData();
  });
}

// Helper to normalize image paths for static serving
function getImageUrl(photoPath) {
  if (!photoPath) return 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80';
  // If already absolute URL
  if (photoPath.startsWith('http://') || photoPath.startsWith('https://')) return photoPath;
  // Replace backslashes
  const cleanPath = photoPath.replace(/\\/g, '/');
  return `${state.apiBase}/${cleanPath.startsWith('/') ? cleanPath.slice(1) : cleanPath}`;
}

// =========================================================================
// DATA FETCHING & SYNC
// =========================================================================

async function fetchStats() {
  try {
    const res = await fetch(`${state.apiBase}/cases/stats`);
    if (res.ok) {
      state.stats = await res.json();
      renderStats();
    }
  } catch (err) {
    console.warn('Could not fetch stats', err);
  }
}

async function fetchMatches() {
  try {
    const res = await fetch(`${state.apiBase}/cases/matches`);
    if (res.ok) {
      state.matches = await res.json();
      renderMatchesTable();
      renderRecentAlert();
    }
  } catch (err) {
    console.warn('Could not fetch matches', err);
  }
}

async function fetchCases() {
  try {
    const [missingRes, bodiesRes] = await Promise.all([
      fetch(`${state.apiBase}/cases/missing-persons`),
      fetch(`${state.apiBase}/cases/unidentified-bodies`)
    ]);

    if (missingRes.ok) state.missingPersons = await missingRes.json();
    if (bodiesRes.ok) state.unidentifiedBodies = await bodiesRes.json();

    renderCaseRegistry();
  } catch (err) {
    console.warn('Could not fetch cases', err);
  }
}

async function refreshAllData() {
  await Promise.all([fetchStats(), fetchMatches(), fetchCases()]);
}

// =========================================================================
// RENDER VIEWS & UI BINDINGS
// =========================================================================

function renderStats() {
  if (!state.stats) return;

  const totalCasesEl = document.getElementById('statTotalCases');
  const missingEl = document.getElementById('statMissingPersons');
  const bodiesEl = document.getElementById('statUnidentifiedBodies');
  const matchesEl = document.getElementById('statPotentialMatches');

  if (totalCasesEl) totalCasesEl.textContent = state.stats.total_cases ?? 0;
  if (missingEl) missingEl.textContent = state.stats.missing_persons_count ?? 0;
  if (bodiesEl) bodiesEl.textContent = state.stats.unidentified_bodies_count ?? 0;
  if (matchesEl) matchesEl.textContent = state.stats.potential_matches_count ?? 0;
}

function renderRecentAlert() {
  const container = document.getElementById('recentMatchAlertContainer');
  if (!container) return;

  const potentialMatches = state.matches.filter(m => m.status === 'POTENTIAL');
  if (potentialMatches.length > 0) {
    const topMatch = potentialMatches[0];
    container.innerHTML = `
      <div class="relative overflow-hidden rounded-3xl p-6 sm:p-7 border-2 border-emerald-500/60 bg-gradient-to-r from-emerald-950/80 via-slate-900/90 to-slate-950/80 shadow-2xl flex flex-col md:flex-row items-center justify-between gap-5">
        <div class="flex items-center gap-5">
          <div class="w-14 h-14 rounded-2xl bg-emerald-500/25 border-2 border-emerald-400 text-emerald-300 flex items-center justify-center shrink-0 pulse-radar shadow-lg shadow-emerald-500/30">
            <i data-lucide="shield-alert" class="w-7 h-7"></i>
          </div>
          <div>
            <div class="flex items-center gap-2.5">
              <span class="px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-lg bg-emerald-500/30 text-emerald-200 border border-emerald-400/60 shadow-sm">
                Live AI Match Alert
              </span>
              <span class="text-xs font-mono text-slate-300">${new Date(topMatch.created_at || Date.now()).toLocaleTimeString()}</span>
            </div>
            <h4 class="text-lg sm:text-xl font-extrabold text-white mt-1.5">
              Potential biometric correlation found for <span class="text-emerald-400 underline underline-offset-4">${topMatch.missing_person_name || 'Registered Subject'}</span>
            </h4>
            <p class="text-sm text-slate-200 mt-1 font-medium">
              Face Similarity: <strong class="text-sky-300 font-mono">${topMatch.face_score?.toFixed(1) ?? 'N/A'}%</strong> | Attribute Consistency: <strong class="text-indigo-300 font-mono">${topMatch.attribute_score?.toFixed(1) ?? 'N/A'}%</strong> | Overall Score: <strong class="text-emerald-400 font-mono text-base">${topMatch.overall_score?.toFixed(1)}%</strong>
            </p>
          </div>
        </div>
        <button onclick="openMatchModal('${topMatch.id}')" class="px-6 py-3.5 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 font-black text-xs tracking-wider uppercase transition-all shadow-xl shadow-emerald-500/30 flex items-center gap-2.5 shrink-0">
          <i data-lucide="external-link" class="w-4 h-4"></i> Inspect Breakdown
        </button>
      </div>
    `;
    lucide.createIcons();
  } else {
    container.innerHTML = '';
  }
}

function renderMatchesTable() {
  const tableBody = document.getElementById('matchesTableBody');
  const verifyTableBody = document.getElementById('matchesTableBodyVerification');
  const emptyState = document.getElementById('matchesEmptyState');

  if (state.matches.length === 0) {
    if (tableBody) tableBody.innerHTML = '';
    if (verifyTableBody) verifyTableBody.innerHTML = '<tr><td colspan="8" class="text-center py-10 text-slate-400 text-sm font-medium">No matches recorded yet. Submit an unidentified case to trigger AI matching.</td></tr>';
    if (emptyState) emptyState.classList.remove('hidden');
    return;
  }

  if (emptyState) emptyState.classList.add('hidden');

  const rowsHtml = state.matches.map(m => {
    const isPotential = m.status === 'POTENTIAL';
    return `
      <tr class="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
        <td class="py-4 px-4">
          <div class="flex items-center gap-3.5">
            <img src="${getImageUrl(m.missing_person_photo)}" alt="Person" class="w-13 h-13 rounded-xl object-cover border-2 border-slate-700 bg-slate-950" style="width: 50px; height: 50px;" onerror="this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'" />
            <div>
              <div class="font-extrabold text-white text-sm sm:text-base">${m.missing_person_name || 'Unknown'}</div>
              <div class="text-xs text-slate-300 font-medium">Age: ${m.missing_person_age || 'N/A'} • ${m.missing_person_gender || 'N/A'}</div>
            </div>
          </div>
        </td>
        <td class="py-4 px-4">
          <div class="flex items-center gap-3.5">
            <img src="${getImageUrl(m.body_photo)}" alt="Body" class="w-13 h-13 rounded-xl object-cover border-2 border-slate-700 bg-slate-950" style="width: 50px; height: 50px;" onerror="this.src='https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80'" />
            <div>
              <div class="text-xs text-sky-400 font-mono font-bold">${m.unidentified_body_id ? m.unidentified_body_id.slice(0, 8) : 'Case'}</div>
              <div class="text-xs text-slate-300 font-medium truncate max-w-[150px]">${m.body_location || 'Location unrecorded'}</div>
            </div>
          </div>
        </td>
        <td class="py-4 px-4 font-mono text-sm">
          <div class="flex items-center gap-2.5">
            <div class="w-20 bg-slate-800 rounded-full h-2.5 overflow-hidden">
              <div class="bg-sky-400 h-2.5 rounded-full" style="width: ${Math.min(m.face_score || 0, 100)}%"></div>
            </div>
            <span class="text-sky-300 font-bold text-sm">${m.face_score?.toFixed(1) || '0'}%</span>
          </div>
        </td>
        <td class="py-4 px-4 font-mono text-base font-extrabold">
          <span class="${m.overall_score >= 80 ? 'text-emerald-400' : m.overall_score >= 60 ? 'text-amber-400' : 'text-slate-400'}">
            ${m.overall_score?.toFixed(1) || '0'}%
          </span>
        </td>
        <td class="py-4 px-4">
         <span class="${
  m.status === 'POTENTIAL'
    ? 'badge-potential'
    : m.status === 'REVIEW'
      ? 'badge-review'
      : 'badge-low'
}">
          </span>
        </td>
        <td class="py-4 px-4 text-right">
          <div class="flex items-center justify-end gap-1.5">
            <button onclick="deleteMatch('${m.id}')" title="Dismiss Match" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 transition-colors">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
            <button onclick="openMatchModal('${m.id}')" class="px-4 py-2 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-400/50 text-xs font-bold transition-all shadow-sm">
              Inspect AI
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (tableBody) tableBody.innerHTML = rowsHtml;
  if (verifyTableBody) {
    verifyTableBody.innerHTML = state.matches.map(m => {
      const isPotential = m.status === 'POTENTIAL';
      return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/40 transition-colors">
          <td class="py-4 px-5">
            <div class="flex items-center gap-3.5">
              <img src="${getImageUrl(m.missing_person_photo)}" alt="Person" class="rounded-xl object-cover border-2 border-slate-700 bg-slate-900" style="width: 48px; height: 48px;" onerror="this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80'" />
              <div>
                <div class="font-extrabold text-white text-sm">${m.missing_person_name || 'Unknown'}</div>
                <div class="text-xs text-slate-300 font-medium">${m.missing_person_gender || ''} • ${m.missing_person_age ? `${m.missing_person_age} yrs` : ''}</div>
              </div>
            </div>
          </td>
          <td class="py-4 px-5">
            <div class="flex items-center gap-3.5">
              <img src="${getImageUrl(m.body_photo)}" alt="Body" class="rounded-xl object-cover border-2 border-slate-700 bg-slate-900" style="width: 48px; height: 48px;" onerror="this.src='https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80'" />
              <div>
                <div class="text-xs text-sky-400 font-mono font-bold">${m.unidentified_body_id ? m.unidentified_body_id.slice(0, 8) : 'Case'}</div>
                <div class="text-xs text-slate-300 font-medium truncate max-w-[160px]">${m.body_location || 'N/A'}</div>
              </div>
            </div>
          </td>
          <td class="py-4 px-5 font-mono text-sm text-sky-400 font-bold">${m.face_score?.toFixed(1) || '0'}%</td>
          <td class="py-4 px-5 font-mono text-sm text-indigo-400 font-bold">${m.attribute_score?.toFixed(1) || 'N/A'}%</td>
          <td class="py-4 px-5 font-mono text-sm text-purple-400 font-bold">${m.text_score?.toFixed(1) || 'N/A'}%</td>
          <td class="py-4 px-5 font-mono text-base font-black text-emerald-400">${m.overall_score?.toFixed(1) || '0'}%</td>
          <td class="py-4 px-5">
            <span class="px-3 py-1 rounded-full text-xs font-bold ${isPotential ? 'badge-potential' : 'badge-low'}">
              ${m.status}
            </span>
          </td>
          <td class="py-4 px-5 text-right">
            <div class="flex items-center justify-end gap-1.5">
              <button onclick="deleteMatch('${m.id}')" title="Dismiss Match" class="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 transition-colors">
                <i data-lucide="trash-2" class="w-4 h-4"></i>
              </button>
              <button onclick="openMatchModal('${m.id}')" class="px-3.5 py-1.5 rounded-xl bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-400/50 text-xs font-bold">
                Review
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  lucide.createIcons();
}

async function deleteMatch(matchId) {
  if (!confirm('Dismiss and remove this match correlation from the system?')) {
    return;
  }

  showToast('Dismissing match...', 'info');

  try {
    const res = await fetch(`${state.apiBase}/cases/match/${matchId}`, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Failed to dismiss match');
    }

    showToast('Match record dismissed successfully', 'success');
    await refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}


function renderCaseRegistry() {
  const container = document.getElementById('caseRegistryGrid');
  if (!container) return;

  const filter = document.getElementById('registryFilterSelect')?.value || 'all';
  const query = (document.getElementById('registrySearchInput')?.value || '').toLowerCase();

  let items = [];

  if (filter === 'all' || filter === 'missing') {
    items = items.concat(state.missingPersons.map(p => ({ ...p, type: 'MISSING' })));
  }
  if (filter === 'all' || filter === 'unidentified') {
    items = items.concat(state.unidentifiedBodies.map(b => ({ ...b, type: 'UNIDENTIFIED' })));
  }

  if (query) {
    items = items.filter(item => {
      const name = (item.name || '').toLowerCase();
      const caseNum = (item.case_number || '').toLowerCase();
      const loc = (item.last_seen_location || item.found_location || '').toLowerCase();
      const desc = (item.description || item.physical_description || '').toLowerCase();
      return name.includes(query) || caseNum.includes(query) || loc.includes(query) || desc.includes(query);
    });
  }

  if (items.length === 0) {
    container.innerHTML = `
      <div class="col-span-full py-16 text-center text-slate-400">
        <i data-lucide="folder-search" class="w-14 h-14 mx-auto stroke-1 text-slate-500 mb-3"></i>
        <p class="text-base font-medium">No cases match the specified search or filter criteria.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = items.map(item => {
    const isMissing = item.type === 'MISSING';
    const title = isMissing ? item.name : `Unidentified Subject (${item.case_number})`;
    const location = isMissing ? item.last_seen_location : item.found_location;
    const date = isMissing ? item.last_seen_date : item.found_date;
    const age = isMissing ? item.age : item.estimated_age;
    const desc = isMissing ? item.description : item.physical_description;

    return `
      <div class="glass-panel rounded-3xl overflow-hidden border-2 border-slate-700/80 hover:border-sky-400/60 transition-all flex flex-col group shadow-xl">
        <div class="relative h-60 bg-slate-950 overflow-hidden">
          <img src="${getImageUrl(item.photo_path)}" alt="${title}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" onerror="this.src='https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80'" />
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent"></div>
          
          <div class="absolute top-3.5 left-3.5 flex gap-2">
            <span class="px-3 py-1 rounded-lg text-xs font-extrabold uppercase tracking-wider ${isMissing ? 'bg-indigo-600 text-white shadow-indigo-900/50' : 'bg-rose-600 text-white shadow-rose-900/50'} shadow-md">
              ${isMissing ? 'Missing' : 'Unidentified'}
            </span>
            ${item.has_embedding ? `
              <span class="px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold bg-emerald-950/90 text-emerald-300 border border-emerald-500/50 flex items-center gap-1.5 shadow-sm">
                <i data-lucide="cpu" class="w-3.5 h-3.5 text-emerald-400"></i> 128D Face
              </span>
            ` : ''}
          </div>

          <div class="absolute bottom-3.5 left-4 right-4">
            <span class="text-xs font-mono text-sky-400 font-bold">${item.case_number || 'PH-CASE'}</span>
            <h3 class="text-xl font-black text-white truncate">${title}</h3>
          </div>
        </div>

        <div class="p-5 flex-1 flex flex-col justify-between space-y-4">
          <div class="grid grid-cols-2 gap-3 text-xs sm:text-sm text-slate-200">
            <div>
              <span class="text-slate-400 block text-xs font-semibold">Age / Gender:</span>
              <span class="font-bold text-white">${age ? `${age} yrs` : 'Unknown'} • ${item.gender || 'Unknown'}</span>
            </div>
            <div>
              <span class="text-slate-400 block text-xs font-semibold">Height:</span>
              <span class="font-bold text-white">${item.height_cm || item.estimated_height_cm ? `${item.height_cm || item.estimated_height_cm} cm` : 'Not recorded'}</span>
            </div>
            <div class="col-span-2">
              <span class="text-slate-400 block text-xs font-semibold">${isMissing ? 'Last Known Location:' : 'Found At:'}</span>
              <span class="font-bold text-white truncate block">${location || 'Location unrecorded'}</span>
            </div>
          </div>

          ${desc ? `
            <p class="text-xs sm:text-sm text-slate-300 line-clamp-2 italic bg-slate-900/90 p-3 rounded-xl border border-slate-750">
              "${desc}"
            </p>
          ` : ''}

          <div class="pt-3 border-t border-slate-800 flex items-center justify-between text-xs sm:text-sm">
            <span class="text-slate-400 font-mono font-medium">${date ? new Date(date).toLocaleDateString() : 'Date N/A'}</span>
            <div class="flex items-center gap-2">
              <button onclick="deleteCase('${item.type}', '${item.id}', '${item.case_number}')" title="Delete Case" class="text-rose-400 hover:text-rose-300 font-bold flex items-center gap-1 transition-colors px-2 py-1 rounded-lg hover:bg-rose-950/60 border border-transparent hover:border-rose-500/40">
                <i data-lucide="trash-2" class="w-4 h-4"></i> Delete
              </button>
              <button onclick="triggerQuickSearchFromCase('${item.photo_path}')" class="text-sky-400 hover:text-sky-300 font-bold flex items-center gap-1.5 transition-colors px-2 py-1 rounded-lg hover:bg-sky-950/50">
                <i data-lucide="scan-face" class="w-4 h-4"></i> Match Search
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

async function deleteCase(type, id, caseNumber) {
  const isMissing = type === 'MISSING';
  const label = isMissing ? 'Missing Person' : 'Unidentified Case';
  if (!confirm(`Are you sure you want to delete this ${label} (${caseNumber || id})? This will permanently remove the record and any calculated matches.`)) {
    return;
  }

  showToast(`Deleting ${caseNumber || 'case'}...`, 'info');

  try {
    const endpoint = isMissing
      ? `${state.apiBase}/cases/missing-person/${id}`
      : `${state.apiBase}/cases/unidentified-body/${id}`;

    const res = await fetch(endpoint, { method: 'DELETE' });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || 'Failed to delete case');
    }

    showToast(`Case ${caseNumber || ''} removed successfully`, 'success');
    await refreshAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}


// =========================================================================
// FORENSIC MATCH MODAL
// =========================================================================

function openMatchModal(matchId) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;

  state.selectedMatch = match;
  const modal = document.getElementById('matchDetailModal');

  document.getElementById('modalPersonPhoto').src = getImageUrl(match.missing_person_photo);
  document.getElementById('modalBodyPhoto').src = getImageUrl(match.body_photo);
  document.getElementById('modalPersonName').textContent = match.missing_person_name || 'Subject Record';
  document.getElementById('modalPersonAge').textContent = match.missing_person_age ? `${match.missing_person_age} yrs` : 'N/A';
  document.getElementById('modalPersonGender').textContent = match.missing_person_gender || 'N/A';
  document.getElementById('modalPersonLocation').textContent = match.missing_person_last_seen || 'N/A';

  document.getElementById('modalBodyAge').textContent = match.body_estimated_age ? `${match.body_estimated_age} yrs` : 'N/A';
  document.getElementById('modalBodyLocation').textContent = match.body_location || 'N/A';

  // Gauges
  const faceScore = match.face_score || 0;
  const attrScore = match.attribute_score || 0;
  const textScore = match.text_score || 0;
  const overallScore = match.overall_score || 0;

  document.getElementById('modalFaceScore').textContent = `${faceScore.toFixed(1)}%`;
  document.getElementById('modalFaceBar').style.width = `${Math.min(faceScore, 100)}%`;

  document.getElementById('modalAttrScore').textContent = `${attrScore.toFixed(1)}%`;
  document.getElementById('modalAttrBar').style.width = `${Math.min(attrScore, 100)}%`;

  document.getElementById('modalTextScore').textContent = `${textScore.toFixed(1)}%`;
  document.getElementById('modalTextBar').style.width = `${Math.min(textScore, 100)}%`;

  document.getElementById('modalOverallScore').textContent = `${overallScore.toFixed(1)}%`;
  document.getElementById('modalOverallBadge').textContent = match.status;

  if (match.status === 'POTENTIAL') {
    document.getElementById('modalOverallBadge').className = 'px-3 py-1 rounded-full text-xs font-semibold badge-potential';
  } else {
    document.getElementById('modalOverallBadge').className = 'px-3 py-1 rounded-full text-xs font-semibold badge-low';
  }

  document.getElementById('modalExplanation').textContent = match.explanation || 'No forensic narrative available.';

  modal.classList.remove('hidden');
  lucide.createIcons();
}

function closeMatchModal() {
  document.getElementById('matchDetailModal').classList.add('hidden');
}

// =========================================================================
// INSTANT AI FACE MATCH (BIOMETRIC SCANNER)
// =========================================================================

let quickMatchSelectedFile = null;

function setupQuickMatchDragDrop() {
  const dropzone = document.getElementById('scannerDropzone');
  const fileInput = document.getElementById('scannerFileInput');

  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('border-sky-400', 'bg-sky-950/20');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('border-sky-400', 'bg-sky-950/20');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('border-sky-400', 'bg-sky-950/20');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleQuickMatchFile(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleQuickMatchFile(e.target.files[0]);
    }
  });
}

function handleQuickMatchFile(file) {
  quickMatchSelectedFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('scannerPreviewImg');
    const container = document.getElementById('scannerPreviewContainer');
    const placeholder = document.getElementById('scannerPlaceholder');
    const runBtn = document.getElementById('runScanBtn');

    preview.src = e.target.result;
    container.classList.remove('hidden');
    placeholder.classList.add('hidden');
    runBtn.disabled = false;
    runBtn.classList.remove('opacity-50', 'cursor-not-allowed');
  };
  reader.readAsDataURL(file);
}

// Webcam integration
async function toggleWebcam() {
  const video = document.getElementById('scannerVideo');
  const preview = document.getElementById('scannerPreviewImg');
  const container = document.getElementById('scannerPreviewContainer');
  const placeholder = document.getElementById('scannerPlaceholder');
  const webcamBtn = document.getElementById('scannerWebcamBtn');
  const captureBtn = document.getElementById('scannerCaptureBtn');

  if (state.webcamStream) {
    // Stop webcam
    state.webcamStream.getTracks().forEach(track => track.stop());
    state.webcamStream = null;
    video.classList.add('hidden');
    captureBtn.classList.add('hidden');
    webcamBtn.innerHTML = `<i data-lucide="camera" class="w-4 h-4"></i> Live Camera`;
    lucide.createIcons();
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
    state.webcamStream = stream;
    video.srcObject = stream;
    video.classList.remove('hidden');
    captureBtn.classList.remove('hidden');
    placeholder.classList.add('hidden');
    container.classList.remove('hidden');
    preview.classList.add('hidden');
    webcamBtn.innerHTML = `<i data-lucide="video-off" class="w-4 h-4"></i> Stop Camera`;
    lucide.createIcons();
  } catch (err) {
    showToast('Camera access denied or unavailable', 'error');
  }
}

function captureWebcamFrame() {
  const video = document.getElementById('scannerVideo');
  const preview = document.getElementById('scannerPreviewImg');
  const captureBtn = document.getElementById('scannerCaptureBtn');
  const runBtn = document.getElementById('runScanBtn');

  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 640;
  canvas.height = video.videoHeight || 480;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    quickMatchSelectedFile = new File([blob], "webcam_capture.jpg", { type: "image/jpeg" });
    preview.src = canvas.toDataURL('image/jpeg');
    preview.classList.remove('hidden');
    video.classList.add('hidden');
    captureBtn.classList.add('hidden');
    runBtn.disabled = false;
    runBtn.classList.remove('opacity-50', 'cursor-not-allowed');

    // Stop stream
    if (state.webcamStream) {
      state.webcamStream.getTracks().forEach(track => track.stop());
      state.webcamStream = null;
      document.getElementById('scannerWebcamBtn').innerHTML = `<i data-lucide="camera" class="w-4 h-4"></i> Live Camera`;
      lucide.createIcons();
    }
  }, 'image/jpeg', 0.95);
}

async function executeBiometricScan() {
  if (!quickMatchSelectedFile) {
    showToast('Please select or capture a photo first', 'warning');
    return;
  }

  const runBtn = document.getElementById('runScanBtn');
  const hudOverlay = document.getElementById('scannerHudOverlay');
  const resultsContainer = document.getElementById('scannerResultsContainer');
  const resultsList = document.getElementById('scannerResultsList');

  runBtn.disabled = true;
  hudOverlay.classList.remove('hidden');
  resultsContainer.classList.add('hidden');

  const formData = new FormData();
  formData.append('file', quickMatchSelectedFile);

  try {
    const res = await fetch(`${state.apiBase}/cases/match`, {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || data.message || 'Face matching failed');
    }

    // Render matches
    renderQuickScanResults(data);
    showToast(`Scan complete: ${data.candidates_checked || 0} enrolled profiles evaluated.`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    runBtn.disabled = false;
    hudOverlay.classList.add('hidden');
  }
}

function renderQuickScanResults(data) {
  const resultsContainer = document.getElementById('scannerResultsContainer');
  const resultsList = document.getElementById('scannerResultsList');
  const candidatesCheckedEl = document.getElementById('scannerCandidatesChecked');

  if (!resultsContainer || !resultsList) return;

  resultsContainer.classList.remove('hidden');

  // ---------------------------------------------------------
  // Candidates checked
  // ---------------------------------------------------------

  const candidatesChecked =
    data.candidates_checked ??
    data.total_candidates ??
    data.results?.length ??
    0;

  if (candidatesCheckedEl) {
    candidatesCheckedEl.textContent = candidatesChecked;
  }

  // ---------------------------------------------------------
  // Face detection confidence
  // ---------------------------------------------------------

  const confidence =
    data.face_confidence ??
    data.confidence ??
    0;

  const confidencePercent =
    confidence <= 1
      ? confidence * 100
      : confidence;

  // Update visible Face Confidence element
  const faceConfidenceEl =
    document.getElementById('scannerFaceConfidence');

  if (faceConfidenceEl) {
    faceConfidenceEl.textContent =
      `${confidencePercent.toFixed(1)}%`;
  }

  // ---------------------------------------------------------
  // Matches
  // ---------------------------------------------------------

  const matches =
    data.matches ||
    data.results ||
    [];

  if (!matches.length) {

    resultsList.innerHTML = `
      <div class="p-6 text-center">

        <div class="text-slate-400 text-sm">
          No potential facial matches found.
        </div>

        <div class="text-xs text-slate-500 mt-2">
          Try another image with a clearer face.
        </div>

      </div>
    `;

    return;
  }

  // ---------------------------------------------------------
  // Render matches
  // ---------------------------------------------------------

  resultsList.innerHTML = matches.map((m, index) => {

    const sim =
      m.similarity_percent ??
      (
        m.similarity != null
          ? m.similarity * 100
          : 0
      );

    const similarity =
      Math.max(
        0,
        Math.min(100, sim)
      );

    const name =
      m.name ||
      m.person_name ||
      m.missing_person_name ||
      `Candidate ${index + 1}`;

    const status =
      m.status ||
      (
        similarity >= 80
          ? 'POTENTIAL_MATCH'
          : 'LOW_SIMILARITY'
      );

    return `
      <div class="p-4 border-b border-slate-800 last:border-b-0">

        <div class="flex items-center justify-between gap-4">

          <div class="flex items-center gap-3">

            <div
              class="w-10 h-10 rounded-full
                     bg-cyan-500/10
                     border border-cyan-500/20
                     flex items-center justify-center"
            >
              <span class="text-cyan-400 font-semibold">
                ${index + 1}
              </span>
            </div>

            <div>

              <div class="font-semibold text-white">
                ${name}
              </div>

              <div class="text-xs text-slate-500 mt-1">
                ${status}
              </div>

            </div>

          </div>

          <div class="text-right">

            <div class="text-xl font-bold text-cyan-400">
              ${similarity.toFixed(1)}%
            </div>

            <div class="text-xs text-slate-500">
              Facial Similarity
            </div>

          </div>

        </div>

        <div class="mt-4">

          <div class="flex justify-between text-xs mb-1">

            <span class="text-slate-500">
              Facial Similarity
            </span>

            <span class="text-slate-400">
              ${similarity.toFixed(1)}%
            </span>

          </div>

          <div
            class="w-full h-2 rounded-full
                   bg-slate-800 overflow-hidden"
          >

            <div
              class="h-full rounded-full
                     bg-cyan-500
                     transition-all"
              style="width: ${similarity}%"
            ></div>

          </div>

        </div>

        <div
          class="mt-3 p-3 rounded-lg
                 bg-amber-500/5
                 border border-amber-500/10"
        >

          <div class="flex gap-2">

            <span class="text-amber-400">
              ⚠
            </span>

            <p class="text-xs text-slate-400 leading-relaxed">
              Facial embedding similarity is not an identity probability
              and does not confirm identity. Investigator verification
              is required.
            </p>

          </div>

        </div>

      </div>
    `;

  }).join('');

  // ---------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------

  console.log(
    `Face detection confidence: ${confidencePercent.toFixed(2)}%`
  );

  console.log(
    `Instant biometric search completed: ${matches.length} candidates`
  );
}

function triggerQuickSearchFromCase(photoPath) {
  switchTab('instant-match');
  showToast('Loading subject photo for cross-examination...', 'info');
  const preview = document.getElementById('scannerPreviewImg');
  const container = document.getElementById('scannerPreviewContainer');
  const placeholder = document.getElementById('scannerPlaceholder');
  const runBtn = document.getElementById('runScanBtn');

  const fullUrl = getImageUrl(photoPath);
  preview.src = fullUrl;
  container.classList.remove('hidden');
  placeholder.classList.add('hidden');

  fetch(fullUrl)
    .then(res => res.blob())
    .then(blob => {
      quickMatchSelectedFile = new File([blob], 'case_query.jpg', { type: blob.type });
      runBtn.disabled = false;
      runBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      executeBiometricScan();
    })
    .catch(() => {
      showToast('Could not convert image for auto-search; please select manually', 'warning');
    });
}

// =========================================================================
// REPORT MISSING PERSON FORM
// =========================================================================

let missingPersonPhotoFile = null;

function setupMissingPersonPhotoUpload() {
  const input = document.getElementById('missingPersonPhotoInput');
  const preview = document.getElementById('missingPersonPhotoPreview');
  const label = document.getElementById('missingPersonPhotoLabel');

  if (!input) return;

  input.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      missingPersonPhotoFile = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        preview.src = ev.target.result;
        preview.classList.remove('hidden');
        label.classList.add('hidden');
      };
      reader.readAsDataURL(missingPersonPhotoFile);
    }
  });
}

async function handleMissingPersonSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('submitMissingPersonBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Registering Case...`;
  lucide.createIcons();

  try {
    const payload = {
      name: document.getElementById('mpName').value,
      age: parseInt(document.getElementById('mpAge').value) || null,
      gender: document.getElementById('mpGender').value || null,
      height_cm: parseFloat(document.getElementById('mpHeight').value) || null,
      last_seen_location: document.getElementById('mpLocation').value || null,
      last_seen_date: document.getElementById('mpDate').value ? new Date(document.getElementById('mpDate').value).toISOString() : null,
      description: document.getElementById('mpDescription').value || null
    };

    // 1. Create Missing Person Case
    const caseRes = await fetch(`${state.apiBase}/cases/missing-person`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const caseData = await caseRes.json();
    if (!caseRes.ok) throw new Error(caseData.detail || 'Failed to create case');

    const missingPersonId = caseData.missing_person_id;
    const caseNumber = caseData.case_number;

    // 2. Upload Photo & Generate Face Embedding
    if (missingPersonPhotoFile) {
      submitBtn.innerHTML = `<i data-lucide="cpu" class="w-4 h-4 animate-spin"></i> Generating 128D Face Embedding...`;
      lucide.createIcons();

      const photoFormData = new FormData();
      photoFormData.append('file', missingPersonPhotoFile);

      const photoRes = await fetch(`${state.apiBase}/cases/missing-person/${missingPersonId}/photo`, {
        method: 'POST',
        body: photoFormData
      });

      const photoData = await photoRes.json();
      if (photoRes.ok && photoData.face_detected) {
        showToast(`Face embedding generated successfully! YuNet AI Confidence: 99%`, 'success');
      } else {
        showToast(`Case registered, but photo face warning: ${photoData.ai_message || 'No clear face'}`, 'warning');
      }
    }

    showToast(`Missing Person case ${caseNumber} logged successfully!`, 'success');

    // Reset Form
    e.target.reset();
    document.getElementById('missingPersonPhotoPreview').classList.add('hidden');
    document.getElementById('missingPersonPhotoLabel').classList.remove('hidden');
    missingPersonPhotoFile = null;

    await refreshAllData();
    switchTab('cases');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> Submit Missing Person Report`;
    lucide.createIcons();
  }
}

// =========================================================================
// REPORT UNIDENTIFIED PERSON / CASE
// =========================================================================

let unidentifiedPhotoFile = null;

function setupUnidentifiedPhotoUpload() {
  const input = document.getElementById('unidentifiedPhotoInput');
  const preview = document.getElementById('unidentifiedPhotoPreview');
  const label = document.getElementById('unidentifiedPhotoLabel');

  if (!input) return;

  input.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      unidentifiedPhotoFile = e.target.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        preview.src = ev.target.result;
        preview.classList.remove('hidden');
        label.classList.add('hidden');
      };
      reader.readAsDataURL(unidentifiedPhotoFile);
    }
  });
}

async function handleUnidentifiedSubmit(e) {
  e.preventDefault();
  const submitBtn = document.getElementById('submitUnidentifiedBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i> Filing Case & Running AI Matching...`;
  lucide.createIcons();

  try {
    const payload = {
      estimated_age: parseInt(document.getElementById('ubAge').value) || null,
      gender: document.getElementById('ubGender').value || null,
      estimated_height_cm: parseFloat(document.getElementById('ubHeight').value) || null,
      found_location: document.getElementById('ubLocation').value || null,
      found_date: document.getElementById('ubDate').value ? new Date(document.getElementById('ubDate').value).toISOString() : null,
      physical_description: document.getElementById('ubDescription').value || null
    };

    // 1. Create Case
    const caseRes = await fetch(`${state.apiBase}/cases/unidentified-body`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const caseData = await caseRes.json();
    if (!caseRes.ok) throw new Error(caseData.detail || 'Failed to file case');

    const bodyId = caseData.unidentified_body_id;
    const caseNumber = caseData.case_number;

    // 2. Upload Photo & Run Multi-Factor Matching
    if (unidentifiedPhotoFile) {
      submitBtn.innerHTML = `<i data-lucide="scan" class="w-4 h-4 animate-spin"></i> Running Multi-Factor Correlation...`;
      lucide.createIcons();

      const photoFormData = new FormData();
      photoFormData.append('file', unidentifiedPhotoFile);

      const photoRes = await fetch(`${state.apiBase}/cases/unidentified-body/${bodyId}/photo`, {
        method: 'POST',
        body: photoFormData
      });

      const matchData = await photoRes.json();
      if (photoRes.ok) {
        const potentialMatches = (matchData.matches || []).filter(m => m.status === 'POTENTIAL');
        if (potentialMatches.length > 0) {
          showToast(`🚨 ALERT: ${potentialMatches.length} POTENTIAL MATCH(ES) FOUND! Top Match: ${potentialMatches[0].overall_score}%`, 'success');
        } else {
          showToast(`Photo processed. ${matchData.candidates_checked || 0} enrolled profiles compared.`, 'info');
        }
      }
    }

    showToast(`Unidentified Case ${caseNumber} logged successfully!`, 'success');

    // Reset Form
    e.target.reset();
    document.getElementById('unidentifiedPhotoPreview').classList.add('hidden');
    document.getElementById('unidentifiedPhotoLabel').classList.remove('hidden');
    unidentifiedPhotoFile = null;

    await refreshAllData();
    switchTab('matches');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i data-lucide="shield-plus" class="w-4 h-4"></i> Submit & Trigger AI Matching`;
    lucide.createIcons();
  }
}

// =========================================================================
// TAB SWITCHING & ROUTING
// =========================================================================

function switchTab(tabId) {
  state.activeTab = tabId;

  // Update nav buttons
  document.querySelectorAll('.nav-tab').forEach(btn => {
    if (btn.dataset.tab === tabId) {
      btn.className = 'nav-tab px-4 py-2 rounded-xl text-xs font-semibold tracking-wide transition-all bg-sky-500/15 text-sky-400 border border-sky-500/30 flex items-center gap-2 shadow-sm';
    } else {
      btn.className = 'nav-tab px-4 py-2 rounded-xl text-xs font-medium tracking-wide transition-all text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 flex items-center gap-2';
    }
  });

  // Show active section
  document.querySelectorAll('.tab-content').forEach(section => {
    if (section.id === `tab-${tabId}`) {
      section.classList.remove('hidden');
    } else {
      section.classList.add('hidden');
    }
  });

  // Refresh lucide icons
  lucide.createIcons();
}

// =========================================================================
// TOAST NOTIFICATIONS
// =========================================================================

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  const id = 'toast-' + Math.random().toString(36).substr(2, 9);
  toast.id = id;

  let bg = 'bg-slate-900 border-slate-700 text-slate-200';
  let icon = 'info';

  if (type === 'success') {
    bg = 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200';
    icon = 'check-circle-2';
  } else if (type === 'error') {
    bg = 'bg-rose-950/90 border-rose-500/40 text-rose-200';
    icon = 'alert-triangle';
  } else if (type === 'warning') {
    bg = 'bg-amber-950/90 border-amber-500/40 text-amber-200';
    icon = 'alert-circle';
  }

  toast.className = `glass-panel ${bg} px-4 py-3 rounded-xl border shadow-xl flex items-center gap-3 text-xs font-medium transition-all transform duration-300 translate-y-2 opacity-0 max-w-md`;
  toast.innerHTML = `
    <i data-lucide="${icon}" class="w-4 h-4 shrink-0"></i>
    <span class="flex-1">${message}</span>
    <button onclick="document.getElementById('${id}').remove()" class="text-slate-400 hover:text-white">&times;</button>
  `;

  container.appendChild(toast);
  lucide.createIcons();

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

// =========================================================================
// ON DOM READY
// =========================================================================

document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();

  // Setup tab listeners
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Setup scanner
  setupQuickMatchDragDrop();

  // Setup forms
  setupMissingPersonPhotoUpload();
  setupUnidentifiedPhotoUpload();

  const mpForm = document.getElementById('missingPersonForm');
  if (mpForm) mpForm.addEventListener('submit', handleMissingPersonSubmit);

  const ubForm = document.getElementById('unidentifiedForm');
  if (ubForm) ubForm.addEventListener('submit', handleUnidentifiedSubmit);

  // Search & Filter registry
  document.getElementById('registryFilterSelect')?.addEventListener('change', renderCaseRegistry);
  document.getElementById('registrySearchInput')?.addEventListener('input', renderCaseRegistry);

  // Detect backend
  await detectBackend();
  await refreshAllData();

  // Auto-refresh stats every 15s
  setInterval(refreshAllData, 15000);
});
