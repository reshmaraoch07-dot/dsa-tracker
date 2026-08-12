-- PostgreSQL / Supabase Schema for DSA Tracker

-- 1. Problems table
CREATE TABLE IF NOT EXISTS problems (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_problem_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  difficulty TEXT,
  topics JSONB DEFAULT '[]'::jsonb,
  question_statement TEXT,
  my_solution_code TEXT,
  my_solution_language TEXT,
  optimal_solution_code TEXT,
  optimal_solution_explanation TEXT,
  solved_at TIMESTAMPTZ DEFAULT NOW(),
  pushed_to_github BOOLEAN DEFAULT FALSE,
  github_file_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_platform_problem UNIQUE (platform, platform_problem_id)
);

-- 2. Master topics list
CREATE TABLE IF NOT EXISTS topics_master (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

-- Pre-populate default topics
INSERT INTO topics_master (name) VALUES
  ('Array'), ('String'), ('Hash Table'), ('Two Pointers'), ('Binary Search'),
  ('Sliding Window'), ('Stack'), ('Queue'), ('Linked List'), ('Tree'),
  ('Binary Search Tree'), ('Heap'), ('Graph'), ('Breadth-First Search'),
  ('Depth-First Search'), ('Dynamic Programming'), ('Greedy'), ('Backtracking'),
  ('Bit Manipulation'), ('Union Find'), ('Trie'), ('Segment Tree'),
  ('Math'), ('Recursion'), ('Sorting'), ('Matrix')
ON CONFLICT (name) DO NOTHING;

-- 3. Settings table (Key-Value Store)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- 4. Sync execution log
CREATE TABLE IF NOT EXISTS sync_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform TEXT,
  action TEXT,
  status TEXT,
  message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
