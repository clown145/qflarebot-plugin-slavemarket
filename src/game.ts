import type { CommandInput, OutgoingMessage, PluginContext, ScopedDB, Session } from '@qqbot/sdk'
import type { Config } from './config.js'
import type { Player } from './model.js'
import { type GroupState, loadPlayers, loadSeason, savePlayers } from './store.js'
import { type Mentioned, mentionedUsers } from './targets.js'
import { recapText } from './boards.js'

/** 一条命令的上下文：本群第几期、谁发的、@ 了谁 */
export interface Game {
  session: Session
  ctx: PluginContext<Config>
  cfg: Config
  db: ScopedDB
  groupId: string
  userId: string
  now: number
  group: GroupState
  /** 无视冷却 */
  ignoreCd: boolean
  mentions: Mentioned[]
  /** 读玩家；自己和被 @ 的人顺手换上消息里带的最新昵称（只在这个人被写回时才落库） */
  load(ids: string[]): Promise<Map<string, Player>>
  /**
   * 读 → 算 → 写回。写回带版本号校验，中途被别人改过就重读重算（最多 3 次）。
   * `fn` 返回要写回的人和结果；什么都没改就给空数组，不产生写入
   */
  mutate<T>(ids: string[], fn: (players: Map<string, Player>) => Promise<Mutation<T>> | Mutation<T>): Promise<T>
}

export interface Mutation<T> {
  save: Player[]
  result: T
}

export type GameReply = OutgoingMessage | OutgoingMessage[] | undefined

class Conflict extends Error {}

const ATTEMPTS = 3

function createGame(input: CommandInput<Config>, group: GroupState, now: number): Game {
  const { session, ctx } = input
  const groupId = session.targetId
  const mentions = mentionedUsers(session)
  const names = new Map<string, string>()
  for (const m of mentions) if (m.username) names.set(m.id, m.username)
  if (session.userName) names.set(session.userId, session.userName)

  const game: Game = {
    session,
    ctx,
    cfg: ctx.config,
    db: ctx.db,
    groupId,
    userId: session.userId,
    now,
    group,
    ignoreCd: ctx.config.ignore_cd_users.includes(session.userId),
    mentions,
    async load(ids) {
      const players = await loadPlayers(ctx.db, groupId, ids, group.season, ctx.config)
      for (const p of players.values()) {
        const name = names.get(p.id)
        if (name) p.nickname = name
      }
      return players
    },
    async mutate(ids, fn) {
      for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
        const players = await game.load(ids)
        const { save, result } = await fn(players)
        if (!save.length) return result
        if (await savePlayers(ctx.db, groupId, group, save, now)) return result
      }
      throw new Conflict()
    },
  }
  return game
}

/**
 * 命令外壳：只能在群里玩；先确认本群第几期（到点了就换期，把上期回顾放在回复最前面），再跑命令本身
 */
export function play(handler: (game: Game, input: CommandInput<Config>) => Promise<GameReply> | GameReply) {
  return async (input: CommandInput<Config>): Promise<OutgoingMessage[]> => {
    const { session, ctx } = input
    if (session.scene !== 'group') return ['该游戏只能在群内使用']
    const out: OutgoingMessage[] = []
    try {
      const now = Date.now()
      const { state, advanced } = await loadSeason(ctx.db, session.targetId, now, ctx.config)
      if (advanced) out.push(recapText(advanced))
      const reply = await handler(createGame(input, state, now), input)
      if (Array.isArray(reply)) out.push(...reply)
      else if (reply !== undefined) out.push(reply)
    } catch (err) {
      if (err instanceof Conflict) {
        out.push('刚才有人同时改了相关数据，请再试一次')
      } else {
        ctx.logger.error('奴隶市场处理命令出错', { error: err instanceof Error ? err.stack ?? err.message : String(err) })
        out.push('处理请求时出错，请稍后再试。')
      }
    }
    return out
  }
}
