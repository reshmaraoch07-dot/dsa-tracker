const supabase = require('../db/init');

/**
 * Parses owner and repo name from GITHUB_REPO_URL env var.
 * Supports: https://github.com/owner/repo.git, https://token@github.com/owner/repo.git, owner/repo
 */
function parseRepoDetails() {
  const repoUrl = process.env.GITHUB_REPO_URL || '';
  const cleanUrl = repoUrl.replace(/\.git$/i, '').trim();

  let match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/i);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  const parts = cleanUrl.split('/');
  if (parts.length === 2) {
    return { owner: parts[0], repo: parts[1] };
  }

  throw new Error(`Invalid GITHUB_REPO_URL '${repoUrl}'. Expected format: https://github.com/owner/repo`);
}

/**
 * Ensures repo connection details are valid using native fetch.
 */
async function ensureRepoCloned() {
  try {
    const { owner, repo } = parseRepoDetails();
    const token = process.env.GITHUB_TOKEN ? process.env.GITHUB_TOKEN.trim() : '';

    if (!token || token === 'your_github_token_here') {
      console.warn('[GitHub Service] GITHUB_TOKEN is not configured.');
      return false;
    }

    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'DSA-Tracker-App'
      }
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[GitHub Service] Connected to remote repository '${data.full_name}'.`);
      return true;
    } else {
      console.warn('[GitHub Service] Repository check HTTP status:', res.status);
      return false;
    }
  } catch (err) {
    console.warn('[GitHub Service] Repository check warning:', err.message);
    return false;
  }
}

/**
 * Commits or updates a single file in remote GitHub repository via native fetch.
 */
async function commitRemoteFile(owner, repo, token, filePath, content, commitMessage) {
  const base64Content = Buffer.from(content, 'utf8').toString('base64');
  const fileApiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`;

  let sha = undefined;

  // Check if file already exists remotely to retrieve existing SHA
  try {
    const getRes = await fetch(fileApiUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'DSA-Tracker-App'
      }
    });

    if (getRes.ok) {
      const getData = await getRes.json();
      if (getData && getData.sha) {
        sha = getData.sha;
      }
    }
  } catch (err) {
    // File doesn't exist yet, proceed with sha = undefined
  }

  const putBody = {
    message: commitMessage,
    content: base64Content
  };
  if (sha) {
    putBody.sha = sha;
  }

  const putRes = await fetch(fileApiUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'DSA-Tracker-App'
    },
    body: JSON.stringify(putBody)
  });

  if (!putRes.ok) {
    const errText = await putRes.text();
    throw new Error(`GitHub API error (${putRes.status}): ${errText}`);
  }
}

/**
 * Pushes a single problem's files to remote GitHub repository via GitHub REST API.
 */
async function pushProblemToGithub(problemId) {
  const { data: problem, error: fetchErr } = await supabase
    .from('problems')
    .select('*')
    .eq('id', problemId)
    .single();

  if (fetchErr || !problem) {
    throw new Error(`Problem ID ${problemId} not found in database.`);
  }

  const { owner, repo } = parseRepoDetails();
  const token = process.env.GITHUB_TOKEN ? process.env.GITHUB_TOKEN.trim() : '';

  if (!token || token === 'your_github_token_here') {
    throw new Error('GITHUB_TOKEN is not configured in environment variables.');
  }

  // 1. Determine folder path
  const platformFolder = (problem.platform || 'other').toLowerCase();
  
  let topicsArr = [];
  if (Array.isArray(problem.topics)) topicsArr = problem.topics;
  else if (typeof problem.topics === 'string') {
    try { topicsArr = JSON.parse(problem.topics); } catch (_) {}
  }

  const primaryTopic = (topicsArr.length > 0 && topicsArr[0])
    ? sanitizeFilename(topicsArr[0].toLowerCase())
    : 'uncategorized';
  
  const sanitizedTitle = sanitizeFilename(problem.title);
  const relFolderPath = `${platformFolder}/${primaryTopic}/${sanitizedTitle}`;

  // 2. Prepare question.md
  const topicsStr = topicsArr.join(', ') || 'Uncategorized';
  const questionContent = `# ${problem.title}

- **Platform:** ${problem.platform}
- **Difficulty:** ${problem.difficulty || 'N/A'}
- **Topics:** ${topicsStr}
- **Original URL:** [${problem.url || problem.title}](${problem.url || '#'})

## Question Statement
${problem.question_statement || 'Refer to the original problem link above for statement details.'}
`;

  const ext = getFileExtension(problem.my_solution_language);

  // 3. Commit files remotely via GitHub API
  const commitMsg = `feat(solve): add ${problem.platform} - ${problem.title}`;

  // Write question.md
  await commitRemoteFile(owner, repo, token, `${relFolderPath}/question.md`, questionContent, commitMsg);

  // Write my_solution.{ext}
  if (problem.my_solution_code) {
    await commitRemoteFile(owner, repo, token, `${relFolderPath}/my_solution.${ext}`, problem.my_solution_code, commitMsg);
  }

  // Write optimal_solution.{ext} if present
  if (problem.optimal_solution_code) {
    const optContent = `${problem.optimal_solution_code}\n\n/*\n=== EXPLANATION ===\n${problem.optimal_solution_explanation || ''}\n*/`;
    await commitRemoteFile(owner, repo, token, `${relFolderPath}/optimal_solution.${ext}`, optContent, commitMsg);
  }

  // 4. Update problem row in Supabase
  await supabase
    .from('problems')
    .update({
      pushed_to_github: true,
      github_file_path: relFolderPath
    })
    .eq('id', problemId);

  // Log sync action
  await supabase
    .from('sync_log')
    .insert({
      platform: 'github',
      action: 'push_github',
      status: 'success',
      message: `Committed '${problem.title}' to remote GitHub at ${relFolderPath}`
    });

  console.log(`[GitHub Service] Remote commit successful for '${problem.title}' at ${relFolderPath}`);

  return {
    success: true,
    problem_id: problemId,
    path: relFolderPath
  };
}

/**
 * Pushes all unpushed problems to remote GitHub repository.
 */
async function pushAllUnpushedProblems() {
  const { data: unpushed, error } = await supabase
    .from('problems')
    .select('id, title')
    .or('pushed_to_github.is.null,pushed_to_github.eq.false')
    .order('id', { ascending: true });

  if (error || !unpushed) {
    throw new Error(`Failed to query unpushed problems: ${error?.message}`);
  }

  let count = 0;
  for (const prob of unpushed) {
    try {
      await pushProblemToGithub(prob.id);
      count++;
    } catch (pushErr) {
      console.error(`[GitHub Service] Push error for '${prob.title}':`, pushErr.message);
    }
  }

  return {
    success: true,
    count,
    message: `Pushed ${count} problem(s) to remote GitHub repository.`
  };
}

function sanitizeFilename(str) {
  return (str || 'untitled')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

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
  ensureRepoCloned,
  pushProblemToGithub,
  pushAllUnpushedProblems
};
