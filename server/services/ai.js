const path = require('path');
const fs = require('fs');
const supabase = require('../db/init');

// Fixed Master Topic Taxonomy List
const MASTER_TOPICS = [
  'Array', 'String', 'Linked List', 'Stack', 'Queue', 'Tree',
  'Binary Search Tree', 'Heap', 'Graph', 'Dynamic Programming',
  'Greedy', 'Backtracking', 'Trie', 'Bit Manipulation',
  'Sliding Window', 'Two Pointers', 'Math', 'Recursion',
  'Sorting', 'Binary Search', 'Union Find', 'Segment Tree'
];

/**
 * Calls Google Gemini Interactions API using fetch.
 */
async function callGeminiInteractionsApi(apiKey, promptText, modelName = 'gemini-3.5-flash') {
  const url = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelName,
      input: promptText
    })
  });

  const data = await response.json();

  if (!response.ok || data.error) {
    const errMsg = data.error ? (data.error.message || JSON.stringify(data.error)) : `HTTP ${response.status}`;
    throw new Error(`Google Gemini API Error (${response.status}): ${errMsg}`);
  }

  // Extract generated text from steps
  if (Array.isArray(data.steps)) {
    for (const step of data.steps) {
      if (step.type === 'model_output' && Array.isArray(step.content)) {
        for (const item of step.content) {
          if (item.text) return item.text;
        }
      }
    }
  }

  if (data.output && typeof data.output === 'string') {
    return data.output;
  }

  return JSON.stringify(data);
}

/**
 * Generates an optimal solution & explanation using Google's Gemini Interactions API.
 */
async function generateOptimalSolution(problem) {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }

  let topicsList = 'None';
  try {
    if (Array.isArray(problem.topics) && problem.topics.length > 0) {
      topicsList = problem.topics.join(', ');
    } else if (typeof problem.topics === 'string') {
      const parsed = JSON.parse(problem.topics);
      if (Array.isArray(parsed) && parsed.length > 0) topicsList = parsed.join(', ');
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

  console.log(`[Gemini AI Service] Requesting optimal solution for '${problem.title}' using Gemini Interactions API...`);

  try {
    const responseText = await callGeminiInteractionsApi(apiKey, prompt);

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

    // 1. Update database record in Supabase
    await supabase
      .from('problems')
      .update({
        optimal_solution_code: code,
        optimal_solution_explanation: explanation
      })
      .eq('id', problem.id);

    // Log sync action
    await supabase
      .from('sync_log')
      .insert({
        platform: problem.platform || 'gemini',
        action: 'fetch',
        status: 'success',
        message: `Generated Gemini AI optimal solution for '${problem.title}'`
      });

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
 * Uses Gemini Interactions API to analyze problem title and statement,
 * suggesting topic tags and difficulty rating.
 */
async function suggestTopicsAndDifficulty(problem) {
  const apiKey = process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.trim() : '';

  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY is not configured in environment variables.');
  }

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
    const rawText = await callGeminiInteractionsApi(apiKey, prompt);

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

    // Update database row in Supabase
    await supabase
      .from('problems')
      .update({
        topics: topics, // Native JSONB array!
        difficulty: difficulty
      })
      .eq('id', problem.id);

    // Insert topics into topics_master
    for (const t of topics) {
      if (t && typeof t === 'string' && t.trim()) {
        await supabase
          .from('topics_master')
          .upsert({ name: t.trim() }, { onConflict: 'name' });
      }
    }

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

function getFileExtension(lang) {
  if (!lang) return 'cpp';
  const l = lang.toLowerCase();
  if (l.includes('c++') || l.includes('cpp') || l.includes('gcc') || l.includes('g++')) return 'cpp';
  if (l.includes('py') || l.includes('python')) return 'py';
  if (l.includes('java')) return 'java';
  if (l.includes('js') || l.includes('javascript') || l.includes('node')) return 'js';
  return 'cpp';
}

module.exports = {
  generateOptimalSolution,
  suggestTopicsAndDifficulty
};
