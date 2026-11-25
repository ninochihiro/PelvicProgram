import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

function mapUser(row) {
  if (!row) return null
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    salt: row.salt,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at
  }
}

function mapTrainingResult(row) {
  if (!row) return null
  let details = []
  try {
    details = JSON.parse(row.details_json || '[]')
  } catch {
    details = []
  }
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    displayName: row.display_name,
    module: row.module,
    score: row.score,
    correctCount: row.correct_count,
    wrongCount: row.wrong_count,
    totalCount: row.total_count,
    details,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at
  }
}

export class PelvicDatabase {
  constructor(filePath) {
    if (filePath !== ':memory:') {
      mkdirSync(path.dirname(filePath), { recursive: true })
    }
    this.db = new DatabaseSync(filePath)
  }

  initialize() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_login_at TEXT
      );

      CREATE TABLE IF NOT EXISTS training_results (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module TEXT NOT NULL,
        score REAL NOT NULL,
        correct_count INTEGER NOT NULL DEFAULT 0,
        wrong_count INTEGER NOT NULL DEFAULT 0,
        total_count INTEGER NOT NULL DEFAULT 0,
        details_json TEXT NOT NULL DEFAULT '[]',
        started_at TEXT,
        completed_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_training_results_user
        ON training_results(user_id, completed_at DESC);

      CREATE INDEX IF NOT EXISTS idx_training_results_completed
        ON training_results(completed_at DESC);
    `)
  }

  loadUsers() {
    return this.db
      .prepare(
        `SELECT *
         FROM users
         ORDER BY username COLLATE NOCASE ASC`
      )
      .all()
      .map(mapUser)
  }

  replaceUsers(users) {
    const upsert = this.db.prepare(`
      INSERT INTO users (
        id, username, display_name, role, salt, password_hash,
        created_at, updated_at, last_login_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        display_name = excluded.display_name,
        role = excluded.role,
        salt = excluded.salt,
        password_hash = excluded.password_hash,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        last_login_at = excluded.last_login_at
    `)
    const deleteUser = this.db.prepare('DELETE FROM users WHERE id = ?')
    const desiredIds = new Set(users.map((user) => user.id))

    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of this.db.prepare('SELECT id FROM users').all()) {
        if (!desiredIds.has(row.id)) deleteUser.run(row.id)
      }
      for (const user of users) {
        upsert.run(
          user.id,
          user.username,
          user.displayName,
          user.role,
          user.salt,
          user.passwordHash,
          user.createdAt,
          user.updatedAt,
          user.lastLoginAt ?? null
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  createTrainingResult({
    id = randomBytes(16).toString('hex'),
    userId,
    module,
    score,
    correctCount,
    wrongCount,
    totalCount,
    details,
    startedAt,
    completedAt
  }) {
    const createdAt = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO training_results (
          id, user_id, module, score, correct_count, wrong_count,
          total_count, details_json, started_at, completed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        module,
        score,
        correctCount,
        wrongCount,
        totalCount,
        JSON.stringify(details ?? []),
        startedAt ?? null,
        completedAt,
        createdAt
      )
    return this.getTrainingResult(id)
  }

  getTrainingResult(id) {
    return mapTrainingResult(
      this.db
        .prepare(
          `SELECT result.*, user.username, user.display_name
           FROM training_results result
           JOIN users user ON user.id = result.user_id
           WHERE result.id = ?`
        )
        .get(id)
    )
  }

  listTrainingResults({ userId = null, limit = 200 } = {}) {
    const safeLimit = Math.min(500, Math.max(1, Number(limit) || 200))
    const rows = userId
      ? this.db
          .prepare(
            `SELECT result.*, user.username, user.display_name
             FROM training_results result
             JOIN users user ON user.id = result.user_id
             WHERE result.user_id = ?
             ORDER BY result.completed_at DESC
             LIMIT ?`
          )
          .all(userId, safeLimit)
      : this.db
          .prepare(
            `SELECT result.*, user.username, user.display_name
             FROM training_results result
             JOIN users user ON user.id = result.user_id
             ORDER BY result.completed_at DESC
             LIMIT ?`
          )
          .all(safeLimit)
    return rows.map(mapTrainingResult)
  }

  close() {
    this.db.close()
  }
}
