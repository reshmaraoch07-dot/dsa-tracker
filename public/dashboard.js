document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');

  const statTotalSolved = document.getElementById('stat-total-solved');
  const statCurrentStreak = document.getElementById('stat-current-streak');
  const statLongestStreak = document.getElementById('stat-longest-streak');

  const syncCfBtn = document.getElementById('sync-cf-btn');
  const syncCfSpinner = document.getElementById('sync-cf-spinner');

  const pushGithubBtn = document.getElementById('push-github-btn');
  const pushGithubSpinner = document.getElementById('push-github-spinner');

  const heatmapGrid = document.getElementById('heatmap-grid');
  const heatmapMonths = document.getElementById('heatmap-months');
  const heatmapTooltip = document.getElementById('heatmap-tooltip');

  const topicCoverageList = document.getElementById('topic-coverage-list');
  const filterPlatform = document.getElementById('filter-platform');
  const filterTopic = document.getElementById('filter-topic');
  const activityTableBody = document.getElementById('activity-table-body');
  const toastContainer = document.getElementById('toast-container');

  // --- Toast Notification Helper ---
  function showToast(message, type = 'success', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
    toast.innerHTML = `<span><strong>${icon}</strong> ${message}</span>`;
    
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100%)';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // --- 1. Health & Summary Stats ---
  async function loadSummaryStats() {
    try {
      const res = await fetch('/api/stats/summary');
      if (res.ok) {
        const data = await res.json();
        statTotalSolved.textContent = data.totalSolved || 0;
        statCurrentStreak.textContent = `${data.currentStreak || 0} day${data.currentStreak === 1 ? '' : 's'}`;
        statLongestStreak.textContent = `${data.longestStreak || 0} day${data.longestStreak === 1 ? '' : 's'}`;
      }
    } catch (err) {
      console.error('Failed to load summary stats:', err);
    }
  }

  async function checkHealth() {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        statusIndicator.className = 'status-indicator online';
        statusText.textContent = 'Server Online';
      } else {
        throw new Error();
      }
    } catch (_) {
      statusIndicator.className = 'status-indicator offline';
      statusText.textContent = 'Offline';
    }
  }

  // --- 2. Heatmap Grid Rendering (Last 365 Days) ---
  async function loadHeatmap() {
    try {
      const res = await fetch('/api/stats/heatmap');
      if (!res.ok) return;
      const heatmapData = await res.json();

      heatmapGrid.innerHTML = '';
      heatmapMonths.innerHTML = '';

      // Generate 52 weeks (364 days + remainder) dates
      const today = new Date();
      const startDate = new Date();
      startDate.setDate(today.getDate() - 364);

      // Adjust start to previous Sunday for aligned grid
      const dayOfWeek = startDate.getDay();
      startDate.setDate(startDate.getDate() - dayOfWeek);

      const daysCount = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24)) + 1;
      let currentMonth = -1;

      for (let i = 0; i < daysCount; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);

        const dateStr = d.toISOString().split('T')[0];
        const count = heatmapData[dateStr] || 0;

        // Determine Level
        let lvlClass = 'lvl-0';
        if (count === 1) lvlClass = 'lvl-1';
        else if (count === 2) lvlClass = 'lvl-2';
        else if (count === 3) lvlClass = 'lvl-3';
        else if (count >= 4) lvlClass = 'lvl-4';

        const cell = document.createElement('div');
        cell.className = `heatmap-cell ${lvlClass}`;
        cell.dataset.date = dateStr;
        cell.dataset.count = count;

        // Hover tooltip handlers
        cell.addEventListener('mouseenter', (e) => {
          const rect = cell.getBoundingClientRect();
          const dateFormatted = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          heatmapTooltip.textContent = `${count} problem${count === 1 ? '' : 's'} solved on ${dateFormatted}`;
          
          heatmapTooltip.style.left = `${rect.left + window.scrollX - 20}px`;
          heatmapTooltip.style.top = `${rect.top + window.scrollY - 38}px`;
          heatmapTooltip.classList.remove('hidden');
        });

        cell.addEventListener('mouseleave', () => {
          heatmapTooltip.classList.add('hidden');
        });

        heatmapGrid.appendChild(cell);

        // Add Month Label if first row (Sunday) and new month
        if (d.getDay() === 0) {
          const month = d.getMonth();
          if (month !== currentMonth) {
            currentMonth = month;
            const monthName = d.toLocaleDateString(undefined, { month: 'short' });
            const monthLabel = document.createElement('span');
            monthLabel.textContent = monthName;
            monthLabel.style.gridColumn = `${Math.floor(i / 7) + 1}`;
            heatmapMonths.appendChild(monthLabel);
          }
        }
      }
    } catch (err) {
      console.error('Failed to render heatmap:', err);
    }
  }

  // --- 3. Topic Coverage Breakdown ---
  async function loadTopicStats() {
    try {
      const res = await fetch('/api/stats/topics');
      if (!res.ok) return;
      const topics = await res.json();

      // Populate filter dropdown if empty
      if (filterTopic.options.length <= 1) {
        topics.forEach(t => {
          const opt = document.createElement('option');
          opt.value = t.topic.toLowerCase();
          opt.textContent = t.topic;
          filterTopic.appendChild(opt);
        });
      }

      topicCoverageList.innerHTML = '';
      const maxCount = Math.max(...topics.map(t => t.count), 1);

      topics.forEach(t => {
        const isNotStarted = t.count === 0;
        const widthPct = isNotStarted ? 0 : Math.max((t.count / maxCount) * 100, 5);

        const card = document.createElement('div');
        card.className = `topic-bar-card ${isNotStarted ? 'not-started' : ''}`;
        card.innerHTML = `
          <div class="topic-info">
            <span class="topic-name">${t.topic}</span>
            <span class="topic-count-badge">${isNotStarted ? 'Not started' : `${t.count} solved`}</span>
          </div>
          <div class="progress-track">
            <div class="progress-fill" style="width: ${widthPct}%"></div>
          </div>
        `;

        topicCoverageList.appendChild(card);
      });
    } catch (err) {
      console.error('Failed to load topic stats:', err);
    }
  }

  // --- 4. Recent Activity Table ---
  async function loadProblems() {
    try {
      const platformVal = filterPlatform.value;
      const topicVal = filterTopic.value;

      const url = `/api/problems?platform=${encodeURIComponent(platformVal)}&topic=${encodeURIComponent(topicVal)}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const problems = await res.json();
      activityTableBody.innerHTML = '';

      if (problems.length === 0) {
        activityTableBody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center text-muted" style="padding: 2rem;">No matching problems found.</td>
          </tr>
        `;
        return;
      }

      problems.slice(0, 20).forEach(p => {
        const row = document.createElement('tr');
        row.className = 'activity-row';
        
        // Format date
        const dateFormatted = p.solved_at 
          ? new Date(p.solved_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : 'N/A';

        // Format topics
        let topicsArr = [];
        try { topicsArr = JSON.parse(p.topics || '[]'); } catch (_) {}
        const topicsHTML = (Array.isArray(topicsArr) && topicsArr.length > 0)
          ? topicsArr.slice(0, 3).map(t => `<span class="topic-pill">${t}</span>`).join(' ')
          : '<span class="text-muted">None</span>';

        const platformClass = (p.platform || '').toLowerCase();
        const diffClass = (p.difficulty || 'easy').toLowerCase();
        const syncStatusIcon = p.pushed_to_github 
          ? '<span title="Pushed to GitHub" style="color: #34d399;">✓</span>' 
          : '<span title="Pending Push" style="color: #fbbf24;">⏳</span>';

        const isMissingMetadata = !Array.isArray(topicsArr) || topicsArr.length === 0 || !p.difficulty;
        const autoTagBtnHTML = isMissingMetadata
          ? `<button class="btn btn-sync auto-tag-row-btn" data-id="${p.id}" style="font-size: 0.72rem; padding: 2px 8px; margin-left: 0.4rem; white-space: nowrap;" title="Auto-tag topics & difficulty with Gemini AI">🏷️ Auto-Tag</button>`
          : '';

        row.innerHTML = `
          <td>${dateFormatted}</td>
          <td><span class="platform-badge ${platformClass}">${p.platform}</span></td>
          <td><div style="display: flex; align-items: center; justify-content: space-between;"><strong>${p.title}</strong>${autoTagBtnHTML}</div></td>
          <td><span class="diff-badge ${diffClass}">${p.difficulty || 'N/A'}</span></td>
          <td><div class="topics-container">${topicsHTML}</div></td>
          <td class="text-center">${syncStatusIcon}</td>
        `;

        // Row auto-tag click handler
        const autoTagBtn = row.querySelector('.auto-tag-row-btn');
        if (autoTagBtn) {
          autoTagBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            autoTagBtn.disabled = true;
            autoTagBtn.textContent = 'Tagging...';
            try {
              const res = await fetch(`/api/problems/${p.id}/auto-tag`, { method: 'POST' });
              const data = await res.json();
              if (data.success) {
                showToast(`Auto-tagged '${p.title}' -> [${(data.topics || []).join(', ')}] (${data.difficulty})`, 'success');
                refreshDashboard();
              } else {
                showToast(`Auto-tag error: ${data.error}`, 'error');
              }
            } catch (err) {
              showToast(`Request failed: ${err.message}`, 'error');
            } finally {
              autoTagBtn.disabled = false;
              autoTagBtn.textContent = '🏷️ Auto-Tag';
            }
          });
        }

        // Row click navigates to problem detail view
        row.addEventListener('click', () => {
          window.location.href = `problem.html?id=${p.id}`;
        });

        activityTableBody.appendChild(row);
      });
    } catch (err) {
      console.error('Failed to load recent activity:', err);
    }
  }

  // --- Filter Event Listeners ---
  filterPlatform.addEventListener('change', loadProblems);
  filterTopic.addEventListener('change', loadProblems);

  // --- 5. Action Button Event Handlers ---

  // Sync Codeforces
  if (syncCfBtn) {
    syncCfBtn.addEventListener('click', async () => {
      syncCfBtn.disabled = true;
      syncCfSpinner.classList.remove('hidden');

      try {
        const res = await fetch('/api/sync/codeforces', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          showToast(`Codeforces Sync Complete! ${data.count} new problem(s) added.`, 'success');
          refreshDashboard();
        } else {
          showToast(data.message || 'Codeforces sync failed.', 'error');
        }
      } catch (err) {
        showToast(`Request Error: ${err.message}`, 'error');
      } finally {
        syncCfBtn.disabled = false;
        syncCfSpinner.classList.add('hidden');
      }
    });
  }

  // Push All to GitHub
  if (pushGithubBtn) {
    pushGithubBtn.addEventListener('click', async () => {
      pushGithubBtn.disabled = true;
      pushGithubSpinner.classList.remove('hidden');

      try {
        const res = await fetch('/api/push/all', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          showToast(`GitHub Push Complete! ${data.count} problem(s) committed & pushed.`, 'success');
          refreshDashboard();
        } else {
          showToast(data.message || 'GitHub push failed.', 'error');
        }
      } catch (err) {
        showToast(`Push Request Failed: ${err.message}`, 'error');
      } finally {
        pushGithubBtn.disabled = false;
        pushGithubSpinner.classList.add('hidden');
      }
    });
  }

  // Auto-Tag All Missing
  const autoTagAllBtn = document.getElementById('auto-tag-all-btn');
  const autoTagAllSpinner = document.getElementById('auto-tag-all-spinner');
  const autoTagAllText = document.getElementById('auto-tag-all-text');

  if (autoTagAllBtn) {
    autoTagAllBtn.addEventListener('click', async () => {
      autoTagAllBtn.disabled = true;
      autoTagAllSpinner.classList.remove('hidden');
      autoTagAllText.textContent = 'Categorizing with Gemini...';

      try {
        const res = await fetch('/api/problems/auto-tag-all', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          showToast(`Auto-Tag Complete! ${data.count} of ${data.total} problem(s) categorized.`, 'success', 6000);
          refreshDashboard();
        } else {
          showToast(data.error || 'Auto-tag failed.', 'error');
        }
      } catch (err) {
        showToast(`Request Error: ${err.message}`, 'error');
      } finally {
        autoTagAllBtn.disabled = false;
        autoTagAllSpinner.classList.add('hidden');
        autoTagAllText.textContent = '🏷️ Auto-Tag All Missing (AI)';
      }
    });
  }

  // --- Export JSON & CSV Backup ---
  const exportJsonBtn = document.getElementById('export-json-btn');
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      window.location.href = '/api/export';
    });
  }

  const exportCsvBtn = document.getElementById('export-csv-btn');
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener('click', () => {
      window.location.href = '/api/export/csv';
    });
  }

  // --- Restore Backup File Import ---
  const restoreBtn = document.getElementById('restore-backup-btn');
  const importFileInput = document.getElementById('import-file-input');

  if (restoreBtn && importFileInput) {
    restoreBtn.addEventListener('click', () => {
      importFileInput.click();
    });

    importFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const confirmed = confirm(`Are you sure you want to restore from "${file.name}"?\nExisting problem records will be preserved, and missing entries will be restored.`);
      if (!confirmed) {
        importFileInput.value = '';
        return;
      }

      try {
        const text = await file.text();
        const jsonPayload = JSON.parse(text);

        showToast('Restoring database backup...', 'info');

        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(jsonPayload)
        });

        const data = await res.json();
        if (data.success) {
          showToast(`Restore Complete! ${data.count} problem(s) restored, ${data.skipped} duplicate(s) skipped.`, 'success', 6000);
          refreshDashboard();
        } else {
          showToast(`Import Error: ${data.error}`, 'error');
        }
      } catch (err) {
        showToast(`Failed to parse backup JSON: ${err.message}`, 'error');
      } finally {
        importFileInput.value = '';
      }
    });
  }

  // --- 6. Automation Status ---
  async function loadAutomationStatus() {
    const cfTimeEl = document.getElementById('auto-cf-time');
    const cfStatusEl = document.getElementById('auto-cf-status');
    const ghTimeEl = document.getElementById('auto-github-time');
    const ghStatusEl = document.getElementById('auto-github-status');

    if (!cfTimeEl) return;

    try {
      const res = await fetch('/api/stats/automation-status');
      if (!res.ok) return;
      const data = await res.json();

      // Format Codeforces Sync
      if (data.lastCfSync) {
        const dateRaw = data.lastCfSync.created_at || data.lastCfSync.timestamp;
        const d = dateRaw ? new Date(dateRaw) : null;
        const timeStr = (d && !isNaN(d)) ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : 'Recently';
        cfTimeEl.textContent = timeStr;
        cfStatusEl.textContent = data.lastCfSync.status || 'OK';
        cfStatusEl.style.borderColor = data.lastCfSync.status === 'success' ? '#34d399' : '#f87171';
        cfStatusEl.style.color = data.lastCfSync.status === 'success' ? '#34d399' : '#f87171';
        cfStatusEl.title = data.lastCfSync.message || '';
      } else {
        cfTimeEl.textContent = 'Scheduled (4h)';
        cfStatusEl.textContent = 'Ready';
      }

      // Format GitHub Push
      if (data.lastGithubPush) {
        const dateRaw = data.lastGithubPush.created_at || data.lastGithubPush.timestamp;
        const d = dateRaw ? new Date(dateRaw) : null;
        const timeStr = (d && !isNaN(d)) ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : 'Recently';
        ghTimeEl.textContent = timeStr;
        ghStatusEl.textContent = data.lastGithubPush.status || 'OK';
        ghStatusEl.style.borderColor = data.lastGithubPush.status === 'success' ? '#34d399' : '#f87171';
        ghStatusEl.style.color = data.lastGithubPush.status === 'success' ? '#34d399' : '#f87171';
        ghStatusEl.title = data.lastGithubPush.message || '';
      } else {
        ghTimeEl.textContent = 'Scheduled (6h)';
        ghStatusEl.textContent = 'Ready';
      }
    } catch (err) {
      console.error('Failed to load automation status:', err);
    }
  }

  // --- 7. Focus Areas (Weakest Topics) ---
  async function loadFocusTopics() {
    const container = document.getElementById('focus-topics-list');
    if (!container) return;

    try {
      const res = await fetch('/api/stats/weak-topics?limit=5');
      if (!res.ok) return;
      const weakTopics = await res.json();

      container.innerHTML = '';

      weakTopics.forEach(t => {
        const card = document.createElement('a');
        card.href = t.leetcodeUrl || `https://leetcode.com/tag/${t.slug}/`;
        card.target = '_blank';
        card.rel = 'noopener noreferrer';
        card.className = 'topic-bar-card';
        card.style.cssText = `
          text-decoration: none;
          color: inherit;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding: 0.85rem 1rem;
          border-radius: 10px;
          background: rgba(30, 41, 59, 0.7);
          border: 1px solid rgba(255, 255, 255, 0.08);
          transition: all 0.2s ease;
          cursor: pointer;
        `;

        card.addEventListener('mouseenter', () => {
          card.style.borderColor = '#fbbf24';
          card.style.transform = 'translateY(-2px)';
        });
        card.addEventListener('mouseleave', () => {
          card.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          card.style.transform = 'translateY(0)';
        });

        const isUntouched = t.isUntouched || t.count === 0;
        const warningDot = isUntouched
          ? '<span title="0 Solves — High Priority Focus" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#f87171; box-shadow: 0 0 6px #f87171; margin-right: 0.4rem;"></span>'
          : '<span title="Low Solve Count" style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#fbbf24; margin-right: 0.4rem;"></span>';

        card.innerHTML = `
          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span style="font-weight: 600; font-size: 0.88rem; color: #f8fafc; display: flex; align-items: center;">
              ${warningDot} ${t.topic}
            </span>
            <span style="font-size: 0.72rem; color: #94a3b8;">↗</span>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.25rem;">
            <span class="topic-count-badge" style="font-size: 0.75rem; font-weight: 600; color: ${isUntouched ? '#f87171' : '#fbbf24'}; background: ${isUntouched ? 'rgba(248,113,113,0.12)' : 'rgba(251,191,36,0.12)'}; padding: 2px 8px; border-radius: 12px;">
              ${t.count === 0 ? '0 solved' : `${t.count} solved`}
            </span>
            <span style="font-size: 0.72rem; color: #38bdf8;">Practice on LC</span>
          </div>
        `;

        container.appendChild(card);
      });
    } catch (err) {
      console.error('Failed to load focus topics:', err);
    }
  }

  // Reload all metrics
  function refreshDashboard() {
    checkHealth();
    loadSummaryStats();
    loadHeatmap();
    loadTopicStats();
    loadProblems();
    loadAutomationStatus();
    loadFocusTopics();
  }

  // Initial Load
  refreshDashboard();
});
