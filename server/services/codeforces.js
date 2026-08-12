const supabase = require('../db/init');

/**
 * Syncs recent Accepted submissions from Codeforces user status API.
 */
async function syncCodeforces() {
  console.log('[Codeforces Sync] Starting Codeforces sync process...');

  // 1. Read handle from settings table
  const { data: settingRow, error: settingErr } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'codeforces_handle')
    .single();

  if (settingErr || !settingRow || !settingRow.value) {
    throw new Error('Codeforces handle is not configured in settings.');
  }

  const handle = settingRow.value.trim();
  console.log(`[Codeforces Sync] Fetching recent submissions for handle '${handle}'...`);

  // 2. Fetch submissions from Codeforces API
  const cfApiUrl = `https://codeforces.com/api/user.status?handle=${encodeURIComponent(handle)}&from=1&count=50`;
  const response = await fetch(cfApiUrl);

  if (!response.ok) {
    throw new Error(`Codeforces API returned HTTP status ${response.status}`);
  }

  const cfData = await response.json();

  if (cfData.status !== 'OK' || !Array.isArray(cfData.result)) {
    throw new Error(cfData.comment || 'Failed to fetch user submissions from Codeforces API.');
  }

  const submissions = cfData.result;
  let addedCount = 0;

  for (const sub of submissions) {
    if (sub.verdict !== 'OK') continue;
    if (!sub.problem || !sub.contestId) continue;

    const contestId = sub.contestId;
    const index = sub.problem.index;
    const submissionId = sub.id;
    const platformProblemId = `${contestId}${index}`;

    // Check if submission already exists in Supabase
    const { data: existing, error: checkErr } = await supabase
      .from('problems')
      .select('id')
      .eq('platform', 'codeforces')
      .eq('platform_problem_id', platformProblemId)
      .maybeSingle();

    if (existing) {
      continue; // Duplicate, skip
    }

    const title = `${sub.problem.name} (${contestId}${index})`;
    const problemUrl = `https://codeforces.com/contest/${contestId}/problem/${index}`;
    const topicsArr = Array.isArray(sub.problem.tags) ? sub.problem.tags : [];
    
    let difficulty = 'Medium';
    if (sub.problem.rating) {
      if (sub.problem.rating < 1300) difficulty = 'Easy';
      else if (sub.problem.rating < 1900) difficulty = 'Medium';
      else difficulty = 'Hard';
    }

    // Save custom topics into topics_master
    for (const tag of topicsArr) {
      if (tag && typeof tag === 'string') {
        await supabase
          .from('topics_master')
          .upsert({ name: tag.trim() }, { onConflict: 'name' });
      }
    }

    // Fetch submission source code from HTML page
    const subPageUrl = `https://codeforces.com/contest/${contestId}/submission/${submissionId}`;
    let code = '// Source code unavailable';
    let lang = sub.programmingLanguage || 'C++';

    try {
      const pageRes = await fetch(subPageUrl);
      if (pageRes.ok) {
        const htmlText = await pageRes.text();
        const preMatch = htmlText.match(/<pre[^>]*id=["']program-source-text["'][^>]*>([\s\S]*?)<\/pre>/i);
        if (preMatch && preMatch[1]) {
          code = decodeHtmlEntities(preMatch[1].trim());
        }
      }
    } catch (codeErr) {
      console.warn(`[Codeforces Sync] Failed to fetch source code for submission ${submissionId}:`, codeErr.message);
    }

    const solvedAt = sub.creationTimeSeconds
      ? new Date(sub.creationTimeSeconds * 1000).toISOString()
      : new Date().toISOString();

    const statement = `Codeforces Problem: ${title}\nContest ID: ${contestId}, Index: ${index}\nRating: ${sub.problem.rating || 'Unrated'}\nOriginal URL: ${problemUrl}`;

    // Insert new problem into Supabase
    const { error: insertErr } = await supabase
      .from('problems')
      .insert({
        platform: 'codeforces',
        platform_problem_id: platformProblemId,
        title: title,
        url: problemUrl,
        difficulty: difficulty,
        topics: topicsArr, // Native JSONB array!
        question_statement: statement,
        my_solution_code: code,
        my_solution_language: lang,
        solved_at: solvedAt,
        pushed_to_github: false
      });

    if (insertErr) {
      console.error(`[Codeforces Sync] Insert error for ${title}:`, insertErr.message);
    } else {
      console.log(`[Codeforces Sync] Successfully added new problem: ${title}`);
      addedCount++;
    }
  }

  // Log sync action in sync_log
  await supabase
    .from('sync_log')
    .insert({
      platform: 'codeforces',
      action: 'sync_codeforces',
      status: 'success',
      message: `Synced ${addedCount} new problem(s) from Codeforces`
    });

  return {
    success: true,
    count: addedCount,
    message: `Successfully synced ${addedCount} new problem(s) from Codeforces.`
  };
}

/**
 * Decodes HTML entities from scraped code text.
 */
function decodeHtmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

module.exports = { syncCodeforces };
