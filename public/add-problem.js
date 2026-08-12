document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('add-problem-form');
  const platformSelect = document.getElementById('platform');
  const titleInput = document.getElementById('title');
  const urlInput = document.getElementById('url');
  const diffSelect = document.getElementById('difficulty');
  const questionStmtInput = document.getElementById('question-statement');
  const solutionCodeInput = document.getElementById('solution-code');
  const langSelect = document.getElementById('language');
  const solvedAtInput = document.getElementById('solved-at');

  const topicsContainer = document.getElementById('topics-picker-container');
  const customTopicInput = document.getElementById('custom-topic-input');
  const addTopicBtn = document.getElementById('add-topic-btn');

  const saveBtn = document.getElementById('save-btn');
  const saveSpinner = document.getElementById('save-spinner');
  const saveBtnText = document.getElementById('save-btn-text');
  const toastContainer = document.getElementById('toast-container');

  const selectedTopics = new Set();

  // Toast Helper
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

  // Set default date to today YYYY-MM-DD
  const today = new Date().toISOString().split('T')[0];
  solvedAtInput.value = today;

  // Check if ?draft=latest parameter is present in URL
  async function loadDraftIfRequested() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('draft') === 'latest') {
      try {
        const res = await fetch('/api/draft/latest');
        if (!res.ok) return;
        const data = await res.json();

        if (data.success && data.draft && data.draft.code) {
          platformSelect.value = data.draft.platform || 'hive';
          solutionCodeInput.value = data.draft.code;
          showToast('Pre-filled code from latest Hive draft!', 'info', 5000);
        }
      } catch (err) {
        console.warn('Failed to load draft:', err);
      }
    }
  }

  // Load existing topics from backend
  async function loadTopics() {
    try {
      const res = await fetch('/api/stats/topics');
      if (!res.ok) return;
      const topicsData = await res.json();

      topicsContainer.innerHTML = '';
      topicsData.forEach(t => renderTopicPill(t.topic));
    } catch (err) {
      console.error('Failed to load topics:', err);
    }
  }

  function renderTopicPill(topicName) {
    if (!topicName || !topicName.trim()) return;
    const name = topicName.trim();

    // Check if already rendered
    if (document.querySelector(`[data-topic="${name}"]`)) return;

    const pill = document.createElement('span');
    pill.className = 'topic-pill selectable';
    pill.dataset.topic = name;
    pill.textContent = name;
    pill.style.cursor = 'pointer';
    pill.style.userSelect = 'none';

    pill.addEventListener('click', () => {
      if (selectedTopics.has(name)) {
        selectedTopics.delete(name);
        pill.classList.remove('active');
        pill.style.background = 'rgba(255,255,255,0.06)';
        pill.style.borderColor = 'rgba(255,255,255,0.1)';
        pill.style.color = '#94a3b8';
      } else {
        selectedTopics.add(name);
        pill.classList.add('active');
        pill.style.background = 'rgba(56, 189, 248, 0.2)';
        pill.style.borderColor = '#38bdf8';
        pill.style.color = '#38bdf8';
      }
    });

    topicsContainer.appendChild(pill);
  }

  // Handle custom topic addition
  addTopicBtn.addEventListener('click', () => {
    const val = customTopicInput.value.trim();
    if (!val) return;

    renderTopicPill(val);
    selectedTopics.add(val);

    // Highlight newly added topic
    const pill = document.querySelector(`[data-topic="${val}"]`);
    if (pill) {
      pill.classList.add('active');
      pill.style.background = 'rgba(56, 189, 248, 0.2)';
      pill.style.borderColor = '#38bdf8';
      pill.style.color = '#38bdf8';
    }

    customTopicInput.value = '';
  });

  customTopicInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTopicBtn.click();
    }
  });

  // Handle Form Submission
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!titleInput.value.trim()) {
      showToast('Problem title is required.', 'error');
      return;
    }

    if (!solutionCodeInput.value.trim()) {
      showToast('Solution code is required.', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveSpinner.classList.remove('hidden');
    saveBtnText.textContent = 'Saving...';

    try {
      const payload = {
        platform: platformSelect.value,
        title: titleInput.value.trim(),
        url: urlInput.value.trim(),
        difficulty: diffSelect.value,
        topics: Array.from(selectedTopics),
        question_statement: questionStmtInput.value.trim(),
        my_solution_code: solutionCodeInput.value.trim(),
        my_solution_language: langSelect.value,
        solved_at: solvedAtInput.value ? new Date(solvedAtInput.value).toISOString() : new Date().toISOString()
      };

      const res = await fetch('/api/problems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (data.success) {
        showToast('Problem saved successfully!', 'success');
        setTimeout(() => {
          window.location.href = `problem.html?id=${data.problemId}`;
        }, 1000);
      } else {
        showToast(`Save Error: ${data.error}`, 'error');
      }
    } catch (err) {
      showToast(`Request Failed: ${err.message}`, 'error');
    } finally {
      saveBtn.disabled = false;
      saveSpinner.classList.add('hidden');
      saveBtnText.textContent = 'Save Problem to Tracker';
    }
  });

  loadTopics();
  loadDraftIfRequested();
});
