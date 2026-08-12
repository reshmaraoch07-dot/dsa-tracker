document.addEventListener('DOMContentLoaded', () => {
  const statusIndicator = document.getElementById('status-indicator');
  const statusText = document.getElementById('status-text');
  const apiStatusBadge = document.getElementById('api-status-badge');
  const problemsCountBadge = document.getElementById('problems-count-badge');
  
  const syncCfBtn = document.getElementById('sync-cf-btn');
  const pushGithubBtn = document.getElementById('push-github-btn');
  const syncResultBox = document.getElementById('sync-result');

  // 1. Health check & Initial stats fetch
  async function checkHealthAndStats() {
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      
      const data = await res.json();
      if (data.status === 'ok') {
        statusIndicator.className = 'status-indicator online';
        statusText.textContent = 'Server Online';
        apiStatusBadge.textContent = 'Connected';
        apiStatusBadge.style.color = '#34d399';
      }
    } catch (err) {
      statusIndicator.className = 'status-indicator offline';
      statusText.textContent = 'Server Offline';
      apiStatusBadge.textContent = 'Disconnected';
      apiStatusBadge.style.color = '#f87171';
      console.error('Health check failed:', err);
    }

    try {
      const problemsRes = await fetch('/api/problems');
      if (problemsRes.ok) {
        const problems = await problemsRes.json();
        problemsCountBadge.textContent = problems.length;
      }
    } catch (err) {
      console.error('Failed to load problems count:', err);
    }
  }

  checkHealthAndStats();

  // 2. Codeforces Sync Button Handler
  if (syncCfBtn) {
    syncCfBtn.addEventListener('click', async () => {
      syncCfBtn.disabled = true;
      syncCfBtn.querySelector('span').textContent = 'Syncing...';
      
      syncResultBox.className = 'sync-result-box info';
      syncResultBox.textContent = 'Fetching recent accepted submissions from Codeforces. Please wait...';
      syncResultBox.classList.remove('hidden');

      try {
        const res = await fetch('/api/sync/codeforces', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          syncResultBox.className = 'sync-result-box success';
          syncResultBox.textContent = `Sync Complete! ${data.count} new problem(s) added to database.`;
          checkHealthAndStats();
        } else {
          syncResultBox.className = 'sync-result-box error';
          syncResultBox.textContent = `Sync Error: ${data.message}`;
        }
      } catch (err) {
        syncResultBox.className = 'sync-result-box error';
        syncResultBox.textContent = `Request Failed: ${err.message}`;
      } finally {
        syncCfBtn.disabled = false;
        syncCfBtn.querySelector('span').textContent = 'Sync Codeforces';
      }
    });
  }

  // 3. Push All to GitHub Button Handler
  if (pushGithubBtn) {
    pushGithubBtn.addEventListener('click', async () => {
      pushGithubBtn.disabled = true;
      pushGithubBtn.querySelector('span').textContent = 'Pushing...';

      syncResultBox.className = 'sync-result-box info';
      syncResultBox.textContent = 'Pushing unpushed problems to GitHub. Please wait...';
      syncResultBox.classList.remove('hidden');

      try {
        const res = await fetch('/api/push/all', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
          syncResultBox.className = 'sync-result-box success';
          syncResultBox.textContent = `GitHub Push Complete! ${data.count} problem(s) committed & pushed to repository.`;
          checkHealthAndStats();
        } else {
          syncResultBox.className = 'sync-result-box error';
          syncResultBox.textContent = `Push Error: ${data.message}`;
        }
      } catch (err) {
        syncResultBox.className = 'sync-result-box error';
        syncResultBox.textContent = `Push Request Failed: ${err.message}`;
      } finally {
        pushGithubBtn.disabled = false;
        pushGithubBtn.querySelector('span').textContent = 'Push All to GitHub';
      }
    });
  }
});
