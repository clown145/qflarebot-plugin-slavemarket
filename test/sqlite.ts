import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { ScopedDB } from '@qqbot/sdk'
// 与线上同一套表名检查：线上会被拦下的 SQL，这里一样抛错（QFlareBot 与插件仓库并排放，CI 也是这个布局）
import { flattenForExec, scopeSql, tablePrefix } from '../../QFlareBot/packages/runtime/src/sqlScope.js'

export interface TestDB extends ScopedDB {
  sqlite: DatabaseSync
  /** 所有写语句改动的行数之和（不含索引，这两张表也没有索引） */
  rowsWritten: number
}

/** 用真的 SQLite 跑插件的 SQL：UPSERT、CTE、json、RETURNING 的语义和 D1 一致 */
export function createSqliteDB(plugin = 'slavemarket'): TestDB {
  const sqlite = new DatabaseSync(':memory:')
  const prefix = tablePrefix(plugin)
  const scope = (sql: string) => scopeSql(sql, prefix)
  const db: TestDB = {
    sqlite,
    rowsWritten: 0,
    table: (n) => prefix + n,
    async exec(sql) {
      const flat = flattenForExec(scope(sql))
      if (flat.trim()) sqlite.exec(flat)
    },
    async run(sql, ...params) {
      const r = sqlite.prepare(scope(sql)).run(...(params as SQLInputValue[]))
      db.rowsWritten += Number(r.changes)
      return { changes: Number(r.changes) }
    },
    async all<T>(sql: string, ...params: unknown[]) {
      return sqlite.prepare(scope(sql)).all(...(params as SQLInputValue[])) as T[]
    },
    async first<T>(sql: string, ...params: unknown[]) {
      return (sqlite.prepare(scope(sql)).get(...(params as SQLInputValue[])) as T | undefined) ?? null
    },
  }
  return db
}
