-- Schema for DSA Tracker database

CREATE TABLE IF NOT EXISTS problems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    platform_problem_id TEXT NOT NULL,
    title TEXT NOT NULL,
    url TEXT,
    difficulty TEXT,
    topics TEXT, -- JSON array string, e.g. ["Array","Two Pointers"]
    question_statement TEXT,
    my_solution_code TEXT,
    my_solution_language TEXT,
    optimal_solution_code TEXT,
    optimal_solution_explanation TEXT,
    solved_at DATETIME,
    pushed_to_github INTEGER DEFAULT 0,
    github_file_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(platform, platform_problem_id)
);

CREATE TABLE IF NOT EXISTS topics_master (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT,
    action TEXT CHECK(action IN ('fetch', 'push')),
    status TEXT CHECK(status IN ('success', 'error')),
    message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
