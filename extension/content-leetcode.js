(function () {
  console.log('[DSA Tracker Extension] LeetCode content script loaded.');

  const BASE_URL = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://dsa-tracker-beryl-sigma.vercel.app';
  const SERVER_CAPTURE_URL = `${BASE_URL}/api/capture`;
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

  // --- Extract Problem Slug from URL ---
  function getTitleSlug() {
    const match = window.location.pathname.match(/\/problems\/([^\/]+)/);
    return match ? match[1] : null;
  }

  // --- Extract Submitted Code from Monaco Editor ---
  function getCodeFromDOM() {
    // Attempt 1: Get view-lines text content
    const viewLines = document.querySelectorAll('.view-lines .view-line');
    if (viewLines.length > 0) {
      return Array.from(viewLines).map(line => line.textContent).join('\n');
    }

    // Attempt 2: General editor code blocks
    const codeEl = document.querySelector('code, pre');
    if (codeEl) return codeEl.textContent;

    return '';
  }

  // --- Extract Selected Programming Language ---
  function getLanguageFromDOM() {
    const langBtn = document.querySelector('[data-cy="lang-select"], button[id*="headlessui-listbox-button"]');
    if (langBtn) {
      return langBtn.textContent.trim();
    }
    return 'javascript';
  }

  // --- Query LeetCode GraphQL API for Metadata ---
  async function fetchLeetCodeGraphQL(titleSlug) {
    try {
      const res = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `
            query questionData($titleSlug: String!) {
              question($titleSlug: $titleSlug) {
                questionId
                title
                difficulty
                content
                topicTags { name }
              }
            }
          `,
          variables: { titleSlug }
        })
      });

      if (!res.ok) return null;
      const data = await res.json();
      return data.data ? data.data.question : null;
    } catch (err) {
      console.warn('[DSA Tracker Extension] LeetCode GraphQL query failed:', err);
      return null;
    }
  }

  // --- Main Capture Logic ---
  async function captureLeetCodeSolution() {
    if (isCapturing) return;
    const slug = getTitleSlug();
    if (!slug) return;

    // Check chrome.storage.local to avoid sending duplicate submission
    const storageKey = `lc_sent_${slug}`;
    const stored = await chrome.storage.local.get(storageKey);
    const lastSentTime = stored[storageKey];

    // If sent within the last 3 minutes, skip auto-capture
    if (lastSentTime && (Date.now() - lastSentTime < 180000)) {
      return;
    }

    isCapturing = true;
    console.log('[DSA Tracker Extension] Capturing LeetCode submission for:', slug);

    try {
      const code = getCodeFromDOM();
      const language = getLanguageFromDOM();
      const qData = await fetchLeetCodeGraphQL(slug);

      const title = qData ? qData.title : slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const difficulty = qData ? qData.difficulty : 'Easy';
      const topics = qData && Array.isArray(qData.topicTags) ? qData.topicTags.map(t => t.name) : [];
      const statement = qData ? qData.content : '';

      const payload = {
        platform: 'leetcode',
        platform_problem_id: slug,
        title: title,
        url: `https://leetcode.com/problems/${slug}/`,
        difficulty: difficulty,
        topics: topics,
        question_statement: statement,
        my_solution_code: code,
        my_solution_language: language,
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
      console.error('[DSA Tracker Extension] Capture failed:', err);
      showOnPageToast(`Capture Failed: ${err.message}`, 'error');
    } finally {
      isCapturing = false;
    }
  }

  // --- Observe DOM for "Accepted" Status ---
  const observer = new MutationObserver(() => {
    // Check if DOM contains green "Accepted" result panel
    const acceptedEl = document.querySelector('[data-e2e-locator="submission-result"]');
    const textMatches = document.body.innerText.includes('Accepted');

    if ((acceptedEl && acceptedEl.textContent.includes('Accepted')) || textMatches) {
      // Check if green accepted badge is visible
      const isAccepted = Array.from(document.querySelectorAll('span, div')).some(
        el => el.textContent.trim() === 'Accepted' && (window.getComputedStyle(el).color.includes('46, 170, 77') || window.getComputedStyle(el).color.includes('40, 167, 69') || el.classList.contains('text-sd-easy'))
      );

      if (isAccepted) {
        captureLeetCodeSolution();
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // --- Listen for Manual Popup Trigger ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'manual_capture') {
      captureLeetCodeSolution().then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  });
})();
