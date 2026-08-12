const cheerio = require('cheerio');
const db = require('../db/init');

/**
 * Maps Codeforces problem rating to difficulty tier:
 * - rating < 1200: Easy
 * - 1200 <= rating <= 1900: Medium
 * - rating > 1900: Hard
 */
function getDifficulty(rating) {
  if (typeof rating !== 'number') return 'Easy';
  if (rating < 1200) return 'Easy';
  if (rating <= 1900) return 'Medium';
  return 'Hard';
}

/**
 * Fetches and parses Codeforces submission HTML page to extract source code.
 */
async function fetchSubmissionCode(contestId, submissionId) {
  const url = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok) {
      console.warn(`[Codeforces Service] HTML fetch returned ${response.status} for submission ${submissionId}`);
      return null;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    let code = $('#program-source-text').text();

    if (!code) {
      const match = html.match(/id=["']program-source-text["'][^>]*>([\s\S]*?)<\/pre>/i);
      if (match && match[1]) {
        code = match[1];
      }
    }

    return code ? code.trim() : null;
  } catch (err) {
    console.error(`[Codeforces Service] Could not fetch code for submission ${submissionId}:`, err.message);
    return null;
  }
}

/**
 * Main Codeforces sync function.
 */
async function syncCodeforces() {
  let handle = null;
  try {
    // 1. Get saved handle from settings table
    const handleRow = db.prepare("SELECT value FROM settings WHERE key = 'codeforces_handle'").get();
    handle = handleRow ? handleRow.value.trim() : null;

    if (!handle) {
      const errMsg = 'Codeforces handle not set in Settings page.';
      db.prepare(`
        INSERT INTO sync_log (platform, action, status, message)
        VALUES ('codeforces', 'fetch', 'error', ?)
      `).run(errMsg);
      return { success: false, count: 0, message: errMsg };
    }

    console.log(`[Codeforces Service] Fetching user status for handle: ${handle}`);

    // 2. Call Codeforces user.status API
    const apiUrl = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=50`;
    const apiRes = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    if (!apiRes.ok) {
      throw new Error(`Codeforces API returned HTTP ${apiRes.status}`);
    }

    const apiData = await apiRes.json();
    if (apiData.status !== 'OK' || !Array.isArray(apiData.result)) {
      throw new Error(apiData.comment || 'Failed to fetch status from Codeforces API');
    }

    // 3. Filter submissions to verdict === 'OK'
    const acceptedSubmissions = apiData.result.filter(sub => sub.verdict === 'OK' && sub.problem && sub.contestId);
    console.log(`[Codeforces Service] Found ${acceptedSubmissions.length} accepted submissions in recent 50.`);

    let newCount = 0;
    const checkProblemExists = db.prepare(
      "SELECT id FROM problems WHERE platform = 'codeforces' AND platform_problem_id = ?"
    );
    const insertProblem = db.prepare(`
      INSERT INTO problems (
        platform, platform_problem_id, title, url, difficulty,
        topics, question_statement, my_solution_code, my_solution_language,
        solved_at, pushed_to_github
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `);

    for (const sub of acceptedSubmissions) {
      const contestId = sub.contestId;
      const index = sub.problem.index;
      const platformProblemId = `${contestId}${index}`;

      // Check if problem is already saved
      const existing = checkProblemExists.get(platformProblemId);
      if (existing) {
        continue;
      }

      console.log(`[Codeforces Service] Processing new problem: ${platformProblemId} - ${sub.problem.name}`);

      // Rate limiting: 1.2s delay between submission fetches
      await new Promise(res => setTimeout(res, 1200));

      const sourceCode = await fetchSubmissionCode(contestId, sub.id);
      const submissionUrl = `https://codeforces.com/contest/${contestId}/submission/${sub.id}`;
      const problemUrl = `https://codeforces.com/contest/${contestId}/problem/${index}`;
      const difficulty = getDifficulty(sub.problem.rating);
      const topics = JSON.stringify(sub.problem.tags || []);
      const solvedAt = new Date(sub.creationTimeSeconds * 1000).toISOString();
      const codeContent = sourceCode || `// Source code viewable at ${submissionUrl}`;

      insertProblem.run(
        'codeforces',
        platformProblemId,
        sub.problem.name,
        problemUrl,
        difficulty,
        topics,
        null, // question_statement
        codeContent,
        sub.programmingLanguage || '',
        solvedAt
      );

      newCount++;
    }

    const logMessage = `Successfully synced ${newCount} new Codeforces problem(s) for handle '${handle}'.`;
    db.prepare(`
      INSERT INTO sync_log (platform, action, status, message)
      VALUES ('codeforces', 'fetch', 'success', ?)
    `).run(logMessage);

    console.log(`[Codeforces Service] ${logMessage}`);
    return { success: true, count: newCount, message: logMessage };

  } catch (err) {
    console.error('[Codeforces Service] Sync failed:', err);
    const errMsg = `Codeforces sync failed: ${err.message}`;
    db.prepare(`
      INSERT INTO sync_log (platform, action, status, message)
      VALUES ('codeforces', 'fetch', 'error', ?)
    `).run(errMsg);
    return { success: false, count: 0, message: errMsg };
  }
}

module.exports = { syncCodeforces };
