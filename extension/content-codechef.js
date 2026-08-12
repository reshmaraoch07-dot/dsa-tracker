(function () {
  console.log('[DSA Tracker Extension] CodeChef content script loaded.');

  const SERVER_CAPTURE_URL = 'http://localhost:4545/api/capture';
  let isCapturing = false;

  // --- On-Page Toast Feedback ---
  function showOnPageToast(message, type = 'success') {
    let toast = document.getElementById('dsa-tracker-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'dsa-tracker-toast';
      toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 999999;
        padding: 12px 20px;
        border-radius: 10px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        transition: all 0.3s ease;
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }

    if (type === 'success') {
      toast.style.background = '#059669';
      toast.style.border = '1px solid #10b981';
    } else {
      toast.style.background = '#dc2626';
      toast.style.border = '1px solid #f87171';
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
    }, 4000);
  }

  // --- Extract Problem Code from URL ---
  function getProblemCode() {
    const match = window.location.pathname.match(/\/(problems|submit|status)\/([^\/]+)/);
    return match ? match[2].toUpperCase() : 'CODECHEF_PROBLEM';
  }

  // --- Extract Submitted Code from DOM ---
  function getCodeFromDOM() {
    const codeArea = document.querySelector('.ace_content, pre.CodeMirror-line, pre, code');
    if (codeArea) return codeArea.textContent;

    const textarea = document.querySelector('textarea');
    if (textarea) return textarea.value;

    return '';
  }

  // --- Main Capture Logic ---
  async function captureCodeChefSolution() {
    if (isCapturing) return;
    const problemCode = getProblemCode();
    if (!problemCode) return;

    const storageKey = `cc_sent_${problemCode}`;
    const stored = await chrome.storage.local.get(storageKey);
    const lastSentTime = stored[storageKey];

    if (lastSentTime && (Date.now() - lastSentTime < 180000)) {
      return;
    }

    isCapturing = true;
    console.log('[DSA Tracker Extension] Capturing CodeChef submission for:', problemCode);

    try {
      const code = getCodeFromDOM();
      const payload = {
        platform: 'codechef',
        platform_problem_id: problemCode,
        title: problemCode,
        url: `https://www.codechef.com/problems/${problemCode}`,
        difficulty: 'Medium',
        topics: [],
        question_statement: '',
        my_solution_code: code,
        my_solution_language: 'C++',
        solved_at: new Date().toISOString()
      };

      const res = await fetch(SERVER_CAPTURE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        await chrome.storage.local.set({ [storageKey]: Date.now() });
        showOnPageToast('✓ Captured! Sent to DSA Tracker', 'success');
      } else {
        throw new Error(`Server returned HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('[DSA Tracker Extension] CodeChef capture failed:', err);
      showOnPageToast(`Capture Failed: ${err.message}`, 'error');
    } finally {
      isCapturing = false;
    }
  }

  // --- Observe DOM for "Accepted" Status ---
  const observer = new MutationObserver(() => {
    const isAccepted = Array.from(document.querySelectorAll('span, div, td')).some(
      el => (el.textContent.includes('Accepted') || el.textContent.includes('100 pts') || el.textContent.includes('AC')) &&
            (window.getComputedStyle(el).color.includes('0, 128, 0') || window.getComputedStyle(el).color.includes('46, 170, 77') || el.classList.contains('status-ac'))
    );

    if (isAccepted) {
      captureCodeChefSolution();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // --- Listen for Manual Popup Trigger ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'manual_capture') {
      captureCodeChefSolution().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  });
})();
