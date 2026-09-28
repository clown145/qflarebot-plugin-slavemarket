import { definePlugin } from '@qqbot/sdk'
import { currentRanking, lastWeekBoard } from './boards.js'
import { arenaDuel, bank, help, ranked, reset, rob, trade, training, work } from './commands/index.js'
import { type Config, configSchema, defaultConfig } from './config.js'
import { play } from './game.js'
import { initSchema, prune, removeMember } from './store.js'
import { targetTokens } from './targets.js'

export default definePlugin<Config>({
  name: 'slavemarket',
  // 没用到契约 2 的 ctx.db.batch()，写 1 让 0.4 以前的机器人也能装（不写就是构建时 SDK 的版本）
  apiVersion: 1,
  displayName: '奴隶市场',
  description: '群聊文字游戏：打工赚钱、买卖群友当奴隶、训练、决斗、排位赛、银行、排行榜，每周自动重置',
  permissions: ['db'],
  // 打工报告、排行榜、市场、帮助等出图；t2i 没装、停用或渲染失败时改发文字，所以是可选依赖。
  // 写成必需的话，t2i 一停用这里所有命令都会报错。老版本机器人把 optional 当成必需，t2i 是内置的，不受影响
  depends: { t2i: 'optional' },

  configSchema,
  defaultConfig,

  hooks: {
    async onInstall(ctx) {
      await initSchema(ctx.db)
    },
  },

  commands: {
    打工: {
      aliases: ['工作', '一键打工', '一键工作'],
      description: '打工赚金币，有奴隶就派奴隶去',
      handler: play((g) => work.work(g)),
    },
    购买奴隶: {
      aliases: ['购买群友'],
      usage: '/购买奴隶 @群友 或 /购买奴隶 市场编号',
      description: '买下群友当奴隶',
      handler: play((g, { args }) => trade.purchase(g, targetTokens(g.session, args))),
    },
    我的奴隶: {
      aliases: ['我的群友'],
      description: '看自己的金币、身价和奴隶',
      handler: play((g) => trade.mySlaveList(g)),
    },
    奴隶市场: {
      aliases: ['群友市场'],
      description: '看全群的身价和主人',
      handler: play((g) => trade.market(g)),
    },
    放生奴隶: {
      aliases: ['放生群友'],
      usage: '/放生奴隶 序号 或 /放生奴隶 @群友',
      description: '放走自己的奴隶',
      handler: play((g, { args }) => trade.release(g, targetTokens(g.session, args))),
    },
    赎身: {
      description: '两倍身价买回自己',
      handler: play((g) => trade.buyBack(g)),
    },
    抢劫: {
      aliases: ['打劫'],
      usage: '/抢劫 或 /抢劫 @群友',
      description: '抢别人的金币，不@就随机',
      handler: play((g) => rob.rob(g)),
    },

    存款: { usage: '/存款 金额', description: '把金币存进银行', handler: play((g, { args }) => bank.deposit(g, args)) },
    一键存款: { description: '能存多少存多少', handler: play((g) => bank.depositAll(g)) },
    取款: { usage: '/取款 金额', description: '从银行取出金币', handler: play((g, { args }) => bank.withdraw(g, args)) },
    升级信用: { description: '提升银行存储上限', handler: play((g) => bank.upgradeCredit(g)) },
    一键升级信用: { description: '钱够就一直升级信用', handler: play((g) => bank.autoUpgradeCredit(g)) },
    银行信息: { description: '看存款、上限和利息', handler: play((g) => bank.bankInfo(g)) },
    领取利息: { description: '领取存款利息', handler: play((g) => bank.collectInterest(g)) },
    转账: { usage: '/转账 金额 @群友', description: '给群友转金币，收手续费', handler: play((g, { args }) => bank.transfer(g, args)) },

    训练: {
      usage: '/训练 序号 或 /训练 @群友',
      description: '训练奴隶提升身价',
      handler: play((g, { args }) => training.train(g, targetTokens(g.session, args))),
    },
    一键训练: { description: '训练所有奴隶', handler: play((g) => training.trainAll(g)) },
    决斗: {
      usage: '/决斗 我的奴隶序号 对手（@群友或序号）',
      description: '让奴隶和别人的奴隶决斗',
      handler: play((g, { args }) => arenaDuel.duel(g, targetTokens(g.session, args))),
    },
    排位赛: { description: '看奴隶的段位和分数', handler: play((g) => ranked.rankingInfo(g)) },
    参加排位赛: {
      usage: '/参加排位赛 序号 或 /参加排位赛 @群友',
      description: '让奴隶打排位赛拿奖励',
      handler: play((g, { args }) => ranked.joinRanking(g, targetTokens(g.session, args))),
    },

    奴隶身价排行榜: { description: '本群身价前 15 名', handler: play((g) => currentRanking(g, 'value')) },
    奴隶资金排行榜: { description: '本群金币前 15 名', handler: play((g) => currentRanking(g, 'currency')) },
    上周排行榜: { description: '上周四个榜的回顾', handler: play((g) => lastWeekBoard(g.ctx, g.session.botId, g.group.board)) },

    奴隶重置状态: { description: '每周重置的时间和记录', handler: play((g) => reset.resetStatus(g)) },
    手动奴隶重置: {
      permission: 'group_admin',
      usage: '/手动奴隶重置，再点确认或发 /手动奴隶重置 确认',
      description: '清空本群的游戏数据',
      handler: play((g, { args }) => reset.manualResetCommand(g, args)),
    },
    奴隶重置帮助: { description: '每周重置的说明', handler: play(() => reset.resetHelp()) },
    奴隶帮助: {
      aliases: ['奴隶菜单', 'nl帮助', 'nl菜单', '群友帮助', '群友菜单'],
      description: '奴隶市场的全部指令',
      handler: play((g) => help.help(g)),
    },
  },

  buttons: {
    slave_reset: (input) => reset.resetButton(input),
  },

  events: {
    // 退群：放掉他的奴隶、删掉他的存档（上游 exitDeleteArchive.js）
    'qq.group.member_removed': async ({ session, ctx }) => {
      if (session.targetId && session.userId) await removeMember(ctx.db, session.targetId, session.userId)
    },
  },

  cron: {
    // 北京时间每周一 04:23 清一次长期不玩的数据；关了每周重置就不清（那时旧数据仍然有效）
    prune: {
      cron: '23 20 * * 0',
      async handler({ ctx }) {
        if (!ctx.config.weekly_reset_enabled || ctx.config.prune_weeks <= 0) return
        const removed = await prune(ctx.db, Date.now(), ctx.config.prune_weeks)
        ctx.logger.info('奴隶市场清理长期不玩的数据', removed)
      },
    },
  },
})
