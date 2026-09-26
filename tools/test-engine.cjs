'use strict';
/*
 * 龙虎斗（兽棋版）引擎测试
 * 用法：node tools/test-engine.cjs
 * 说明：从 index.html 中抽取纯规则引擎（ENGINE_START/ENGINE_END 之间）+ UI 脚本，做规则断言、语法检查、DOM id 引用检查与随机自对弈冒烟测试。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
const failures = [];
function ok(cond, msg){ if(cond){ pass++; } else { failures.push(msg); } }
function eq(a, b, msg){ ok(Object.is(a, b), msg + ' | got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b)); }

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

/* ── 抽取引擎 ── */
const em = html.match(/\/\*==ENGINE_START==\*\/([\s\S]*?)\/\*==ENGINE_END==\*\//);
ok(!!em, 'index.html 应包含 ENGINE 标记');
if(!em){ report(); process.exit(1); }

const buildFile = path.join(__dirname, '.engine.build.cjs');
fs.writeFileSync(buildFile,
  em[1] + '\nmodule.exports = { SIDES, CARDS, CARD_MAP, otherSide, otherPlayer, createGame, playerSide, ' +
  'pname, label, neighbors, canCapture, isMutualKill, actionsFor, hasAnyAction, pieceCount, allRevealed, anyCapturePossible, checkOver, applyFlip, applyMove };\n',
  'utf8');
const E = require(buildFile);

/* ── UI 脚本语法检查 ── */
const uiMatch = html.match(/<script id="ui">([\s\S]*?)<\/script>/);
ok(!!uiMatch, 'index.html 应有 UI 脚本');
if(uiMatch){
  try { new vm.Script(uiMatch[1], { filename:'ui.js' }); pass++; }
  catch(err){ failures.push('UI 脚本语法错误：' + err.message); }

  const idsInHtml = new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g)).map(m => m[1]));
  const idsUsed = new Set(Array.from(uiMatch[1].matchAll(/\$\('([^']+)'\)/g)).map(m => m[1]));
  idsUsed.forEach(id => ok(idsInHtml.has(id), 'UI 引用了不存在的元素 id：' + id));
  ok(idsUsed.size > 10, 'UI 应引用多个元素 id（当前 ' + idsUsed.size + ' 个）');
}

/* ── 工具 ── */
function blankState(opts){
  const o = Object.assign({ n:4, diagonal:false, tigerEatsAll:false }, opts || {});
  const total = o.n * o.n;
  return {
    n:o.n, total:total, diagonal:o.diagonal, tigerEatsAll:o.tigerEatsAll,
    kingEatsWeakest:!!o.kingEatsWeakest,
    mutualKill:o.mutualKill !== false,
    noCaptureLimit:0, sinceCapture:0,
    cells:new Array(total).fill(null), turn:'A', sideA:'D', sideB:'T',
    names:{ A:'玩家1', B:'玩家2' }, captured:{ A:[], B:[] }, mutualGone:[], moves:0, log:[], over:null
  };
}
function put(s, idx, cardId, up){ s.cells[idx] = { cardId:cardId, up: up !== false }; }
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── 1. 牌组构成 ── */
eq(E.CARDS.length, 16, '一副应为 16 张牌');
eq(new Set(E.CARDS.map(c => c.id)).size, 16, '牌 id 应互不重复');
eq(E.CARDS.map(c => c.num).sort((a,b) => a-b).join(','), '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16', '编号应为 1..16');
eq(E.CARDS.filter(c => c.side === 'D').map(c => c.rank).sort((a,b)=>a-b).join(','), '1,2,3,4,5,6,7,8', '龙方 rank 应为 1..8');
eq(E.CARDS.filter(c => c.side === 'T').map(c => c.rank).sort((a,b)=>a-b).join(','), '1,2,3,4,5,6,7,8', '虎方 rank 应为 1..8');
eq(E.CARD_MAP.D1.name, '龙王', '1 号应为龙王');
eq(E.CARD_MAP.D8.name, '变形龙', '8 号应为变形龙');
eq(E.CARD_MAP.T1.name, '虎王', '9 号应为虎王');
eq(E.CARD_MAP.T7.name, '白虎', '15 号应为白虎');
eq(E.CARD_MAP.T8.name, '小王虎', '16 号应为小王虎');

/* ── 2. 开局摆牌 ── */
[4, 5, 6].forEach(n => {
  const s = E.createGame({ n:n, rand:mulberry32(n) });
  eq(s.total, n * n, n + '×' + n + ' 棋盘格数');
  const occupied = s.cells.filter(Boolean).length;
  eq(occupied, 16, n + '×' + n + ' 应恰好落 16 张牌');
  ok(s.cells.filter(Boolean).every(c => c.up === false), n + '×' + n + ' 开局应全部背面朝上');
  eq(new Set(s.cells.filter(Boolean).map(c => c.cardId)).size, 16, n + '×' + n + ' 牌面不应重复');
  eq(s.sideA, null, '开局双方阵营未定');
  eq(s.turn, 'A', '玩家1 先手');
});

/* ── 3. 相邻格 ── */
{
  const s = blankState({ n:4 });
  eq(E.neighbors(s, 0).join(','), '1,4', '4×4 角落 0 的正交邻居应为 1,4');
  eq(E.neighbors(s, 5).sort((a,b)=>a-b).join(','), '1,4,6,9', '中心格 5 应有 4 个正交邻居');
  const d = blankState({ n:4, diagonal:true });
  eq(E.neighbors(d, 0).sort((a,b)=>a-b).join(','), '1,4,5', '开启斜走后角落应有 3 个邻居');
  eq(E.neighbors(d, 5).length, 8, '开启斜走后中心格应有 8 个邻居');
}

/* ── 4. 吃子矩阵 ── */
{
  const cc = (a, b, t, k) => E.canCapture(a, b, !!t, !!k);
  eq(cc('D1','T2'), true,  '龙王吃东北虎');
  eq(cc('T1','D2'), true,  '虎王吃神龙');
  eq(cc('D5','T8'), true,  '赤龙吃小王虎');
  eq(cc('D1','T1'), false, '龙王与虎王同级不能互吃');
  eq(cc('D4','T4'), false, '青龙与下山虎同级不能互吃');
  eq(cc('D8','T8'), false, '变形龙与小王虎同级不能互吃');
  eq(cc('D8','T1'), true,  '变形龙可吃虎王（特殊）');
  eq(cc('T8','D1'), true,  '小王虎可吃龙王（特殊）');
  eq(cc('D1','T8'), false, '龙王吃不了小王虎（斗兽棋式单向克制，默认）');
  eq(cc('T1','D8'), false, '虎王吃不了变形龙（斗兽棋式单向克制，默认）');
  eq(cc('D2','T8'), true,  '神龙照样能吃小王虎');
  eq(cc('T3','D8'), true,  '大头虎照样能吃变形龙');
  eq(cc('D1','T8', false, true), true, '改成纯级别制后龙王可以吃小王虎');
  eq(cc('T1','D8', false, true), true, '改成纯级别制后虎王可以吃变形龙');
  eq(cc('D1','T8', true),  false, '开启“小王虎通吃”也不影响龙王吃不了小王虎');
  eq(cc('T8','D5'), false, '默认小王虎吃不了赤龙');
  eq(cc('T8','D5', true), true, '开启“通吃”后小王虎可吃赤龙');
  eq(cc('T8','D1', true), true, '开启“通吃”后小王虎仍可吃龙王');
  eq(cc('D3','D5'), false, '同阵营不能互吃');
  eq(cc('D1','T1', true), false, '开启“通吃”也不影响龙王对虎王');
}

/* ── 5. 首翻定阵营 ── */
{
  const s = E.createGame({ n:4, rand:mulberry32(7) });
  eq(E.actionsFor(s, 'A').flips.length, 16, '首手可翻 16 张暗牌');
  eq(E.actionsFor(s, 'A').moves.length, 0, '阵营未定时不能走子');
  const first = s.cells.findIndex(c => c && c.cardId === 'D1');
  const r = E.applyFlip(s, first);
  eq(r.ok, true, '翻牌应成功');
  eq(s.sideA, 'D', '翻出龙王后玩家1 应为龙方');
  eq(s.sideB, 'T', '玩家2 应为虎方');
  eq(s.turn, 'B', '翻牌后应轮到玩家2');
  eq(s.cells[first].up, true, '翻开的牌应朝上');
  const r2 = E.applyFlip(s, first);
  eq(r2.ok, false, '同一张牌不能翻两次');
  const onEmpty = E.applyFlip(s, s.cells.findIndex(c => c === null));
  eq(onEmpty.ok, false, '空格不能翻牌');
}

/* ── 6. 走子与吃子 ── */
{
  const s = blankState({ n:4 });
  put(s, 0, 'D1');            // 龙王在角上，周围空
  put(s, 1, 'T5');            // 绿虎紧邻
  const acts = E.actionsFor(s, 'A').moves;
  ok(acts.some(m => m.from === 0 && m.to === 4 && !m.capture), '龙王应能走到空格 4');
  ok(acts.some(m => m.from === 0 && m.to === 1 && m.capture), '龙王应能吃紧邻的绿虎');
  ok(!acts.some(m => m.to === 2), '不能一步跨到不相邻的格');

  const mv = E.applyMove(s, 0, 4);
  eq(mv.ok, true, '走空格应成功');
  eq(s.cells[4].cardId, 'D1', '走子后棋子应在目标格');
  eq(s.cells[0], null, '走子后原格应为空');
  eq(s.turn, 'B', '走子后应换手');

  const s2 = blankState({ n:4 });
  put(s2, 0, 'D1');
  put(s2, 1, 'T5');
  const cap = E.applyMove(s2, 0, 1);
  eq(cap.ok, true, '吃子应成功');
  eq(cap.capture, true, '应标记为吃子');
  eq(cap.capturedId, 'T5', '被吃的是绿虎');
  eq(s2.cells[1].cardId, 'D1', '吃子后攻击方占据目标格');
  eq(s2.captured.A.join(','), 'T5', '战利品应记在玩家1 名下');
  eq(s2.over && s2.over.winner, 'A', '吃掉对方最后一子应立即判胜');
  eq(E.applyMove(s2, 1, 2).ok, false, '对局结束后不能再走子');

  const s3 = blankState({ n:4 });
  put(s3, 0, 'D5');
  put(s3, 1, 'T1');           // 虎王比赤龙大，吃不动
  eq(E.applyMove(s3, 0, 1).ok, false, '级别不够不能吃');
  eq(E.actionsFor(s3, 'A').moves.some(m => m.to === 1), false, '吃不动时不应提示该目标');

  const s4 = blankState({ n:4 });
  put(s4, 0, 'T8');           // 小王虎
  put(s4, 1, 'D2', false);    // 暗牌
  eq(E.actionsFor(s4, 'T').moves.some(m => m.to === 1), false, '不能吃暗牌');
  eq(E.actionsFor(s4, 'T').moves.some(m => m.to === 4), true, '可以走到空格');

  const s5 = blankState({ n:4 });
  put(s5, 0, 'D1');
  put(s5, 2, 'T2');           // 不相邻
  eq(E.applyMove(s5, 0, 2).ok, false, '不相邻不能走');
}

/* ── 6b. 王与对方最小牌的单向克制（默认，斗兽棋式） ── */
{
  const s = blankState({ n:4 });
  put(s, 0, 'D1');            /* 龙王 */
  put(s, 1, 'T8');            /* 小王虎 */
  eq(s.kingEatsWeakest, false, '默认应为斗兽棋式单向克制');
  eq(E.actionsFor(s, 'A').moves.some(m => m.to === 1), false, '龙王不应提示可以吃小王虎');
  eq(E.applyMove(s, 0, 1).ok, false, '龙王不能吃小王虎');

  const t = blankState({ n:4 });
  t.turn = 'B';
  put(t, 0, 'D1');
  put(t, 1, 'T8');
  ok(E.actionsFor(t, 'B').moves.some(m => m.to === 0 && m.capture), '小王虎应能反杀龙王');
  eq(E.applyMove(t, 1, 0).ok, true, '小王虎吃龙王应成功');

  const u = blankState({ n:4 });
  put(u, 0, 'D8');            /* 变形龙 */
  put(u, 1, 'T8');            /* 小王虎：同级 —— 关掉同归于尽时互不能吃 */
  u.mutualKill = false;
  eq(E.actionsFor(u, 'A').moves.some(m => m.to === 1), false, '关掉同归于尽后，变形龙与小王虎互不能吃');
  const u2 = blankState({ n:4 });
  put(u2, 0, 'D8');
  put(u2, 1, 'T8');
  ok(E.actionsFor(u2, 'A').moves.some(m => m.to === 1 && m.mutual), '开着同归于尽时，同级可以撞上去');

  const v = blankState({ n:4 });
  put(v, 0, 'D3');            /* 金龙，中间级别 */
  put(v, 1, 'T8');
  ok(E.actionsFor(v, 'A').moves.some(m => m.to === 1 && m.capture), '金龙照样能吃小王虎');

  const w = blankState({ n:4, kingEatsWeakest:true });
  put(w, 0, 'D1');
  put(w, 1, 'T8');
  ok(E.actionsFor(w, 'A').moves.some(m => m.to === 1 && m.capture), '改成纯级别制后龙王能吃小王虎');

  const x = blankState({ n:4 });      /* 龙方（变形龙）行动 */
  put(x, 0, 'T1');            /* 虎王 */
  put(x, 1, 'D8');            /* 变形龙 */
  ok(E.actionsFor(x, 'A').moves.some(m => m.from === 1 && m.to === 0 && m.capture), '变形龙应能反杀虎王');

  const y = blankState({ n:4 });      /* 虎方（虎王）行动 */
  y.turn = 'B';
  put(y, 0, 'T1');
  put(y, 1, 'D8');
  eq(E.actionsFor(y, 'B').moves.some(m => m.to === 1), false, '虎王不能吃变形龙');
}

/* ── 6c. 同级相遇：同归于尽 ── */
{
  /* 判定函数 */
  const mk = (a, b, on) => E.isMutualKill(a, b, on);
  eq(mk('D5','T5',true), true,  '同级（赤龙-绿虎）可以同归于尽');
  eq(mk('D5','T5',false), false, '关掉开关后不允许同归于尽');
  eq(mk('D1','T5',true), false, '级别不同不算同级');
  eq(mk('D5','D5',true), false, '自己人之间谈不上同归于尽');

  /* 走一步：两张一起离场，棋盘上两格都空 */
  const s = blankState({ n:4 });
  put(s, 0, 'D5');
  put(s, 1, 'T5');
  put(s, 2, 'T3');                       /* 虎方还有别子，避免直接终局 */
  const before = s.moves;
  const r = E.applyMove(s, 0, 1);
  eq(r.ok, true, '同级可以直接撞上去');
  eq(r.mutual, true, '应标记为同归于尽');
  eq(r.capture, false, '同归于尽不算"吃"');
  eq(s.cells[0], null, '攻击方离场');
  eq(s.cells[1], null, '被撞方也离场');
  eq(s.captured.A.length + s.captured.B.length, 0, '双方战利品都不增加');
  eq(s.moves, before + 1, '占用一回合');
  eq(s.sinceCapture, 0, '同归于尽算有进展，静默计数归零');
  ok(s.log.length && s.log[s.log.length - 1].text.indexOf('同归于尽') >= 0, '战报应写明同归于尽：' + (s.log[s.log.length-1] || {}).text);

  /* 关掉开关后这一步不合法 */
  const s2 = blankState({ n:4, mutualKill:false });
  put(s2, 0, 'D5');
  put(s2, 1, 'T5');
  eq(E.applyMove(s2, 0, 1).ok, false, '关掉开关后同级不能撞');

  /* 双方最后一张同归于尽 → 和棋 */
  const s3 = blankState({ n:4 });
  put(s3, 0, 'D5');
  put(s3, 1, 'T5');
  E.applyMove(s3, 0, 1);
  ok(s3.over && s3.over.draw, '两边都没牌了应判和棋');
  eq(s3.over && s3.over.winner, null, '同归于尽没有胜方');
  ok(String(s3.over.reason).indexOf('同归于尽') >= 0, '和棋原因应写明：' + (s3.over && s3.over.reason));

  /* 只有对方被清空 → 对方判负（自己还剩子） */
  const s4 = blankState({ n:4 });
  put(s4, 0, 'D5');
  put(s4, 4, 'D3');                      /* 龙方还有一张，撞完不空 */
  put(s4, 1, 'T5');
  E.applyMove(s4, 0, 1);
  ok(!s4.over || !s4.over.draw, '还有子的一方不该判和');

  /* 同级还在，就不算死局（开着同归于尽时） */
  const s5 = blankState({ n:5 });
  put(s5, 0, 'D5');
  put(s5, 6, 'T5');
  eq(E.anyCapturePossible(s5), true, '有同级对子就不算吃不动');
  s5.mutualKill = false;
  eq(E.anyCapturePossible(s5), false, '关掉后同级对子也不再是可行动作');
}

/* ── 7. 无棋可走判负 ── */
{
  /* 4×4 全部摆满、相邻全是同级别牌（棋盘染色：偶数格赤龙、奇数格绿虎），谁先手谁无路可走 */
  const s = blankState({ n:4, mutualKill:false });   /* 关掉同归于尽，才能测出「完全无路可走」 */
  for(let i = 0; i < 16; i++){
    const even = (Math.floor(i / 4) + (i % 4)) % 2 === 0;
    put(s, i, even ? 'D5' : 'T5', i !== 0);   /* 0 号留一张暗牌给玩家1 翻 */
  }
  s.turn = 'A';
  const r = E.applyFlip(s, 0);
  eq(r.ok, true, '翻最后一张暗牌应成功');
  eq(s.turn, 'B', '翻牌后轮到玩家2');
  ok(!!s.over, '玩家2 无棋可走应结束对局');
  eq(s.over && s.over.winner, 'A', '无棋可走的一方判负');
  eq(s.over && s.over.reason, '对方无棋可走', '结束原因应为“对方无棋可走”');
}

/* ── 7b. 死局判和 ── */
{
  const s = blankState({ n:5, mutualKill:false });   /* 关掉同归于尽，测真正的死局 */
  put(s, 0, 'D5');                                    /* 双方都只剩同级牌 */
  put(s, 24, 'D5');
  put(s, 6, 'T5');
  put(s, 12, 'T5');
  s.turn = 'A';
  eq(E.allRevealed(s), true, '全部已翻开');
  eq(E.anyCapturePossible(s), false, '关掉同归于尽后，同级牌之间不存在任何吃子机会');
  ok(E.hasAnyAction(s, 'A'), '此时仍然有地方可以走子（不是“无棋可走”判负）');
  E.checkOver(s);
  ok(!!s.over, '死局应结束对局');
  eq(s.over && s.over.draw, true, '该局面应判和棋');
  eq(s.over && s.over.winner, null, '和棋没有胜方');

  const w = blankState({ n:5 });                     /* 变形龙 vs 虎王：还有得吃，不能判和 */
  put(w, 0, 'D8');
  put(w, 1, 'T1');
  eq(E.anyCapturePossible(w), true, '变形龙与虎王之间仍有吃子机会');
  E.checkOver(w);
  eq(w.over, null, '有吃子机会时不应判和');

  const h = blankState({ n:5 });                     /* 还有暗牌时不能判和 */
  put(h, 0, 'D5');
  put(h, 1, 'T5');
  put(h, 2, 'T5', false);
  eq(E.allRevealed(h), false, '存在暗牌');
  E.checkOver(h);
  eq(h.over, null, '还有暗牌时不应判和');

  /* 同一局面打开同归于尽后就不再是死局：他们可以互相撞掉 */
  const h2 = blankState({ n:5 });
  put(h2, 0, 'D5');
  put(h2, 1, 'T5');                     /* 紧挨着，才有"撞上去"这个选择 */
  put(h2, 24, 'D5');
  put(h2, 23, 'T5');
  h2.turn = 'A';
  eq(E.anyCapturePossible(h2), true, '打开同归于尽后同级也是可行动作');
  E.checkOver(h2);
  eq(h2.over, null, '打开同归于尽后不应判死局和棋');
  ok(E.actionsFor(h2, 'A').moves.some(m => m.mutual), '这时应该有「撞上去」这个选择');
}

/* ── 7c. 连续无吃子判和（附加规则） ── */
{
  const s = E.createGame({ n:5, rand:mulberry32(3) });
  eq(s.noCaptureLimit, 60, '默认连续 60 手无吃子判和');
  eq(s.sinceCapture, 0, '开局无吃子计数为 0');
  const backs = [];
  for(let i = 0; i < s.total; i++) if(s.cells[i] && !s.cells[i].up) backs.push(i);
  for(let k = 0; k < 3; k++) eq(E.applyFlip(s, backs[k]).ok, true, '第 ' + (k + 1) + ' 次翻牌应成功');
  eq(s.sinceCapture, 3, '翻牌不吃子应累加计数');

  const t = blankState({ n:4 });
  t.noCaptureLimit = 5;
  put(t, 0, 'D1');
  put(t, 4, 'T5');
  eq(E.applyMove(t, 0, 4).ok, true, '龙王吃绿虎应成功');
  eq(t.sinceCapture, 0, '吃子后无吃子计数应归零');
  eq(t.captured.A.length, 1, '吃子应记入战利品');

  const u = blankState({ n:5 });
  u.noCaptureLimit = 3;
  put(u, 0, 'D1');
  put(u, 24, 'T2');
  eq(E.applyMove(u, 0, 1).ok, true, 'A 走一步');
  eq(u.sinceCapture, 1, '第 1 手无吃子');
  eq(E.applyMove(u, 24, 23).ok, true, 'B 走一步');
  eq(u.sinceCapture, 2, '第 2 手无吃子');
  eq(E.applyMove(u, 1, 0).ok, true, 'A 再走一步');
  eq(u.sinceCapture, 3, '第 3 手无吃子');
  ok(u.over && u.over.draw, '达到上限应判和棋');
  ok(u.over && String(u.over.reason).indexOf('3 手') >= 0, '和棋原因应说明手数：' + (u.over && u.over.reason));

  const v = blankState({ n:5 });
  v.noCaptureLimit = 0;
  put(v, 0, 'D1');
  put(v, 24, 'T2');
  E.applyMove(v, 0, 1);
  E.applyMove(v, 24, 23);
  eq(v.over, null, '设为「不限」时不应因无吃子判和');
}

/* ── 8. 随机自对弈冒烟测试 ── */
{
  let unfinished = 0, threw = 0, ended = 0, badInvariant = 0;
  let draws = 0, noProgress = 0, drawWithoutReveal = 0, sumCaptured = 0;
  for(let seed = 1; seed <= 300; seed++){
    const rnd = mulberry32(seed);
    const s = E.createGame({ n:4, diagonal: seed % 2 === 0, tigerEatsAll: seed % 3 === 0, rand:rnd });
    let steps = 0;
    try{
      while(!s.over && steps < 1500){
        const acts = E.actionsFor(s, s.turn);
        const choices = [];
        acts.flips.forEach(f => choices.push({ t:'f', i:f }));
        acts.moves.forEach(m => choices.push({ t:'m', a:m.from, b:m.to }));
        if(!choices.length){ E.checkOver(s); if(!s.over) throw new Error('无动作却未判定结束'); break; }
        const c = choices[Math.floor(rnd() * choices.length)];
        const r = (c.t === 'f') ? E.applyFlip(s, c.i) : E.applyMove(s, c.a, c.b);
        if(!r.ok) throw new Error('合法动作被引擎拒绝：' + r.error);
        steps++;
      }
      const board = s.cells.filter(Boolean);
      const captured = s.captured.A.length + s.captured.B.length;
      const gone = (s.mutualGone || []).length;
      const ids = board.map(c => c.cardId);
      const allIds = ids.concat(s.captured.A, s.captured.B, s.mutualGone || []);
      if(board.length + captured + gone !== 16 || new Set(allIds).size !== allIds.length) badInvariant++;
      if(captured + gone < 3) noProgress++;
      if(s.over && s.over.draw){
        draws++;
        if(!E.allRevealed(s)) drawWithoutReveal++;
      }
      if(s.over) ended++; else unfinished++;
      sumCaptured += captured;
    }catch(err){
      threw++;
      if(threw <= 3) failures.push('自对弈异常（seed ' + seed + '）：' + err.message);
    }
  }
  eq(threw, 0, '随机自对弈不应抛异常');
  eq(badInvariant, 0, '任意时刻“场上牌数 + 被吃牌数 + 同归于尽数 = 16”且不重复');
  eq(ended + unfinished, 300, '自对弈局数');
  eq(noProgress, 0, '每局随机对弈都应至少离场 3 张牌（说明引擎有推进力）');
  eq(drawWithoutReveal, 0, '判和棋时不应还有未翻开的牌');
  console.log('  自对弈：结束 ' + ended + ' 局（其中和棋 ' + draws + ' 局），走满上限 ' + unfinished +
    ' 局，平均吃掉 ' + (sumCaptured / 300).toFixed(1) + ' 张，异常 ' + threw + ' 次');
}

report();
function report(){
  console.log('');
  if(failures.length){
    console.log('✗ 失败 ' + failures.length + ' 项（通过 ' + pass + ' 项）：');
    failures.forEach(f => console.log('   - ' + f));
    process.exitCode = 1;
  } else {
    console.log('✓ 全部通过：' + pass + ' 项断言');
  }
}
