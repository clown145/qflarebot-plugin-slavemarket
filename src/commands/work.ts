import copywriting from '../copywriting.json'
import type { Game, GameReply } from '../game.js'
import { type Player, nameOf, randInt, round2, sample } from '../model.js'
import { type WorkLine, renderImage, workHtml } from '../render.js'
import { hms } from '../time.js'
import { mySlaves } from './trade.js'

type WorkResult =
  | { kind: 'text'; text: string }
  | { kind: 'report'; lines: WorkLine[]; wages: number; expense: string; balance: number }

/** 打工（上游 work.js）：没奴隶自己打工，有奴隶派奴隶去 */
export async function work(game: Game): Promise<GameReply> {
  const result = await game.mutate<WorkResult>([game.userId], async (ps) => {
    const me = ps.get(game.userId)!
    const cfg = game.cfg
    const next = me.data.workAt ?? 0
    if (!game.ignoreCd && game.now < next) {
      return { save: [], result: { kind: 'text', text: `每${cfg.work_cooldown / 3600}小时一次，剩余CD：${hms(next - game.now)}` } }
    }

    const slaves = await mySlaves(game)()
    if (!slaves.length) {
      const owner = cfg.slaveowner_users.includes(me.id)
      const wages = owner
        ? randInt(100, 2000) + randInt(Math.floor(me.value / 10), Math.floor(me.value / 5))
        : randInt(10, 100) + randInt(Math.floor(me.value / 20), Math.floor(me.value / 10))
      const text = owner
        ? `您是尊贵的奴隶主\n【您】${sample(copywriting.slaveowner)}${wages}金币\n当前共有${round2(me.currency + wages)}金币`
        : `你没有群友只能自己去打工\n【你】${sample(copywriting.success)}${wages}金币\n当前共有${round2(me.currency + wages)}金币`
      me.currency = round2(me.currency + wages)
      me.data.workAt = game.now + (owner ? cfg.work_slaveowner_cooldown : cfg.work_cooldown) * 1000
      return { save: [me], result: { kind: 'text', text } }
    }

    const lines: WorkLine[] = []
    const hurt: Player[] = []
    let wages = 0
    for (const s of slaves) {
      const name = nameOf(s)
      let income = randInt(5, 20) + randInt(Math.floor(s.value / 20), Math.floor(s.value / 10))
      // 十分之一的概率这次打工搞砸了：没收入，身价 -20
      if (randInt(1, 10) !== 1) {
        lines.push({ name, work: sample(copywriting.success), income: `${income}金币` })
      } else {
        income = 0
        const after = Math.round(Math.max(0, s.value - 20) * 10) / 10
        const text = sample(copywriting.failure)
          .replace(/\[A\]/g, `【${name}】`)
          .replace(/\[C\]/g, String(s.value))
          .replace(/\[D\]/g, String(after))
        lines.push({ name, work: text, income: '' })
        s.value = after
        hurt.push(s)
      }
      wages += income
    }

    // 五分之一的概率有一笔开销（上游扣了没存，还不在报告里）
    let expense = ''
    let cost = 0
    if (randInt(1, 10) <= 2) {
      expense = sample(copywriting.expenses)
      cost = Number(/\d+/.exec(expense)?.[0] ?? 0)
    }
    me.currency = round2(Math.max(0, me.currency + wages - cost))
    me.data.workAt = game.now + cfg.work_cooldown * 1000
    return { save: [me, ...hurt], result: { kind: 'report', lines, wages, expense, balance: me.currency } }
  })

  if (result.kind === 'text') return result.text
  const url = await renderImage(game.ctx, workHtml(result.lines, result.wages, result.expense, result.balance))
  if (url) return { image: { url } }
  const body = result.lines.map((l) => `【${l.name}】${l.work}${l.income}`).join('\n')
  const expense = result.expense ? `\n${result.expense}` : ''
  return `群友打工报告\n${body}${expense}\n你总共获取${result.wages}金币，当前共有${result.balance}金币`
}
