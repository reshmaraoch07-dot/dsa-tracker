const path = require('path');
const fs = require('fs');
const simpleGit = require('simple-git');
const db = require('../db/init');

const repoPath = path.join(__dirname, '../data/repo');

/**
 * Returns the authenticated clone/push URL using GITHUB_TOKEN from .env.
 */
function getAuthRepoUrl() {
  const token = process.env.GITHUB_TOKEN ? process.env.GITHUB_TOKEN.trim() : '';
  const rawUrl = process.env.GITHUB_REPO_URL ? process.env.GITHUB_REPO_URL.trim() : '';
  if (!rawUrl) {
    throw new Error('GITHUB_REPO_URL is not set in environment variables.');
  }

  if (token && rawUrl.startsWith('https://')) {
    return rawUrl.replace('https://', `https://${token}@`);
  }
  return rawUrl;
}

/**
 * Ensures the target GitHub repo is cloned into /server/data/repo and configured.
 */
async function ensureRepoCloned() {
  const dataDir = path.join(__dirname, '../data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const authUrl = getAuthRepoUrl();

  if (!fs.existsSync(repoPath)) {
    console.log('[GitHub Service] Local repository folder does not exist. Cloning...');
    await simpleGit().clone(authUrl, repoPath);
    console.log('[GitHub Service] Repository cloned successfully.');
  }

  const git = simpleGit({ baseDir: repoPath, unsafe: { allowUnsafeCredentialHelper: true } });
  const username = process.env.GITHUB_USERNAME || 'dsa-tracker-bot';
  const email = process.env.GITHUB_USER_EMAIL || 'dsa-tracker@example.com';

  await git.remote(['set-url', 'origin', authUrl]);
  await git.addConfig('user.name', username);
  await git.addConfig('user.email', email);
  console.log(`[GitHub Service] Git user configured as ${username} <${email}>`);
}

/**
 * Maps language name to file extension.
 */
function getFileExtension(lang) {
  if (!lang) return 'cpp';
  const l = lang.toLowerCase();
  if (l.includes('c++') || l.includes('cpp') || l.includes('gcc') || l.includes('g++')) return 'cpp';
  if (l.includes('python') || l.includes('py')) return 'py';
  if (l.includes('java')) return 'java';
  if (l.includes('javascript') || l.includes('js') || l.includes('node')) return 'js';
  if (l.includes('typescript') || l.includes('ts')) return 'ts';
  if (l.includes('c')) return 'c';
  if (l.includes('go')) return 'go';
  if (l.includes('rust')) return 'rs';
  if (l.includes('kotlin')) return 'kt';
  if (l.includes('swift')) return 'swift';
  return 'cpp';
}

/**
 * Sanitizes a title string for directory names.
 */
function sanitizeTitle(title) {
  if (!title) return 'problem';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Regenerates top-level PROGRESS.md listing all solved problems grouped by platform,
 * sorted by date descending.
 */
function generateProgressMarkdown() {
  const problems = db.prepare(`
    SELECT platform, title, url, difficulty, topics, solved_at
    FROM problems
    ORDER BY solved_at DESC, id DESC
  `).all();

  let md = `# 🚀 DSA Practice Progress\n\n`;
  md += `Total Solved: **${problems.length}**\n\n`;
  md += `| Title | Platform | Difficulty | Topics | Date Solved |\n`;
  md += `| :--- | :--- | :--- | :--- | :--- |\n`;

  for (const p of problems) {
    let topicList = 'None';
    try {
      const parsed = JSON.parse(p.topics || '[]');
      if (Array.isArray(parsed) && parsed.length > 0) {
        topicList = parsed.join(', ');
      }
    } catch (_) {}

    const titleLink = p.url ? `[${p.title}](${p.url})` : p.title;
    const dateFormatted = p.solved_at ? p.solved_at.split('T')[0] : 'N/A';
    const platformCaps = (p.platform || 'Unknown').toUpperCase();

    md += `| ${titleLink} | ${platformCaps} | ${p.difficulty || 'N/A'} | ${topicList} | ${dateFormatted} |\n`;
  }

  const progressPath = path.join(repoPath, 'PROGRESS.md');
  fs.writeFileSync(progressPath, md, 'utf8');
}

/**
 * Pushes a single problem to GitHub.
 */
async function pushProblemToGithub(problemId) {
  await ensureRepoCloned();

  const problem = db.prepare('SELECT * FROM problems WHERE id = ?').get(problemId);
  if (!problem) {
    throw new Error(`Problem with ID ${problemId} not found.`);
  }

  let topics = [];
  try {
    topics = JSON.parse(problem.topics || '[]');
  } catch (_) {}

  const primaryTopic = (Array.isArray(topics) && topics.length > 0) ? sanitizeTitle(topics[0]) : 'uncategorized';
  const sanitizedTitle = sanitizeTitle(problem.title);
  const platformDir = sanitizeTitle(problem.platform);

  // Folder path: /server/data/repo/{platform}/{primary_topic}/{sanitized-title}/
  const relFolder = path.join(platformDir, primaryTopic, sanitizedTitle);
  const targetDir = path.join(repoPath, relFolder);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const ext = getFileExtension(problem.my_solution_language);

  // 1. Write question.md
  const questionContent = `# [${problem.title}](${problem.url || '#'})

**Platform**: ${problem.platform}  
**Difficulty**: ${problem.difficulty || 'N/A'}  
**Topics**: ${(Array.isArray(topics) && topics.length > 0) ? topics.join(', ') : 'None'}  

---

## Question Statement
${problem.question_statement || 'Refer to the original problem link above.'}
`;
  fs.writeFileSync(path.join(targetDir, 'question.md'), questionContent, 'utf8');

  // 2. Write my_solution.{ext}
  const mySolutionContent = problem.my_solution_code || `// Solution for ${problem.title}\n// Language: ${problem.my_solution_language || 'N/A'}`;
  fs.writeFileSync(path.join(targetDir, `my_solution.${ext}`), mySolutionContent, 'utf8');

  // 3. Write optimal_solution.{ext}
  const optimalSolutionContent = problem.optimal_solution_code || 'Not generated yet';
  fs.writeFileSync(path.join(targetDir, `optimal_solution.${ext}`), optimalSolutionContent, 'utf8');

  // 4. Regenerate PROGRESS.md
  generateProgressMarkdown();

  // 5. Git Commit & Push
  const git = simpleGit({ baseDir: repoPath, unsafe: { allowUnsafeCredentialHelper: true } });
  await git.add('./*');

  const commitMsg = `Solved: ${problem.title} (${problem.platform})`;
  try {
    await git.commit(commitMsg);
  } catch (_) {}

  let currentBranch = 'main';
  try {
    const status = await git.status();
    if (status.current) currentBranch = status.current;
  } catch (_) {}

  const authUrl = getAuthRepoUrl();
  let pushSuccess = false;
  try {
    await git.push(authUrl, currentBranch);
    pushSuccess = true;
  } catch (pushErr) {
    console.warn(`[GitHub Service] Remote push failed for problem ${problemId}:`, pushErr.message);
  }

  // 6. Update database record
  db.prepare(`
    UPDATE problems
    SET pushed_to_github = ?, github_file_path = ?
    WHERE id = ?
  `).run(pushSuccess ? 1 : 0, relFolder, problemId);

  // 7. Log sync action
  const logMsg = pushSuccess
    ? `Successfully committed & pushed '${problem.title}' to GitHub at ${relFolder}`
    : `Committed '${problem.title}' locally at ${relFolder} (Remote push requires write PAT permission)`;
  
  db.prepare(`
    INSERT INTO sync_log (platform, action, status, message)
    VALUES (?, 'push', ?, ?)
  `).run(problem.platform, pushSuccess ? 'success' : 'error', logMsg);

  console.log(`[GitHub Service] ${logMsg}`);
  return { success: pushSuccess, problemId, github_file_path: relFolder, pushed: pushSuccess };
}

/**
 * Loops through all unpushed problems and pushes each to GitHub with a 1s delay.
 */
async function pushAllUnpushedProblems() {
  await ensureRepoCloned();

  const unpushed = db.prepare('SELECT id, title, platform FROM problems WHERE pushed_to_github = 0').all();
  console.log(`[GitHub Service] Found ${unpushed.length} unpushed problems.`);

  let pushedCount = 0;
  for (const prob of unpushed) {
    if (pushedCount > 0) {
      // 1s delay between commits
      await new Promise(res => setTimeout(res, 1000));
    }

    try {
      const res = await pushProblemToGithub(prob.id);
      if (res.pushed) pushedCount++;
    } catch (err) {
      console.error(`[GitHub Service] Error processing problem ID ${prob.id}:`, err.message);
      db.prepare(`
        INSERT INTO sync_log (platform, action, status, message)
        VALUES (?, 'push', 'error', ?)
      `).run(prob.platform || 'github', `Failed to process problem ID ${prob.id}: ${err.message}`);
    }
  }

  const summary = `Processed ${unpushed.length} problem(s), ${pushedCount} successfully pushed to GitHub remote.`;
  console.log(`[GitHub Service] ${summary}`);
  return { success: true, count: pushedCount, total: unpushed.length, message: summary };
}

module.exports = {
  ensureRepoCloned,
  pushProblemToGithub,
  pushAllUnpushedProblems
};
