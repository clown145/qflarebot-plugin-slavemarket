import { runButton, runCommand, type MockSession } from '@qqbot/sdk/testing'
import type { OutgoingMessage } from '@qqbot/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import plugin from '../src/index.js'
import { type Config, defaultConfig } from '../src/config.js'
import { initSchema, loadPlayers, loadSeason } from '../src/store.js'
import { createSqliteDB, type TestDB } from './sqlite.js'

const G = 'GROUP1'
const HOUR = 3600000
const DAY = 24 * HOUR
/** 2026-09-23 周三 12:00 北京时间 */
const WED = Date.UTC(2026, 8, 23, 4, 0, 0)

let db: TestDB
let config: Config
let services: Record<string, unknown>

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(WED)
  db = createSqliteDB()
  await initSchema(db)
  config = { ...defaultConfig }
  services = {}
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

interface Who {
  id: string
  name?: string
  role?: 'owner' | 'admin' | 'member'
  /** 被 @ 的人，按顺序 */
  at?: Array<{ id: string; name?: string }>
}

async function cmd(command: string, args = '', who: Who = { id: 'alice', name: '爱丽丝' }): Promise<MockSession> {
  const at = who.at ?? []
  return runCommand(plugin, command, args, {
    session: {
      targetId: G,
      userId: who.id,
      userName: who.name ?? who.id,
      ...(who.role ? { memberRole: who.role } : {}),
      mentions: at.map((m) => ({ id: m.id, username: m.name ?? m.id, bot: false })),
      // 机器人自己的 <@…> 不在 mentions 里，不能被当成目标
      raw: { content: `<@BOT> /${command} ${args} ${at.map((m) => `<@${m.id}>`).join(' ')}` },
    },
    ctx: { db, config, services },
  })
}

function text(s: MockSession): string {
  return s.replies.map((r: OutgoingMessage) => (typeof r === 'string' ? r : (r.text ?? r.markdown?.content ?? JSON.stringify(r)))).join('\n---\n')
}

async function player(id: string) {
  const { state } = await loadSeason(db, G, Date.now(), config)
  return (await loadPlayers(db, G, [id], state.season, config)).get(id)!
}

/** 直接改库给某人发钱（当前这一期），省得在测试里一遍遍打工 */
async function give(id: string, currency: number, name = id) {
  const now = Date.now()
  const { state } = await loadSeason(db, G, now, config)
  if (!state.exists) {
    db.sqlite.prepare('INSERT INTO p_slavemarket_groups (group_id, season, week, started_at) VALUES (?, ?, ?, ?)').run(G, state.season, state.week, now)
  }
  db.sqlite
    .prepare(
      `INSERT INTO p_slavemarket_players (group_id, user_id, season, active_week, ver, nickname, currency, value, master, data)
       VALUES (?, ?, ?, 0, 1, ?, ?, 100, '', '{}')
       ON CONFLICT (group_id, user_id) DO UPDATE SET currency = excluded.currency, ver = ver + 1,
         season = excluded.season,
         value = CASE WHEN season = excluded.season THEN value ELSE 100 END,
         master = CASE WHEN season = excluded.season THEN master ELSE '' END,
         data = CASE WHEN season = excluded.season THEN data ELSE '{}' END`,
    )
    .run(G, id, state.season, name, currency)
}

describe('基本流程', () => {
  it('私聊里不能玩', async () => {
    const s = await runCommand(plugin, '打工', '', { session: { scene: 'c2c' }, ctx: { db, config } })
    expect(text(s)).toBe('该游戏只能在群内使用')
  })

  it('没奴隶时自己打工，冷却内再打工提示剩余时间，且不写库', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const s = await cmd('打工')
    expect(text(s)).toContain('你没有群友只能自己去打工')
    expect((await player('alice')).currency).toBe(15) // 10 + floor(100/20)

    const written = db.rowsWritten
    expect(text(await cmd('打工'))).toBe('每1小时一次，剩余CD：1时0分0秒')
    expect(db.rowsWritten).toBe(written)
  })

  it('查看类命令不写库', async () => {
    await give('alice', 100)
    const written = db.rowsWritten
    for (const c of ['我的奴隶', '奴隶市场', '银行信息', '排位赛', '奴隶身价排行榜', '奴隶资金排行榜', '上周排行榜', '奴隶重置状态', '奴隶帮助']) {
      await cmd(c)
    }
    expect(db.rowsWritten).toBe(written)
  })
})

describe('买卖', () => {
  it('@ 群友购买；再被别人从手里买走时原主人得钱、被买的人只得十分之一', async () => {
    await give('alice', 1000)
    await give('carol', 1000)
    const bought = await cmd('购买奴隶', '', { id: 'alice', name: '爱丽丝', at: [{ id: 'bob', name: '鲍勃' }] })
    expect(text(bought)).toContain('成功购买了鲍勃！花费了100.00金币')
    expect((await player('bob')).master).toBe('alice')
    expect((await player('bob')).value).toBe(120)

    const stolen = await cmd('购买奴隶', '', { id: 'carol', name: '卡罗尔', at: [{ id: 'bob', name: '鲍勃' }] })
    expect(text(stolen)).toContain('成功从爱丽丝那里购买了鲍勃')
    const bob = await player('bob')
    expect(bob.master).toBe('carol')
    expect(bob.currency).toBe(100 + 12) // 第一次自由身卖了 100，第二次得 120 的十分之一
    expect((await player('alice')).currency).toBe(1000 - 100 + 120)
    expect((await player('carol')).currency).toBe(1000 - 120)
  })

  it('群消息真实的 mentions 形状：member_openid / nickname，@ 机器人的那项 is_you（旧版框架的 session.mentions 是空 id）', async () => {
    await give('C3C941CFA01119A4A1373CC51055C2A3', 1000, '随风潜入夜')
    const s = await runCommand(plugin, '购买奴隶', '', {
      session: {
        targetId: G,
        userId: 'C3C941CFA01119A4A1373CC51055C2A3',
        userName: '随风潜入夜',
        // 旧版框架只读 id / username，群里拿到的就是这样
        mentions: [
          { id: '', username: '', bot: false },
          { id: '', username: '', bot: false },
        ],
        raw: {
          content: '<@0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F> /购买奴隶 <@A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1>',
          mentions: [
            { scope: 'single', member_openid: '0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F', nickname: '机器人', is_you: true },
            { scope: 'single', member_openid: 'A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1', nickname: '小明', bot: false, is_you: false },
          ],
        },
      },
      ctx: { db, config, services },
    })
    expect(text(s)).toContain('成功购买了小明！')
    expect((await player('A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1')).master).toBe('C3C941CFA01119A4A1373CC51055C2A3')
  })

  describe('没开全量消息的群：被 @ 的群友只在正文里', () => {
    const ME = 'C3C941CFA01119A4A1373CC51055C2A3'
    const BOT = '0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F0F'
    const TARGET = 'A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1'
    const buy = (content: string, mentions?: unknown[]) =>
      runCommand(plugin, '购买奴隶', '', {
        session: { targetId: G, userId: ME, userName: '随风潜入夜', mentions: [], raw: { content, ...(mentions ? { mentions } : {}) } },
        ctx: { db, config, services },
      })

    it('mentions 一项都没有：认正文里命令后面的 <@…>，命令前面那个当作在叫机器人', async () => {
      await give(ME, 1000)
      expect(text(await buy(`<@${BOT}> 购买奴隶 <@${TARGET}>`))).toContain('成功购买了群友A1A1！')
      expect((await player(TARGET)).master).toBe(ME)
    })

    it('mentions 里只有 @ 机器人那一项', async () => {
      await give(ME, 1000)
      const reply = text(await buy(`<@${BOT}> /购买奴隶 <@${TARGET}>`, [{ id: BOT, username: '机器人', bot: true, is_you: true }]))
      expect(reply).toContain('成功购买了群友A1A1！')
    })

    it('只 @ 了机器人：不会把机器人当成目标', async () => {
      await give(ME, 1000)
      expect(text(await buy(`<@${BOT}> 购买奴隶`))).toContain('请 @ 要购买的群友')
    })
  })

  it('按市场编号购买；不能买自己、不能买自己的主人', async () => {
    await give('alice', 1000)
    await give('bob', 0)
    // 市场按身价排，都是 100 时按 openid：alice、bob
    expect(text(await cmd('购买奴隶', '1'))).toBe('不可以购买自己捏~')
    expect(text(await cmd('购买奴隶', '2'))).toContain('成功购买了bob')

    await give('bob', 1000)
    vi.setSystemTime(WED + 2 * HOUR)
    const reply = text(await cmd('购买奴隶', '', { id: 'bob', at: [{ id: 'alice' }] }))
    expect(reply).not.toContain('成功')
  })

  it('我的奴隶按买下的先后编号，序号能直接用', async () => {
    await give('alice', 10000)
    for (const [i, id] of ['s1', 's2'].entries()) {
      vi.setSystemTime(WED + i * 2 * HOUR)
      await cmd('购买奴隶', '', { id: 'alice', at: [{ id, name: id.toUpperCase() }] })
    }
    const list = text(await cmd('我的奴隶'))
    expect(list).toMatch(/1\. S1[\s\S]*2\. S2/)
    expect(text(await cmd('放生奴隶', '2'))).toBe('成功放生了S2')
    expect((await player('s2')).master).toBe('')
  })

  it('赎身：两倍身价，身价 ×1.2，交税；次数按自然周清零', async () => {
    await give('alice', 1000)
    await cmd('购买奴隶', '', { id: 'alice', at: [{ id: 'bob' }] })
    await give('bob', 1000)
    const s = await cmd('赎身', '', { id: 'bob' })
    // 身价 120，赎身价 240；(1000 - 240) × 5% = 38
    expect(s.replies[0]).toBe('你支付了38金币的税收')
    expect(s.replies[1]).toContain('现在你的身价是144金币')
    expect((await player('bob')).master).toBe('')
    expect((await player('alice')).currency).toBe(1000 - 100 + 240)

    // 冷却一天；同一周里第 4 次被拦下
    for (let i = 1; i <= 3; i++) {
      vi.setSystemTime(WED + i * 25 * HOUR)
      expect(text(await cmd('购买奴隶', '', { id: 'alice', at: [{ id: 'bob' }] }))).toContain('成功购买')
      await give('bob', 100000)
      if (i < 3) expect(text(await cmd('赎身', '', { id: 'bob' }))).toContain('成功以')
    }
    expect(text(await cmd('赎身', '', { id: 'bob' }))).toBe('本周赎身次数已达上限，请下周再试')
    // 下周一次数清零（跨周同时换期，要重新被买）
    vi.setSystemTime(Date.UTC(2026, 8, 27, 16, 0, 1))
    await give('alice', 100000)
    await cmd('购买奴隶', '', { id: 'alice', at: [{ id: 'bob' }] })
    await give('bob', 100000)
    expect(text(await cmd('赎身', '', { id: 'bob' }))).toContain('成功以')
  })
})

describe('银行', () => {
  it('新存进去的钱从存入时起算利息', async () => {
    await give('alice', 10000)
    await cmd('存款', '1')
    vi.setSystemTime(WED + 30 * HOUR)
    await cmd('存款', '999')
    // 存 1 块 30 小时（封顶 24 小时）的利息 0.24，999 块刚存进去不算
    expect(text(await cmd('领取利息'))).toContain('成功领取利息0.24金币')
    vi.setSystemTime(WED + 32 * HOUR)
    expect(text(await cmd('银行信息'))).toContain('可领利息：20金币') // 1000 × 1% × 2 小时
  })

  it('一键存款不用带数字，超过上限时存满为止', async () => {
    await give('alice', 1500)
    expect(text(await cmd('一键存款'))).toContain('存储上限只够存入1000金币')
    expect(text(await cmd('一键存款'))).toContain('存款失败！当前存储上限为1000金币')
  })

  it('转账：一条语句写两个人，扣手续费', async () => {
    await give('alice', 1000)
    const s = await cmd('转账', '200', { id: 'alice', at: [{ id: 'bob', name: '鲍勃' }] })
    expect(text(s)).toContain('成功转账200金币给鲍勃\n手续费：20金币\n剩余余额：780金币')
    expect((await player('bob')).currency).toBe(200)
  })
})

describe('竞技', () => {
  async function ownTwo() {
    await give('alice', 10000)
    await cmd('购买奴隶', '', { id: 'alice', at: [{ id: 's1', name: '一号' }] })
    vi.setSystemTime(WED + 2 * HOUR)
    await cmd('购买奴隶', '', { id: 'alice', at: [{ id: 's2', name: '二号' }] })
  }

  it('决斗输了记负场、没有奖励', async () => {
    await ownTwo()
    vi.spyOn(Math, 'random').mockReturnValue(0.99) // 一号输
    const s = text(await cmd('决斗', '1 2'))
    expect(s).toContain('决斗结束！二号获胜！')
    expect(s).toContain('参赛费打了水漂')
    expect(s).toContain('你的战绩: 0胜 1负')
    expect((await player('alice')).currency).toBe(10000 - 100 - 100 - 50)
  })

  it('决斗对手可以 @，先后顺序按消息里的写法', async () => {
    await ownTwo()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const s = text(await cmd('决斗', '1', { id: 'alice', at: [{ id: 'eve', name: '伊芙' }] }))
    expect(s).toContain('决斗结束！一号获胜！')
    expect(s).toContain('伊芙身价下降')
  })

  it('排位赛奖励用上了基础奖励、胜利加成和段位倍率', async () => {
    await ownTwo()
    vi.spyOn(Math, 'random').mockReturnValue(0) // 事件取第一个（×1.1），对手取 ±300 内第一个，胜
    const s = text(await cmd('参加排位赛', '1'))
    expect(s).toContain('一号 VS 流浪剑客')
    expect(s).toContain('胜利！')
    // 1000 分赢 800 分：+7；(10 + 0.7) × 白银 1.2 × (1 + 0.2) = 15.4
    expect(s).toContain('分数变化: +7')
    expect(s).toContain('获得奖励: 15金币')
    expect(s).toContain('当前段位: 白银')
  })

  it('一键训练：休息中、金币不足不算失败', async () => {
    await ownTwo()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    await cmd('训练', '1')
    const s = text(await cmd('一键训练'))
    expect(s).toContain('成功 1 · 失败 0 · 跳过 1')
  })

  it('抢劫不 @ 时随机挑别人，不会抽到自己', async () => {
    await give('alice', 0)
    await give('bob', 300)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(text(await cmd('抢劫'))).toBe('抢劫成功！你从bob那里抢到了60金币')
  })
})

describe('每周重置', () => {
  it('跨周后第一条命令先发上周回顾，再按新的一周算', async () => {
    await give('alice', 500, '爱丽丝')
    vi.setSystemTime(WED + 7 * DAY)
    const s = await cmd('银行信息')
    expect(s.replies).toHaveLength(2)
    expect(s.replies[0]).toContain('🔄 每周重置已自动执行！重置了1个玩家数据')
    expect(s.replies[0]).toContain('爱丽丝 - 500💰')
    expect(s.replies[1]).toContain('当前余额：0金币')
    expect(text(await cmd('上周排行榜'))).toContain('上周金币排行榜')
  })

  it('手动重置：按钮只许发起人点，只清本群，点第二次失效', async () => {
    await give('alice', 500)
    const ask = await cmd('手动奴隶重置', '', { id: 'alice', role: 'admin' })
    const msg = ask.replies[0] as { keyboard: { content: { rows: Array<{ buttons: Array<{ action: { data: string } }> }> } } }
    const data = msg.keyboard.content.rows[0]!.buttons[0]!.action.data

    const stranger = await runButton(plugin, 'slave_reset', data, { session: { targetId: G, userId: 'mallory' }, ctx: { db, config, services } })
    expect(stranger.code).toBe(4)

    const ok = await runButton(plugin, 'slave_reset', data, { session: { targetId: G, userId: 'alice' }, ctx: { db, config, services } })
    expect(text(ok.session)).toContain('✅ 手动重置完成！')
    expect((await player('alice')).currency).toBe(0)

    const again = await runButton(plugin, 'slave_reset', data, { session: { targetId: G, userId: 'alice' }, ctx: { db, config, services } })
    expect(text(again.session)).toBe('本群已经重置过了，这个按钮失效了')
  })
})

describe('出图', () => {
  it('t2i 有 renderUrl 时发图片地址，渲染失败退回文字', async () => {
    const renderUrl = vi.fn().mockResolvedValue({ url: 'https://t2i.example/text2img/data/x.jpeg' })
    services = { t2i: { renderUrl } }
    await give('alice', 100, '<b>爱丽丝</b>')
    const s = await cmd('奴隶身价排行榜')
    expect(s.replies[0]).toEqual({ image: { url: 'https://t2i.example/text2img/data/x.jpeg' } })
    expect(renderUrl.mock.calls[0]![0]).toContain('&#60;b&#62;爱丽丝')

    renderUrl.mockRejectedValue(new Error('down'))
    expect(text(await cmd('奴隶身价排行榜'))).toContain('身价排行榜')
  })
})
