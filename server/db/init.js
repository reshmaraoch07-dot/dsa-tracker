const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Ensure server/data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'tracker.db');
const db = new Database(dbPath);

// Enable WAL mode for performance & foreign keys
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  // Execute schema SQL commands
  db.exec(schemaSql);

  // Default topics for topics_master
  const defaultTopics = [
    'Array',
    'String',
    'Linked List',
    'Stack',
    'Queue',
    'Tree',
    'Binary Search Tree',
    'Heap',
    'Graph',
    'Dynamic Programming',
    'Greedy',
    'Backtracking',
    'Trie',
    'Bit Manipulation',
    'Sliding Window',
    'Two Pointers',
    'Math',
    'Recursion',
    'Sorting',
    'Binary Search',
    'Union Find',
    'Segment Tree'
  ];

  const insertTopic = db.prepare('INSERT OR IGNORE INTO topics_master (name) VALUES (?)');
  const insertMany = db.transaction((topics) => {
    for (const topic of topics) {
      insertTopic.run(topic);
    }
  });

  insertMany(defaultTopics);
  console.log('[Database] Schema initialized & topics_master pre-populated.');
  return db;
}

// Automatically initialize database on module require
initDatabase();

module.exports = db;
