/**
 * 面板配置。上游是嵌套的 YAML（buyBack.cooldown 之类），面板遇到嵌套对象会退化成 JSON 文本框，
 * 所以摊平成一层；数值和默认值与上游一致，时间仍按秒填。
 */
export interface Config {
  buyback_cooldown: number
  buyback_max_times: number
  buyback_tax_rate: number

  rob_cooldown: number
  rob_success_rate: number
  rob_penalty: number

  work_cooldown: number
  work_slaveowner_cooldown: number

  purchase_cooldown: number

  bank_initial_limit: number
  bank_initial_level: number
  bank_upgrade_price_multi: number
  bank_limit_increase_multi: number
  bank_initial_upgrade_price: number
  bank_interest_rate: number
  bank_max_interest_hours: number

  training_cooldown: number
  training_success_rate: number
  training_cost_rate: number
  training_value_increase_rate: number

  arena_cooldown: number
  arena_entry_fee: number
  arena_reward_rate: number
  arena_value_bonus: number

  ranking_cooldown: number
  ranking_base_reward: number
  ranking_win_bonus: number
  ranking_tier_bonus_bronze: number
  ranking_tier_bonus_silver: number
  ranking_tier_bonus_gold: number
  ranking_tier_bonus_platinum: number
  ranking_tier_bonus_diamond: number

  transfer_fee_rate: number
  transfer_min_amount: number

  weekly_reset_enabled: boolean
  reset_day: number
  reset_hour: number
  reset_minute: number
  reset_keep_nickname: boolean
  reset_base_value: number

  /** 上游的 ignoreCDUsers：所有冷却对他们无效 */
  ignore_cd_users: string[]
  /** 上游的 Bot 主人（e.isMaster）：没奴隶时按「尊贵的奴隶主」打工 */
  slaveowner_users: string[]

  use_image: boolean
  market_limit: number
  prune_weeks: number
}

const num = (title: string, def: number, extra: Record<string, unknown> = {}) => ({ type: 'number', title, default: def, ...extra })
const int = (title: string, def: number, extra: Record<string, unknown> = {}) => ({ type: 'integer', title, default: def, ...extra })
const rate = (title: string, def: number) => num(title, def, { minimum: 0, maximum: 1 })
const seconds = (title: string, def: number) => int(`${title}（秒）`, def, { minimum: 0 })

export const configSchema = {
  type: 'object',
  properties: {
    buyback_cooldown: seconds('赎身冷却', 86400),
    buyback_max_times: int('每周最多赎身次数', 3, { minimum: 1 }),
    buyback_tax_rate: rate('赎身税率（0-1）', 0.05),

    rob_cooldown: seconds('抢劫冷却', 600),
    rob_success_rate: rate('抢劫成功率（0-1）', 0.3),
    rob_penalty: rate('抢劫失败罚金比例（0-1）', 0.1),

    work_cooldown: seconds('打工冷却', 3600),
    work_slaveowner_cooldown: seconds('尊贵的奴隶主打工冷却', 60),

    purchase_cooldown: seconds('购买冷却', 3600),

    bank_initial_limit: int('银行初始存储上限', 1000, { minimum: 0 }),
    bank_initial_level: int('银行初始信用等级', 1, { minimum: 1 }),
    bank_upgrade_price_multi: num('升级费用倍数', 1.2, { minimum: 1 }),
    bank_limit_increase_multi: num('存储上限增长倍数', 1.25, { minimum: 1 }),
    bank_initial_upgrade_price: int('初始升级费用', 100, { minimum: 1 }),
    bank_interest_rate: rate('每小时利率（0-1）', 0.01),
    bank_max_interest_hours: int('最多计息小时数', 24, { minimum: 1 }),

    training_cooldown: seconds('训练冷却', 7200),
    training_success_rate: rate('训练成功率（0-1）', 0.7),
    training_cost_rate: rate('训练费用比例（按奴隶身价）', 0.1),
    training_value_increase_rate: num('训练成功身价提升比例', 0.2, { minimum: 0 }),

    arena_cooldown: seconds('决斗冷却', 7200),
    arena_entry_fee: int('决斗参赛费用', 50, { minimum: 0 }),
    arena_reward_rate: num('获胜奖励比例（按参赛费用）', 0.2, { minimum: 0 }),
    arena_value_bonus: num('获胜者身价提升比例', 0.1, { minimum: 0 }),

    ranking_cooldown: seconds('排位赛冷却', 3600),
    ranking_base_reward: int('排位赛基础奖励金币', 10, { minimum: 0 }),
    ranking_win_bonus: num('排位赛胜利额外奖励比例', 0.2, { minimum: 0 }),
    ranking_tier_bonus_bronze: num('青铜段位奖励倍率', 1, { minimum: 0 }),
    ranking_tier_bonus_silver: num('白银段位奖励倍率', 1.2, { minimum: 0 }),
    ranking_tier_bonus_gold: num('黄金段位奖励倍率', 1.5, { minimum: 0 }),
    ranking_tier_bonus_platinum: num('铂金段位奖励倍率', 2, { minimum: 0 }),
    ranking_tier_bonus_diamond: num('钻石段位奖励倍率', 3, { minimum: 0 }),

    transfer_fee_rate: rate('转账手续费率（0-1）', 0.1),
    transfer_min_amount: int('最低转账金额', 100, { minimum: 0 }),

    weekly_reset_enabled: {
      type: 'boolean',
      title: '每周重置',
      description: '到点后本群的第一条命令开启新的一周：所有人回到初始状态，上周排行榜留一份可查。只重置用过的群，不用定时推送',
      default: true,
    },
    reset_day: int('重置日（0=周日，1=周一 … 6=周六，北京时间）', 1, { minimum: 0, maximum: 6 }),
    reset_hour: int('重置小时（0-23）', 0, { minimum: 0, maximum: 23 }),
    reset_minute: int('重置分钟（0-59）', 0, { minimum: 0, maximum: 59 }),
    reset_keep_nickname: { type: 'boolean', title: '重置时保留昵称', default: true },
    reset_base_value: int('重置后的基础身价', 100, { minimum: 0 }),

    ignore_cd_users: {
      type: 'array',
      title: '无视冷却的用户 openid',
      description: '在群里发内置插件的 /sid 可以查到自己的 openid',
      items: { type: 'string' },
      default: [],
    },
    slaveowner_users: {
      type: 'array',
      title: '尊贵的奴隶主 openid',
      description: '没有奴隶时打工按奴隶主算：收入更高、冷却按上面的「尊贵的奴隶主打工冷却」',
      items: { type: 'string' },
      default: [],
    },

    use_image: {
      type: 'boolean',
      title: '用图片回复',
      description: '打工报告、一键训练、排行榜、市场、帮助等用内置 T2I 插件渲染成图；关掉或渲染失败时发文字',
      default: true,
    },
    market_limit: int('奴隶市场最多展示几人（按身价从高到低）', 100, { minimum: 1, maximum: 300 }),
    prune_weeks: int('清理多少周没玩过的玩家数据（0 = 不清理）', 4, { minimum: 0 }),
  },
}

export const defaultConfig: Config = Object.fromEntries(
  Object.entries(configSchema.properties).map(([k, v]) => [k, (v as { default: unknown }).default]),
) as unknown as Config
