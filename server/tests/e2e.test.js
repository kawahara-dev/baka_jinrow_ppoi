// 実行方法: リポジトリのルートで `node --test server/tests/e2e.test.js`
// オンライン対戦フェーズ1 第5歩：スクリプト化した複数クライアント＋
// CPU 補充で1試合を通しテスト。2人の人間クライアント（Node 組み込み
// WebSocket）が部屋を作って参加し、夜入力・定型文の発言・議論終了・
// 投票を送りながら、残り6席の CPU と一緒に試合が最後まで回ることを
// 実際のサーバーで確認する。秘匿（実役職・うっかり flag・トークン）が
// 試合終了前の view に漏れていないことも見る。
// seed 固定の決定的な乱数源で配役を固定する。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server.js");
const { ROLES } = require("../../game-logic.js");

const IMPOSTOR_ROLE_KEYS = ["fakeGirl", "mimic"];

// 決定的な乱数源（mulberry32）。配役を seed で固定する。
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 制限時間内に終わらなければ失敗させる（試合の進行停止の証明にも使う）。
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)
    ),
  ]);
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
  });
}

// ソケットに届くメッセージをためておくキュー。接続直後に購読して
// おけば、送信直後に届くメッセージも取り逃がさない。
function messageQueue(ws) {
  const queue = [];
  const waiters = [];
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  return {
    next() {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
}

async function withServer(fn, options) {
  const server = createServer(options);
  const port = await listen(server);
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

// 生存中の他人を1人選ぶ。夜入力ではインポスターの仲間を除く。
function aliveOther(view, excludeAllies) {
  const allies = new Set((view.me.allies || []).map((a) => a.id));
  return view.players.find(
    (p) => p.alive && p.id !== view.me.id && (!excludeAllies || !allies.has(p.id))
  );
}

// 1人のスクリプト化クライアント。gameEnded が届くまで回す。
// record には届いたメッセージの種別と view をためる（秘匿の検証用）。
// - 夜：表示役職に夜行動があれば（インポスター含む）生存中の他人へ送る。
//   バカが表示役職で送ってもサーバーが弾くので、error は無視する。
// - 議論：定型文を1つ送ってから discussionDone を送る。
// - 投票：生存中の他人へ1票入れる。
// 死亡した席は何も送らず、gameEnded を待つだけになる。
async function driveClient(ws, q, name, record) {
  for (;;) {
    const msg = await withTimeout(q.next(), 10000, `${name} next message`);
    record.types[msg.type] = (record.types[msg.type] || 0) + 1;
    if (msg.type === "gameEnded") return msg;
    if (msg.type === "error") continue;
    if (msg.view) record.views.push(msg.view);
    if (msg.type === "discussionStarted" || msg.type === "discussionEnded" || msg.type === "voteResolved") {
      record.events.push({
        type: msg.type,
        day: msg.view.day,
        at: Date.now(),
        bothDead: !msg.view.players[0].alive && !msg.view.players[1].alive,
      });
    }
    if (
      msg.type === "gameStarted" ||
      msg.type === "nightResolved" ||
      msg.type === "voteResolved"
    ) {
      const view = msg.view;
      if (!view || view.phase !== "night") continue;
      const me = view.players.find((p) => p.id === view.me.id);
      if (!me || !me.alive) continue;
      const isImp = IMPOSTOR_ROLE_KEYS.includes(view.me.roleKey);
      if (isImp || ROLES[view.me.roleKey]?.nightAction) {
        const target = aliveOther(view, true);
        if (target) ws.send(JSON.stringify({ type: "nightAction", targetId: target.id }));
      }
      continue;
    }
    if (msg.type === "discussionStarted") {
      const view = msg.view;
      const me = view.players.find((p) => p.id === view.me.id);
      if (!me || !me.alive) continue;
      ws.send(JSON.stringify({ type: "talk", phraseId: "agree" }));
      ws.send(JSON.stringify({ type: "discussionDone" }));
      continue;
    }
    if (msg.type === "discussionEnded") {
      const view = msg.view;
      const me = view.players.find((p) => p.id === view.me.id);
      if (!me || !me.alive) continue;
      const target = aliveOther(view, false);
      if (target) ws.send(JSON.stringify({ type: "vote", targetId: target.id }));
      continue;
    }
    // talk の配信・roomUpdate・受理の返信は無視する。
  }
}

// 2人のスクリプト化クライアントで1試合を通しで回す。
// ドライバーを先に回し始めてから startGame を送る（夜1日目の入力も拾う）。
// 失敗時はソケットを閉じてから投げる（開いたままだと server.close が待つ）。
// 戻り値は両クライアントの gameEnded と記録。
async function playFullGame(port, options) {
  const host = await connectWs(port);
  const guest = await connectWs(port);
  const hq = messageQueue(host);
  const gq = messageQueue(guest);
  const hostRecord = { types: {}, views: [], events: [] };
  const guestRecord = { types: {}, views: [], events: [] };
  try {
    host.send(JSON.stringify({ type: "createRoom" }));
    const created = await hq.next();
    const hostUpdate = hq.next();
    guest.send(JSON.stringify({ type: "joinRoom", code: created.code }));
    assert.equal((await gq.next()).type, "roomJoined");
    // 参加の roomUpdate は参加者本人にも配信されるので読み捨てる。
    assert.equal((await gq.next()).type, "roomUpdate");
    await hostUpdate;
    const gamePromise = Promise.all([
      driveClient(host, hq, "host", hostRecord),
      driveClient(guest, gq, "guest", guestRecord),
    ]);
    host.send(JSON.stringify({ type: "startGame" }));
    const [hostEnded, guestEnded] = await withTimeout(gamePromise, 30000, "full game");
    return { hostEnded, guestEnded, hostRecord, guestRecord };
  } finally {
    host.close();
    guest.close();
  }
}

// 試合終了前の view に秘匿情報が漏れていないことを確認する。
// gameEnded の結果開示（全員の実役職）はここでは見ない。
function assertNoSecrets(record) {
  for (const view of record.views) {
    const json = JSON.stringify(view);
    assert.equal(json.includes("baka"), false);
    assert.equal(json.includes("clumsy"), false);
    assert.equal(json.includes("token"), false);
    assert.equal(json.includes("fakeDisplayRoleKey"), false);
  }
}

// gameEnded の共通の形を確認する。
function assertGameEnded(ended, day, winnerFaction) {
  assert.equal(ended.type, "gameEnded");
  assert.equal(ended.view.phase, "end");
  assert.equal(ended.view.day, day);
  assert.equal(ended.view.players.length, 8);
  assert.equal(ended.result.winnerFaction, winnerFaction);
  assert.ok(ended.result.winText.length > 0);
  assert.equal(ended.result.rows.length, 8);
  assert.ok(Array.isArray(ended.result.highlights));
}

test("通し：2人の人間＋CPU 6席で試合が最後まで回り、インポスターが勝つ", async () => {
  // seed 1：2日目で決着（夜→議論→投票→夜の解決でインポスター勝利）。
  await withServer(async (port) => {
    const { hostEnded, guestEnded, hostRecord, guestRecord } = await playFullGame(port);
    assertGameEnded(hostEnded, 2, "インポスター");
    assertGameEnded(guestEnded, 2, "インポスター");
    assert.equal(hostEnded.result.winText, guestEnded.result.winText);
    assert.ok(hostEnded.result.winText.includes("インポスター陣営の勝利"));
    // 夜・議論・投票の全フェーズを両クライアントが通った。
    for (const record of [hostRecord, guestRecord]) {
      for (const type of [
        "gameStarted",
        "nightResolved",
        "discussionStarted",
        "discussionEnded",
        "voteResolved",
        "gameEnded",
      ]) {
        assert.ok(record.types[type] >= 1, `${type} が届いていない`);
      }
      assertNoSecrets(record);
    }
    // 夜の個人ログは席ごと（守り手と政治家で違う）。
    assert.notEqual(hostRecord.views.length, 0);
  }, { random: seededRandom(1), nightTimeoutMs: 150, discussTimeoutMs: 150, voteTimeoutMs: 150 });
});

test("通し：2人の人間＋CPU 6席で試合が最後まで回り、イノセントが勝つ", async () => {
  // seed 6：2日目で決着（インポスター追放でイノセント勝利）。
  await withServer(async (port) => {
    const { hostEnded, guestEnded, hostRecord, guestRecord } = await playFullGame(port);
    assertGameEnded(hostEnded, 2, "イノセント");
    assertGameEnded(guestEnded, 2, "イノセント");
    assert.ok(hostEnded.result.winText.includes("イノセント陣営の勝利"));
    for (const record of [hostRecord, guestRecord]) {
      assertNoSecrets(record);
    }
  }, { random: seededRandom(6), nightTimeoutMs: 150, discussTimeoutMs: 150, voteTimeoutMs: 150 });
});

test("回帰：人間2人とも死亡した夜明けの議論は、タイマーなしでもすぐ投票へ進む", async () => {
  // seed 2：2日目の夜明け時点で人間2人とも死亡している。議論タイマーと
  // 投票タイマーは既定（議論はタイマーなし、投票は60秒）にしておく。
  // 修正前は discussionStarted のあと誰も discussionDone を送れず議論が
  // 止まり、仮に議論が終わっても投票は誰も vote を送れず60秒待っていた。
  await withServer(async (port) => {
    const { hostEnded, guestEnded, hostRecord, guestRecord } = await playFullGame(port);
    // 2日目の議論は始まった直後に終わる（2秒以内の到着なら即終了の証明）。
    const started = hostRecord.events.find(
      (e) => e.type === "discussionStarted" && e.day === 2 && e.bothDead
    );
    assert.ok(started, "人間2人とも死亡した2日目の議論開始が見つからない");
    const ended = hostRecord.events.find(
      (e) => e.type === "discussionEnded" && e.day === 2 && e.at >= started.at
    );
    assert.ok(ended, "2日目の議論終了が届いていない");
    assert.ok(
      ended.at - started.at < 2000,
      `議論終了が遅い: ${ended.at - started.at}ms`
    );
    // 2日目の投票も始まった直後に集計される（60秒待たないことの証明）。
    const resolved = hostRecord.events.find(
      (e) => e.type === "voteResolved" && e.at >= ended.at
    );
    assert.ok(resolved, "2日目の投票集計が届いていない");
    assert.ok(
      resolved.at - ended.at < 2000,
      `投票集計が遅い: ${resolved.at - ended.at}ms`
    );
    assertGameEnded(hostEnded, 3, "インポスター");
    assertGameEnded(guestEnded, 3, "インポスター");
    for (const record of [hostRecord, guestRecord]) {
      assertNoSecrets(record);
    }
  }, { random: seededRandom(2), nightTimeoutMs: 150 });
});
