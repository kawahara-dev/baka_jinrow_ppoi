// game-logic.js（オンライン対戦フェーズ0の共有モジュール）のテスト。
// 依存なし（Node 18+ の node:test を使用）。
// 実行方法: リポジトリのルートで `node --test tests/logic-module.test.js`
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Logic = require("../game-logic.js");
const { loadGame } = require("./harness");

const BASE_SETTINGS = { fakeCount: "2", bomber: "off", sound: "off", difficulty: "normal" };

test("game-logic.js は DOM なしの素の Node で require できる", () => {
  assert.equal(typeof Logic, "object");
  assert.equal(typeof Logic.ROLES, "object");
});

test("ROLES は14役職で、各役職に表示に必要な項目が揃っている", () => {
  const keys = Object.keys(Logic.ROLES);
  assert.equal(keys.length, 14);
  for (const key of keys) {
    const r = Logic.ROLES[key];
    for (const field of ["name", "icon", "faction", "desc", "nightActionHint", "resultInterpretation", "riskNote"]) {
      assert.equal(typeof r[field], "string", `${key}.${field} は文字列`);
      assert.ok(r[field].length > 0, `${key}.${field} は空でない`);
    }
    assert.ok(["イノセント", "インポスター", "ニュートラル"].includes(r.faction), `${key} の陣営はどれか`);
    assert.ok("nightAction" in r, `${key} に nightAction がある`);
  }
  assert.ok("baka" in Logic.ROLES, "バカがいる");
  assert.equal(Logic.ROLES.baka.faction, "イノセント");
});

test("キャラ8人分の名前・絵文字・スラッグが揃っている", () => {
  assert.equal(Logic.PLAYER_NAMES.length, 8);
  assert.equal(Logic.PLAYER_ICONS.length, 8);
  assert.equal(Logic.ICON_SLUGS.length, 8);
  assert.equal(new Set(Logic.PLAYER_NAMES).size, 8, "名前は重複なし");
  assert.equal(new Set(Logic.ICON_SLUGS).size, 8, "スラッグは重複なし");
  assert.equal(Logic.PLAYER_NAMES[0], "ルナ");
  assert.equal(Logic.ICON_SLUGS[0], "luna");
});

test("PHASE_META は5フェーズ分のラベルとボタン文言を持つ", () => {
  for (const phase of ["night", "morning", "discussion", "vote", "end"]) {
    assert.equal(typeof Logic.PHASE_META[phase].label, "string");
    assert.equal(typeof Logic.PHASE_META[phase].button, "string");
  }
});

test("getEffectiveRoleKey / getPublicRoleKey：バカは表示役職、それ以外は実役職", () => {
  assert.equal(Logic.getEffectiveRoleKey({ roleKey: "baka", fakeDisplayRoleKey: "doctor" }), "doctor");
  assert.equal(Logic.getEffectiveRoleKey({ roleKey: "baka", fakeDisplayRoleKey: null }), "villager");
  assert.equal(Logic.getEffectiveRoleKey({ roleKey: "guardian" }), "guardian");
  assert.equal(Logic.getPublicRoleKey({ roleKey: "baka", fakeDisplayRoleKey: "mouse" }), "mouse");
  assert.equal(Logic.getPublicRoleKey({ roleKey: "apprenticeSeer", clumsy: true }), "apprenticeSeer");
});

test("migrateFactionWins：旧陣営キーを新陣営名へ読み替え、同名は合算する", () => {
  assert.deepEqual(Logic.migrateFactionWins({ "ピュア": 2, "フェイク": 1, "イノセント": 3 }), { "イノセント": 5, "インポスター": 1 });
  assert.deepEqual(Logic.migrateFactionWins({}), {});
  assert.deepEqual(Logic.migrateFactionWins(null), {});
  assert.equal(Logic.LEGACY_ROLE_NAMES.clumsySeer, "うっかり占い師");
});

test("charTalkPool / pickTalkLine：キャラ別セリフの取り出しとフォールバック", () => {
  const pool = Logic.charTalkPool("ルナ", "defense", "low");
  assert.ok(Array.isArray(pool) && pool.length > 0, "ルナの defense/low がある");
  assert.equal(Logic.charTalkPool("ルナ", "defense", "nope"), null, "存在しない tier は null");
  assert.equal(Logic.charTalkPool("存在しない子", "defense", "low"), null, "存在しないキャラは null");
  assert.equal(Logic.charTalkPool("ルナ", "defense", null), null, "tier なしの tiered プールは null");
  // pickTalkLine はキャラ別プールか汎用プールのどちらかから1行を返す。
  const generic = ["汎用A", "汎用B"];
  for (let i = 0; i < 50; i++) {
    const line = Logic.pickTalkLine({ name: "ルナ" }, "defense", "low", generic);
    assert.ok(pool.includes(line) || generic.includes(line), "返る行はどちらかのプール由来");
  }
});

test("rand は配列の要素を1つ返す", () => {
  for (let i = 0; i < 50; i++) {
    assert.ok(["a", "b", "c"].includes(Logic.rand(["a", "b", "c"])));
  }
  assert.equal(Logic.INNOCENT_ROLE_KEYS.length, 10);
  assert.equal(Logic.CLUMSY_SEER_RATE, 0.35);
});

test("game-logic.js は DOM・ストレージ・通信を使わない（Node 移植の前提）", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "game-logic.js"), "utf8");
  for (const banned of [/\bdocument\b/, /\blocalStorage\b/, /\bfetch\s*\(/, /\balert\s*\(/, /\bsetTimeout\b/, /\bsetInterval\b/]) {
    assert.ok(!banned.test(src), `game-logic.js に ${banned} を使わない`);
  }
});

test("ブラウザ側のゲームは共有モジュールと同じ内容の ROLES を使う", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  // ハーネスは vm の別レルムで game-logic.js を読むため、プロトタイプが
  // 異なる別オブジェクトになる。内容一致は JSON で比べる
  // （中身が同じ＝切り出しの漏れがない）。
  assert.equal(JSON.stringify(FB.ROLES), JSON.stringify(Logic.ROLES));
  assert.equal(FB.getEffectiveRoleKey({ roleKey: "baka", fakeDisplayRoleKey: "doctor" }), Logic.getEffectiveRoleKey({ roleKey: "baka", fakeDisplayRoleKey: "doctor" }));
  FB.setupGame();
  assert.equal(FB.state.players.length, 8);
  assert.equal(JSON.stringify(FB.state.players.map((p) => p.name)), JSON.stringify(Logic.PLAYER_NAMES));
});

// 決定的な乱数（mulberry32）：同じ seed なら同じ配役になる。
function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countRoles(dealt) {
  const counts = {};
  for (const d of dealt) counts[d.roleKey] = (counts[d.roleKey] || 0) + 1;
  return counts;
}

test("dealRoles：8人・バカ1・占い師1・指定通りのインポスター人数とボマー", () => {
  for (const settings of [
    { fakeCount: "1", bomber: "off" },
    { fakeCount: "2", bomber: "off" },
    { fakeCount: "1", bomber: "on" },
    { fakeCount: "2", bomber: "on" },
  ]) {
    const dealt = Logic.dealRoles(settings, seededRandom(42));
    assert.equal(dealt.length, 8, "8人分");
    const counts = countRoles(dealt);
    assert.equal(counts.baka, 1, "バカは常に1人");
    assert.equal(counts.apprenticeSeer, 1, "見習い占い師は常に1人");
    const fakeN = (counts.fakeGirl || 0) + (counts.mimic || 0);
    assert.equal(fakeN, Number(settings.fakeCount), "インポスター人数は指定通り");
    if (settings.fakeCount === "1") assert.equal(fakeN, 1);
    if (settings.fakeCount === "2") assert.equal(counts.fakeGirl, 1, "2人ならフェイクガール");
    if (settings.fakeCount === "2") assert.equal(counts.mimic, 1, "2人ならなりすまし");
    assert.equal(counts.bomber || 0, settings.bomber === "on" ? 1 : 0, "ボマーの有無は指定通り");
    for (const d of dealt) assert.ok(d.roleKey in Logic.ROLES, `${d.roleKey} は有効な役職`);
    // 役職の合計が8人になる（残りは村ガールで埋まる）。
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 8);
  }
});

test("dealRoles：ランダム指定では両方の出目が出る（抽選が生きている）", () => {
  const fakeCounts = new Set();
  const bomberSeen = new Set();
  for (let i = 0; i < 200; i++) {
    const dealt = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(i));
    assert.equal(dealt.length, 8);
    const counts = countRoles(dealt);
    fakeCounts.add((counts.fakeGirl || 0) + (counts.mimic || 0));
    bomberSeen.add(counts.bomber || 0);
  }
  assert.ok(fakeCounts.has(1) && fakeCounts.has(2), "インポスター1人と2人の両方が出る");
  assert.ok(bomberSeen.has(0) && bomberSeen.has(1), "ボマーあり・なしの両方が出る");
});

test("dealRoles：表示役職はバカだけ、うっかり個体は占い師だけ", () => {
  for (let i = 0; i < 100; i++) {
    const dealt = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(1000 + i));
    for (const d of dealt) {
      if (d.roleKey === "baka") {
        assert.ok(Logic.INNOCENT_ROLE_KEYS.includes(d.fakeDisplayRoleKey), "バカの表示役職はイノセント役職");
      } else {
        assert.equal(d.fakeDisplayRoleKey, null, "バカ以外に表示役職はない");
      }
      if (d.roleKey === "apprenticeSeer") assert.equal(typeof d.clumsy, "boolean");
      else assert.equal(d.clumsy, false, "占い師以外はうっかり個体にならない");
    }
  }
});

test("dealRoles：同じ seed なら同じ配役、seed を変えれば変わる", () => {
  const a = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(7));
  const b = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(7));
  assert.equal(JSON.stringify(a), JSON.stringify(b), "同じ seed は同じ結果");
  const c = Logic.dealRoles({ fakeCount: "random", bomber: "random" }, seededRandom(8));
  assert.notEqual(JSON.stringify(a), JSON.stringify(c), "違う seed は違う結果");
});

test("resolveVoteTally：最多票1人・同数・空の票", () => {
  assert.deepEqual(Logic.resolveVoteTally(new Map([[0, 3], [1, 1], [2, 2]])), { winnerId: 0, max: 3 });
  assert.deepEqual(Logic.resolveVoteTally(new Map([[0, 2], [1, 2]])), { winnerId: null, max: 2 });
  assert.deepEqual(Logic.resolveVoteTally(new Map()), { winnerId: null, max: -1 });
  assert.deepEqual(Logic.resolveVoteTally(new Map([[5, 1]])), { winnerId: 5, max: 1 });
  // 政治家の2票分など、票数が重い1人が勝つ。
  assert.deepEqual(Logic.resolveVoteTally(new Map([[0, 4], [1, 4], [2, 5]])), { winnerId: 2, max: 5 });
});

test("checkWinCondition：勝敗4パターンと続行", () => {
  // インポスター全滅 → イノセント勝利。
  assert.equal(
    Logic.checkWinCondition(["villager", "guardian", "apprenticeSeer"], 0),
    "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！"
  );
  // インポスターがイノセントと同数以上 → インポスター勝利。
  assert.equal(
    Logic.checkWinCondition(["villager", "fakeGirl"], 0),
    "💀 インポスター陣営の勝利…生存者数が同数以上になった。"
  );
  // ボマーだけ残る → ボマーの単独勝利。
  assert.equal(
    Logic.checkWinCondition(["bomber"], 0),
    "💣 ボマーの単独勝利！最後の1人になったよ！"
  );
  // ボマーが爆弾で2人以上倒し、インポスターが全滅した瞬間 → 横取り勝利。
  assert.equal(
    Logic.checkWinCondition(["villager", "guardian", "bomber"], 2),
    "💣 ボマーの勝利！爆弾で2人以上を倒し、勝利を横取りした！"
  );
  // ボマー1キルだけでは横取りしない。インポスターが0人ならイノセント勝利。
  assert.equal(
    Logic.checkWinCondition(["villager", "guardian", "bomber"], 1),
    "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！"
  );
  // ボマー1キルでインポスターが残っていれば横取りせず続行。
  assert.equal(Logic.checkWinCondition(["villager", "guardian", "bomber", "fakeGirl"], 1), null);
  // まだ決着していない盤面 → null。
  assert.equal(Logic.checkWinCondition(["villager", "guardian", "apprenticeSeer", "fakeGirl"], 0), null);
  assert.equal(Logic.checkWinCondition(["villager", "guardian", "bomber", "fakeGirl"], 0), null);
});

test("ブラウザ側の setupGame は dealRoles と同じ配役の不変条件を満たす", () => {
  for (let i = 0; i < 50; i++) {
    const { FB } = loadGame({ seedSettings: { fakeCount: "random", bomber: "random", sound: "off", difficulty: "normal" } });
    FB.setupGame();
    const players = FB.state.players;
    assert.equal(players.length, 8);
    const counts = {};
    for (const p of players) counts[p.roleKey] = (counts[p.roleKey] || 0) + 1;
    assert.equal(counts.baka, 1, "バカは1人");
    assert.equal(counts.apprenticeSeer, 1, "占い師は1人");
    const fakeN = (counts.fakeGirl || 0) + (counts.mimic || 0);
    assert.ok(fakeN === 1 || fakeN === 2, "インポスターは1〜2人");
    for (const p of players) {
      if (p.roleKey === "baka") assert.ok(Logic.INNOCENT_ROLE_KEYS.includes(p.fakeDisplayRoleKey));
      else assert.equal(p.fakeDisplayRoleKey, null);
    }
  }
});

test("ブラウザ側の dealRoles / checkWinCondition は共有モジュールと同一結果", () => {
  const { FB } = loadGame({ seedSettings: BASE_SETTINGS });
  // 同じ seed の乱数を与えれば、別レルムでも配役はバイト単位で一致する。
  const settings = { fakeCount: "random", bomber: "random" };
  assert.equal(
    JSON.stringify(FB.dealRoles(settings, seededRandom(123))),
    JSON.stringify(Logic.dealRoles(settings, seededRandom(123)))
  );
  assert.equal(
    FB.checkWinCondition(["villager", "bomber"], 2),
    Logic.checkWinCondition(["villager", "bomber"], 2)
  );
  assert.equal(
    JSON.stringify(FB.resolveVoteTally(new Map([[0, 2], [1, 2]]))),
    JSON.stringify(Logic.resolveVoteTally(new Map([[0, 2], [1, 2]])))
  );
});

// ---- フェーズ0第3歩：夜・投票ロジックの抽出 ----

// 夜解決テスト用の最小状態。roleKeys は8人分、nightActions は
// { actorId: targetId }。必要に応じて extra で上書きする。
function makeNightPlayer(id, roleKey, extra = {}) {
  return {
    id, name: Logic.PLAYER_NAMES[id], roleKey,
    alive: true, suspicion: 0, lastTarget: null,
    fakeDisplayRoleKey: roleKey === "baka" ? "guardian" : null,
    clumsy: false, deathCause: null, deathDay: null,
    ...extra,
  };
}
function makeNightState(roleKeys, nightActions, extra = {}) {
  const players = roleKeys.map((roleKey, i) => makeNightPlayer(i, roleKey));
  return {
    day: 1, mode: "solo", humanPlayerIds: [0], playerId: 0,
    players,
    nightActions, nightActionTypes: {},
    loneFakeAbility: null,
    bombs: [], bombKills: 0, revives: 0, guardSaves: 0,
    protectedTargets: new Set(),
    fakeIntel: {},
    nightReport: { type: "none", victimId: null },
    bombReport: { explodedVictims: [], fizzled: false },
    lastInvestigation: {},
    trapTargets: new Set(), trapReport: null,
    doctorTargetId: null, doctorReport: null,
    humanBlocked: false,
    ...extra,
  };
}
// Set を含む状態の JSON 比較用（Set は配列化する）。
function snapshotState(state) {
  return JSON.stringify(state, (k, v) => (v instanceof Set ? [...v].sort() : v));
}
const VILLAGERS = ["villager", "villager", "villager", "villager", "villager"];

test("formatActionLog：夜・投票・フェーズの文面が従来通り", () => {
  assert.equal(Logic.formatActionLog("protect", { actor: "守り手", target: "ルナ" }), "守り手 → ルナ → 防衛");
  assert.equal(Logic.formatActionLog("investigate", { actor: "見習い占い師", target: "ミオ", result: "インポスター" }), "見習い占い師 → ミオ → 判定: インポスター");
  assert.equal(Logic.formatActionLog("track", { actor: "追跡係", target: "ユイ", visitTarget: "カノン" }), "追跡係 → ユイ → 訪問先カノン");
  assert.equal(Logic.formatActionLog("track", { actor: "追跡係", target: "ユイ" }), "追跡係 → ユイ → 訪問先なし");
  assert.equal(Logic.formatActionLog("attackEliminated", { target: "ルナ" }), "インポスター陣営 → ルナ → 脱落");
  assert.equal(Logic.formatActionLog("attackBlocked", { target: "ミオ" }), "インポスター陣営 → ミオ → 防衛成功");
  assert.equal(Logic.formatActionLog("voteEliminated", { label: "投票", target: "ユイ", votes: 4 }), "[投票] 投票 → ユイ → 追放(4票)");
  assert.equal(Logic.formatActionLog("voteTie", { label: "投票", votes: 2 }), "[投票] 投票 → 同数(2票) → 追放なし");
  assert.equal(Logic.formatActionLog("roleReveal", { label: "夜", target: "カノン", role: "守り手", faction: "イノセント" }), "[夜] カノン → 役職: 守り手 / 陣営: イノセント");
  assert.equal(Logic.formatActionLog("phaseNightStart", { day: 3 }), "3日目 → 夜 → 開始");
});

test("resolveNightActions：守り手が襲撃を防ぐ／防げなければ脱落する", () => {
  // 防ぐ場合：守り手が襲撃先を守る。
  const guarded = makeNightState(
    ["guardian", "apprenticeSeer", "fakeGirl", ...VILLAGERS],
    { 0: 1, 2: 1 }
  );
  const alive = guarded.players.filter(p => p.alive);
  const { logs } = Logic.resolveNightActions(guarded, alive, { meId: 3, difficulty: "normal" });
  assert.equal(guarded.players[1].alive, true, "守られた占い師は生きる");
  assert.equal(guarded.nightReport.type, "blocked");
  assert.equal(guarded.guardSaves, 1);
  assert.ok(logs.some(e => e.scope === "public" && e.message.includes("防衛成功")), "公開ログに防衛成功");
  // 防げない場合：守り手が別人を守る。
  const killed = makeNightState(
    ["guardian", "apprenticeSeer", "fakeGirl", ...VILLAGERS],
    { 0: 4, 2: 1 }
  );
  const { logs: logs2 } = Logic.resolveNightActions(killed, killed.players.filter(p => p.alive), { meId: 3, difficulty: "normal" });
  assert.equal(killed.players[1].alive, false, "守られなければ脱落");
  assert.equal(killed.players[1].deathCause, "襲撃");
  assert.equal(killed.nightReport.type, "eliminated");
  assert.equal(killed.nightReport.victimId, 1);
  assert.ok(logs2.some(e => e.scope === "public" && e.message.includes("脱落")), "公開ログに脱落");
  assert.ok(logs2.some(e => e.scope === "public" && e.message.includes("役職: 見習い占い師")), "公開ログに役職公開");
});

test("resolveNightActions：罠は襲撃者を道連れにし、ドクターは蘇生する", () => {
  const state = makeNightState(
    ["trapper", "doctor", "fakeGirl", "villager", ...VILLAGERS.slice(0, 4)],
    { 0: 3, 1: 3, 2: 3 }
  );
  const { logs } = Logic.resolveNightActions(state, state.players.filter(p => p.alive), { meId: 4, difficulty: "normal" });
  assert.equal(state.players[2].alive, false, "罠で襲撃者も倒れる");
  assert.equal(state.players[2].deathCause, "罠");
  assert.deepEqual(state.trapReport, { attackerId: 2, victimId: 3 });
  assert.equal(state.players[3].alive, true, "ドクターが蘇生する");
  assert.equal(state.nightReport.type, "revived");
  assert.deepEqual(state.doctorReport, { victimId: 3, cause: "attack" });
  assert.equal(state.revives, 1);
  assert.equal(state.players[3].deathCause, null);
  assert.ok(logs.some(e => e.scope === "public" && e.message.includes("罠が作動")), "罠の公開ログ");
  assert.ok(logs.some(e => e.scope === "public" && e.message.includes("蘇生で助かった")), "蘇生の公開ログ");
});

test("resolveNightActions：CPU 占い師の調査は疑念に反映し、難易度で変わる", () => {
  for (const [difficulty, expected] of [["normal", 1], ["hard", 1.5], ["easy", 1]]) {
    const state = makeNightState(
      ["apprenticeSeer", "fakeGirl", "villager", ...VILLAGERS],
      { 0: 1 }
    );
    // easy は 55% で疑念+1（固定乱数 0.1 なら必ず付く）。
    Logic.resolveNightActions(state, state.players.filter(p => p.alive), { meId: 5, difficulty, random: () => 0.1 });
    assert.deepEqual(state.lastInvestigation[0], { targetId: 1, result: "インポスター" });
    assert.equal(state.players[1].suspicion, expected, `${difficulty} の疑念`);
  }
  // 人間（me）の調査は疑念に反映しない。
  const human = makeNightState(
    ["apprenticeSeer", "fakeGirl", "villager", ...VILLAGERS],
    { 0: 1 }
  );
  Logic.resolveNightActions(human, human.players.filter(p => p.alive), { meId: 0, difficulty: "normal" });
  assert.equal(human.players[1].suspicion, 0, "人間の調査は疑念を上げない");
  // ニュートラル判定は疑念 +0.5。
  const neutral = makeNightState(
    ["apprenticeSeer", "bomber", "villager", ...VILLAGERS],
    { 0: 1 }
  );
  Logic.resolveNightActions(neutral, neutral.players.filter(p => p.alive), { meId: 5, difficulty: "normal" });
  assert.equal(neutral.lastInvestigation[0].result, "ニュートラル");
  assert.equal(neutral.players[1].suspicion, 0.5);
});

test("resolveNightActions：なりすまし・バカ・うっかり個体の調査は乱数で決まる", () => {
  // なりすまし：乱数 0.1（<0.65）ならイノセントに化ける。
  const mimicHidden = makeNightState(
    ["apprenticeSeer", "mimic", "villager", ...VILLAGERS],
    { 0: 1 }
  );
  Logic.resolveNightActions(mimicHidden, mimicHidden.players.filter(p => p.alive), { meId: 5, difficulty: "normal", random: () => 0.1 });
  assert.equal(mimicHidden.lastInvestigation[0].result, "イノセント");
  // 乱数 0.9 なら化けない。
  const mimicSeen = makeNightState(
    ["apprenticeSeer", "mimic", "villager", ...VILLAGERS],
    { 0: 1 }
  );
  Logic.resolveNightActions(mimicSeen, mimicSeen.players.filter(p => p.alive), { meId: 5, difficulty: "normal", random: () => 0.9 });
  assert.equal(mimicSeen.lastInvestigation[0].result, "インポスター");
  // バカ（表示：占い師）の調査は偽物。乱数で両方の判定が出る。
  const bakaLow = makeNightState(
    ["baka", "fakeGirl", "villager", ...VILLAGERS],
    { 0: 1 }
  );
  bakaLow.players[0].fakeDisplayRoleKey = "apprenticeSeer";
  Logic.resolveNightActions(bakaLow, bakaLow.players.filter(p => p.alive), { meId: 5, difficulty: "normal", random: () => 0.1 });
  assert.equal(bakaLow.lastInvestigation[0].result, "イノセント");
  const bakaHigh = makeNightState(
    ["baka", "fakeGirl", "villager", ...VILLAGERS],
    { 0: 1 }
  );
  bakaHigh.players[0].fakeDisplayRoleKey = "apprenticeSeer";
  Logic.resolveNightActions(bakaHigh, bakaHigh.players.filter(p => p.alive), { meId: 5, difficulty: "normal", random: () => 0.9 });
  assert.equal(bakaHigh.lastInvestigation[0].result, "インポスター");
  // うっかり個体の占い師：乱数 0.1 なら判定がズレる（相手はインポスター→イノセント）。
  const clumsy = makeNightState(
    ["apprenticeSeer", "fakeGirl", "villager", ...VILLAGERS],
    { 0: 1 }
  );
  clumsy.players[0].clumsy = true;
  Logic.resolveNightActions(clumsy, clumsy.players.filter(p => p.alive), { meId: 5, difficulty: "normal", random: () => 0.1 });
  assert.equal(clumsy.lastInvestigation[0].result, "イノセント", "うっかり個体は判定がズレる");
  // 乱数 0.9 ならズレない。
  const steady = makeNightState(
    ["apprenticeSeer", "fakeGirl", "villager", ...VILLAGERS],
    { 0: 1 }
  );
  steady.players[0].clumsy = true;
  Logic.resolveNightActions(steady, steady.players.filter(p => p.alive), { meId: 5, difficulty: "normal", random: () => 0.9 });
  assert.equal(steady.lastInvestigation[0].result, "インポスター");
});

test("resolveNightActions：妨害は能力を止め、自分の番なら humanBlocked が立つ", () => {
  // ポリスが占い師を妨害（優先度 5 < 20）。
  const state = makeNightState(
    ["police", "apprenticeSeer", "fakeGirl", "villager", ...VILLAGERS],
    { 0: 1, 1: 2 },
    { nightActionTypes: { 0: "block" } }
  );
  const { logs } = Logic.resolveNightActions(state, state.players.filter(p => p.alive), { meId: 1, difficulty: "normal" });
  assert.deepEqual(state.lastInvestigation, {}, "妨害された占い師は調査できない");
  assert.equal(state.players[2].suspicion, 0, "疑念も上がらない");
  assert.equal(state.humanBlocked, true, "自分の番の妨害は humanBlocked");
  assert.ok(logs.some(e => e.scope === "private" && e.actorId === 1 && e.message.includes("妨害されて")), "妨害は本人の private ログ");
  // 妨害されても襲撃（attack）は止まらない。
  const attack = makeNightState(
    ["police", "fakeGirl", "villager", "villager", ...VILLAGERS],
    { 0: 1, 1: 2 },
    { nightActionTypes: { 0: "block" } }
  );
  Logic.resolveNightActions(attack, attack.players.filter(p => p.alive), { meId: 5, difficulty: "normal" });
  assert.equal(attack.players[2].alive, false, "襲撃は妨害されない");
});

test("resolveNightActions：爆弾は翌夜に爆発し、護衛で不発になる", () => {
  // 爆発する場合。
  const boom = makeNightState(
    ["bomber", "villager", "villager", ...VILLAGERS],
    {},
    { day: 2, bombs: [{ targetId: 1, explodeDay: 2 }] }
  );
  const { logs } = Logic.resolveNightActions(boom, boom.players.filter(p => p.alive), { meId: 5, difficulty: "normal" });
  assert.equal(boom.players[1].alive, false);
  assert.equal(boom.players[1].deathCause, "爆発");
  assert.deepEqual(boom.bombReport.explodedVictims, [1]);
  assert.equal(boom.bombKills, 1);
  assert.ok(logs.some(e => e.scope === "public" && e.message.includes("爆発に巻き込まれて")), "爆発の公開ログ");
  // 護衛で不発になる場合。
  const fizzle = makeNightState(
    ["guardian", "villager", "villager", ...VILLAGERS],
    { 0: 1 },
    { day: 2, bombs: [{ targetId: 1, explodeDay: 2 }], protectedTargets: new Set([1]) }
  );
  const { logs: logs2 } = Logic.resolveNightActions(fizzle, fizzle.players.filter(p => p.alive), { meId: 5, difficulty: "normal" });
  assert.equal(fizzle.players[1].alive, true);
  assert.equal(fizzle.bombReport.fizzled, true);
  assert.equal(fizzle.bombKills, 0);
  assert.ok(logs2.some(e => e.scope === "public" && e.message.includes("不発に終わった")), "不発の公開ログ");
  // ドクターは爆発の被害者も蘇生する。
  const revived = makeNightState(
    ["doctor", "villager", "villager", ...VILLAGERS],
    { 0: 1 },
    { day: 2, bombs: [{ targetId: 1, explodeDay: 2 }] }
  );
  Logic.resolveNightActions(revived, revived.players.filter(p => p.alive), { meId: 5, difficulty: "normal" });
  assert.equal(revived.players[1].alive, true, "爆発の被害者も蘇生する");
  assert.deepEqual(revived.doctorReport, { victimId: 1, cause: "bomb" });
  assert.equal(revived.bombKills, 0);
  assert.deepEqual(revived.bombReport.explodedVictims, []);
  assert.equal(revived.revives, 1);
});

test("resolveNightActions：単独インポスターの追加能力（妨害・盗み見）が働く", () => {
  // 単独フェイクガールの追加妨害：占い師を止める。
  const blocked = makeNightState(
    ["apprenticeSeer", "fakeGirl", "villager", ...VILLAGERS],
    { 0: 1, 1: 2 },
    { loneFakeAbility: { actorId: 1, type: "block", targetId: 0 } }
  );
  Logic.resolveNightActions(blocked, blocked.players.filter(p => p.alive), { meId: 5, difficulty: "normal" });
  assert.deepEqual(blocked.lastInvestigation, {}, "追加妨害で占い師は動けない");
  assert.equal(blocked.players[2].alive, false, "襲撃自体は通る");
  // 単独なりすましの追加盗み見：陣営の情報になる。
  const spied = makeNightState(
    ["guardian", "mimic", "villager", ...VILLAGERS],
    { 1: 2 },
    { loneFakeAbility: { actorId: 1, type: "spy", targetId: 0 } }
  );
  Logic.resolveNightActions(spied, spied.players.filter(p => p.alive), { meId: 5, difficulty: "normal" });
  assert.equal(spied.fakeIntel[0], "guardian", "盗み見で守り手が割れる");
});

test("resolveNightActions：同じ seed なら同じ結果（決定性）", () => {
  const roles = ["guardian", "apprenticeSeer", "fakeGirl", "mimic", "tracker", "bomber", "doctor", "trapper"];
  const build = () => makeNightState(roles, { 0: 1, 1: 2, 2: 4, 3: 0, 4: 5, 5: 6, 6: 7, 7: 1 }, { nightActionTypes: { 3: "spy" }, day: 2, bombs: [{ targetId: 6, explodeDay: 2 }] });
  const a = build();
  const b = build();
  const ra = Logic.resolveNightActions(a, a.players.filter(p => p.alive), { meId: 0, difficulty: "normal", random: seededRandom(7) });
  const rb = Logic.resolveNightActions(b, b.players.filter(p => p.alive), { meId: 0, difficulty: "normal", random: seededRandom(7) });
  assert.equal(snapshotState(a), snapshotState(b), "同じ seed は同じ状態");
  assert.equal(JSON.stringify(ra.logs), JSON.stringify(rb.logs), "同じ seed は同じログ");
});

test("cpuVotePick：難易度でブレが変わり、疑念の高い相手を選ぶ", () => {
  const voter = { id: 0, suspicion: 0 };
  const alive = [
    { id: 0, suspicion: 0 },
    { id: 1, suspicion: 5 },
    { id: 2, suspicion: 1 },
    { id: 3, suspicion: 3 },
  ];
  // hard はブレ 0.1：固定乱数でも疑念最大の 1 を選ぶ。
  assert.equal(Logic.cpuVotePick(voter, alive, "hard", () => 0.5).id, 1);
  assert.equal(Logic.cpuVotePick(voter, alive, "hard", () => 0).id, 1);
  // normal でも乱数 0 なら最大の 1。
  assert.equal(Logic.cpuVotePick(voter, alive, "normal", () => 0).id, 1);
  // 自分は選ばれない。
  for (let i = 0; i < 50; i++) {
    assert.notEqual(Logic.cpuVotePick(voter, alive, "easy").id, 0);
  }
  // 候補が自分だけなら undefined。
  assert.equal(Logic.cpuVotePick(voter, [voter], "normal", () => 0.5), undefined);
});

test("cpuNightActions：追跡係の結果だけが疑念になり、人間は対象外", () => {
  const state = makeNightState(
    ["tracker", "villager", "villager", "villager", ...VILLAGERS],
    {}
  );
  state.players[0].lastTarget = 1;
  Logic.cpuNightActions(state, state.players.filter(p => p.alive), 5);
  assert.equal(state.players[1].suspicion, 0.6, "CPU 追跡係の結果で疑念+0.6");
  // 追跡係が人間（me）なら反映しない。
  const human = makeNightState(
    ["tracker", "villager", "villager", "villager", ...VILLAGERS],
    {}
  );
  human.players[0].lastTarget = 1;
  Logic.cpuNightActions(human, human.players.filter(p => p.alive), 0);
  assert.equal(human.players[1].suspicion, 0, "人間の追跡結果は疑念にしない");
  // パス＆プレイでは人間全員が対象外。
  const pnp = makeNightState(
    ["tracker", "tracker", "villager", "villager", ...VILLAGERS],
    {},
    { mode: "pnp", humanPlayerIds: [0, 1] }
  );
  pnp.players[0].lastTarget = 2;
  pnp.players[1].lastTarget = 2;
  Logic.cpuNightActions(pnp, pnp.players.filter(p => p.alive), -1);
  assert.equal(pnp.players[2].suspicion, 0, "パス＆プレイの人間追跡は疑念にしない");
});

test("ブラウザ側の夜解決は共有モジュールと同一結果（ラッパーと中身の一致）", () => {
  // 同じ台本を、ブラウザのラッパー経由とモジュール直接で解く。
  const script = (FB) => {
    FB.setupGame();
    const roles = ["guardian", "apprenticeSeer", "fakeGirl", "mimic", "tracker", "villager", "villager", "villager"];
    FB.state.players.forEach((p, i) => {
      p.roleKey = roles[i];
      p.fakeDisplayRoleKey = null;
      p.clumsy = false;
    });
    FB.state.playerId = 5;
    FB.state.humanPlayerIds = [5];
    FB.state.mode = "solo";
    FB.state.day = 1;
    FB.state.protectedTargets = new Set();
    FB.state.humanBlocked = false;
    FB.state.nightActions = { 0: 1, 1: 2, 2: 1, 3: 0, 4: 0 };
    FB.state.nightActionTypes = { 3: "spy" };
    FB.state.loneFakeAbility = null;
    return FB.state.players.filter(p => p.alive);
  };
  const { FB: FB1, elements: el1 } = loadGame({ seedSettings: BASE_SETTINGS });
  const alive1 = script(FB1);
  const before1 = el1.get("actionLog").children.length;
  FB1.resolveNightActions(FB1.state.players[5], null, alive1);
  const logs1 = el1.get("actionLog").children.slice(before1).map(c => c.textContent);
  const snap1 = JSON.stringify(FB1.state, (k, v) => (v instanceof Set ? [...v].sort() : v));

  const { FB: FB2 } = loadGame({ seedSettings: BASE_SETTINGS });
  const alive2 = script(FB2);
  const { logs } = FB2.resolveNightActionsLogic(FB2.state, alive2, { meId: 5, difficulty: "normal" });
  // ラッパーと同じ振り分け（ソロ：public も private も actionLog へ）。
  const logs2 = logs.map(e => e.message);
  const snap2 = JSON.stringify(FB2.state, (k, v) => (v instanceof Set ? [...v].sort() : v));
  assert.equal(snap2, snap1, "ラッパー経由とモジュール直接で状態が一致");
  // 別レルムの配列は deepStrictEqual がプロトタイプ差で失敗するため JSON 比較。
  assert.equal(JSON.stringify(logs2), JSON.stringify(logs1), "ラッパー経由とモジュール直接でログが一致");
});
