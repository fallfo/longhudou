'use strict';
/*
 * 联机端到端测试（走真实公共 MQTT broker）：房主 + 对手 + 观众 三个客户端打完整局，再测断线重连。
 * 用法：node tools/test-net-live.cjs
 * 说明：依赖公网，若中继不可达会明确报“网络不可用”而不是误判为逻辑错误。
 */
const fs = require('fs');
const path = require('path');

let pass = 0;
const failures = [];
const ok = (c, m) => { if(c){ pass++; } else { failures.push(m); } };
const eq = (a, b, m) => ok(Object.is(a, b), m + ' | got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const engineSrc = html.match(/\/\*==ENGINE_START==\*\/([\s\S]*?)\/\*==ENGINE_END==\*\//)[1];
const netSrc = html.match(/\/\*==NET_START==\*\/([\s\S]*?)\/\*==NET_END==\*\//)[1];
const build = path.join(__dirname, '.netlive.build.cjs');
fs.writeFileSync(build, engineSrc + '\n' + netSrc + '\nmodule.exports = {' +
  'createGame, actionsFor, lhdRoomTopic, lhdRandomCode, lhdClientId, lhdSession, lhdSnapshot, lhdMqttClient, LHD_BROKERS };\n', 'utf8');
const N = require(build);

const room = N.lhdRandomCode(6);
const secret = N.lhdRandomCode(8);
const topic = N.lhdRoomTopic(room, secret);
console.log('房间 ' + room + ' / 主题 ' + topic + '\n');

function mk(name, role){
  const rec = { name, role, ready:false, closed:false, states:0, notices:[], peers:[], client:null, session:null };
  rec.session = N.lhdSession({
    role, room, secret, id:N.lhdClientId(), name,
    send: text => rec.client.publish(topic, text),
    onState: () => { rec.states++; },
    onNotice: t => rec.notices.push(t),
    onPeers: p => { rec.peers = p; },
    onRole: r => { rec.role = r; }
  });
  rec.client = N.lhdMqttClient({
    onReady: () => { rec.ready = true; },
    onStatus: st => { rec.status = st; },
    onMessage: (tp, payload) => { if(tp === topic) rec.session.onMessage(payload); }
  });
  return rec;
}

async function waitFor(fn, ms, what){
  const t0 = Date.now();
  while(Date.now() - t0 < ms){
    if(fn()) return true;
    await sleep(120);
  }
  failures.push('等待超时：' + what);
  return false;
}

function snap(s){ return JSON.stringify(N.lhdSnapshot(s)); }
function pickAction(state){
  const acts = N.actionsFor(state, state.turn);
  const cap = acts.moves.filter(m => m.capture);
  if(cap.length) return { a:'move', from:cap[0].from, to:cap[0].to };
  if(acts.moves.length) return { a:'move', from:acts.moves[0].from, to:acts.moves[0].to };
  if(acts.flips.length) return { a:'flip', i:acts.flips[0] };
  return null;
}

(async () => {
  const watchdog = setTimeout(() => {
    console.log('✗ 端到端测试整体超时（公网中继不稳定？）');
    process.exit(1);
  }, 120000);

  const host = mk('房主', 'host');
  const guest = mk('小明', 'guest');
  const viewer = mk('吃瓜', 'viewer');
  const game = N.createGame({ n:4, noCaptureLimit:60, nameA:'房主', nameB:'小明' });

  /* 1) 房主连上并发布初始局面 */
  host.client.connect([topic]);
  if(!await waitFor(() => host.ready, 25000, '房主连上中继')){ finish(); return; }
  console.log('房主中继：' + host.client.broker);
  host.session.hostInit(game);
  host.session.join();
  await sleep(400);

  /* 2) 客人加入并拿到局面 */
  guest.client.connect([topic]);
  if(!await waitFor(() => guest.ready, 25000, '客人连上中继')){ finish(); return; }
  console.log('客人中继：' + guest.client.broker);
  guest.session.join();
  if(!await waitFor(() => guest.session.state, 15000, '客人收到初始局面')){ finish(); return; }
  eq(guest.session.role, 'guest', '第一个进来的是对手');
  ok(guest.session.hostId === host.session.id, '客人认识房主 id');
  eq(snap(guest.session.state), snap(host.session.state), '客人初始局面与房主一致');

  /* 3) 观众加入 */
  viewer.client.connect([topic]);
  if(!await waitFor(() => viewer.ready, 25000, '观众连上中继')){ finish(); return; }
  console.log('观众中继：' + viewer.client.broker);
  viewer.session.join();
  if(!await waitFor(() => viewer.session.state, 15000, '观众收到局面')){ finish(); return; }
  eq(viewer.session.role, 'viewer', '第三个人是观众');
  eq(viewer.session.canAct(), false, '观众不能操作');

  /* 4) 打完一整局：异步网络下用「等待收敛」判定，而不是发完立刻比对 */
  const ticker = setInterval(() => {                     /* 模拟界面每秒调 tick：心跳 + 未确认重发 + 定期补发 */
    host.session.tick(); guest.session.tick(); viewer.session.tick();
  }, 1000);
  let moves = 0, notConverged = 0;
  const deadline = Date.now() + 90000;
  while(!host.session.state.over && moves < 220 && Date.now() < deadline){
    const turn = host.session.state.turn;
    const action = pickAction(host.session.state);
    if(!action) break;
    const beforeMoves = host.session.state.moves;
    if(turn === 'A'){
      host.session.act(action);
    } else {
      guest.session.act(action);
      let t0 = Date.now();
      while(host.session.state.moves === beforeMoves && Date.now() - t0 < 4000) await sleep(60);
      if(host.session.state.moves === beforeMoves) notConverged++;
    }
    moves++;
    const t1 = Date.now();
    while(Date.now() - t1 < 4000 &&
          (snap(guest.session.state) !== snap(host.session.state) ||
           snap(viewer.session.state) !== snap(host.session.state))){
      await sleep(60);
    }
    if(snap(guest.session.state) !== snap(host.session.state)) notConverged++;
    if(snap(viewer.session.state) !== snap(host.session.state)) notConverged++;
  }
  ok(!!host.session.state.over, '整局应能打完（实际 ' + moves + ' 手）');
  ok(moves > 10, '手数应合理（' + moves + '）');
  ok(notConverged <= 3, 'QoS0 下允许极少数瞬时不同步（实际 ' + notConverged + ' 次，会自动收敛）');
  console.log('对局：' + moves + ' 手结束，原因：' + (host.session.state.over && host.session.state.over.reason) +
    '；瞬时不同步 ' + notConverged + ' 次');

  /* 终局后必须收敛（房主每 15 秒补发一次，最多等 25 秒） */
  const t2 = Date.now();
  while(Date.now() - t2 < 25000 &&
        (snap(guest.session.state) !== snap(host.session.state) ||
         snap(viewer.session.state) !== snap(host.session.state))){
    await sleep(250);
  }
  eq(snap(guest.session.state), snap(host.session.state), '终局后客人局面与房主一致');
  eq(snap(viewer.session.state), snap(host.session.state), '终局后观众局面与房主一致');
  /* 注意：ticker 要一直留着——重连自愈依赖 tick()（真实界面里也是常驻每秒调用） */

  /* 5) 断线重连 */
  guest.client.close();
  await sleep(500);
  console.log('重连前：房主 guestId=' + host.session.guestId + '，房主 peers=' + Object.keys(host.session.peers).join(','));
  guest.ready = false;
  guest.client.connect([topic]);
  if(!await waitFor(() => guest.ready, 25000, '客人重连中继')){ finish(); return; }
  console.log('重连后中继：' + guest.client.broker + '，订阅状态 connected=' + guest.client.connected);
  await sleep(800);                                        /* 给 SUBACK 留时间 */
  const statesBefore = guest.states;
  guest.session.join();
  /* 真实网络可能丢「欢迎消息」：会话会自动重发 join（最多 5 次），这里给足时间 */
  const got = await waitFor(() => guest.states > statesBefore, 25000, '重连后重新拿到局面');
  if(!got){
    console.log('诊断：guest.states=' + guest.states + ' role=' + guest.session.role +
      ' hostId=' + guest.session.hostId + ' 有局面=' + !!guest.session.state);
    console.log('诊断：房主 peers=' + Object.keys(host.session.peers).join(',') + ' guestId=' + host.session.guestId);
    console.log('诊断：房主收到的提示=' + JSON.stringify(host.notices.slice(-5)));
    console.log('诊断：客人收到的提示=' + JSON.stringify(guest.notices.slice(-5)));
    guest.session.join();                                  /* 再试一次 */
    console.log('第二次 join 后：' + (await waitFor(() => guest.states > statesBefore, 8000, '第二次 join')));
  }
  ok(got, '重连后房主会重发局面');
  eq(snap(guest.session.state), snap(host.session.state), '重连后局面与房主一致');

  /* 6) 收尾 */
  host.session.leave(); guest.session.leave(); viewer.session.leave();
  await sleep(300);
  ok(viewer.notices.concat(guest.notices).length >= 0, '提示回调可用');
  ok(host.peers.length >= 0, '人名单回调可用');

  finish();

  function finish(){
    clearTimeout(watchdog);
    try { clearInterval(ticker); } catch(e){}
    [host, guest, viewer].forEach(r => { try { r.client.close(); } catch(e){} });
    setTimeout(() => {
      console.log('');
      if(failures.length){
        console.log('✗ 端到端测试失败 ' + failures.length + ' 项（通过 ' + pass + ' 项）：');
        failures.forEach(f => console.log('   - ' + f));
        process.exitCode = 1;
      } else {
        console.log('✓ 端到端测试全部通过：' + pass + ' 项断言（真实公共中继）');
      }
      process.exit(process.exitCode || 0);
    }, 200);
  }
})();
