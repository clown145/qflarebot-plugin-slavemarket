import copywriting from '../copywriting.json'
import { type Game, type GameReply, noTarget } from '../game.js'
import { type Player, nameOf, round2, sample } from '../model.js'
import { marketHtml, renderImage } from '../render.js'
import { loadGroupPlayers, loadSlaves } from '../store.js'
import { CALENDAR_WEEK, hoursMinutes, weekIndex } from '../time.js'
import type { TargetToken } from '../targets.js'

/** 市场的排序：身价从高到低。编号就是这个顺序里的位置，/购买奴隶 编号 用的也是它 */
export function marketOrder(players: Player[]): Player[] {
  return [...players].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
}

/** 编号或 @ → openid。编号在 `list` 里找（市场或「我的奴隶」），越界返回 undefined */
export async function resolveTarget(token: TargetToken | undefined, list: () => Promise<Player[]>): Promise<string | undefined> {
  if (!token) return undefined
  if (token.kind === 'mention') return token.id
  return (await list())[token.n - 1]?.id
}

export function mySlaves(game: Game): () => Promise<Player[]> {
  return () => loadSlaves(game.db, game.groupId, game.userId, game.group.season, game.cfg)
}

const money = (n: number) => n.toFixed(2)

/** 奴隶市场（上游 slaveList.js）：本群所有人按身价排好，前 market_limit 个出图 */
export async function market(game: Game): Promise<GameReply> {
  const all = marketOrder(await loadGroupPlayers(game.db, game.groupId, game.group.season, game.cfg))
  const byId = new Map(all.map((p) => [p.id, p]))
  const masterName = (p: Player) => {
    if (!p.master) return ''
    const m = byId.get(p.master)
    return m ? nameOf(m) : nameOf({ id: p.master, nickname: '' })
  }
  const shown = all.slice(0, game.cfg.market_limit)
  if (!shown.length) return '市场里还没有人，先 /打工 赚点金币吧\n未出现在市场里的都只值100'
  const rows = shown.map((p) => ({ id: p.id, name: nameOf(p), value: p.value, master: masterName(p) }))
  const url = await renderImage(game.ctx, marketHtml(game.session.botId, rows, all.length - shown.length))
  if (url) return { image: { url } }
  const lines = rows.map((r, i) => `${i + 1}. ${r.name}  💰${r.value}  👑${r.master || '自由身'}`)
  const more = all.length > shown.length ? `\n…还有 ${all.length - shown.length} 人没列出` : ''
  return `✨ 奴隶市场 ✨\n未出现在市场里的都只值100\n${lines.join('\n')}${more}\n按编号购买：/购买奴隶 编号`
}

/** 购买奴隶（上游 purchaseSlaves.js）：目标是 @群友 或市场编号 */
export async function purchase(game: Game, tokens: TargetToken[]): Promise<GameReply> {
  const target = await resolveTarget(tokens[0], async () => marketOrder(await loadGroupPlayers(game.db, game.groupId, game.group.season, game.cfg)))
  if (!target) return noTarget(game, '请 @ 要购买的群友，或者发 /购买奴隶 市场编号（发 /奴隶市场 查看编号）')
  if (target === game.session.botId) return '不可以购买我捏~'
  if (target === game.userId) return '不可以购买自己捏~'

  return game.mutate([game.userId, target], async (ps) => {
    const buyer = ps.get(game.userId)!
    const slave = ps.get(target)!
    const price = round2(slave.value)
    const slaveName = nameOf(slave)

    if (slave.master === buyer.id) return { save: [], result: '你已经是他的主人了' }
    if (buyer.currency < price) return { save: [], result: `你买不起！需要${price}金币` }
    const cd = game.cfg.purchase_cooldown * 1000
    const since = game.now - (buyer.data.purchaseAt ?? 0)
    if (!game.ignoreCd && since < cd) return { save: [], result: `购买冷却中，剩余时间：${hoursMinutes(cd - since)}` }
    if (slave.id === buyer.master) return { save: [], result: sample(copywriting.buyMaster) }

    const buyerLeft = round2(buyer.currency - price)
    buyer.currency = buyerLeft
    buyer.data.purchaseAt = game.now
    const before = slave.value
    slave.value = round2(slave.value + 20)
    slave.data.boughtAt = game.now

    if (!slave.master) {
      slave.currency = round2(slave.currency + price)
      slave.master = buyer.id
      return {
        save: [buyer, slave],
        result: `成功购买了${slaveName}！花费了${money(price)}金币，还剩${money(buyerLeft)}金币\n${slaveName}获得了${money(price)}金币，现在拥有${money(slave.currency)}金币，身价上涨${money(before)}->${money(slave.value)}`,
      }
    }

    // 从别人手里买：钱给原主人，被买的人额外得十分之一（上游文案这么写，代码却给了全额，按文案改）
    const owner = (await game.load([slave.master])).get(slave.master)!
    owner.currency = round2(owner.currency + price)
    const bonus = round2(price / 10)
    slave.currency = round2(slave.currency + bonus)
    slave.master = buyer.id
    const ownerName = nameOf(owner)
    return {
      save: [buyer, slave, owner],
      result: `成功从${ownerName}那里购买了${slaveName}！花费了${money(price)}金币，还剩${money(buyerLeft)}金币\n${ownerName}获得了${money(price)}金币，现在拥有${money(owner.currency)}金币\n${slaveName}额外获得了${money(bonus)}金币，现在拥有${money(slave.currency)}金币，身价上涨${money(before)}->${money(slave.value)}`,
    }
  })
}

/** 放生奴隶（上游 releaseSlave.js）：只改奴隶那一行 */
export async function release(game: Game, tokens: TargetToken[]): Promise<GameReply> {
  const target = await resolveTarget(tokens[0], mySlaves(game))
  if (!target) return noTarget(game, '请指定要放生的奴隶：/放生奴隶 序号（发 /我的奴隶 查看序号）或 /放生奴隶 @群友')
  return game.mutate([target], (ps) => {
    const slave = ps.get(target)!
    if (slave.master !== game.userId) return { save: [], result: '你不是该奴隶的主人' }
    slave.master = ''
    delete slave.data.boughtAt
    return { save: [slave], result: `成功放生了${nameOf(slave)}` }
  })
}

/** 赎身（上游 BuyBackSelf.js）：两倍身价买回自己，身价 ×1.2，再交一笔税 */
export async function buyBack(game: Game): Promise<GameReply> {
  return game.mutate<string | string[]>([game.userId], async (ps) => {
    const me = ps.get(game.userId)!
    if (!me.master) return { save: [], result: '你还没有主人，不需要赎身' }
    const price = round2(me.value * 2)
    if (me.currency < price) return { save: [], result: `你买不起自己！需要${price}金币` }

    // 次数按自然周算（上游要求「不同周且超过 7 天」才清零，周日用完次数、下周一还是赎不了）
    const week = weekIndex(game.now, CALENDAR_WEEK)
    const times = me.data.buyBackWeek === week ? (me.data.buyBackTimes ?? 0) : 0
    if (times >= game.cfg.buyback_max_times) return { save: [], result: '本周赎身次数已达上限，请下周再试' }
    const remaining = game.cfg.buyback_cooldown * 1000 - (game.now - (me.data.buyBackAt ?? 0))
    if (!game.ignoreCd && remaining > 0) return { save: [], result: `赎身冷却中，剩余时间：${hoursMinutes(remaining)}` }

    const owner = (await game.load([me.master])).get(me.master)!
    me.currency = round2(me.currency - price)
    me.value = round2(me.value * 1.2)
    me.master = ''
    delete me.data.boughtAt
    me.data.buyBackAt = game.now
    me.data.buyBackTimes = times + 1
    me.data.buyBackWeek = week
    const tax = round2(me.currency * game.cfg.buyback_tax_rate)
    me.currency = round2(me.currency - tax)
    owner.currency = round2(owner.currency + price)

    return {
      save: [me, owner],
      result: [
        `你支付了${tax}金币的税收`,
        `成功以${price}金币买回了自己！\n现在你的身价是${me.value}金币\n${nameOf(owner)}获得了${price}金币，现在拥有${owner.currency}金币\n你现在拥有${me.currency}金币`,
      ],
    }
  })
}

const MY_SLAVES_SHOWN = 50

/** 我的奴隶（上游 mySlave.js，原来是合并转发）：序号给 /训练、/放生奴隶、/参加排位赛、/决斗 用 */
export async function mySlaveList(game: Game): Promise<GameReply> {
  const me = (await game.load([game.userId])).get(game.userId)!
  const slaves = await mySlaves(game)()
  const master = me.master ? nameOf((await game.load([me.master])).get(me.master)!) : '无'
  const lines = [`# 基础信息\n金币: ${me.currency}\n身价: ${me.value}\n拥有奴隶数量: ${slaves.length}\n主人: ${master}`]
  if (!slaves.length) {
    lines.push('你还没有奴隶')
  } else {
    lines.push(
      '# 我的奴隶',
      ...slaves.slice(0, MY_SLAVES_SHOWN).map((s, i) => `${i + 1}. ${nameOf(s)}  身价: ${s.value}`),
    )
    if (slaves.length > MY_SLAVES_SHOWN) lines.push(`…还有 ${slaves.length - MY_SLAVES_SHOWN} 个没列出`)
    lines.push('序号可用于 /训练、/放生奴隶、/参加排位赛、/决斗')
  }
  return lines.join('\n')
}
