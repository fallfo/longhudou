'use strict';
/*
 * 联机模块测试（不需要网络）：报文编解码、快照 restore 校验、假中继下的整局同步/观战/拒绝/重连
 * 用法：node tools/test-net.cjs
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0;
const failures = [];
const ok = (c, m) => { if(c){ pass++; } else { failures.push(m); } };
const eq = (a, b, m) => ok(Object.is(a, b), m + ' | got=' + JSON.stringify(a) + ' want=' + JSON.stringify(b));

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const engineSrc = (html.match(/\/\*==ENGINE_START==\*\/([\s\S]*?)\/\*==ENGINE_END==\*\//) || [])[1];
const netSrc = (html.match(/\/\*==NET_START==\*\/([\s\S]*?)\/\*==NET_END==\*\//) || [])[1];
ok(!!engineSrc, 'index.html 应含引擎标记');
ok(!!netSrc, 'index.html 应含 NET 标记');
if(!engineSrc || !netSrc){ report(); process.exit(1); }

const build = path.join(__dirname, '.net.build.cjs');
fs.writeFileSync(build,
  engineSrc + '\n' + netSrc + '\nmodule.exports = {' +
  'CARDS, CARD_MAP, createGame, actionsFor, applyFlip, applyMove, canCapture, pieceCount, checkOver,' +
  'lhdRandomCode, lhdClientId, lhdRoomTopic, LHD_ALPHABET, LHD_BROKERS,' +
  'lhdUtf8Bytes, lhdUtf8Decode, lhdConnectPacket, lhdSubscribePacket, lhdPublishPacket, lhdPingPacket, lhdParsePacket,' +
  'lhdSnapshot, lhdRestore, lhdSession };\n', 'utf8');
const N = require(build);

/* ══ 1. 房间号 / 主题 ══ */
{
  eq(N.lhdRoomTopic('K7M2QP', 'a1b2c3d4'), 'longhudou/v1/K7M2QP/a1b2c3d4', '主题格式');
  eq(N.lhdRandomCode(6).length, 6, '房间号长度 6');
  const re = new RegExp('^[' + N.LHD_ALPHABET + ']+$');
  let allOk = true;
  for(let i = 0; i < 200; i++){
    const c = N.lhdRandomCode(6);
    if(!re.test(c)) allOk = false;
  }
  ok(allOk, '房间号只用免混淆字符表');
  ok(N.LHD_ALPHABET.indexOf('O') < 0 && N.LHD_ALPHABET.indexOf('0') < 0 && N.LHD_ALPHABET.indexOf('I') < 0 && N.LHD_ALPHABET.indexOf('1') < 0,
    '字符表里不应有 O/0/I/1');
  eq(N.lhdClientId().indexOf('lhd-'), 0, 'clientId 前缀');
  ok(N.LHD_BROKERS.length >= 2, '应配置备用中继');
}

/* ══ 2. UTF-8 与 MQTT 报文 ══ */
{
  ['abc', '龙虎斗', '龙王吃小王虎🙂', 'ｆｕｌｌｗｉｄｔｈ', 'a\u0000b'].forEach(s => {
    const bytes = N.lhdUtf8Bytes(s);
    eq(N.lhdUtf8Decode(bytes, 0, bytes.length), s, 'UTF-8 往返：' + JSON.stringify(s));
  });

  const t = 'longhudou/v1/ABCDEF/12345678';
  const payload = '{"t":"state","st":"龙王🙂"}';
  const pkt = N.lhdPublishPacket(t, payload);
  eq(pkt[0] >> 4, 3, 'PUBLISH 报文类型');
  const parsed = N.lhdParsePacket(pkt);
  eq(parsed.type, 3, '解析出 PUBLISH');
  eq(parsed.topic, t, '主题往返一致');
  eq(parsed.payload, payload, '载荷往返一致（含中文与 emoji）');

  const connect = N.lhdConnectPacket('lhd-abcdefghij', 45);
  eq(connect[0] >> 4, 1, 'CONNECT 报文类型');
  eq(N.lhdUtf8Decode(connect, 4, 4), 'MQTT', '协议名');
  eq(connect[8], 4, '协议级别 3.1.1');
  eq(connect[9] & 2, 2, 'clean session 置位');
  eq((connect[10] << 8) | connect[11], 45, 'keepalive');

  const sub = N.lhdSubscribePacket(t, 1);
  eq(sub[0] >> 4, 8, 'SUBSCRIBE 类型');
  eq(sub[0] & 0x0f, 2, 'SUBSCRIBE 标志位应为 2');

  eq(N.lhdPingPacket()[0], 0xc0, 'PINGREQ');
  eq(N.lhdParsePacket(new Uint8Array([0x20, 0x02, 0x00, 0x00])).rc, 0, 'CONNACK rc=0');
  eq(N.lhdParsePacket(new Uint8Array([0x20, 0x02, 0x00, 0x05])).rc, 5, 'CONNACK rc=5');
  eq(N.lhdParsePacket(null), null, '空报文返回 null');
}

/* ══ 3. 快照 / 还原 ══ */
{
  const g = N.createGame({ n:4, diagonal:true, tigerEatsAll:false, kingEatsWeakest:false, noCaptureLimit:60 });
  g.names = { A:'房主', B:'对手' };
  N.applyFlip(g, 0);                       /* 先翻一张，进入有阵营的状态 */
  const sn = N.lhdSnapshot(g);
  const back = N.lhdRestore(JSON.parse(JSON.stringify(sn)));
  ok(!!back, '快照应能还原');
  eq(N.lhdSnapshot(back).cells.length, 16, '还原后格数一致');
  eq(JSON.stringify(N.lhdSnapshot(back)), JSON.stringify(sn), '还原后快照与原始一致');
  ok(back !== g, '还原出来的是新对象');
  eq(back.names.B, '对手', '昵称随快照同步');
  ok(back.kingEatsWeakest === false && back.noCaptureLimit === 60, '规则开关随快照同步');

  for(let i = 0; i < 40; i++) N.lhdSnapshot(g).lg.length;   /* 触发日志增长 */
  ok(N.lhdSnapshot(g).lg.length <= 30, '日志最多带最近 30 条');

  eq(N.lhdRestore(null), null, 'null 快照被拒');
  eq(N.lhdRestore({}), null, '空对象被拒');
  eq(N.lhdRestore({ n:4, cells:[], tn:'A' }), null, '格数不符被拒');
  const bad1 = JSON.parse(JSON.stringify(sn)); bad1.tn = 'X';
  eq(N.lhdRestore(bad1), null, '非法 turn 被拒');
  const bad2 = JSON.parse(JSON.stringify(sn)); bad2.cells[0] = ['ZZ', 1];
  eq(N.lhdRestore(bad2), null, '未知牌 id 被拒');
  const bad3 = JSON.parse(JSON.stringify(sn));
  const firstId = bad3.cells.find(c => c !== 0)[0];
  bad3.cells[bad3.cells.findIndex(c => c !== 0) + 1] = [firstId, 1];
  eq(N.lhdRestore(bad3), null, '重复牌 id 被拒');
  const bad4 = JSON.parse(JSON.stringify(sn)); bad4.cp.A = ['NOT_A_CARD'];
  eq(N.lhdRestore(bad4), null, '非法战利品被拒');
}

/* ══ 4. 房间会话：假中继 ══ */
function createBus(echo){
  const members = [];
  const queue = [];
  let flushing = false;
  let drop = false;
  function flush(){
    if(flushing) return;
    flushing = true;
    while(queue.length){ queue.shift()(); }
    flushing = false;
  }
  return {
    add(session){ members.push(session); },
    /* echo=true 模拟真实 MQTT：广播给所有订阅者，包括发布者自己 */
    deliver(from, text){
      if(drop) return;                       /* 模拟丢包 */
      members.forEach(m => { if(echo || m !== from) queue.push(() => m.onMessage(text)); });
      flush();
    },
    setDrop(v){ drop = !!v; },
    inject(text){ queue.push(() => members.forEach(m => m.onMessage(text))); flush(); },
    size(){ return members.length; }
  };
}
function pickAction(state){
  const acts = N.actionsFor(state, state.turn);
  const cap = acts.moves.filter(m => m.capture);
  if(cap.length) return { a:'move', from:cap[0].from, to:cap[0].to };
  if(acts.moves.length) return { a:'move', from:acts.moves[0].from, to:acts.moves[0].to };
  if(acts.flips.length) return { a:'flip', i:acts.flips[0] };
  return null;
}
function makeSession(bus, cfg){
  const events = { states:0, notices:[], rejects:0, peers:[], roles:[] };
  const session = N.lhdSession({
    role:cfg.role, room:cfg.room, secret:cfg.secret, id:cfg.id, name:cfg.name,
    send: text => bus.deliver(session, text),
    onState: st => { events.states++; events.lastState = st; },
    onNotice: t => events.notices.push(t),
    onReject: () => { events.rejects++; },
    onPeers: p => { events.peers = p; },
    onRole: r => { events.roles.push(r); }
  });
  bus.add(session);
  return { session, events };
}

{
  const room = 'K7M2QP', secret = 'a1b2c3d4';
  const bus = createBus();
  const host = makeSession(bus, { role:'host', room, secret, id:'HOST1', name:'房主' });
  const guest = makeSession(bus, { role:'guest', room, secret, id:'GUEST1', name:'小明' });
  const viewer = makeSession(bus, { role:'viewer', room, secret, id:'WATCH1', name:'吃瓜' });

  const game = N.createGame({ n:4, noCaptureLimit:60, nameA:'房主', nameB:'小明' });
  host.session.hostInit(game);
  eq(host.events.states, 0, '房主初始化不触发自己的 onState');

  guest.session.join();
  ok(!!guest.session.state, '客人加入后应收到局面');
  eq(guest.session.role, 'guest', '第一个进来的是对手');
  eq(guest.events.roles[0], 'guest', '客人角色回调');
  eq(guest.session.hostId, 'HOST1', '知道房主 id');
  eq(host.session.guestId, 'GUEST1', '房主记下对手座位');
  ok(host.events.notices.join('').indexOf('小明') >= 0, '房主收到“加入”提示');

  viewer.session.join();
  eq(viewer.session.role, 'viewer', '第二个人进来是观众');
  ok(!!viewer.session.state, '观众也能拿到局面');
  eq(viewer.session.canAct(), false, '观众不能操作');
  eq(viewer.session.act({ a:'flip', i:0 }).ok, false, '观众 act 被拒');
  ok(host.events.notices.join('').indexOf('观战') >= 0, '房主收到观战提示');

  /* 错误 secret 的消息必须被忽略 */
  const before = JSON.stringify(N.lhdSnapshot(guest.session.state));
  bus.inject(JSON.stringify({ k:'WRONGKEY', t:'state', st:{ n:4, cells:new Array(16).fill(0), tn:'A' }, sq:999 }));
  eq(JSON.stringify(N.lhdSnapshot(guest.session.state)), before, '错误 secret 的快照被忽略');

  /* 观众试图走子 → 房主忽略（不是座位上的人） */
  const turnBefore = host.session.state.turn;
  bus.inject(JSON.stringify({ k:secret, t:'flip', id:'WATCH1', i:0 }));
  eq(host.session.state.turn, turnBefore, '房主忽略非座位客户端的走子');

  /* 客人发非法走子 → 收到 reject，局面不变（先让房主走一步，轮到客人） */
  host.session.act(pickAction(host.session.state));
  eq(host.session.state.turn, 'B', '房主走完轮到客人');
  const snapBefore = JSON.stringify(N.lhdSnapshot(host.session.state));
  guest.session.act({ a:'move', from:0, to:0 });     /* 原地不动：明显非法 */
  eq(guest.events.rejects, 1, '回合内的非法走子应被拒绝');
  eq(JSON.stringify(N.lhdSnapshot(host.session.state)), snapBefore, '被拒的走子不改变局面');
  eq(guest.session.pending, null, '被明确拒绝后不应再重发');

  /* 打到分出胜负，每一步都校验三方局面一致 */
  let steps = 0, mismatch = 0, viewerLag = 0;
  while(!host.session.state.over && steps < 600){
    const turn = host.session.state.turn;
    const actor = (turn === 'A') ? host.session : guest.session;
    const action = pickAction(actor.state || host.session.state);
    if(!action) break;
    if(actor === host.session) host.session.act(action);
    else guest.session.act(action);
    const h = JSON.stringify(N.lhdSnapshot(host.session.state));
    if(h !== JSON.stringify(N.lhdSnapshot(guest.session.state))) mismatch++;
    if(h !== JSON.stringify(N.lhdSnapshot(viewer.session.state))) viewerLag++;
    steps++;
  }
  ok(!!host.session.state.over, '联机对局应能打完（实际 ' + steps + ' 手）');
  eq(mismatch, 0, '每一步后客人局面都与房主一致');
  eq(viewerLag, 0, '每一步后观众局面都与房主一致');
  ok(steps > 10, '对局应有相当手数（' + steps + '）');

  /* 断线重连：客人再次 join 应拿到当前局面 */
  guest.events.states = 0;
  guest.session.join();
  ok(guest.events.states >= 1, '重连后能重新拿到局面');
  eq(JSON.stringify(N.lhdSnapshot(guest.session.state)), JSON.stringify(N.lhdSnapshot(host.session.state)), '重连后局面一致');

  /* 心跳与在线判定 */
  host.session.peers['GUEST1'].last = Date.now() - 60000;
  host.session.tick();
  const g1 = host.events.peers.filter(p => p.id === 'GUEST1')[0];
  ok(g1 && g1.online === false, '超时未心跳应标记为离线');

  /* 房主离开 */
  host.session.leave();
  ok(guest.events.notices.join('').indexOf('房主已离开') >= 0, '客人应收到房主离开提示');
}

/* ══ 5. 回显模式（真实 MQTT 会把消息广播回发布者自己）══ */
{
  const room = 'ECHO01', secret = 'deadbeef';
  const bus = createBus(true);
  const host = makeSession(bus, { role:'host', room, secret, id:'HOST1', name:'房主' });
  const guest = makeSession(bus, { role:'guest', room, secret, id:'GUEST1', name:'小明' });
  const game = N.createGame({ n:4, noCaptureLimit:60, nameA:'房主', nameB:'小明' });
  host.session.hostInit(game);
  guest.session.join();
  eq(host.session.guestId, 'GUEST1', '回显模式下房主不应把自己当成客人占座');
  eq(Object.keys(host.session.peers).join(','), 'GUEST1', '回显模式下房主的人名单里应只有对手');
  eq(host.session.role, 'host', '房主角色不应被自己的 join 消息改掉');
  ok(!!guest.session.state, '客人仍能正常拿到局面');

  const action = pickAction(host.session.state);
  const before = host.session.state.moves;
  host.session.act(action);
  eq(host.session.state.moves, before + 1, '回显模式下房主走子正常');
  eq(JSON.stringify(N.lhdSnapshot(guest.session.state)), JSON.stringify(N.lhdSnapshot(host.session.state)),
    '回显模式下客人局面同步');
}
/* ══ 6. 协议防错：回合校验 / 过期意图 / 丢包重发 ══ */
{
  const room = 'PROTO1', secret = 'cafebabe';
  const bus = createBus(false);
  const host = makeSession(bus, { role:'host', room, secret, id:'HOST1', name:'房主' });
  const guest = makeSession(bus, { role:'guest', room, secret, id:'GUEST1', name:'小明' });
  const game = N.createGame({ n:4, noCaptureLimit:60, nameA:'房主', nameB:'小明' });
  host.session.hostInit(game);
  guest.session.join();
  eq(host.session.state.turn, 'A', '开局轮到房主');

  /* (a) 房主回合时，对手发来的意图必须被忽略 */
  const hSnap = JSON.stringify(N.lhdSnapshot(host.session.state));
  bus.inject(JSON.stringify({ k:secret, t:'flip', id:'GUEST1', sq:host.session.state.moves, i:0 }));
  eq(JSON.stringify(N.lhdSnapshot(host.session.state)), hSnap, '房主回合时对手的意图被忽略');

  /* 房主走一步，轮到对手 */
  const actA = pickAction(host.session.state);
  host.session.act(actA);
  eq(host.session.state.turn, 'B', '房主走完轮到对手');
  const hostMoves = host.session.state.moves;

  /* (b) 过期意图（序号对不上）：局面不变，但房主应补发最新局面让对方自愈 */
  const guestStatesBefore = guest.events.states;
  bus.inject(JSON.stringify({ k:secret, t:'flip', id:'GUEST1', sq:hostMoves - 5, i:0 }));
  eq(host.session.state.moves, hostMoves, '过期意图不会改变局面');
  ok(guest.events.states > guestStatesBefore, '过期意图会触发房主补发最新局面');

  /* (c) 正常意图生效 */
  const actB = pickAction(host.session.state);
  guest.session.act(actB);
  ok(host.session.state.moves > hostMoves, '对手的合法意图被采纳');
  eq(host.session.state.turn, 'A', '对手走完轮回房主');
  ok(guest.session.pending === null, '收到新快照后待确认意图被清空');

  /* (d) 丢包时自动重发 */
  const actA2 = pickAction(host.session.state);
  host.session.act(actA2);
  const guestMoves = host.session.state.moves;
  bus.setDrop(true);                             /* 开始丢包 */
  const actB2 = pickAction(host.session.state);
  guest.session.act(actB2);
  eq(host.session.state.moves, guestMoves, '丢包时房主当然没动');
  guest.session.pending.at = Date.now() - 3000;  /* 假装等了 3 秒 */
  bus.setDrop(false);                            /* 网络恢复 */
  guest.session.tick();                          /* 触发重发 */
  ok(host.session.state.moves > guestMoves, '重发后房主采纳了这一步');
  eq(host.session.state.turn, 'A', '重发生效后轮次正确');
}

report();
function report(){
  console.log('');
  if(failures.length){
    console.log('✗ 联机测试失败 ' + failures.length + ' 项（通过 ' + pass + ' 项）：');
    failures.forEach(f => console.log('   - ' + f));
    process.exitCode = 1;
  } else {
    console.log('✓ 联机测试全部通过：' + pass + ' 项断言');
  }
}
