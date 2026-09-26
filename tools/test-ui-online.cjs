'use strict';
/*
 * 双窗口联调测试：两个（三个）真实页面实例各当一个客户端，过真实公共 MQTT 中继对下。
 * 覆盖界面与协议的接缝：模式切换 → 建房 → 输房间号加入 → 双方棋盘一致 → 双方都能走子 → 观众只读。
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
  const dom = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, virtualConsole:vc, url:'https://fallfo.github.io/longhudou/' });
  return dom;
}
const $ = (win, s) => win.document.querySelector(s);
const $$ = (win, s) => Array.from(win.document.querySelectorAll(s));
const click = (win, el) => { if(!el) throw new Error('要点击的元素不存在'); el.dispatchEvent(new win.MouseEvent('click', { bubbles:true, cancelable:true })); };
const fire = (win, el, type) => el.dispatchEvent(new win.Event(type, { bubbles:true }));

/* 只反映“已翻开的牌”，因为暗牌双方都不知道具体牌面 */
function boardSig(win){
  return $$(win, '#board .cell').map(c => {
    const card = c.querySelector('.card');
    if(!card) return '0';
    if(!card.classList.contains('up')) return 'd';
    const num = card.querySelector('.num');
    return 'u' + (num ? num.textContent : '?');
  }).join(',');
}
function upCount(win){ return $$(win, '#board .card.up').length; }

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
  const watchdog = setTimeout(() => { console.log('✗ 双窗口测试整体超时'); process.exit(1); }, 150000);

  const hostDom = openPage('host'), guestDom = openPage('guest'), viewDom = openPage('view');
  const H = hostDom.window, G = guestDom.window, V = viewDom.window;
  await sleep(300);

  /* 1) 房主建房 */
  $(H, '#inNetName').value = '房主';
  $(H, '#selMode').value = 'host';
  fire(H, $(H, '#selMode'), 'change');
  if(!await waitFor(() => /^[A-Z0-9]{6}$/.test($(H, '#roomCode').textContent), 30000, '房主拿到房间号')){ finish(); return; }
  const room = $(H, '#roomCode').textContent;
  console.log('房间号：' + room + '（房主中继：' + $(H, '#netStatus').textContent + '）');
  if(!await waitFor(() => $(H, '#netStatus').textContent.indexOf('已连接') >= 0, 30000, '房主连上中继')){ finish(); return; }
  eq($(H, '#roomBar').hidden, false, '房主应看到房间栏');
  eq($(H, '#btnUndo').disabled, true, '联机时不可悔棋');
  eq($(H, '#btnNew').disabled, false, '房主可以重开一局');

  /* 2) 对手输房间号加入 */
  $(G, '#inNetName').value = '小明';
  $(G, '#selMode').value = 'join';
  fire(G, $(G, '#selMode'), 'change');
  $(G, '#inRoomCode').value = room;
  click(G, $(G, '#btnJoinRoom'));
  if(!await waitFor(() => $(G, '#netStatus').textContent.indexOf('已连接') >= 0, 30000, '客人连上中继')){ finish(); return; }
  if(!await waitFor(() => upCount(H) === upCount(G) && boardSig(H) === boardSig(G), 25000, '双方棋盘一致（初始）')){ finish(); return; }
  ok(true, '客人加入后双方棋盘一致');
  eq($(G, '#btnUndo').disabled, true, '客人也不能悔棋');
  eq($(G, '#btnNew').disabled, true, '客人不能重开局（由房主控制）');

  /* 3) 房主翻第一张牌 → 客人应同步看到 */
  const backs = $$(H, '#board .card.back');
  click(H, backs[0]);
  if(!await waitFor(() => upCount(G) === 1 && boardSig(G) === boardSig(H), 20000, '客人同步到房主的翻牌')){ finish(); return; }
  eq(boardSig(G), boardSig(H), '翻牌后双方棋盘一致');
  ok($(H, '#bannerText').textContent.indexOf('轮到') >= 0, '房主界面显示轮次');
  ok($(G, '#metaA').textContent.indexOf('场上明牌') >= 0 || $(G, '#metaB').textContent.indexOf('场上明牌') >= 0,
    '客人看得到阵营与明牌信息');

  /* 4) 轮到客人：客人翻一张，双方都要同步（房主本地立刻变，客人要等一个来回） */
  if(!await waitFor(() => $(G, '#bannerText').textContent.indexOf('小明') >= 0, 20000, '轮到客人')){ finish(); return; }
  const guestBacks = $$(G, '#board .card.back');
  click(G, guestBacks[0]);
  if(!await waitFor(() => upCount(H) === 2 && upCount(G) === 2 && boardSig(H) === boardSig(G), 20000, '双方都同步到客人的翻牌')){ finish(); return; }
  eq(boardSig(H), boardSig(G), '客人走子后双方棋盘一致');

  /* 5) 第三个人进来观战：只读 */
  $(V, '#inNetName').value = '吃瓜';
  $(V, '#selMode').value = 'join';
  fire(V, $(V, '#selMode'), 'change');
  $(V, '#inRoomCode').value = room;
  click(V, $(V, '#btnJoinRoom'));
  if(!await waitFor(() => $(V, '#netStatus').textContent.indexOf('已连接') >= 0, 30000, '观众连上中继')){ finish(); return; }
  if(!await waitFor(() => $(V, '#netOpp').textContent.indexOf('观战') >= 0, 25000, '观众被识别为观战')){ finish(); return; }
  await waitFor(() => boardSig(V) === boardSig(H), 20000, '观众拿到当前局面');
  eq(boardSig(V), boardSig(H), '观众看到的棋盘与房主一致');
  const before = upCount(V);
  const vBacks = $$(V, '#board .card.back');
  if(vBacks.length) click(V, vBacks[0]);
  await sleep(800);
  eq(upCount(V), before, '观众点棋盘不会改变局面');
  ok($(V, '#roomNotice').textContent.indexOf('观战') >= 0 || $(V, '#netOpp').textContent.indexOf('观战') >= 0, '观众界面有观战提示');

  /* 6) 房主重开一局 → 对手与观众都跟着重置 */
  click(H, $(H, '#btnNew'));
  if(!await waitFor(() => upCount(H) === 0 && upCount(G) === 0 && upCount(V) === 0, 20000, '重开后三方都归零')){ finish(); return; }
  ok(true, '房主重开一局后对手与观众同步重置');

  /* 7) 退出房间后回到同屏模式 */
  click(G, $(G, '#btnLeaveRoom'));
  await sleep(400);
  eq($(G, '#roomBar').hidden, true, '退出后隐藏房间栏');
  eq($(G, '#selMode').value, 'local', '退出后回到同屏模式');
  eq($(G, '#btnUndo').disabled, true, '退出后是新局，仍不可悔');

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
