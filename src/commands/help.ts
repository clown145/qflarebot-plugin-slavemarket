import type { Game, GameReply } from '../game.js'
import { type HelpGroup, helpHtml, renderImage } from '../render.js'

/** 上游 help/index.html 的内容，指令改成框架的写法；备份四件套已去掉，赎身说明按代码实际改（2 倍身价，身价 ×1.2） */
const GROUPS: HelpGroup[] = [
  {
    title: '基础功能',
    items: [
      { emoji: '📊', command: '/奴隶市场', desc: '查看奴隶身价以及他的主人等信息', example: '/奴隶市场' },
      { emoji: '🛒', command: '/购买奴隶 @群友 或 市场编号', desc: '购买指定群友作为奴隶', example: '/购买奴隶 @小明 或 /购买奴隶 3' },
      { emoji: '🔍', command: '/我的奴隶', desc: '查看自己的信息和奴隶信息（带序号）', example: '/我的奴隶' },
      { emoji: '👨‍💻', command: '/打工', desc: '有奴隶派出奴隶去打工，没奴隶自己打工', example: '/打工' },
      { emoji: '🦹', command: '/抢劫 [@群友]', desc: '抢别人的金币，不 @ 就随机挑一个', example: '/抢劫 或 /抢劫 @小明' },
    ],
  },
  {
    title: '奴隶管理',
    items: [
      { emoji: '💰', command: '/赎身', desc: '按照身价的 2 倍价格赎身，赎身之后身价提升 20%，另交一笔税', example: '/赎身' },
      { emoji: '🕊️', command: '/放生奴隶 序号 或 @群友', desc: '放生指定的奴隶，解除其主仆关系', example: '/放生奴隶 1' },
    ],
  },
  {
    title: '竞技系统',
    items: [
      { emoji: '⚔️', command: '/决斗 我的奴隶序号 对手', desc: '让你的奴隶与其他奴隶决斗，对手可以 @，也可以是你另一个奴隶的序号', example: '/决斗 1 @小明' },
      { emoji: '🏆', command: '/参加排位赛 序号', desc: '让奴隶参加排位赛，提升段位获得奖励', example: '/参加排位赛 1' },
      { emoji: '📊', command: '/排位赛', desc: '查看自己奴隶的段位和分数', example: '/排位赛' },
    ],
  },
  {
    title: '银行系统',
    items: [
      { emoji: '🏦', command: '/存款 金额', desc: '将指定金额存入银行；/一键存款 存到上限为止', example: '/存款 1000' },
      { emoji: '💰', command: '/取款 金额', desc: '从银行取出指定金额', example: '/取款 500' },
      { emoji: '⭐', command: '/升级信用', desc: '升级银行信用等级，提升存储上限', example: '/升级信用 或 /一键升级信用' },
      { emoji: '📊', command: '/银行信息', desc: '查看银行账户信息', example: '/银行信息' },
      { emoji: '💵', command: '/领取利息', desc: '领取银行存款产生的利息', example: '/领取利息' },
      { emoji: '💸', command: '/转账 金额 @群友', desc: '向指定用户转账，收取手续费', example: '/转账 500 @小明' },
    ],
  },
  {
    title: '排行榜',
    items: [
      { emoji: '🏆', command: '/奴隶身价排行榜', desc: '查看群内奴隶的身价排行榜', example: '/奴隶身价排行榜' },
      { emoji: '💰', command: '/奴隶资金排行榜', desc: '查看群内奴隶的资金排行榜', example: '/奴隶资金排行榜' },
      { emoji: '📅', command: '/上周排行榜', desc: '查看上周的金币、身价、奴隶数量、银行等级排行', example: '/上周排行榜' },
    ],
  },
  {
    title: '训练相关',
    items: [
      { emoji: '🏋️', command: '/训练 序号 或 @群友', desc: '训练指定奴隶，提升其身价', example: '/训练 1' },
      { emoji: '🏋️', command: '/一键训练', desc: '一次性训练所有奴隶，自动计算总费用', example: '/一键训练' },
    ],
  },
  {
    title: '每周重置',
    items: [
      { emoji: '🔄', command: '/奴隶重置状态', desc: '查看每周重置的时间和本群重置记录', example: '/奴隶重置状态' },
      { emoji: '⚠️', command: '/手动奴隶重置', desc: '清空本群的游戏数据（群主、管理员）', example: '/手动奴隶重置' },
      { emoji: '📖', command: '/奴隶重置帮助', desc: '每周重置的详细说明', example: '/奴隶重置帮助' },
    ],
  },
]

export async function help(game: Game): Promise<GameReply> {
  const url = await renderImage(game.ctx, helpHtml(GROUPS))
  if (url) return { image: { url } }
  return [
    '🌟 奴隶市场帮助 🌟',
    ...GROUPS.map((g) => `【${g.title}】\n${g.items.map((it) => `${it.command} - ${it.desc}`).join('\n')}`),
    '群里 @机器人 时可以不打 /',
  ].join('\n\n')
}
