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

// ---- フェーズ0第4歩：夜の対象選択の抽出 ----

// 対象選択テスト用の最小状態。roleKeys は8人分。
function makePlanState(roleKeys, extra = {}) {
  const players = roleKeys.map((roleKey, i) => makeNightPlayer(i, roleKey));
  return {
    day: 1, mode: "solo", humanPlayerIds: [0], playerId: 0,
    players, selectedId: 1,
    pnpNightInputs: {},
    fakeIntel: {}, bombs: [],
    ...extra,
  };
}
function planAlive(state) { return state.players.filter(p => p.alive); }

test("planNightActions：hard では守り手は疑念が最も低い相手、占い師は最も高い相手を選ぶ", () => {
  const state = makePlanState(
    ["guardian", "apprenticeSeer", "villager", "villager", "villager", "villager", "villager", "villager"],
    { playerId: 7, selectedId: 0 }
  );
  // 守り手(0)は CPU。疑念は 1:3、2:5、3:1、4〜7:2。
  state.players[1].suspicion = 3;
  state.players[2].suspicion = 5;
  state.players[3].suspicion = 1;
  for (let i = 4; i <= 7; i++) state.players[i].suspicion = 2;
  const r = Logic.planNightActions(state, planAlive(state), { difficulty: "hard", random: seededRandom(1) });
  assert.equal(r.nightActions[0], 3, "守り手は疑念が最も低い 3（疑念1）を守る");
  assert.ok(r.protectedTargets.has(3), "守り先は protectedTargets に入る");
  assert.equal(r.nightActions[1], 2, "占い師は疑念が最も高い 2（疑念5）を調べる");
});

test("planNightActions：追跡・見張りは自分以外を選び、同じ seed なら同じ対象", () => {
  const roles = ["tracker", "lookout", "villager", "villager", "villager", "villager", "villager", "villager"];
  const a = makePlanState(roles, { playerId: 7, selectedId: 0 });
  const b = makePlanState(roles, { playerId: 7, selectedId: 0 });
  a.players[0].lastTarget = 3;
  const ra = Logic.planNightActions(a, planAlive(a), { difficulty: "normal", random: seededRandom(5) });
  const rb = Logic.planNightActions(b, planAlive(b), { difficulty: "normal", random: seededRandom(5) });
  assert.equal(JSON.stringify(ra.nightActions), JSON.stringify(rb.nightActions), "同じ seed は同じ対象選択");
  for (const [actor, target] of Object.entries(ra.nightActions)) {
    assert.notEqual(Number(target), Number(actor), "自分は選ばない");
    assert.ok(a.players[target].alive, "対象は生存者");
  }
  assert.equal(a.players[0].lastTarget, null, "前夜の lastTarget がリセットされる");
});

test("planNightActions：ポリスは能力者を妨害し、ボマーは爆弾未設置の相手を狙う", () => {
  const police = makePlanState(
    ["police", "guardian", "villager", "villager", "villager", "villager", "villager", "villager"],
    { playerId: 7, selectedId: 0 }
  );
  // 能力者は守り手(1)だけ → ポリスは 1 を妨害する。
  const r = Logic.planNightActions(police, planAlive(police), { difficulty: "normal", random: seededRandom(3) });
  assert.equal(r.nightActions[0], 1);
  assert.equal(r.nightActionTypes[0], "block");
  // ボマー：爆弾設置済み(1, 2)以外を狙う。設置済みが 1〜6 なら残りは 7 だけ。
  const bomber = makePlanState(
    ["bomber", "villager", "villager", "villager", "villager", "villager", "villager", "villager"],
    { playerId: 7, selectedId: 0, bombs: [1, 2, 3, 4, 5, 6].map(targetId => ({ targetId, explodeDay: 2 })) }
  );
  const rb = Logic.planNightActions(bomber, planAlive(bomber), { difficulty: "normal", random: seededRandom(3) });
  assert.equal(rb.nightActions[0], 7, "未設置の相手が1人ならそこに設置する");
  assert.equal(rb.nightActionTypes[0], "plant");
  // 全員に爆弾があれば生存者から選ぶ（自分は除く）。
  const allBombed = makePlanState(
    ["bomber", "villager", "villager", "villager", "villager", "villager", "villager", "villager"],
    { playerId: 7, selectedId: 0, bombs: [1, 2, 3, 4, 5, 6, 7].map(targetId => ({ targetId, explodeDay: 2 })) }
  );
  for (let i = 0; i < 20; i++) {
    const rr = Logic.planNightActions(allBombed, planAlive(allBombed), { difficulty: "normal", random: seededRandom(i) });
    assert.ok(rr.nightActions[0] >= 1 && rr.nightActions[0] <= 7, "全員設置済みでも誰かを選ぶ");
  }
});

test("planNightActions：インポスター陣営は盗み見の情報を優先し、easy では無視する", () => {
  const roles = ["fakeGirl", "mimic", "apprenticeSeer", "villager", "villager", "villager", "villager", "villager"];
  for (let s = 0; s < 20; s++) {
    const state = makePlanState(roles, { playerId: 7, selectedId: 0, fakeIntel: { 2: "apprenticeSeer" } });
    const r = Logic.planNightActions(state, planAlive(state), { difficulty: "normal", random: seededRandom(s) });
    // 襲撃担当（種別なし）の対象は情報のある占い師(2)。
    const attacker = [0, 1].find(id => r.nightActions[id] !== undefined && !(id in r.nightActionTypes));
    assert.equal(r.nightActions[attacker], 2, `seed ${s}：情報のある占い師を襲う`);
    assert.equal(r.loneFakeAbility, null, "2人いれば追加能力はない");
  }
  // easy では情報を使わず、被害者からランダムに選ぶ（20回で 2 以外も出る）。
  const easyTargets = new Set();
  for (let s = 0; s < 20; s++) {
    const state = makePlanState(roles, { playerId: 7, selectedId: 0, fakeIntel: { 2: "apprenticeSeer" } });
    const r = Logic.planNightActions(state, planAlive(state), { difficulty: "easy", random: seededRandom(s) });
    const attacker = [0, 1].find(id => r.nightActions[id] !== undefined && !(id in r.nightActionTypes));
    easyTargets.add(r.nightActions[attacker]);
  }
  assert.ok(easyTargets.size > 1, "easy では情報に縛られず複数の襲撃先が出る");
  for (const t of easyTargets) assert.ok(t >= 2 && t <= 7, "襲撃先は被害者の中");
});

test("planNightActions：仲間の能力（盗み見・妨害）と単独インポスターの追加能力", () => {
  const roles = ["fakeGirl", "mimic", "guardian", "apprenticeSeer", "villager", "villager", "villager", "villager"];
  for (let s = 0; s < 20; s++) {
    const state = makePlanState(roles, { playerId: 7, selectedId: 0 });
    const r = Logic.planNightActions(state, planAlive(state), { difficulty: "normal", random: seededRandom(s) });
    const attacker = [0, 1].find(id => r.nightActions[id] !== undefined && !(id in r.nightActionTypes));
    const partner = attacker === 0 ? 1 : 0;
    assert.ok(attacker === 0 || attacker === 1, "襲撃担当はインポスターのどちらか");
    if (partner === 1) {
      assert.equal(r.nightActionTypes[1], "spy", "なりすましの仲間能力は盗み見");
      assert.ok(r.nightActions[1] >= 2 && r.nightActions[1] <= 7, "盗み見先は被害者");
    } else {
      assert.equal(r.nightActionTypes[0], "block", "フェイクガールの仲間能力は妨害");
      assert.ok([2, 3].includes(r.nightActions[0]) || (r.nightActions[0] >= 2 && r.nightActions[0] <= 7), "妨害先は能力者か被害者");
    }
  }
  // 単独フェイクガール：襲撃に加えて追加の妨害能力が付く。
  const loneGirl = makePlanState(
    ["fakeGirl", "guardian", "apprenticeSeer", "villager", "villager", "villager", "villager", "villager"],
    { playerId: 7, selectedId: 0 }
  );
  const rg = Logic.planNightActions(loneGirl, planAlive(loneGirl), { difficulty: "normal", random: seededRandom(4) });
  assert.equal(rg.nightActions[0], 1, "単独でも襲撃する");
  assert.equal(rg.loneFakeAbility?.type, "block", "単独フェイクガールの追加能力は妨害");
  assert.equal(rg.loneFakeAbility?.actorId, 0);
  assert.ok([1, 2].includes(rg.loneFakeAbility?.targetId), "妨害先は能力者");
  // 単独なりすまし：襲撃に加えて追加の盗み見能力が付く（襲撃先以外）。
  const loneMimic = makePlanState(
    ["mimic", "guardian", "apprenticeSeer", "villager", "villager", "villager", "villager", "villager"],
    { playerId: 7, selectedId: 0 }
  );
  const rm = Logic.planNightActions(loneMimic, planAlive(loneMimic), { difficulty: "normal", random: seededRandom(4) });
  assert.equal(rm.loneFakeAbility?.type, "spy", "単独なりすましの追加能力は盗み見");
  assert.equal(rm.loneFakeAbility?.actorId, 0);
  assert.ok(rm.loneFakeAbility?.targetId >= 1 && rm.loneFakeAbility?.targetId <= 7, "盗み見先は被害者");
  assert.notEqual(rm.loneFakeAbility?.targetId, rm.nightActions[0], "盗み見は襲撃先以外を狙う");
});

test("planNightActions：人間の入力（ソロの選択・パス＆プレイの順番入力）がそのまま使われる", () => {
  // ソロ：人間の守り手は selectedId の対象を守る。
  const solo = makePlanState(
    ["guardian", "apprenticeSeer", "villager", "villager", "villager", "villager", "villager", "villager"],
    { playerId: 0, selectedId: 3 }
  );
  const r = Logic.planNightActions(solo, planAlive(solo), { difficulty: "normal", random: seededRandom(1) });
  assert.equal(r.nightActions[0], 3, "人間の守り手は選んだ対象を守る");
  assert.ok(r.protectedTargets.has(3));
  // パス＆プレイ：人間の入力が使われ、CPU はヒューリスティクスで選ぶ。
  const pnp = makePlanState(
    ["guardian", "apprenticeSeer", "tracker", "villager", "villager", "villager", "villager", "villager"],
    { mode: "pnp", humanPlayerIds: [0, 1], playerId: 0, selectedId: 4, pnpNightInputs: { 0: 5, 1: 6 } }
  );
  const rp = Logic.planNightActions(pnp, planAlive(pnp), { difficulty: "normal", random: seededRandom(2) });
  assert.equal(rp.nightActions[0], 5, "人間の守り手は入力通りの対象を守る");
  assert.equal(rp.nightActions[1], 6, "人間の占い師は入力通りの対象を調べる");
  assert.notEqual(rp.nightActions[2], 2, "CPU の追跡係は自分を選ばない");
  // パス＆プレイ：人間インポスター代表の襲撃入力が使われる。
  const rep = makePlanState(
    ["fakeGirl", "mimic", "villager", "villager", "villager", "villager", "villager", "villager"],
    { mode: "pnp", humanPlayerIds: [0, 1], playerId: 0, selectedId: 4, pnpNightInputs: { 0: 3 } }
  );
  const rr = Logic.planNightActions(rep, planAlive(rep), { difficulty: "normal", random: seededRandom(4) });
  assert.equal(rr.nightActions[0], 3, "代表者の襲撃入力が使われる");
  // 代表者が仲間を選んでいたらランダムな被害者に振り替える。
  const badRep = makePlanState(
    ["fakeGirl", "mimic", "villager", "villager", "villager", "villager", "villager", "villager"],
    { mode: "pnp", humanPlayerIds: [0, 1], playerId: 0, selectedId: 4, pnpNightInputs: { 0: 1 } }
  );
  const rb = Logic.planNightActions(badRep, planAlive(badRep), { difficulty: "normal", random: seededRandom(4) });
  assert.ok(rb.nightActions[0] >= 2 && rb.nightActions[0] <= 7, "仲間への襲撃入力は被害者に振り替える");
});

test("planNightActions：バカの護衛は登録されるが実際には守らない", () => {
  const state = makePlanState(
    ["baka", "apprenticeSeer", "villager", "villager", "villager", "villager", "villager", "villager"],
    { playerId: 0, selectedId: 2 }
  );
  state.players[0].fakeDisplayRoleKey = "guardian";
  const r = Logic.planNightActions(state, planAlive(state), { difficulty: "normal", random: seededRandom(1) });
  assert.equal(r.nightActions[0], 2, "バカも表示役職（守り手）で対象を選ぶ");
  assert.equal(r.protectedTargets.size, 0, "バカの護衛は守りにならない");
});

test("ブラウザ側の runNight は共有モジュールと同一の対象選択をする", () => {
  const script = (FB) => {
    FB.setupGame();
    const roles = ["guardian", "apprenticeSeer", "police", "tracker", "fakeGirl", "mimic", "bomber", "doctor"];
    FB.state.players.forEach((p, i) => {
      p.roleKey = roles[i];
      p.fakeDisplayRoleKey = null;
      p.clumsy = false;
      p.suspicion = [0, 4, 1, 2, 0, 0, 3, 0][i];
    });
    FB.state.playerId = 0;
    FB.state.humanPlayerIds = [0];
    FB.state.mode = "solo";
    FB.state.day = 1;
    FB.state.selectedId = 1;
    FB.state.fakeIntel = { 1: "apprenticeSeer" };
    FB.state.bombs = [{ targetId: 4, explodeDay: 2 }];
    return FB.state.players.filter(p => p.alive);
  };
  const hard = { ...BASE_SETTINGS, difficulty: "hard" };
  // モジュール直接（seed 固定）。
  const { FB: FB1 } = loadGame({ seedSettings: hard });
  const alive1 = script(FB1);
  const planned = FB1.planNightActionsLogic(FB1.state, alive1, { difficulty: "hard", random: seededRandom(7) });
  // ブラウザの runNight：同じ seed の乱数で回す。
  const { FB: FB2, sandbox } = loadGame({ seedSettings: hard });
  const alive2 = script(FB2);
  // Math のスタブ：{...Math} では列挙不可の floor 等が拾えないため、
  // 実 Math をプロトタイプにして random だけ差し替える。
  sandbox.Math = Object.create(Math);
  sandbox.Math.random = seededRandom(7);
  FB2.runNight();
  const snapSet = (s) => JSON.stringify([...s].sort());
  assert.equal(JSON.stringify(FB2.state.nightActions), JSON.stringify(planned.nightActions), "runNight とモジュールで nightActions が一致");
  assert.equal(JSON.stringify(FB2.state.nightActionTypes), JSON.stringify(planned.nightActionTypes), "runNight とモジュールで nightActionTypes が一致");
  assert.equal(JSON.stringify(FB2.state.loneFakeAbility), JSON.stringify(planned.loneFakeAbility), "runNight とモジュールで loneFakeAbility が一致");
  assert.equal(snapSet(FB2.state.protectedTargets), snapSet(planned.protectedTargets), "runNight とモジュールで protectedTargets が一致");
  void alive2;
});

// ---- フェーズ0第5歩：議論の CPU セリフ選択の抽出 ----

// 議論テスト用の最小状態。roleKeys は8人分。
function makeDiscussionState(roleKeys, extra = {}) {
  const players = roleKeys.map((roleKey, i) => makeNightPlayer(i, roleKey));
  return {
    day: 1, mode: "solo", humanPlayerIds: [0], playerId: 0,
    players,
    nightReport: { type: "none", victimId: null },
    bombReport: { explodedVictims: [], fizzled: false },
    lastInvestigation: {},
    ...extra,
  };
}
function discussionAlive(state) { return state.players.filter(p => p.alive); }

// そのカテゴリ（tier 付きならその tier）で出うるセリフ全文の集合。
// {target} は全キャラ名と「みんな」で置換したものを入れる。
function possibleDiscussionTexts(category, tier) {
  const set = new Set();
  const add = (line) => {
    for (const name of [...Logic.PLAYER_NAMES, "みんな"]) set.add(line.replaceAll("{target}", name));
  };
  const generic = Logic.DISCUSSION_TEMPLATES[category];
  const pools = Array.isArray(generic) ? [generic] : [generic[tier]];
  for (const pool of pools) for (const line of pool) add(line);
  for (const char of Object.values(Logic.CHAR_TALK)) {
    const pool = char[category];
    if (!pool) continue;
    const lines = Array.isArray(pool) ? pool : (tier ? pool[tier] || [] : []);
    for (const line of lines) add(line);
  }
  return set;
}

test("planDiscussionTalks：占い結果がインポスターなら claimFake で対象の名を呼ぶ", () => {
  const roles = ["villager", "apprenticeSeer", "fakeGirl", "villager", "villager", "villager", "villager", "villager"];
  const state = makeDiscussionState(roles, {
    lastInvestigation: { 1: { targetId: 2, result: "インポスター" } },
  });
  // 乱数 0.99 固定：キャラ別プールは選ばれず汎用プールの末尾になる。
  const events = Logic.planDiscussionTalks(state, discussionAlive(state), { random: () => 0.99 });
  assert.equal(events.length, 7, "ソロは人間(0)以外の7人全員が発言する");
  const seer = events.find(e => e.speakerId === 1);
  assert.equal(seer.type, "talk");
  assert.equal(seer.text, Logic.DISCUSSION_TEMPLATES.claimFake[3].replaceAll("{target}", state.players[2].name),
    "占い師は汎用 claimFake の末尾で対象を名指しする");
  for (const e of events) assert.ok(!e.text.includes("{target}"), "置換し忘れの {target} が残らない");
});

test("planDiscussionTalks：占い結果の白・ニュートラルは確率ゲート付きで主張する", () => {
  const roles = ["villager", "apprenticeSeer", "fakeGirl", "villager", "villager", "villager", "villager", "villager"];
  // 乱数 0 固定：claimWhite(0.35)・claimNeutral(0.5)のゲートを両方通る。
  const white = makeDiscussionState(roles, {
    lastInvestigation: { 1: { targetId: 2, result: "イノセント" } },
  });
  const ew = Logic.planDiscussionTalks(white, discussionAlive(white), { random: () => 0 });
  const whiteEvent = ew.find(e => e.speakerId === 1);
  assert.equal(whiteEvent.type, "talk");
  assert.ok(possibleDiscussionTexts("claimWhite").has(whiteEvent.text), `白主張の文面: ${whiteEvent.text}`);
  assert.ok(whiteEvent.text.includes(white.players[2].name), "白主張は対象の名を呼ぶ");
  const neutral = makeDiscussionState(roles, {
    lastInvestigation: { 1: { targetId: 2, result: "ニュートラル" } },
  });
  const en = Logic.planDiscussionTalks(neutral, discussionAlive(neutral), { random: () => 0 });
  const neutralEvent = en.find(e => e.speakerId === 1);
  assert.equal(neutralEvent.type, "talk");
  assert.ok(possibleDiscussionTexts("claimNeutral").has(neutralEvent.text), `中立主張の文面: ${neutralEvent.text}`);
});

test("planDiscussionTalks：爆発があれば bomb、守り手は防衛成功で guardian を語る", () => {
  const roles = ["villager", "guardian", "villager", "villager", "villager", "villager", "villager", "villager"];
  const bombed = makeDiscussionState(roles, { bombReport: { explodedVictims: [3], fizzled: false } });
  const eb = Logic.planDiscussionTalks(bombed, discussionAlive(bombed), { random: () => 0 });
  for (const e of eb) {
    assert.equal(e.type, "talk");
    assert.ok(possibleDiscussionTexts("bomb").has(e.text), `爆弾の文面: ${e.text}`);
  }
  const blocked = makeDiscussionState(roles, { nightReport: { type: "blocked", victimId: null } });
  const eg = Logic.planDiscussionTalks(blocked, discussionAlive(blocked), { random: () => 0 });
  const guard = eg.find(e => e.speakerId === 1);
  assert.equal(guard.type, "talk");
  assert.ok(possibleDiscussionTexts("guardian").has(guard.text), `守り手の文面: ${guard.text}`);
});

test("planDiscussionTalks：前夜の対象が残る追跡係は tracker、4人以下なら endgame を語る", () => {
  const roles = ["villager", "villager", "tracker", "villager", "villager", "villager", "villager", "villager"];
  const state = makeDiscussionState(roles);
  state.players[2].lastTarget = 5;
  const events = Logic.planDiscussionTalks(state, discussionAlive(state), { random: () => 0.99 });
  const tracker = events.find(e => e.speakerId === 2);
  assert.equal(tracker.type, "talk");
  assert.ok(possibleDiscussionTexts("tracker", "low").has(tracker.text), `追跡の文面: ${tracker.text}`);
  // 生存者を4人まで減らす（0 は人間、1・2・3 が生存）。
  const few = makeDiscussionState(roles);
  for (let i = 4; i < 8; i++) few.players[i].alive = false;
  const ef = Logic.planDiscussionTalks(few, discussionAlive(few), { random: () => 0 });
  assert.equal(ef.length, 3, "人間以外の生存者3人が発言する");
  for (const e of ef) {
    assert.equal(e.type, "talk");
    assert.ok(possibleDiscussionTexts("endgame").has(e.text), `終盤の文面: ${e.text}`);
  }
});

test("planDiscussionTalks：それ以外は defense / pressure / observe で疑念の tier に応じる", () => {
  const roles = ["villager", "villager", "villager", "villager", "villager", "villager", "villager", "villager"];
  const state = makeDiscussionState(roles);
  // 2 は疑念が高い（high tier）、ほかは 0（low tier）。
  state.players[2].suspicion = 5;
  // 乱数 0.99 固定：lineTarget は others の末尾、defense/pressure は
  // pressure になり、observe への振り替え（0.2）は起きない。
  const events = Logic.planDiscussionTalks(state, discussionAlive(state), { random: () => 0.99 });
  assert.equal(events.length, 7);
  for (const e of events) {
    assert.equal(e.type, "talk");
    assert.ok(!e.text.includes("{target}"));
  }
  // 発言者 1 の lineTarget は others[6]＝7（疑念 0 → low tier の pressure）。
  const first = events.find(e => e.speakerId === 1);
  assert.equal(first.text, Logic.DISCUSSION_TEMPLATES.pressure.low[3].replaceAll("{target}", state.players[7].name));
});

test("planDiscussionTalks：マウスは疑念が最も高い相手を公開し、疑念を更新する", () => {
  const roles = ["villager", "mouse", "villager", "villager", "villager", "villager", "villager", "villager"];
  const state = makeDiscussionState(roles);
  state.players[3].suspicion = 5;
  state.players[4].suspicion = 2;
  const events = Logic.planDiscussionTalks(state, discussionAlive(state), { random: () => 0 });
  const mouse = events.find(e => e.speakerId === 1);
  assert.equal(mouse.type, "mouse");
  assert.equal(mouse.targetId, 3, "疑念が最も高い 3 を公開する");
  assert.equal(state.players[1].mouseUsed, true, "マウス能力は使用済みになる");
  assert.equal(state.players[3].suspicion, -5, "イノセントの公開は疑念 -5");
  // 使用済みのマウスはもう公開しない。
  const again = Logic.planDiscussionTalks(state, discussionAlive(state), { random: () => 0 });
  assert.ok(!again.some(e => e.type === "mouse"), "使用済みならマウス公開は出ない");
});

test("planDiscussionTalks：バカがマウス表示なら公開し、表示役職の疑念を更新する", () => {
  const roles = ["villager", "baka", "villager", "villager", "villager", "villager", "villager", "villager"];
  const state = makeDiscussionState(roles);
  state.players[1].fakeDisplayRoleKey = "mouse";
  state.players[3].suspicion = 5;
  const events = Logic.planDiscussionTalks(state, discussionAlive(state), { random: () => 0 });
  const mouse = events.find(e => e.speakerId === 1);
  assert.equal(mouse.type, "mouse");
  assert.equal(mouse.targetId, 3);
  assert.equal(state.players[1].mouseUsed, true);
  assert.ok([-5, 8].includes(state.players[3].suspicion), "公開後の疑念は -5 か 8");
});

test("planDiscussionTalks：パス＆プレイでは人間の発言はなく CPU 発言数に上限がある", () => {
  const roles = ["villager", "villager", "villager", "villager", "villager", "villager", "villager", "villager"];
  // 人間2人：CPU 6人中4人まで。
  const pnp2 = makeDiscussionState(roles, { mode: "pnp", humanPlayerIds: [0, 1], playerId: 0 });
  const e2 = Logic.planDiscussionTalks(pnp2, discussionAlive(pnp2), { random: seededRandom(3) });
  assert.equal(e2.length, 4);
  assert.ok(e2.every(e => ![0, 1].includes(e.speakerId)), "人間の発言はない");
  // 人間6人：CPU 2人中1人まで。
  const pnp6 = makeDiscussionState(roles, { mode: "pnp", humanPlayerIds: [0, 1, 2, 3, 4, 5], playerId: 0 });
  const e6 = Logic.planDiscussionTalks(pnp6, discussionAlive(pnp6), { random: seededRandom(3) });
  assert.equal(e6.length, 1);
  assert.ok([6, 7].includes(e6[0].speakerId), "残りの CPU のどちらか1人");
  // 人間8人：CPU がいないので発言は0行。
  const pnp8 = makeDiscussionState(roles, { mode: "pnp", humanPlayerIds: [0, 1, 2, 3, 4, 5, 6, 7], playerId: 0 });
  const e8 = Logic.planDiscussionTalks(pnp8, discussionAlive(pnp8), { random: seededRandom(3) });
  assert.equal(e8.length, 0);
});

test("planDiscussionTalks：同じ seed なら同じイベント列になる", () => {
  const roles = ["guardian", "apprenticeSeer", "mouse", "tracker", "fakeGirl", "mimic", "bomber", "doctor"];
  const a = makeDiscussionState(roles, {
    nightReport: { type: "blocked", victimId: null },
    bombReport: { explodedVictims: [4], fizzled: false },
    lastInvestigation: { 1: { targetId: 4, result: "インポスター" } },
  });
  a.players[3].lastTarget = 6;
  a.players[4].suspicion = 4;
  const b = makeDiscussionState(roles, {
    nightReport: { type: "blocked", victimId: null },
    bombReport: { explodedVictims: [4], fizzled: false },
    lastInvestigation: { 1: { targetId: 4, result: "インポスター" } },
  });
  b.players[3].lastTarget = 6;
  b.players[4].suspicion = 4;
  const ea = Logic.planDiscussionTalks(a, discussionAlive(a), { random: seededRandom(11) });
  const eb = Logic.planDiscussionTalks(b, discussionAlive(b), { random: seededRandom(11) });
  assert.equal(JSON.stringify(ea), JSON.stringify(eb), "同じ seed は同じイベント列");
});

test("ブラウザ側の morningToDiscussion は共有モジュールと同一のセリフ選択をする", () => {
  const script = (FB) => {
    FB.setupGame();
    const roles = ["guardian", "apprenticeSeer", "police", "tracker", "fakeGirl", "mimic", "bomber", "doctor"];
    FB.state.players.forEach((p, i) => {
      p.roleKey = roles[i];
      p.fakeDisplayRoleKey = null;
      p.clumsy = false;
      p.suspicion = [0, 4, 1, 2, 0, 0, 3, 0][i];
    });
    FB.state.playerId = 0;
    FB.state.humanPlayerIds = [0];
    FB.state.mode = "solo";
    FB.state.day = 1;
    FB.state.selectedId = 1;
    FB.state.fakeIntel = { 1: "apprenticeSeer" };
    FB.state.bombs = [{ targetId: 4, explodeDay: 2 }];
    FB.state.phase = "morning";
    return FB.state.players.filter(p => p.alive);
  };
  // モジュール直接（seed 固定）。マウス役職はいないのでイベントは talk のみ。
  const { FB: FB1 } = loadGame({ seedSettings: BASE_SETTINGS });
  const alive1 = script(FB1);
  const events = FB1.planDiscussionTalksLogic(FB1.state, alive1, { random: seededRandom(7) });
  const expectedLines = events.map(e => `${FB1.state.players[e.speakerId].name}：${e.text}`);
  // ブラウザの morningToDiscussion：同じ seed の乱数で回す。
  const { FB: FB2, elements: el2, sandbox } = loadGame({ seedSettings: BASE_SETTINGS });
  const alive2 = script(FB2);
  // Math のスタブ：{...Math} では列挙不可の floor 等が拾えないため、
  // 実 Math をプロトタイプにして random だけ差し替える。
  sandbox.Math = Object.create(Math);
  sandbox.Math.random = seededRandom(7);
  const before = el2.get("dialogueLog").children.length;
  FB2.morningToDiscussion();
  const lines = el2.get("dialogueLog").children.slice(before).map(c => c.textContent);
  assert.equal(JSON.stringify(lines), JSON.stringify(expectedLines), "ラッパーとモジュールで議論セリフが一致");
  void alive2;
});

// ---- フェーズ0第6歩：結果画面ハイライトの抽出 ----

// ハイライトテスト用の最小プレイヤー列。roleKeys は8人分。
function makeHighlightPlayers(roleKeys, extra = {}) {
  const players = roleKeys.map((roleKey, i) => makeNightPlayer(i, roleKey));
  for (const [id, patch] of Object.entries(extra)) Object.assign(players[id], patch);
  return players;
}
const HIGHLIGHT_ROLES = ["villager", "bomber", "villager", "villager", "villager", "villager", "villager", "villager"];

test("buildHighlights：何も起きていなければ日数のフォールバック1行", () => {
  const players = makeHighlightPlayers(["villager", "villager", "villager", "villager", "villager", "villager", "villager", "villager"]);
  assert.deepEqual(Logic.buildHighlights(players, { bombKills: 0, revives: 0, guardSaves: 0, day: 3 }), ["📅 3日目で決着"]);
});

test("buildHighlights：爆弾2キル・罠・蘇生・護衛が全部起きれば優先度の高い2行だけ", () => {
  const players = makeHighlightPlayers(HIGHLIGHT_ROLES, { 2: { deathCause: "罠" } });
  const bomber = players[1];
  const lines = Logic.buildHighlights(players, { bombKills: 2, revives: 1, guardSaves: 3, day: 5 });
  assert.equal(lines.length, 2);
  assert.equal(lines[0], `💣 ${bomber.name}の爆弾で2人が倒れた！`);
  assert.equal(lines[1], "🪤 罠が1回作動し、襲撃者を道連れにした");
});

test("buildHighlights：爆弾1キルだけなら1行、ボマーがいなければ爆弾の行は出ない", () => {
  const withBomber = makeHighlightPlayers(HIGHLIGHT_ROLES);
  const bomber = withBomber[1];
  assert.deepEqual(
    Logic.buildHighlights(withBomber, { bombKills: 1, revives: 0, guardSaves: 0, day: 2 }),
    [`💣 ${bomber.name}の爆弾で1人が倒れた`]);
  // ボマーがいない試合では bombKills が残っていても爆弾の行は出ない。
  const noBomber = makeHighlightPlayers(["villager", "villager", "villager", "villager", "villager", "villager", "villager", "villager"]);
  assert.deepEqual(
    Logic.buildHighlights(noBomber, { bombKills: 2, revives: 0, guardSaves: 0, day: 2 }),
    ["📅 2日目で決着"]);
});

test("buildHighlights：蘇生と護衛だけなら両方出る", () => {
  const players = makeHighlightPlayers(HIGHLIGHT_ROLES);
  assert.deepEqual(
    Logic.buildHighlights(players, { bombKills: 0, revives: 2, guardSaves: 1, day: 4 }),
    ["💉 ドクターの蘇生で2人が助かった", "🛡️ 護衛が1回、襲撃を防いだ"]);
});

test("buildHighlights：罠は deathCause「罠」の人数で数え、他の死因は数えない", () => {
  const players = makeHighlightPlayers(HIGHLIGHT_ROLES, { 2: { deathCause: "罠" }, 3: { deathCause: "罠" }, 4: { deathCause: "襲撃" } });
  const lines = Logic.buildHighlights(players, { bombKills: 0, revives: 0, guardSaves: 0, day: 6 });
  assert.deepEqual(lines, ["🪤 罠が2回作動し、襲撃者を道連れにした"]);
});

test("ブラウザ側の buildHighlights は共有モジュールと同一のハイライトを返す", () => {
  const { FB } = loadGame({ seedSettings: { ...BASE_SETTINGS, bomber: "on" } });
  FB.setupGame();
  const s = FB.state;
  const bomber = s.players.find((p) => p.roleKey === "bomber");
  assert.ok(bomber, "ボマーがいるはず");
  // 名場面が全部起きた状態。
  s.bombKills = 2;
  s.players[0].deathCause = "罠";
  s.revives = 1;
  s.guardSaves = 3;
  assert.equal(
    JSON.stringify(FB.buildHighlights()),
    JSON.stringify(Logic.buildHighlights(s.players, s)),
    "ラッパーとモジュールでハイライトが一致");
  assert.equal(
    JSON.stringify(FB.buildHighlights()),
    JSON.stringify(FB.buildHighlightsLogic(s.players, s)),
    "ハーネス経由のモジュール関数とも一致");
  // 何も起きていない状態：日数のフォールバック。
  s.bombKills = 0;
  s.players[0].deathCause = null;
  s.revives = 0;
  s.guardSaves = 0;
  assert.equal(
    JSON.stringify(FB.buildHighlights()),
    JSON.stringify(Logic.buildHighlights(s.players, s)),
    "フォールバック行も一致");
  assert.equal(FB.buildHighlights().join("\n"), `📅 ${s.day}日目で決着`);
});

// ---- フェーズ0第7歩：戦績記録の抽出 ----

const EMPTY_SOLO_STATS = { games: 0, wins: 0, byRole: {}, factionWins: {}, steals: 0, streak: 0, bestStreak: 0 };
const EMPTY_PNP_STATS = { games: 0, factionWins: {}, byRole: {} };

test("applySoloStats：勝利で試合数・勝利数・陣営勝利・役職戦績・連勝が加算される", () => {
  const before = { games: 5, wins: 3, byRole: { guardian: { games: 2, wins: 1 } }, factionWins: { "イノセント": 3 }, steals: 1, streak: 2, bestStreak: 4 };
  const after = Logic.applySoloStats(before, { myWin: true, roleKey: "guardian", faction: "イノセント", winText: "イノセント陣営の勝利" });
  assert.equal(after.games, 6);
  assert.equal(after.wins, 4);
  assert.equal(after.factionWins["イノセント"], 4);
  assert.equal(after.steals, 1);
  assert.equal(after.streak, 3);
  assert.equal(after.bestStreak, 4);
  assert.deepEqual(after.byRole.guardian, { games: 3, wins: 2 });
});

test("applySoloStats：敗北で連勝が 0 に戻り、最高連勝は残る", () => {
  const before = { games: 5, wins: 3, byRole: {}, factionWins: { "イノセント": 3 }, steals: 0, streak: 2, bestStreak: 4 };
  const after = Logic.applySoloStats(before, { myWin: false, roleKey: "villager", faction: "イノセント", winText: "インポスター陣営の勝利" });
  assert.equal(after.games, 6);
  assert.equal(after.wins, 3);
  assert.equal(after.streak, 0);
  assert.equal(after.bestStreak, 4);
  assert.deepEqual(after.byRole.villager, { games: 1, wins: 0 });
});

test("applySoloStats：横取り勝利だけ steals が増える", () => {
  const steal = Logic.applySoloStats(EMPTY_SOLO_STATS, { myWin: true, roleKey: "bomber", faction: "ニュートラル", winText: "ボマーの勝利（横取り）" });
  assert.equal(steal.steals, 1);
  assert.equal(steal.factionWins["ニュートラル"], 1);
  const normal = Logic.applySoloStats(EMPTY_SOLO_STATS, { myWin: true, roleKey: "bomber", faction: "ニュートラル", winText: "ボマーの勝利" });
  assert.equal(normal.steals, 0);
  // 敗北では横取り文言があっても増えない。
  const lost = Logic.applySoloStats(EMPTY_SOLO_STATS, { myWin: false, roleKey: "villager", faction: "イノセント", winText: "ボマーの勝利（横取り）" });
  assert.equal(lost.steals, 0);
});

test("applySoloStats：入力の stats を変更しない（純粋関数）", () => {
  const before = { games: 2, wins: 1, byRole: { guardian: { games: 1, wins: 1 } }, factionWins: { "イノセント": 1 }, steals: 0, streak: 1, bestStreak: 1 };
  const snapshot = JSON.stringify(before);
  Logic.applySoloStats(before, { myWin: true, roleKey: "guardian", faction: "イノセント", winText: "イノセント陣営の勝利" });
  assert.equal(JSON.stringify(before), snapshot);
});

test("applySoloStats：空・欠けた stats でもデフォルトで動く", () => {
  const after = Logic.applySoloStats({}, { myWin: true, roleKey: "mouse", faction: "イノセント", winText: "イノセント陣営の勝利" });
  assert.equal(after.games, 1);
  assert.equal(after.wins, 1);
  assert.equal(after.streak, 1);
  assert.equal(after.bestStreak, 1);
  assert.deepEqual(after.byRole.mouse, { games: 1, wins: 1 });
  const nullAfter = Logic.applySoloStats(null, { myWin: false, roleKey: "villager", faction: "イノセント", winText: "インポスター陣営の勝利" });
  assert.equal(nullAfter.games, 1);
  assert.equal(nullAfter.wins, 0);
});

test("applyPnpStats：勝った陣営と各人間の役職戦績が加算される（勝ち役職だけ wins）", () => {
  const humanRoles = [
    { roleKey: "guardian", faction: "イノセント" },
    { roleKey: "fakeGirl", faction: "インポスター" },
    { roleKey: "villager", faction: "イノセント" },
  ];
  const after = Logic.applyPnpStats(EMPTY_PNP_STATS, { winnerFaction: "イノセント", humanRoles });
  assert.equal(after.games, 1);
  assert.equal(after.factionWins["イノセント"], 1);
  assert.deepEqual(after.byRole.guardian, { games: 1, wins: 1 });
  assert.deepEqual(after.byRole.fakeGirl, { games: 1, wins: 0 });
  assert.deepEqual(after.byRole.villager, { games: 1, wins: 1 });
});

test("applyPnpStats：winnerFaction がなければ陣営勝利は加算されない", () => {
  const after = Logic.applyPnpStats(EMPTY_PNP_STATS, { winnerFaction: null, humanRoles: [{ roleKey: "villager", faction: "イノセント" }] });
  assert.equal(after.games, 1);
  assert.deepEqual(after.factionWins, {});
  assert.deepEqual(after.byRole.villager, { games: 1, wins: 0 });
});

test("applyPnpStats：入力の stats を変更しない（純粋関数）", () => {
  const before = { games: 1, factionWins: { "イノセント": 1 }, byRole: { villager: { games: 1, wins: 1 } } };
  const snapshot = JSON.stringify(before);
  Logic.applyPnpStats(before, { winnerFaction: "インポスター", humanRoles: [{ roleKey: "villager", faction: "イノセント" }] });
  assert.equal(JSON.stringify(before), snapshot);
});

test("ブラウザ側の recordStats は共有モジュールと同一の戦績を保存し、二重記録しない", () => {
  const { FB, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const me = s.players[s.playerId];
  s.myWin = true;
  FB.recordStats("イノセント陣営の勝利");
  const expected = Logic.applySoloStats(EMPTY_SOLO_STATS, {
    myWin: true, roleKey: me.roleKey, faction: Logic.ROLES[me.roleKey].faction, winText: "イノセント陣営の勝利",
  });
  assert.equal(localStorage.getItem("fakeBloomStats"), JSON.stringify(expected), "ラッパーとモジュールで戦績が一致");
  // 2回目の呼び出しは statsRecorded ガードで無視される。
  FB.recordStats("イノセント陣営の勝利");
  assert.equal(localStorage.getItem("fakeBloomStats"), JSON.stringify(expected), "二重記録されない");
});

test("ブラウザ側の recordStats：敗北では連勝がリセットされる（既存戦績からの加算）", () => {
  const seeded = { games: 5, wins: 3, byRole: {}, factionWins: { "イノセント": 3 }, steals: 1, streak: 3, bestStreak: 3 };
  const { FB, localStorage } = loadGame({ seedSettings: BASE_SETTINGS, seedStorage: { fakeBloomStats: JSON.stringify(seeded) } });
  FB.setupGame();
  const s = FB.state;
  const me = s.players[s.playerId];
  s.myWin = false;
  FB.recordStats("インポスター陣営の勝利");
  const saved = JSON.parse(localStorage.getItem("fakeBloomStats"));
  assert.equal(saved.games, 6);
  assert.equal(saved.wins, 3);
  assert.equal(saved.streak, 0);
  assert.equal(saved.bestStreak, 3);
  assert.equal(saved.byRole[me.roleKey].games, 1);
  assert.equal(saved.byRole[me.roleKey].wins, 0);
});

test("ブラウザ側の recordPnpStats は共有モジュールと同一の戦績を保存し、二重記録しない", () => {
  const { FB, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  s.winnerFaction = "イノセント";
  s.humanPlayerIds = [0, 1, 2];
  FB.recordPnpStats("イノセント陣営の勝利");
  const humanRoles = [0, 1, 2].map((id) => ({ roleKey: s.players[id].roleKey, faction: Logic.ROLES[s.players[id].roleKey].faction }));
  const expected = Logic.applyPnpStats(EMPTY_PNP_STATS, { winnerFaction: "イノセント", humanRoles });
  assert.equal(localStorage.getItem("fakeBloomPnpStats"), JSON.stringify(expected), "ラッパーとモジュールで戦績が一致");
  FB.recordPnpStats("イノセント陣営の勝利");
  assert.equal(localStorage.getItem("fakeBloomPnpStats"), JSON.stringify(expected), "二重記録されない");
});

// ---- フェーズ0第8歩：結果画面の勝敗・行生成の抽出 ----

const RESULT_PLAYERS = [
  { id: 0, name: "ルナ", icon: "🌙", roleKey: "guardian", alive: true },
  { id: 1, name: "ミオ", icon: "🐱", roleKey: "fakeGirl", alive: false, deathDay: 2, deathCause: "追放" },
  { id: 2, name: "ソラ", icon: "☀️", roleKey: "baka", fakeDisplayRoleKey: "doctor", alive: true },
  { id: 3, name: "ユイ", icon: "🌸", roleKey: "apprenticeSeer", clumsy: true, alive: false, deathDay: 1, deathCause: "襲撃" },
  { id: 4, name: "レン", icon: "🔥", roleKey: "bomber", alive: true },
];
const INNOCENT_WIN = "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！";
const IMPOSTOR_WIN = "💀 インポスター陣営の勝利…生存者数が同数以上になった。";
const BOMBER_STEAL_WIN = "💣 ボマーの勝利！爆弾で2人以上を倒し、勝利を横取りした！";

test("buildResultSummary：イノセント勝利で陣営・自分の勝敗・行データが決まる", () => {
  const s = Logic.buildResultSummary(RESULT_PLAYERS, { winText: INNOCENT_WIN, mode: "solo", playerId: 0, humanCount: 1 });
  assert.equal(s.winnerFaction, "イノセント");
  assert.equal(s.myWin, true);
  assert.equal(s.sub, "あなたは「守り手」（イノセント）で 勝利！");
  assert.equal(s.rows.length, 5);
  const guardian = s.rows[0];
  assert.equal(guardian.roleName, "守り手");
  assert.equal(guardian.faction, "イノセント");
  assert.equal(guardian.chipClass, "pure");
  assert.equal(guardian.status, "生存");
  assert.equal(guardian.isWinner, true);
  assert.equal(guardian.isMe, true);
  const fakeGirl = s.rows[1];
  assert.equal(fakeGirl.chipClass, "fake");
  assert.equal(fakeGirl.status, "2日目に脱落（追放）");
  assert.equal(fakeGirl.isWinner, false);
  assert.equal(fakeGirl.isMe, false);
  const baka = s.rows[2];
  assert.equal(baka.displayNote, "（表示：ドクター）");
  assert.equal(baka.roleName, "バカ");
  const seer = s.rows[3];
  assert.equal(seer.clumsyNote, "（実はうっかり個体でした）");
  assert.equal(seer.status, "1日目に脱落（襲撃）");
  const bomber = s.rows[4];
  assert.equal(bomber.chipClass, "neutral");
  assert.equal(bomber.isWinner, false);
});

test("buildResultSummary：インポスター勝利なら人間は敗北、うっかり個体の注記は自分の文言にも出る", () => {
  const s = Logic.buildResultSummary(RESULT_PLAYERS, { winText: IMPOSTOR_WIN, mode: "solo", playerId: 3, humanCount: 1 });
  assert.equal(s.winnerFaction, "インポスター");
  assert.equal(s.myWin, false);
  assert.equal(s.sub, "あなたは「見習い占い師」（イノセント）で 敗北…（実はうっかり個体でした）");
  assert.equal(s.rows[1].isWinner, true);
  assert.equal(s.rows[0].isWinner, false);
});

test("buildResultSummary：ボマーの横取り勝利はニュートラル、ボマーだけが勝つ", () => {
  const s = Logic.buildResultSummary(RESULT_PLAYERS, { winText: BOMBER_STEAL_WIN, mode: "solo", playerId: 4, humanCount: 1 });
  assert.equal(s.winnerFaction, "ニュートラル");
  assert.equal(s.myWin, true);
  const asGuardian = Logic.buildResultSummary(RESULT_PLAYERS, { winText: BOMBER_STEAL_WIN, mode: "solo", playerId: 0, humanCount: 1 });
  assert.equal(asGuardian.myWin, false);
  assert.equal(asGuardian.rows[4].isWinner, true);
  assert.equal(asGuardian.rows[0].isWinner, false);
});

test("buildResultSummary：パス＆プレイでは myWin が null で人間数入りの文言、（あなた）なし", () => {
  const s = Logic.buildResultSummary(RESULT_PLAYERS, { winText: INNOCENT_WIN, mode: "pnp", playerId: 0, humanCount: 3 });
  assert.equal(s.myWin, null);
  assert.equal(s.sub, "パス＆プレイ（人間3人）で遊びました。");
  assert.ok(s.rows.every((r) => r.isMe === false), "パス＆プレイの行に（あなた）は付かない");
});

test("buildResultSummary：入力の players を変更しない（純粋関数）", () => {
  const snapshot = JSON.stringify(RESULT_PLAYERS);
  Logic.buildResultSummary(RESULT_PLAYERS, { winText: INNOCENT_WIN, mode: "solo", playerId: 0, humanCount: 1 });
  assert.equal(JSON.stringify(RESULT_PLAYERS), snapshot);
});

test("ブラウザ側の showResults は共有モジュールと同一の表示になる", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const baka = s.players.find((p) => p.roleKey === "baka");
  baka.fakeDisplayRoleKey = "guardian";
  const seer = s.players.find((p) => p.roleKey === "apprenticeSeer");
  seer.clumsy = true;
  s.playerId = seer.id;
  const input = { winText: INNOCENT_WIN, mode: s.mode, playerId: s.playerId, humanCount: s.humanPlayerIds.length };
  const expected = Logic.buildResultSummary(s.players, input);
  assert.equal(
    JSON.stringify(FB.buildResultSummaryLogic(s.players, input)),
    JSON.stringify(expected),
    "ハーネス経由のモジュール関数とも一致");
  FB.showResults(INNOCENT_WIN);
  assert.equal(s.winnerFaction, expected.winnerFaction);
  assert.equal(s.myWin, expected.myWin);
  assert.equal(elements.get("resultSub").textContent, expected.sub);
  const rowsHtml = elements.get("resultRows").innerHTML;
  for (const r of expected.rows) {
    assert.ok(rowsHtml.includes(r.roleName), `行に役職名 ${r.roleName} がある`);
    assert.ok(rowsHtml.includes(r.status), `行に生死 ${r.status} がある`);
    if (r.displayNote) assert.ok(rowsHtml.includes(r.displayNote), "バカの表示注記がある");
    if (r.clumsyNote) assert.ok(rowsHtml.includes(r.clumsyNote), "うっかり個体の注記がある");
  }
  assert.ok(rowsHtml.includes("（あなた）"), "自分の行に（あなた）が付く");
});

// ---- フェーズ0第9歩：戦績の表示生成の抽出 ----

const SOLO_STATS = {
  games: 10, wins: 6,
  byRole: {
    guardian: { games: 4, wins: 3 },
    apprenticeSeer: { games: 3, wins: 1 },
    clumsySeer: { games: 2, wins: 2 },
    unknownRoleKey: { games: 1, wins: 0 },
  },
  factionWins: { "イノセント": 5, "インポスター": 1 },
  steals: 0, streak: 2, bestStreak: 3,
};
const PNP_STATS = {
  games: 5,
  factionWins: { "イノセント": 3, "インポスター": 2 },
  byRole: { villager: { games: 4, wins: 2 }, fakeGirl: { games: 1, wins: 1 } },
};

test("buildStatsView：ソロは勝率つきサマリーと試合数順の役職チップを返す", () => {
  const v = Logic.buildStatsView(SOLO_STATS, { kind: "solo" });
  assert.equal(v.summary, "通算 10戦 6勝 4敗（勝率 60%）");
  assert.ok(v.chips.includes("守り手：4戦3勝"), `チップ: ${v.chips}`);
  assert.ok(v.chips.includes("見習い占い師：3戦1勝"), `チップ: ${v.chips}`);
  // 試合数の多い順に並ぶ（守り手→見習い占い師→うっかり占い師→未知キー）。
  assert.ok(
    v.chips.indexOf("守り手") < v.chips.indexOf("見習い占い師")
      && v.chips.indexOf("見習い占い師") < v.chips.indexOf("うっかり占い師"),
    `並び順: ${v.chips}`);
});

test("buildStatsView：ソロで0戦なら「まだ対戦記録がありません」でチップなし", () => {
  const v = Logic.buildStatsView({ games: 0, wins: 0, byRole: {}, factionWins: {} }, { kind: "solo" });
  assert.equal(v.summary, "まだ対戦記録がありません");
  assert.equal(v.chips, "");
});

test("buildStatsView：廃止済み役職は当時の名前、未知のキーはキーそのままで表示する", () => {
  const v = Logic.buildStatsView(SOLO_STATS, { kind: "solo" });
  assert.ok(v.chips.includes("うっかり占い師：2戦2勝"), `旧記録: ${v.chips}`);
  assert.ok(v.chips.includes("unknownRoleKey：1戦0勝"), `未知キー: ${v.chips}`);
});

test("buildStatsView：パス＆プレイは陣営勝利数つきサマリーを返す", () => {
  const v = Logic.buildStatsView(PNP_STATS, { kind: "pnp" });
  assert.equal(v.summary, "通算 5戦（イノセント勝利 3・インポスター勝利 2・ボマー勝利 0）");
  assert.ok(v.chips.includes("村ガール：4戦2勝"), `チップ: ${v.chips}`);
  assert.ok(v.chips.includes("フェイクガール：1戦1勝"), `チップ: ${v.chips}`);
});

test("buildStatsView：パス＆プレイで0戦なら専用の文言でチップなし", () => {
  const v = Logic.buildStatsView({ games: 0, factionWins: {}, byRole: {} }, { kind: "pnp" });
  assert.equal(v.summary, "まだパス＆プレイの記録がありません");
  assert.equal(v.chips, "");
});

test("buildStatsView：入力の stats を変更しない（純粋関数）", () => {
  const soloSnapshot = JSON.stringify(SOLO_STATS);
  const pnpSnapshot = JSON.stringify(PNP_STATS);
  Logic.buildStatsView(SOLO_STATS, { kind: "solo" });
  Logic.buildStatsView(PNP_STATS, { kind: "pnp" });
  assert.equal(JSON.stringify(SOLO_STATS), soloSnapshot);
  assert.equal(JSON.stringify(PNP_STATS), pnpSnapshot);
});

test("ブラウザ側の renderStats / renderPnpStats は共有モジュールと同一の表示になる", () => {
  const { FB, elements, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  localStorage.setItem("fakeBloomStats", JSON.stringify(SOLO_STATS));
  localStorage.setItem("fakeBloomPnpStats", JSON.stringify(PNP_STATS));
  const soloExpected = Logic.buildStatsView(SOLO_STATS, { kind: "solo" });
  const pnpExpected = Logic.buildStatsView(PNP_STATS, { kind: "pnp" });
  assert.equal(
    JSON.stringify(FB.buildStatsViewLogic(SOLO_STATS, { kind: "solo" })),
    JSON.stringify(soloExpected),
    "ハーネス経由のモジュール関数とも一致");
  FB.renderStats();
  assert.equal(elements.get("statsSummary").textContent, soloExpected.summary);
  assert.equal(elements.get("statsRoles").innerHTML, soloExpected.chips);
  // renderStats はパス＆プレイ側も一緒に描く。
  assert.equal(elements.get("pnpStatsSummary").textContent, pnpExpected.summary);
  assert.equal(elements.get("pnpStatsRoles").innerHTML, pnpExpected.chips);
  FB.renderPnpStats();
  assert.equal(elements.get("pnpStatsSummary").textContent, pnpExpected.summary);
  assert.equal(elements.get("pnpStatsRoles").innerHTML, pnpExpected.chips);
  // 0戦の表示もモジュール通り。
  const fresh = loadGame({ seedSettings: BASE_SETTINGS });
  fresh.FB.renderStats();
  assert.equal(fresh.elements.get("statsSummary").textContent, "まだ対戦記録がありません");
  assert.equal(fresh.elements.get("pnpStatsSummary").textContent, "まだパス＆プレイの記録がありません");
});

test("getPhaseHint：夜は自分の表示役職の nightActionHint、他フェーズは固定文言", () => {
  const seer = { roleKey: "apprenticeSeer" };
  assert.equal(Logic.getPhaseHint("night", seer), Logic.ROLES.apprenticeSeer.nightActionHint);
  assert.match(Logic.getPhaseHint("night", seer), /調査/);
  assert.equal(Logic.getPhaseHint("night", { roleKey: "guardian" }), "襲われそうな子を1人選んでガード。");
  assert.equal(Logic.getPhaseHint("morning", seer), "朝の報告を整理して、発言方針を決めよう。");
  assert.equal(Logic.getPhaseHint("vote", seer), "ログと投票履歴から、いちばん矛盾が大きい相手に投票しよ。");
  assert.equal(Logic.getPhaseHint("discussion", seer), "朝の報告と発言のズレを比較して、投票候補を絞ろう。");
  assert.equal(Logic.getPhaseHint("end", seer), "勝敗ログを見て、次ゲームの立ち回りメモを作ろう。");
  assert.equal(Logic.getPhaseHint("unknown", seer), "勝敗ログを見て、次ゲームの立ち回りメモを作ろう。");
});

test("getPhaseHint：夜のバカは表示役職のヒントで「バカ」「偽表示」は出ない", () => {
  const baka = { roleKey: "baka", fakeDisplayRoleKey: "apprenticeSeer" };
  const hint = Logic.getPhaseHint("night", baka);
  assert.equal(hint, Logic.ROLES.apprenticeSeer.nightActionHint);
  assert.ok(!hint.includes("バカ"));
  assert.ok(!hint.includes("偽表示"));
  // 表示役職なしのバカは村ガールのヒント。
  assert.equal(Logic.getPhaseHint("night", { roleKey: "baka", fakeDisplayRoleKey: null }), Logic.ROLES.villager.nightActionHint);
});

test("ブラウザ側の getPhaseHint は共有モジュールと同一のヒントを返す", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const me = s.players[s.playerId];
  for (const phase of ["night", "morning", "discussion", "vote", "end"]) {
    s.phase = phase;
    assert.equal(FB.getPhaseHint(FB.ROLES[me.roleKey]), Logic.getPhaseHint(phase, me), `${phase} のヒントが一致`);
    assert.equal(FB.getPhaseHintLogic(phase, me), Logic.getPhaseHint(phase, me), `ハーネス経由のモジュール関数とも一致（${phase}）`);
  }
  // バカ表示のときも夜ヒントは表示役職のもの。
  me.roleKey = "baka";
  me.fakeDisplayRoleKey = "apprenticeSeer";
  s.phase = "night";
  assert.equal(FB.getPhaseHint(FB.ROLES.baka), Logic.getPhaseHint("night", me));
  assert.match(FB.getPhaseHint(FB.ROLES.baka), /調査/);
  // 役職カードのヒント表示もモジュール通り。
  FB.updateInGameRoleCard();
  assert.equal(elements.get("roleCardPhaseHint").textContent, Logic.getPhaseHint("night", me));
});
