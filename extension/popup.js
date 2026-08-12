document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('status-dot');
  const statusText = document.getElementById('status-text');
  const captureBtn = document.getElementById('capture-btn');
  const feedback = document.getElementById('feedback');

  const SERVER_HEALTH_URL = 'http://localhost:4545/api/health';

  // 1. Check Server Connection Status
  async function checkServerConnection() {
    try {
      const res = await fetch(SERVER_HEALTH_URL);
      if (res.ok) {
        statusDot.className = 'dot online';
        statusText.textContent = 'Server Connected (Port 4545)';
      } else {
        throw new Error('Non-200 response');
      }
    } catch (_) {
      statusDot.className = 'dot offline';
      statusText.textContent = 'Server Offline (Check Express)';
    }
  }

  checkServerConnection();

  // 2. Manual "Capture Current Page" Fallback Handler
  captureBtn.addEventListener('click', async () => {
    captureBtn.disabled = true;
    feedback.textContent = 'Triggering capture...';
    feedback.style.color = '#38bdf8';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active tab found');

      chrome.tabs.sendMessage(tab.id, { action: 'manual_capture' }, (response) => {
        if (chrome.runtime.lastError) {
          feedback.textContent = 'Please refresh the LeetCode / CodeChef page first!';
          feedback.style.color = '#f87171';
        } else if (response && response.success) {
          feedback.textContent = '✓ Capture trigger sent!';
          feedback.style.color = '#34d399';
        } else {
          feedback.textContent = 'Capture completed.';
          feedback.style.color = '#34d399';
        }
        captureBtn.disabled = false;
      });
    } catch (err) {
      feedback.textContent = err.message;
      feedback.style.color = '#f87171';
      captureBtn.disabled = false;
    }
  });
});
