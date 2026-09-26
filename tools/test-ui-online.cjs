'use strict';
/*
 * 双/三窗口联调测试：三个真实页面实例各当一个客户端，过真实公共 MQTT 中继对下。
 * 重点覆盖「加入房间之后怎么开始」这条链路，以及曾经的真实 bug：
 *   · 房主在还没连上中继时也必须能翻牌（以前 s.state 为空 → 点击被吞）
 *   · 客人还没拿到房主局面时，棋盘显示「同步中」而不是一个能点却点不动的假棋盘
 * 用法：node tools/test-ui-online.cjs
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require(path.join(__dirname, 'node_modules', 'jsdom'));

let pass = 0;
const failures = [];
const ok = (c, m) => { if(c){ pass++; } else { failures.push(m); } };
const eq = (a, b, m) => ok(Object.is(a, b), m + ' | got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const errors = [];

function openPage(tag){
  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(tag + ': ' + e.message));
  vc.on('error', (...a) => errors.push(tag + ': ' + String(a[0])));
  return new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc, url:'https://fallfo.github.io/longhudou/' });
}
const $ = (win, s) => win.document.querySelector(s);
const $$ = (win, s) => Array.from(win.document.querySelectorAll(s));
const click = (win, el) => { if(!el) throw new Error('要点击的元素不存在'); el.dispatchEvent(new win.MouseEvent('click', { bubbles:true, cancelable:true })); };
const fire = (win, el, type) => el.dispatchEvent(new win.Event(type, { bubbles:true }));
const boardSig = win => $$(win, '#board .cell').map(c => {
  const card = c.querySelector('.card');
  if(!card) return '0';
  if(!card.classList.contains('up')) return 'd';
  const num = card.querySelector('.num');
  return 'u' + (num ? num.textContent : '?');
}).join(',');
const upCount = win => $$(win, '#board .card.up').length;
const syncing = win => !!$(win, '.boardwrap').classList.contains('syncing');

async function waitFor(fn, ms, what){
  const t0 = Date.now();
  while(Date.now() - t0 < ms){
    try { if(fn()) return true; } catch(e){}
    await sleep(150);
  }
  failures.push('等待超时：' + what);
  return false;
}

(async () => {
  const watchdog = setTimeout(() => { console.log('✗ 双窗口测试整体超时'); process.exit(1); }, 180000);

  const hostDom = openPage('host'), guestDom = openPage('guest'), viewDom = openPage('view');
  const H = hostDom.window, G = guestDom.window, V = viewDom.window;
  await sleep(300);

  /* 0) 昵称回退：留空时按座位自动命名，两边不会都叫「玩家2」 */
  {
    const tmpDom = openPage('tmp');
    const T = tmpDom.window;
    await sleep(200);
    eq($(T, '#inNetName').value, '', '「我的昵称」默认为空');
    eq($(T, '#roomBar').hidden, true, '一开始不应自动建房（房间栏隐藏）');
    click(T, $(T, '#btnCreateRoom'));                       /* 由房主主动创建 */
    eq($(T, '#rowRoomCode').hidden, true, '建房不问房号（输入框应保持隐藏）');
    ok($(T, '#nameA_lbl').textContent.indexOf('玩家1') >= 0, '房主留空昵称 → 自动叫「玩家1」：' + $(T, '#nameA_lbl').textContent);
    ok($(T, '#nameA_lbl').textContent.indexOf('我') >= 0, '房主的座位带「我」标记');
    ok($(T, '#nameB_lbl').textContent.indexOf('等待对手') >= 0, '对手座位显示「等待对手」');
    click(T, $(T, '#btnLeaveRoom'));
    try { tmpDom.window.close(); } catch(e){}
  }

  /* 1) 房主主动建房：连上中继之前就必须能翻牌（这是修掉的 bug） */
  $(H, '#inNetName').value = '房主';
  eq($(H, '#roomBar').hidden, true, '没点「创建房间」之前不应有房间');
  click(H, $(H, '#btnCreateRoom'));
  eq($(H, '#rowRoomCode').hidden, true, '建房流程不要求输入房号');
  eq($(H, '#roomBar').hidden, false, '房主立刻看到房间栏');
  eq(syncing(H), false, '房主不需要同步，棋盘不应是灰的');
  click(H, $$(H, '#board .card.back')[0]);
  eq(upCount(H), 1, '房主还没连上中继也能翻牌');
  eq($(H, '#btnUndo').disabled, true, '联机时不可悔棋');
  eq($(H, '#btnNew').disabled, false, '房主可以重开一局');

  if(!await waitFor(() => /^[A-Z0-9]{6}$/.test($(H, '#roomCode').textContent), 30000, '房主拿到房间号')){ finish(); return; }
  const room = $(H, '#roomCode').textContent;
  eq($(H, '#nameA_lbl').textContent.indexOf('我') >= 0, true, '房主的座位带「我」标记，不会再分不清谁是谁');
  ok($(H, '#nameB_lbl').textContent.indexOf('等待对手') >= 0, '对手还没进来时座位显示「等待对手」：' + $(H, '#nameB_lbl').textContent);
  if(!await waitFor(() => $(H, '#netStatus').textContent.indexOf('已连接') >= 0, 30000, '房主连上中继')){ finish(); return; }
  console.log('房间号 ' + room + ' | 房主中继 ' + $(H, '#netStatus').textContent);
  eq($(H, '#netSeat').textContent.indexOf('房主') >= 0, true, '房主看到自己的座位是房主');

  /* 2) 对手输房间号加入：未同步时棋盘要显示「同步中」 */
  $(G, '#inNetName').value = '小明';
  click(G, $(G, '#btnAskJoin'));                 /* 主动点「加入房间」 */
  eq($(G, '#rowRoomCode').hidden, false, '点「加入房间」后才出现房号输入框');
  eq($(G, '#rowCreate').hidden, true, '此时不该还显示「创建房间」按钮');
  $(G, '#inRoomCode').value = room;
  click(G, $(G, '#btnJoinRoom'));
  eq(syncing(G), true, '客人未拿到房主局面时，棋盘应为「同步中」状态');
  eq($(G, '#btnUndo').disabled, true, '客人不能悔棋');
  eq($(G, '#btnNew').disabled, true, '客人不能重开局');

  if(!await waitFor(() => $(G, '#netStatus').textContent.indexOf('已连接') >= 0, 30000, '客人连上中继')){ finish(); return; }
  if(!await waitFor(() => !syncing(G) && upCount(G) === 1 && boardSig(G) === boardSig(H), 25000, '客人同步到房主的局面')){ finish(); return; }
  eq(syncing(G), false, '同步完成后棋盘恢复正常显示');
  eq(boardSig(G), boardSig(H), '客人加入后双方棋盘一致（含房主先翻的那张）');
  eq($(G, '#netSeat').textContent.indexOf('对手') >= 0, true, '客人看到自己的座位是后手对手');
  ok($(G, '#nameB_lbl').textContent.indexOf('我') >= 0, '客人的座位带「我」标记');
  ok($(G, '#metaA').textContent.indexOf('场上明牌') >= 0 || $(G, '#metaB').textContent.indexOf('场上明牌') >= 0,
    '客人看得到阵营与明牌信息');

  /* 3) 房主先翻过了 → 现在轮到客人：客人翻一张，双方同步 */
  ok(await waitFor(() => $(G, '#roomNotice').textContent.indexOf('轮到你了') >= 0, 15000, '客人被提示“轮到你了”'),
    '轮到客人时提示该他动手');
  click(G, $$(G, '#board .card.back')[0]);
  if(!await waitFor(() => upCount(H) === 2 && upCount(G) === 2 && boardSig(H) === boardSig(G), 20000, '双方都同步到客人的翻牌')){ finish(); return; }
  eq(boardSig(H), boardSig(G), '客人走子后双方棋盘一致');
  ok(await waitFor(() => $(G, '#roomNotice').textContent.indexOf('等房主') >= 0, 15000, '客人被提示等房主'),
    '客人走完后提示“等房主走完这一步”');

  /* 4) 轮回房主：连上中继后房主照样能动手（这条曾经是 bug） */
  click(H, $$(H, '#board .card.back')[0]);
  if(!await waitFor(() => upCount(H) === 3 && upCount(G) === 3 && boardSig(H) === boardSig(G), 20000, '双方都同步到房主的第二次翻牌')){ finish(); return; }
  eq(boardSig(H), boardSig(G), '房主走子后双方棋盘一致');

  /* 5) 第三个人进来观战：只读 */
  $(V, '#inNetName').value = '吃瓜';
  click(V, $(V, '#btnAskJoin'));
  $(V, '#inRoomCode').value = room;
  click(V, $(V, '#btnJoinRoom'));
  if(!await waitFor(() => $(V, '#netStatus').textContent.indexOf('已连接') >= 0, 30000, '观众连上中继')){ finish(); return; }
  if(!await waitFor(() => $(V, '#netOpp').textContent.indexOf('观战') >= 0, 25000, '观众被识别为观战')){ finish(); return; }
  await waitFor(() => boardSig(V) === boardSig(H), 20000, '观众拿到当前局面');
  eq(boardSig(V), boardSig(H), '观众看到的棋盘与房主一致');
  eq($(V, '#netSeat').textContent.indexOf('观众') >= 0, true, '观众看到自己的座位是观众');
  const before = upCount(V);
  const vBacks = $$(V, '#board .card.back');
  if(vBacks.length) click(V, vBacks[0]);
  await sleep(800);
  eq(upCount(V), before, '观众点棋盘不会改变局面');

  /* 6) 房主重开一局 → 对手与观众都跟着重置 */
  click(H, $(H, '#btnNew'));
  if(!await waitFor(() => upCount(H) === 0 && upCount(G) === 0 && upCount(V) === 0, 20000, '重开后三方都归零')){ finish(); return; }
  ok(true, '房主重开一局后对手与观众同步重置');

  /* 7) 退出房间后回到同屏模式 */
  click(G, $(G, '#btnLeaveRoom'));
  await sleep(400);
  eq($(G, '#roomBar').hidden, true, '退出后隐藏房间栏');
  eq($(G, '#rowCreate').hidden, false, '退出后重新显示「创建房间 / 加入房间」按钮');
  click(G, $$(G, '#board .card.back')[0]);
  eq(upCount(G), 1, '退出房间后本地同屏可以正常翻牌');

  ok(errors.length === 0, '页面不应有脚本错误：' + errors.slice(0, 3).join(' | '));
  finish();

  function finish(){
    clearTimeout(watchdog);
    [hostDom, guestDom, viewDom].forEach(d => { try { d.window.close(); } catch(e){} });
    console.log('');
    if(failures.length){
      console.log('✗ 双窗口联调失败 ' + failures.length + ' 项（通过 ' + pass + ' 项）：');
      failures.forEach(f => console.log('   - ' + f));
      process.exit(1);
    } else {
      console.log('✓ 双窗口联调全部通过：' + pass + ' 项断言（真实公共中继，房主/对手/观众三方）');
      process.exit(0);
    }
  }
})();
