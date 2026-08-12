# DSA Tracker

A local coding-practice tracker application for tracking Data Structures and Algorithms (DSA) problem-solving progress, revision schedules, and solutions.

## Features & Tech Stack

- **Backend**: Node.js, Express, `better-sqlite3` (SQLite database stored at `server/data/tracker.db`)
- **Frontend**: Plain HTML, CSS, and JavaScript served statically from the `public/` directory
- **Config**: Environment settings managed via `.env` file

## Getting Started

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Environment Setup**:
   Copy `.env.example` to `.env` and fill in your GitHub details if needed:
   ```bash
   cp .env.example .env
   ```

3. **Development Server**:
   Run the development server with auto-reload:
   ```bash
   npm run dev
   ```

4. **Production Server**:
   Start the standard production Node process:
   ```bash
   npm start
   ```

The server runs at [http://localhost:4545](http://localhost:4545).
Check server health at `http://localhost:4545/api/health`.
