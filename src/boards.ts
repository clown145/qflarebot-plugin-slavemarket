import type { OutgoingMessage, PluginContext } from '@qqbot/sdk'
import type { Config } from './config.js'
import type { Game, GameReply } from './game.js'
import { nameOf } from './model.js'
import { boardHtml, rankingHtml, renderImage } from './render.js'
import { type BankEntry, type Board, type BoardEntry, loadGroupPlayers } from './store.js'
import { formatBeijing, isoWeek } from './time.js'

const LINE = '━━━━━━━━━━━━━━━━━━━━'

/** 上游的 formatRankingMessage */
function rankingLines(title: string, rows: Array<{ name: string; text: string }>): string {
  if (!rows.length) return `${title}：暂无数据`
  const lines = rows.map((r, i) => {
    const icon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
    const name = r.name.length > 8 ? `${r.name.slice(0, 8)}...` : r.name
    return `${icon} ${name} - ${r.text}`
  })
  return `🏆 ${title}\n${LINE}\n${lines.join('\n')}`
}

const coins = (e: BoardEntry) => ({ name: e.name, text: `${e.n}💰` })
const worth = (e: BoardEntry) => ({ name: e.name, text: `${e.n}💎` })
const slaves = (e: BoardEntry) => ({ name: e.name, text: `${e.n}个奴隶` })
const bank = (e: BankEntry) => ({ name: e.name, text: `Lv.${e.level} (${e.balance}💰)` })

function boardTitle(b: Board): string {
  const { year, week } = isoWeek(b.startedAt)
  return `${year}年第${week}周排行榜回顾`
}

/** 自动换期后附在那条命令最前面的回顾（上游 showLastWeekRankingsAfterReset，原来是连发 4 条） */
export function recapText(b: Board): string {
  return [
    `🔄 每周重置已自动执行！重置了${b.playerCount}个玩家数据`,
    `🏆 ${boardTitle(b)}`,
    LINE,
    rankingLines('上周金币排行榜TOP5', b.currency.slice(0, 5).map(coins)),
    rankingLines('上周身价排行榜TOP5', b.value.slice(0, 5).map(worth)),
    LINE,
    '🎉 新的一周开始了！使用 /上周排行榜 查看完整排行',
  ].join('\n')
}

/** 上周排行榜：上游连发 6 条文字，超过被动回复 5 条的上限，这里合成一张图（渲染失败发一条文字） */
export async function lastWeekBoard(ctx: PluginContext<Config>, botId: string, board: Board | null, header = ''): Promise<GameReply> {
  if (!board) return '📊 暂无上周排行榜数据'
  const title = `🏆 ${boardTitle(board)}`
  const subtitle = `${formatBeijing(board.startedAt)} – ${formatBeijing(board.endedAt)} · 参与玩家 ${board.playerCount} 人`
  const url = await renderImage(
    ctx,
    boardHtml(botId, title, subtitle, [
      { title: '💰 金币排行榜', rows: board.currency.map((e) => ({ id: e.id, name: e.name, value: `${e.n}` })) },
      { title: '💎 身价排行榜', rows: board.value.map((e) => ({ id: e.id, name: e.name, value: `${e.n}` })) },
      { title: '👥 奴隶数量排行榜', rows: board.slaves.map((e) => ({ id: e.id, name: e.name, value: `${e.n}个` })) },
      { title: '🏦 银行等级排行榜', rows: board.bank.map((e) => ({ id: e.id, name: e.name, value: `Lv.${e.level}（${e.balance}）` })) },
    ]),
  )
  const out: OutgoingMessage[] = []
  if (header) out.push(header)
  if (url) {
    out.push({ image: { url } })
  } else {
    out.push(
      [
        title,
        `📅 重置时间: ${formatBeijing(board.endedAt)}`,
        `👥 参与玩家: ${board.playerCount}人`,
        LINE,
        rankingLines('上周金币排行榜', board.currency.map(coins)),
        rankingLines('上周身价排行榜', board.value.map(worth)),
        rankingLines('上周奴隶数量排行榜', board.slaves.map(slaves)),
        rankingLines('上周银行等级排行榜', board.bank.map(bank)),
        LINE,
        '🎉 恭喜以上玩家在上周的精彩表现！\n🔄 新的一周已经开始，继续加油吧！',
      ].join('\n'),
    )
  }
  return out
}

/** 奴隶身价 / 资金排行榜（上游 rankings.js）：本期前 15 */
export async function currentRanking(game: Game, type: 'value' | 'currency'): Promise<GameReply> {
  const label = type === 'value' ? '身价' : '资金'
  const players = (await loadGroupPlayers(game.db, game.groupId, game.group.season, game.cfg))
    .sort((a, b) => b[type] - a[type])
    .slice(0, 15)
  const rows = players.map((p) => ({ id: p.id, name: nameOf(p), value: p[type] }))
  const url = await renderImage(game.ctx, rankingHtml(game.session.botId, label, rows))
  if (url) return { image: { url } }
  return rankingLines(`${label}排行榜`, rows.map((r) => ({ name: r.name, text: `${r.value}${type === 'value' ? '💎' : '💰'}` })))
}
