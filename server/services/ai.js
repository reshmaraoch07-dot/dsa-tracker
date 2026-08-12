const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const fs = require('fs');
const db = require('../db/init');

// Fixed Master Topic Taxonomy List
const MASTER_TOPICS = [
  'Array', 'String', 'Linked List', 'Stack', 'Queue', 'Tree',
  'Binary Search Tree', 'Heap', 'Graph', 'Dynamic Programming',
  'Greedy', 'Backtracking', 'Trie', 'Bit Manipulation',
  'Sliding Window', 'Two Pointers', 'Math', 'Recursion',
  'Sorting', 'Binary Search', 'Union Find', 'Segment Tree'
];

/**
 * Generates an optimal solution & explanation using Google's Gemini API.
 */
async function generateOptimalSolution(problem) {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in .env. Please get your key from https://aistudio.google.com/apikey and add it to .env.');
  }

  // Initialize Gemini Client
  const genAI = new GoogleGenerativeAI(apiKey);

  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

  let topicsList = 'None';
  try {
    const parsed = JSON.parse(problem.topics || '[]');
    if (Array.isArray(parsed) && parsed.length > 0) {
      topicsList = parsed.join(', ');
    }
  } catch (_) {}

  const targetLang = problem.my_solution_language || 'C++';
  const statement = problem.question_statement || `${problem.title} (${problem.url || ''})`;

  const prompt = `You are an expert Data Structures and Algorithms (DSA) competitive programming coach.

Problem Details:
- Title: ${problem.title}
- Platform: ${problem.platform}
- Difficulty: ${problem.difficulty || 'N/A'}
- Topics: ${topicsList}
- Target Programming Language: ${targetLang}

Question Statement:
${statement}

Please provide:
1. An optimal, clean, production-grade, well-commented solution written in ${targetLang}.
2. Time complexity and space complexity analysis.
3. A clear, plain-English explanation of the approach and why it is optimal compared to a naive brute-force approach.

CRITICAL: Respond STRICTLY using the exact format below, with delimiters:

###CODE###
<put your clean solution code here>
###EXPLANATION###
<put time/space complexity and approach explanation here>
`;

  console.log(`[Gemini AI Service] Requesting optimal solution for '${problem.title}' using gemini-2.5-flash...`);

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const responseText = response.text();

    // Parse code and explanation using delimiters
    let code = '';
    let explanation = '';

    if (responseText.includes('###CODE###') && responseText.includes('###EXPLANATION###')) {
      const parts = responseText.split('###EXPLANATION###');
      const codePart = parts[0].replace('###CODE###', '').trim();
      explanation = parts[1].trim();

      // Strip markdown code block formatting ticks if present
      code = codePart.replace(/^```[a-z0-9]*\n?/i, '').replace(/\n?```$/i, '').trim();
    } else {
      code = responseText.trim();
      explanation = 'Optimal solution generated successfully.';
    }

    // 1. Update database record
    db.prepare(`
      UPDATE problems
      SET optimal_solution_code = ?, optimal_solution_explanation = ?
      WHERE id = ?
    `).run(code, explanation, problem.id);

    // 2. If github file path exists, update local optimal_solution file in repo
    if (problem.github_file_path) {
      try {
        const repoPath = path.join(__dirname, '../data/repo', problem.github_file_path);
        if (fs.existsSync(repoPath)) {
          const ext = getFileExtension(problem.my_solution_language);
          const optFile = path.join(repoPath, `optimal_solution.${ext}`);
          const content = `${code}\n\n/*\n=== EXPLANATION ===\n${explanation}\n*/`;
          fs.writeFileSync(optFile, content, 'utf8');
        }
      } catch (fsErr) {
        console.warn('[Gemini AI Service] Failed to update local repo file:', fsErr.message);
      }
    }

    // Log sync action
    db.prepare(`
      INSERT INTO sync_log (platform, action, status, message)
      VALUES (?, 'fetch', 'success', ?)
    `).run(problem.platform || 'gemini', `Generated Gemini AI optimal solution for '${problem.title}'`);

    console.log(`[Gemini AI Service] Successfully generated optimal solution for '${problem.title}'.`);

    return {
      success: true,
      problem_id: problem.id,
      optimal_solution_code: code,
      optimal_solution_explanation: explanation
    };
  } catch (err) {
    console.error(`[Gemini AI Service] Error for '${problem.title}':`, err.message);
    throw new Error(`Gemini API Error: ${err.message}`);
  }
}

/**
 * Uses Gemini (gemini-2.5-flash) to analyze problem title and statement,
 * suggesting topic tags and difficulty rating.
 */
async function suggestTopicsAndDifficulty(problem) {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

  const statement = problem.question_statement || problem.title;

  const prompt = `You are an expert Data Structures and Algorithms (DSA) competitive programming coach.

Problem Details:
- Title: ${problem.title}
- Platform: ${problem.platform}
- Question Statement / Context:
${statement}

Analyze this problem and recommend:
1. 1 to 4 relevant topic tags. Choose STRICTLY from this fixed list:
[${MASTER_TOPICS.join(', ')}]

2. Problem difficulty rating. Choose STRICTLY from: ["Easy", "Medium", "Hard"]

CRITICAL: Respond ONLY with a valid JSON object. Do not add conversational text or markdown.
Format:
{
  "topics": ["Array", "Greedy"],
  "difficulty": "Medium"
}
`;

  console.log(`[Gemini AI Auto-Tag] Categorizing '${problem.title}'...`);

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text().trim();

    // Strip markdown code fences if present
    const cleanJson = rawText.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed = {};
    try {
      parsed = JSON.parse(cleanJson);
    } catch (parseErr) {
      console.warn(`[Gemini AI Auto-Tag] JSON parse failed for '${problem.title}':`, parseErr.message);
      parsed = { topics: [], difficulty: problem.difficulty || 'Medium' };
    }

    let topics = Array.isArray(parsed.topics) ? parsed.topics : [];
    let difficulty = parsed.difficulty || problem.difficulty || 'Medium';

    // Normalize difficulty
    const validDiffs = ['Easy', 'Medium', 'Hard'];
    if (!validDiffs.includes(difficulty)) {
      difficulty = 'Medium';
    }

    // Filter topics to ensure non-empty strings
    topics = topics.filter(t => typeof t === 'string' && t.trim().length > 0);

    const topicsJson = JSON.stringify(topics);

    // Update database row
    db.prepare(`
      UPDATE problems
      SET topics = ?, difficulty = ?
      WHERE id = ?
    `).run(topicsJson, difficulty, problem.id);

    // Insert topics into topics_master
    const insertTopic = db.prepare('INSERT OR IGNORE INTO topics_master (name) VALUES (?)');
    topics.forEach(t => insertTopic.run(t));

    console.log(`[Gemini AI Auto-Tag] Saved '${problem.title}' -> Topics: [${topics.join(', ')}], Difficulty: ${difficulty}`);

    return {
      success: true,
      problem_id: problem.id,
      topics,
      difficulty
    };
  } catch (err) {
    console.error(`[Gemini AI Auto-Tag] Error for '${problem.title}':`, err.message);
    throw new Error(`Auto-Tag Error: ${err.message}`);
  }
}

/**
 * Maps language to file extension.
 */
function getFileExtension(lang) {
  if (!lang) return 'cpp';
  const l = lang.toLowerCase();
  if (l.includes('c++') || l.includes('cpp') || l.includes('gcc') || l.includes('g++')) return 'cpp';
  if (l.includes('python') || l.includes('py')) return 'py';
  if (l.includes('java')) return 'java';
  if (l.includes('javascript') || l.includes('js') || l.includes('node')) return 'js';
  return 'cpp';
}

module.exports = {
  generateOptimalSolution,
  suggestTopicsAndDifficulty
};
