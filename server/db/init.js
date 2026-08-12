const supabase = require('./supabaseClient');

/**
 * Helper to ensure Supabase client connection is ready.
 */
async function initDb() {
  try {
    const { count, error } = await supabase
      .from('problems')
      .select('*', { count: 'exact', head: true });

    if (error) {
      console.warn('[Supabase Database] Initial query notice:', error.message);
    } else {
      console.log(`[Supabase Database] Connected successfully. Total problems in DB: ${count || 0}`);
    }
  } catch (err) {
    console.error('[Supabase Database] Connection error:', err.message);
  }
}

module.exports = supabase;
module.exports.initDb = initDb;
