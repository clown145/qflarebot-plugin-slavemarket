import type { Config } from './config.js'

/** 银行账户：上游的 userData.bank */
export interface Bank {
  balance: number
  level: number
  limit: number
  upgradePrice: number
  /** 从这个时刻起按整小时计息 */
  interestAt: number
  /** 存取款时先把已满整小时的利息结出来放这里，领取时一起给 */
  accrued: number
}

/** 不需要拿来查询、排序的字段都放这一个 JSON 里：一行只算一次写入 */
export interface PlayerData {
  /** 下次能打工的时刻（上游 lastWorkingTime 存的就是下次可用时间） */
  workAt?: number
  purchaseAt?: number
  robAt?: number
  buyBackAt?: number
  buyBackTimes?: number
  /** buyBackTimes 是哪个自然周的 */
  buyBackWeek?: number
  /** 作为奴隶上次被训练 */
  trainedAt?: number
  /** 作为主人上次决斗 */
  battleAt?: number
  /** 作为主人上次参加排位赛 */
  rankingAt?: number
  /** 被现在的主人买下的时刻，「我的奴隶」按它排序，序号才稳定 */
  boughtAt?: number
  bank?: Bank
  /** 作为奴隶的排位分 */
  rank?: { score: number; matches: number }
  battle?: { wins: number; losses: number }
}

export interface Player {
  id: string
  nickname: string
  currency: number
  value: number
  /** 主人的 openid，没有为空串 */
  master: string
  data: PlayerData
  /** 数据库里这一行的版本号，没有这一行为 0；写入时拿它判断中途有没有被别人改过 */
  ver: number
}

/** 数据库里的一行 */
export interface PlayerRow {
  user_id: string
  season: number
  ver: number
  nickname: string
  currency: number
  value: number
  master: string
  data: string
}

export function freshPlayer(id: string, cfg: Config, nickname = '', ver = 0): Player {
  return { id, nickname, currency: 0, value: cfg.reset_base_value, master: '', data: {}, ver }
}

/**
 * 行 → 当前这一期的玩家。每周重置不改任何玩家行：行上记着自己是第几期的，
 * 读到旧一期的就当成刚重置过（只留昵称），等这个人下次真有写入时顺手覆盖掉
 */
export function toPlayer(row: PlayerRow | null | undefined, id: string, season: number, cfg: Config): Player {
  if (!row) return freshPlayer(id, cfg)
  if (row.season !== season) return freshPlayer(id, cfg, cfg.reset_keep_nickname ? row.nickname : '', row.ver)
  let data: PlayerData = {}
  try {
    data = JSON.parse(row.data) as PlayerData
  } catch {
    // 坏数据当成空的，下次写入会重新写好
  }
  return { id, nickname: row.nickname, currency: row.currency, value: row.value, master: row.master, data, ver: row.ver }
}

/** 上游的 formatCurrency：保留两位小数 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function nameOf(p: Pick<Player, 'id' | 'nickname'>): string {
  return p.nickname || `群友${p.id.slice(-4).toUpperCase()}`
}

export function bankOf(p: Player, cfg: Config, now: number): Bank {
  return (
    p.data.bank ?? {
      balance: 0,
      level: cfg.bank_initial_level,
      limit: cfg.bank_initial_limit,
      upgradePrice: cfg.bank_initial_upgrade_price,
      interestAt: now,
      accrued: 0,
    }
  )
}

export type Tier = '青铜' | '白银' | '黄金' | '铂金' | '钻石'

export const INITIAL_RANK_SCORE = 1000

/** 段位按分数现算，不存：上游初始 1000 分却存成「青铜」，与它自己的段位表对不上 */
export function tierOf(score: number): Tier {
  if (score < 1000) return '青铜'
  if (score < 1400) return '白银'
  if (score < 1800) return '黄金'
  if (score < 2200) return '铂金'
  return '钻石'
}

export function tierBonus(tier: Tier, cfg: Config): number {
  switch (tier) {
    case '青铜':
      return cfg.ranking_tier_bonus_bronze
    case '白银':
      return cfg.ranking_tier_bonus_silver
    case '黄金':
      return cfg.ranking_tier_bonus_gold
    case '铂金':
      return cfg.ranking_tier_bonus_platinum
    case '钻石':
      return cfg.ranking_tier_bonus_diamond
  }
}

/** lodash.random(a, b)：闭区间整数 */
export function randInt(a: number, b: number): number {
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

export function sample<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!
}
