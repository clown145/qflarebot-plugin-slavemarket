import type { Game, GameReply } from '../game.js'
import { nameOf, round2 } from '../model.js'
import { hoursMinutes } from '../time.js'

/** 随机挑一个这一期玩过的人，排除自己和自己的主人（上游从全体存档里抽，能抽到自己） */
async function randomTarget(game: Game, master: string): Promise<string | undefined> {
  const row = await game.db.first<{ user_id: string }>(
    'SELECT user_id FROM {players} WHERE group_id = ? AND season = ? AND user_id != ? AND user_id != ? ORDER BY RANDOM() LIMIT 1;',
    game.groupId,
    game.group.season,
    game.userId,
    master,
  )
  return row?.user_id
}

/** 抢劫（上游 Rob.js）：@ 谁就抢谁，不 @ 随机挑。失败只写自己那一行 */
export async function rob(game: Game): Promise<GameReply> {
  const cfg = game.cfg
  const cooldown = (since: number) => (!game.ignoreCd && since < cfg.rob_cooldown * 1000 ? `抢劫冷却中，剩余时间：${hoursMinutes(cfg.rob_cooldown * 1000 - since)}` : '')

  const self = (await game.load([game.userId])).get(game.userId)!
  const waiting = cooldown(game.now - (self.data.robAt ?? 0))
  if (waiting) return waiting
  const target = game.mentions[0]?.id ?? (await randomTarget(game, self.master))
  if (!target) return '现在还没有可以抢劫的人'
  if (target === game.userId) return '你不能抢劫自己'
  if (target === self.master) return '你不能抢劫你的主人'

  return game.mutate([game.userId, target], (ps) => {
    const me = ps.get(game.userId)!
    const victim = ps.get(target)!
    const again = cooldown(game.now - (me.data.robAt ?? 0))
    if (again) return { save: [], result: again }
    me.data.robAt = game.now
    if (Math.random() < cfg.rob_success_rate) {
      const amount = round2(Math.min(victim.currency * 0.2, 100))
      me.currency = round2(me.currency + amount)
      victim.currency = round2(victim.currency - amount)
      return { save: [me, victim], result: `抢劫成功！你从${nameOf(victim)}那里抢到了${amount}金币` }
    }
    const penalty = round2(Math.min(me.currency * cfg.rob_penalty, 50))
    me.currency = round2(me.currency - penalty)
    return { save: [me], result: `抢劫失败！你被罚了${penalty}金币` }
  })
}
