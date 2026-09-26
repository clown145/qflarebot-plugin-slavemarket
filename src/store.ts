import type { ScopedDB } from '@qqbot/sdk'
import type { Config } from './config.js'
import { type Player, type PlayerData, type PlayerRow, bankOf, nameOf, toPlayer } from './model.js'
import { CALENDAR_WEEK, type WeekBoundary, weekIndex } from './time.js'

/**
 * 一共两张表，都只有主键、没有二级索引（WITHOUT ROWID），写一行就只算一行：
 *
 * - {players}：每群每人一行，不按期分行。每周重置不动它，见 model.ts 的 toPlayer；
 *   active_week 是最后一次写入的自然周，清理长期不玩的人用
 * - {groups}：每群一行，记当前第几期、这一期属于第几周，以及上一期的排行榜（每次覆盖写）
 *
 * 所有查询都按主键前缀扫本群的行，只花读额度。
 */
export async function initSchema(db: ScopedDB): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS {players} (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      season INTEGER NOT NULL,
      active_week INTEGER NOT NULL,
      ver INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      currency REAL NOT NULL,
      value REAL NOT NULL,
      master TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (group_id, user_id)
    ) WITHOUT ROWID;

    CREATE TABLE IF NOT EXISTS {groups} (
      group_id TEXT PRIMARY KEY,
      season INTEGER NOT NULL,
      week INTEGER NOT NULL,
      started_at INTEGER NOT NULL,
      board TEXT
    ) WITHOUT ROWID;
  `)
}

export function resetBoundary(cfg: Config): WeekBoundary {
  return { day: cfg.reset_day, hour: cfg.reset_hour, minute: cfg.reset_minute }
}

// ─── 排行榜快照 ──────────────────────────────────────────────────────────────

export interface BoardEntry {
  id: string
  name: string
  n: number
}

export interface BankEntry {
  id: string
  name: string
  level: number
  balance: number
}

/** 一期结束时的四个榜，存在 {groups}.board，只留最近一期 */
export interface Board {
  startedAt: number
  endedAt: number
  playerCount: number
  currency: BoardEntry[]
  value: BoardEntry[]
  slaves: BoardEntry[]
  bank: BankEntry[]
}

const BOARD_SIZE = 15

async function buildBoard(db: ScopedDB, groupId: string, season: number, startedAt: number, now: number, cfg: Config): Promise<Board> {
  const rows = await db.all<PlayerRow>(
    'SELECT user_id, season, ver, nickname, currency, value, master, data FROM {players} WHERE group_id = ? AND season = ?;',
    groupId,
    season,
  )
  const players = rows.map((r) => toPlayer(r, r.user_id, season, cfg))
  const slaveCount = new Map<string, number>()
  for (const p of players) if (p.master) slaveCount.set(p.master, (slaveCount.get(p.master) ?? 0) + 1)
  const top = (key: (p: Player) => number): BoardEntry[] =>
    players
      .map((p) => ({ id: p.id, name: nameOf(p), n: key(p) }))
      .sort((a, b) => b.n - a.n)
      .slice(0, BOARD_SIZE)
  const bank = players
    .map((p) => {
      const b = bankOf(p, cfg, now)
      return { id: p.id, name: nameOf(p), level: b.level, balance: b.balance }
    })
    .sort((a, b) => b.level - a.level || b.balance - a.balance)
    .slice(0, BOARD_SIZE)
  return {
    startedAt,
    endedAt: now,
    playerCount: players.length,
    currency: top((p) => p.currency),
    value: top((p) => p.value),
    slaves: top((p) => slaveCount.get(p.id) ?? 0).filter((e) => e.n > 0),
    bank,
  }
}

// ─── 群与期 ──────────────────────────────────────────────────────────────────

export interface GroupState {
  season: number
  /** 这一期属于第几周（按重置时刻切的周） */
  week: number
  startedAt: number
  /** {groups} 里有没有这一行；没有时第一次写入前先补上 */
  exists: boolean
  board: Board | null
}

interface GroupRow {
  season: number
  week: number
  started_at: number
  board: string | null
}

function parseBoard(s: string | null): Board | null {
  if (!s) return null
  try {
    return JSON.parse(s) as Board
  } catch {
    return null
  }
}

async function readGroup(db: ScopedDB, groupId: string): Promise<GroupRow | null> {
  return db.first<GroupRow>('SELECT season, week, started_at, board FROM {groups} WHERE group_id = ?;', groupId)
}

function stateOf(row: GroupRow): GroupState {
  return { season: row.season, week: row.week, startedAt: row.started_at, exists: true, board: parseBoard(row.board) }
}

/**
 * 进入新的一期：把上一期的四个榜算好，和新期号一起写进群的那一行——每群每期只写这 1 行，
 * 玩家行一行不动。带 `season = 旧期号` 条件，几个 isolate 同时进来只有一个写得进去
 */
async function advance(
  db: ScopedDB,
  groupId: string,
  row: GroupRow,
  week: number,
  now: number,
  cfg: Config,
): Promise<{ state: GroupState; board: Board | null }> {
  const board = await buildBoard(db, groupId, row.season, row.started_at, now, cfg)
  const res = await db.run(
    'UPDATE {groups} SET season = season + 1, week = ?, started_at = ?, board = ? WHERE group_id = ? AND season = ?;',
    week,
    now,
    JSON.stringify(board),
    groupId,
    row.season,
  )
  if (res.changes > 0) {
    return { state: { season: row.season + 1, week, startedAt: now, exists: true, board }, board }
  }
  // 别的 isolate 抢先换了期
  const fresh = await readGroup(db, groupId)
  return { state: fresh ? stateOf(fresh) : { season: row.season + 1, week, startedAt: now, exists: false, board: null }, board: null }
}

/**
 * 每条命令先看一眼本群在第几期（读 1 行）。到了重置时刻就换期，返回的 `advanced` 是刚结束那一期的榜，
 * 附在这条命令的回复里——走被动回复，不需要群主开主动消息权限
 */
export async function loadSeason(
  db: ScopedDB,
  groupId: string,
  now: number,
  cfg: Config,
): Promise<{ state: GroupState; advanced: Board | null }> {
  const week = weekIndex(now, resetBoundary(cfg))
  const row = await readGroup(db, groupId)
  if (!row) return { state: { season: 1, week, startedAt: now, exists: false, board: null }, advanced: null }
  if (cfg.weekly_reset_enabled && week > row.week) {
    const { state, board } = await advance(db, groupId, row, week, now, cfg)
    return { state, advanced: board }
  }
  return { state: stateOf(row), advanced: null }
}

/** 手动重置本群：同一条换期语句，周不变。`expectSeason` 不是当前期（按钮点晚了、别人已经重置过）就不动 */
export async function manualReset(
  db: ScopedDB,
  groupId: string,
  expectSeason: number,
  now: number,
  cfg: Config,
): Promise<Board | null> {
  const row = await readGroup(db, groupId)
  const week = weekIndex(now, resetBoundary(cfg))
  if (!row) {
    if (expectSeason !== 1) return null
    // 从没写过数据的群：先落一行，再按正常流程换期
    await ensureGroupRow(db, groupId, { season: 1, week, startedAt: now, exists: false, board: null })
    return manualReset(db, groupId, expectSeason, now, cfg)
  }
  if (row.season !== expectSeason) return null
  const { board } = await advance(db, groupId, row, row.week > week ? row.week : week, now, cfg)
  return board
}

async function ensureGroupRow(db: ScopedDB, groupId: string, state: GroupState): Promise<void> {
  await db.run(
    'INSERT OR IGNORE INTO {groups} (group_id, season, week, started_at) VALUES (?, ?, ?, ?);',
    groupId,
    state.season,
    state.week,
    state.startedAt,
  )
  state.exists = true
}

// ─── 玩家 ────────────────────────────────────────────────────────────────────

const PLAYER_COLUMNS = 'user_id, season, ver, nickname, currency, value, master, data'

export async function loadPlayers(db: ScopedDB, groupId: string, ids: string[], season: number, cfg: Config): Promise<Map<string, Player>> {
  const unique = [...new Set(ids)]
  const out = new Map<string, Player>()
  // 参数上限 100：分批
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90)
    const rows = await db.all<PlayerRow>(
      `SELECT ${PLAYER_COLUMNS} FROM {players} WHERE group_id = ? AND user_id IN (${chunk.map(() => '?').join(', ')});`,
      groupId,
      ...chunk,
    )
    const byId = new Map(rows.map((r) => [r.user_id, r]))
    for (const id of chunk) out.set(id, toPlayer(byId.get(id), id, season, cfg))
  }
  return out
}

/** 本群所有人（市场、排行榜、抢劫随机目标）：旧一期的行照样按刚重置过算 */
export async function loadGroupPlayers(db: ScopedDB, groupId: string, season: number, cfg: Config): Promise<Player[]> {
  const rows = await db.all<PlayerRow>(`SELECT ${PLAYER_COLUMNS} FROM {players} WHERE group_id = ?;`, groupId)
  return rows.map((r) => toPlayer(r, r.user_id, season, cfg))
}

/** 某人这一期的奴隶，按买下的先后排：序号就是「我的奴隶」里的编号 */
export async function loadSlaves(db: ScopedDB, groupId: string, masterId: string, season: number, cfg: Config): Promise<Player[]> {
  const rows = await db.all<PlayerRow>(
    `SELECT ${PLAYER_COLUMNS} FROM {players} WHERE group_id = ? AND season = ? AND master = ?;`,
    groupId,
    season,
    masterId,
  )
  return rows
    .map((r) => toPlayer(r, r.user_id, season, cfg))
    .sort((a, b) => (a.data.boughtAt ?? 0) - (b.data.boughtAt ?? 0) || a.id.localeCompare(b.id))
}

/** 每条语句最多几个人：3 个公共参数 + 每人 8 个，D1 绑定参数上限 100 */
const PER_STATEMENT = 12

/**
 * 把改过的人写回去。一条语句写一批，带版本号校验：读完之后这批里任何一行被别人改过（或者本来没有、
 * 别人先插进来了），整条一行都不写，返回 false 由调用方重读重算。没有的行直接插入（UPSERT），不单独建。
 * 超过 PER_STATEMENT 人时分几条，各条之间不是原子的
 */
export async function savePlayers(db: ScopedDB, groupId: string, group: GroupState, players: Player[], now: number): Promise<boolean> {
  if (!players.length) return true
  if (!group.exists) await ensureGroupRow(db, groupId, group)
  const activeWeek = weekIndex(now, CALENDAR_WEEK)
  for (let i = 0; i < players.length; i += PER_STATEMENT) {
    const chunk = players.slice(i, i + PER_STATEMENT)
    const params: unknown[] = [groupId, group.season, activeWeek]
    const rows: string[] = []
    const guards: string[] = []
    for (const p of chunk) {
      const base = params.length
      params.push(p.id, p.ver + 1, p.nickname, p.currency, p.value, p.master, JSON.stringify(compact(p.data)), p.ver)
      const n = (k: number) => `?${base + k}`
      rows.push(`(${n(1)}, ${n(2)}, ${n(3)}, ${n(4)}, ${n(5)}, ${n(6)}, ${n(7)})`)
      guards.push(`COALESCE((SELECT ver FROM {players} WHERE group_id = ?1 AND user_id = ${n(1)}), 0) = ${n(8)}`)
    }
    const res = await db.run(
      `WITH v AS (VALUES ${rows.join(', ')})
       INSERT INTO {players} (group_id, user_id, season, active_week, ver, nickname, currency, value, master, data)
       SELECT ?1, column1, ?2, ?3, column2, column3, column4, column5, column6, column7 FROM v
       WHERE ${guards.join(' AND ')}
       ON CONFLICT (group_id, user_id) DO UPDATE SET
         season = excluded.season, active_week = excluded.active_week, ver = excluded.ver, nickname = excluded.nickname,
         currency = excluded.currency, value = excluded.value, master = excluded.master, data = excluded.data;`,
      ...params,
    )
    if (res.changes === 0) return false
    for (const p of chunk) p.ver += 1
  }
  return true
}

/** 去掉 undefined 的键，JSON 短一点 */
function compact(data: PlayerData): PlayerData {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) as PlayerData
}

/** 退群：放掉他的奴隶、删掉他那一行 */
export async function removeMember(db: ScopedDB, groupId: string, userId: string): Promise<void> {
  await db.run("UPDATE {players} SET master = '', ver = ver + 1 WHERE group_id = ? AND master = ?;", groupId, userId)
  await db.run('DELETE FROM {players} WHERE group_id = ? AND user_id = ?;', groupId, userId)
}

/**
 * 清理长期不玩的数据：`weeks` 个自然周没有任何写入的玩家行（每周重置开着时它们早就过期了），
 * 以及已经没有玩家的群。每行一辈子只会被删一次；没有索引，扫描只花读额度
 */
export async function prune(db: ScopedDB, now: number, weeks: number): Promise<{ players: number; groups: number }> {
  const before = weekIndex(now, CALENDAR_WEEK) - weeks
  const players = await db.run('DELETE FROM {players} WHERE active_week < ?;', before)
  const groups = await db.run(
    'DELETE FROM {groups} WHERE NOT EXISTS (SELECT 1 FROM {players} p WHERE p.group_id = {groups}.group_id);',
  )
  return { players: players.changes, groups: groups.changes }
}
