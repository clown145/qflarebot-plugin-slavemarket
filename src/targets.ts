import type { Session } from '@qqbot/sdk'

export interface Mentioned {
  id: string
  username: string
}

interface RawMention {
  id?: unknown
  member_openid?: unknown
  user_openid?: unknown
  nickname?: unknown
  username?: unknown
  bot?: unknown
  is_you?: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

const MENTION = /<@!?([0-9A-Za-z_-]+)>/g

/** 正文开头、命令之前那一串 `<@…>`：「@机器人 购买奴隶 @群友」里前面那个是在叫机器人 */
function leadingMentions(content: string): Set<string> {
  const head = /^(?:\s*<@!?[0-9A-Za-z_-]+>)+/.exec(content)?.[0] ?? ''
  return new Set([...head.matchAll(MENTION)].map((m) => m[1]!))
}

/**
 * 消息里 @ 了谁（不含机器人），按在消息里出现的先后排——`/决斗 @A @B` 要分得清谁是谁。
 *
 * 1. 平台给的 mentions：原始推送（群消息可能是 id / username，也可能是 member_openid / nickname，都读）并上 session.mentions，
 *    标了 bot 或 is_you 的是机器人。
 * 2. 正文里的 `<@openid>`：没开全量消息的群里「@机器人 购买奴隶 @群友」，被 @ 的群友可能只出现在正文里、不在 mentions 里。
 *    机器人在群里的 openid 和 AppID 不是一个，mentions 没标出来时认不出它，所以命令前面那一串 @ 当作在叫机器人、不算目标
 */
export function mentionedUsers(session: Session): Mentioned[] {
  const raw = session.raw as { content?: unknown; mentions?: unknown } | undefined
  const bots = new Set<string>([session.botId])
  const users: Mentioned[] = []
  const add = (id: string, username: string, bot: boolean) => {
    if (!id) return
    if (bot) {
      bots.add(id)
      return
    }
    const known = users.find((u) => u.id === id)
    if (!known) users.push({ id, username })
    else if (!known.username) known.username = username
  }
  for (const m of Array.isArray(raw?.mentions) ? (raw.mentions as RawMention[]) : []) {
    if (!m || typeof m !== 'object') continue
    add(str(m.member_openid) || str(m.id) || str(m.user_openid), str(m.nickname) || str(m.username), m.bot === true || m.is_you === true)
  }
  for (const m of session.mentions) add(m.id, m.username, m.bot)

  const content = typeof raw?.content === 'string' ? raw.content : ''
  const leading = leadingMentions(content)
  for (const m of content.matchAll(MENTION)) {
    const id = m[1]!
    if (bots.has(id) || leading.has(id) || users.some((u) => u.id === id)) continue
    users.push({ id, username: '' })
  }

  const at = (id: string) => {
    const i = content.search(new RegExp(`<@!?${id.replace(/[^0-9A-Za-z_-]/g, '')}>`))
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  return users
    .filter((u) => !bots.has(u.id))
    .map((u, i) => ({ u, i, pos: at(u.id) }))
    .sort((a, b) => a.pos - b.pos || a.i - b.i)
    .map((x) => x.u)
}

/**
 * 需要目标却没找到时写进日志排查用：原始 mentions 每一项有哪些字段、正文里有哪些 `<@…>`。
 * openid 只留后 6 位，昵称只记长度
 */
export function mentionDiagnostics(session: Session): Record<string, unknown> {
  const raw = session.raw as { content?: unknown; mentions?: unknown } | undefined
  const mask = (s: string) => s.replace(/[0-9A-Za-z_-]{7,}/g, (id) => `…${id.slice(-6)}`)
  const scrub = (m: unknown) =>
    m && typeof m === 'object'
      ? Object.fromEntries(
          Object.entries(m).map(([k, v]) => [k, typeof v !== 'string' ? v : k === 'nickname' || k === 'username' ? `<${v.length}字>` : mask(v)]),
        )
      : m
  return {
    event: session.rawType,
    content: mask(str(raw?.content)),
    rawMentions: Array.isArray(raw?.mentions) ? raw.mentions.map(scrub) : (raw?.mentions ?? null),
    sessionMentions: session.mentions.map(scrub),
  }
}

export type TargetToken = { kind: 'mention'; id: string } | { kind: 'index'; n: number }

/**
 * 命令后面依次写了哪些目标：`@某人` 或编号。`/决斗 @A 2` 和 `/决斗 2 @A` 意思不同，
 * 所以按原始正文里出现的先后排；没有原始正文（模拟器、测试）时先编号后 @
 */
export function targetTokens(session: Session, args: string[]): TargetToken[] {
  const mentions = mentionedUsers(session)
  const allowed = new Set(mentions.map((m) => m.id))
  const raw = session.raw as { content?: unknown } | undefined
  const content = typeof raw?.content === 'string' ? raw.content : ''
  if (content) {
    const out: TargetToken[] = []
    // 命令词本身不含数字；机器人的 <@…> 不在 allowed 里，跳过
    for (const m of content.matchAll(/<@!?([0-9A-Za-z_-]+)>|(?<![0-9A-Za-z])(\d+)(?![0-9A-Za-z])/g)) {
      if (m[1] !== undefined) {
        if (allowed.has(m[1])) out.push({ kind: 'mention', id: m[1] })
      } else {
        const n = positiveInt(m[2])
        if (n !== undefined) out.push({ kind: 'index', n })
      }
    }
    if (out.length) return out
  }
  const out: TargetToken[] = []
  for (const a of args) {
    const n = positiveInt(a)
    if (n !== undefined) out.push({ kind: 'index', n })
  }
  for (const m of mentions) out.push({ kind: 'mention', id: m.id })
  return out
}

/** 参数里的正整数（序号、金额），不是就返回 undefined */
export function positiveInt(s: string | undefined): number | undefined {
  if (!s || !/^\d+$/.test(s)) return undefined
  const n = Number(s)
  return n > 0 && Number.isSafeInteger(n) ? n : undefined
}
