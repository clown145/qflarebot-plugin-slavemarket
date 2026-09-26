import type { Session } from '@qqbot/sdk'

export interface Mentioned {
  id: string
  username: string
}

/**
 * 消息里 @ 了谁（不含机器人），按在消息里出现的先后排——`/决斗 @A @B` 要分得清谁是谁。
 * 谁被 @ 只认平台给的 mentions（机器人自己在群里的 openid 和 AppID 不是一个，正文里的 `<@…>` 分不出是不是它）；
 * 原始正文只用来排先后
 */
export function mentionedUsers(session: Session): Mentioned[] {
  const raw = session.raw as { content?: unknown; mentions?: Array<{ is_you?: unknown; id?: unknown }> } | undefined
  const bots = new Set<string>([session.botId])
  for (const m of raw?.mentions ?? []) {
    if (m?.is_you === true && typeof m.id === 'string') bots.add(m.id)
  }
  const users: Mentioned[] = []
  for (const m of session.mentions) {
    if (!m.id || m.bot || bots.has(m.id) || users.some((u) => u.id === m.id)) continue
    users.push({ id: m.id, username: m.username })
  }
  const content = typeof raw?.content === 'string' ? raw.content : ''
  const at = (id: string) => {
    const i = content.search(new RegExp(`<@!?${id.replace(/[^0-9A-Za-z_-]/g, '')}>`))
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  return users.map((u, i) => ({ u, i, pos: at(u.id) })).sort((a, b) => a.pos - b.pos || a.i - b.i).map((x) => x.u)
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
