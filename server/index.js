const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./db/init');

const { syncCodeforces } = require('./services/codeforces');
const { ensureRepoCloned, pushProblemToGithub, pushAllUnpushedProblems } = require('./services/github');
const { getSummaryStats, getHeatmapData, getTopicStats, getWeakTopics } = require('./services/stats');
const { generateOptimalSolution, suggestTopicsAndDifficulty } = require('./services/ai');
const { initScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 4545;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static UI assets from /public
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: "ok" });
});

// GET /api/stats/summary - Summary stats
app.get('/api/stats/summary', async (req, res) => {
  try {
    const stats = await getSummaryStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/heatmap - Heatmap solve counts per date
app.get('/api/stats/heatmap', async (req, res) => {
  try {
    const data = await getHeatmapData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/topics - Topic coverage breakdown
app.get('/api/stats/topics', async (req, res) => {
  try {
    const stats = await getTopicStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/weak-topics - Weakest/untouched topics
app.get('/api/stats/weak-topics', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 5;
    const topics = await getWeakTopics(limit);
    res.json(topics);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stats/automation-status - Latest automated sync and push logs
app.get('/api/stats/automation-status', async (req, res) => {
  try {
    const { data: lastCfSync } = await supabase
      .from('sync_log')
      .select('*')
      .or("action.eq.sync_codeforces,action.eq.fetch,platform.eq.codeforces")
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: lastGithubPush } = await supabase
      .from('sync_log')
      .select('*')
      .or("action.eq.push_github,action.eq.push,platform.eq.github")
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

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
app.get('/api/export', async (req, res) => {
  try {
    const { data: problems, error } = await supabase
      .from('problems')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw new Error(error.message);

    const dateStr = new Date().toISOString().split('T')[0];

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="dsa-tracker-backup-${dateStr}.json"`);
    res.send(JSON.stringify(problems, null, 2));
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/export/csv - CSV format backup download
app.get('/api/export/csv', async (req, res) => {
  try {
    const { data: problems, error } = await supabase
      .from('problems')
      .select('*')
      .order('id', { ascending: true });

    if (error) throw new Error(error.message);

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
      if (Array.isArray(p.topics)) {
        topicsStr = p.topics.join(', ');
      } else if (typeof p.topics === 'string') {
        try {
          const parsed = JSON.parse(p.topics);
          if (Array.isArray(parsed)) topicsStr = parsed.join(', ');
        } catch (_) {
          topicsStr = p.topics;
        }
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
app.post('/api/import', async (req, res) => {
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

    for (const item of rawItems) {
      if (!item.platform || !item.platform_problem_id || !item.title) {
        skipped++;
        continue;
      }

      let topicsArr = [];
      if (Array.isArray(item.topics)) topicsArr = item.topics;
      else if (typeof item.topics === 'string') {
        try { topicsArr = JSON.parse(item.topics); } catch (_) {}
      }

      // Add topics to topics_master
      for (const t of topicsArr) {
        if (t && typeof t === 'string' && t.trim()) {
          await supabase.from('topics_master').upsert({ name: t.trim() }, { onConflict: 'name' });
        }
      }

      const { data, error } = await supabase
        .from('problems')
        .upsert({
          platform: String(item.platform).toLowerCase().trim(),
          platform_problem_id: String(item.platform_problem_id).trim(),
          title: String(item.title).trim(),
          url: item.url || '',
          difficulty: item.difficulty || 'Medium',
          topics: topicsArr,
          question_statement: item.question_statement || '',
          my_solution_code: item.my_solution_code || '',
          my_solution_language: item.my_solution_language || 'C++',
          optimal_solution_code: item.optimal_solution_code || null,
          optimal_solution_explanation: item.optimal_solution_explanation || null,
          solved_at: item.solved_at || new Date().toISOString(),
          pushed_to_github: Boolean(item.pushed_to_github),
          github_file_path: item.github_file_path || null
        }, { onConflict: 'platform, platform_problem_id', ignoreDuplicates: true })
        .select();

      if (data && data.length > 0) {
        count++;
      } else {
        skipped++;
      }
    }

    res.json({
      success: true,
      count,
      skipped,
      message: `Import complete! ${count} problem(s) restored, ${skipped} duplicate(s) skipped.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/settings - Fetch saved settings
app.get('/api/settings', async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from('settings')
      .select('key, value');

    if (error) throw new Error(error.message);

    const settings = {};
    (rows || []).forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings - Save/update setting key-value pairs
app.post('/api/settings', async (req, res) => {
  try {
    if (req.body.key && req.body.value !== undefined) {
      await supabase.from('settings').upsert({ key: req.body.key, value: String(req.body.value) }, { onConflict: 'key' });
    } else {
      for (const [key, value] of Object.entries(req.body)) {
        await supabase.from('settings').upsert({ key, value: String(value) }, { onConflict: 'key' });
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

// POST /api/push/:problemId - Push single problem to GitHub
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
    const { data: problem, error } = await supabase
      .from('problems')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !problem) {
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
    const { data: problem, error } = await supabase
      .from('problems')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !problem) {
      return res.status(404).json({ success: false, error: 'Problem not found' });
    }

    const result = await suggestTopicsAndDifficulty(problem);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/problems/auto-tag-all - Bulk AI Auto-tag missing problems
app.post('/api/problems/auto-tag-all', async (req, res) => {
  try {
    const { data: missingProblems, error } = await supabase
      .from('problems')
      .select('*')
      .or("topics.is.null,topics.eq.[],difficulty.is.null")
      .order('id', { ascending: true });

    if (error || !missingProblems || missingProblems.length === 0) {
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

// POST /api/capture - Extension auto-capture endpoint
app.post('/api/capture', async (req, res) => {
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
      solved_at
    } = req.body;

    if (!platform_problem_id || !title) {
      return res.status(400).json({ success: false, error: 'Missing platform_problem_id or title' });
    }

    const topicsArr = Array.isArray(topics) ? topics : [];
    for (const t of topicsArr) {
      if (t && typeof t === 'string' && t.trim()) {
        await supabase.from('topics_master').upsert({ name: t.trim() }, { onConflict: 'name' });
      }
    }

    const dateStr = solved_at || new Date().toISOString();

    const { data, error } = await supabase
      .from('problems')
      .upsert({
        platform: String(platform).toLowerCase().trim(),
        platform_problem_id: String(platform_problem_id).trim(),
        title: String(title).trim(),
        url: url || '',
        difficulty: difficulty || 'Medium',
        topics: topicsArr,
        question_statement: question_statement || '',
        my_solution_code: my_solution_code || '',
        my_solution_language: my_solution_language || 'C++',
        solved_at: dateStr,
        pushed_to_github: false
      }, { onConflict: 'platform, platform_problem_id' })
      .select()
      .single();

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      message: `Captured '${title}' successfully!`,
      problem_id: data ? data.id : null
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/draft - Desktop helper clipboard capture
app.post('/api/draft', async (req, res) => {
  try {
    const { platform = 'hive', code = '' } = req.body;
    const draftPayload = JSON.stringify({
      platform,
      code,
      timestamp: new Date().toISOString()
    });

    await supabase
      .from('settings')
      .upsert({ key: 'latest_draft', value: draftPayload }, { onConflict: 'key' });

    res.json({ success: true, message: 'Draft saved successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/draft/latest - Fetch latest clipboard draft
app.get('/api/draft/latest', async (req, res) => {
  try {
    const { data: row } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'latest_draft')
      .single();

    if (!row || !row.value) {
      return res.json({ success: false, draft: null });
    }

    res.json({ success: true, draft: JSON.parse(row.value) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/problems - Filterable problems list
app.get('/api/problems', async (req, res) => {
  try {
    let query = supabase.from('problems').select('*').order('solved_at', { ascending: false });

    if (req.query.platform && req.query.platform !== 'all') {
      query = query.eq('platform', req.query.platform.toLowerCase());
    }

    if (req.query.difficulty && req.query.difficulty !== 'all') {
      query = query.ilike('difficulty', req.query.difficulty);
    }

    const { data: problems, error } = await query;
    if (error) throw new Error(error.message);

    let filtered = problems || [];

    // Filter by topic tag if requested
    if (req.query.topic && req.query.topic !== 'all') {
      const targetTopic = req.query.topic.toLowerCase();
      filtered = filtered.filter(p => {
        let topicsArr = [];
        if (Array.isArray(p.topics)) topicsArr = p.topics;
        else if (typeof p.topics === 'string') {
          try { topicsArr = JSON.parse(p.topics); } catch (_) {}
        }
        return topicsArr.some(t => t.toLowerCase() === targetTopic);
      });
    }

    // Filter by search query if requested
    if (req.query.search) {
      const q = req.query.search.toLowerCase();
      filtered = filtered.filter(p => (p.title || '').toLowerCase().includes(q));
    }

    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/problems/:id - Fetch single problem detail
app.get('/api/problems/:id', async (req, res) => {
  try {
    const { data: problem, error } = await supabase
      .from('problems')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !problem) {
      return res.status(404).json({ error: 'Problem not found' });
    }

    res.json(problem);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/problems - Manual problem entry
app.post('/api/problems', async (req, res) => {
  try {
    const {
      platform,
      platform_problem_id,
      title,
      url,
      difficulty,
      topics = [],
      question_statement,
      my_solution_code,
      my_solution_language,
      solved_at
    } = req.body;

    if (!platform || !title) {
      return res.status(400).json({ success: false, error: 'Platform and Title are required fields.' });
    }

    const probId = (platform_problem_id && String(platform_problem_id).trim())
      ? String(platform_problem_id).trim()
      : `manual-${Date.now()}`;

    const topicsArr = Array.isArray(topics) ? topics : [];
    for (const t of topicsArr) {
      if (t && typeof t === 'string' && t.trim()) {
        await supabase.from('topics_master').upsert({ name: t.trim() }, { onConflict: 'name' });
      }
    }

    const dateStr = solved_at ? new Date(solved_at).toISOString() : new Date().toISOString();

    const { data: problem, error } = await supabase
      .from('problems')
      .upsert({
        platform: String(platform).toLowerCase().trim(),
        platform_problem_id: probId,
        title: String(title).trim(),
        url: url || '',
        difficulty: difficulty || 'Medium',
        topics: topicsArr,
        question_statement: question_statement || '',
        my_solution_code: my_solution_code || '',
        my_solution_language: my_solution_language || 'C++',
        solved_at: dateStr,
        pushed_to_github: false
      }, { onConflict: 'platform, platform_problem_id' })
      .select()
      .single();

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      message: `Problem '${title}' saved successfully!`,
      problem_id: problem.id
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Global Express error handler middleware
app.use((err, req, res, next) => {
  console.error('[Express App Error]:', err);
  res.status(err.status || 500).json({
    error: true,
    message: err.message || 'Internal Server Error',
    stack: err.stack
  });
});

// Only start standalone HTTP server if running directly as main module
if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[Server] DSA Tracker running on http://localhost:${PORT}`);
    ensureRepoCloned();
    initScheduler();
  });
}

module.exports = app;
