import { type Game, type GameReply, noTarget } from '../game.js'
import { INITIAL_RANK_SCORE, nameOf, round2, sample, tierBonus, tierOf } from '../model.js'
import type { TargetToken } from '../targets.js'
import { minutesSeconds } from '../time.js'
import { mySlaves, resolveTarget } from './trade.js'

const OPPONENTS = [
  { name: '流浪剑客', score: 800, specialEffect: '剑术精湛，容易造成暴击' },
  { name: '江湖大侠', score: 1200, specialEffect: '内力深厚，防御力强' },
  { name: '武林高手', score: 1600, specialEffect: '轻功绝顶，闪避率高' },
  { name: '绝世高手', score: 2000, specialEffect: '武学通神，全面强化' },
  { name: '隐世门派弟子', score: 1400, specialEffect: '招式诡异，难以预测' },
  { name: '江湖杀手', score: 1100, specialEffect: '出手狠辣，伤害提升' },
  { name: '武馆教习', score: 900, specialEffect: '经验丰富，稳扎稳打' },
  { name: '散打高手', score: 1300, specialEffect: '近身搏斗见长' },
]

const EVENTS = [
  { name: '天气晴朗', effect: 1.1, desc: '状态绝佳' },
  { name: '狂风暴雨', effect: 0.9, desc: '行动受限' },
  { name: '月黑风高', effect: 1.2, desc: '战力提升' },
  { name: '人来人往', effect: 0.95, desc: '注意力分散' },
  { name: '良辰吉日', effect: 1.15, desc: '运势加成' },
]

/** 分数相差 300 以内的对手里随机挑，一个都没有就全体随机 */
function matchOpponent(score: number) {
  const near = OPPONENTS.filter((o) => Math.abs(o.score - score) <= 300)
  return sample(near.length ? near : OPPONENTS)
}

/** Elo，K = 32 */
function scoreChange(score: number, opponent: number, win: boolean): number {
  const expected = 1 / (1 + Math.pow(10, (opponent - score) / 400))
  return Math.floor(32 * (win ? 1 - expected : 0 - expected))
}

const TIER_TABLE = '【段位说明】\n青铜: 0-999分\n白银: 1000-1399分\n黄金: 1400-1799分\n铂金: 1800-2199分\n钻石: 2200分以上'

/** 排位赛：看自己奴隶的段位。上游会顺手给没打过的奴隶写一份初始数据，这里现算、不写 */
export async function rankingInfo(game: Game): Promise<GameReply> {
  const slaves = await mySlaves(game)()
  if (!slaves.length) return '你还没有奴隶，无法查看排位赛信息'
  const lines = ['【奴隶排位赛信息】']
  slaves.forEach((s, i) => {
    const rank = s.data.rank ?? { score: INITIAL_RANK_SCORE, matches: 0 }
    lines.push(`${i + 1}. ${nameOf(s)}\n段位：${tierOf(rank.score)}\n分数：${rank.score}\n比赛场次：${rank.matches}\n---------------`)
  })
  lines.push(`\n${TIER_TABLE}\n\n发送 /参加排位赛 序号 开始比赛`)
  return lines.join('\n')
}

/**
 * 参加排位赛（上游 slaveRanking.js）。上游的奖励只有 |分数变化| × 0.1，配置里的基础奖励、胜利加成、
 * 段位倍率都没用上；这里按配置的说明算：(基础奖励 + |分数变化| × 0.1) × 赛前段位倍率，赢了再 × (1 + 胜利加成)
 */
export async function joinRanking(game: Game, tokens: TargetToken[]): Promise<GameReply> {
  const target = await resolveTarget(tokens[0], mySlaves(game))
  if (!target) return noTarget(game, '请指定参赛的奴隶：/参加排位赛 序号（发 /我的奴隶 查看序号）或 /参加排位赛 @群友')
  return game.mutate([game.userId, target], (ps) => {
    const me = ps.get(game.userId)!
    const slave = ps.get(target)!
    const cfg = game.cfg
    if (slave.master !== me.id) return { save: [], result: '你不是该奴隶的主人' }
    const since = game.now - (me.data.rankingAt ?? 0)
    if (!game.ignoreCd && me.data.rankingAt && since < cfg.ranking_cooldown * 1000) {
      return { save: [], result: `排位赛冷却中，剩余时间：${minutesSeconds(cfg.ranking_cooldown * 1000 - since)}` }
    }

    const rank = slave.data.rank ?? { score: INITIAL_RANK_SCORE, matches: 0 }
    const tierBefore = tierOf(rank.score)
    const event = sample(EVENTS)
    const opponent = matchOpponent(rank.score)
    const win = Math.random() < 0.5 * event.effect
    const diff = scoreChange(rank.score, opponent.score, win)
    rank.score += diff
    rank.matches++
    slave.data.rank = rank
    const reward = Math.floor((cfg.ranking_base_reward + Math.abs(diff) * 0.1) * tierBonus(tierBefore, cfg) * (win ? 1 + cfg.ranking_win_bonus : 1))
    me.currency = round2(me.currency + reward)
    me.data.rankingAt = game.now

    return {
      save: [me, slave],
      result: [
        `当前事件：${event.name}（${event.desc}）`,
        `${nameOf(slave)} VS ${opponent.name}`,
        `对手特性：${opponent.specialEffect}`,
        win ? '胜利！' : '失败！',
        `分数变化: ${diff > 0 ? '+' : ''}${diff}`,
        `当前分数: ${rank.score}`,
        `当前段位: ${tierOf(rank.score)}`,
        `获得奖励: ${reward}金币`,
      ].join('\n'),
    }
  })
}
