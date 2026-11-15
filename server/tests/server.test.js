// 実行方法: リポジトリのルートで `node --test server/tests/server.test.js`
// 最小サーバー（server/server.js）の通しテスト。実際に HTTP + WebSocket で
// 接続し、部屋の作成/参加・セッショントークン・キャラ割当を確認する。
// Node 24 の組み込み WebSocket クライアントを使う。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createServer } = require("../server.js");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

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

// 制限時間内に届かなければ失敗させる（夜の即解決の証明にも使う）。
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timeout: ${label}`)), ms)
    ),
  ]);
}

function connectWs(port) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
  });
}

// 次に届くメッセージを1件待つ。
function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.addEventListener("message", function handler(event) {
      ws.removeEventListener("message", handler);
      resolve(JSON.parse(event.data));
    });
  });
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

// 期待する error が届くまで読む。夜が即解決した場合、nightResolved が
// 先に届くことがあるので読み飛ばす。
async function nextError(ws, expected) {
  for (let i = 0; i < 3; i++) {
    const msg = await nextMessage(ws);
    if (msg.error === expected) return msg;
  }
  throw new Error(`expected error ${expected} not received`);
}

// ソケットに届くメッセージをためておくキュー。接続直後に購読して
// おけば、夜の即解決のように送信直後に届くメッセージも取り逃がさない。
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

// 2人で部屋を作って試合を開始し、gameStarted を両方で受け取る。
// 戻り値の hq / gq は各ソケットのメッセージキュー。
// 失敗時はソケットを閉じてから投げる（開いたままだと server.close が待つ）。
async function startTwoPlayerGame(port) {
  const host = await connectWs(port);
  const guest = await connectWs(port);
  const hq = messageQueue(host);
  const gq = messageQueue(guest);
  try {
    host.send(JSON.stringify({ type: "createRoom" }));
    const created = await hq.next();
    const hostUpdate = hq.next();
    guest.send(JSON.stringify({ type: "joinRoom", code: created.code }));
    assert.equal((await gq.next()).type, "roomJoined");
    // 参加の roomUpdate は参加者本人にも配信されるので読み捨てる。
    assert.equal((await gq.next()).type, "roomUpdate");
    await hostUpdate;
    const hostStarted = hq.next();
    const guestStarted = gq.next();
    host.send(JSON.stringify({ type: "startGame" }));
    const hostMsg = await hostStarted;
    const guestMsg = await guestStarted;
    assert.equal(hostMsg.type, "gameStarted");
    assert.equal(guestMsg.type, "gameStarted");
    return { host, guest, hq, gq, hostMsg, guestMsg };
  } catch (err) {
    host.close();
    guest.close();
    throw err;
  }
}

test("静的配信：/ は index.html、/game-logic.js は共有モジュールを返す", async () => {
  await withServer(async (port) => {
    const index = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get("content-type"), /text\/html/);
    const indexText = await index.text();
    assert.match(indexText, /FakeBloomLogic/);

    const logic = await fetch(`http://127.0.0.1:${port}/game-logic.js`);
    assert.equal(logic.status, 200);
    assert.match(await logic.text(), /FakeBloomLogic/);
  });
});

test("静的配信：server/ 配下と存在しないファイルは 404 になる", async () => {
  await withServer(async (port) => {
    const serverFile = await fetch(`http://127.0.0.1:${port}/server/server.js`);
    assert.equal(serverFile.status, 404);
    const missing = await fetch(`http://127.0.0.1:${port}/no-such-file.js`);
    assert.equal(missing.status, 404);
  });
});

test("WebSocket で部屋を作れる。作成者はルナでトークンが返る", async () => {
  await withServer(async (port) => {
    const ws = await connectWs(port);
    try {
      ws.send(JSON.stringify({ type: "createRoom" }));
      const msg = await nextMessage(ws);
      assert.equal(msg.type, "roomCreated");
      assert.equal(msg.code.length, 4);
      assert.equal(msg.playerId, 0);
      assert.equal(msg.name, "ルナ");
      assert.equal(typeof msg.token, "string");
      assert.ok(msg.token.length > 0);
      assert.deepEqual(msg.players, [{ id: 0, name: "ルナ", icon: "🌸", connected: true }]);
    } finally {
      ws.close();
    }
  });
});

test("2人目がコードで参加するとミオになり、両方に roomUpdate が届く", async () => {
  await withServer(async (port) => {
    const host = await connectWs(port);
    const guest = await connectWs(port);
    try {
      host.send(JSON.stringify({ type: "createRoom" }));
      const created = await nextMessage(host);
      // ホスト側の roomUpdate は参加時に届くので先に購読しておく。
      const hostUpdate = nextMessage(host);
      guest.send(JSON.stringify({ type: "joinRoom", code: created.code }));
      const joined = await nextMessage(guest);
      assert.equal(joined.type, "roomJoined");
      assert.equal(joined.code, created.code);
      assert.equal(joined.playerId, 1);
      assert.equal(joined.name, "ミオ");
      assert.notEqual(joined.token, created.token);
      assert.equal(joined.players.length, 2);

      const update = await hostUpdate;
      assert.equal(update.type, "roomUpdate");
      assert.equal(update.players.length, 2);
      assert.deepEqual(
        update.players.map((p) => p.name),
        ["ルナ", "ミオ"]
      );
      assert.equal("token" in update.players[0], false);
    } finally {
      host.close();
      guest.close();
    }
  });
});

test("存在しないコードへの参加は error になる", async () => {
  await withServer(async (port) => {
    const ws = await connectWs(port);
    try {
      ws.send(JSON.stringify({ type: "joinRoom", code: "ZZZZ" }));
      const msg = await nextMessage(ws);
      assert.equal(msg.type, "error");
      assert.equal(msg.error, "room_not_found");
    } finally {
      ws.close();
    }
  });
});

test("切断後にセッショントークンで同じ席へ再接続できる", async () => {
  await withServer(async (port) => {
    const first = await connectWs(port);
    first.send(JSON.stringify({ type: "createRoom" }));
    const created = await nextMessage(first);
    first.close();
    // 切断がサーバーへ伝わるのを少し待つ。
    await new Promise((resolve) => setTimeout(resolve, 50));

    const again = await connectWs(port);
    try {
      again.send(JSON.stringify({ type: "reconnect", code: created.code, token: created.token }));
      const msg = await nextMessage(again);
      assert.equal(msg.type, "reconnected");
      assert.equal(msg.playerId, 0);
      assert.equal(msg.name, "ルナ");
      assert.equal(msg.players[0].connected, true);
    } finally {
      again.close();
    }
  });
});

test("ホストが startGame すると両方に gameStarted が届き、秘匿情報は含まれない", async () => {
  await withServer(async (port) => {
    const host = await connectWs(port);
    const guest = await connectWs(port);
    try {
      host.send(JSON.stringify({ type: "createRoom" }));
      const created = await nextMessage(host);
      const hostUpdate = nextMessage(host);
      guest.send(JSON.stringify({ type: "joinRoom", code: created.code }));
      await nextMessage(guest);
      await hostUpdate;

      const hostStarted = nextMessage(host);
      const guestStarted = nextMessage(guest);
      host.send(JSON.stringify({ type: "startGame" }));
      const hostMsg = await hostStarted;
      const guestMsg = await guestStarted;
      assert.equal(hostMsg.type, "gameStarted");
      assert.equal(guestMsg.type, "gameStarted");
      assert.equal(hostMsg.view.me.id, 0);
      assert.equal(guestMsg.view.me.id, 1);
      assert.equal(hostMsg.view.players.length, 8);
      assert.equal(guestMsg.view.players.length, 8);
      // 8 席のうち 6 席は CPU 席。
      assert.equal(hostMsg.view.players.filter((p) => p.isCpu).length, 6);
      // 秘匿：実役職バカ・うっかり flag・トークンが view に漏れていない。
      for (const msg of [hostMsg, guestMsg]) {
        const json = JSON.stringify(msg.view);
        assert.equal(json.includes("baka"), false);
        assert.equal(json.includes("clumsy"), false);
        assert.equal(json.includes("token"), false);
        assert.equal(json.includes("fakeDisplayRoleKey"), false);
        assert.equal(typeof msg.view.me.roleKey, "string");
        assert.equal(msg.view.me.roleKey.length > 0, true);
      }
      // 2 回目の開始はエラー（夜が即解決して nightResolved が先に届く場合もある）。
      host.send(JSON.stringify({ type: "startGame" }));
      assert.equal((await nextError(host, "game_already_started")).error, "game_already_started");
    } finally {
      host.close();
      guest.close();
    }
  });
});

test("startGame：ホスト以外は not_host、1人では not_enough_players、部屋なしは not_in_room", async () => {
  await withServer(async (port) => {
    const lone = await connectWs(port);
    try {
      lone.send(JSON.stringify({ type: "startGame" }));
      assert.equal((await nextMessage(lone)).error, "not_in_room");
    } finally {
      lone.close();
    }

    const host = await connectWs(port);
    const guest = await connectWs(port);
    try {
      host.send(JSON.stringify({ type: "createRoom" }));
      const created = await nextMessage(host);
      host.send(JSON.stringify({ type: "startGame" }));
      assert.equal((await nextMessage(host)).error, "not_enough_players");

      const hostUpdate = nextMessage(host);
      guest.send(JSON.stringify({ type: "joinRoom", code: created.code }));
      await nextMessage(guest);
      await hostUpdate;
      guest.send(JSON.stringify({ type: "startGame" }));
      assert.equal((await nextMessage(guest)).error, "not_host");
    } finally {
      host.close();
      guest.close();
    }
  });
});

test("試合中の再接続では reconnected に現在の player view が付く", async () => {
  await withServer(async (port) => {
    const host = await connectWs(port);
    const guest = await connectWs(port);
    try {
      host.send(JSON.stringify({ type: "createRoom" }));
      const created = await nextMessage(host);
      const hostUpdate = nextMessage(host);
      guest.send(JSON.stringify({ type: "joinRoom", code: created.code }));
      const joined = await nextMessage(guest);
      await hostUpdate;

      const hostStarted = nextMessage(host);
      const guestStarted = nextMessage(guest);
      host.send(JSON.stringify({ type: "startGame" }));
      await hostStarted;
      await guestStarted;
      guest.close();
      await new Promise((resolve) => setTimeout(resolve, 50));

      const again = await connectWs(port);
      try {
        again.send(JSON.stringify({ type: "reconnect", code: created.code, token: joined.token }));
        const msg = await nextMessage(again);
        assert.equal(msg.type, "reconnected");
        assert.equal(msg.playerId, 1);
        assert.equal(msg.view.me.id, 1);
        assert.equal(msg.view.players.length, 8);
        assert.equal(JSON.stringify(msg.view).includes("baka"), false);
      } finally {
        again.close();
      }
    } finally {
      host.close();
      guest.close();
    }
  });
});

test("夜：両方の人間が入力するとすぐ nightResolved が届き、個人ログは席ごと", async () => {
  // seed 2：人間は占い師（id 0）と罠師（id 1）。両方とも夜入力が必要。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      host.send(JSON.stringify({ type: "nightAction", targetId: 2 }));
      assert.equal((await hq.next()).type, "nightActionAccepted");
      guest.send(JSON.stringify({ type: "nightAction", targetId: 3 }));
      assert.equal((await gq.next()).type, "nightActionAccepted");

      // タイムアウトは 5000ms。2秒以内の到着なら即解決の証明になる。
      const hostMsg = await withTimeout(hq.next(), 2000, "host nightResolved");
      const guestMsg = await withTimeout(gq.next(), 2000, "guest nightResolved");
      for (const msg of [hostMsg, guestMsg]) {
        assert.equal(msg.type, "nightResolved");
        assert.equal(msg.view.phase, "morning");
        assert.equal(msg.view.day, 1);
        assert.equal(msg.view.players.length, 8);
        assert.ok(Array.isArray(msg.night.publicLogs));
        assert.ok(["eliminated", "blocked", "none", "revived"].includes(msg.night.report.type));
        // 秘匿：実役職・うっかり flag・トークンが漏れていない。
        const json = JSON.stringify(msg);
        assert.equal(json.includes("baka"), false);
        assert.equal(json.includes("clumsy"), false);
        assert.equal(json.includes("token"), false);
        assert.equal(json.includes("fakeDisplayRoleKey"), false);
      }
      // 占い師と罠師はどちらも自分の夜結果だけを受け取る。
      assert.equal(typeof hostMsg.night.privateLog, "string");
      assert.equal(typeof guestMsg.night.privateLog, "string");
      assert.notEqual(hostMsg.night.privateLog, guestMsg.night.privateLog);
      assert.equal(JSON.stringify(hostMsg.night).includes(guestMsg.night.privateLog), false);
      assert.equal(JSON.stringify(guestMsg.night).includes(hostMsg.night.privateLog), false);
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(2), nightTimeoutMs: 5000 });
});

test("夜：タイムアウトで未入力は行動しない扱いで解決する", async () => {
  // seed 1：人間は守り手（id 0）と政治家（id 1）。守り手が送らないまま
  // 150ms のタイムアウトを迎える。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      const hostMsg = await withTimeout(hq.next(), 3000, "host nightResolved");
      const guestMsg = await withTimeout(gq.next(), 3000, "guest nightResolved");
      assert.equal(hostMsg.type, "nightResolved");
      assert.equal(guestMsg.type, "nightResolved");
      assert.equal(hostMsg.view.phase, "morning");
      assert.equal(guestMsg.view.phase, "morning");
      assert.ok(["eliminated", "blocked", "none", "revived"].includes(hostMsg.night.report.type));
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(1), nightTimeoutMs: 150 });
});

test("夜：誰も入力がいらない配役では開始直後に解決する", async () => {
  // seed 3：人間は政治家（id 0）とネズミ（id 1）。開始直後に解決する。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      // タイムアウトは 5000ms。2秒以内の到着なら即解決の証明になる。
      const hostMsg = await withTimeout(hq.next(), 2000, "host nightResolved");
      const guestMsg = await withTimeout(gq.next(), 2000, "guest nightResolved");
      assert.equal(hostMsg.type, "nightResolved");
      assert.equal(guestMsg.type, "nightResolved");
      assert.equal(hostMsg.view.phase, "morning");
      assert.equal(guestMsg.view.phase, "morning");
      // 夜行動のない席に個人ログはない。
      assert.equal(hostMsg.night.privateLog, null);
      assert.equal(guestMsg.night.privateLog, null);
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(3), nightTimeoutMs: 5000 });
});

test("夜入力の検証：部屋なし・試合なし・行動なし・対象外・夜以外は error になる", async () => {
  // seed 1：人間は守り手（id 0）と政治家（id 1）。
  await withServer(async (port) => {
    const stray = await connectWs(port);
    try {
      stray.send(JSON.stringify({ type: "nightAction", targetId: 2 }));
      assert.equal((await nextMessage(stray)).error, "not_in_room");
    } finally {
      stray.close();
    }

    const host = await connectWs(port);
    const guest = await connectWs(port);
    const hq = messageQueue(host);
    const gq = messageQueue(guest);
    try {
      host.send(JSON.stringify({ type: "createRoom" }));
      const created = await hq.next();
      // 試合前は no_game。
      host.send(JSON.stringify({ type: "nightAction", targetId: 2 }));
      assert.equal((await hq.next()).error, "no_game");

      const hostUpdate = hq.next();
      guest.send(JSON.stringify({ type: "joinRoom", code: created.code }));
      assert.equal((await gq.next()).type, "roomJoined");
      // 参加の roomUpdate は参加者本人にも配信されるので読み捨てる。
      assert.equal((await gq.next()).type, "roomUpdate");
      await hostUpdate;
      const hostStarted = hq.next();
      const guestStarted = gq.next();
      host.send(JSON.stringify({ type: "startGame" }));
      await hostStarted;
      await guestStarted;

      // 政治家（夜行動なし）は送れない。
      guest.send(JSON.stringify({ type: "nightAction", targetId: 2 }));
      assert.equal((await gq.next()).error, "no_night_action");
      // 存在しない対象は弾かれる。
      host.send(JSON.stringify({ type: "nightAction", targetId: 99 }));
      assert.equal((await hq.next()).error, "invalid_target");
      // 守り手は自分を守れる。
      host.send(JSON.stringify({ type: "nightAction", targetId: 0 }));
      assert.equal((await hq.next()).type, "nightActionAccepted");
      assert.equal((await withTimeout(hq.next(), 2000, "host nightResolved")).view.phase, "morning");
      assert.equal((await withTimeout(gq.next(), 2000, "guest nightResolved")).view.phase, "morning");
      // 夜の解決直後に議論が始まる（discussionStarted を読み捨てる）。
      assert.equal((await withTimeout(hq.next(), 2000, "host discussionStarted")).type, "discussionStarted");
      assert.equal((await withTimeout(gq.next(), 2000, "guest discussionStarted")).type, "discussionStarted");
      // 夜が明けたら夜入力は受け付けない。
      host.send(JSON.stringify({ type: "nightAction", targetId: 2 }));
      assert.equal((await hq.next()).error, "not_night");
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(1), nightTimeoutMs: 5000 });
});

test("議論：夜明け後に discussionStarted が届き、発言と議論終了で discussionEnded へ進む", async () => {
  // seed 8：人間は見張り役（id 0）と守り手（id 1）。両方とも夜入力が
  // 必要で、夜明け後も両方とも生存する（通しで確認済み）。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      host.send(JSON.stringify({ type: "nightAction", targetId: 2 }));
      assert.equal((await hq.next()).type, "nightActionAccepted");
      guest.send(JSON.stringify({ type: "nightAction", targetId: 3 }));
      assert.equal((await gq.next()).type, "nightActionAccepted");

      const hostResolved = await withTimeout(hq.next(), 2000, "host nightResolved");
      const guestResolved = await withTimeout(gq.next(), 2000, "guest nightResolved");
      assert.equal(hostResolved.type, "nightResolved");
      assert.equal(guestResolved.type, "nightResolved");
      // 夜の解決直後に議論が始まる。
      const hostStarted = await withTimeout(hq.next(), 2000, "host discussionStarted");
      const guestStarted = await withTimeout(gq.next(), 2000, "guest discussionStarted");
      for (const msg of [hostStarted, guestStarted]) {
        assert.equal(msg.type, "discussionStarted");
        assert.equal(msg.view.phase, "discussion");
        assert.equal(msg.view.day, 1);
        assert.ok(Array.isArray(msg.talks));
        // 人間2人なら CPU の発言は最大4件で、発言者は全員 CPU 席。
        assert.ok(msg.talks.length >= 1 && msg.talks.length <= 4);
        for (const e of msg.talks) {
          assert.ok(msg.view.players[e.speakerId].isCpu);
          if (e.type === "mouse") assert.equal(typeof e.publicRoleKey, "string");
        }
        const json = JSON.stringify(msg);
        assert.equal(json.includes("baka"), false);
        assert.equal(json.includes("clumsy"), false);
        assert.equal(json.includes("token"), false);
        assert.equal(json.includes("fakeDisplayRoleKey"), false);
      }

      // ホストの定型文は両方へ配信される。
      host.send(JSON.stringify({ type: "talk", phraseId: "agree" }));
      assert.deepEqual(await hq.next(), {
        type: "talk",
        code: hostStarted.code,
        speakerId: 0,
        speakerName: "ルナ",
        text: "そう思う",
      });
      assert.deepEqual(await gq.next(), {
        type: "talk",
        code: hostStarted.code,
        speakerId: 0,
        speakerName: "ルナ",
        text: "そう思う",
      });
      // ゲストの自由入力も両方へ配信される。
      guest.send(JSON.stringify({ type: "talk", text: "ちょっと待って" }));
      assert.deepEqual(await gq.next(), {
        type: "talk",
        code: hostStarted.code,
        speakerId: 1,
        speakerName: "ミオ",
        text: "ちょっと待って",
      });
      assert.deepEqual(await hq.next(), {
        type: "talk",
        code: hostStarted.code,
        speakerId: 1,
        speakerName: "ミオ",
        text: "ちょっと待って",
      });

      // 1人だけではまだ終わらない。
      host.send(JSON.stringify({ type: "discussionDone" }));
      assert.equal((await hq.next()).type, "discussionDoneAccepted");
      // 2人分が揃うと discussionEnded が両方へ届く。
      guest.send(JSON.stringify({ type: "discussionDone" }));
      assert.equal((await gq.next()).type, "discussionDoneAccepted");
      const hostEnded = await withTimeout(hq.next(), 2000, "host discussionEnded");
      const guestEnded = await withTimeout(gq.next(), 2000, "guest discussionEnded");
      assert.equal(hostEnded.type, "discussionEnded");
      assert.equal(guestEnded.type, "discussionEnded");
      assert.equal(hostEnded.view.phase, "vote");
      assert.equal(guestEnded.view.phase, "vote");
      // 投票フェーズでは発言できない。
      host.send(JSON.stringify({ type: "talk", phraseId: "agree" }));
      assert.equal((await hq.next()).error, "not_discussion");
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(8), nightTimeoutMs: 5000, discussTimeoutMs: 5000 });
});

test("議論：タイマーが切れると全員の discussionDone なしで投票へ進む", async () => {
  // seed 3：人間は政治家（id 0）とネズミ（id 1）。夜は開始直後に解決する。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      assert.equal((await withTimeout(hq.next(), 2000, "host nightResolved")).type, "nightResolved");
      assert.equal((await withTimeout(gq.next(), 2000, "guest nightResolved")).type, "nightResolved");
      assert.equal((await withTimeout(hq.next(), 2000, "host discussionStarted")).type, "discussionStarted");
      assert.equal((await withTimeout(gq.next(), 2000, "guest discussionStarted")).type, "discussionStarted");
      // 誰も discussionDone を送らないまま 150ms のタイマーで終わる。
      const hostEnded = await withTimeout(hq.next(), 3000, "host discussionEnded");
      const guestEnded = await withTimeout(gq.next(), 3000, "guest discussionEnded");
      assert.equal(hostEnded.type, "discussionEnded");
      assert.equal(guestEnded.type, "discussionEnded");
      assert.equal(hostEnded.view.phase, "vote");
      assert.equal(guestEnded.view.phase, "vote");
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(3), nightTimeoutMs: 5000, discussTimeoutMs: 150 });
});

test("議論の検証：夜フェーズ中の talk・discussionDone は not_discussion になる", async () => {
  // seed 1：人間は守り手（id 0）と政治家（id 1）。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      host.send(JSON.stringify({ type: "talk", phraseId: "agree" }));
      assert.equal((await hq.next()).error, "not_discussion");
      host.send(JSON.stringify({ type: "discussionDone" }));
      assert.equal((await hq.next()).error, "not_discussion");
      // 知らない定型文も議論フェーズでなければ not_discussion が先。
      guest.send(JSON.stringify({ type: "talk", phraseId: "noSuchPhrase" }));
      assert.equal((await gq.next()).error, "not_discussion");
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(1), nightTimeoutMs: 5000, discussTimeoutMs: 5000 });
});

test("不正な JSON と未知の type は error になる（接続は維持される）", async () => {
  await withServer(async (port) => {
    const ws = await connectWs(port);
    try {
      ws.send("not json");
      assert.equal((await nextMessage(ws)).error, "bad_json");
      ws.send(JSON.stringify({ type: "noSuchType" }));
      assert.equal((await nextMessage(ws)).error, "unknown_type");
      ws.send(JSON.stringify({ type: "createRoom" }));
      const msg = await nextMessage(ws);
      assert.equal(msg.type, "roomCreated");
    } finally {
      ws.close();
    }
  });
});

// 投票フェーズまで進める。seed 1：夜はタイムアウト（150ms）で解決し、
// 両人間とも生存する。戻り値は startTwoPlayerGame と同じ形。
async function driveToVotePhase(port) {
  const { host, guest, hq, gq } = await startTwoPlayerGame(port);
  try {
    const hostResolved = await withTimeout(hq.next(), 3000, "host nightResolved");
    const guestResolved = await withTimeout(gq.next(), 3000, "guest nightResolved");
    assert.equal(hostResolved.type, "nightResolved");
    assert.equal(guestResolved.type, "nightResolved");
    assert.equal(hostResolved.view.phase, "morning");
    const hostStarted = await withTimeout(hq.next(), 2000, "host discussionStarted");
    const guestStarted = await withTimeout(gq.next(), 2000, "guest discussionStarted");
    assert.equal(hostStarted.type, "discussionStarted");
    assert.equal(guestStarted.type, "discussionStarted");
    host.send(JSON.stringify({ type: "discussionDone" }));
    assert.equal((await hq.next()).type, "discussionDoneAccepted");
    guest.send(JSON.stringify({ type: "discussionDone" }));
    assert.equal((await gq.next()).type, "discussionDoneAccepted");
    const hostEnded = await withTimeout(hq.next(), 2000, "host discussionEnded");
    const guestEnded = await withTimeout(gq.next(), 2000, "guest discussionEnded");
    assert.equal(hostEnded.type, "discussionEnded");
    assert.equal(guestEnded.type, "discussionEnded");
    assert.equal(hostEnded.view.phase, "vote");
    assert.equal(guestEnded.view.phase, "vote");
    return { host, guest, hq, gq, hostResolved };
  } catch (err) {
    host.close();
    guest.close();
    throw err;
  }
}

test("投票：両方の人間が投票すると voteResolved が届き、翌日の夜へ進む", async () => {
  // seed 1：両人間とも夜を生き延び、2番へ投票すると 2番が追放される。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await driveToVotePhase(port);
    try {
      host.send(JSON.stringify({ type: "vote", targetId: 2 }));
      assert.deepEqual(await hq.next(), { type: "voteAccepted", targetId: 2 });
      guest.send(JSON.stringify({ type: "vote", targetId: 2 }));
      assert.deepEqual(await gq.next(), { type: "voteAccepted", targetId: 2 });
      const hostResolved = await withTimeout(hq.next(), 2000, "host voteResolved");
      const guestResolved = await withTimeout(gq.next(), 2000, "guest voteResolved");
      for (const msg of [hostResolved, guestResolved]) {
        assert.equal(msg.type, "voteResolved");
        assert.equal(msg.view.phase, "night");
        assert.equal(msg.view.day, 2);
        assert.equal(msg.vote.exiledId, 2);
        assert.equal(msg.vote.exiledName, "ユイ");
        assert.ok(msg.vote.logs.some((l) => l.includes("追放")));
        assert.ok(msg.vote.logs.some((l) => l.includes("役職:")));
        assert.equal(msg.vote.tally[0].id, 2);
        // 秘匿：実役職・うっかり flag・トークンが漏れていない。
        const json = JSON.stringify(msg);
        assert.equal(json.includes("baka"), false);
        assert.equal(json.includes("clumsy"), false);
        assert.equal(json.includes("token"), false);
        assert.equal(json.includes("fakeDisplayRoleKey"), false);
      }
      // 集計が終わったら投票できない。
      host.send(JSON.stringify({ type: "vote", targetId: 3 }));
      assert.equal((await hq.next()).error, "not_vote");
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(1), nightTimeoutMs: 150, discussTimeoutMs: 5000, voteTimeoutMs: 5000 });
});

test("投票：タイムアウトで誰も投票しなくても集計される", async () => {
  // seed 1：誰も投票しないまま 150ms の投票タイマーが切れると、
  // 未入力の人間は CPU と同じ疑念ベースで選んで集計される。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await driveToVotePhase(port);
    try {
      const hostResolved = await withTimeout(hq.next(), 3000, "host voteResolved");
      const guestResolved = await withTimeout(gq.next(), 3000, "guest voteResolved");
      for (const msg of [hostResolved, guestResolved]) {
        assert.equal(msg.type, "voteResolved");
        assert.equal(msg.view.phase, "night");
        assert.equal(msg.view.day, 2);
        assert.equal(msg.vote.exiledId, 0);
        assert.ok(msg.vote.tally.length > 0);
      }
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(1), nightTimeoutMs: 150, discussTimeoutMs: 5000, voteTimeoutMs: 150 });
});

test("投票：切断した人間は棄権になり、残りの投票で集計が進む", async () => {
  // seed 1：ゲストが投票中に切断すると棄権扱いになり、ホスト1人の
  // 投票だけで集計される（同数で追放なし）。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await driveToVotePhase(port);
    try {
      guest.close();
      // 切断の roomUpdate がホストへ届く（ゲストは connected: false）。
      const update = await hq.next();
      assert.equal(update.type, "roomUpdate");
      assert.equal(update.players.find((p) => p.id === 1).connected, false);
      host.send(JSON.stringify({ type: "vote", targetId: 2 }));
      assert.deepEqual(await hq.next(), { type: "voteAccepted", targetId: 2 });
      const resolved = await withTimeout(hq.next(), 2000, "host voteResolved");
      assert.equal(resolved.type, "voteResolved");
      assert.equal(resolved.view.phase, "night");
      assert.equal(resolved.view.day, 2);
      assert.equal(resolved.vote.exiledId, null);
      assert.ok(resolved.vote.logs.some((l) => l.includes("同数")));
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(1), nightTimeoutMs: 150, discussTimeoutMs: 5000, voteTimeoutMs: 5000 });
});

test("投票：最後のインポスター追放で gameEnded が届き、結果が開示される", async () => {
  // seed 8：夜に 2番（バカ）が倒れ、両人間が 4番へ投票すると
  // 最後のインポスターが追放されてイノセントの勝利になる。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      host.send(JSON.stringify({ type: "nightAction", targetId: 2 }));
      assert.equal((await hq.next()).type, "nightActionAccepted");
      guest.send(JSON.stringify({ type: "nightAction", targetId: 3 }));
      assert.equal((await gq.next()).type, "nightActionAccepted");
      const hostResolved = await withTimeout(hq.next(), 2000, "host nightResolved");
      const guestResolved = await withTimeout(gq.next(), 2000, "guest nightResolved");
      assert.equal(hostResolved.type, "nightResolved");
      assert.equal(guestResolved.type, "nightResolved");
      assert.equal(hostResolved.view.players.find((p) => p.id === 2).alive, false);
      await withTimeout(hq.next(), 2000, "host discussionStarted");
      await withTimeout(gq.next(), 2000, "guest discussionStarted");
      host.send(JSON.stringify({ type: "discussionDone" }));
      assert.equal((await hq.next()).type, "discussionDoneAccepted");
      guest.send(JSON.stringify({ type: "discussionDone" }));
      assert.equal((await gq.next()).type, "discussionDoneAccepted");
      const hostEnded = await withTimeout(hq.next(), 2000, "host discussionEnded");
      const guestEnded = await withTimeout(gq.next(), 2000, "guest discussionEnded");
      assert.equal(hostEnded.view.phase, "vote");
      assert.equal(guestEnded.view.phase, "vote");
      host.send(JSON.stringify({ type: "vote", targetId: 4 }));
      assert.deepEqual(await hq.next(), { type: "voteAccepted", targetId: 4 });
      guest.send(JSON.stringify({ type: "vote", targetId: 4 }));
      assert.deepEqual(await gq.next(), { type: "voteAccepted", targetId: 4 });
      const hostEnd = await withTimeout(hq.next(), 2000, "host gameEnded");
      const guestEnd = await withTimeout(gq.next(), 2000, "guest gameEnded");
      for (const msg of [hostEnd, guestEnd]) {
        assert.equal(msg.type, "gameEnded");
        assert.equal(msg.view.phase, "end");
        assert.equal(msg.view.day, 1);
        assert.ok(msg.result.winText.includes("イノセント陣営の勝利"));
        assert.equal(msg.result.winnerFaction, "イノセント");
        assert.equal(msg.result.sub, "オンライン対戦（人間2人）で遊びました。");
        assert.ok(Array.isArray(msg.result.highlights));
        assert.equal(msg.result.rows.length, 8);
        // CPU の票が集まり、最後のインポスター 6番が追放された
        // （人間2人は 4番へ入れていたが、票の最多は 6番だった）。
        const exiledRow = msg.result.rows.find((r) => r.id === 6);
        assert.equal(exiledRow.roleKey, "mimic");
        assert.equal(exiledRow.faction, "インポスター");
        assert.equal(exiledRow.status, "1日目に脱落（追放）");
        const bomberRow = msg.result.rows.find((r) => r.id === 4);
        assert.equal(bomberRow.roleKey, "bomber");
        assert.equal(bomberRow.alive, true);
        // 試合終了後の開示：夜に倒れたバカの実役職も行に入る。
        const nightDeadRow = msg.result.rows.find((r) => r.id === 2);
        assert.equal(nightDeadRow.roleKey, "baka");
        assert.equal(nightDeadRow.displayNote, "（表示：見習い占い師）");
      }
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(8), nightTimeoutMs: 5000, discussTimeoutMs: 5000, voteTimeoutMs: 5000 });
});

test("夜：夜の解決で決着したら nightResolved のあと gameEnded が届く", async () => {
  // seed 23：夜のタイムアウト解決で唯一のインポスターが倒れ、
  // 議論に入らずそのまま試合終了になる。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      const hostResolved = await withTimeout(hq.next(), 3000, "host nightResolved");
      const guestResolved = await withTimeout(gq.next(), 3000, "guest nightResolved");
      assert.equal(hostResolved.type, "nightResolved");
      assert.equal(guestResolved.type, "nightResolved");
      // nightResolved の view も phase "end" になっている。
      assert.equal(hostResolved.view.phase, "end");
      assert.equal(guestResolved.view.phase, "end");
      const hostEnd = await withTimeout(hq.next(), 2000, "host gameEnded");
      const guestEnd = await withTimeout(gq.next(), 2000, "guest gameEnded");
      for (const msg of [hostEnd, guestEnd]) {
        assert.equal(msg.type, "gameEnded");
        assert.equal(msg.view.phase, "end");
        assert.ok(msg.result.winText.includes("イノセント陣営の勝利"));
        assert.equal(msg.result.winnerFaction, "イノセント");
        assert.equal(msg.result.rows.length, 8);
      }
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(23), nightTimeoutMs: 150, discussTimeoutMs: 5000, voteTimeoutMs: 5000 });
});

test("投票の検証：夜フェーズ中の vote・自分への投票・死亡者への投票は error になる", async () => {
  // seed 8：夜に 2番が倒れる。投票フェーズでは 2番と自分への投票が弾かれる。
  await withServer(async (port) => {
    const { host, guest, hq, gq } = await startTwoPlayerGame(port);
    try {
      // 夜フェーズ中の投票は not_vote。
      host.send(JSON.stringify({ type: "vote", targetId: 2 }));
      assert.equal((await hq.next()).error, "not_vote");
      host.send(JSON.stringify({ type: "nightAction", targetId: 2 }));
      assert.equal((await hq.next()).type, "nightActionAccepted");
      guest.send(JSON.stringify({ type: "nightAction", targetId: 3 }));
      assert.equal((await gq.next()).type, "nightActionAccepted");
      await withTimeout(hq.next(), 2000, "host nightResolved");
      await withTimeout(gq.next(), 2000, "guest nightResolved");
      await withTimeout(hq.next(), 2000, "host discussionStarted");
      await withTimeout(gq.next(), 2000, "guest discussionStarted");
      host.send(JSON.stringify({ type: "discussionDone" }));
      assert.equal((await hq.next()).type, "discussionDoneAccepted");
      guest.send(JSON.stringify({ type: "discussionDone" }));
      assert.equal((await gq.next()).type, "discussionDoneAccepted");
      await withTimeout(hq.next(), 2000, "host discussionEnded");
      await withTimeout(gq.next(), 2000, "guest discussionEnded");
      // 死亡した 2番への投票は弾かれる。
      host.send(JSON.stringify({ type: "vote", targetId: 2 }));
      assert.equal((await hq.next()).error, "invalid_target");
      // 自分への投票は弾かれる。
      host.send(JSON.stringify({ type: "vote", targetId: 0 }));
      assert.equal((await hq.next()).error, "invalid_target");
      // 生存中の他人への投票は受け付けられる。
      host.send(JSON.stringify({ type: "vote", targetId: 4 }));
      assert.deepEqual(await hq.next(), { type: "voteAccepted", targetId: 4 });
    } finally {
      host.close();
      guest.close();
    }
  }, { random: seededRandom(8), nightTimeoutMs: 5000, discussTimeoutMs: 5000, voteTimeoutMs: 5000 });
});
