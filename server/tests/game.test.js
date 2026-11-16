// 実行方法: リポジトリのルートで `node --test server/tests/game.test.js`
// 配役（server/game.js）とプレイヤー別ビュー（秘匿）のテスト。
// 秘匿の要：player view の JSON には他人の実役職・うっかり flag・
// トークンが含まれてはならない。バカには表示役職だけが送られる。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createGame,
  validateStart,
  playerView,
  needsNightInput,
  submitNightAction,
  nightInputsComplete,
  resolveNight,
  nightResolvedMessage,
  startDiscussion,
  submitTalk,
  markDiscussionDone,
  discussionComplete,
  discussionStartedMessage,
  talkBroadcast,
  discussionEndedMessage,
  checkWin,
  endGame,
  submitVote,
  markVoteAbstained,
  clearVoteAbstained,
  votesComplete,
  resolveVote,
  voteResolvedMessage,
  gameEndedMessage,
  CANNED_TALKS,
  FREE_TALK_MAX_LENGTH,
  MIN_PLAYERS_TO_START,
  NIGHT_TIMEOUT_MS,
  VOTE_TIMEOUT_MS,
} = require("../game.js");
const { ROLES, PLAYER_NAMES, PLAYER_ICONS, getEffectiveRoleKey } = require("../../game-logic.js");

// 決定的な乱数源（mulberry32）。seed を変えて何通りかの配役を試す。
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

function twoHumans() {
  return [
    { id: 0, name: "ルナ", icon: "🌸" },
    { id: 1, name: "ミオ", icon: "🪄" },
  ];
}

// seed をずらして、人間の席にバカが来る試合を探す。
function gameWithHumanBaka() {
  for (let seed = 1; seed < 200; seed++) {
    const game = createGame("ABCD", twoHumans(), undefined, seededRandom(seed));
    const bakaSeat = game.players.find((p) => p.roleKey === "baka");
    if (bakaSeat && bakaSeat.id < 2) return { game, bakaSeat };
  }
  throw new Error("human baka game not found in 200 seeds");
}

// seed をずらして、人間の席にインポスターが来る試合を探す。
function gameWithHumanImpostor() {
  for (let seed = 1; seed < 200; seed++) {
    const game = createGame("ABCD", twoHumans(), undefined, seededRandom(seed));
    const impSeat = game.players.find(
      (p) => p.id < 2 && (p.roleKey === "fakeGirl" || p.roleKey === "mimic")
    );
    if (impSeat) return { game, impSeat };
  }
  throw new Error("human impostor game not found in 200 seeds");
}

test("配役：8席に役職が配られ、バカ1・占い師1・インポスター1〜2人になる", () => {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(42));
  assert.equal(game.players.length, 8);
  assert.equal(game.phase, "night");
  assert.equal(game.day, 1);
  const roles = game.players.map((p) => p.roleKey);
  assert.equal(roles.filter((r) => r === "baka").length, 1);
  assert.equal(roles.filter((r) => r === "apprenticeSeer").length, 1);
  const impostors = roles.filter((r) => r === "fakeGirl" || r === "mimic");
  assert.ok(impostors.length === 1 || impostors.length === 2);
  // 人間の席は部屋の名前・アイコン、残りは CPU 席。
  assert.equal(game.players[0].name, "ルナ");
  assert.equal(game.players[1].name, "ミオ");
  assert.equal(game.players[0].isCpu, false);
  assert.equal(game.players[1].isCpu, false);
  assert.equal(game.players.filter((p) => p.isCpu).length, 6);
  assert.equal(game.players[2].name, "ユイ");
  assert.equal(game.players.every((p) => p.alive), true);
  assert.equal(game.players.every((p) => p.publicRoleKey === null), true);
});

test("バカの view：表示役職だけが送られ、実役職・うっかり flag は含まれない", () => {
  const { game, bakaSeat } = gameWithHumanBaka();
  const view = playerView(game, bakaSeat.id);
  assert.equal(view.me.roleKey, bakaSeat.fakeDisplayRoleKey);
  assert.notEqual(view.me.roleKey, "baka");
  const json = JSON.stringify(view);
  assert.equal(json.includes("baka"), false);
  assert.equal(json.includes("clumsy"), false);
  assert.equal(json.includes("fakeDisplayRoleKey"), false);
  assert.equal(json.includes("token"), false);
  // 表示役職の名前・陣営が見える（本人はその役職だと思っている）。
  assert.equal(view.me.roleName.length > 0, true);
  assert.equal(view.me.faction, "イノセント");
  // 仲間情報はない（バカはインポスターではない）。
  assert.deepEqual(view.me.allies, []);
});

test("インポスターの view：仲間は名前だけで、他人の役職キーは含まれない", () => {
  const { game, impSeat } = gameWithHumanImpostor();
  const view = playerView(game, impSeat.id);
  const otherImpostor = game.players.find(
    (p) => p.id !== impSeat.id && (p.roleKey === "fakeGirl" || p.roleKey === "mimic")
  );
  if (otherImpostor) {
    assert.equal(view.me.allies.length, 1);
    assert.equal(view.me.allies[0].name, otherImpostor.name);
    assert.equal("roleKey" in view.me.allies[0], false);
  } else {
    assert.deepEqual(view.me.allies, []);
  }
  // players 一覧に役職キーのフィールドは一切ない。
  assert.equal(view.players.every((p) => !("roleKey" in p)), true);
  const json = JSON.stringify(view);
  assert.equal(json.includes("clumsy"), false);
  assert.equal(json.includes("token"), false);
});

test("イノセントの view：他人の役職も仲間も見えない", () => {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(7));
  const innocent = game.players.find(
    (p) => p.id < 2 && !["baka", "fakeGirl", "mimic", "bomber"].includes(p.roleKey)
  );
  assert.ok(innocent, "human innocent seat expected");
  const view = playerView(game, innocent.id);
  assert.equal(view.me.roleKey, innocent.roleKey);
  assert.deepEqual(view.me.allies, []);
  assert.equal(view.players.length, 8);
  assert.equal(view.players.filter((p) => p.isCpu).length, 6);
  assert.equal(view.players.every((p) => !("roleKey" in p)), true);
  const json = JSON.stringify(view);
  assert.equal(json.includes("clumsy"), false);
  assert.equal(json.includes("token"), false);
});

test("CPU 席の役職はサーバー内にだけあり、どの view にも出ない", () => {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(99));
  assert.equal(game.players.filter((p) => p.isCpu).length, 6);
  for (const human of [0, 1]) {
    const view = playerView(game, human);
    assert.equal(view.players.every((p) => !("roleKey" in p)), true);
    assert.equal(JSON.stringify(view).includes("clumsy"), false);
  }
});

test("playerView：存在しない席は null", () => {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(3));
  assert.equal(playerView(game, 99), null);
});

test("validateStart：ホスト以外・人数不足・開始済みはエラー、条件を満たせば null", () => {
  const room = { code: "ABCD", players: twoHumans(), game: null };
  assert.equal(validateStart(room, 0), null);
  assert.equal(validateStart(room, 1), "not_host");
  assert.equal(validateStart({ code: "ABCD", players: [twoHumans()[0]], game: null }, 0), "not_enough_players");
  assert.equal(validateStart({ code: "ABCD", players: twoHumans(), game: {} }, 0), "game_already_started");
  assert.equal(validateStart(null, 0), "room_not_found");
  assert.equal(MIN_PLAYERS_TO_START, 2);
});

// seed 2：人間は占い師（id 0）と罠師（id 1）で、両方とも夜入力が必要。
function gameBothNeedInput() {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(2));
  assert.equal(game.players[0].roleKey, "apprenticeSeer");
  assert.equal(game.players[1].roleKey, "trapper");
  return game;
}

// seed 3：人間は政治家（id 0）とネズミ（id 1）で、どちらも夜入力は不要。
function gameNobodyNeedsInput() {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(3));
  assert.equal(game.players[0].roleKey, "politician");
  assert.equal(game.players[1].roleKey, "mouse");
  return game;
}

test("needsNightInput：夜行動のある人間の席だけが true（CPU・能力なし・死亡は false）", () => {
  for (let seed = 1; seed <= 50; seed++) {
    const game = createGame("ABCD", twoHumans(), undefined, seededRandom(seed));
    for (const p of game.players) {
      const expected =
        !p.isCpu &&
        p.alive &&
        (["fakeGirl", "mimic"].includes(p.roleKey) ||
          (!["fakeGirl", "mimic"].includes(getEffectiveRoleKey(p)) &&
            !!ROLES[getEffectiveRoleKey(p)]?.nightAction));
      assert.equal(needsNightInput(game, p.id), expected, `seed ${seed} seat ${p.id} (${p.roleKey})`);
    }
    // 死亡した席は入力不要になる。
    game.players[0].alive = false;
    assert.equal(needsNightInput(game, 0), false);
  }
  assert.equal(needsNightInput(gameBothNeedInput(), 99), false);
});

test("submitNightAction：対象の検証と上書き、夜行動なし・CPU・試合なしはエラー", () => {
  const game = gameBothNeedInput();
  // 占い師は自分を選べない。
  assert.equal(submitNightAction(game, 0, 0), "invalid_target");
  assert.equal(submitNightAction(game, 0, 99), "invalid_target");
  assert.equal(submitNightAction(game, 0, 2), null);
  assert.equal(game.pnpNightInputs[0], 2);
  // 送り直すと上書きされる。
  assert.equal(submitNightAction(game, 0, 3), null);
  assert.equal(game.pnpNightInputs[0], 3);
  // 罠師は自分を選べる（allowSelf: true）。
  assert.equal(submitNightAction(game, 1, 1), null);
  // CPU 席は夜入力を送れない。
  assert.equal(submitNightAction(game, 5, 2), "not_a_player");
  // 夜行動のない人間は送れない。
  const calm = gameNobodyNeedsInput();
  assert.equal(submitNightAction(calm, 0, 2), "no_night_action");
  assert.equal(submitNightAction(calm, 1, 2), "no_night_action");
  // 試合なし。
  assert.equal(submitNightAction(null, 0, 2), "no_game");
});

test("nightInputsComplete と resolveNight：全員分が揃うと夜が解決して朝になる", () => {
  const game = gameBothNeedInput();
  assert.equal(nightInputsComplete(game), false);
  assert.equal(submitNightAction(game, 0, 2), null);
  assert.equal(nightInputsComplete(game), false);
  assert.equal(submitNightAction(game, 1, 3), null);
  assert.equal(nightInputsComplete(game), true);

  const result = resolveNight(game, seededRandom(100));
  assert.ok(result);
  assert.equal(game.phase, "morning");
  assert.ok(["eliminated", "blocked", "none", "revived"].includes(result.report.type));
  assert.ok(Array.isArray(result.publicLogs));
  // 個人ログは人間の席にだけ付く（CPU の夜結果はサーバー内に留まる）。
  assert.equal(Object.keys(result.privateLogs).every((id) => ["0", "1"].includes(id)), true);
  // 二重解決はできない。
  assert.equal(resolveNight(game, seededRandom(100)), null);
  assert.equal(game.phase, "morning");
  // 夜が明けたら夜入力は受け付けない。
  assert.equal(submitNightAction(game, 0, 2), "not_night");
  // 夜に倒れた者の役職は view で公開される。
  for (const p of game.players) {
    if (!p.alive) assert.notEqual(p.publicRoleKey, null);
  }
  // 席ごとの nightResolved：個人ログはその席の分だけ、秘匿漏れなし。
  for (const id of [0, 1]) {
    const msg = nightResolvedMessage(game, result, id);
    assert.equal(msg.type, "nightResolved");
    assert.equal(msg.view.phase, "morning");
    assert.equal(msg.night.privateLog, result.privateLogs[id] || null);
    const json = JSON.stringify(msg);
    assert.equal(json.includes("baka"), false);
    assert.equal(json.includes("clumsy"), false);
    assert.equal(json.includes("token"), false);
    assert.equal(json.includes("fakeDisplayRoleKey"), false);
    // 他人の個人ログが混ざっていない（違う文言のときだけ判定できる）。
    const other = result.privateLogs[id === 0 ? 1 : 0];
    if (other && other !== result.privateLogs[id]) {
      assert.equal(JSON.stringify(msg.night).includes(other), false);
    }
  }
  assert.equal(nightResolvedMessage(game, result, 99), null);
  assert.equal(NIGHT_TIMEOUT_MS, 60000);
});

test("resolveNight：誰も夜入力がいらない配役でも解ける（開始直後の即解決）", () => {
  const game = gameNobodyNeedsInput();
  assert.equal(nightInputsComplete(game), true);
  const result = resolveNight(game, seededRandom(100));
  assert.ok(result);
  assert.equal(game.phase, "morning");
  assert.ok(["eliminated", "blocked", "none", "revived"].includes(result.report.type));
});

test("resolveNight：インポスター人間の入力が襲撃先になる", () => {
  const { game, impSeat } = gameWithHumanImpostor();
  const otherHuman = game.players.find((p) => p.id < 2 && p.id !== impSeat.id);
  assert.ok(otherHuman, "second human seat expected");
  const victim = game.players.find(
    (p) => p.alive && p.id !== impSeat.id && !["fakeGirl", "mimic"].includes(p.roleKey)
  );
  assert.ok(victim, "a living non-impostor victim is expected");
  assert.equal(submitNightAction(game, impSeat.id, victim.id), null);
  const result = resolveNight(game, seededRandom(77));
  assert.ok(result);
  assert.equal(game.phase, "morning");
  // 人間インポスター（代表者）の入力がそのまま襲撃先になった。
  assert.equal(game.nightActions[impSeat.id], victim.id);
});

// 罠・蘇生のテスト用：役割を固定した試合を作る（人間は村人で夜行動なし）。
// createGame の配役は固定シードで作り、席ごとの roleKey だけを上書きする。
function gameWithFixedRoles(roles) {
  const game = createGame("ABCD", twoHumans(), undefined, seededRandom(2));
  game.players.forEach((p, i) => { p.roleKey = roles[i]; });
  return game;
}

test("resolveNight：何も起きない夜でも trapReport／doctorReport のキーがある（null）", () => {
  const game = gameBothNeedInput();
  assert.equal(submitNightAction(game, 0, 2), null);
  assert.equal(submitNightAction(game, 1, 3), null);
  const result = resolveNight(game, seededRandom(100));
  assert.ok(result);
  assert.equal("trapReport" in result, true);
  assert.equal("doctorReport" in result, true);
  const msg = nightResolvedMessage(game, result, 0);
  assert.equal("trapReport" in msg.night, true);
  assert.equal("doctorReport" in msg.night, true);
  assert.equal(msg.night.trapReport, result.trapReport);
  assert.equal(msg.night.doctorReport, result.doctorReport);
});

test("resolveNight：罠が作動した夜は trapReport に襲撃者と被害者が入る", () => {
  // 人間の罠師（seed 2 の席1）が 3 番の家に罠を仕掛け、解決の乱数を
  // 変えて襲撃先が罠の家になる回を探す。
  let found = null;
  for (let seed = 1; seed <= 200 && !found; seed++) {
    const game = gameBothNeedInput();
    assert.equal(submitNightAction(game, 0, 2), null);
    assert.equal(submitNightAction(game, 1, 3), null);
    const result = resolveNight(game, seededRandom(seed));
    if (result && result.trapReport) found = { game, result };
  }
  assert.ok(found, "200 seeds で罠の作動が見つかること");
  const { game, result } = found;
  assert.equal(result.trapReport.victimId, 3, "罠の家が襲撃された");
  const attacker = game.players[result.trapReport.attackerId];
  assert.ok(["fakeGirl", "mimic"].includes(attacker.roleKey), "襲撃者が罠で倒れる");
  assert.equal(attacker.alive, false);
  assert.equal(attacker.deathCause, "罠");
  // nightResolved でも同じ報告が送られる。
  const msg = nightResolvedMessage(game, result, 0);
  assert.deepEqual(msg.night.trapReport, result.trapReport);
});

test("resolveNight：診察で蘇生した夜は doctorReport に被害者と原因が入る", () => {
  // 役割を固定（診察役・インポスター2人・護衛・追跡役）し、解決の乱数を
  // 変えて診察役の患者がその夜の犠牲者になる回を探す。
  let found = null;
  for (let seed = 1; seed <= 300 && !found; seed++) {
    const game = gameWithFixedRoles(
      ["villager", "villager", "doctor", "fakeGirl", "mimic", "guardian", "tracker", "villager"]
    );
    const result = resolveNight(game, seededRandom(seed));
    if (result && result.doctorReport) found = { game, result };
  }
  assert.ok(found, "300 seeds で蘇生が見つかること");
  const { game, result } = found;
  assert.equal(typeof result.doctorReport.victimId, "number");
  assert.ok(["attack", "bomb"].includes(result.doctorReport.cause));
  assert.equal(game.players[result.doctorReport.victimId].alive, true, "蘇生した人は生きている");
  if (result.doctorReport.cause === "attack") {
    assert.equal(result.report.type, "revived");
    assert.equal(result.report.victimId, result.doctorReport.victimId);
  }
  // nightResolved でも同じ報告が送られる。
  const msg = nightResolvedMessage(game, result, 0);
  assert.deepEqual(msg.night.doctorReport, result.doctorReport);
});

// 議論フェーズのヘルパー：夜を解決して議論を開始する。夜に人間が
// 倒れていても議論のテスト用に両人間を生存に戻す（夜の解決の結果
// 自体は resolveNight のテストで担保済み）。
function gameInDiscussion(randomSeed = 100) {
  const game = gameBothNeedInput();
  assert.equal(submitNightAction(game, 0, 2), null);
  assert.equal(submitNightAction(game, 1, 3), null);
  const result = resolveNight(game, seededRandom(randomSeed));
  assert.ok(result);
  assert.equal(game.phase, "morning");
  for (const id of [0, 1]) {
    game.players[id].alive = true;
    game.players[id].publicRoleKey = null;
  }
  const events = startDiscussion(game, seededRandom(randomSeed + 1));
  assert.ok(events);
  assert.equal(game.phase, "discussion");
  return { game, events };
}

test("startDiscussion：朝から議論へ移り、CPU だけが発言する（人間2人なら最大4件）", () => {
  const { game, events } = gameInDiscussion();
  // パス＆プレイ流の上限：6 - 人間2人 = 4件。
  assert.equal(events.length, 4);
  for (const e of events) {
    const speaker = game.players[e.speakerId];
    assert.ok(speaker.isCpu, `speaker ${e.speakerId} must be CPU`);
    assert.ok(speaker.id >= 2);
    if (e.type === "talk") {
      assert.equal(typeof e.text, "string");
      assert.ok(e.text.length > 0);
    } else if (e.type === "mouse") {
      const target = game.players[e.targetId];
      assert.ok(target);
      assert.equal(e.publicRoleKey, getPublicRoleKey(target));
    } else {
      assert.fail(`unexpected event type ${e.type}`);
    }
  }
  // 二重開始はできない。
  assert.equal(startDiscussion(game, seededRandom(1)), null);
  assert.equal(game.phase, "discussion");
  // 夜フェーズの試合では開始できない。
  const fresh = gameBothNeedInput();
  assert.equal(startDiscussion(fresh, seededRandom(1)), null);
  assert.equal(fresh.phase, "night");
  assert.equal(startDiscussion(null, seededRandom(1)), null);
});

test("submitTalk：定型文・自由入力の検証（対象・長さ・両方指定・フェーズ・生死）", () => {
  const { game } = gameInDiscussion();
  // 定型文（対象なし）。
  assert.deepEqual(submitTalk(game, 0, { phraseId: "agree" }), { speakerId: 0, text: "そう思う" });
  // 定型文（対象あり。席2はユイ）。
  assert.deepEqual(submitTalk(game, 0, { phraseId: "suspicious", targetId: 2 }), { speakerId: 0, text: "ユイ が怪しいと思う" });
  // 対象を取る文言に対象がない・自分・死亡・存在しない席は弾く。
  assert.equal(submitTalk(game, 0, { phraseId: "suspicious" }), "invalid_target");
  assert.equal(submitTalk(game, 0, { phraseId: "suspicious", targetId: 0 }), "invalid_target");
  assert.equal(submitTalk(game, 0, { phraseId: "suspicious", targetId: 99 }), "invalid_target");
  game.players[3].alive = false;
  assert.equal(submitTalk(game, 0, { phraseId: "suspicious", targetId: 3 }), "invalid_target");
  game.players[3].alive = true;
  // 知らない定型文・両方指定・どちらもなし・文字列でない自由入力は弾く。
  assert.equal(submitTalk(game, 0, { phraseId: "noSuchPhrase" }), "bad_talk");
  assert.equal(submitTalk(game, 0, { phraseId: "agree", text: "hello" }), "bad_talk");
  assert.equal(submitTalk(game, 0, {}), "bad_talk");
  assert.equal(submitTalk(game, 0, { text: 42 }), "bad_talk");
  // 自由入力は前後の空白を除いて 1〜100 文字。
  assert.deepEqual(submitTalk(game, 1, { text: "  ねえ  " }), { speakerId: 1, text: "ねえ" });
  assert.equal(submitTalk(game, 1, { text: "" }), "bad_talk");
  assert.equal(submitTalk(game, 1, { text: "   " }), "bad_talk");
  assert.equal(submitTalk(game, 1, { text: "あ".repeat(101) }), "bad_talk");
  assert.deepEqual(submitTalk(game, 1, { text: "あ".repeat(100) }), { speakerId: 1, text: "あ".repeat(100) });
  // CPU 席・死亡した人間は発言できない。
  assert.equal(submitTalk(game, 5, { phraseId: "agree" }), "not_a_player");
  game.players[1].alive = false;
  assert.equal(submitTalk(game, 1, { phraseId: "agree" }), "not_alive");
  game.players[1].alive = true;
  // 夜フェーズ・試合なしでは弾く。
  assert.equal(submitTalk(gameBothNeedInput(), 0, { phraseId: "agree" }), "not_discussion");
  assert.equal(submitTalk(null, 0, { phraseId: "agree" }), "no_game");
  // 定型文の一覧と自由入力の上限が想定どおり。
  assert.equal(CANNED_TALKS.length, 8);
  assert.ok(CANNED_TALKS.every((c) => typeof c.id === "string" && typeof c.text === "string"));
  assert.equal(FREE_TALK_MAX_LENGTH, 100);
});

test("markDiscussionDone と discussionComplete：生存中の人間全員分で議論が終わる", () => {
  const { game } = gameInDiscussion();
  assert.equal(discussionComplete(game), false);
  assert.equal(markDiscussionDone(game, 0), null);
  assert.equal(discussionComplete(game), false);
  assert.equal(markDiscussionDone(game, 1), null);
  assert.equal(discussionComplete(game), true);
  // 2回目も null（冪等）で、完了のまま。
  assert.equal(markDiscussionDone(game, 0), null);
  assert.equal(discussionComplete(game), true);
  // CPU 席は議論終了を送れない。
  assert.equal(markDiscussionDone(game, 5), "not_a_player");
  // 夜フェーズ・試合なしでは弾く。
  assert.equal(markDiscussionDone(gameBothNeedInput(), 0), "not_discussion");
  assert.equal(markDiscussionDone(null, 0), "no_game");
  assert.equal(discussionComplete(gameBothNeedInput()), false);
  assert.equal(discussionComplete(null), false);

  // 夜に倒れた人間は数えない（生存中の人間1人だけで完了する）。
  const { game: game2 } = gameInDiscussion(200);
  game2.players[1].alive = false;
  assert.equal(discussionComplete(game2), false);
  assert.equal(markDiscussionDone(game2, 0), null);
  assert.equal(discussionComplete(game2), true);
  // 死亡した人間からの discussionDone は弾く。
  assert.equal(markDiscussionDone(game2, 1), "not_alive");
});

test("discussionStartedMessage／talkBroadcast／discussionEndedMessage：席ごとの view と秘匿漏れなし", () => {
  const { game, events } = gameInDiscussion();
  for (const id of [0, 1]) {
    const msg = discussionStartedMessage(game, events, id);
    assert.equal(msg.type, "discussionStarted");
    assert.equal(msg.view.phase, "discussion");
    assert.equal(msg.view.me.id, id);
    assert.deepEqual(msg.talks, events);
    const json = JSON.stringify(msg);
    assert.equal(json.includes("baka"), false);
    assert.equal(json.includes("clumsy"), false);
    assert.equal(json.includes("token"), false);
    assert.equal(json.includes("fakeDisplayRoleKey"), false);
  }
  assert.equal(discussionStartedMessage(game, null, 0), null);
  assert.equal(discussionStartedMessage(game, events, 99), null);
  // 人間の発言の配信メッセージ（公開情報だけ）。
  assert.deepEqual(talkBroadcast(game, { speakerId: 0, text: "そう思う" }), {
    type: "talk",
    code: "ABCD",
    speakerId: 0,
    speakerName: "ルナ",
    text: "そう思う",
  });
  assert.equal(talkBroadcast(game, { speakerId: 99, text: "x" }), null);
  // 議論終了のメッセージ（phase は vote）。
  game.phase = "vote";
  for (const id of [0, 1]) {
    const msg = discussionEndedMessage(game, id);
    assert.equal(msg.type, "discussionEnded");
    assert.equal(msg.view.phase, "vote");
    const json = JSON.stringify(msg);
    assert.equal(json.includes("baka"), false);
    assert.equal(json.includes("clumsy"), false);
    assert.equal(json.includes("token"), false);
    assert.equal(json.includes("fakeDisplayRoleKey"), false);
  }
  assert.equal(discussionEndedMessage(game, 99), null);
});

// 投票フェーズのヘルパー：8人全員が人間の試合を作り、phase を "vote"
// にする。8人全員が人間なので CPU の投票は入らず、集計は人間の投票
// だけで決まる。役職は dealRoles のまま（テストごとに上書きする）。
function gameInVote(seed = 42) {
  const roomPlayers = PLAYER_NAMES.map((name, id) => ({
    id,
    name,
    icon: PLAYER_ICONS[id],
  }));
  const game = createGame("ABCD", roomPlayers, undefined, seededRandom(seed));
  game.phase = "vote";
  return game;
}

test("submitVote：投票の検証と上書き（自分・死亡・存在しない席・CPU・フェーズ外）", () => {
  const game = gameInVote();
  assert.equal(submitVote(game, 0, 2), null);
  assert.equal(game.votes[0], 2);
  // 送り直しは上書きできる。
  assert.equal(submitVote(game, 0, 3), null);
  assert.equal(game.votes[0], 3);
  // 自分への投票は弾く（パス＆プレイと同じ）。
  assert.equal(submitVote(game, 0, 0), "invalid_target");
  // 死亡・存在しない席への投票は弾く。
  game.players[4].alive = false;
  assert.equal(submitVote(game, 0, 4), "invalid_target");
  assert.equal(submitVote(game, 0, 99), "invalid_target");
  // 投票は上書きされず残る。
  assert.equal(game.votes[0], 3);
  // 死亡した人間からの投票は弾く。
  assert.equal(submitVote(game, 4, 2), "not_alive");
  // CPU 席は投票できない（2人間の試合で phase を vote にしたもの）。
  const { game: game2 } = gameInDiscussion();
  game2.phase = "vote";
  assert.equal(submitVote(game2, 5, 2), "not_a_player");
  // 夜フェーズ・試合なしでは弾く。
  assert.equal(submitVote(gameBothNeedInput(), 0, 2), "not_vote");
  assert.equal(submitVote(null, 0, 2), "no_game");
});

test("votesComplete と markVoteAbstained：全員分・切断中の棄権で投票が揃う", () => {
  const game = gameInVote();
  assert.equal(votesComplete(game), false);
  for (let id = 0; id < 7; id++) assert.equal(submitVote(game, id, 7), null);
  assert.equal(votesComplete(game), false);
  assert.equal(submitVote(game, 7, 6), null);
  assert.equal(votesComplete(game), true);
  // 二重集計にならないよう、完了のまま投票を受け付けても揃ったまま。
  assert.equal(submitVote(game, 7, 5), null);
  assert.equal(votesComplete(game), true);

  // 切断中の人間は棄権扱いで、残りの投票だけで揃う（§7）。
  const game2 = gameInVote();
  markVoteAbstained(game2, 0);
  assert.equal(votesComplete(game2), false);
  for (let id = 1; id < 7; id++) assert.equal(submitVote(game2, id, 7), null);
  assert.equal(submitVote(game2, 7, 6), null);
  assert.equal(votesComplete(game2), true);
  // 再接続したら棄権扱いが外れ、また投票できる。
  clearVoteAbstained(game2, 0);
  assert.equal(votesComplete(game2), false);
  assert.equal(submitVote(game2, 0, 6), null);
  assert.equal(votesComplete(game2), true);
  // 投票済みの人間が切断しても票は残る（棄権にはならない）。
  const game3 = gameInVote();
  assert.equal(submitVote(game3, 0, 6), null);
  markVoteAbstained(game3, 0);
  assert.equal(game3.votes[0], 6);
  // 夜フェーズでの棄権・解除は何もしない。
  const night = gameBothNeedInput();
  markVoteAbstained(night, 0);
  clearVoteAbstained(night, 0);
  assert.equal(night.voteAbstained.size, 0);
  // 死亡した人間は数えない。
  const game4 = gameInVote();
  game4.players[1].alive = false;
  for (const id of [0, 2, 4, 5, 6, 7]) assert.equal(submitVote(game4, id, 3), null);
  assert.equal(submitVote(game4, 3, 4), null);
  assert.equal(votesComplete(game4), true);
  // フェーズ外・試合なしでは揃わない。
  assert.equal(votesComplete(gameBothNeedInput()), false);
  assert.equal(votesComplete(null), false);
});

test("resolveVote：同数なら追放なしで翌日の夜へ進む", () => {
  const game = gameInVote();
  // 票数がぶれないよう全員を村ガールにする（政治家の2票を避ける）。
  // 7番だけインポスターにして、集計後も試合が続くようにする。
  for (const p of game.players) p.roleKey = "villager";
  game.players[7].roleKey = "fakeGirl";
  // 4票ずつに分ける（8人全員が人間なので CPU の票は入らない）。
  // 4番は 5 へ、5番は 4 へ入れる（自分への投票はできないため）。
  for (const id of [0, 1, 2, 5]) assert.equal(submitVote(game, id, 4), null);
  for (const id of [3, 4, 6, 7]) assert.equal(submitVote(game, id, 5), null);
  const result = resolveVote(game, seededRandom(7));
  assert.ok(result);
  assert.equal(result.ended, false);
  assert.equal(result.exiledId, null);
  assert.equal(result.winText, null);
  assert.ok(result.logs.some((l) => l.includes("同数")));
  assert.equal(result.tally.length, 2);
  assert.ok(result.tally.every((t) => t.votes === 4));
  assert.equal(game.phase, "night");
  assert.equal(game.day, 2);
  assert.ok(game.players.every((p) => p.alive));
  assert.ok(result.logs.some((l) => l.includes("2日目")));
  // 二重集計はできない。
  assert.equal(resolveVote(game, seededRandom(7)), null);
  assert.equal(game.phase, "night");
});

test("resolveVote：最多票が追放され、役職が公開される", () => {
  const game = gameInVote();
  // 票数がぶれないよう全員を村ガールにする（政治家の2票を避ける）。
  // 7番だけインポスターにして、6番の追放後も試合が続くようにする。
  for (const p of game.players) p.roleKey = "villager";
  game.players[7].roleKey = "fakeGirl";
  for (let id = 0; id < 5; id++) assert.equal(submitVote(game, id, 6), null);
  for (let id = 5; id < 7; id++) assert.equal(submitVote(game, id, 7), null);
  assert.equal(submitVote(game, 7, 6), null);
  const result = resolveVote(game, seededRandom(7));
  assert.ok(result);
  assert.equal(result.ended, false);
  assert.equal(result.exiledId, 6);
  const exiled = game.players[6];
  assert.equal(exiled.alive, false);
  assert.equal(exiled.deathCause, "追放");
  assert.equal(exiled.deathDay, 1);
  assert.notEqual(exiled.publicRoleKey, null);
  assert.equal(exiled.publicRoleKey, getEffectiveRoleKey(exiled));
  assert.ok(result.logs.some((l) => l.includes("追放(6票)")));
  assert.ok(result.logs.some((l) => l.includes("役職:")));
  assert.equal(result.tally[0].id, 6);
  assert.equal(result.tally[0].votes, 6);
  assert.equal(game.phase, "night");
  assert.equal(game.day, 2);
  // 席ごとの voteResolved：追放の公開情報だけ、秘匿漏れなし。
  for (const id of [0, 1]) {
    const msg = voteResolvedMessage(game, result, id);
    assert.equal(msg.type, "voteResolved");
    assert.equal(msg.view.phase, "night");
    assert.equal(msg.view.day, 2);
    assert.equal(msg.vote.exiledId, 6);
    assert.equal(msg.vote.exiledName, exiled.name);
    assert.equal(msg.vote.exiledPublicRoleKey, exiled.publicRoleKey);
    assert.deepEqual(msg.vote.tally, result.tally);
    const json = JSON.stringify(msg);
    assert.equal(json.includes("baka"), false);
    assert.equal(json.includes("clumsy"), false);
    assert.equal(json.includes("token"), false);
    assert.equal(json.includes("fakeDisplayRoleKey"), false);
  }
  assert.equal(voteResolvedMessage(game, null, 0), null);
  assert.equal(voteResolvedMessage(game, result, 99), null);
});

test("resolveVote：政治家の票は2票分になる", () => {
  const game = gameInVote();
  game.players[0].roleKey = "politician";
  // 他の席の政治家が混ざると票数がぶれるため全員を村ガールにする。
  for (let id = 1; id < 8; id++) game.players[id].roleKey = "villager";
  // 政治家だけが 6 へ、残りは 7 へ入れる（7番は 5 へ）。
  assert.equal(submitVote(game, 0, 6), null);
  for (let id = 1; id < 7; id++) assert.equal(submitVote(game, id, 7), null);
  assert.equal(submitVote(game, 7, 5), null);
  const result = resolveVote(game, seededRandom(7));
  assert.ok(result);
  assert.equal(result.exiledId, 7);
  const six = result.tally.find((t) => t.id === 6);
  assert.equal(six.votes, 2);
  const seven = result.tally.find((t) => t.id === 7);
  assert.equal(seven.votes, 6);
});

test("resolveVote：未入力の人間は CPU と同じ疑念ベースで選ぶ（切断中は投票しない）", () => {
  const game = gameInVote();
  // 票数がぶれないよう全員を村ガールにする（政治家の2票を避ける）。
  for (const p of game.players) p.roleKey = "villager";
  // 6人が 6 へ投票。7番目は切断中で棄権、6番目は繋がったまま未入力。
  for (let id = 0; id < 6; id++) assert.equal(submitVote(game, id, 6), null);
  markVoteAbstained(game, 7);
  // 未入力の人間がいるのでまだ揃わない（タイムアウトで集計する流れ）。
  assert.equal(votesComplete(game), false);
  const result = resolveVote(game, seededRandom(7));
  assert.ok(result);
  assert.equal(result.exiledId, 6);
  // 票の合計は 7 票（明示6票＋未入力の人間の CPU 扱い1票。棄権は0票）。
  assert.equal(result.tally.reduce((sum, t) => sum + t.votes, 0), 7);
});

test("checkWin と endGame：勝敗の判定と試合終了", () => {
  const game = gameInVote();
  // 生存者全員をイノセントにすればイノセントの勝利。
  for (const p of game.players) p.roleKey = "villager";
  assert.equal(checkWin(game), "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！");
  assert.equal(endGame(game, checkWin(game)), "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！");
  assert.equal(game.phase, "end");
  assert.equal(game.winText, "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！");
  // 二重終了はできない。
  assert.equal(endGame(game, checkWin(game)), null);
  assert.equal(checkWin(null), null);
  assert.equal(endGame(null, "x"), null);
  assert.equal(endGame(gameInVote(), null), null);
  // インポスターが残っていれば続く。
  const game2 = gameInVote();
  game2.players[7].roleKey = "fakeGirl";
  assert.equal(checkWin(game2), null);
});

test("resolveVote：最後のインポスター追放でイノセント勝利・試合終了と結果開示", () => {
  const game = gameInVote();
  // 7番目だけがインポスター、他はイノセント（2番目はバカで表示は村人）。
  for (const p of game.players) p.roleKey = "villager";
  game.players[7].roleKey = "fakeGirl";
  game.players[2].roleKey = "baka";
  game.players[2].fakeDisplayRoleKey = "villager";
  game.players[2].clumsy = false;
  // 0〜6番が 7 へ、7番は 0 へ入れる。
  for (let id = 0; id < 7; id++) assert.equal(submitVote(game, id, 7), null);
  assert.equal(submitVote(game, 7, 0), null);
  const result = resolveVote(game, seededRandom(7));
  assert.ok(result);
  assert.equal(result.ended, true);
  assert.equal(result.exiledId, 7);
  assert.ok(result.winText.includes("イノセント陣営の勝利"));
  assert.equal(game.phase, "end");
  assert.equal(game.winText, result.winText);
  // 結果開示：全員の実役職・陣営・脱落の記録が入る（試合終了後の開示）。
  const msg = gameEndedMessage(game, 0);
  assert.equal(msg.type, "gameEnded");
  assert.equal(msg.view.phase, "end");
  assert.equal(msg.result.winText, result.winText);
  assert.equal(msg.result.winnerFaction, "イノセント");
  assert.equal(msg.result.sub, "オンライン対戦（人間8人）で遊びました。");
  assert.ok(Array.isArray(msg.result.highlights));
  assert.equal(msg.result.rows.length, 8);
  const impRow = msg.result.rows.find((r) => r.id === 7);
  assert.equal(impRow.roleKey, "fakeGirl");
  assert.equal(impRow.faction, "インポスター");
  assert.equal(impRow.alive, false);
  assert.equal(impRow.status, "1日目に脱落（追放）");
  const bakaRow = msg.result.rows.find((r) => r.id === 2);
  assert.equal(bakaRow.roleKey, "baka");
  assert.equal(bakaRow.displayNote, "（表示：村ガール）");
  // 試合終了前は gameEnded を作らない。
  assert.equal(gameEndedMessage(gameInVote(), 0), null);
  assert.equal(gameEndedMessage(game, 99), null);
  assert.equal(VOTE_TIMEOUT_MS, 60000);
});
