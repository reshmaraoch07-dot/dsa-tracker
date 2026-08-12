const db = require('./init');

console.log('--- Testing DB Setup & Insertion ---');

// 1. Check pre-populated topics
const topicCount = db.prepare('SELECT COUNT(*) as count FROM topics_master').get();
console.log(`Pre-populated topics count: ${topicCount.count}`);

// 2. Insert dummy problem row
const insertProblem = db.prepare(`
  INSERT OR REPLACE INTO problems (
    platform, platform_problem_id, title, url, difficulty,
    topics, question_statement, my_solution_code, my_solution_language,
    optimal_solution_code, optimal_solution_explanation, solved_at
  ) VALUES (
    ?, ?, ?, ?, ?,
    ?, ?, ?, ?,
    ?, ?, ?
  )
`);

const dummyProblem = {
  platform: 'leetcode',
  platform_problem_id: '1',
  title: 'Two Sum',
  url: 'https://leetcode.com/problems/two-sum/',
  difficulty: 'Easy',
  topics: JSON.stringify(['Array', 'Hash Table']),
  question_statement: 'Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.',
  my_solution_code: 'function twoSum(nums, target) {\n  const map = new Map();\n  for (let i = 0; i < nums.length; i++) {\n    const diff = target - nums[i];\n    if (map.has(diff)) return [map.get(diff), i];\n    map.set(nums[i], i);\n  }\n}',
  my_solution_language: 'javascript',
  optimal_solution_code: 'function twoSum(nums, target) { ... }',
  optimal_solution_explanation: 'Use a hash map to achieve O(n) time complexity.',
  solved_at: new Date().toISOString()
};

const info = insertProblem.run(
  dummyProblem.platform,
  dummyProblem.platform_problem_id,
  dummyProblem.title,
  dummyProblem.url,
  dummyProblem.difficulty,
  dummyProblem.topics,
  dummyProblem.question_statement,
  dummyProblem.my_solution_code,
  dummyProblem.my_solution_language,
  dummyProblem.optimal_solution_code,
  dummyProblem.optimal_solution_explanation,
  dummyProblem.solved_at
);

console.log(`Inserted problem row ID: ${info.lastInsertRowid}`);

// 3. Read back the inserted problem
const row = db.prepare('SELECT * FROM problems WHERE platform = ? AND platform_problem_id = ?').get('leetcode', '1');

console.log('\n--- Retrieved Problem Row ---');
console.log(JSON.stringify(row, null, 2));
