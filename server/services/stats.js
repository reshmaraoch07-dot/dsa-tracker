const supabase = require('../db/init');

/**
 * Calculates summary statistics:
 * - totalSolved: Total count of problems in DB
 * - currentStreak: Consecutive days with at least 1 solve leading up to today/yesterday
 * - longestStreak: Max consecutive days with at least 1 solve historically
 */
async function getSummaryStats() {
  const { count: totalSolved, error: countErr } = await supabase
    .from('problems')
    .select('*', { count: 'exact', head: true });

  if (countErr) {
    console.error('[Stats Service] Count error:', countErr.message);
  }

  // Fetch distinct solved_at timestamps sorted descending
  const { data: probRows, error: datesErr } = await supabase
    .from('problems')
    .select('solved_at')
    .not('solved_at', 'is', null)
    .order('solved_at', { ascending: false });

  if (datesErr || !probRows || probRows.length === 0) {
    return { totalSolved: totalSolved || 0, currentStreak: 0, longestStreak: 0 };
  }

  // Extract distinct YYYY-MM-DD date strings
  const dateSet = new Set();
  probRows.forEach(r => {
    if (r.solved_at) {
      const dateStr = new Date(r.solved_at).toISOString().split('T')[0];
      dateSet.add(dateStr);
    }
  });

  const dates = Array.from(dateSet).sort().reverse();

  if (dates.length === 0) {
    return { totalSolved: totalSolved || 0, currentStreak: 0, longestStreak: 0 };
  }

  // Helper to parse YYYY-MM-DD into midnight UTC timestamp
  function parseDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  }

  const DAY_MS = 86400000;
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const yesterdayStr = new Date(now.getTime() - DAY_MS).toISOString().split('T')[0];

  let currentStreak = 0;
  let longestStreak = 0;

  // 1. Current Streak calculation
  const latestDateStr = dates[0];
  if (latestDateStr === todayStr || latestDateStr === yesterdayStr) {
    currentStreak = 1;
    let prevMs = parseDate(latestDateStr);

    for (let i = 1; i < dates.length; i++) {
      const currMs = parseDate(dates[i]);
      const diffDays = Math.round((prevMs - currMs) / DAY_MS);
      if (diffDays === 1) {
        currentStreak++;
        prevMs = currMs;
      } else {
        break;
      }
    }
  }

  // 2. Longest Streak calculation
  if (dates.length > 0) {
    let tempStreak = 1;
    longestStreak = 1;
    let prevMs = parseDate(dates[0]);

    for (let i = 1; i < dates.length; i++) {
      const currMs = parseDate(dates[i]);
      const diffDays = Math.round((prevMs - currMs) / DAY_MS);
      if (diffDays === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
      prevMs = currMs;
    }
  }

  return {
    totalSolved: totalSolved || 0,
    currentStreak,
    longestStreak
  };
}

/**
 * Returns solve counts per date for the last 365 days.
 */
async function getHeatmapData() {
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString();

  const { data: rows, error } = await supabase
    .from('problems')
    .select('solved_at')
    .not('solved_at', 'is', null)
    .gte('solved_at', oneYearAgo);

  if (error || !rows) {
    console.error('[Stats Service] Heatmap error:', error?.message);
    return {};
  }

  const heatmapMap = {};
  rows.forEach(r => {
    if (r.solved_at) {
      const dateStr = new Date(r.solved_at).toISOString().split('T')[0];
      heatmapMap[dateStr] = (heatmapMap[dateStr] || 0) + 1;
    }
  });

  return heatmapMap;
}

/**
 * Returns topic counts for all topics in topics_master.
 * Native Postgres JSONB array handling on problems.
 */
async function getTopicStats() {
  const { data: masterTopics, error: masterErr } = await supabase
    .from('topics_master')
    .select('name')
    .order('name', { ascending: true });

  const { data: problems, error: probErr } = await supabase
    .from('problems')
    .select('topics')
    .not('topics', 'is', null);

  if (masterErr || probErr) {
    console.error('[Stats Service] Topics fetch error:', masterErr?.message || probErr?.message);
  }

  const masterList = masterTopics || [];
  const topicCountMap = {};

  masterList.forEach(t => {
    topicCountMap[t.name] = 0;
  });

  (problems || []).forEach(p => {
    let topicsArr = [];
    if (Array.isArray(p.topics)) {
      topicsArr = p.topics;
    } else if (typeof p.topics === 'string') {
      try { topicsArr = JSON.parse(p.topics); } catch (_) {}
    }

    if (Array.isArray(topicsArr)) {
      topicsArr.forEach(topic => {
        const match = masterList.find(mt => mt.name.toLowerCase() === topic.toLowerCase());
        if (match) {
          topicCountMap[match.name] = (topicCountMap[match.name] || 0) + 1;
        } else {
          topicCountMap[topic] = (topicCountMap[topic] || 0) + 1;
        }
      });
    }
  });

  const result = Object.keys(topicCountMap).map(topic => ({
    topic,
    count: topicCountMap[topic]
  }));

  // Sort descending by count, then alphabetically
  result.sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic));
  return result;
}

/**
 * Returns weak/untouched topics sorted ascending by solve count (0 solves first).
 * Generates LeetCode topic tag slugs for direct practice links.
 */
async function getWeakTopics(limit = 5) {
  const allTopicStats = await getTopicStats();
  
  // Sort ascending by solve count, then alphabetically
  const sortedAsc = [...allTopicStats].sort((a, b) => a.count - b.count || a.topic.localeCompare(b.topic));

  const weakTopics = sortedAsc.slice(0, limit).map(t => {
    const slug = t.topic
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');

    return {
      topic: t.topic,
      count: t.count,
      isUntouched: t.count === 0,
      slug: slug,
      leetcodeUrl: `https://leetcode.com/tag/${slug}/`
    };
  });

  return weakTopics;
}

module.exports = {
  getSummaryStats,
  getHeatmapData,
  getTopicStats,
  getWeakTopics
};
