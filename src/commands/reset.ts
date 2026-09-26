import { type ButtonInput, type OutgoingMessage, type PluginContext, button, keyboard } from '@qqbot/sdk'
import { lastWeekBoard } from '../boards.js'
import type { Config } from '../config.js'
import type { Game, GameReply } from '../game.js'
import { loadSeason, manualReset, resetBoundary } from '../store.js'
import { formatBeijing, isoWeek, weekIndex, weekStart } from '../time.js'

const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const CONFIRM_MS = 60 * 1000
const pad = (n: number) => String(n).padStart(2, '0')

/** 奴隶重置状态：「已重置次数」「上次重置」是本群的（上游是全局的） */
export function resetStatus(game: Game): GameReply {
  const cfg = game.cfg
  if (!cfg.weekly_reset_enabled) return '每周重置功能未启用'
  const b = resetBoundary(cfg)
  const next = weekStart(weekIndex(game.now, b) + 1, b)
  const resets = game.group.season - 1
  return [
    '📊 每周重置状态',
    '🔄 重置功能: 已启用',
    `📅 重置时间: 每${DAY_NAMES[b.day]} ${pad(b.hour)}:${pad(b.minute)}`,
    `🕐 下次重置: ${formatBeijing(next)}`,
    `📈 当前周数: 第${isoWeek(game.now).week}周`,
    `🔢 已重置次数: ${resets}次`,
    `⏰ 上次重置: ${resets > 0 ? formatBeijing(game.group.startedAt) : '从未重置'}`,
    `💾 保留数据: ${cfg.reset_keep_nickname ? '昵称' : '无'}`,
    `💰 重置身价: ${cfg.reset_base_value}金币`,
  ].join('\n')
}

/**
 * 手动奴隶重置（群主、管理员、Bot 管理员）：只重置本群（上游一个群的管理员能清空所有群）。
 * 二次确认：点按钮，或者发 /手动奴隶重置 确认。确认信息放在按钮自己的数据里，不落库
 */
export async function manualResetCommand(game: Game, args: string[]): Promise<GameReply> {
  if (args[0] === '确认') return doReset(game.ctx, game.session.botId, game.groupId, game.group.season)
  const expireAt = game.now + CONFIRM_MS
  const data = (action: string) => `${action}:${game.group.season}:${expireAt}:${game.userId}`
  const only = { type: 0 as const, specify_user_ids: [game.userId] }
  const sent = await game.session.reply({
    markdown: {
      content: '⚠️ 警告：手动重置将清空**本群**所有玩家的游戏数据！\n\n确认要执行的话，请在 60 秒内点「确认重置」，或者发送 /手动奴隶重置 确认',
    },
    keyboard: keyboard([
      [
        button.callback('确认重置', data('confirm'), { id: 'slave_reset', style: 4, permission: only }),
        button.callback('取消', data('cancel'), { id: 'slave_reset', permission: only }),
      ],
    ]),
  })
  // 机器人没有 markdown 权限时带按键的消息发不出去，退回纯文字
  if (sent.ok) return undefined
  return '⚠️ 警告：手动重置将清空本群所有玩家的游戏数据！\n确认要执行的话，请发送 /手动奴隶重置 确认'
}

async function doReset(ctx: PluginContext<Config>, botId: string, groupId: string, season: number): Promise<GameReply> {
  const now = Date.now()
  const board = await manualReset(ctx.db, groupId, season, now, ctx.config)
  if (!board) return '本群刚刚已经重置过了'
  const header = `✅ 手动重置完成！\n📊 重置统计:\n✅ 成功重置: ${board.playerCount}个玩家\n⏰ 重置时间: ${formatBeijing(now)}`
  return lastWeekBoard(ctx, botId, board, header)
}

/** 确认 / 取消按钮。按钮回调不带群角色，所以靠按钮只许发起人点、数据里再核一遍发起人 */
export async function resetButton(input: ButtonInput<Config>): Promise<OutgoingMessage[] | number | string> {
  const { session, ctx, buttonData } = input
  const [action, seasonText, expireText, owner] = buttonData.split(':')
  if (session.scene !== 'group' || session.userId !== owner) return 4
  if (action === 'cancel') return '操作已取消'
  if (Date.now() > Number(expireText)) return '操作已取消：超时未确认'
  // 过了周界还没人发过命令的话，先按正常流程换期，再判断按钮是不是这一期的
  const { state } = await loadSeason(ctx.db, session.targetId, Date.now(), ctx.config)
  if (state.season !== Number(seasonText)) return '本群已经重置过了，这个按钮失效了'
  const out = await doReset(ctx, session.botId, session.targetId, state.season)
  return Array.isArray(out) ? out : out === undefined ? [] : [out]
}

export function resetHelp(): string {
  return [
    '📖 奴隶市场每周重置帮助',
    '━━━━━━━━━━━━━━━━━━━━',
    '🔄 每周重置功能说明:',
    '• 每周自动重置本群所有玩家的游戏数据',
    '• 默认重置时间：每周一 00:00（北京时间）',
    '• 到点后本群的第一条命令开启新的一周，并附上上周排行榜',
    '',
    '📊 重置内容:',
    '• 金币归零',
    '• 清空奴隶列表和主人关系',
    '• 身价重置为初始值',
    '• 清除所有冷却时间',
    '• 重置银行等级和余额',
    '• 重置竞技排位等级',
    '• 保留昵称（可配置）',
    '',
    '🎮 相关指令:',
    '• /奴隶重置状态 - 查看重置系统状态',
    '• /手动奴隶重置 - 手动重置本群（群主、管理员）',
    '• /上周排行榜 - 查看上周各项排行榜',
    '• /奴隶重置帮助 - 显示此帮助信息',
    '',
    '🏆 排行榜功能:',
    '• 每周重置前自动保存排行榜',
    '• 包含金币、身价、奴隶数量、银行等级排行',
    '• 可随时查看上周排行榜回顾',
    '',
    '⚠️ 注意事项:',
    '• 重置操作不可逆转，只保留上一周的排行榜',
    '• 管理员可以在面板里关闭自动重置功能',
  ].join('\n')
}
