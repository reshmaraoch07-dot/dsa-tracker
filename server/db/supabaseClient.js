const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('[Supabase Client] Warning: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are missing.');
}

// Server-side client using Service Role Key (bypasses RLS)
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false
  }
});

module.exports = supabase;
