const db = require('../db/init');

/**
 * Calculates summary statistics:
 * - totalSolved: Total count of problems in DB
 * - currentStreak: Consecutive days with at least 1 solve leading up to today/yesterday
 * - longestStreak: Max consecutive days with at least 1 solve historically
 */
function getSummaryStats() {
  const totalRow = db.prepare('SELECT COUNT(*) as count FROM problems').get();
  const totalSolved = totalRow ? totalRow.count : 0;

  // Get distinct solved dates sorted descending
  const dateRows = db.prepare(`
    SELECT DISTINCT DATE(solved_at) as solve_date 
    FROM problems 
    WHERE solved_at IS NOT NULL 
    ORDER BY solve_date DESC
  `).all();

  if (dateRows.length === 0) {
    return { totalSolved: 0, currentStreak: 0, longestStreak: 0 };
  }

  const dates = dateRows.map(r => r.solve_date);

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
    totalSolved,
    currentStreak,
    longestStreak
  };
}

/**
 * Returns solve counts per date for the last 365 days.
 */
function getHeatmapData() {
  const rows = db.prepare(`
    SELECT DATE(solved_at) as date, COUNT(*) as count 
    FROM problems 
    WHERE solved_at IS NOT NULL 
      AND solved_at >= DATE('now', '-365 days')
    GROUP BY DATE(solved_at)
    ORDER BY date ASC
  `).all();

  const heatmapMap = {};
  rows.forEach(r => {
    heatmapMap[r.date] = r.count;
  });

  return heatmapMap;
}

/**
 * Returns topic counts for all topics in topics_master.
 * Matches against topics JSON array strings stored on problems.
 */
function getTopicStats() {
  const masterTopics = db.prepare('SELECT name FROM topics_master ORDER BY name ASC').all();
  const problems = db.prepare('SELECT topics FROM problems WHERE topics IS NOT NULL').all();

  const topicCountMap = {};
  masterTopics.forEach(t => {
    topicCountMap[t.name] = 0;
  });

  problems.forEach(p => {
    try {
      const topicsArr = JSON.parse(p.topics);
      if (Array.isArray(topicsArr)) {
        topicsArr.forEach(topic => {
          // Normalize matching case-insensitively or exact
          const match = masterTopics.find(mt => mt.name.toLowerCase() === topic.toLowerCase());
          if (match) {
            topicCountMap[match.name] = (topicCountMap[match.name] || 0) + 1;
          } else {
            // Unlisted topic dynamically added
            topicCountMap[topic] = (topicCountMap[topic] || 0) + 1;
          }
        });
      }
    } catch (_) {}
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
function getWeakTopics(limit = 5) {
  const allTopicStats = getTopicStats();
  
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
