'use strict';
/*
 * 龙虎斗（兽棋版）界面集成测试（jsdom）
 * 用法：node tools/test-ui.cjs   （需先 npm install jsdom --prefix tools）
 * 作用：真的加载 index.html、真的派发点击事件，驱动一整局到分出胜负，检查界面与交互没坏。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));

let pass = 0;
const failures = [];
const ok = (cond, msg) => { if(cond){ pass++; } else { failures.push(msg); } };
const eq = (a, b, msg) => ok(Object.is(a, b), msg + ' | got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b));

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const vc = new VirtualConsole();
const pageErrors = [];
vc.on('jsdomError', e => pageErrors.push(e.message));
vc.on('error', (...a) => pageErrors.push(String(a[0])));

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  url: 'https://example.test/longhudou/'
});
const win = dom.window;
const doc = win.document;
const $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const click = el => {
  if(!el) throw new Error('要点击的元素不存在');
  el.dispatchEvent(new win.MouseEvent('click', { bubbles:true, cancelable:true }));
};
const input = (el, v) => { el.value = v; el.dispatchEvent(new win.Event('input', { bubbles:true })); };

/* ── 初始状态 ── */
eq($$('#board .cell').length, 16, '4×4 应有 16 个格子');
eq($$('#board .card.back').length, 16, '开局应有 16 张暗牌');
eq($$('#board .card.back .backmark')[0].textContent, '龙虎', '牌背文字应为简体「龙虎」');
eq($$('#board .card.back .backmark').filter(el => el.textContent.indexOf('龍') >= 0).length, 0,
  '牌背不应再出现繁体「龍」');
eq($$('#board .card.up').length, 0, '开局不应有翻开的牌');
eq($('#btnUndo').disabled, true, '开局悔棋按钮应不可用');
ok($('#bannerText').textContent.indexOf('先手') >= 0, '开局提示应先翻牌定阵营');
eq($('#pA').classList.contains('active'), true, '玩家1 先手应高亮');

/* ── 弹窗与昵称 ── */
click($('#btnRules'));
eq($('#rulesModal').classList.contains('open'), true, '点规则应打开弹窗');
click($('#btnCloseRules'));
eq($('#rulesModal').classList.contains('open'), false, '点知道了应关闭弹窗');
input($('#inNameA'), '阿龙');
input($('#inNameB'), '阿虎');
eq($('#nameA_lbl').textContent, '阿龙', '昵称应即时生效（玩家1）');
eq($('#nameB_lbl').textContent, '阿虎', '昵称应即时生效（玩家2）');

/* ── 内嵌画片插画：两套画风 ── */
{
  const sets = win.CARD_SETS;
  ok(sets && typeof sets === 'object', 'index.html 里应内嵌 CARD_SETS');
  const keys = Object.keys(sets || {});
  eq(keys.length, 2, '应内嵌两套画风（动漫版 + 洋画片版）');
  const ids = ['D1','D2','D3','D4','D5','D6','D7','D8','T1','T2','T3','T4','T5','T6','T7','T8'];
  for(const k of keys){
    eq(Object.keys(sets[k].art).length, 16, k + ' 应有 16 张插画');
    const missing = ids.filter(id => !sets[k].art[id]);
    eq(missing.length, 0, k + ' 缺少插画：' + missing.join(','));
    const badSrc = ids.filter(id => String(sets[k].art[id]).indexOf('data:image/jpeg;base64,') !== 0);
    eq(badSrc.length, 0, k + ' 插画应为内嵌 data URI');
    ok(sets[k].ratio > 0.3 && sets[k].ratio < 1.6, k + ' 应带合理宽高比（实际 ' + sets[k].ratio + '）');
    ok(sets[k].ratio < 0.95, k + ' 应是竖版卡片');
    eq(new Set(ids.map(id => sets[k].art[id])).size, 16, k + ' 的 16 张应各不相同');
  }
  if(sets.anime && sets.classic){
    ok(sets.anime.art.D1 !== sets.classic.art.D1, '两套画风的内容应不同');
    eq(win.CARD_SETS[win.document.querySelector('#selArt') ? 'anime' : 'anime'].name, '动漫版', '动漫版应带名字');
  }
  ok(String($('#board').getAttribute('style') || '').indexOf('--ratio') >= 0,
    '棋盘应把卡图比例写进 --ratio，保证格子按原比例显示');
}

/* ── 翻牌定阵营 ── */
click($('#board .card.back'));
eq($$('#board .card.up').length, 1, '点暗牌应翻开一张');
eq($$('#board .card.up img').length, 1, '翻开的牌应显示画片插画');
ok($$('#board .card.up img')[0].getAttribute('src').indexOf('data:image/jpeg;base64,') === 0, '插画应内嵌为 data URI');

/* ── 牌面画风切换：动漫 / 洋画片 / 文字 ── */
{
  const srcAnime = $$('#board .card.up img')[0].getAttribute('src');
  $('#selArt').value = 'classic';
  $('#selArt').dispatchEvent(new win.Event('change', { bubbles:true }));
  eq($$('#board .card.up img').length, 1, '洋画片版也应是图片牌面');
  ok($$('#board .card.up img')[0].getAttribute('src') !== srcAnime, '切到洋画片版后图片内容应变化');
  $('#selArt').value = 'text';
  $('#selArt').dispatchEvent(new win.Event('change', { bubbles:true }));
  eq($$('#board .card.up img').length, 0, '文字牌面不应有图片');
  eq($$('#board .card.up .nm').length, 1, '文字牌面应显示牌名');
  $('#selArt').value = 'anime';
  $('#selArt').dispatchEvent(new win.Event('change', { bubbles:true }));
  eq($$('#board .card.up img').length, 1, '切回动漫版应恢复图片牌面');
  ok($$('#board .card.up img')[0].getAttribute('src') === srcAnime, '切回动漫版应还原成同一张图');
}

const sideA = $('#pA').classList.contains('dragon') ? 'dragon' : 'tiger';
ok(['dragon','tiger'].includes(sideA), '玩家1 应获得一个阵营');
eq($('#pB').classList.contains(sideA === 'dragon' ? 'tiger' : 'dragon'), true, '玩家2 应获得另一阵营');
ok($('#bannerText').textContent.indexOf('轮到') >= 0, '翻牌后应提示轮到玩家2');
ok($('#metaA').textContent.indexOf('场上明牌 1 张') >= 0, '玩家1 的明牌计数应为 1');

/* ── 悔棋 ── */
const logBeforeUndo = $$('#log li').length;
click($('#btnUndo'));
eq($$('#log li').length, logBeforeUndo - 1, '悔棋应减少一条对局记录');
eq($$('#board .card.up').length, 0, '悔棋应把翻牌撤回');
eq($('#pA').classList.contains('dragon') || $('#pA').classList.contains('tiger'), false, '悔棋后阵营应回到未定');
eq($('#btnUndo').disabled, true, '撤回后没有可悔的步数');

/* ── 设置：换棋盘尺寸 ── */
$('#selSize').value = '5';
click($('#btnNew'));
eq($$('#board .cell').length, 25, '切到 5×5 应有 25 个格子');
eq($$('#board .card.back').length, 16, '5×5 仍是 16 张暗牌');
$('#selSize').value = '4';
$('#chkTiger').checked = false;
$('#chkDiag').checked = false;
click($('#btnNew'));
eq($$('#board .cell').length, 16, '切回 4×4');

/* ── 纯点击驱动一整局（优先吃子） ── */
const isOver = () => $('#banner').classList.contains('over');
const sideClass = el => el.classList.contains('dragon') ? 'dragon'
  : el.classList.contains('tiger') ? 'tiger' : null;
const currentSide = () => {
  const a = $('#pA'), b = $('#pB');
  if(a.classList.contains('active')) return sideClass(a);
  if(b.classList.contains('active')) return sideClass(b);
  return null;
};
const cellAt = i => $$('#board .cell')[i];
const cellCount = () => $$('#board .cell').length;
const cardSide = cell => {
  const card = cell.querySelector('.card');
  if(!card || !card.classList.contains('up')) return null;
  return card.classList.contains('dragon') ? 'dragon' : 'tiger';
};

const capCount = () => $$('#chipsA .chip').length + $$('#chipsB .chip').length;
const N = () => Math.round(Math.sqrt(cellCount()));
const pos = i => ({ r: Math.floor(i / N()), c: i % N() });
const dist = (a, b) => Math.abs(pos(a).r - pos(b).r) + Math.abs(pos(a).c - pos(b).c);
const tgtIdx = list => list.map(el => parseInt(el.dataset.i, 10));

/* 纯点击驱动一整局：能吃就吃 → 还有暗牌就翻开 → 都翻完了就朝最近的对手逼近 */
function playFullGame(seedInit){
  let seed = seedInit, actions = 0, guard = 0, captures = 0, flips = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  click($('#btnNew'));
  while(!isOver() && guard++ < 1200){
    const side = currentSide();
    if(!side){
      const backs = $$('#board .card.back');
      if(!backs.length) throw new Error('阵营未定但已无暗牌');
      click(pick(backs)); actions++; flips++;
      continue;
    }
    const own = [], foes = [];
    for(let i = 0; i < cellCount(); i++){
      const s = cardSide(cellAt(i));
      if(!s) continue;
      (s === side ? own : foes).push(i);
    }
    const backsExist = $$('#board .card.back').length > 0;

    /* 逐个选中自己的牌，找能吃谁；同时记下最能靠近对手的一步 */
    let capPick = null, bestMove = null;
    for(const idx of own){
      click(cellAt(idx));
      const caps = tgtIdx($$('#board .tgt-cap'));
      if(caps.length){ capPick = { from:idx, to:pick(caps) }; click(cellAt(idx)); break; }
      for(const to of tgtIdx($$('#board .tgt-move'))){
        const d = foes.length ? Math.min(...foes.map(f => dist(to, f))) : 0;
        if(!bestMove || d < bestMove.d) bestMove = { from:idx, to:to, d:d };
      }
      click(cellAt(idx));   /* 取消选择 */
    }

    let plan = capPick;
    if(!plan && !backsExist) plan = bestMove;
    if(!plan && backsExist){ click(pick($$('#board .card.back'))); actions++; flips++; continue; }
    if(!plan) break;

    const before = capCount();
    click(cellAt(plan.from));
    click(cellAt(plan.to));
    actions++;
    if(capCount() > before) captures++;
  }
  return { ended:isOver(), actions:actions, captures:captures, flips:flips };
}

/* 换 3 个种子各打一整局，确认都能正常收场 */
const games = [20240602, 777, 20260926].map(s => playFullGame(s));
games.forEach((g, i) => {
  ok(g.ended, '第 ' + (i + 1) + ' 局点击驱动对局应能正常结束（走了 ' + g.actions + ' 手，吃子 ' + g.captures + ' 次）');
  ok(g.actions > 10, '第 ' + (i + 1) + ' 局应有相当手数（实际 ' + g.actions + '）');
  ok(g.captures > 0, '第 ' + (i + 1) + ' 局应发生过吃子（实际 ' + g.captures + ' 次）');
});
const actions = games[0].actions, captures = games[0].captures;
ok($('#bannerText').textContent.indexOf('胜') >= 0 || $('#bannerText').textContent.indexOf('和棋') >= 0,
  '结束后横幅应显示胜方或和棋：' + $('#bannerText').textContent);
ok($$('#log li').length > 0, '对局记录应有内容');
const logAfterGame = $$('#log li').length;
ok(logAfterGame > 0, '对局记录应有内容（当前 ' + logAfterGame + ' 条）');

/* ── 结束后悔棋 ── */
click($('#btnUndo'));
eq($('#banner').classList.contains('over'), false, '悔棋应把“对局结束”状态撤回');
ok($$('#board .card.up').length >= 1, '悔棋后棋盘应恢复到对局中的样子');

/* ── 新开一局：清空状态 ── */
click($('#btnNew'));
eq($$('#board .card.back').length, 16, '新开一局应重新发 16 张暗牌');
eq($$('#log li').length, 0, '新开一局应清空记录');
eq($('#metaA').textContent, '阵营未定', '新开一局阵营应重置');

/* ── 联机界面（不触网，只测结构与校验） ── */
{
  eq($$('#selMode option').length, 3, '模式下拉应有 3 项');
  eq($('#selMode').value, 'local', '默认是同屏模式');
  eq($('#roomBar').hidden, true, '同屏模式不显示房间栏');
  eq($('#rowRoomCode').hidden, true, '同屏模式不显示房间号输入');

  $('#selMode').value = 'join';
  $('#selMode').dispatchEvent(new win.Event('change', { bubbles:true }));
  eq($('#rowRoomCode').hidden, false, '选「加入房间」应显示房间号输入');
  eq($('#roomBar').hidden, true, '还没加入时不显示房间栏');

  input($('#inRoomCode'), 'AB');                    /* 位数不对 */
  click($('#btnJoinRoom'));
  ok($('#roomNotice').textContent.indexOf('6 位') >= 0, '房间号位数不对应提示：' + $('#roomNotice').textContent);
  eq($('#btnUndo').disabled, true, '未联机时仍不应有可悔的步');

  $('#selMode').value = 'local';
  $('#selMode').dispatchEvent(new win.Event('change', { bubbles:true }));
  eq($('#roomBar').hidden, true, '切回同屏应隐藏房间栏');
  eq($$('#board .card.back').length, 16, '切回同屏应重开一局（16 张暗牌）');
  click($('#board .card.back'));
  eq($$('#board .card.up').length, 1, '切回同屏后仍可正常翻牌');
}

/* ── 页面无脚本报错 ── */
eq(pageErrors.length, 0, '页面运行期间不应有脚本错误：' + pageErrors.join(' | '));

console.log('');
if(failures.length){
  console.log('✗ 界面测试失败 ' + failures.length + ' 项（通过 ' + pass + ' 项）：');
  failures.forEach(f => console.log('   - ' + f));
  try { win.close(); } catch(e){}
  process.exit(1);
} else {
  console.log('✓ 界面测试全部通过：' + pass + ' 项断言（点击驱动 ' + actions + ' 手，吃子 ' + captures + ' 次）');
  try { win.close(); } catch(e){}
  process.exit(0);
}
