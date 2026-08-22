(function () {
  console.log('[DSA Tracker Extension] LeetCode content script loaded.');

  const BASE_URL = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : 'https://dsa-tracker-beryl-sigma.vercel.app';
  const SERVER_CAPTURE_URL = `${BASE_URL}/api/capture`;
  let isCapturing = false;
  let lastCapturedSlug = null;
  let lastCapturedTime = 0;

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
        padding: 14px 22px;
        border-radius: 10px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        font-weight: 600;
        color: #ffffff;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
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
    }, 5000);
  }

  // --- Extract Problem Slug from URL ---
  function getTitleSlug() {
    const match = window.location.pathname.match(/\/problems\/([^\/]+)/);
    return match ? match[1] : null;
  }

  // --- Extract Submitted Code from DOM ---
  function getCodeFromDOM() {
    // Attempt 1: Monaco Editor view lines
    const viewLines = document.querySelectorAll('.view-lines .view-line');
    if (viewLines.length > 0) {
      const code = Array.from(viewLines).map(line => line.textContent).join('\n');
      if (code.trim()) return code;
    }

    // Attempt 2: CodeMirror lines
    const cmLines = document.querySelectorAll('.CodeMirror-line');
    if (cmLines.length > 0) {
      const code = Array.from(cmLines).map(line => line.textContent).join('\n');
      if (code.trim()) return code;
    }

    // Attempt 3: General code blocks
    const codeEl = document.querySelector('code, pre');
    if (codeEl && codeEl.textContent.trim()) return codeEl.textContent;

    return '';
  }

  // --- Extract Selected Programming Language ---
  function getLanguageFromDOM() {
    const selectors = [
      '[data-cy="lang-select"]',
      'button[id*="headlessui-listbox-button"]',
      'button[class*="lang"]',
      'div[class*="language-select"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim()) {
        return el.textContent.trim().toLowerCase();
      }
    }
    return 'cpp';
  }

  // --- Query LeetCode GraphQL API for Problem Metadata ---
  async function fetchLeetCodeGraphQL(titleSlug) {
    try {
      const res = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
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

      if (!res.ok) {
        console.warn(`[DSA Tracker Extension] GraphQL HTTP status ${res.status}`);
        return null;
      }
      const data = await res.json();
      return data.data ? data.data.question : null;
    } catch (err) {
      console.warn('[DSA Tracker Extension] LeetCode GraphQL fetch failed:', err.message);
      return null;
    }
  }

  // --- Main Capture Logic ---
  async function captureLeetCodeSolution(manual = false) {
    const slug = getTitleSlug();
    if (!slug) {
      console.error('[DSA Tracker Extension] Cannot capture: No problem slug found in URL.');
      if (manual) showOnPageToast('Capture Failed: Not on a problem page', 'error');
      return;
    }

    // Cooldown check (prevent duplicate triggers within 60s for same slug)
    const now = Date.now();
    if (!manual && lastCapturedSlug === slug && (now - lastCapturedTime < 60000)) {
      console.log(`[DSA Tracker Extension] Cooldown active for '${slug}'. Skipping duplicate capture.`);
      return;
    }

    if (isCapturing) {
      console.log('[DSA Tracker Extension] Capture already in progress...');
      return;
    }

    isCapturing = true;
    console.log(`[DSA Tracker Extension] Starting capture for '${slug}' to ${SERVER_CAPTURE_URL}...`);

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

      console.log('[DSA Tracker Extension] Sending capture payload:', payload);

      const res = await fetch(SERVER_CAPTURE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        lastCapturedSlug = slug;
        lastCapturedTime = now;
        console.log(`[DSA Tracker Extension] Successfully captured '${title}'!`);
        showOnPageToast(`✓ Captured! Saved '${title}' to DSA Tracker`, 'success');
      } else {
        const errorText = await res.text();
        throw new Error(`Server HTTP ${res.status}: ${errorText || res.statusText}`);
      }
    } catch (err) {
      console.error('[DSA Tracker Extension] Capture failed:', err);
      showOnPageToast(`Capture Failed: ${err.message} — see console`, 'error');
    } finally {
      isCapturing = false;
    }
  }

  // --- Helper: Check if element indicates Accepted ---
  function isAcceptedElement(el) {
    if (!el || !el.textContent) return false;
    const text = el.textContent.trim();
    if (text !== 'Accepted' && text !== 'ACCEPTED') return false;

    // Check class list
    const className = el.className || '';
    if (typeof className === 'string' && (
      className.includes('text-sd-easy') ||
      className.includes('text-sd-green') ||
      className.includes('text-green-s') ||
      className.includes('text-green-60') ||
      className.includes('text-emerald') ||
      className.includes('text-green')
    )) {
      return true;
    }

    // Check computed color
    try {
      const style = window.getComputedStyle(el);
      const color = style.color || '';
      if (
        color.includes('46, 170, 77') ||
        color.includes('40, 167, 69') ||
        color.includes('44, 187, 93') ||
        color.includes('0, 184, 163') ||
        color.includes('34, 197, 94') ||
        color.includes('16, 185, 129')
      ) {
        return true;
      }
    } catch (_) {}

    return true; // Fallback: text is exactly 'Accepted' inside submission result panel
  }

  // --- Observe DOM for "Accepted" Submission Result ---
  let debounceTimer = null;

  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);

    debounceTimer = setTimeout(() => {
      // Locator 1: Standard submission result container
      const resultState = document.querySelector('[data-e2e-locator="submission-result"], [data-e2e-locator="result-state"]');
      if (resultState && resultState.textContent.includes('Accepted')) {
        console.log('[DSA Tracker Extension] Accepted result state detected via locator.');
        captureLeetCodeSolution();
        return;
      }

      // Locator 2: Search for any green "Accepted" span or div
      const candidates = document.querySelectorAll('span, div, h4, p');
      for (const el of candidates) {
        if (isAcceptedElement(el)) {
          console.log('[DSA Tracker Extension] Accepted badge detected via DOM scan.');
          captureLeetCodeSolution();
          return;
        }
      }
    }, 500); // 500ms debounce
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // --- Listen for Manual Popup Trigger ---
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'manual_capture') {
      captureLeetCodeSolution(true).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
  });

  console.log('[DSA Tracker Extension] MutationObserver active for LeetCode submission results.');
})();
