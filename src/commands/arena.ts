import { type Game, type GameReply, noTarget } from '../game.js'
import { type Player, nameOf, round2, sample } from '../model.js'
import type { TargetToken } from '../targets.js'
import { hoursMinutes } from '../time.js'
import { mySlaves } from './trade.js'

/** 按身价差调整胜率：基础 50%，最多 ±30% */
function slave1Wins(a: Player, b: Player): boolean {
  const top = Math.max(a.value, b.value)
  const diff = a.value - b.value
  const bonus = top > 0 ? Math.min(0.3, (Math.abs(diff) / top) * 0.5) : 0
  return Math.random() < 0.5 + (diff > 0 ? bonus : -bonus)
}

function battleProcess(name1: string, name2: string): string[] {
  const actions = [`${name1}使出浑身解数`, `${name2}奋力反击`, `${name1}展开猛攻`, `${name2}寻找破绽`, `${name1}气势如虹`, `${name2}毫不示弱`]
  const rounds = Math.floor(Math.random() * 2) + 2
  return Array.from({ length: rounds }, () => sample(actions))
}

/**
 * 决斗（上游 slaveArena.js）：/决斗 我的奴隶序号 对手。对手可以是 @群友，也可以是自己的另一个奴隶的序号。
 * 上游不管输赢都记一场胜、都发奖励；这里输了记负场、没有奖励（配置本来就叫「获胜奖励」）
 */
export async function duel(game: Game, tokens: TargetToken[]): Promise<GameReply> {
  const usage = '用法：/决斗 我的奴隶序号 对手（@群友，或你另一个奴隶的序号），例如 /决斗 1 @某人'
  let slaves: Player[] | undefined
  const resolve = async (t: TargetToken | undefined) => {
    if (!t) return undefined
    if (t.kind === 'mention') return t.id
    slaves ??= await mySlaves(game)()
    return slaves[t.n - 1]?.id
  }
  const id1 = await resolve(tokens[0])
  const id2 = await resolve(tokens[1])
  if (!id1 || !id2) return noTarget(game, usage)
  if (id1 === id2) return '不能让同一个奴隶自己决斗'
  if (id2 === game.userId) return '对手不能是你自己'
  if (id2 === game.session.botId) return '不可以和我决斗捏~'

  return game.mutate([game.userId, id1, id2], (ps) => {
    const me = ps.get(game.userId)!
    const s1 = ps.get(id1)!
    const s2 = ps.get(id2)!
    const cfg = game.cfg
    if (s1.master !== me.id) return { save: [], result: '你不是参战奴隶的主人' }
    const since = game.now - (me.data.battleAt ?? 0)
    if (!game.ignoreCd && me.data.battleAt && since < cfg.arena_cooldown * 1000) {
      return { save: [], result: `决斗冷却中，剩余时间：${hoursMinutes(cfg.arena_cooldown * 1000 - since)}` }
    }
    if (me.currency < cfg.arena_entry_fee) return { save: [], result: `参加决斗需要${cfg.arena_entry_fee}金币，你的余额不足` }

    const process = battleProcess(nameOf(s1), nameOf(s2))
    const won = slave1Wins(s1, s2)
    const [winner, loser] = won ? [s1, s2] : [s2, s1]
    const reward = won ? Math.floor(cfg.arena_entry_fee * cfg.arena_reward_rate) : 0
    const up = Math.floor(winner.value * cfg.arena_value_bonus)
    const down = Math.floor(loser.value * 0.05)
    winner.value = round2(winner.value + up)
    loser.value = round2(Math.max(100, loser.value - down))
    me.currency = round2(me.currency - cfg.arena_entry_fee + reward)
    me.data.battleAt = game.now
    const stats = me.data.battle ?? { wins: 0, losses: 0 }
    if (won) stats.wins++
    else stats.losses++
    me.data.battle = stats

    const lines = [
      ...process,
      `决斗结束！${nameOf(winner)}获胜！`,
      won ? `获得${reward}金币奖励` : `你的奴隶输了，${cfg.arena_entry_fee}金币参赛费打了水漂`,
      `${nameOf(winner)}身价提升${up}，现在为${winner.value}金币`,
      `${nameOf(loser)}身价下降${down}，现在为${loser.value}金币`,
      `你的战绩: ${stats.wins}胜 ${stats.losses}负`,
    ]
    return { save: [me, s1, s2], result: lines.join('\n') }
  })
}
