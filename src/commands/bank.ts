import type { Config } from '../config.js'
import { type Game, type GameReply, noTarget } from '../game.js'
import { type Bank, type Player, bankOf, nameOf, round2 } from '../model.js'
import { positiveInt } from '../targets.js'

const HOUR = 3600 * 1000

/**
 * 把满整小时的利息结出来，返回这一段的利息并把计息起点往后挪。
 * 上游只在领取时按「现在的存款 × 距上次领取的小时数」算：先存 1 块、等一天再存 1 万，领到的是 1 万一整天的利息。
 * 这里每次存取款前先把旧余额的利息结进 accrued，新存的钱从存入时起算
 */
function settle(bank: Bank, cfg: Config, now: number): number {
  const hours = Math.floor((now - bank.interestAt) / HOUR)
  if (hours < 1) return 0
  const effective = Math.min(hours, cfg.bank_max_interest_hours)
  const interest = bank.balance > 0 ? round2(bank.balance * cfg.bank_interest_rate * effective) : 0
  bank.interestAt = hours > cfg.bank_max_interest_hours ? now : bank.interestAt + hours * HOUR
  return interest
}

function pendingInterest(bank: Bank, cfg: Config, now: number): number {
  return round2(bank.accrued + settle({ ...bank }, cfg, now))
}

/** 取出银行账户（没有就按初始值建一个，写回时才落库），并先结一次利息 */
function openBank(p: Player, cfg: Config, now: number): Bank {
  const bank = bankOf(p, cfg, now)
  bank.accrued = round2(bank.accrued + settle(bank, cfg, now))
  p.data.bank = bank
  return bank
}

function spaceFull(bank: Bank, space: number): string {
  return `存款失败！当前存储上限为${bank.limit}金币\n当前存款：${bank.balance}金币\n可存入：${space}金币\n可通过升级信用等级提升存储上限`
}

export async function deposit(game: Game, args: string[]): Promise<GameReply> {
  const amount = positiveInt(args[0])
  if (!amount) return '请输入正确的存款金额'
  return game.mutate([game.userId], (ps) => {
    const me = ps.get(game.userId)!
    if (amount > me.currency) return { save: [], result: '余额不足' }
    const bank = openBank(me, game.cfg, game.now)
    const space = round2(bank.limit - bank.balance)
    if (amount > space) return { save: [], result: spaceFull(bank, space) }
    me.currency = round2(me.currency - amount)
    bank.balance = round2(bank.balance + amount)
    return { save: [me], result: `存款成功！存入${amount}金币\n当前存款：${bank.balance}金币\n当前余额：${me.currency}金币` }
  })
}

/** 一键存款：上游的正则要求后面带数字，单发「一键存款」根本不触发；超过上限时也改成存满为止 */
export async function depositAll(game: Game): Promise<GameReply> {
  return game.mutate([game.userId], (ps) => {
    const me = ps.get(game.userId)!
    if (me.currency <= 0) return { save: [], result: '你一分都没有，让我存寂寞' }
    const bank = openBank(me, game.cfg, game.now)
    const space = round2(bank.limit - bank.balance)
    if (space <= 0) return { save: [], result: spaceFull(bank, Math.max(0, space)) }
    const amount = round2(Math.min(me.currency, space))
    me.currency = round2(me.currency - amount)
    bank.balance = round2(bank.balance + amount)
    const head = me.currency > 0 ? `存储上限只够存入${amount}金币` : `全部存入成功！存入${amount}金币`
    return { save: [me], result: `${head}\n当前存款：${bank.balance}金币\n当前余额：${me.currency}金币` }
  })
}

export async function withdraw(game: Game, args: string[]): Promise<GameReply> {
  const amount = positiveInt(args[0])
  if (!amount) return '请输入正确的取款金额'
  return game.mutate([game.userId], (ps) => {
    const me = ps.get(game.userId)!
    const bank = openBank(me, game.cfg, game.now)
    if (amount > bank.balance) return { save: [], result: '存款余额不足' }
    me.currency = round2(me.currency + amount)
    bank.balance = round2(bank.balance - amount)
    return { save: [me], result: `取款成功！取出${amount}金币\n当前存款：${bank.balance}金币\n当前余额：${me.currency}金币` }
  })
}

function upgradeOnce(me: Player, bank: Bank, cfg: Config): number {
  const price = bank.upgradePrice
  me.currency = round2(me.currency - price)
  bank.level += 1
  bank.limit = Math.floor(bank.limit * cfg.bank_limit_increase_multi)
  bank.upgradePrice = Math.max(1, Math.floor(price * cfg.bank_upgrade_price_multi))
  return price
}

export async function upgradeCredit(game: Game): Promise<GameReply> {
  return game.mutate([game.userId], (ps) => {
    const me = ps.get(game.userId)!
    const bank = openBank(me, game.cfg, game.now)
    if (me.currency < bank.upgradePrice) return { save: [], result: `升级失败！升级需要${bank.upgradePrice}金币\n当前余额：${me.currency}金币` }
    upgradeOnce(me, bank, game.cfg)
    return {
      save: [me],
      result: `升级成功！当前信用等级：${bank.level}\n当前存储上限：${bank.limit}金币\n下次升级费用：${bank.upgradePrice}金币\n当前余额：${me.currency}金币`,
    }
  })
}

/** 一键升级信用。升级费用倍数被配成 1 时上游会死循环，这里设了上限 */
export async function autoUpgradeCredit(game: Game): Promise<GameReply> {
  return game.mutate([game.userId], (ps) => {
    const me = ps.get(game.userId)!
    const bank = openBank(me, game.cfg, game.now)
    let spent = 0
    let upgrades = 0
    while (me.currency >= bank.upgradePrice && upgrades < 1000) {
      spent += upgradeOnce(me, bank, game.cfg)
      upgrades++
    }
    if (!upgrades) return { save: [], result: `升级失败！当前升级需要${bank.upgradePrice}金币\n当前余额：${me.currency}金币` }
    return {
      save: [me],
      result: `一键升级成功！\n共升级 ${upgrades} 次\n当前信用等级：Lv.${bank.level}\n总花费：${spent}金币\n剩余余额：${me.currency}金币\n下次升级费用：${bank.upgradePrice}金币\n当前存储上限：${bank.limit}金币`,
    }
  })
}

export async function bankInfo(game: Game): Promise<GameReply> {
  const me = (await game.load([game.userId])).get(game.userId)!
  const cfg = game.cfg
  const bank = bankOf(me, cfg, game.now)
  return [
    '=====银行信息=====',
    `信用等级：${bank.level}`,
    `当前存款：${bank.balance}金币`,
    `存储上限：${bank.limit}金币`,
    `升级费用：${bank.upgradePrice}金币`,
    `当前余额：${me.currency}金币`,
    `可领利息：${pendingInterest(bank, cfg, game.now)}金币`,
    `利率说明：每小时${round2(cfg.bank_interest_rate * 100)}%，最多计算${cfg.bank_max_interest_hours}小时`,
  ].join('\n')
}

export async function collectInterest(game: Game): Promise<GameReply> {
  return game.mutate([game.userId], (ps) => {
    const me = ps.get(game.userId)!
    const bank = openBank(me, game.cfg, game.now)
    const interest = bank.accrued
    if (interest <= 0) return { save: [], result: '当前没有可领取的利息，每小时结算一次' }
    me.currency = round2(me.currency + interest)
    bank.accrued = 0
    return { save: [me], result: `成功领取利息${interest}金币\n当前存款：${bank.balance}金币\n当前余额：${me.currency}金币` }
  })
}

/** 转账：/转账 金额 @群友。上游先扣自己、再给对方分两次写，这里一条语句写两个人 */
export async function transfer(game: Game, args: string[]): Promise<GameReply> {
  const target = game.mentions[0]?.id
  if (!target) return noTarget(game, '请使用@指定要转账的用户')
  if (target === game.userId) return '不能给自己转账'
  const amount = args.map(positiveInt).find((n) => n !== undefined)
  if (!amount) return '请输入转账金额，例如 /转账 500 @群友'
  const cfg = game.cfg
  if (amount < cfg.transfer_min_amount) return `转账金额不能低于${cfg.transfer_min_amount}金币`
  const fee = Math.ceil(amount * cfg.transfer_fee_rate)
  const total = amount + fee
  return game.mutate([game.userId, target], (ps) => {
    const me = ps.get(game.userId)!
    const to = ps.get(target)!
    if (me.currency < total) return { save: [], result: `余额不足，需要${total}金币（含手续费${fee}）` }
    me.currency = round2(me.currency - total)
    to.currency = round2(to.currency + amount)
    return { save: [me, to], result: `成功转账${amount}金币给${nameOf(to)}\n手续费：${fee}金币\n剩余余额：${me.currency}金币` }
  })
}
