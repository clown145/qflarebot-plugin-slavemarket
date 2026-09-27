import { type Game, type GameReply, noTarget } from '../game.js'
import { type Player, nameOf, round2 } from '../model.js'
import { type TrainResult, type TrainSummary, renderImage, trainingHtml } from '../render.js'
import type { TargetToken } from '../targets.js'
import { hoursMinutes } from '../time.js'
import { mySlaves, resolveTarget } from './trade.js'

/** 奴隶还要休息多久（毫秒），不用休息返回 0 */
function resting(game: Game, slave: Player): number {
  if (game.ignoreCd || !slave.data.trainedAt) return 0
  return Math.max(0, game.cfg.training_cooldown * 1000 - (game.now - slave.data.trainedAt))
}

/** 训练（上游 trainSlave.js）：/训练 序号 或 /训练 @群友 */
export async function train(game: Game, tokens: TargetToken[]): Promise<GameReply> {
  const target = await resolveTarget(tokens[0], mySlaves(game))
  if (!target) return noTarget(game, '请指定要训练的奴隶：/训练 序号（发 /我的奴隶 查看序号）或 /训练 @群友')
  return game.mutate([game.userId, target], (ps) => {
    const me = ps.get(game.userId)!
    const slave = ps.get(target)!
    const cfg = game.cfg
    if (slave.master !== me.id) return { save: [], result: '你不是该奴隶的主人' }
    const rest = resting(game, slave)
    if (rest > 0) return { save: [], result: `该奴隶还在休息中，剩余时间：${hoursMinutes(rest)}` }
    const cost = Math.floor(slave.value * cfg.training_cost_rate)
    if (me.currency < cost) return { save: [], result: `训练需要${cost}金币，你的余额不足` }

    me.currency = round2(me.currency - cost)
    slave.data.trainedAt = game.now
    if (Math.random() < cfg.training_success_rate) {
      const inc = Math.floor(slave.value * cfg.training_value_increase_rate)
      slave.value = round2(slave.value + inc)
      return { save: [me, slave], result: `训练成功！消耗${cost}金币\n${nameOf(slave)}的身价提升${inc}，现在为${slave.value}金币` }
    }
    return { save: [me, slave], result: `训练失败...\n消耗${cost}金币\n奴隶身价未提升` }
  })
}

/** 一键训练：每个奴隶各自判定，结果出一张图 */
export async function trainAll(game: Game): Promise<GameReply> {
  const outcome = await game.mutate<{ summary: TrainSummary; results: TrainResult[] } | string>([game.userId], async (ps) => {
    const me = ps.get(game.userId)!
    const cfg = game.cfg
    const slaves = await mySlaves(game)()
    if (!slaves.length) return { save: [], result: '你还没有奴隶可以训练' }

    const results: TrainResult[] = []
    const trained: Player[] = []
    let cost = 0
    let success = 0
    let failed = 0
    for (const s of slaves) {
      const base = { id: s.id, name: nameOf(s), valueChange: 0 }
      const rest = resting(game, s)
      if (rest > 0) {
        results.push({ ...base, result: '休息中', currentValue: s.value, status: 'resting', remainingTime: hoursMinutes(rest) })
        continue
      }
      const price = Math.floor(s.value * cfg.training_cost_rate)
      if (me.currency < price) {
        results.push({ ...base, result: '金币不足', currentValue: s.value, status: 'poor' })
        continue
      }
      me.currency = round2(me.currency - price)
      cost += price
      s.data.trainedAt = game.now
      trained.push(s)
      if (Math.random() < cfg.training_success_rate) {
        const inc = Math.floor(s.value * cfg.training_value_increase_rate)
        s.value = round2(s.value + inc)
        results.push({ ...base, result: '训练成功', valueChange: inc, currentValue: s.value, status: 'success' })
        success++
      } else {
        results.push({ ...base, result: '训练失败', currentValue: s.value, status: 'failed' })
        failed++
      }
    }
    // 上游把休息中、金币不足也算进「失败」
    const summary = { total: slaves.length, success, failed, skipped: slaves.length - success - failed, cost, remaining: me.currency }
    return { save: trained.length ? [me, ...trained] : [], result: { summary, results } }
  })

  if (typeof outcome === 'string') return outcome
  const { summary: s, results } = outcome
  const url = await renderImage(game.ctx, trainingHtml(game.session.botId, s, results))
  if (url) return { image: { url } }
  const lines = results.map((r) => {
    const change = r.valueChange > 0 ? ` 身价+${r.valueChange}` : ''
    const cd = r.remainingTime ? `（剩余CD：${r.remainingTime}）` : ''
    return `${r.name}：${r.result}${change}${cd}，当前身价 ${r.currentValue}`
  })
  return `训练结果报告\n总奴隶数 ${s.total} · 成功 ${s.success} · 失败 ${s.failed} · 跳过 ${s.skipped}\n总花费 ${s.cost}金币 · 剩余金币 ${s.remaining}\n${lines.join('\n')}`
}
