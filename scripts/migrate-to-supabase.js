const path = require('path');
const Database = require('better-sqlite3');
const supabase = require('../server/db/supabaseClient');

async function migrateData() {
  console.log('=== Starting Local SQLite -> Supabase Data Migration ===\n');

  const dbPath = path.join(__dirname, '../server/data/tracker.db');
  const sqliteDb = new Database(dbPath);

  // 1. Migrate Topics Master
  const masterTopics = sqliteDb.prepare('SELECT * FROM topics_master').all();
  console.log(`[1/3] Found ${masterTopics.length} topic(s) in local topics_master.`);
  
  for (const t of masterTopics) {
    if (t.name) {
      await supabase.from('topics_master').upsert({ name: t.name.trim() }, { onConflict: 'name' });
    }
  }

  // 2. Migrate Settings
  const settings = sqliteDb.prepare('SELECT * FROM settings').all();
  console.log(`[2/3] Found ${settings.length} setting(s) in local settings.`);

  for (const s of settings) {
    if (s.key) {
      await supabase.from('settings').upsert({ key: s.key, value: String(s.value) }, { onConflict: 'key' });
    }
  }

  // 3. Migrate Problems
  const problems = sqliteDb.prepare('SELECT * FROM problems ORDER BY id ASC').all();
  console.log(`[3/3] Found ${problems.length} problem(s) in local tracker.db.`);

  let insertedCount = 0;
  let skippedCount = 0;

  for (const p of problems) {
    let topicsArr = [];
    if (Array.isArray(p.topics)) topicsArr = p.topics;
    else if (typeof p.topics === 'string') {
      try { topicsArr = JSON.parse(p.topics); } catch (_) {
        if (p.topics.trim()) topicsArr = [p.topics.trim()];
      }
    }

    const problemRow = {
      platform: String(p.platform || 'other').toLowerCase().trim(),
      platform_problem_id: String(p.platform_problem_id || p.id).trim(),
      title: String(p.title || 'Untitled').trim(),
      url: p.url || '',
      difficulty: p.difficulty || 'Medium',
      topics: topicsArr, // Native JSONB array!
      question_statement: p.question_statement || '',
      my_solution_code: p.my_solution_code || '',
      my_solution_language: p.my_solution_language || 'C++',
      optimal_solution_code: p.optimal_solution_code || null,
      optimal_solution_explanation: p.optimal_solution_explanation || null,
      solved_at: p.solved_at || new Date().toISOString(),
      pushed_to_github: Boolean(p.pushed_to_github),
      github_file_path: p.github_file_path || null,
      created_at: p.created_at || new Date().toISOString()
    };

    const { data, error } = await supabase
      .from('problems')
      .upsert(problemRow, { onConflict: 'platform, platform_problem_id' })
      .select();

    if (error) {
      console.error(`  - Failed to migrate '${p.title}':`, error.message);
      skippedCount++;
    } else {
      insertedCount++;
    }
  }

  console.log('\n=== Migration Completed ===');
  console.log(`- Local SQLite Problems: ${problems.length}`);
  console.log(`- Supabase Restored Problems: ${insertedCount}`);
  console.log(`- Errors/Skipped: ${skippedCount}`);

  // Query Supabase total
  const { count: finalCount } = await supabase
    .from('problems')
    .select('*', { count: 'exact', head: true });

  console.log(`\nVerified Supabase total row count: ${finalCount || 0}`);
}

migrateData().catch(err => {
  console.error('\n[Migration Error]:', err.message);
  process.exit(1);
});
