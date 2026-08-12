const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4545;

// CORS configuration to allow chrome-extension:// origins, localhost, and standard HTTP methods/headers
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database initialization (stored at /server/data/tracker.db via server/db/init.js)
const db = require('./db/init');

const { syncCodeforces } = require('./services/codeforces');
const { ensureRepoCloned, pushProblemToGithub, pushAllUnpushedProblems } = require('./services/github');
const { getSummaryStats, getHeatmapData, getTopicStats, getWeakTopics } = require('./services/stats');
const { generateOptimalSolution, suggestTopicsAndDifficulty } = require('./services/ai');
const { initScheduler } = require('./services/scheduler');

// 1. Serve /public as static files
app.use(express.static(path.join(__dirname, '../public')));

// 2. Health check route returning { status: "ok" }
app.get('/api/health', (req, res) => {
  res.json({ status: "ok" });
});

// GET /api/stats/summary - Header metrics (Total Solved, Current Streak, Longest Streak)
app.get('/api/stats/summary', (req, res) => {
  try {
    res.json(getSummaryStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/heatmap - Heatmap solve counts per date
app.get('/api/stats/heatmap', (req, res) => {
  try {
    res.json(getHeatmapData());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/topics - Topic coverage counts
app.get('/api/stats/topics', (req, res) => {
  try {
    res.json(getTopicStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/weak-topics - Weakest / untouched topics for practice recommendations
app.get('/api/stats/weak-topics', (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 5;
    res.json(getWeakTopics(limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/automation-status - Latest automated sync and push logs
app.get('/api/stats/automation-status', (req, res) => {
  try {
    const lastCfSync = db.prepare(`
      SELECT * FROM sync_log
      WHERE action IN ('sync_codeforces', 'fetch') OR platform = 'codeforces'
      ORDER BY id DESC LIMIT 1
    `).get();

    const lastGithubPush = db.prepare(`
      SELECT * FROM sync_log
      WHERE action IN ('push_github', 'push') OR platform = 'github'
      ORDER BY id DESC LIMIT 1
    `).get();

    res.json({
      success: true,
      lastCfSync: lastCfSync || null,
      lastGithubPush: lastGithubPush || null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/export - Full JSON database backup download
app.get('/api/export', (req, res) => {
  try {
    const problems = db.prepare('SELECT * FROM problems ORDER BY id ASC').all();
    const dateStr = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="dsa-tracker-backup-${dateStr}.json"`);
    res.send(JSON.stringify(problems, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/export/csv - CSV format backup download
app.get('/api/export/csv', (req, res) => {
  try {
    const problems = db.prepare('SELECT * FROM problems ORDER BY id ASC').all();
    const dateStr = new Date().toISOString().split('T')[0];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = [
      'id', 'platform', 'platform_problem_id', 'title', 'url', 'difficulty',
      'topics', 'question_statement', 'my_solution_code', 'my_solution_language',
      'optimal_solution_code', 'optimal_solution_explanation', 'solved_at',
      'pushed_to_github', 'github_file_path', 'created_at'
    ];

    let csv = headers.join(',') + '\n';

    for (const p of problems) {
      let topicsStr = '';
      try {
        const parsed = JSON.parse(p.topics || '[]');
        if (Array.isArray(parsed)) topicsStr = parsed.join(', ');
      } catch (_) {
        topicsStr = p.topics || '';
      }

      const row = [
        escapeCsv(p.id),
        escapeCsv(p.platform),
        escapeCsv(p.platform_problem_id),
        escapeCsv(p.title),
        escapeCsv(p.url),
        escapeCsv(p.difficulty),
        escapeCsv(topicsStr),
        escapeCsv(p.question_statement),
        escapeCsv(p.my_solution_code),
        escapeCsv(p.my_solution_language),
        escapeCsv(p.optimal_solution_code),
        escapeCsv(p.optimal_solution_explanation),
        escapeCsv(p.solved_at),
        escapeCsv(p.pushed_to_github),
        escapeCsv(p.github_file_path),
        escapeCsv(p.created_at)
      ];

      csv += row.join(',') + '\n';
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="dsa-tracker-backup-${dateStr}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/import - Restore problems from JSON backup
app.post('/api/import', (req, res) => {
  try {
    let rawItems = req.body;
    if (rawItems && !Array.isArray(rawItems) && Array.isArray(rawItems.problems)) {
      rawItems = rawItems.problems;
    }

    if (!Array.isArray(rawItems)) {
      return res.status(400).json({ success: false, error: 'Invalid backup file format. Expected a JSON array of problem records.' });
    }

    let count = 0;
    let skipped = 0;

    const stmt = db.prepare(`
      INSERT OR IGNORE INTO problems (
        platform, platform_problem_id, title, url, difficulty, topics,
        question_statement, my_solution_code, my_solution_language,
        optimal_solution_code, optimal_solution_explanation, solved_at,
        pushed_to_github, github_file_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertTopic = db.prepare('INSERT OR IGNORE INTO topics_master (name) VALUES (?)');

    for (const item of rawItems) {
      if (!item.platform || !item.platform_problem_id || !item.title) {
        skipped++;
        continue;
      }

      // Save custom topics into topics_master
      let topicsArr = [];
      try {
        if (Array.isArray(item.topics)) topicsArr = item.topics;
        else if (typeof item.topics === 'string') topicsArr = JSON.parse(item.topics);
      } catch (_) {}

      topicsArr.forEach(t => {
        if (t && typeof t === 'string' && t.trim()) {
          insertTopic.run(t.trim());
        }
      });

      const topicsJson = Array.isArray(item.topics) ? JSON.stringify(item.topics) : (typeof item.topics === 'string' ? item.topics : '[]');

      const info = stmt.run(
        String(item.platform).toLowerCase().trim(),
        String(item.platform_problem_id).trim(),
        String(item.title).trim(),
        item.url || '',
        item.difficulty || 'Medium',
        topicsJson,
        item.question_statement || '',
        item.my_solution_code || '',
        item.my_solution_language || 'C++',
        item.optimal_solution_code || null,
        item.optimal_solution_explanation || null,
        item.solved_at || new Date().toISOString(),
        item.pushed_to_github ? 1 : 0,
        item.github_file_path || null
      );

      if (info.changes > 0) {
        count++;
      } else {
        skipped++;
      }
    }

    console.log(`[Database Import] Restored ${count} problem(s), skipped ${skipped} duplicate(s).`);

    res.json({
      success: true,
      count,
      skipped,
      message: `Import complete! ${count} problem(s) restored, ${skipped} duplicate(s) skipped.`
    });
  } catch (err) {
    console.error('[Database Import] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/settings - Fetch saved settings
app.get('/api/settings', (req, res) => {
  try {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings - Save/update setting key-value pairs
app.post('/api/settings', (req, res) => {
  try {
    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);

    if (req.body.key && req.body.value !== undefined) {
      upsert.run(req.body.key, req.body.value);
    } else {
      for (const [key, value] of Object.entries(req.body)) {
        upsert.run(key, String(value));
      }
    }
    res.json({ success: true, message: 'Settings updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/sync/codeforces - Trigger Codeforces sync
app.post('/api/sync/codeforces', async (req, res) => {
  try {
    const result = await syncCodeforces();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, count: 0, message: err.message });
  }
});

// POST /api/push/all - Push all unpushed problems to GitHub
app.post('/api/push/all', async (req, res) => {
  try {
    const result = await pushAllUnpushedProblems();
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, count: 0, message: err.message });
  }
});

// POST /api/push/:problemId - Push a single problem to GitHub
app.post('/api/push/:problemId', async (req, res) => {
  try {
    const result = await pushProblemToGithub(req.params.problemId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/problems/:id/generate-optimal - Generate AI optimal solution
app.post('/api/problems/:id/generate-optimal', async (req, res) => {
  try {
    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(req.params.id);
    if (!problem) {
      return res.status(404).json({ success: false, error: 'Problem not found' });
    }

    const result = await generateOptimalSolution(problem);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/problems/:id/auto-tag - AI Auto-tag a single problem
app.post('/api/problems/:id/auto-tag', async (req, res) => {
  try {
    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(req.params.id);
    if (!problem) {
      return res.status(404).json({ success: false, error: 'Problem not found' });
    }

    const result = await suggestTopicsAndDifficulty(problem);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/problems/auto-tag-all - Bulk AI Auto-tag all problems missing topics/difficulty
app.post('/api/problems/auto-tag-all', async (req, res) => {
  try {
    const missingProblems = db.prepare(`
      SELECT * FROM problems
      WHERE topics IS NULL OR topics = '[]' OR topics = '' OR difficulty IS NULL OR difficulty = ''
      ORDER BY id ASC
    `).all();

    if (missingProblems.length === 0) {
      return res.json({ success: true, count: 0, total: 0, message: 'No problems missing topic or difficulty data.' });
    }

    let taggedCount = 0;
    const errors = [];

    for (const prob of missingProblems) {
      try {
        await suggestTopicsAndDifficulty(prob);
        taggedCount++;
      } catch (probErr) {
        errors.push({ id: prob.id, title: prob.title, error: probErr.message });
      }
      // 800ms delay between calls to observe Gemini API rate limits
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    res.json({
      success: true,
      count: taggedCount,
      total: missingProblems.length,
      message: `Successfully auto-tagged ${taggedCount} of ${missingProblems.length} problem(s).`,
      errors
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/capture - Capture solution payload from Chrome extension
app.post('/api/capture', (req, res) => {
  try {
    const {
      platform = 'leetcode',
      platform_problem_id,
      title,
      url,
      difficulty = 'Medium',
      topics = [],
      question_statement = '',
      my_solution_code = '',
      my_solution_language = 'C++',
      solved_at = new Date().toISOString()
    } = req.body;

    if (!platform_problem_id) {
      return res.status(400).json({ success: false, error: 'platform_problem_id is required' });
    }

    const cleanPlatform = String(platform).toLowerCase();
    const cleanId = String(platform_problem_id).trim();
    const cleanTitle = title ? String(title).trim() : cleanId;
    const cleanUrl = url ? String(url).trim() : `https://${cleanPlatform}.com/problems/${cleanId}`;

    const topicsJson = Array.isArray(topics) ? JSON.stringify(topics) : (typeof topics === 'string' ? topics : '[]');

    // Insert any new topics into topics_master
    if (Array.isArray(topics)) {
      const insertTopic = db.prepare('INSERT OR IGNORE INTO topics_master (name) VALUES (?)');
      topics.forEach(t => { if (t && typeof t === 'string') insertTopic.run(t.trim()); });
    }

    // Insert or Replace into SQLite problems table
    const stmt = db.prepare(`
      INSERT INTO problems (
        platform, platform_problem_id, title, url, difficulty, topics,
        question_statement, my_solution_code, my_solution_language, solved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, platform_problem_id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        difficulty = excluded.difficulty,
        topics = excluded.topics,
        question_statement = CASE WHEN length(excluded.question_statement) > 0 THEN excluded.question_statement ELSE question_statement END,
        my_solution_code = CASE WHEN length(excluded.my_solution_code) > 0 THEN excluded.my_solution_code ELSE my_solution_code END,
        my_solution_language = excluded.my_solution_language,
        solved_at = excluded.solved_at
    `);

    const info = stmt.run(
      cleanPlatform,
      cleanId,
      cleanTitle,
      cleanUrl,
      difficulty,
      topicsJson,
      question_statement,
      my_solution_code,
      my_solution_language,
      solved_at
    );

    // Retrieve problem record ID
    const problem = db.prepare('SELECT id FROM problems WHERE platform = ? AND platform_problem_id = ?').get(cleanPlatform, cleanId);

    console.log(`[Extension Capture] Saved '${cleanTitle}' (${cleanPlatform}:${cleanId}) -> Problem ID ${problem.id}`);

    res.json({
      success: true,
      problemId: problem.id,
      message: `Successfully captured problem '${cleanTitle}'`
    });
  } catch (err) {
    console.error('[Extension Capture] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/problems - Manual problem entry
app.post('/api/problems', (req, res) => {
  try {
    const {
      platform = 'other',
      platform_problem_id,
      title,
      url,
      difficulty = 'Medium',
      topics = [],
      question_statement = '',
      my_solution_code = '',
      my_solution_language = 'C++',
      solved_at = new Date().toISOString()
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Problem title is required.' });
    }

    const cleanPlatform = String(platform).toLowerCase().trim();
    const cleanTitle = String(title).trim();
    
    // Auto-generate platform_problem_id if not provided
    const cleanId = (platform_problem_id && String(platform_problem_id).trim())
      ? String(platform_problem_id).trim()
      : cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const cleanUrl = (url && String(url).trim()) ? String(url).trim() : `https://${cleanPlatform}.com/problems/${cleanId}`;

    // Normalize topics array & save custom topics into topics_master
    let topicsArray = [];
    if (Array.isArray(topics)) topicsArray = topics;
    else if (typeof topics === 'string') {
      try { topicsArray = JSON.parse(topics); } catch (_) { topicsArray = [topics]; }
    }

    const insertTopic = db.prepare('INSERT OR IGNORE INTO topics_master (name) VALUES (?)');
    topicsArray.forEach(t => {
      if (t && typeof t === 'string' && t.trim()) {
        insertTopic.run(t.trim());
      }
    });

    const topicsJson = JSON.stringify(topicsArray);

    const stmt = db.prepare(`
      INSERT INTO problems (
        platform, platform_problem_id, title, url, difficulty, topics,
        question_statement, my_solution_code, my_solution_language, solved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform, platform_problem_id) DO UPDATE SET
        title = excluded.title,
        url = excluded.url,
        difficulty = excluded.difficulty,
        topics = excluded.topics,
        question_statement = excluded.question_statement,
        my_solution_code = excluded.my_solution_code,
        my_solution_language = excluded.my_solution_language,
        solved_at = excluded.solved_at
    `);

    stmt.run(
      cleanPlatform,
      cleanId,
      cleanTitle,
      cleanUrl,
      difficulty,
      topicsJson,
      question_statement,
      my_solution_code,
      my_solution_language,
      solved_at
    );

    const problem = db.prepare('SELECT id FROM problems WHERE platform = ? AND platform_problem_id = ?').get(cleanPlatform, cleanId);

    console.log(`[Manual Entry] Saved problem '${cleanTitle}' (${cleanPlatform}:${cleanId}) -> Problem ID ${problem.id}`);

    res.json({
      success: true,
      problemId: problem.id,
      message: `Problem '${cleanTitle}' saved successfully!`
    });
  } catch (err) {
    console.error('[Manual Entry] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// In-memory Draft Store for Desktop Helper App / Clipboard Captures
let latestDraft = null;

// POST /api/draft - Save clipboard draft solution
app.post('/api/draft', (req, res) => {
  try {
    const { platform = 'hive', code = '', capturedAt = new Date().toISOString() } = req.body;

    latestDraft = {
      platform: String(platform).toLowerCase().trim(),
      code: String(code),
      capturedAt: String(capturedAt)
    };

    console.log(`[Draft Store] Saved draft for platform '${latestDraft.platform}' (${latestDraft.code.length} bytes)`);

    res.json({
      success: true,
      message: 'Draft saved successfully',
      draft: latestDraft
    });
  } catch (err) {
    console.error('[Draft Store] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/draft/latest - Fetch latest saved draft
app.get('/api/draft/latest', (req, res) => {
  try {
    res.json({
      success: true,
      draft: latestDraft
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/problems - Fetch stored problems with optional platform & topic filters
app.get('/api/problems', (req, res) => {
  try {
    const { platform, topic } = req.query;
    let query = 'SELECT * FROM problems WHERE 1=1';
    const params = [];

    if (platform && platform !== 'all') {
      query += ' AND LOWER(platform) = LOWER(?)';
      params.push(platform);
    }

    if (topic && topic !== 'all') {
      query += ' AND LOWER(topics) LIKE LOWER(?)';
      params.push(`%"${topic}"%`);
    }

    query += ' ORDER BY solved_at DESC, id DESC';
    const problems = db.prepare(query).all(...params);
    res.json(problems);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/problems/:id - Fetch problem detail by ID
app.get('/api/problems/:id', (req, res) => {
  try {
    const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(req.params.id);
    if (!problem) {
      return res.status(404).json({ error: 'Problem not found' });
    }
    res.json(problem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Start server on port 4545
const server = app.listen(PORT, async () => {
  console.log(`[Server] DSA Tracker running on http://localhost:${PORT}`);
  try {
    await ensureRepoCloned();
  } catch (err) {
    console.error('[Server] Initial GitHub repo clone check failed:', err.message);
  }
  // Initialize node-cron automated background syncs
  initScheduler();
});

module.exports = { app, db, server };
