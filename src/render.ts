import { type PluginContext, qqAvatar } from '@qqbot/sdk'
import type { Config } from './config.js'

/** 内置 t2i 插件导出的服务里用到的那一个方法（类型从它的源码抄来，插件之间不互相 import） */
interface T2IService {
  renderUrl?(html: string, options?: { width?: number; height?: number; type?: 'jpeg' | 'png'; quality?: number; fullPage?: boolean }): Promise<{ url: string }>
}

/**
 * HTML → 图片地址。图存在 T2I 服务上、QQ 直接去拉，图片字节不经过 Worker。
 * 关了图片、t2i 插件没有 renderUrl（框架太旧）或渲染失败都返回 null，调用方改发文字
 */
export async function renderImage(ctx: PluginContext<Config>, html: string): Promise<string | null> {
  if (!ctx.config.use_image) return null
  let t2i: T2IService
  try {
    t2i = ctx.service<T2IService>('t2i')
  } catch {
    return null
  }
  if (typeof t2i?.renderUrl !== 'function') return null
  try {
    // 服务端视口最小 1280x720，模板都按 1280 宽排
    const { url } = await t2i.renderUrl(html, { width: 1280, height: 720, type: 'jpeg', quality: 85, fullPage: true })
    return url
  } catch (err) {
    ctx.logger.warn('t2i 渲染失败，改发文字', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * 页面骨架。T2I 的视口最小 1280 宽：窄版式按 640 排再放大 2 倍，刚好 1280 且字清楚；宽版式直接按 1280 排
 */
function page(css: string, body: string, layout: 'narrow' | 'wide' = 'narrow'): string {
  const size = layout === 'narrow' ? 'width:640px;zoom:2' : 'width:1280px'
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><style>
*{box-sizing:border-box}
html{margin:0}
body{margin:0;${size};font-family:"PingFang SC","Microsoft YaHei","Noto Sans CJK SC","Noto Sans SC","WenQuanYi Micro Hei",sans-serif}
${css}</style></head><body>${body}</body></html>`
}

function avatar(botId: string, id: string): string {
  return qqAvatar(botId, id, 100)
}

// ─── 打工报告（上游 work/index.html） ────────────────────────────────────────

export interface WorkLine {
  name: string
  work: string
  income: string
}

export function workHtml(lines: WorkLine[], wages: number, expense: string, balance: number): string {
  const css = `
html{background:#fff}
body{padding:20px;line-height:1.6;color:#666}
h1{color:#333;text-align:center;margin:8px 0 20px}
.work-report{background:#f0f0f0;border-left:4px solid #4CAF50;margin-bottom:15px;padding:10px}
.work-report p{margin:0}
.username{color:#1e88e5;font-weight:bold}
.income{color:#43a047;font-weight:bold}
.expense{background:#fff4e5;border-left:4px solid #ffa000;padding:10px;margin-bottom:15px}
.summary{font-weight:bold;margin-top:20px;color:#333}
.total-income{color:#e53935}
.current-balance{color:#ffa000}`
  const items = lines
    .map((l) => `<div class="work-report"><p><span class="username">【${esc(l.name)}】</span>${esc(l.work)}<span class="income">${esc(l.income)}</span></p></div>`)
    .join('')
  const exp = expense ? `<div class="expense">${esc(expense)}</div>` : ''
  return page(
    css,
    `<h1>群友打工报告</h1>${items}${exp}<p class="summary">你总共获取<span class="total-income">${esc(wages)}金币</span>，当前共有<span class="current-balance">${esc(balance)}金币</span></p>`,
  )
}

// ─── 一键训练（上游 training/index.html） ────────────────────────────────────

export interface TrainResult {
  id: string
  name: string
  result: string
  valueChange: number
  currentValue: number
  status: 'success' | 'failed' | 'resting' | 'poor'
  remainingTime?: string
}

export interface TrainSummary {
  total: number
  success: number
  failed: number
  skipped: number
  cost: number
  remaining: number
}

export function trainingHtml(botId: string, s: TrainSummary, results: TrainResult[]): string {
  const css = `
html{background:#121212}
body{color:#fff;line-height:1.5;padding:24px}
h1{font-size:30px;color:#bb86fc;text-align:center;letter-spacing:2px;margin:4px 0 20px}
.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
.item{background:#1e1e1e;padding:12px;border-radius:12px;display:flex;flex-direction:column;align-items:center}
.label{font-size:13px;color:rgba(255,255,255,.7)}
.value{font-size:20px;font-weight:bold;color:#03dac6}
.value.success{color:#00e676}.value.failed{color:#cf6679}
.results{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.card{background:#1e1e1e;border-radius:12px;display:flex;gap:12px;padding:12px;align-items:center}
.card.success{box-shadow:0 0 0 2px #00e676}.card.failed,.card.poor{box-shadow:0 0 0 2px #cf6679}.card.resting{box-shadow:0 0 0 2px #03dac6}
.avatar{width:64px;height:64px;border-radius:10px;object-fit:cover;flex:none;background:#333}
.name{font-size:16px;font-weight:bold;color:#bb86fc;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px}
.line{margin:0;font-size:13px;color:rgba(255,255,255,.7)}
.up{margin:0;font-size:13px;color:#00e676;font-weight:bold}
.cd{margin:0;font-size:13px;color:#03dac6}`
  const stat = (label: string, value: string | number, cls = '') => `<div class="item"><span class="label">${label}</span><span class="value ${cls}">${esc(value)}</span></div>`
  const cards = results
    .map(
      (r) => `<div class="card ${r.status}"><img class="avatar" src="${esc(avatar(botId, r.id))}"><div>
<p class="name">${esc(r.name)}</p><p class="line">${esc(r.result)}</p>
${r.valueChange > 0 ? `<p class="up">身价 +${esc(r.valueChange)}</p>` : ''}
${r.remainingTime ? `<p class="cd">剩余CD：${esc(r.remainingTime)}</p>` : ''}
<p class="line">当前身价：${esc(r.currentValue)}</p></div></div>`,
    )
    .join('')
  return page(
    css,
    `<h1>训练结果报告</h1><div class="summary">${stat('总奴隶数', s.total)}${stat('成功', s.success, 'success')}${stat('失败', s.failed, 'failed')}${stat('休息中 / 金币不足', s.skipped)}${stat('总花费', `${s.cost}金币`)}${stat('剩余金币', s.remaining)}</div><div class="results">${cards}</div>`,
  )
}

// ─── 身价 / 资金排行榜（上游 rankings/index.html） ───────────────────────────

export interface RankRow {
  id: string
  name: string
  value: number
}

export function rankingHtml(botId: string, type: string, rows: RankRow[]): string {
  const css = `
html{background:#f5f5f5}
body{padding:20px;color:#333}
h1{color:#2c3e50;text-align:center;font-size:32px;margin:6px 0 16px}
table{width:100%;border-collapse:separate;border-spacing:0 8px}
th,td{padding:10px 12px;text-align:left;background:#fff}
th{background:#3498db;color:#fff}
.player{display:flex;align-items:center}
.avatar{width:40px;height:40px;border-radius:50%;margin-right:12px;object-fit:cover;background:#ddd}
.nickname{font-weight:bold}
.rank{font-weight:bold;color:#e74c3c;width:60px}
.value{font-weight:bold;color:#27ae60}
.empty{text-align:center;color:#999}`
  const body = rows.length
    ? rows
        .map(
          (r, i) => `<tr><td class="rank">${i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</td><td><div class="player"><img class="avatar" src="${esc(avatar(botId, r.id))}"><span class="nickname">${esc(r.name)}</span></div></td><td class="value">${esc(r.value)}</td></tr>`,
        )
        .join('')
    : '<tr><td class="empty" colspan="3">暂无数据</td></tr>'
  return page(css, `<h1>${esc(type)}排行榜</h1><table><thead><tr><th>排名</th><th>玩家</th><th>${esc(type)}</th></tr></thead><tbody>${body}</tbody></table>`)
}

// ─── 奴隶市场（上游 slaveList/index.html） ───────────────────────────────────

export interface MarketRow {
  id: string
  name: string
  value: number
  master: string
}

export function marketHtml(botId: string, rows: MarketRow[], hidden: number): string {
  const css = `
html{background:linear-gradient(45deg,#f8f9fa 0%,#e9ecef 100%)}
body{padding:30px 24px;color:#2B2C34}
h1{color:#7F5AF0;font-size:44px;letter-spacing:-1px;margin:0 0 6px;text-align:center}
.tip{text-align:center;color:#666;font-size:20px;margin:0 0 50px}
.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:50px 20px}
.card{background:#fff;border-radius:18px;padding:0 14px 14px;box-shadow:0 4px 12px rgba(0,0,0,.1);position:relative}
.no{position:absolute;top:10px;left:12px;font-weight:bold;color:#7F5AF0;font-size:20px}
.avatar{display:block;width:80px;height:80px;border-radius:50%;margin:-40px auto 10px;border:4px solid #fff;box-shadow:0 4px 12px rgba(0,0,0,.1);background:#eee;object-fit:cover}
.row{padding:8px 10px;margin:8px 0 0;background:#f5f5f5;border-radius:10px;font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.status{background:#ffeef0}
.master{color:#2CB67D;font-weight:600}
.more{text-align:center;color:#666;font-size:20px;margin-top:40px}`
  const cards = rows
    .map(
      (r, i) => `<div class="card"><span class="no">${i + 1}</span><img class="avatar" src="${esc(avatar(botId, r.id))}">
<div class="row">👤 ${esc(r.name)}</div><div class="row status">💰 身价: ${esc(r.value)}</div><div class="row master">👑 主人: ${esc(r.master || '自由身')}</div></div>`,
    )
    .join('')
  const more = hidden > 0 ? `<p class="more">还有 ${hidden} 人没列出</p>` : ''
  return page(css, `<h1>✨ 奴隶市场 ✨</h1><p class="tip">未出现在市场里的都只值 100 · 按编号购买：/购买奴隶 编号</p><div class="cards">${cards}</div>${more}`, 'wide')
}

// ─── 上周排行榜（上游是连发 6 条文字，这里合成一张） ─────────────────────────

export interface BoardSection {
  title: string
  rows: Array<{ id: string; name: string; value: string }>
}

export function boardHtml(botId: string, title: string, subtitle: string, sections: BoardSection[]): string {
  const css = `
html{background:#1b1d2a}
body{padding:36px;color:#fff}
h1{text-align:center;font-size:44px;margin:0;color:#ffd166}
.sub{text-align:center;color:#aab;font-size:22px;margin:8px 0 30px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.board{background:#262a3d;border-radius:18px;padding:18px 22px}
h2{margin:0 0 10px;font-size:26px;color:#8ecae6}
.row{display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid #33384f;font-size:21px}
.row:last-child{border-bottom:none}
.rank{width:40px;text-align:center;font-weight:bold;color:#ffd166}
.avatar{width:36px;height:36px;border-radius:50%;background:#444;object-fit:cover}
.name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.val{color:#95d5b2;font-weight:bold}
.empty{color:#889;font-size:20px}`
  const medal = (i: number) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1))
  const boards = sections
    .map(
      (s) => `<div class="board"><h2>${esc(s.title)}</h2>${
        s.rows.length
          ? s.rows
              .map((r, i) => `<div class="row"><span class="rank">${medal(i)}</span><img class="avatar" src="${esc(avatar(botId, r.id))}"><span class="name">${esc(r.name)}</span><span class="val">${esc(r.value)}</span></div>`)
              .join('')
          : '<p class="empty">暂无数据</p>'
      }</div>`,
    )
    .join('')
  return page(css, `<h1>${esc(title)}</h1><p class="sub">${esc(subtitle)}</p><div class="grid">${boards}</div>`, 'wide')
}

// ─── 帮助（上游 help/index.html，指令改成框架的写法） ────────────────────────

export interface HelpGroup {
  title: string
  items: Array<{ emoji: string; command: string; desc: string; example: string }>
}

export function helpHtml(groups: HelpGroup[]): string {
  const css = `
html{background:linear-gradient(-45deg,#ee7752,#e73c7e,#23a6d5,#23d5ab)}
body{padding:20px}
.container{background:rgba(255,255,255,.1);border-radius:20px;padding:24px;box-shadow:0 8px 32px rgba(31,38,135,.37)}
h1{color:#fff;text-align:center;font-size:32px;margin:0 0 20px}
.group{background:rgba(0,0,0,.2);border-radius:15px;padding:16px 18px;margin-bottom:16px}
h2{color:#FFD700;text-align:center;font-size:24px;margin:0 0 8px;text-shadow:0 0 10px rgba(255,215,0,.5)}
dl{margin:0}
dt{font-weight:bold;margin-top:14px;color:#FFD700;font-size:17px;text-shadow:2px 2px 4px rgba(0,0,0,.5)}
.emoji{display:inline-block;width:1.5em;text-align:center;margin-right:6px}
dd{margin:6px 0 0 2.2em;color:#fff;background:rgba(255,255,255,.1);padding:8px 10px;border-radius:10px;font-size:15px}
dd.example{font-style:italic;color:#ddd;font-size:14px;border-left:3px solid rgba(255,215,0,.5);background:rgba(0,0,0,.2);border-radius:0 10px 10px 0}`
  const body = groups
    .map(
      (g) => `<div class="group"><h2>${esc(g.title)}</h2><dl>${g.items
        .map((it) => `<dt><span class="emoji">${it.emoji}</span>${esc(it.command)}</dt><dd>${esc(it.desc)}</dd><dd class="example">示例：${esc(it.example)}</dd>`)
        .join('')}</dl></div>`,
    )
    .join('')
  return page(css, `<div class="container"><h1>🌟 奴隶市场帮助 🌟</h1>${body}</div>`)
}
