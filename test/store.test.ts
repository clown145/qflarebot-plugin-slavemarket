import { beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '../src/config.js'
import { loadPlayers, loadSeason, initSchema, manualReset, prune, removeMember, savePlayers, type GroupState } from '../src/store.js'
import { CALENDAR_WEEK, weekIndex, weekStart } from '../src/time.js'
import { createSqliteDB, type TestDB } from './sqlite.js'

const cfg = { ...defaultConfig }
const G = 'GROUP1'
const DAY = 86400000
/** 2026-09-23 周三 12:00 北京时间 */
const WED = Date.UTC(2026, 8, 23, 4, 0, 0)

let db: TestDB
beforeEach(async () => {
  db = createSqliteDB()
  await initSchema(db)
})

async function group(now = WED): Promise<GroupState> {
  return (await loadSeason(db, G, now, cfg)).state
}

describe('周序号', () => {
  it('按北京时间的周一 0 点切', () => {
    const mondayMidnight = Date.UTC(2026, 8, 27, 16, 0, 0) // 北京 9/28 周一 00:00
    expect(weekIndex(mondayMidnight - 1, CALENDAR_WEEK) + 1).toBe(weekIndex(mondayMidnight, CALENDAR_WEEK))
    expect(weekStart(weekIndex(mondayMidnight, CALENDAR_WEEK), CALENDAR_WEEK)).toBe(mondayMidnight)
    // 周日 20:30 切
    const b = { day: 0, hour: 20, minute: 30 }
    const sunday = Date.UTC(2026, 8, 27, 12, 30, 0) // 北京 9/27 周日 20:30
    expect(weekIndex(sunday - 1, b) + 1).toBe(weekIndex(sunday, b))
  })
})

describe('savePlayers', () => {
  it('没有的行直接插入，有的行更新，一条语句写多个人', async () => {
    const g = await group()
    const ps = await loadPlayers(db, G, ['a', 'b'], g.season, cfg)
    ps.get('a')!.currency = 10
    ps.get('b')!.currency = 20
    expect(await savePlayers(db, G, g, [...ps.values()], WED)).toBe(true)
    const again = await loadPlayers(db, G, ['a', 'b'], g.season, cfg)
    expect(again.get('a')!.currency).toBe(10)
    expect(again.get('b')!.ver).toBe(1)

    again.get('a')!.currency = 11
    again.get('b')!.currency = 21
    expect(await savePlayers(db, G, g, [...again.values()], WED)).toBe(true)
    const third = await loadPlayers(db, G, ['a', 'b'], g.season, cfg)
    // 两行都写进去了：前一行写完不会让后一行的版本校验失败
    expect(third.get('a')!.currency).toBe(11)
    expect(third.get('b')!.currency).toBe(21)
  })

  it('读完之后有人改过其中一行，整条一行都不写', async () => {
    const g = await group()
    const first = await loadPlayers(db, G, ['a', 'b'], g.season, cfg)
    await savePlayers(db, G, g, [...first.values()], WED)

    const mine = await loadPlayers(db, G, ['a', 'b'], g.season, cfg)
    const theirs = await loadPlayers(db, G, ['b'], g.season, cfg)
    theirs.get('b')!.currency = 999
    await savePlayers(db, G, g, [theirs.get('b')!], WED)

    mine.get('a')!.currency = 1
    mine.get('b')!.currency = 1
    expect(await savePlayers(db, G, g, [...mine.values()], WED)).toBe(false)
    const now = await loadPlayers(db, G, ['a', 'b'], g.season, cfg)
    expect(now.get('a')!.currency).toBe(0)
    expect(now.get('b')!.currency).toBe(999)
  })

  it('别人先插入了本来没有的行，也算冲突', async () => {
    const g = await group()
    const mine = await loadPlayers(db, G, ['a'], g.season, cfg)
    const theirs = await loadPlayers(db, G, ['a'], g.season, cfg)
    theirs.get('a')!.currency = 5
    await savePlayers(db, G, g, [theirs.get('a')!], WED)
    mine.get('a')!.currency = 7
    expect(await savePlayers(db, G, g, [mine.get('a')!], WED)).toBe(false)
  })

  it('超过一条语句的人数时分批写', async () => {
    const g = await group()
    const ids = Array.from({ length: 30 }, (_, i) => `u${i}`)
    const ps = await loadPlayers(db, G, ids, g.season, cfg)
    for (const p of ps.values()) p.currency = 3
    expect(await savePlayers(db, G, g, [...ps.values()], WED)).toBe(true)
    const rows = db.sqlite.prepare('SELECT COUNT(*) AS n FROM p_slavemarket_players WHERE currency = 3').get() as { n: number }
    expect(rows.n).toBe(30)
  })
})

describe('每周重置', () => {
  it('跨周后第一次读换期，玩家行一行不动，旧数据按刚重置过算', async () => {
    const g = await group()
    const ps = await loadPlayers(db, G, ['a'], g.season, cfg)
    ps.get('a')!.currency = 500
    ps.get('a')!.nickname = '小明'
    await savePlayers(db, G, g, [ps.get('a')!], WED)

    const written = db.rowsWritten
    const next = await loadSeason(db, G, WED + 7 * DAY, cfg)
    expect(next.advanced?.currency[0]).toMatchObject({ id: 'a', name: '小明', n: 500 })
    expect(next.state.season).toBe(2)
    // 只写了群那一行
    expect(db.rowsWritten - written).toBe(1)

    const after = await loadPlayers(db, G, ['a'], next.state.season, cfg)
    expect(after.get('a')!.currency).toBe(0)
    expect(after.get('a')!.nickname).toBe('小明')

    // 同一周里再读不会再换
    expect((await loadSeason(db, G, WED + 7 * DAY + 1000, cfg)).advanced).toBeNull()
  })

  it('关掉每周重置就不换期', async () => {
    const g = await group()
    await savePlayers(db, G, g, [...(await loadPlayers(db, G, ['a'], g.season, cfg)).values()], WED)
    const off = { ...cfg, weekly_reset_enabled: false }
    expect((await loadSeason(db, G, WED + 14 * DAY, off)).state.season).toBe(1)
  })

  it('手动重置只认当前期号，按钮点第二次不会再清一遍', async () => {
    const g = await group()
    await savePlayers(db, G, g, [...(await loadPlayers(db, G, ['a'], g.season, cfg)).values()], WED)
    expect(await manualReset(db, G, 1, WED, cfg)).not.toBeNull()
    expect(await manualReset(db, G, 1, WED, cfg)).toBeNull()
    expect((await group()).season).toBe(2)
  })
})

describe('清理', () => {
  it('删掉几周没写过的人，以及已经没人的群', async () => {
    const old = WED - 6 * 7 * DAY
    const g1 = (await loadSeason(db, 'OLD', old, cfg)).state
    await savePlayers(db, 'OLD', g1, [...(await loadPlayers(db, 'OLD', ['x'], g1.season, cfg)).values()], old)
    const g2 = await group()
    await savePlayers(db, G, g2, [...(await loadPlayers(db, G, ['a'], g2.season, cfg)).values()], WED)

    expect(await prune(db, WED, 4)).toEqual({ players: 1, groups: 1 })
    expect(await prune(db, WED, 4)).toEqual({ players: 0, groups: 0 })
    expect((await loadPlayers(db, G, ['a'], 1, cfg)).get('a')!.ver).toBe(1)
  })

  it('退群放掉他的奴隶', async () => {
    const g = await group()
    const ps = await loadPlayers(db, G, ['m', 's'], g.season, cfg)
    ps.get('s')!.master = 'm'
    await savePlayers(db, G, g, [...ps.values()], WED)
    await removeMember(db, G, 'm')
    const after = await loadPlayers(db, G, ['m', 's'], g.season, cfg)
    expect(after.get('s')!.master).toBe('')
    expect(after.get('m')!.ver).toBe(0)
  })
})
