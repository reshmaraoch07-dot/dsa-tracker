const cron = require('node-cron');
const supabase = require('../db/init');
const { syncCodeforces } = require('./codeforces');
const { pushAllUnpushedProblems } = require('./github');

/**
 * Helper to log scheduled task execution results into sync_log.
 */
async function logSync(platform, action, status, message) {
  try {
    await supabase
      .from('sync_log')
      .insert({ platform, action, status, message });
  } catch (err) {
    console.error('[Scheduler] Failed to write to sync_log:', err.message);
  }
}

/**
 * Initializes automated background cron jobs.
 */
function initScheduler() {
  if (process.env.VERCEL) {
    console.log('[Scheduler] Running in Vercel serverless environment; skipping background cron initialization.');
    return;
  }

  console.log('[Scheduler] Initializing automated background sync schedules...');

  // 1. Codeforces Auto-Sync: Every 4 hours (0 */4 * * *)
  cron.schedule('0 */4 * * *', async () => {
    console.log('[Scheduler] Running automated Codeforces sync...');
    try {
      const result = await syncCodeforces();
      const msg = result.message || `Synced ${result.count || 0} problem(s)`;
      await logSync('codeforces', 'sync_codeforces', 'success', msg);
      console.log(`[Scheduler] Automated Codeforces sync complete: ${msg}`);
    } catch (err) {
      console.error('[Scheduler] Automated Codeforces sync failed:', err.message);
      await logSync('codeforces', 'sync_codeforces', 'error', err.message);
    }
  });

  // 2. GitHub Auto-Push: Every 6 hours (0 */6 * * *)
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Scheduler] Running automated GitHub push...');
    try {
      const result = await pushAllUnpushedProblems();
      const msg = result.message || `Pushed ${result.count || 0} problem(s) to GitHub`;
      await logSync('github', 'push_github', 'success', msg);
      console.log(`[Scheduler] Automated GitHub push complete: ${msg}`);
    } catch (err) {
      console.error('[Scheduler] Automated GitHub push failed:', err.message);
      await logSync('github', 'push_github', 'error', err.message);
    }
  });

  console.log('[Scheduler] Active: Codeforces sync set for every 4h, GitHub push for every 6h.');
}

module.exports = { initScheduler };
