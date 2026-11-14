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
    for (const field of ["name", "icon", "faction", "desc", "shortDesc", "guideDesc", "nightActionHint", "resultInterpretation", "riskNote"]) {
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

test("getFakeAlliesText：インポスター以外・player なしは空文字、仲間なしは「なし」", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "fakeGirl" },
    { id: 1, name: "ミオ", roleKey: "villager" },
  ];
  assert.equal(Logic.getFakeAlliesText(players, players[1]), "");
  assert.equal(Logic.getFakeAlliesText(players, null), "");
  assert.equal(Logic.getFakeAlliesText(players, players[0]), "なし");
  assert.equal(Logic.getFakeAlliesText([], players[0]), "なし");
});

test("getFakeAlliesText：ソロは仲間名を「、」でつなぐ（脱落した仲間も含む）", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "fakeGirl", alive: true },
    { id: 1, name: "ミオ", roleKey: "mimic", alive: true },
    { id: 2, name: "アオイ", roleKey: "mimic", alive: false },
    { id: 3, name: "ユキ", roleKey: "villager", alive: true },
  ];
  assert.equal(Logic.getFakeAlliesText(players, players[0]), "ミオ、アオイ");
  assert.equal(Logic.getFakeAlliesText(players, players[1]), "ルナ、アオイ");
});

test("getFakeAlliesText：パス＆プレイは人間の仲間に P 番号、CPU の仲間は名前だけ", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "fakeGirl" },
    { id: 1, name: "ミオ", roleKey: "mimic" },
    { id: 2, name: "アオイ", roleKey: "mimic" },
  ];
  const opts = { mode: "pnp", humanPlayerIds: [1, 0] };
  assert.equal(Logic.getFakeAlliesText(players, players[0], opts), "P1（ミオ）、アオイ");
  // mode が pnp でなければ P 番号は付かない。
  assert.equal(Logic.getFakeAlliesText(players, players[0], { mode: "solo", humanPlayerIds: [1, 0] }), "ミオ、アオイ");
  assert.equal(Logic.getFakeAlliesText(players, players[0]), "ミオ、アオイ");
});

test("getAlliesLineForRole：インポスターだけ「インポスター仲間：…」を返す", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "fakeGirl" },
    { id: 1, name: "ミオ", roleKey: "mimic" },
    { id: 2, name: "ユキ", roleKey: "villager" },
  ];
  assert.equal(Logic.getAlliesLineForRole(players, players[0]), "インポスター仲間：ミオ");
  assert.equal(Logic.getAlliesLineForRole(players, players[2]), "");
  assert.equal(Logic.getAlliesLineForRole(players, null), "");
  const solo = [{ id: 0, name: "ルナ", roleKey: "fakeGirl" }];
  assert.equal(Logic.getAlliesLineForRole(solo, solo[0]), "インポスター仲間：なし");
});

test("roleHtmlFor：バカには表示役職だけを見せ、「バカ」「偽表示」は出ない", () => {
  const players = [{ id: 0, name: "ルナ", roleKey: "baka", fakeDisplayRoleKey: "guardian" }];
  const html = Logic.roleHtmlFor(players[0], players);
  assert.ok(html.includes("守り手"), `表示役職が出る: ${html}`);
  assert.ok(!html.includes("バカ"), `バカの文言が出ない: ${html}`);
  assert.ok(!html.includes("偽表示"), `偽表示の文言が出ない: ${html}`);
  // 占い師表示のバカも同じ。
  players[0].fakeDisplayRoleKey = "apprenticeSeer";
  assert.ok(Logic.roleHtmlFor(players[0], players).includes("見習い占い師"));
  // バカ以外は従来通り自分の役職が出る。
  players[0].roleKey = "tracker";
  players[0].fakeDisplayRoleKey = null;
  assert.ok(Logic.roleHtmlFor(players[0], players).includes("追跡係"));
});

test("roleHtmlFor：インポスターには仲間行、イノセントには仲間行なし", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "fakeGirl" },
    { id: 1, name: "ミオ", roleKey: "mimic" },
    { id: 2, name: "ユキ", roleKey: "villager" },
  ];
  assert.ok(Logic.roleHtmlFor(players[0], players).includes("インポスター仲間：ミオ"));
  assert.ok(!Logic.roleHtmlFor(players[2], players).includes("インポスター仲間"));
  assert.ok(Logic.roleHtmlFor(players[2], players).includes("村ガール"));
});

test("roleHtmlFor：入力の players を変更しない（純粋関数）", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "fakeGirl" },
    { id: 1, name: "ミオ", roleKey: "mimic" },
  ];
  const before = JSON.stringify(players);
  Logic.roleHtmlFor(players[0], players);
  Logic.getFakeAlliesText(players, players[0]);
  Logic.getAlliesLineForRole(players, players[0]);
  assert.equal(JSON.stringify(players), before);
});

test("ブラウザ側の roleHtmlFor / getFakeAlliesText / getAlliesLineForRole は共有モジュールと同一の表示になる", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const opts = { mode: s.mode, humanPlayerIds: s.humanPlayerIds };
  const me = s.players[s.playerId];
  for (const p of s.players) {
    assert.equal(FB.roleHtmlFor(p), Logic.roleHtmlFor(p, s.players, opts), `${p.name} の役職表示が一致`);
    assert.equal(FB.getFakeAlliesText(p), Logic.getFakeAlliesText(s.players, p, opts), `${p.name} の仲間表示が一致`);
    assert.equal(FB.getAlliesLineForRole(p), Logic.getAlliesLineForRole(s.players, p, opts), `${p.name} の仲間行が一致`);
    assert.equal(FB.getFakeAlliesTextLogic(s.players, p, opts), Logic.getFakeAlliesText(s.players, p, opts), `ハーネス経由のモジュール関数とも一致（${p.name}）`);
    assert.equal(FB.roleHtmlForLogic(p, s.players, opts), Logic.roleHtmlFor(p, s.players, opts), `ハーネス経由の roleHtmlFor とも一致（${p.name}）`);
  }
  // バカ表示のときも役職表示は表示役職のもの。
  me.roleKey = "baka";
  me.fakeDisplayRoleKey = "apprenticeSeer";
  assert.equal(FB.roleHtmlFor(me), Logic.roleHtmlFor(me, s.players, opts));
  assert.match(FB.roleHtmlFor(me), /見習い占い師/);
  assert.ok(!FB.roleHtmlFor(me).includes("バカ"));
  // 役職カードの仲間表示もモジュール通り。
  FB.updateInGameRoleCard();
  assert.equal(elements.get("roleCardAllies").textContent, Logic.getFakeAlliesText(s.players, me, opts));
  // パス＆プレイでは P 番号つきの仲間表示になる。
  const pnp = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2" } });
  pnp.FB.setupGame();
  const ps = pnp.FB.state;
  const popts = { mode: ps.mode, humanPlayerIds: ps.humanPlayerIds };
  for (const p of ps.players) {
    assert.equal(pnp.FB.roleHtmlFor(p), Logic.roleHtmlFor(p, ps.players, popts), `PnP ${p.name} の役職表示が一致`);
    assert.equal(pnp.FB.getFakeAlliesText(p), Logic.getFakeAlliesText(ps.players, p, popts), `PnP ${p.name} の仲間表示が一致`);
  }
});

test("buildRoleCardView：役職名・陣営・フェーズヒント・注意書き・仲間文言を返す", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "apprenticeSeer" },
    { id: 1, name: "ミオ", roleKey: "fakeGirl" },
    { id: 2, name: "アオイ", roleKey: "mimic" },
  ];
  const view = Logic.buildRoleCardView(players, 0, { phase: "night" });
  assert.equal(view.name, "🔮 見習い占い師");
  assert.equal(view.faction, "イノセント");
  assert.equal(view.phaseHint, Logic.ROLES.apprenticeSeer.nightActionHint);
  assert.equal(view.riskNote, Logic.ROLES.apprenticeSeer.riskNote);
  assert.equal(view.alliesText, "");
  // 議論フェーズは固定文言（getPhaseHint と同じ）。
  assert.equal(
    Logic.buildRoleCardView(players, 0, { phase: "discussion" }).phaseHint,
    Logic.getPhaseHint("discussion", players[0])
  );
  // インポスターには仲間文言が入る。
  const fake = Logic.buildRoleCardView(players, 1, { phase: "night" });
  assert.equal(fake.name, "🎭 フェイクガール");
  assert.equal(fake.faction, "インポスター");
  assert.equal(fake.alliesText, "アオイ");
});

test("buildRoleCardView：バカには表示役職だけを見せる", () => {
  const players = [{ id: 0, name: "ルナ", roleKey: "baka", fakeDisplayRoleKey: "guardian" }];
  const view = Logic.buildRoleCardView(players, 0, { phase: "night" });
  assert.equal(view.name, "🛡️ 守り手");
  assert.equal(view.phaseHint, Logic.ROLES.guardian.nightActionHint);
  assert.ok(!view.name.includes("バカ"), `バカの文言が出ない: ${view.name}`);
  assert.ok(!view.faction.includes("バカ"));
});

test("buildRoleCardView：パス＆プレイは P 番号つきの仲間文言、空・対象なしは null", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "fakeGirl" },
    { id: 1, name: "ミオ", roleKey: "mimic" },
  ];
  const view = Logic.buildRoleCardView(players, 0, { phase: "night", mode: "pnp", humanPlayerIds: [1, 0] });
  assert.equal(view.alliesText, "P1（ミオ）");
  assert.equal(Logic.buildRoleCardView([], 0, { phase: "night" }), null);
  assert.equal(Logic.buildRoleCardView(null, 0, { phase: "night" }), null);
  assert.equal(Logic.buildRoleCardView(players, 99, { phase: "night" }), null);
});

test("buildRoleCardView：入力の players を変更しない（純粋関数）", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "baka", fakeDisplayRoleKey: "guardian" },
    { id: 1, name: "ミオ", roleKey: "mimic" },
  ];
  const before = JSON.stringify(players);
  Logic.buildRoleCardView(players, 0, { phase: "night", mode: "pnp", humanPlayerIds: [1, 0] });
  assert.equal(JSON.stringify(players), before);
});

test("ブラウザ側の updateInGameRoleCard は共有モジュールの buildRoleCardView と同一の表示になる", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const opts = { phase: s.phase, mode: s.mode, humanPlayerIds: s.humanPlayerIds };
  const checkCard = (playerId) => {
    const view = Logic.buildRoleCardView(s.players, playerId, opts);
    assert.ok(view, `表示データがある (playerId=${playerId})`);
    FB.updateInGameRoleCard();
    assert.equal(elements.get("roleCardName").textContent, view.roleName);
    assert.equal(elements.get("roleCardIcon").innerHTML, view.iconButtonHtml);
    assert.equal(elements.get("roleCardFaction").textContent, view.faction);
    assert.equal(elements.get("roleCardPhaseHint").textContent, view.phaseHint);
    assert.equal(elements.get("roleCardRisk").textContent, view.riskNote);
    assert.equal(elements.get("roleCardAllies").textContent, view.alliesText);
    // ハーネスの closest() は自分自身を返すため、仲間行の hidden は
    // roleCardAllies 自身のクラスで判定する。
    assert.equal(elements.get("roleCardAllies")._classes.has("hidden"), !view.alliesText);
    // 別レルムのオブジェクトは deepStrictEqual がプロトタイプ差で
    // 失敗するため JSON で比べる（PR #80 の教訓と同じ）。
    assert.equal(
      JSON.stringify(FB.buildRoleCardViewLogic(s.players, playerId, opts)),
      JSON.stringify(view),
      `ハーネス経由のモジュール関数とも同一 (playerId=${playerId})`
    );
  };
  // 人間（ソロの自分）のカード。
  checkCard(s.playerId);
  // インポスターのプレイヤーに切り替えると仲間文言が出て行も表示される。
  const impostor = s.players.find((p) => Logic.ROLES[p.roleKey].faction === "インポスター");
  assert.ok(impostor, "インポスターがいる");
  const savedPlayerId = s.playerId;
  s.playerId = impostor.id;
  checkCard(impostor.id);
  assert.ok(elements.get("roleCardAllies").textContent.length > 0, "仲間文言がある");
  s.playerId = savedPlayerId;
  // バカ表示のときも役職カードは表示役職のもの。
  const me = s.players[s.playerId];
  me.roleKey = "baka";
  me.fakeDisplayRoleKey = "guardian";
  FB.updateInGameRoleCard();
  assert.equal(elements.get("roleCardName").textContent, "守り手");
  assert.ok(elements.get("roleCardIcon").innerHTML.includes('data-role-info="guardian"'), "アイコンは表示役職のボタン");
  assert.ok(!elements.get("roleCardName").textContent.includes("バカ"));
  assert.ok(!elements.get("roleCardIcon").innerHTML.includes("バカ"));
});

test("buildCardsView：生存カードは「？」と生存中、クラス・aria・tabIndex を返す", () => {
  const players = [
    { id: 0, name: "ルナ", icon: Logic.PLAYER_ICONS[0], roleKey: "apprenticeSeer", alive: true, voted: false },
    { id: 1, name: "ミオ", icon: Logic.PLAYER_ICONS[1], roleKey: "fakeGirl", alive: true, voted: true },
  ];
  const views = Logic.buildCardsView(players, { selectedId: 1 });
  assert.equal(views.length, 2);
  const first = views[0];
  assert.equal(first.id, 0);
  assert.equal(first.animationDelay, "0ms");
  assert.equal(first.className, "card   ");
  assert.equal(first.revealedRole, "？");
  assert.equal(first.ariaLabel, "ルナ、？、生存中");
  assert.equal(first.tabIndex, 0);
  assert.equal(first.ariaDisabled, false);
  assert.equal(first.metaHtml, `？<span class="meta-state"> ・ 生存中</span>`);
  assert.ok(first.avatarHtml.includes(`<span>${Logic.PLAYER_ICONS[0]}</span>`));
  assert.ok(!first.avatarHtml.includes("<img"), "顔画像がなければ絵文字だけ");
  assert.ok(first.innerHtml.includes(`<div class="name">ルナ</div>`));
  assert.ok(first.innerHtml.includes("？"));
  // 2枚目は45ms遅れ、選択中・投票済みのクラスが付く。
  const second = views[1];
  assert.equal(second.animationDelay, "45ms");
  assert.ok(second.className.includes("selected"), second.className);
  assert.ok(second.className.includes("voted"), second.className);
  assert.ok(!second.className.includes("dead"), second.className);
});

test("buildCardsView：脱落カードは表示役職のアイコンと脱落済みを返す", () => {
  const players = [
    { id: 2, name: "ユイ", icon: Logic.PLAYER_ICONS[2], roleKey: "mimic", alive: false, voted: false },
  ];
  const [view] = Logic.buildCardsView(players, {});
  assert.ok(view.className.includes("dead"), view.className);
  assert.equal(view.revealedRole, "なりすまし");
  assert.equal(view.ariaLabel, "ユイ、なりすまし、脱落済み");
  assert.equal(view.tabIndex, -1);
  assert.equal(view.ariaDisabled, true);
  assert.equal(view.metaHtml, Logic.roleIconButtonHtml("mimic", { ariaLabel: "役職の簡単な説明を見る" }));
  assert.ok(view.metaHtml.includes('data-role-info="mimic"'), "脱落カードのアイコンは説明ボタン");
  assert.ok(!view.metaHtml.includes("なりすまし"), "カードに役職名テキストは出ない");
  assert.ok(view.innerHtml.includes(Logic.ROLES.mimic.icon));
  assert.ok(!view.innerHtml.includes("？"), "脱落カードに「？」は出ない");
});

test("buildCardsView：バカの脱落カードは表示役職だけを出す", () => {
  const players = [
    { id: 0, name: "ルナ", icon: Logic.PLAYER_ICONS[0], roleKey: "baka", fakeDisplayRoleKey: "guardian", alive: false, voted: false },
  ];
  const [view] = Logic.buildCardsView(players, {});
  assert.equal(view.revealedRole, "守り手");
  assert.ok(view.metaHtml.includes(Logic.ROLES.guardian.icon));
  assert.ok(!JSON.stringify(view).includes("バカ"), `バカの文言が出ない: ${JSON.stringify(view)}`);
});

test("buildCardsView：iconImgs があると顔画像が入り、ないと絵文字だけ", () => {
  const players = [
    { id: 0, name: "ルナ", icon: Logic.PLAYER_ICONS[0], roleKey: "apprenticeSeer", alive: true, voted: false },
  ];
  const withImg = Logic.buildCardsView(players, { iconImgs: { luna: "data:image/webp;base64,xxxx" } })[0];
  assert.ok(withImg.avatarHtml.includes(`<img class="avatar-img" data-icon-slug="luna" src="data:image/webp;base64,xxxx" alt="ルナ"`), withImg.avatarHtml);
  assert.ok(withImg.innerHtml.includes("<img"), "中身の HTML にも画像が入る");
  const withoutImg = Logic.buildCardsView(players, {})[0];
  assert.ok(!withoutImg.avatarHtml.includes("<img"));
  assert.ok(!withoutImg.innerHtml.includes("<img"));
});

test("buildCardsView：空・null は空配列、入力の players を変更しない（純粋関数）", () => {
  assert.deepEqual(Logic.buildCardsView([], {}), []);
  assert.deepEqual(Logic.buildCardsView(null, {}), []);
  const players = [
    { id: 0, name: "ルナ", icon: Logic.PLAYER_ICONS[0], roleKey: "baka", fakeDisplayRoleKey: "guardian", alive: false, voted: true },
    { id: 1, name: "ミオ", icon: Logic.PLAYER_ICONS[1], roleKey: "mimic", alive: true, voted: false },
  ];
  const before = JSON.stringify(players);
  Logic.buildCardsView(players, { selectedId: 1, iconImgs: { luna: "data:image/webp;base64,xxxx" } });
  assert.equal(JSON.stringify(players), before);
});

test("buildCardsView：playerId を渡すと自分のカードだけ「あなた」バッジと me クラスが付く", () => {
  const players = [
    { id: 0, name: "ルナ", icon: Logic.PLAYER_ICONS[0], roleKey: "apprenticeSeer", alive: true, voted: false },
    { id: 1, name: "ミオ", icon: Logic.PLAYER_ICONS[1], roleKey: "fakeGirl", alive: true, voted: false },
    { id: 2, name: "ユイ", icon: Logic.PLAYER_ICONS[2], roleKey: "mimic", alive: false, voted: false },
  ];
  const views = Logic.buildCardsView(players, { playerId: 1 });
  assert.equal(views[0].isMe, false);
  assert.ok(!views[0].className.includes("me"), views[0].className);
  assert.ok(!views[0].innerHtml.includes("あなた"), "他人のカードにバッジは出ない");
  assert.equal(views[1].isMe, true);
  assert.ok(views[1].className.includes("me"), views[1].className);
  assert.ok(views[1].innerHtml.includes(`<span class="me-badge">あなた</span>`), views[1].innerHtml);
  assert.equal(views[1].ariaLabel, "ミオ（あなた）、？、生存中");
  // 脱落した自分のカードにもバッジは残る。
  const deadMe = Logic.buildCardsView(players, { playerId: 2 })[2];
  assert.equal(deadMe.isMe, true);
  assert.ok(deadMe.innerHtml.includes("あなた"), "脱落後も自分のカードと分かる");
  // playerId が null（パス＆プレイ）なら誰にも付かない。
  const pnpViews = Logic.buildCardsView(players, { playerId: null });
  assert.ok(pnpViews.every(v => v.isMe === false));
  assert.ok(!pnpViews.some(v => v.innerHtml.includes("あなた")));
  // playerId を渡さなければ従来と完全に同じ（クラスは "card   "）。
  const plain = Logic.buildCardsView(players, {});
  assert.equal(plain[0].className, "card   ");
  assert.ok(!plain[0].innerHtml.includes("あなた"));
});

test("ブラウザ側の draw は共有モジュールの buildCardsView と同一のカードを描く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const checkCards = (label) => {
    FB.draw();
    // ハーネスでは ICON_IMGS が空（fetch が失敗扱い）のため、モジュール
    // 側にも iconImgs: {} を渡して比べる。
    const views = Logic.buildCardsView(s.players, { selectedId: s.selectedId, iconImgs: {}, playerId: s.mode === "pnp" ? null : s.playerId });
    const cards = elements.get("cards").children;
    assert.equal(cards.length, s.players.length, `${label}：カードの枚数`);
    for (let i = 0; i < views.length; i++) {
      const view = views[i];
      const card = cards[i];
      assert.equal(card.className, view.className, `${label}：${view.id} のクラス`);
      assert.equal(card.style.animationDelay, view.animationDelay, `${label}：${view.id} の遅延`);
      assert.equal(card.getAttribute("data-player"), String(view.id), `${label}：${view.id} の data-player`);
      assert.equal(card.getAttribute("role"), "button", `${label}：${view.id} の role`);
      assert.equal(card.getAttribute("aria-label"), view.ariaLabel, `${label}：${view.id} の aria-label`);
      assert.equal(card.tabIndex, view.tabIndex, `${label}：${view.id} の tabIndex`);
      assert.equal(card.getAttribute("aria-disabled"), view.ariaDisabled ? "true" : null, `${label}：${view.id} の aria-disabled`);
      assert.equal(card.innerHTML, view.innerHtml, `${label}：${view.id} の中身 HTML`);
    }
    // 別レルムのオブジェクトは deepStrictEqual がプロトタイプ差で
    // 失敗するため JSON で比べる（PR #80 の教訓と同じ）。
    assert.equal(
      JSON.stringify(FB.buildCardsViewLogic(s.players, { selectedId: s.selectedId, iconImgs: {}, playerId: s.mode === "pnp" ? null : s.playerId })),
      JSON.stringify(views),
      `${label}：ハーネス経由のモジュール関数とも同一`
    );
  };
  checkCards("初期状態");
  // 脱落・選択中・投票済みのカードも同一になる。
  s.players[1].alive = false;
  s.players[1].voted = true;
  s.selectedId = s.players[2].id;
  checkCards("脱落・選択・投票済みあり");
  // バカ表示の脱落カードも表示役職だけになる。
  s.players[1].roleKey = "baka";
  s.players[1].fakeDisplayRoleKey = "guardian";
  FB.draw();
  const bakaCard = elements.get("cards").children[1];
  assert.ok(!bakaCard.innerHTML.includes("バカ"), "バカの実役職がカードに出ない");
  assert.ok(bakaCard.innerHTML.includes(Logic.ROLES.guardian.icon), "表示役職のアイコンが出る");
});

test("buildStageView：生存者だけを歩行者の HTML で返し、周期は id%4 で決まる", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "apprenticeSeer", alive: true },
    { id: 1, name: "ミオ", roleKey: "fakeGirl", alive: false },
    { id: 5, name: "リリ", roleKey: "guardian", alive: true },
  ];
  const views = Logic.buildStageView(players);
  assert.equal(views.length, 2, "脱落者は出ない");
  assert.equal(views[0].id, 0);
  assert.equal(views[0].slug, "luna");
  assert.equal(views[0].duration, "0.31s");
  assert.ok(views[0].html.includes('class="walker"'), views[0].html);
  assert.ok(views[0].html.includes('data-player="0"'), views[0].html);
  assert.ok(views[0].html.includes('style="--i:0;--bd:0.31s"'), views[0].html);
  assert.ok(views[0].html.includes('data-slug="luna" data-frame="a"'), views[0].html);
  assert.ok(views[0].html.includes('data-slug="luna" data-frame="b"'), views[0].html);
  // id 5 は 5%4=1 なので 0.34s。
  assert.equal(views[1].id, 5);
  assert.equal(views[1].slug, "riri");
  assert.equal(views[1].duration, "0.34s");
  assert.ok(views[1].html.includes('style="--i:5;--bd:0.34s"'), views[1].html);
});

test("buildStageView：空・null は空配列、入力の players を変更しない（純粋関数）", () => {
  assert.deepEqual(Logic.buildStageView([], {}), []);
  assert.deepEqual(Logic.buildStageView(null, {}), []);
  const players = [
    { id: 0, name: "ルナ", roleKey: "apprenticeSeer", alive: true },
    { id: 1, name: "ミオ", roleKey: "fakeGirl", alive: false },
  ];
  const before = JSON.stringify(players);
  Logic.buildStageView(players);
  assert.equal(JSON.stringify(players), before);
});

test("buildStageView：playerId を渡すと自分の歩行者だけ ▼ マーカーと me クラスが付く", () => {
  const players = [
    { id: 0, name: "ルナ", roleKey: "apprenticeSeer", alive: true },
    { id: 1, name: "ミオ", roleKey: "fakeGirl", alive: true },
    { id: 2, name: "ユイ", roleKey: "mimic", alive: false },
  ];
  const views = Logic.buildStageView(players, { playerId: 1 });
  assert.equal(views.length, 2, "脱落者は出ない（従来どおり）");
  assert.equal(views[0].isMe, false);
  assert.ok(views[0].html.includes('class="walker"'), views[0].html);
  assert.ok(!views[0].html.includes("wme"), "他人の歩行者にマーカーは出ない");
  assert.equal(views[1].isMe, true);
  assert.ok(views[1].html.includes('class="walker me"'), views[1].html);
  assert.ok(views[1].html.includes(`<span class="wme" aria-hidden="true">▼</span>`), views[1].html);
  // playerId が null なら誰にも付かない（パス＆プレイ）。
  const pnpViews = Logic.buildStageView(players, { playerId: null });
  assert.ok(pnpViews.every(v => v.isMe === false));
  assert.ok(!pnpViews.some(v => v.html.includes("wme")));
});

test("buildDrawView：夜のソロは夜行動ボタンだけが出て、他は隠れる", () => {
  const state = {
    day: 2, phase: "night", mode: "solo", playerId: 0,
    players: [{ id: 0, name: "ルナ", roleKey: "apprenticeSeer", alive: true, mouseUsed: false }],
    pnpNightInputPending: null, pnpVoteInputPending: null,
  };
  const view = Logic.buildDrawView(state);
  assert.equal(view.dayText, "2");
  assert.equal(view.phaseText, "夜行動");
  assert.equal(view.roleCardHidden, false);
  assert.deepEqual(view.actionBtn, { text: "夜行動を実行", hidden: false });
  assert.deepEqual(view.voteBtn, { text: "投票する", hidden: true });
  assert.deepEqual(view.nextBtn, { hidden: true });
  assert.deepEqual(view.mouseBtn, { hidden: true });
  assert.deepEqual(view.pnpBanner, { hidden: true });
});

test("buildDrawView：朝・議論は次へボタンが出て、投票は投票ボタンが出る", () => {
  const base = {
    day: 1, mode: "solo", playerId: 0,
    players: [{ id: 0, name: "ルナ", roleKey: "apprenticeSeer", alive: true, mouseUsed: false }],
    pnpNightInputPending: null, pnpVoteInputPending: null,
  };
  const morning = Logic.buildDrawView({ ...base, phase: "morning" });
  assert.equal(morning.phaseText, "朝の報告");
  assert.deepEqual(morning.nextBtn, { hidden: false });
  assert.deepEqual(morning.actionBtn, { text: "報告を読む", hidden: true });
  const discussion = Logic.buildDrawView({ ...base, phase: "discussion" });
  assert.equal(discussion.phaseText, "昼の議論");
  assert.deepEqual(discussion.nextBtn, { hidden: false });
  const vote = Logic.buildDrawView({ ...base, phase: "vote" });
  assert.equal(vote.phaseText, "投票");
  assert.deepEqual(vote.voteBtn, { text: "投票する", hidden: false });
  assert.deepEqual(vote.nextBtn, { hidden: true });
  const end = Logic.buildDrawView({ ...base, phase: "end" });
  assert.equal(end.phaseText, "勝敗");
  assert.deepEqual(end.actionBtn, { text: "-", hidden: true });
  assert.deepEqual(end.voteBtn, { text: "投票する", hidden: true });
  assert.deepEqual(end.nextBtn, { hidden: true });
});

test("buildDrawView：議論でマウス未使用の自分だけマウスボタンが出る", () => {
  const mouse = { id: 0, name: "ルナ", roleKey: "mouse", alive: true, mouseUsed: false };
  const base = {
    day: 1, phase: "discussion", mode: "solo", playerId: 0,
    pnpNightInputPending: null, pnpVoteInputPending: null,
  };
  assert.deepEqual(Logic.buildDrawView({ ...base, players: [mouse] }).mouseBtn, { hidden: false });
  assert.deepEqual(Logic.buildDrawView({ ...base, players: [{ ...mouse, mouseUsed: true }] }).mouseBtn, { hidden: true }, "使い済みは出ない");
  assert.deepEqual(Logic.buildDrawView({ ...base, players: [{ ...mouse, roleKey: "guardian" }] }).mouseBtn, { hidden: true }, "マウス以外は出ない");
  assert.deepEqual(Logic.buildDrawView({ ...base, mode: "pnp", players: [mouse] }).mouseBtn, { hidden: true }, "パス＆プレイは出ない");
  assert.deepEqual(Logic.buildDrawView({ ...base, phase: "night", players: [mouse] }).mouseBtn, { hidden: true }, "議論以外は出ない");
  // バカがマウスを表示役職にしていても、自分はマウスとして扱われる。
  assert.deepEqual(Logic.buildDrawView({ ...base, players: [{ ...mouse, roleKey: "baka", fakeDisplayRoleKey: "mouse" }] }).mouseBtn, { hidden: false });
});

test("buildDrawView：パス＆プレイは役職カードが隠れ、入力中は専用文言と手番バナーが出る", () => {
  const base = {
    day: 1, mode: "pnp", playerId: 0,
    players: [{ id: 0, name: "ルナ", roleKey: "apprenticeSeer", alive: true, mouseUsed: false }],
    pnpNightInputPending: null, pnpVoteInputPending: null,
  };
  const night = Logic.buildDrawView({ ...base, phase: "night", pnpNightInputPending: 0 });
  assert.equal(night.roleCardHidden, true);
  assert.deepEqual(night.actionBtn, { text: "この対象で決める", hidden: false });
  assert.deepEqual(night.pnpBanner, { hidden: false });
  const vote = Logic.buildDrawView({ ...base, phase: "vote", pnpVoteInputPending: 1 });
  assert.deepEqual(vote.voteBtn, { text: "この相手に投票する", hidden: false });
  assert.deepEqual(vote.pnpBanner, { hidden: false });
  const idle = Logic.buildDrawView({ ...base, phase: "discussion" });
  assert.equal(idle.roleCardHidden, true);
  assert.deepEqual(idle.pnpBanner, { hidden: true }, "入力中でなければバナーは出ない");
});

test("buildDrawView：state がないときはすべて非表示の表示を返す", () => {
  const view = Logic.buildDrawView(null);
  assert.equal(view.dayText, "");
  assert.equal(view.phaseText, "");
  assert.deepEqual(view.actionBtn, { text: "実行", hidden: true });
  assert.deepEqual(view.voteBtn, { text: "投票する", hidden: true });
  assert.deepEqual(view.nextBtn, { hidden: true });
  assert.deepEqual(view.mouseBtn, { hidden: true });
  assert.deepEqual(view.pnpBanner, { hidden: true });
});

test("ブラウザ側の draw は共有モジュールの buildStageView・buildDrawView と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const checkDraw = (label) => {
    FB.draw();
    const view = Logic.buildDrawView(s);
    assert.equal(elements.get("dayText").textContent, view.dayText, `${label}：日数`);
    assert.equal(elements.get("phaseText").textContent, view.phaseText, `${label}：フェーズ`);
    assert.equal(elements.get("inGameRoleCard").classList.contains("hidden"), view.roleCardHidden, `${label}：役職カード`);
    assert.equal(elements.get("actionBtn").textContent, view.actionBtn.text, `${label}：夜行動ボタン文言`);
    assert.equal(elements.get("actionBtn").classList.contains("hidden"), view.actionBtn.hidden, `${label}：夜行動ボタン表示`);
    assert.equal(elements.get("voteBtn").textContent, view.voteBtn.text, `${label}：投票ボタン文言`);
    assert.equal(elements.get("voteBtn").classList.contains("hidden"), view.voteBtn.hidden, `${label}：投票ボタン表示`);
    assert.equal(elements.get("nextBtn").classList.contains("hidden"), view.nextBtn.hidden, `${label}：次へボタン`);
    assert.equal(elements.get("mouseBtn").classList.contains("hidden"), view.mouseBtn.hidden, `${label}：マウスボタン`);
    assert.equal(elements.get("pnpTurnBanner").classList.contains("hidden"), view.pnpBanner.hidden, `${label}：手番バナー`);
    assert.equal(
      elements.get("stage").innerHTML,
      Logic.buildStageView(s.players, { playerId: s.mode === "pnp" ? null : s.playerId }).map(w => w.html).join(""),
      `${label}：ステージ歩行者`
    );
    // 別レルムのオブジェクトは JSON で比べる（PR #80 の教訓と同じ）。
    assert.equal(
      JSON.stringify(FB.buildDrawViewLogic(s)),
      JSON.stringify(view),
      `${label}：ハーネス経由の buildDrawView とも同一`
    );
    assert.equal(
      JSON.stringify(FB.buildStageViewLogic(s.players)),
      JSON.stringify(Logic.buildStageView(s.players)),
      `${label}：ハーネス経由の buildStageView とも同一`
    );
  };
  checkDraw("初期状態（夜）");
  // 議論フェーズでマウス未使用の自分ならマウスボタンが出る。
  s.phase = "discussion";
  s.players[0].roleKey = "mouse";
  s.players[0].mouseUsed = false;
  s.playerId = 0;
  checkDraw("議論・マウス未使用");
  // 投票フェーズ。
  s.phase = "vote";
  checkDraw("投票");
  // パス＆プレイの夜入力中。
  s.mode = "pnp";
  s.phase = "night";
  s.pnpNightInputPending = 0;
  checkDraw("パス＆プレイ・夜入力中");
  // 脱落者がいると歩行者から消える。
  s.players[1].alive = false;
  checkDraw("脱落者あり");
});

test("ROLES：全役職に簡単な説明 shortDesc がある（40字以内）", () => {
  for (const [key, role] of Object.entries(Logic.ROLES)) {
    assert.ok(role.shortDesc, `${key} に shortDesc がある`);
    assert.ok(role.shortDesc.length <= 40, `${key} の shortDesc が短い: ${role.shortDesc}`);
    assert.notEqual(role.shortDesc, role.desc, `${key} の shortDesc は desc の流用ではない`);
  }
});

test("roleIconButtonHtml：陣営カラーのクラスと説明ボタンを返し、未知のキーは空文字", () => {
  const seer = Logic.roleIconButtonHtml("apprenticeSeer");
  assert.ok(seer.includes('class="role-icon-btn faction-innocent"'), seer);
  assert.ok(seer.includes('data-role-info="apprenticeSeer"'), seer);
  assert.ok(seer.includes('aria-label="見習い占い師の簡単な説明を見る"'), seer);
  assert.ok(seer.includes(`>${Logic.ROLES.apprenticeSeer.icon}</button>`), seer);
  assert.ok(Logic.roleIconButtonHtml("fakeGirl").includes("faction-impostor"));
  assert.ok(Logic.roleIconButtonHtml("bomber").includes("faction-neutral"));
  // カード用に aria-label を差し替えられる（役職名テキストを出さないため）。
  const card = Logic.roleIconButtonHtml("guardian", { ariaLabel: "役職の簡単な説明を見る" });
  assert.ok(card.includes('aria-label="役職の簡単な説明を見る"'), card);
  assert.ok(!card.includes("守り手"), card);
  assert.equal(Logic.roleIconButtonHtml("no-such-role"), "");
  assert.equal(Logic.roleIconButtonHtml(undefined), "");
});

test("buildRoleCardView：roleKey・roleName・iconButtonHtml を返し、バカは表示役職になる", () => {
  const players = [{ id: 0, name: "ルナ", roleKey: "baka", fakeDisplayRoleKey: "guardian" }];
  const view = Logic.buildRoleCardView(players, 0, { phase: "night" });
  assert.equal(view.roleKey, "guardian");
  assert.equal(view.roleName, "守り手");
  assert.equal(view.iconButtonHtml, Logic.roleIconButtonHtml("guardian"));
  assert.ok(!JSON.stringify(view).includes("バカ"), "バカの文言が出ない");
});

test("normalizeSettings：有効な値はそのまま、不正・欠け・null は既定値に戻る", () => {
  const valid = { fakeCount: "1", bomber: "on", sound: "off", difficulty: "hard", bgm: "on", mode: "pnp", humanCount: "5", discussTimer: "120" };
  assert.deepEqual(Logic.normalizeSettings(valid), valid);
  assert.deepEqual(Logic.normalizeSettings(null), Logic.DEFAULT_SETTINGS);
  assert.deepEqual(Logic.normalizeSettings(undefined), Logic.DEFAULT_SETTINGS);
  assert.deepEqual(Logic.normalizeSettings("not-an-object"), Logic.DEFAULT_SETTINGS);
  assert.deepEqual(Logic.normalizeSettings(42), Logic.DEFAULT_SETTINGS);
  // 許容外の値はそのキーだけ既定値に戻る（有効な値は残る）。
  const bad = { fakeCount: "3", bomber: "maybe", sound: "off", difficulty: "extreme", bgm: "on", mode: "party", humanCount: "9", discussTimer: "90" };
  assert.deepEqual(Logic.normalizeSettings(bad), { ...Logic.DEFAULT_SETTINGS, sound: "off", bgm: "on" });
  // キーが欠けた古い設定はそのキーだけ既定値（後方互換）。
  assert.deepEqual(Logic.normalizeSettings({ mode: "pnp" }), { ...Logic.DEFAULT_SETTINGS, mode: "pnp" });
  assert.deepEqual(Logic.normalizeSettings({}), Logic.DEFAULT_SETTINGS);
  // 余分なキーは無視される。
  assert.deepEqual(Logic.normalizeSettings({ ...valid, extra: "x" }), valid);
});

test("normalizeSettings：入力を変更しない（純粋関数）", () => {
  const parsed = { fakeCount: "3", mode: "pnp", humanCount: "9" };
  const before = JSON.stringify(parsed);
  Logic.normalizeSettings(parsed);
  assert.equal(JSON.stringify(parsed), before);
});

test("buildSettingsView：ソロは2行とも隠れ、選択中のボタンだけ active", () => {
  const settings = { ...Logic.DEFAULT_SETTINGS, difficulty: "hard", sound: "off" };
  const segments = [
    { key: "difficulty", values: ["easy", "normal", "hard"] },
    { key: "sound", values: ["on", "off"] },
    { key: "mode", values: ["solo", "pnp"] },
  ];
  const view = Logic.buildSettingsView(settings, segments);
  assert.equal(view.humanCountHidden, true);
  assert.equal(view.discussTimerHidden, true);
  assert.deepEqual(view.segments[0].buttons, [
    { value: "easy", active: false, ariaPressed: "false" },
    { value: "normal", active: false, ariaPressed: "false" },
    { value: "hard", active: true, ariaPressed: "true" },
  ]);
  assert.deepEqual(view.segments[1].buttons, [
    { value: "on", active: false, ariaPressed: "false" },
    { value: "off", active: true, ariaPressed: "true" },
  ]);
  assert.deepEqual(view.segments[2].buttons[0], { value: "solo", active: true, ariaPressed: "true" });
});

test("buildSettingsView：パス＆プレイは2行とも表示され、許容外の値はどれも active にならない", () => {
  const settings = { ...Logic.DEFAULT_SETTINGS, mode: "pnp", humanCount: "5" };
  const view = Logic.buildSettingsView(settings, [{ key: "humanCount", values: ["2", "3", "4", "5"] }]);
  assert.equal(view.humanCountHidden, false);
  assert.equal(view.discussTimerHidden, false);
  assert.equal(view.segments[0].buttons[3].active, true);
  // 許容外の mode は既定値 solo に直るので、pnp 側は active にならない。
  const bad = Logic.buildSettingsView({ ...Logic.DEFAULT_SETTINGS, mode: "party" }, [{ key: "mode", values: ["solo", "pnp"] }]);
  assert.equal(bad.humanCountHidden, true);
  assert.deepEqual(bad.segments[0].buttons.map(b => b.active), [true, false]);
});

test("buildSettingsView：segments が空・null でも行の表示有無だけ返し、入力を変更しない", () => {
  assert.deepEqual(Logic.buildSettingsView(Logic.DEFAULT_SETTINGS, []), { segments: [], humanCountHidden: true, discussTimerHidden: true });
  assert.deepEqual(Logic.buildSettingsView({ ...Logic.DEFAULT_SETTINGS, mode: "pnp" }, null), { segments: [], humanCountHidden: false, discussTimerHidden: false });
  const segments = [{ key: "difficulty", values: ["easy", "normal"] }];
  const before = JSON.stringify(segments);
  Logic.buildSettingsView(Logic.DEFAULT_SETTINGS, segments);
  assert.equal(JSON.stringify(segments), before);
});

test("ブラウザ側の paintSettings は共有モジュールの buildSettingsView と同一に描く", () => {
  const { FB, sandbox, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", difficulty: "hard", sound: "off" } });
  // paintSettings が読む .seg をスタブで用意する（静的 HTML のボタン相当）。
  const mkBtn = (value) => ({
    dataset: { value },
    _active: false,
    classList: {
      toggle(cls, on) { if (cls === "active") this._owner._active = !!on; },
      add() {}, remove() {}, contains(cls) { return cls === "active" ? this._owner._active : false; },
    },
    _attrs: {},
    setAttribute(k, v) { this._attrs[k] = String(v); },
    getAttribute(k) { return this._attrs[k] ?? null; },
  });
  const defs = [
    { key: "difficulty", values: ["easy", "normal", "hard"] },
    { key: "sound", values: ["on", "off"] },
    { key: "mode", values: ["solo", "pnp"] },
  ];
  const segs = defs.map(def => {
    const seg = { dataset: { setting: def.key }, buttons: def.values.map(mkBtn) };
    seg.buttons.forEach(b => { b.classList._owner = b; });
    seg.querySelectorAll = () => seg.buttons;
    return seg;
  });
  sandbox.document.querySelectorAll = (sel) => (sel === ".seg" ? segs : []);
  FB.paintSettings();
  const view = Logic.buildSettingsView(FB.gameSettings, defs);
  assert.equal(JSON.stringify(FB.buildSettingsViewLogic(FB.gameSettings, defs)), JSON.stringify(view), "ハーネス経由の buildSettingsView とも同一");
  view.segments.forEach((segView, i) => {
    segView.buttons.forEach((btn, j) => {
      assert.equal(segs[i].buttons[j].classList.contains("active"), btn.active, `${segView.key}=${btn.value} の active`);
      assert.equal(segs[i].buttons[j].getAttribute("aria-pressed"), btn.ariaPressed, `${segView.key}=${btn.value} の aria-pressed`);
    });
  });
  assert.equal(elements.get("humanCountRow").classList.contains("hidden"), view.humanCountHidden, "参加人数の行");
  assert.equal(elements.get("discussTimerRow").classList.contains("hidden"), view.discussTimerHidden, "議論タイマーの行");
});

test("buildRoleInfoView：守り手はアイコン・名前・陣営・チップのクラス・短い説明を返す", () => {
  const view = Logic.buildRoleInfoView("guardian");
  assert.equal(view.icon, "🛡️");
  assert.equal(view.name, "守り手");
  assert.equal(view.faction, "イノセント");
  assert.equal(view.factionChipClass, "faction-chip pure");
  assert.equal(view.desc, Logic.ROLES.guardian.shortDesc);
});

test("buildRoleInfoView：陣営ごとにチップのクラスが変わる", () => {
  assert.equal(Logic.buildRoleInfoView("fakeGirl").factionChipClass, "faction-chip fake");
  assert.equal(Logic.buildRoleInfoView("fakeGirl").faction, "インポスター");
  assert.equal(Logic.buildRoleInfoView("bomber").factionChipClass, "faction-chip neutral");
  assert.equal(Logic.buildRoleInfoView("bomber").faction, "ニュートラル");
});

test("buildRoleInfoView：全14役職で表示データが揃い、未知のキー・null は null", () => {
  for (const key of Object.keys(Logic.ROLES)) {
    const view = Logic.buildRoleInfoView(key);
    assert.ok(view, `${key} の表示データがある`);
    for (const field of ["icon", "name", "faction", "factionChipClass", "desc"]) {
      assert.equal(typeof view[field], "string", `${key}.${field} は文字列`);
      assert.ok(view[field].length > 0, `${key}.${field} は空でない`);
    }
    assert.ok(view.factionChipClass.startsWith("faction-chip "), `${key} のチップは faction-chip 付き`);
  }
  assert.equal(Logic.buildRoleInfoView("no-such-role"), null);
  assert.equal(Logic.buildRoleInfoView(null), null);
  assert.equal(Logic.buildRoleInfoView(undefined), null);
});

test("buildRoleInfoView：ROLES を変更しない（純粋関数）", () => {
  const before = JSON.stringify(Logic.ROLES);
  Logic.buildRoleInfoView("guardian");
  Logic.buildRoleInfoView("bomber");
  Logic.buildRoleInfoView("no-such-role");
  assert.equal(JSON.stringify(Logic.ROLES), before, "ROLES は不変");
});

test("ブラウザ側の showRoleInfo は共有モジュールの buildRoleInfoView と同一に描く", () => {
  const { FB, elements } = loadGame();
  for (const key of ["guardian", "fakeGirl", "bomber", "baka"]) {
    const view = Logic.buildRoleInfoView(key);
    assert.equal(JSON.stringify(FB.buildRoleInfoViewLogic(key)), JSON.stringify(view), `ハーネス経由の buildRoleInfoView とも同一 (${key})`);
    FB.showRoleInfo(key);
    assert.ok(!elements.get("roleInfoBackdrop").classList.contains("hidden"), `${key} で開く`);
    assert.equal(elements.get("roleInfoIcon").textContent, view.icon, `${key} のアイコン`);
    assert.equal(elements.get("roleInfoName").textContent, view.name, `${key} の名前`);
    assert.equal(elements.get("roleInfoFactionChip").textContent, view.faction, `${key} の陣営`);
    assert.equal(elements.get("roleInfoFactionChip").className, view.factionChipClass, `${key} のチップのクラス`);
    assert.equal(elements.get("roleInfoDesc").textContent, view.desc, `${key} の説明`);
    FB.closeRoleInfo();
    assert.ok(elements.get("roleInfoBackdrop").classList.contains("hidden"), `${key} で閉じる`);
  }
  // 未知のキーは何も変えない（直前の表示が残る）。
  FB.showRoleInfo("guardian");
  FB.showRoleInfo("no-such-role");
  assert.equal(elements.get("roleInfoName").textContent, "守り手");
  FB.closeRoleInfo();
});

test("normalizeLogFold：有効な値はそのまま、不正・欠け・null は既定値に戻る", () => {
  const valid = { dialogue: false, action: true };
  assert.deepEqual(Logic.normalizeLogFold(valid), valid);
  assert.deepEqual(Logic.normalizeLogFold(null), Logic.LOG_FOLD_DEFAULT);
  assert.deepEqual(Logic.normalizeLogFold(undefined), Logic.LOG_FOLD_DEFAULT);
  assert.deepEqual(Logic.normalizeLogFold("not-an-object"), Logic.LOG_FOLD_DEFAULT);
  assert.deepEqual(Logic.normalizeLogFold(42), Logic.LOG_FOLD_DEFAULT);
  // 片方だけ不正な値は、その片方だけ既定（たたむ）に戻る。
  assert.deepEqual(Logic.normalizeLogFold({ dialogue: false, action: "yes" }),
    { dialogue: false, action: true });
  assert.deepEqual(Logic.normalizeLogFold({ dialogue: "no" }),
    { dialogue: true, action: true });
  assert.deepEqual(Logic.normalizeLogFold({}), Logic.LOG_FOLD_DEFAULT);
  assert.deepEqual(Logic.normalizeLogFold({ ...valid, extra: true }), valid);
});

test("normalizeLogFold：入力を変更しない（純粋関数）", () => {
  const parsed = { dialogue: false, action: "yes" };
  const before = JSON.stringify(parsed);
  Logic.normalizeLogFold(parsed);
  assert.equal(JSON.stringify(parsed), before);
});

test("buildLogFoldView：既定は両方たたみ、開いた方は文言と aria が変わる", () => {
  const view = Logic.buildLogFoldView(Logic.LOG_FOLD_DEFAULT);
  assert.deepEqual(view, [
    { key: "dialogue", logId: "dialogueLog", toggleId: "dialogueLogToggle", hidden: true, ariaExpanded: "false", text: "▸ セリフ" },
    { key: "action", logId: "actionLog", toggleId: "actionLogToggle", hidden: true, ariaExpanded: "false", text: "▸ 行動ログ" },
  ]);
  const opened = Logic.buildLogFoldView({ dialogue: false, action: true });
  assert.equal(opened[0].hidden, false);
  assert.equal(opened[0].ariaExpanded, "true");
  assert.equal(opened[0].text, "▾ セリフ");
  assert.equal(opened[1].hidden, true);
  assert.equal(opened[1].text, "▸ 行動ログ");
});

test("buildLogFoldView：不正な値・null でも既定で表示し、入力を変更しない", () => {
  const view = Logic.buildLogFoldView({ dialogue: false, action: "yes" });
  assert.equal(view[0].hidden, false);
  assert.equal(view[1].hidden, true);
  assert.deepEqual(Logic.buildLogFoldView(null), Logic.buildLogFoldView(Logic.LOG_FOLD_DEFAULT));
  const input = { dialogue: false, action: true };
  const before = JSON.stringify(input);
  Logic.buildLogFoldView(input);
  assert.equal(JSON.stringify(input), before);
});

test("withLogFolded：指定したキーだけ変え、未知のキー・非オブジェクトは null", () => {
  const base = { dialogue: true, action: true };
  assert.deepEqual(Logic.withLogFolded(base, "dialogue", false), { dialogue: false, action: true });
  assert.deepEqual(Logic.withLogFolded(base, "action", 1), { dialogue: true, action: true });
  assert.deepEqual(Logic.withLogFolded({ dialogue: false, action: "yes" }, "action", false),
    { dialogue: false, action: false });
  assert.equal(Logic.withLogFolded(base, "no-such-key", false), null);
  assert.equal(Logic.withLogFolded(null, "dialogue", false), null);
  assert.equal(Logic.withLogFolded("not-an-object", "dialogue", false), null);
  const before = JSON.stringify(base);
  Logic.withLogFolded(base, "dialogue", false);
  assert.equal(JSON.stringify(base), before, "入力は変更しない");
});

test("ブラウザ側の applyLogFold／setLogFolded は共有モジュールの buildLogFoldView／withLogFolded と同一に描く", () => {
  const { FB, elements, localStorage } = loadGame({ seedSettings: BASE_SETTINGS });
  const assertMatchesView = () => {
    const view = Logic.buildLogFoldView(FB.logFold);
    assert.equal(JSON.stringify(FB.buildLogFoldViewLogic(FB.logFold)), JSON.stringify(view), "ハーネス経由の buildLogFoldView とも同一");
    for (const item of view) {
      assert.equal(elements.get(item.logId).classList.contains("hidden"), item.hidden, `${item.key} の表示`);
      assert.equal(elements.get(item.toggleId).getAttribute("aria-expanded"), item.ariaExpanded, `${item.key} の aria-expanded`);
      assert.equal(elements.get(item.toggleId).textContent, item.text, `${item.key} のボタン文言`);
    }
  };
  // 既定（両方たたみ）→ セリフだけ開く → 未知のキーは何もしない。
  assertMatchesView();
  FB.setLogFolded("dialogue", false);
  assert.equal(JSON.stringify(FB.logFold), JSON.stringify(Logic.withLogFolded(Logic.LOG_FOLD_DEFAULT, "dialogue", false)));
  assert.equal(localStorage.getItem(FB.LOG_FOLD_KEY), JSON.stringify({ dialogue: false, action: true }));
  assertMatchesView();
  FB.toggleLogFold("action");
  assert.equal(JSON.stringify(FB.logFold), JSON.stringify({ dialogue: false, action: false }));
  assertMatchesView();
  const before = JSON.stringify(FB.logFold);
  FB.setLogFolded("no-such-key", false);
  assert.equal(JSON.stringify(FB.logFold), before, "未知のキーでは状態も保存も変わらない");
  assert.equal(localStorage.getItem(FB.LOG_FOLD_KEY), JSON.stringify({ dialogue: false, action: false }));
  assertMatchesView();
});

test("buildAchievementsView：0戦なら11個すべて未達成で 🔒", () => {
  const view = Logic.buildAchievementsView({ games: 0, wins: 0, byRole: {}, factionWins: {}, steals: 0, streak: 0, bestStreak: 0 });
  assert.equal(view.length, 11);
  assert.deepEqual(view.map(v => v.id), Logic.ACHIEVEMENT_DEFS.map(d => d.id));
  for (const v of view) {
    assert.equal(v.unlocked, false, `${v.id} は未達成`);
    assert.equal(v.icon, "🔒");
  }
});

test("buildAchievementsView：勝利数・陣営勝利・横取り・連勝・試合数で解除される", () => {
  const stats = {
    games: 50, wins: 30,
    byRole: {
      guardian: { games: 5, wins: 2 }, apprenticeSeer: { games: 3, wins: 1 },
      tracker: { games: 2, wins: 1 }, police: { games: 2, wins: 1 }, lookout: { games: 1, wins: 1 },
    },
    factionWins: { "イノセント": 20, "インポスター": 5, "ニュートラル": 2 },
    steals: 1, streak: 3, bestStreak: 4,
  };
  const view = Logic.buildAchievementsView(stats);
  const byId = Object.fromEntries(view.map(v => [v.id, v]));
  for (const id of ["first-win", "wins10", "wins30", "pure-win", "fake-win", "bomber-win", "steal", "roles5", "streak3", "games50"]) {
    assert.equal(byId[id].unlocked, true, `${id} は達成`);
    assert.equal(byId[id].icon, "🏅");
  }
  assert.equal(byId["roles10"].unlocked, false, "5役勝利では十役の達人は未達成");
});

test("isAchievementUnlocked：しきい値の境界と欠けた戦績・未知の id", () => {
  assert.equal(Logic.isAchievementUnlocked("wins10", { wins: 9 }), false);
  assert.equal(Logic.isAchievementUnlocked("wins10", { wins: 10 }), true);
  assert.equal(Logic.isAchievementUnlocked("roles5", {
    byRole: { a: { wins: 1 }, b: { wins: 1 }, c: { wins: 1 }, d: { wins: 1 } },
  }), false);
  assert.equal(Logic.isAchievementUnlocked("pure-win", {}), false);
  assert.equal(Logic.isAchievementUnlocked("pure-win", null), false);
  assert.equal(Logic.isAchievementUnlocked("no-such-achievement", { wins: 99 }), false);
  assert.equal(Logic.isAchievementUnlocked("first-win", undefined), false);
});

test("buildAchievementsView：入力の stats と ACHIEVEMENT_DEFS を変更しない（純粋関数）", () => {
  const stats = {
    games: 10, wins: 5, byRole: { guardian: { games: 5, wins: 2 } },
    factionWins: { "イノセント": 5 }, steals: 0, streak: 2, bestStreak: 2,
  };
  const beforeStats = JSON.stringify(stats);
  const beforeDefs = JSON.stringify(Logic.ACHIEVEMENT_DEFS);
  Logic.buildAchievementsView(stats);
  assert.equal(JSON.stringify(stats), beforeStats);
  assert.equal(JSON.stringify(Logic.ACHIEVEMENT_DEFS), beforeDefs);
});

test("ブラウザ側の renderAchievements は共有モジュールの buildAchievementsView と同一に描く", () => {
  const seeded = {
    games: 12, wins: 10,
    byRole: {
      guardian: { games: 5, wins: 2 }, apprenticeSeer: { games: 3, wins: 1 },
      tracker: { games: 2, wins: 1 }, police: { games: 1, wins: 1 }, lookout: { games: 1, wins: 1 },
    },
    factionWins: { "イノセント": 8, "インポスター": 2 }, steals: 1, streak: 3, bestStreak: 3,
  };
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS, seedStorage: { fakeBloomStats: JSON.stringify(seeded) } });
  const view = Logic.buildAchievementsView(seeded);
  assert.equal(JSON.stringify(FB.buildAchievementsViewLogic(seeded)), JSON.stringify(view), "ハーネス経由の buildAchievementsView とも同一");
  FB.renderAchievements();
  const expected = view.map(a =>
    `<span class="stats-chip ${a.unlocked ? "" : "locked"}" title="${a.hint}">${a.icon} ${a.name}</span>`).join("");
  assert.equal(elements.get("achvList").innerHTML, expected);
  // 0戦（未シード）の読み込みでは全チップが 🔒 になる。
  const fresh = loadGame({ seedSettings: BASE_SETTINGS });
  fresh.FB.renderAchievements();
  assert.ok(fresh.elements.get("achvList").innerHTML.includes("🔒 初勝利"));
  assert.ok(!fresh.elements.get("achvList").innerHTML.includes("🏅"));
});

test("buildCutinItem：既定値（sub 空・kind phase・顔とモーションなし）", () => {
  assert.equal(JSON.stringify(Logic.buildCutinItem("タイトル")),
    JSON.stringify({ title: "タイトル", sub: "", kind: "phase", charId: null, targetCharId: null, motion: null }));
  assert.equal(JSON.stringify(Logic.buildCutinItem("タイトル", "サブ", null, null)),
    JSON.stringify({ title: "タイトル", sub: "サブ", kind: "phase", charId: null, targetCharId: null, motion: null }));
});

test("buildCutinItem：指定した値はそのまま残り、不正な値は null になる", () => {
  const full = Logic.buildCutinItem("🌙 夜の襲撃", "ルナ が倒れた…", "attack",
    { charId: 0, targetCharId: 1, motion: "peek" });
  assert.equal(JSON.stringify(full),
    JSON.stringify({ title: "🌙 夜の襲撃", sub: "ルナ が倒れた…", kind: "attack", charId: 0, targetCharId: 1, motion: "peek" }));
  // 表にない kind（"win" など）はそのまま通す（ブラウザ側と同じ）。
  assert.equal(Logic.buildCutinItem("勝利", "", "win").kind, "win");
  assert.equal(Logic.buildCutinItem("タイトル", "", "").kind, "phase");
  const weird = Logic.buildCutinItem("タイトル", "", "bomb", { charId: "3", targetCharId: 1.5, motion: 123 });
  assert.equal(weird.charId, null, "文字列の charId は null");
  assert.equal(weird.targetCharId, 1.5, "数値なら小数は通る（ブラウザ側と同じ）");
  assert.equal(weird.motion, null, "数値の motion は null");
  const noOpts = Logic.buildCutinItem("タイトル", "", "phase", "not-an-object");
  assert.equal(noOpts.charId, null);
  assert.equal(noOpts.motion, null);
});

test("cutinSfxFor：種類ごとの効果音と、表にない種類は pop", () => {
  assert.equal(Logic.cutinSfxFor("attack"), "attack");
  assert.equal(Logic.cutinSfxFor("bomb"), "bomb");
  assert.equal(Logic.cutinSfxFor("protect"), "protect");
  assert.equal(Logic.cutinSfxFor("info"), "pop");
  assert.equal(Logic.cutinSfxFor("phase"), "phase");
  assert.equal(Logic.cutinSfxFor("win"), "pop", "表にない種類は pop");
  assert.equal(Logic.cutinSfxFor(undefined), "pop");
  assert.equal(Logic.cutinSfxFor(null), "pop");
});

test("buildCutinFaceHtml：顔なしは空文字、画像あり・なし・小さい表示", () => {
  assert.equal(Logic.buildCutinFaceHtml(null, undefined, "luna", false), "");
  assert.equal(Logic.buildCutinFaceHtml(undefined, undefined, "luna", false), "");
  const player = { icon: "🌸", name: "ルナ" };
  const withImg = Logic.buildCutinFaceHtml(player, "data:image/webp;base64,AAA", "luna", false);
  assert.ok(withImg.includes('class="cutin-face"'), "小さい表示でなければ cutin-face だけ");
  assert.ok(!withImg.includes("cutin-face small"));
  assert.ok(withImg.includes("<span>🌸</span>"));
  assert.ok(withImg.includes('data-icon-slug="luna"'));
  assert.ok(withImg.includes('src="data:image/webp;base64,AAA"'));
  assert.ok(withImg.includes('alt="ルナ"'));
  const noImg = Logic.buildCutinFaceHtml(player, undefined, "luna", false);
  assert.ok(noImg.includes("<span>🌸</span>"));
  assert.ok(!noImg.includes("<img"), "画像がなければ絵文字だけ");
  const small = Logic.buildCutinFaceHtml(player, undefined, "luna", true);
  assert.ok(small.includes('class="cutin-face small"'), "小さい表示は small 付き");
});

test("buildCutinItem／buildCutinFaceHtml／cutinSfxFor：入力を変更しない（純粋関数）", () => {
  const opts = { charId: 0, targetCharId: 1, motion: "peek" };
  const beforeOpts = JSON.stringify(opts);
  const beforeSfx = JSON.stringify(Logic.CUTIN_SFX);
  Logic.buildCutinItem("タイトル", "サブ", "attack", opts);
  Logic.buildCutinFaceHtml({ icon: "🌸", name: "ルナ" }, "data:image/webp;base64,AAA", "luna", false);
  Logic.cutinSfxFor("bomb");
  assert.equal(JSON.stringify(opts), beforeOpts);
  assert.equal(JSON.stringify(Logic.CUTIN_SFX), beforeSfx);
});

test("buildCutinView：顔なしはタイトル・サブ・種類と振動・効果音だけ", () => {
  const view = Logic.buildCutinView(
    Logic.buildCutinItem("🌙 夜行動", "あなたは静かに夜を過ごした", "phase"), {}, {}, Logic.ICON_SLUGS);
  assert.equal(JSON.stringify(view),
    JSON.stringify({ title: "🌙 夜行動", sub: "あなたは静かに夜を過ごした", kind: "phase", hasChar: false, charHtml: "", motion: "", shake: false, sfx: "phase" }));
  // 表にない kind（"win"）は振動なし・効果音 pop。
  const win = Logic.buildCutinView(Logic.buildCutinItem("勝利", "", "win"), {}, {}, Logic.ICON_SLUGS);
  assert.equal(win.shake, false);
  assert.equal(win.sfx, "pop");
});

test("buildCutinView：顔ありは顔 HTML を合成し、bomb／attack は画面振動あり", () => {
  const players = { 0: { icon: "🌸", name: "ルナ" }, 1: { icon: "🐰", name: "ミオ" } };
  const iconImgs = { luna: "data:image/webp;base64,AAA", mio: "data:image/webp;base64,BBB" };
  const item = Logic.buildCutinItem("🌙 夜の襲撃", "ルナ が倒れた…", "attack", { charId: 0 });
  const view = Logic.buildCutinView(item, players, iconImgs, Logic.ICON_SLUGS);
  assert.equal(view.title, "🌙 夜の襲撃");
  assert.equal(view.sub, "ルナ が倒れた…");
  assert.equal(view.kind, "attack");
  assert.equal(view.hasChar, true);
  assert.equal(view.charHtml, Logic.buildCutinFaceHtml(players[0], iconImgs.luna, "luna", false));
  assert.equal(view.motion, "");
  assert.equal(view.shake, true, "attack は画面振動あり");
  assert.equal(view.sfx, "attack");
  // 自分の夜アクション：自分の顔＋相手の顔（小）、系統モーション付き。
  const own = Logic.buildCutinView(
    Logic.buildCutinItem("🔍 調査", "→ ミオ", "info", { charId: 0, targetCharId: 1, motion: "peek" }),
    players, iconImgs, Logic.ICON_SLUGS);
  assert.equal(own.charHtml,
    Logic.buildCutinFaceHtml(players[0], iconImgs.luna, "luna", false)
    + Logic.buildCutinFaceHtml(players[1], iconImgs.mio, "mio", true));
  assert.equal(own.motion, "peek");
  assert.equal(own.shake, false, "info は画面振動なし");
  assert.equal(own.sfx, "pop");
  const bomb = Logic.buildCutinView(Logic.buildCutinItem("💣 爆弾が爆発！", "", "bomb", { charId: 1 }), players, iconImgs, Logic.ICON_SLUGS);
  assert.equal(bomb.shake, true, "bomb は画面振動あり");
  assert.equal(bomb.sfx, "bomb");
});

test("buildCutinView：item なしは null、存在しないキャラの顔は空文字", () => {
  assert.equal(Logic.buildCutinView(null, {}, {}, Logic.ICON_SLUGS), null);
  assert.equal(Logic.buildCutinView(undefined, {}, {}, Logic.ICON_SLUGS), null);
  const players = { 0: { icon: "🌸", name: "ルナ" } };
  const ghost = Logic.buildCutinView(Logic.buildCutinItem("？", "", "info", { charId: 9 }), players, {}, Logic.ICON_SLUGS);
  assert.equal(ghost.hasChar, true, "charId があれば顔あり扱い（ブラウザ側と同じ）");
  assert.equal(ghost.charHtml, "", "存在しないキャラの顔は空文字");
  const noImgs = Logic.buildCutinView(Logic.buildCutinItem("タイトル", "", "phase", { charId: 0 }), players, undefined, undefined);
  assert.ok(noImgs.charHtml.includes("<span>🌸</span>"), "画像なしでも絵文字だけの顔になる");
});

test("buildCutinView：入力を変更しない（純粋関数）", () => {
  const players = { 0: { icon: "🌸", name: "ルナ" }, 1: { icon: "🐰", name: "ミオ" } };
  const iconImgs = { luna: "data:image/webp;base64,AAA" };
  const item = Logic.buildCutinItem("🌙 夜の襲撃", "ルナ が倒れた…", "attack", { charId: 0, targetCharId: 1, motion: "peek" });
  const beforeItem = JSON.stringify(item);
  const beforePlayers = JSON.stringify(players);
  const beforeImgs = JSON.stringify(iconImgs);
  Logic.buildCutinView(item, players, iconImgs, Logic.ICON_SLUGS);
  assert.equal(JSON.stringify(item), beforeItem);
  assert.equal(JSON.stringify(players), beforePlayers);
  assert.equal(JSON.stringify(iconImgs), beforeImgs);
});

test("ブラウザ側の pumpCutin は共有モジュールの buildCutinView と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  // ハーネスではアイコン画像の fetch が失敗するため ICON_IMGS は空。
  // モジュール側にも同じ空の画像一覧を渡して比べる。
  const viewOf = (item) => Logic.buildCutinView(item, s.players, {}, Logic.ICON_SLUGS);
  // ハーネス経由のモジュール関数とも同一。
  const attackItem = Logic.buildCutinItem("🌙 夜の襲撃", `${s.players[0].name} が倒れた…`, "attack", { charId: 0 });
  assert.equal(JSON.stringify(FB.buildCutinViewLogic(attackItem, s.players, {}, Logic.ICON_SLUGS)),
    JSON.stringify(viewOf(attackItem)));
  // 顔つきカットイン（attack）：タイトル・サブ・種類・顔 HTML がモジュール通り。
  FB.showCutin("🌙 夜の襲撃", `${s.players[0].name} が倒れた…`, "attack", null, { charId: 0 });
  const attackView = viewOf(attackItem);
  assert.equal(elements.get("cutinTitle").textContent, attackView.title);
  assert.equal(elements.get("cutinSub").textContent, attackView.sub);
  assert.equal(elements.get("cutin").dataset.kind, attackView.kind);
  assert.equal(elements.get("cutinChar").innerHTML, attackView.charHtml);
  assert.equal(elements.get("cutinChar").dataset.own, attackView.motion);
  assert.equal(elements.get("cutinChar").classList.contains("hidden"), !attackView.hasChar);
  // 顔なしカットイン（phase）：顔の箱は隠れたまま、モーションは空。
  FB.clearCutins();
  FB.showCutin("🌙 夜行動", "あなたは静かに夜を過ごした", "phase");
  const phaseView = viewOf(Logic.buildCutinItem("🌙 夜行動", "あなたは静かに夜を過ごした", "phase"));
  assert.equal(elements.get("cutinChar").innerHTML, phaseView.charHtml);
  assert.equal(elements.get("cutinChar").dataset.own, phaseView.motion);
  assert.equal(elements.get("cutinChar").classList.contains("hidden"), true);
  // 自分の夜アクション：自分の顔＋相手の顔（小）、系統モーション付き。
  FB.clearCutins();
  FB.showCutin("🔍 調査", `→ ${s.players[1].name}`, "info", null, { charId: 0, targetCharId: 1, motion: "peek" });
  const ownView = viewOf(Logic.buildCutinItem("🔍 調査", `→ ${s.players[1].name}`, "info", { charId: 0, targetCharId: 1, motion: "peek" }));
  assert.equal(elements.get("cutinChar").innerHTML, ownView.charHtml);
  assert.equal(elements.get("cutinChar").dataset.own, ownView.motion);
});

test("ブラウザ側の showCutin／pumpCutin は共有モジュールの buildCutinItem／buildCutinFaceHtml／cutinSfxFor と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  // ハーネス経由のモジュール関数とも同一。
  assert.equal(JSON.stringify(FB.buildCutinItemLogic("タイトル", "サブ", "attack", { charId: 0, targetCharId: 1, motion: "peek" })),
    JSON.stringify(Logic.buildCutinItem("タイトル", "サブ", "attack", { charId: 0, targetCharId: 1, motion: "peek" })));
  assert.equal(FB.cutinSfxForLogic("bomb"), Logic.cutinSfxFor("bomb"));
  assert.equal(FB.buildCutinFaceHtmlLogic(s.players[0], undefined, Logic.ICON_SLUGS[0], false),
    Logic.buildCutinFaceHtml(s.players[0], undefined, Logic.ICON_SLUGS[0], false));
  // 顔つきカットイン：タイトル・サブ・種類・顔の HTML がモジュール通り。
  // （ハーネスではアイコン画像の fetch が失敗するため絵文字だけの顔になる。）
  FB.showCutin("🌙 夜の襲撃", `${s.players[0].name} が倒れた…`, "attack", null, { charId: 0 });
  assert.equal(elements.get("cutinTitle").textContent, "🌙 夜の襲撃");
  assert.equal(elements.get("cutinSub").textContent, `${s.players[0].name} が倒れた…`);
  assert.equal(elements.get("cutin").dataset.kind, "attack");
  assert.equal(elements.get("cutin").classList.contains("hidden"), false);
  assert.equal(elements.get("cutinChar").innerHTML,
    Logic.buildCutinFaceHtml(s.players[0], undefined, Logic.ICON_SLUGS[0], false));
  assert.equal(elements.get("cutinChar").classList.contains("hidden"), false);
  // 表示中にもう1件積むとキューに残り、モジュールの生成結果と同一になる。
  FB.showCutin("🛡️ 襲撃は防がれた！", "誰かが守り切った", "protect");
  assert.equal(FB.cutinQueueLength, 1);
  const queued = { ...FB.cutinQueue[0] };
  delete queued.onShow;
  assert.equal(JSON.stringify(queued),
    JSON.stringify(Logic.buildCutinItem("🛡️ 襲撃は防がれた！", "誰かが守り切った", "protect")));
  // 顔なしカットイン：顔の箱は隠れたまま。
  FB.clearCutins();
  FB.showCutin("🌙 夜行動", "あなたは静かに夜を過ごした", "phase");
  assert.equal(elements.get("cutinChar").innerHTML, "");
  assert.equal(elements.get("cutinChar").classList.contains("hidden"), true);
  assert.equal(elements.get("cutinChar").dataset.own, "");
  // 自分の夜アクション：自分の顔（系統モーション付き）＋相手の顔（小）。
  FB.clearCutins();
  FB.showCutin("🔍 調査", `→ ${s.players[1].name}`, "info", null,
    { charId: 0, targetCharId: 1, motion: "peek" });
  assert.equal(elements.get("cutinChar").innerHTML,
    Logic.buildCutinFaceHtml(s.players[0], undefined, Logic.ICON_SLUGS[0], false)
    + Logic.buildCutinFaceHtml(s.players[1], undefined, Logic.ICON_SLUGS[1], true));
  assert.equal(elements.get("cutinChar").dataset.own, "peek");
});

test("buildSpeechBubbleItem：有効な値はそのまま、発言者なし・空文言は null", () => {
  assert.equal(JSON.stringify(Logic.buildSpeechBubbleItem(0, "怪しいな…")),
    JSON.stringify({ playerId: 0, text: "怪しいな…" }));
  assert.equal(JSON.stringify(Logic.buildSpeechBubbleItem(3, "🐭 ルナ「見たよ」")),
    JSON.stringify({ playerId: 3, text: "🐭 ルナ「見たよ」" }));
  assert.equal(Logic.buildSpeechBubbleItem(null, "セリフ"), null, "発言者なしは null");
  assert.equal(Logic.buildSpeechBubbleItem(undefined, "セリフ"), null);
  assert.equal(Logic.buildSpeechBubbleItem(0, ""), null, "空の文言は null");
  assert.equal(Logic.buildSpeechBubbleItem(0, null), null);
  assert.equal(Logic.buildSpeechBubbleItem(0, undefined), null);
});

test("buildSpeechBubbleView：クラス名 speech-bubble と文言、item なしは null", () => {
  assert.equal(JSON.stringify(Logic.buildSpeechBubbleView({ playerId: 1, text: "怪しいな…" })),
    JSON.stringify({ className: "speech-bubble", text: "怪しいな…" }));
  assert.equal(Logic.buildSpeechBubbleView(null), null);
  assert.equal(Logic.buildSpeechBubbleView(undefined), null);
});

test("pickNextSpeechBubble：空キューは none、議論以外は drop、議論中は先頭を show", () => {
  assert.equal(Logic.pickNextSpeechBubble([], "discussion").action, "none");
  assert.equal(Logic.pickNextSpeechBubble(null, "discussion").action, "none");
  assert.equal(Logic.pickNextSpeechBubble(undefined, "discussion").action, "none");
  const queue = [{ playerId: 0, text: "1件目" }, { playerId: 1, text: "2件目" }];
  assert.equal(Logic.pickNextSpeechBubble(queue, "night").action, "drop", "夜は残りを破棄");
  assert.equal(Logic.pickNextSpeechBubble(queue, "vote").action, "drop");
  assert.equal(Logic.pickNextSpeechBubble(queue, "morning").action, "drop");
  const next = Logic.pickNextSpeechBubble(queue, "discussion");
  assert.equal(next.action, "show");
  assert.equal(JSON.stringify(next.item), JSON.stringify({ playerId: 0, text: "1件目" }));
  assert.equal(queue.length, 2, "先頭を返してもキューは減らない");
});

test("buildSpeechBubbleItem／buildSpeechBubbleView／pickNextSpeechBubble：入力を変更しない（純粋関数）", () => {
  const item = { playerId: 0, text: "怪しいな…" };
  const beforeItem = JSON.stringify(item);
  const queue = [{ playerId: 0, text: "1件目" }, { playerId: 1, text: "2件目" }];
  const beforeQueue = JSON.stringify(queue);
  Logic.buildSpeechBubbleItem(2, "新しいセリフ");
  Logic.buildSpeechBubbleView(item);
  Logic.pickNextSpeechBubble(queue, "discussion");
  Logic.pickNextSpeechBubble(queue, "vote");
  assert.equal(JSON.stringify(item), beforeItem);
  assert.equal(JSON.stringify(queue), beforeQueue);
});

test("SPEECH_BUBBLE_MS は 2200（従来の表示時間と同じ）", () => {
  assert.equal(Logic.SPEECH_BUBBLE_MS, 2200);
});

test("ブラウザ側の enqueueSpeechBubble／showNextSpeechBubble は共有モジュールの吹き出し関数と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  s.phase = "discussion";
  FB.draw();
  // ハーネス経由のモジュール関数とも同一。
  assert.equal(JSON.stringify(FB.buildSpeechBubbleItemLogic(0, "怪しいな…")),
    JSON.stringify(Logic.buildSpeechBubbleItem(0, "怪しいな…")));
  assert.equal(JSON.stringify(FB.buildSpeechBubbleViewLogic({ playerId: 0, text: "怪しいな…" })),
    JSON.stringify(Logic.buildSpeechBubbleView({ playerId: 0, text: "怪しいな…" })));
  assert.equal(JSON.stringify(FB.pickNextSpeechBubbleLogic([{ playerId: 0, text: "1件目" }], "discussion")),
    JSON.stringify(Logic.pickNextSpeechBubble([{ playerId: 0, text: "1件目" }], "discussion")));
  // 有効な enqueue はモジュールの生成結果そのままキューに入り、即座に
  // 発言者のカードへ className・文言ともモジュール通りに出る。
  // 1件目は表示されてキューから外れるので、2件目でキュー内容を確認する。
  FB.enqueueSpeechBubble(0, "怪しいな…");
  FB.enqueueSpeechBubble(1, "2件目だよ");
  assert.equal(JSON.stringify(FB.speechQueue[0]),
    JSON.stringify(Logic.buildSpeechBubbleItem(1, "2件目だよ")));
  const card = elements.get("cards").children.find(
    (c) => c.getAttribute("data-player") === "0");
  const bubble = card.children.find((c) => c.className === "speech-bubble");
  assert.ok(bubble, "発言者のカードに吹き出しがない");
  const view = Logic.buildSpeechBubbleView({ playerId: 0, text: "怪しいな…" });
  assert.equal(bubble.className, view.className);
  assert.equal(bubble.textContent, view.text);
  // 無効な enqueue はキューに入らない（モジュールが null を返す条件と同じ）。
  const queued = FB.speechQueue.length;
  FB.enqueueSpeechBubble(null, "セリフ");
  FB.enqueueSpeechBubble(1, "");
  FB.enqueueSpeechBubble(1, null);
  assert.equal(FB.speechQueue.length, queued);
  // 議論フェーズ以外で enqueue すると残りは破棄される（drop）。
  FB.clearSpeechBubbles();
  s.phase = "night";
  FB.enqueueSpeechBubble(0, "夜のセリフ");
  assert.equal(FB.speechQueue.length, 0, "議論以外ではキューが残らない");
  assert.equal(elements.get("cards").children.flatMap((c) =>
    c.children.filter((x) => x.className === "speech-bubble")).length, 0);
});

test("buildRoleGuideView：14役職がボード順に並び、陣営クラスとボード用説明文が揃う", () => {
  assert.equal(JSON.stringify(Logic.ROLE_GUIDE_ORDER),
    JSON.stringify(["apprenticeSeer", "guardian", "tracker", "police", "lookout", "trapper", "doctor", "mouse", "politician", "villager", "fakeGirl", "mimic", "bomber", "baka"]));
  const view = Logic.buildRoleGuideView();
  assert.equal(view.length, 14);
  assert.equal(JSON.stringify(view.map(t => t.roleKey)), JSON.stringify(Logic.ROLE_GUIDE_ORDER));
  const byKey = Object.fromEntries(view.map(t => [t.roleKey, t]));
  // 陣営クラス：ボマーだけニュートラル、フェイクガール・なりすましがインポスター、残りはイノセント。
  assert.equal(byKey.bomber.factionClass, "faction-neutral");
  assert.equal(byKey.fakeGirl.factionClass, "faction-impostor");
  assert.equal(byKey.mimic.factionClass, "faction-impostor");
  for (const key of Logic.ROLE_GUIDE_ORDER) {
    if (["bomber", "fakeGirl", "mimic"].includes(key)) continue;
    assert.equal(byKey[key].factionClass, "faction-innocent", `${key} はイノセント枠`);
  }
  // ボード用の説明文は旧版の静的な HTML にあった文言そのまま。
  assert.equal(byKey.guardian.desc, "夜に1人を襲撃や爆発から守る。");
  assert.equal(byKey.police.desc, "夜に1人の行動を封じる（襲撃そのものは止められない）。");
  assert.equal(byKey.bomber.desc, "約半分のゲームに登場。爆弾は翌日の夜に爆発。最後の1人になるか、爆弾で2人以上倒して生き残ると勝利。");
  assert.equal(byKey.baka.desc, "本人は別のイノセント役職だと思って行動するが、結果はすべて偽物。本人も自分がバカだとは分からない。実役職は結果画面でのみ公開される。");
  for (const t of view) {
    assert.equal(t.icon, Logic.ROLES[t.roleKey].icon, `${t.roleKey} のアイコン`);
    assert.equal(t.name, Logic.ROLES[t.roleKey].name, `${t.roleKey} の名前`);
    assert.equal(t.faction, Logic.ROLES[t.roleKey].faction, `${t.roleKey} の陣営`);
    assert.equal(t.desc, Logic.ROLES[t.roleKey].guideDesc, `${t.roleKey} の説明は guideDesc`);
    assert.ok(t.iconButtonHtml.includes(`data-role-info="${t.roleKey}"`), `${t.roleKey} のボタン`);
  }
});

test("buildRoleGuideView：タイルの HTML は旧版の静的なものと同一", () => {
  const byKey = Object.fromEntries(Logic.buildRoleGuideView().map(t => [t.roleKey, t]));
  assert.equal(byKey.guardian.tileHtml,
    `<li class="role-tile faction-innocent"><button type="button" class="role-icon-btn faction-innocent" data-role-info="guardian" aria-label="守り手の簡単な説明を見る">🛡️</button><div><strong>守り手</strong><span class="role-faction">イノセント</span>夜に1人を襲撃や爆発から守る。</div></li>`);
  assert.equal(byKey.bomber.tileHtml,
    `<li class="role-tile faction-neutral"><button type="button" class="role-icon-btn faction-neutral" data-role-info="bomber" aria-label="ボマーの簡単な説明を見る">💣</button><div><strong>ボマー</strong><span class="role-faction">ニュートラル</span>約半分のゲームに登場。爆弾は翌日の夜に爆発。最後の1人になるか、爆弾で2人以上倒して生き残ると勝利。</div></li>`);
  // 全タイルが同じ形で、役職名・陣営・説明文を漏れなく含む。
  for (const t of Logic.buildRoleGuideView()) {
    assert.ok(t.tileHtml.startsWith(`<li class="role-tile ${t.factionClass}">`), `${t.roleKey} の開始タグ`);
    assert.ok(t.tileHtml.endsWith("</div></li>"), `${t.roleKey} の終了タグ`);
    assert.ok(t.tileHtml.includes(`<strong>${t.name}</strong>`), `${t.roleKey} の名前`);
    assert.ok(t.tileHtml.includes(`<span class="role-faction">${t.faction}</span>`), `${t.roleKey} の陣営`);
    assert.ok(t.tileHtml.includes(t.desc), `${t.roleKey} の説明文`);
  }
});

test("buildRoleGuideView：ROLES と ROLE_GUIDE_ORDER を変更しない（純粋関数）", () => {
  const beforeRoles = JSON.stringify(Logic.ROLES);
  const beforeOrder = JSON.stringify(Logic.ROLE_GUIDE_ORDER);
  Logic.buildRoleGuideView();
  Logic.buildRoleGuideView();
  assert.equal(JSON.stringify(Logic.ROLES), beforeRoles);
  assert.equal(JSON.stringify(Logic.ROLE_GUIDE_ORDER), beforeOrder);
});

test("ブラウザ側の renderRoleGuide は共有モジュールの buildRoleGuideView と同一に描く", () => {
  const { FB, elements, sandbox } = loadGame({ seedSettings: BASE_SETTINGS });
  const view = Logic.buildRoleGuideView();
  assert.equal(JSON.stringify(FB.buildRoleGuideViewLogic()), JSON.stringify(view), "ハーネス経由の buildRoleGuideView とも同一");
  // 読み込み時に描画済みで、タイルが旧版の静的な HTML と同一。
  const expected = view.map(t => t.tileHtml).join("");
  assert.equal(elements.get("roleGuideList").innerHTML, expected);
  FB.renderRoleGuide();
  assert.equal(elements.get("roleGuideList").innerHTML, expected, "再描画でも同一");
  // 動的生成のボタンでも、説明ポップオーバーの委譲が拾う。
  const btn = { dataset: { roleInfo: "guardian" }, closest: (sel) => (sel === "[data-role-info]" ? btn : null) };
  sandbox.document.dispatch("click", { target: btn, preventDefault() {}, stopPropagation() {} });
  assert.equal(elements.get("roleInfoName").textContent, "守り手");
  FB.closeRoleInfo();
});

test("buildParadeView：8人の歩行者が id 順に並び、slug・名前・歩行周期が揃う", () => {
  assert.equal(JSON.stringify(Logic.PARADE_BD),
    JSON.stringify(["0.34s", "0.38s", "0.31s", "0.36s", "0.33s", "0.39s", "0.32s", "0.37s"]));
  const view = Logic.buildParadeView();
  assert.equal(view.length, 8);
  for (let i = 0; i < 8; i++) {
    assert.equal(view[i].id, i, `歩行者 ${i} の id`);
    assert.equal(view[i].slug, Logic.ICON_SLUGS[i], `歩行者 ${i} の slug`);
    assert.equal(view[i].name, Logic.PLAYER_NAMES[i], `歩行者 ${i} の名前`);
    assert.equal(view[i].duration, Logic.PARADE_BD[i], `歩行者 ${i} の歩行周期`);
    assert.ok(view[i].html.includes(`--i:${i};--bd:${Logic.PARADE_BD[i]}`), `歩行者 ${i} の style`);
    assert.ok(view[i].html.includes(`data-slug="${Logic.ICON_SLUGS[i]}"`), `歩行者 ${i} の slug 属性`);
  }
});

test("buildParadeView：歩行者の HTML は旧版の静的なものと同一", () => {
  const view = Logic.buildParadeView();
  assert.equal(view[0].html,
    `<span class="walker" style="--i:0;--bd:0.34s"><span class="wshadow"></span><span class="wbody"><img class="frame-a" data-slug="luna" data-frame="a" alt="ルナ"><img class="frame-b" data-slug="luna" data-frame="b" alt=""></span></span>`);
  assert.equal(view[7].html,
    `<span class="walker" style="--i:7;--bd:0.37s"><span class="wshadow"></span><span class="wbody"><img class="frame-a" data-slug="ema" data-frame="a" alt="エマ"><img class="frame-b" data-slug="ema" data-frame="b" alt=""></span></span>`);
  // 全歩行者が同じ形で、frame-a の alt だけキャラ名、frame-b は空。
  for (const w of view) {
    assert.ok(w.html.startsWith(`<span class="walker" style="--i:${w.id};--bd:${w.duration}">`), `歩行者 ${w.id} の開始タグ`);
    assert.ok(w.html.endsWith("</span></span>"), `歩行者 ${w.id} の終了タグ`);
    assert.ok(w.html.includes(`<img class="frame-a" data-slug="${w.slug}" data-frame="a" alt="${w.name}">`), `歩行者 ${w.id} の frame-a`);
    assert.ok(w.html.includes(`<img class="frame-b" data-slug="${w.slug}" data-frame="b" alt="">`), `歩行者 ${w.id} の frame-b`);
  }
});

test("buildParadeView：PLAYER_NAMES・ICON_SLUGS・PARADE_BD を変更しない（純粋関数）", () => {
  const beforeNames = JSON.stringify(Logic.PLAYER_NAMES);
  const beforeSlugs = JSON.stringify(Logic.ICON_SLUGS);
  const beforeBd = JSON.stringify(Logic.PARADE_BD);
  Logic.buildParadeView();
  Logic.buildParadeView();
  assert.equal(JSON.stringify(Logic.PLAYER_NAMES), beforeNames);
  assert.equal(JSON.stringify(Logic.ICON_SLUGS), beforeSlugs);
  assert.equal(JSON.stringify(Logic.PARADE_BD), beforeBd);
});

test("ブラウザ側の renderParade は共有モジュールの buildParadeView と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  const view = Logic.buildParadeView();
  assert.equal(JSON.stringify(FB.buildParadeViewLogic()), JSON.stringify(view), "ハーネス経由の buildParadeView とも同一");
  // 読み込み時に描画済みで、歩行者が旧版の静的な HTML と同一。
  const expected = view.map(w => w.html).join("");
  assert.equal(elements.get("parade").innerHTML, expected);
  FB.renderParade();
  assert.equal(elements.get("parade").innerHTML, expected, "再描画でも同一");
});

test("formatDiscussTime：残り秒数を「分:秒」表示にする", () => {
  assert.equal(Logic.formatDiscussTime(0), "0:00");
  assert.equal(Logic.formatDiscussTime(5), "0:05");
  assert.equal(Logic.formatDiscussTime(59), "0:59");
  assert.equal(Logic.formatDiscussTime(60), "1:00");
  assert.equal(Logic.formatDiscussTime(90), "1:30");
  assert.equal(Logic.formatDiscussTime(125), "2:05");
  assert.equal(Logic.formatDiscussTime(600), "10:00");
});

test("buildDiscussTimerView：表示しない条件では隠す（ソロ・議論以外・タイマーなし）", () => {
  const base = { mode: "pnp", phase: "discussion", discussTimerSetting: "60", secondsLeft: 60 };
  assert.deepEqual(Logic.buildDiscussTimerView(base),
    { hidden: false, low: false, expired: false, voteReady: false, text: "🗣️ 議論タイマー 残り 1:00" });
  for (const patch of [
    { mode: "solo" },
    { phase: "morning" },
    { phase: "vote" },
    { discussTimerSetting: "0" },
    { discussTimerSetting: 0 },
    { discussTimerSetting: null },
    { discussTimerSetting: "なし" },
  ]) {
    assert.deepEqual(Logic.buildDiscussTimerView({ ...base, ...patch }),
      { hidden: true, low: false, expired: false, voteReady: false, text: "" },
      `隠す条件: ${JSON.stringify(patch)}`);
  }
});

test("buildDiscussTimerView：残り30秒以下で警告色、時間切れで投票ボタンを目立たせる", () => {
  const base = { mode: "pnp", phase: "discussion", discussTimerSetting: "60" };
  assert.equal(Logic.buildDiscussTimerView({ ...base, secondsLeft: 31 }).low, false);
  assert.deepEqual(Logic.buildDiscussTimerView({ ...base, secondsLeft: 30 }),
    { hidden: false, low: true, expired: false, voteReady: false, text: "🗣️ 議論タイマー 残り 0:30" });
  assert.equal(Logic.buildDiscussTimerView({ ...base, secondsLeft: 1 }).text, "🗣️ 議論タイマー 残り 0:01");
  assert.deepEqual(Logic.buildDiscussTimerView({ ...base, secondsLeft: 0 }),
    { hidden: false, low: false, expired: true, voteReady: true, text: "⏰ 時間切れ！「議論を終えて投票へ」を押してね" });
  // マイナスでも時間切れ扱い
  assert.equal(Logic.buildDiscussTimerView({ ...base, secondsLeft: -5 }).expired, true);
  // 設定が数値でも文字列でも同じ表示になる
  assert.equal(Logic.buildDiscussTimerView({ ...base, discussTimerSetting: 60, secondsLeft: 60 }).text,
    Logic.buildDiscussTimerView({ ...base, discussTimerSetting: "60", secondsLeft: 60 }).text);
});

test("buildDiscussTimerView：入力を変更しない（純粋関数）", () => {
  const input = { mode: "pnp", phase: "discussion", discussTimerSetting: "60", secondsLeft: 45 };
  const before = JSON.stringify(input);
  const a = Logic.buildDiscussTimerView(input);
  const b = Logic.buildDiscussTimerView(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(Logic.DISCUSS_TIMER_LOW_SECONDS, 30);
});

test("ブラウザ側の renderDiscussTimer は共有モジュールの buildDiscussTimerView と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2", discussTimer: "60" } });
  FB.setupGame();
  FB.state.phase = "morning";
  FB.morningToDiscussion();
  const box = elements.get("discussTimer");
  const nextBtn = elements.get("nextBtn");
  const viewOf = () => FB.buildDiscussTimerViewLogic({
    mode: FB.state.mode,
    phase: FB.state.phase,
    discussTimerSetting: FB.gameSettings.discussTimer,
    secondsLeft: FB.discussSecondsLeft,
  });
  const checkBox = () => {
    const view = viewOf();
    assert.equal(box.classList.contains("hidden"), view.hidden, "hidden");
    assert.equal(box.classList.contains("timer-low"), view.low, "timer-low");
    assert.equal(box.classList.contains("timer-expired"), view.expired, "timer-expired");
    assert.equal(nextBtn.classList.contains("vote-ready"), view.voteReady, "vote-ready");
    assert.equal(box.textContent, view.text, "文言");
  };
  // 開始直後（残り60秒）
  assert.equal(FB.discussSecondsLeft, 60);
  FB.renderDiscussTimer();
  checkBox();
  // 30秒進めて残り30秒（警告色）
  for (let i = 0; i < 30; i++) FB.discussTimerTick();
  assert.equal(FB.discussSecondsLeft, 30);
  FB.renderDiscussTimer();
  checkBox();
  // 時間切れまで進める
  for (let i = 0; i < 30; i++) FB.discussTimerTick();
  assert.equal(FB.discussSecondsLeft, 0);
  FB.renderDiscussTimer();
  checkBox();
  // 投票へ進むと隠れる
  FB.discussionToVote();
  FB.renderDiscussTimer();
  checkBox();
});

test("buildPnpCoverView：3場面の文言とボタン（役職確認・夜・投票）", () => {
  const player = { id: 0, name: "ルナ", roleKey: "villager", alive: true };
  assert.deepEqual(Logic.buildPnpCoverView(player, { index: 0, kind: "handoff" }), {
    coverText: "次は <strong>P1（ルナ）</strong>さんの番です。<br>周りの人に見られないように、端末を受け取ったら下のボタンをタップしてください。",
    revealBtnText: "タップして役職を見る",
  });
  assert.deepEqual(Logic.buildPnpCoverView(player, { index: 1, kind: "night" }), {
    coverText: "次は <strong>P2（ルナ）</strong>さんの番です。<br>夜行動の時間です。周りの人に見られないように、端末を受け取ったら下のボタンをタップしてください。",
    revealBtnText: "タップして夜の番を始める",
  });
  assert.deepEqual(Logic.buildPnpCoverView(player, { index: 2, kind: "vote" }), {
    coverText: "次は <strong>P3（ルナ）</strong>さんの番です。<br>投票の時間です。周りの人に見られないように、端末を受け取ったら下のボタンをタップしてください。",
    revealBtnText: "タップして投票の番を始める",
  });
  // 未知の kind は役職確認として扱う
  assert.equal(Logic.buildPnpCoverView(player, { index: 0, kind: "unknown" }).revealBtnText, "タップして役職を見る");
  assert.equal(Logic.buildPnpCoverView(player, { index: 0 }).revealBtnText, "タップして役職を見る");
  // カバー画面に役職名は出ない
  assert.ok(!Logic.buildPnpCoverView(player, { index: 0, kind: "handoff" }).coverText.includes("村ガール"));
});

test("buildPnpRoleView：確認ボタンの文言は最後の人だけ「ゲーム開始」、役職 HTML は roleHtmlFor と同一", () => {
  const player = { id: 0, name: "ルナ", roleKey: "villager", alive: true };
  const players = [player, { id: 1, name: "ミオ", roleKey: "guardian", alive: true }];
  const opts = { mode: "pnp", humanPlayerIds: [0, 1] };
  const first = Logic.buildPnpRoleView(player, players, { index: 0, humanCount: 2, ...opts });
  assert.equal(first.title, "あなたの役職");
  assert.equal(first.confirmBtnText, "確認した（次の人へ）");
  assert.equal(first.roleHtml, Logic.roleHtmlFor(player, players, opts));
  assert.ok(first.roleHtml.includes("村ガール"), "役職画面は本人の役職を示す");
  const last = Logic.buildPnpRoleView(player, players, { index: 1, humanCount: 2, ...opts });
  assert.equal(last.confirmBtnText, "確認した（ゲーム開始）");
  assert.equal(Logic.buildPnpRoleView(null, players, { index: 0, humanCount: 2, ...opts }), null);
});

test("buildPnpNightResultView：前夜の結果を div 並びにし、空なら null", () => {
  assert.deepEqual(Logic.buildPnpNightResultView(["占い結果：白", "追跡：なし"]), {
    title: "前夜の結果",
    html: "<div>占い結果：白</div><div>追跡：なし</div>",
    confirmBtnText: "夜行動へ進む",
  });
  assert.equal(Logic.buildPnpNightResultView([]), null);
  assert.equal(Logic.buildPnpNightResultView(null), null);
  assert.equal(Logic.buildPnpNightResultView("結果"), null);
});

test("buildPnpNightActionView：合意・相談・能力なしの3通りと能力ありの null", () => {
  const rep = { id: 2, name: "ユイ", roleKey: "fakeGirl", alive: true };
  const target = { id: 3, name: "カノン", roleKey: "villager", alive: true };
  const mimic = { id: 1, name: "ミオ", roleKey: "mimic", alive: true };
  // 代表者の入力あり：合意確認
  assert.deepEqual(Logic.buildPnpNightActionView(mimic, { rep, repTarget: target, isLast: true }), {
    step: "nightFakeAgree",
    title: "夜行動",
    html: "<strong>ミオ（なりすまし）</strong><br>インポスターの仲間（ユイ）が今夜の襲撃先に <strong>カノン</strong> を選びました。<br>この襲撃先で合意しますか？",
    confirmBtnText: "合意する（能力入力へ）",
  });
  // 代表者の入力なし：相談画面
  const consult = Logic.buildPnpNightActionView(mimic, { rep, repTarget: null, isLast: false });
  assert.equal(consult.step, "nightFakeConsult");
  assert.equal(consult.confirmBtnText, "相談した（能力入力へ）");
  assert.ok(consult.html.includes("ユイ）と相談してください"));
  // 能力なし（村ガール）：最後の人だけ文言が変わる
  const villager = { id: 0, name: "ルナ", roleKey: "villager", alive: true };
  const noAction = Logic.buildPnpNightActionView(villager, { rep: null, repTarget: null, isLast: false });
  assert.equal(noAction.step, "nightNoAction");
  assert.equal(noAction.confirmBtnText, "確認した（次の人へ）");
  assert.ok(noAction.html.includes("今夜は能力がありません"));
  assert.equal(Logic.buildPnpNightActionView(villager, { rep: null, repTarget: null, isLast: true }).confirmBtnText,
    "確認した（夜行動を終える）");
  // 能力あり（占い師）は null：呼び出し側はゲーム画面で対象を選ぶ
  const seer = { id: 4, name: "スズ", roleKey: "apprenticeSeer", alive: true };
  assert.equal(Logic.buildPnpNightActionView(seer, { rep: null, repTarget: null, isLast: false }), null);
  // 代表者本人は合意・相談にならず、能力ありなので null
  const fakeGirl = { id: 2, name: "ユイ", roleKey: "fakeGirl", alive: true };
  assert.equal(Logic.buildPnpNightActionView(fakeGirl, { rep, repTarget: target, isLast: false }), null);
  // バカは表示役職がインポスターでも実役職の陣営で判定するため、合意・相談
  // にはならない。表示役職なりすましは能力ありなのでゲーム画面へ（null）。
  const baka = { id: 5, name: "リリ", roleKey: "baka", fakeDisplayRoleKey: "mimic", alive: true };
  assert.equal(Logic.buildPnpNightActionView(baka, { rep, repTarget: target, isLast: false }), null);
  // 表示役職が村ガールのバカは能力なし扱いになる。
  const bakaVillager = { id: 6, name: "ノア", roleKey: "baka", fakeDisplayRoleKey: "villager", alive: true };
  const bakaView = Logic.buildPnpNightActionView(bakaVillager, { rep, repTarget: target, isLast: false });
  assert.equal(bakaView.step, "nightNoAction", "バカは表示役職で夜行動を判定する");
  assert.ok(bakaView.html.includes("村ガール"));
  assert.equal(Logic.buildPnpNightActionView(null, { rep, repTarget: target, isLast: false }), null);
});

test("buildPnpTurnBannerText：夜は役職名＋ヒント、投票は「投票：ヒント」、head は共通", () => {
  const player = { id: 0, name: "ルナ", roleKey: "villager", alive: true };
  assert.deepEqual(Logic.buildPnpTurnBannerText(player, { index: 0, kind: "night", roleName: "村ガール", hint: "夜は情報整理に集中" }), {
    head: "P1（ルナ）の番",
    text: "P1（ルナ）の番 — 村ガール：夜は情報整理に集中",
  });
  assert.deepEqual(Logic.buildPnpTurnBannerText(player, { index: 1, kind: "vote", hint: "投票しよう" }), {
    head: "P2（ルナ）の番",
    text: "P2（ルナ）の番 — 投票：投票しよう",
  });
});

test("パス＆プレイの表示生成：入力を変更しない（純粋関数）", () => {
  const player = { id: 1, name: "ミオ", roleKey: "mimic", alive: true };
  const rep = { id: 2, name: "ユイ", roleKey: "fakeGirl", alive: true };
  const target = { id: 3, name: "カノン", roleKey: "villager", alive: true };
  const inputs = [
    () => Logic.buildPnpCoverView(player, { index: 0, kind: "handoff" }),
    () => Logic.buildPnpRoleView(player, [player], { index: 0, humanCount: 1, mode: "pnp", humanPlayerIds: [1] }),
    () => Logic.buildPnpNightResultView(["結果A"]),
    () => Logic.buildPnpNightActionView(player, { rep, repTarget: target, isLast: false }),
    () => Logic.buildPnpTurnBannerText(player, { index: 0, kind: "night", roleName: "なりすまし", hint: "ヒント" }),
  ];
  for (const fn of inputs) {
    const before = JSON.stringify([player, rep, target]);
    const a = fn();
    const b = fn();
    assert.equal(JSON.stringify([player, rep, target]), before, "入力が変わっていない");
    assert.equal(JSON.stringify(a), JSON.stringify(b), "同じ入力で同じ結果");
  }
});

test("ブラウザ側のパス＆プレイ受け渡し画面は共有モジュールの表示生成と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2" } });
  FB.setupGame();
  const s = FB.state;
  // 1人目のカバー画面
  let player = s.players[s.humanPlayerIds[0]];
  let view = FB.buildPnpCoverViewLogic(player, { index: s.pnpIndex, kind: "handoff" });
  assert.equal(elements.get("pnpCoverText").innerHTML, view.coverText);
  assert.equal(elements.get("pnpRevealBtn").textContent, view.revealBtnText);
  // 1人目の役職画面
  elements.get("pnpRevealBtn").onclick();
  view = FB.buildPnpRoleViewLogic(player, s.players, { index: s.pnpIndex, humanCount: s.humanPlayerIds.length, mode: s.mode, humanPlayerIds: s.humanPlayerIds });
  assert.equal(elements.get("pnpRoleTitle").textContent, view.title);
  assert.equal(elements.get("pnpPlayerRole").innerHTML, view.roleHtml);
  assert.equal(elements.get("pnpConfirmBtn").textContent, view.confirmBtnText);
  // 2人目（最後の人）のカバー→役職画面
  elements.get("pnpConfirmBtn").onclick();
  player = s.players[s.humanPlayerIds[1]];
  view = FB.buildPnpCoverViewLogic(player, { index: s.pnpIndex, kind: "handoff" });
  assert.equal(elements.get("pnpCoverText").innerHTML, view.coverText);
  elements.get("pnpRevealBtn").onclick();
  view = FB.buildPnpRoleViewLogic(player, s.players, { index: s.pnpIndex, humanCount: s.humanPlayerIds.length, mode: s.mode, humanPlayerIds: s.humanPlayerIds });
  assert.equal(elements.get("pnpConfirmBtn").textContent, "確認した（ゲーム開始）");
  assert.equal(elements.get("pnpPlayerRole").innerHTML, view.roleHtml);
  // 受け渡し完了後は夜のカバー画面
  elements.get("pnpConfirmBtn").onclick();
  assert.equal(s.pnpStep, "nightCover");
  player = s.players[s.pnpNightQueue[s.pnpNightIndex]];
  view = FB.buildPnpCoverViewLogic(player, { index: s.pnpNightIndex, kind: "night" });
  assert.equal(elements.get("pnpCoverText").innerHTML, view.coverText);
  assert.equal(elements.get("pnpRevealBtn").textContent, view.revealBtnText);
});

test("ブラウザ側のパス＆プレイ夜・投票の表示は共有モジュールの表示生成と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2" } });
  FB.setupGame();
  const s = FB.state;
  const [h0, h1] = s.humanPlayerIds;
  // 夜の順番を固定する：代表者（フェイクガール）→ 非代表者（なりすまし）。
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  s.players[h0].roleKey = "fakeGirl";
  s.players[h1].roleKey = "mimic";
  // 受け渡しを済ませて夜へ進む（役職は変えた後でもカバー画面は同じ）。
  for (let i = 0; i < 2; i++) {
    elements.get("pnpRevealBtn").onclick();
    elements.get("pnpConfirmBtn").onclick();
  }
  assert.equal(s.pnpStep, "nightCover");
  // 別レルムの配列は deepStrictEqual がプロトタイプ差で失敗するため JSON 比較にする。
  assert.equal(JSON.stringify(s.pnpNightQueue), JSON.stringify([h0, h1]));
  // 代表者の番：能力ありなのでゲーム画面へ。バナーはモジュールと同一。
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightAction");
  let view = FB.buildPnpTurnBannerTextLogic(s.players[h0], { index: 0, kind: "night", roleName: "フェイクガール", hint: FB.getPhaseHint(FB.ROLES.fakeGirl) });
  assert.equal(elements.get("factionText").textContent, view.head);
  assert.equal(elements.get("pnpTurnBanner").textContent, view.text);
  // 代表者が襲撃先を選ぶ（村ガールの誰か）。対象の確定は actionBtn。
  const targetId = s.players.find((p) => p.roleKey === "villager" && p.alive).id;
  FB.selectTarget(targetId);
  elements.get("actionBtn").onclick();
  assert.equal(s.pnpNightInputs[h0], targetId);
  // 非代表者の番：合意確認画面がモジュールと同一。
  assert.equal(s.pnpStep, "nightCover");
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightFakeAgree");
  view = FB.buildPnpNightActionViewLogic(s.players[h1], { rep: s.players[h0], repTarget: s.players[targetId], isLast: true });
  assert.equal(elements.get("pnpRoleTitle").textContent, view.title);
  assert.equal(elements.get("pnpPlayerRole").innerHTML, view.html);
  assert.equal(elements.get("pnpConfirmBtn").textContent, view.confirmBtnText);
  // 合意して能力入力へ：なりすましの盗み見バナーもモジュールと同一。
  elements.get("pnpConfirmBtn").onclick();
  assert.equal(s.pnpStep, "nightFakeAbility");
  view = FB.buildPnpTurnBannerTextLogic(s.players[h1], { index: 1, kind: "night", roleName: "なりすまし", hint: "盗み見：相手の本当の役職を調べる（インポスターの仲間は選べないよ）" });
  assert.equal(elements.get("factionText").textContent, view.head);
  assert.equal(elements.get("pnpTurnBanner").textContent, view.text);
  // 盗み見の対象を選んで夜を終える。
  const lookTarget = s.players.find((p) => p.id !== h1 && p.alive && !["fakeGirl", "mimic"].includes(p.roleKey)).id;
  FB.selectTarget(lookTarget);
  elements.get("actionBtn").onclick();
  assert.equal(s.phase, "morning");
});

test("ブラウザ側のパス＆プレイ前夜の結果・能力なし・投票バナーは共有モジュールと同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: { ...BASE_SETTINGS, mode: "pnp", humanCount: "2" } });
  FB.setupGame();
  const s = FB.state;
  const [h0, h1] = s.humanPlayerIds;
  s.players.forEach((p) => { p.roleKey = "villager"; p.fakeDisplayRoleKey = null; });
  // 人間は全員村ガールだが、CPU にインポスターを1人残す（全員イノセント
  // だと夜の解決直後にイノセント勝利で終わってしまうため）。
  s.players.find((p) => !s.humanPlayerIds.includes(p.id)).roleKey = "fakeGirl";
  // 受け渡しを済ませて夜へ。
  for (let i = 0; i < 2; i++) {
    elements.get("pnpRevealBtn").onclick();
    elements.get("pnpConfirmBtn").onclick();
  }
  assert.equal(s.pnpStep, "nightCover");
  // 前夜の結果がある人の番：結果画面がモジュールと同一で、表示後に消える。
  s.pnpNightResults[h0] = ["占い結果：白", "追跡：なし"];
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightResult");
  let view = FB.buildPnpNightResultViewLogic(["占い結果：白", "追跡：なし"]);
  assert.equal(elements.get("pnpRoleTitle").textContent, view.title);
  assert.equal(elements.get("pnpPlayerRole").innerHTML, view.html);
  assert.equal(elements.get("pnpConfirmBtn").textContent, view.confirmBtnText);
  // 別レルムの配列は deepStrictEqual がプロトタイプ差で失敗するため JSON 比較にする。
  assert.equal(JSON.stringify(s.pnpNightResults[h0]), "[]");
  // 結果確認後は能力なしの夜行動画面（村ガール）。
  elements.get("pnpConfirmBtn").onclick();
  assert.equal(s.pnpStep, "nightNoAction");
  view = FB.buildPnpNightActionViewLogic(s.players[h0], { rep: null, repTarget: null, isLast: false });
  assert.equal(elements.get("pnpRoleTitle").textContent, view.title);
  assert.equal(elements.get("pnpPlayerRole").innerHTML, view.html);
  assert.equal(elements.get("pnpConfirmBtn").textContent, view.confirmBtnText);
  // 2人目も能力なしで夜を終える。
  elements.get("pnpConfirmBtn").onclick();
  assert.equal(s.pnpStep, "nightCover");
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "nightNoAction");
  view = FB.buildPnpNightActionViewLogic(s.players[h1], { rep: null, repTarget: null, isLast: true });
  assert.equal(elements.get("pnpConfirmBtn").textContent, "確認した（夜行動を終える）");
  assert.equal(elements.get("pnpPlayerRole").innerHTML, view.html);
  elements.get("pnpConfirmBtn").onclick();
  assert.equal(s.phase, "morning");
  // 投票のカバーとバナーもモジュールと同一。
  s.phase = "vote";
  FB.startPnpVote();
  assert.equal(s.pnpStep, "voteCover");
  let player = s.players[s.pnpVoteQueue[s.pnpVoteIndex]];
  view = FB.buildPnpCoverViewLogic(player, { index: s.pnpVoteIndex, kind: "vote" });
  assert.equal(elements.get("pnpCoverText").innerHTML, view.coverText);
  assert.equal(elements.get("pnpRevealBtn").textContent, view.revealBtnText);
  elements.get("pnpRevealBtn").onclick();
  assert.equal(s.pnpStep, "voteAction");
  view = FB.buildPnpTurnBannerTextLogic(player, { index: s.pnpVoteIndex, kind: "vote", hint: FB.getPhaseHint(FB.ROLES[player.roleKey]) });
  assert.equal(elements.get("factionText").textContent, view.head);
  assert.equal(elements.get("pnpTurnBanner").textContent, view.text);
});

// ---- フェーズ0第25歩：結果画面の行 HTML の抽出 ----

test("buildResultRowsView：行 HTML は旧版 showResults のテンプレートとバイト同一", () => {
  const summary = Logic.buildResultSummary(RESULT_PLAYERS, { winText: INNOCENT_WIN, mode: "solo", playerId: 0, humanCount: 1 });
  const iconImgs = { [Logic.ICON_SLUGS[0]]: "data:image/webp;base64,AAA", [Logic.ICON_SLUGS[2]]: "data:image/webp;base64,BBB" };
  // 旧版 showResults の行 map をそのまま再現した期待値。
  const expected = summary.rows.map((r) => {
    const img = iconImgs[Logic.ICON_SLUGS[r.id]];
    return `<div class="result-row ${r.alive ? "" : "dead"} ${r.isWinner ? "winner" : "loser"}">
        <div class="avatar"><span>${r.icon}</span>${img ? `<img class="avatar-img" src="${img}" alt="${r.name}">` : ""}</div>
        <div><div class="result-name">${r.name}${r.isMe ? "（あなた）" : ""}<span class="faction-chip ${r.chipClass}">${r.faction}</span></div>
        <div class="result-role">${Logic.roleIconButtonHtml(r.roleKey)} ${r.roleName}${r.displayNote}${r.clumsyNote}</div></div>
        <div class="result-status">${r.status}</div>
      </div>`;
  }).join("");
  assert.equal(Logic.buildResultRowsView(summary.rows, iconImgs), expected);
});

test("buildResultRowsView：勝敗クラス・（あなた）・注記・顔画像の有無", () => {
  const summary = Logic.buildResultSummary(RESULT_PLAYERS, { winText: INNOCENT_WIN, mode: "solo", playerId: 0, humanCount: 1 });
  const html = Logic.buildResultRowsView(summary.rows, { [Logic.ICON_SLUGS[0]]: "data:image/webp;base64,AAA" });
  // 生存の勝者は winner、脱落の敗者は dead loser。
  assert.ok(html.includes('class="result-row  winner"'), `勝者の行: ${html}`);
  assert.ok(html.includes('class="result-row dead loser"'), `脱落した敗者の行: ${html}`);
  assert.ok(html.includes("ルナ（あなた）"), "自分の行に（あなた）が付く");
  assert.equal(html.split("（あなた）").length - 1, 1, "（あなた）は1行だけ");
  assert.ok(html.includes("（表示：ドクター）"), "バカの表示注記がある");
  assert.ok(html.includes("（実はうっかり個体でした）"), "うっかり個体の注記がある");
  assert.ok(html.includes('<img class="avatar-img" src="data:image/webp;base64,AAA" alt="ルナ">'), "顔画像がある行には img が出る");
  assert.ok(!html.includes("<span>🐱</span><img"), "顔画像がない行には img が出ない");
  assert.ok(html.includes('data-role-info="guardian"'), "役職アイコンボタンがある");
  assert.ok(html.includes("2日目に脱落（追放）"), "脱落の生死が出る");
});

test("buildResultRowsView：行が空・null は空文字", () => {
  assert.equal(Logic.buildResultRowsView([], {}), "");
  assert.equal(Logic.buildResultRowsView(null), "");
  assert.equal(Logic.buildResultRowsView(undefined), "");
});

test("buildResultRowsView：入力を変更しない（純粋関数）", () => {
  const summary = Logic.buildResultSummary(RESULT_PLAYERS, { winText: INNOCENT_WIN, mode: "solo", playerId: 0, humanCount: 1 });
  const iconImgs = { [Logic.ICON_SLUGS[0]]: "data:image/webp;base64,AAA" };
  const before = JSON.stringify([summary.rows, iconImgs]);
  const a = Logic.buildResultRowsView(summary.rows, iconImgs);
  const b = Logic.buildResultRowsView(summary.rows, iconImgs);
  assert.equal(JSON.stringify([summary.rows, iconImgs]), before, "入力が変わっていない");
  assert.equal(a, b, "同じ入力で同じ結果");
});

test("ブラウザ側の showResults の行 HTML は共有モジュールと同一になる", () => {
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
  FB.showResults(INNOCENT_WIN);
  // ハーネスでは顔画像が読み込まれない（ICON_IMGS は空）ため空の map で一致する。
  assert.equal(elements.get("resultRows").innerHTML, FB.buildResultRowsViewLogic(expected.rows, {}));
  assert.equal(elements.get("resultRows").innerHTML, Logic.buildResultRowsView(expected.rows, {}));
});

// ---- フェーズ0第27歩：画面振動・紙吹雪の表示生成の抽出 ----

test("buildShakeView：クラス名 shake と振動時間 500ms を返す", () => {
  assert.equal(Logic.SHAKE_CLASS, "shake");
  assert.equal(Logic.SHAKE_MS, 500);
  assert.equal(JSON.stringify(Logic.buildShakeView()), JSON.stringify({ className: "shake", ms: 500 }));
  assert.equal(JSON.stringify(Logic.buildShakeView()), JSON.stringify(Logic.buildShakeView()), "同じ入力で同じ結果");
});

test("buildConfettiPiece：固定乱数では位置・色・遅れ・落下時間が決定的", () => {
  const fixed = () => 0.5;
  assert.equal(JSON.stringify(Logic.buildConfettiPiece(0, fixed)), JSON.stringify({
    className: "confetti-piece",
    left: "50%",
    background: "#ff6fb3",
    delay: "0.25s",
    duration: "3s",
  }));
  // 色は5色を巡回する（旧版 celebrate の colors[i % 5] と同じ）。
  assert.equal(Logic.buildConfettiPiece(4, fixed).background, "#ffe08a");
  assert.equal(Logic.buildConfettiPiece(5, fixed).background, "#ff6fb3");
  assert.equal(Logic.buildConfettiPiece(6, fixed).background, "#b79bff");
});

test("buildConfettiView：26枚で、同じ乱数列なら同じ並びになる", () => {
  assert.equal(Logic.CONFETTI_COUNT, 26);
  assert.equal(Logic.CONFETTI_PIECE_CLASS, "confetti-piece");
  assert.equal(Logic.CONFETTI_REMOVE_MS, 4600);
  assert.equal(JSON.stringify(Logic.CONFETTI_COLORS), JSON.stringify(["#ff6fb3", "#b79bff", "#ffd7ec", "#8be0b0", "#ffe08a"]));
  const seq = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
  const makeRnd = () => { let i = 0; return () => seq[i++ % seq.length]; };
  const a = Logic.buildConfettiView(makeRnd());
  const b = Logic.buildConfettiView(makeRnd());
  assert.equal(a.length, 26);
  assert.equal(JSON.stringify(a), JSON.stringify(b), "同じ乱数列で同じ結果");
  assert.equal(a[0].left, "10%");
  assert.equal(a[0].delay, "0.1s");
  assert.equal(a[0].duration, "2.68s");
  assert.equal(a[0].background, "#ff6fb3");
  assert.equal(a[5].background, "#ff6fb3", "6枚目は色が1周する");
  // 乱数なし（既定の Math.random）でも26枚の形は揃う。
  const c = Logic.buildConfettiView();
  assert.equal(c.length, 26);
  for (const p of c) {
    assert.equal(p.className, "confetti-piece");
    assert.ok(Logic.CONFETTI_COLORS.includes(p.background), `色: ${p.background}`);
    const left = parseFloat(p.left);
    assert.ok(p.left.endsWith("%") && left >= 0 && left < 100, `横位置: ${p.left}`);
    assert.ok(p.delay.endsWith("s"), `遅れ: ${p.delay}`);
    assert.ok(p.duration.endsWith("s"), `落下時間: ${p.duration}`);
  }
});

test("ブラウザ側の celebrate は共有モジュールの buildConfettiView と同一に描く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  FB.celebrate();
  const layer = elements.get("confetti");
  assert.equal(layer.children.length, Logic.CONFETTI_COUNT, "紙吹雪は26枚");
  for (const child of layer.children) {
    assert.equal(child.className, Logic.CONFETTI_PIECE_CLASS);
    assert.ok(Logic.CONFETTI_COLORS.includes(child.style.background), `色: ${child.style.background}`);
    const left = parseFloat(child.style.left);
    assert.ok(child.style.left.endsWith("%") && left >= 0 && left < 100, `横位置: ${child.style.left}`);
    assert.ok(child.style.animationDelay.endsWith("s"), `遅れ: ${child.style.animationDelay}`);
    assert.ok(child.style.animationDuration.endsWith("s"), `落下時間: ${child.style.animationDuration}`);
  }
  // 削除タイマーの時間もモジュールと同じ。
  assert.equal(FB.CONFETTI_REMOVE_MS, Logic.CONFETTI_REMOVE_MS);
});

test("ブラウザ側の shakeScreen は共有モジュールの buildShakeView と同一に描く", () => {
  const { FB, sandbox } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  assert.equal(JSON.stringify(FB.buildShakeViewLogic()), JSON.stringify(Logic.buildShakeView()));
  const wrap = sandbox.document.querySelector(".wrap");
  assert.equal(wrap.classList.contains("shake"), false, "振動前は shake なし");
  FB.shakeScreen();
  assert.equal(wrap.classList.contains("shake"), true, "振動中は shake が付く");
});

// ---- フェーズ0第28歩：ステージ歩行者モーションの表示生成の抽出 ----

test("buildStageBounceView：ホップのクラス speaking と時間 1000ms を返す", () => {
  assert.equal(Logic.STAGE_BOUNCE_CLASS, "speaking");
  assert.equal(Logic.STAGE_BOUNCE_MS, 1000);
  assert.equal(JSON.stringify(Logic.buildStageBounceView()), JSON.stringify({ className: "speaking", ms: 1000 }));
  assert.equal(JSON.stringify(Logic.buildStageBounceView()), JSON.stringify(Logic.buildStageBounceView()), "同じ入力で同じ結果");
});

test("buildStageEventMotionView：クラスと時間（既定 2000ms）を返す", () => {
  assert.equal(Logic.STAGE_EVENT_MOTION_MS, 2000);
  assert.equal(JSON.stringify(Logic.buildStageEventMotionView("motion-revive")), JSON.stringify({ className: "motion-revive", ms: 2000 }));
  assert.equal(JSON.stringify(Logic.buildStageEventMotionView("motion-flinch", 3200)), JSON.stringify({ className: "motion-flinch", ms: 3200 }));
  assert.equal(Logic.buildStageEventMotionView(""), null);
  assert.equal(Logic.buildStageEventMotionView(null), null);
  assert.equal(Logic.buildStageEventMotionView(123), null);
});

test("buildGhostWalkerView：幽霊歩行者のクラス・id・style・中身・消去時間を返す", () => {
  assert.equal(Logic.STAGE_GHOST_BD, "0.34s");
  assert.equal(Logic.STAGE_GHOST_REMOVE_MS, 3200);
  assert.equal(JSON.stringify(Logic.buildGhostWalkerView(3, "motion-blast", undefined, "kanon")), JSON.stringify({
    className: "walker motion-blast",
    playerId: 3,
    style: "--i:3;--bd:0.34s",
    innerHtml: `<span class="wshadow"></span><span class="wbody"><img class="frame-a" data-slug="kanon" data-frame="a" alt=""><img class="frame-b" data-slug="kanon" data-frame="b" alt=""></span>`,
    removeMs: 3200,
  }));
  assert.equal(Logic.buildGhostWalkerView(0, "motion-flinch", 1500, "luna").removeMs, 1500);
  assert.equal(Logic.buildGhostWalkerView(0, "motion-flinch", undefined, "luna").removeMs, 3200);
  assert.equal(Logic.buildGhostWalkerView(0, "", undefined, "luna"), null);
  assert.equal(Logic.buildGhostWalkerView(0, null, undefined, "luna"), null);
});

test("buildStageFlashView：赤フラッシュのクラス flash-red と時間 1000ms を返す", () => {
  assert.equal(Logic.STAGE_FLASH_CLASS, "flash-red");
  assert.equal(Logic.STAGE_FLASH_MS, 1000);
  assert.equal(JSON.stringify(Logic.buildStageFlashView()), JSON.stringify({ className: "flash-red", ms: 1000 }));
});

test("OWN_ACTION_FAMILIES：行動種別→モーション系統の対応表", () => {
  assert.equal(JSON.stringify(Logic.OWN_ACTION_FAMILIES), JSON.stringify({
    investigate: "peek", spy: "peek", lookout: "peek",
    protect: "guard", revive: "guard", block: "guard",
    track: "sneak", attack: "slash", plant: "plant", trap: "plant",
  }));
  assert.equal(Logic.OWN_ACTION_FAMILIES.unknown, undefined);
});

test("buildOwnActionMotionView：系統と左右からクラス名を決める", () => {
  assert.equal(Logic.OWN_ACTION_MOTION_MS, 1800);
  assert.equal(JSON.stringify(Logic.buildOwnActionMotionView(0, 3, "investigate")), JSON.stringify({
    className: "motion-own-peek-r",
    removeClasses: ["motion-own-peek-r", "motion-own-peek-l"],
    ms: 1800,
  }));
  assert.equal(Logic.buildOwnActionMotionView(3, 0, "attack").className, "motion-own-slash-l");
  assert.equal(Logic.buildOwnActionMotionView(2, 2, "protect").className, "motion-own-guard-r", "同じ id は右扱い（旧版の >= と同じ）");
  assert.equal(Logic.buildOwnActionMotionView(0, 1, "track").className, "motion-own-sneak-r");
  assert.equal(Logic.buildOwnActionMotionView(0, 1, "plant").className, "motion-own-plant-r");
  assert.equal(Logic.buildOwnActionMotionView(0, 1, "trap").className, "motion-own-plant-r");
  assert.equal(Logic.buildOwnActionMotionView(0, 1, "unknown"), null);
  assert.equal(Logic.buildOwnActionMotionView(0, 1, undefined), null);
});

test("ブラウザ側の stageBounce／stageEventMotion／stageFlashRed は共有モジュールと同一に動く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  FB.draw();
  const stage = elements.get("stage");
  const walker0 = stage.querySelector('.walker[data-player="0"]');
  assert.ok(walker0, "歩行者 0 がいる");
  assert.equal(walker0.classList.contains("speaking"), false, "ホップ前は speaking なし");
  FB.stageBounce(0);
  assert.equal(walker0.classList.contains("speaking"), true, "ホップで speaking が付く");
  assert.equal(JSON.stringify(FB.buildStageBounceViewLogic()), JSON.stringify(Logic.buildStageBounceView()));
  FB.stageEventMotion(0, "motion-revive");
  assert.equal(walker0.classList.contains("motion-revive"), true, "汎用モーションのクラスが付く");
  assert.equal(JSON.stringify(FB.buildStageEventMotionViewLogic("motion-revive")), JSON.stringify(Logic.buildStageEventMotionView("motion-revive")));
  assert.equal(stage.classList.contains("flash-red"), false, "フラッシュ前は flash-red なし");
  FB.stageFlashRed();
  assert.equal(stage.classList.contains("flash-red"), true, "赤フラッシュが付く");
  assert.equal(JSON.stringify(FB.buildStageFlashViewLogic()), JSON.stringify(Logic.buildStageFlashView()));
});

test("ブラウザ側の stageOwnActionMotion は共有モジュールの表示データと同一に動く", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  FB.draw();
  const stage = elements.get("stage");
  assert.equal(JSON.stringify(FB.buildOwnActionMotionViewLogic(0, 3, "investigate")), JSON.stringify(Logic.buildOwnActionMotionView(0, 3, "investigate")));
  assert.equal(JSON.stringify(FB.OWN_ACTION_FAMILIES), JSON.stringify(Logic.OWN_ACTION_FAMILIES));
  FB.stageOwnActionMotion(0, 3, "investigate");
  assert.equal(stage.querySelector('.walker[data-player="0"]').classList.contains("motion-own-peek-r"), true, "調査は右への peek");
  FB.stageOwnActionMotion(3, 0, "attack");
  assert.equal(stage.querySelector('.walker[data-player="3"]').classList.contains("motion-own-slash-l"), true, "襲撃は左への slash");
  // 対応表にない種別は何もしない。
  FB.stageOwnActionMotion(0, 3, "unknown");
  assert.equal(stage.querySelector('.walker[data-player="0"]').classList.contains("motion-own-peek-r"), true, "未知の種別で既存クラスは変わらない");
});

test("ブラウザ側の stageGhostWalker は共有モジュールの表示データと同一に幽霊歩行者を作る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  // 3番を脱落させて描き直すとステージから歩行者が消える。
  FB.state.players[3].alive = false;
  FB.draw();
  const stage = elements.get("stage");
  assert.equal(stage.querySelector('.walker[data-player="3"]'), null, "脱落者の歩行者はステージにいない");
  const before = stage.children.length;
  FB.stageGhostWalker(3, "motion-blast");
  assert.equal(stage.children.length, before + 1, "幽霊歩行者が1つ増える");
  const ghost = stage.children[stage.children.length - 1];
  const view = Logic.buildGhostWalkerView(3, "motion-blast", undefined, "kanon");
  assert.equal(ghost.className, view.className);
  assert.equal(ghost.getAttribute("data-player"), String(view.playerId));
  assert.equal(ghost.getAttribute("style"), view.style);
  assert.equal(ghost.innerHTML, view.innerHtml);
  // 歩行者がまだいる場合はゴーストを作らず汎用モーションに委譲する。
  const before2 = stage.children.length;
  FB.stageGhostWalker(0, "motion-flinch");
  assert.equal(stage.children.length, before2, "歩行者がいる場合は増えない");
  assert.equal(stage.querySelector('.walker[data-player="0"]').classList.contains("motion-flinch"), true, "代わりに汎用モーションが付く");
});

// ---- フェーズ0第29歩：夜のカットイン組み立ての抽出 ----

function fakeNightPlayers(roleKeys) {
  return Logic.PLAYER_NAMES.map((name, id) => ({
    id, name, icon: Logic.PLAYER_ICONS[id],
    roleKey: (roleKeys && roleKeys[id]) || "villager", alive: true,
  }));
}
function fakeNightState(overrides = {}) {
  return {
    mode: "solo",
    players: fakeNightPlayers(),
    nightActionTypes: {},
    humanBlocked: false,
    nightReport: null,
    bombReport: null,
    trapReport: null,
    doctorReport: null,
    ...overrides,
  };
}

test("NIGHT_ACTION_CUTIN_META：夜行動10種のタイトルと種類", () => {
  assert.equal(Object.keys(Logic.NIGHT_ACTION_CUTIN_META).length, 10);
  assert.deepEqual(Logic.NIGHT_ACTION_CUTIN_META.investigate, ["🔍 調査", "info"]);
  assert.deepEqual(Logic.NIGHT_ACTION_CUTIN_META.protect, ["🛡️ 護衛", "protect"]);
  assert.deepEqual(Logic.NIGHT_ACTION_CUTIN_META.attack, ["🗡️ 襲撃", "attack"]);
  assert.deepEqual(Logic.NIGHT_ACTION_CUTIN_META.plant, ["💣 爆弾設置", "bomb"]);
  assert.deepEqual(Logic.NIGHT_ACTION_CUTIN_META.revive, ["💉 診察", "protect"]);
  assert.deepEqual(Logic.NIGHT_ACTION_CUTIN_META.lookout, ["🔭 見張り", "info"]);
  assert.equal(Logic.NIGHT_ACTION_CUTIN_META.unknown, undefined);
});

test("buildNightCutinsView：行動なしの夜は『🌙 夜行動』だけ", () => {
  const state = fakeNightState();
  const me = state.players[0];
  const target = state.players[1];
  const view = Logic.buildNightCutinsView(state, me, target, null);
  assert.equal(view.celebrate, false);
  assert.equal(view.items.length, 1);
  assert.equal(JSON.stringify(view.items[0]), JSON.stringify({
    title: "🌙 夜行動", sub: "あなたは静かに夜を過ごした", kind: "phase",
    charId: null, targetCharId: null, motion: null, onShow: null,
  }));
});

test("buildNightCutinsView：役職の夜行動と nightActionTypes の上書き", () => {
  const state = fakeNightState();
  state.players[0].roleKey = "apprenticeSeer";
  const me = state.players[0];
  const target = state.players[2];
  const view = Logic.buildNightCutinsView(state, me, target, null);
  assert.equal(view.items.length, 1);
  assert.equal(JSON.stringify(view.items[0]), JSON.stringify({
    title: "🔍 調査", sub: `→ ${target.name}`, kind: "info",
    charId: 0, targetCharId: 2, motion: "peek",
    onShow: { kind: "ownAction", meId: 0, targetId: 2, type: "investigate" },
  }));
  // nightActionTypes があれば役職の能力よりそちらが優先される。
  state.nightActionTypes = { 0: "protect" };
  const view2 = Logic.buildNightCutinsView(state, me, target, null);
  assert.equal(view2.items[0].title, "🛡️ 護衛");
  assert.equal(view2.items[0].kind, "protect");
  assert.equal(view2.items[0].motion, "guard");
  assert.equal(view2.items[0].onShow.type, "protect");
});

test("buildNightCutinsView：妨害された夜は妨害だけ・未知の種別は出ない", () => {
  const state = fakeNightState({ humanBlocked: true });
  state.players[0].roleKey = "apprenticeSeer";
  const view = Logic.buildNightCutinsView(state, state.players[0], state.players[1], null);
  assert.equal(view.items.length, 1);
  assert.equal(view.items[0].title, "✋ 妨害された！");
  assert.equal(view.items[0].kind, "attack");
  assert.equal(view.items[0].onShow, null);
  // 未知の種別は個人カットインを出さない（旧版の meta なしと同じ）。
  const state2 = fakeNightState({ nightActionTypes: { 0: "unknown" } });
  const view2 = Logic.buildNightCutinsView(state2, state2.players[0], state2.players[1], null);
  assert.equal(view2.items.length, 0);
  assert.equal(view2.celebrate, false);
});

test("buildNightCutinsView：襲撃・爆弾・罠・蘇生の公開カットインと順番", () => {
  const state = fakeNightState({
    nightReport: { type: "eliminated", victimId: 1 },
    bombReport: { explodedVictims: [2, 3], fizzled: false },
    trapReport: { attackerId: 4 },
    doctorReport: { victimId: 5 },
  });
  const view = Logic.buildNightCutinsView(state, state.players[0], state.players[6], "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！");
  assert.equal(view.celebrate, true);
  assert.deepEqual(view.items.map((i) => i.title), [
    "🌙 夜行動", "🌙 夜の襲撃", "💣 爆弾が爆発！", "💣 爆弾が爆発！",
    "🪤 罠が作動！", "💉 蘇生した！", "🎉 イノセント陣営の勝利！インポスターを全員追放したよ！",
  ]);
  const [personal, eliminated, bomb1, bomb2, trap, doctor, win] = view.items;
  assert.equal(personal.onShow, null);
  assert.equal(JSON.stringify(eliminated.onShow), JSON.stringify({ kind: "ghost", victimId: 1, motion: "motion-flinch", flash: true }));
  assert.equal(eliminated.sub, `${state.players[1].name} が倒れた…`);
  assert.equal(eliminated.kind, "attack");
  assert.equal(JSON.stringify(bomb1.onShow), JSON.stringify({ kind: "ghost", victimId: 2, motion: "motion-blast", flash: false }));
  assert.equal(JSON.stringify(bomb2.onShow), JSON.stringify({ kind: "ghost", victimId: 3, motion: "motion-blast", flash: false }));
  assert.equal(JSON.stringify(trap.onShow), JSON.stringify({ kind: "ghost", victimId: 4, motion: "motion-trap", flash: false }));
  assert.equal(JSON.stringify(doctor.onShow), JSON.stringify({ kind: "revive", victimId: 5, motion: "motion-revive" }));
  assert.equal(doctor.sub, `${state.players[5].name} が助かった`);
  assert.equal(win.kind, "win");
  assert.equal(win.sub, "");
  assert.equal(win.onShow, null);
});

test("buildNightCutinsView：襲撃防衛と爆弾不発はモーションなしの protect", () => {
  const state = fakeNightState({
    nightReport: { type: "blocked" },
    bombReport: { explodedVictims: [], fizzled: true },
  });
  const view = Logic.buildNightCutinsView(state, state.players[0], state.players[1], null);
  assert.equal(view.celebrate, false);
  assert.deepEqual(view.items.map((i) => i.title), ["🌙 夜行動", "🛡️ 襲撃は防がれた！", "💣 爆弾は不発だった"]);
  assert.ok(view.items.every((i) => i.onShow === null), "どれも表示時モーションなし");
  assert.equal(view.items[1].kind, "protect");
  assert.equal(view.items[2].kind, "protect");
});

test("buildNightCutinsView：パス＆プレイでは個人カットインが出ない", () => {
  const state = fakeNightState({ mode: "pnp", nightReport: { type: "eliminated", victimId: 1 } });
  state.players[0].roleKey = "apprenticeSeer";
  const view = Logic.buildNightCutinsView(state, { id: -1 }, state.players[1], null);
  assert.deepEqual(view.items.map((i) => i.title), ["🌙 夜の襲撃"]);
  assert.equal(view.celebrate, false);
});

test("buildNightCutinsView：純粋性（同じ入力で同じ結果・入力を変更しない）", () => {
  const state = fakeNightState({
    nightReport: { type: "eliminated", victimId: 1 },
    bombReport: { explodedVictims: [2], fizzled: false },
  });
  state.players[0].roleKey = "guardian";
  const before = JSON.stringify(state);
  const a = Logic.buildNightCutinsView(state, state.players[0], state.players[3], "win");
  const b = Logic.buildNightCutinsView(state, state.players[0], state.players[3], "win");
  assert.equal(JSON.stringify(a), JSON.stringify(b), "同じ入力で同じ結果");
  assert.equal(JSON.stringify(state), before, "入力 state を変更しない");
});

test("ブラウザ側の nightCutins は共有モジュールの buildNightCutinsView と同一にキューを作る", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const me = s.players[s.playerId];
  me.roleKey = "apprenticeSeer";
  const target = s.players.find((p) => p.id !== me.id);
  const victim = s.players.find((p) => p.id !== me.id && p.id !== target.id);
  victim.alive = false;
  s.nightActionTypes = {};
  s.nightReport = { type: "eliminated", victimId: victim.id };
  s.bombReport = { explodedVictims: [], fizzled: false };
  FB.draw();
  const view = Logic.buildNightCutinsView(s, me, target, null);
  assert.equal(JSON.stringify(FB.buildNightCutinsViewLogic(s, me, target, null)), JSON.stringify(view));
  FB.nightCutins(me, target, null);
  // 先頭は即表示され、残りがキューに残る。
  const shown = [elements.get("cutinTitle").textContent, ...FB.cutinQueue.map((i) => i.title)];
  assert.deepEqual(shown, view.items.map((i) => i.title));
  // 個人カットインを送ると襲撃カットインが出て、幽霊歩行者と赤フラッシュが付く。
  const stage = elements.get("stage");
  const before = stage.children.length;
  elements.get("cutin").onclick();
  assert.equal(elements.get("cutinTitle").textContent, "🌙 夜の襲撃");
  assert.equal(stage.children.length, before + 1, "幽霊歩行者が増える");
  assert.match(stage.children[stage.children.length - 1].className, /motion-flinch/);
  assert.equal(stage.classList.contains("flash-red"), true, "赤フラッシュが付く");
});

test("buildRevealMouseView：イノセント公開は疑念 -5・文言とログとカットイン", () => {
  const players = fakeNightPlayers();
  const actor = { ...players[0], roleKey: "mouse" };
  const target = { ...players[1], roleKey: "villager" };
  const view = Logic.buildRevealMouseView(actor, target);
  assert.equal(view.shownRoleKey, "villager");
  assert.equal(view.suspicion, -5);
  assert.equal(view.mouseLine, `ここでマウス能力！ ${target.name} は… 村ガール（イノセント）だよ！`);
  assert.equal(view.dialogueText, `🐭 ${actor.name}「${view.mouseLine}」`);
  assert.equal(view.logText, `[公開] ${target.name} → 役職: 村ガール / 陣営: イノセント`);
  assert.equal(JSON.stringify(view.cutin), JSON.stringify({
    title: "🐭 役職公開", sub: `${target.name} は 村ガール`, kind: "info",
    charId: target.id, targetCharId: null, motion: null,
  }));
});

test("buildRevealMouseView：インポスター公開は疑念 8", () => {
  const players = fakeNightPlayers();
  const actor = { ...players[0], roleKey: "mouse" };
  const target = { ...players[1], roleKey: "fakeGirl" };
  const view = Logic.buildRevealMouseView(actor, target);
  assert.equal(view.shownRoleKey, "fakeGirl");
  assert.equal(view.suspicion, 8);
  assert.equal(view.mouseLine, `ここでマウス能力！ ${target.name} は… フェイクガール（インポスター）だよ！`);
  assert.equal(view.logText, `[公開] ${target.name} → 役職: フェイクガール / 陣営: インポスター`);
  assert.equal(view.cutin.sub, `${target.name} は フェイクガール`);
});

test("buildRevealMouseView：バカが公開する側はバカ以外の役職をランダムに選ぶ", () => {
  const players = fakeNightPlayers();
  const actor = { ...players[0], roleKey: "baka" };
  const target = { ...players[1], roleKey: "villager" };
  // 注入した乱数で先頭と末尾が決定的に選ばれる（旧版の rand と同じ選び方）。
  assert.equal(Logic.buildRevealMouseView(actor, target, { random: () => 0 }).shownRoleKey, "apprenticeSeer");
  assert.equal(Logic.buildRevealMouseView(actor, target, { random: () => 0.999 }).shownRoleKey, "bomber");
  // どの乱数でもバカ自身は選ばれない。
  for (let i = 0; i < 20; i++) {
    const shown = Logic.buildRevealMouseView(actor, target, { random: () => i / 20 }).shownRoleKey;
    assert.notEqual(shown, "baka", `バカは選ばれない: ${shown}`);
  }
});

test("buildRevealMouseView：バカの対象は表示役職が出る", () => {
  const players = fakeNightPlayers();
  const actor = { ...players[0], roleKey: "mouse" };
  const target = { ...players[1], roleKey: "baka", fakeDisplayRoleKey: "tracker" };
  const view = Logic.buildRevealMouseView(actor, target);
  assert.equal(view.shownRoleKey, "tracker");
  assert.equal(view.suspicion, -5);
  assert.ok(view.mouseLine.includes("追跡係"), `表示役職で公開される: ${view.mouseLine}`);
  assert.ok(!view.mouseLine.includes("バカ"), `実役職は出ない: ${view.mouseLine}`);
});

test("buildRevealMouseView：不正な入力は null・純粋性", () => {
  const players = fakeNightPlayers();
  const actor = { ...players[0], roleKey: "mouse" };
  const target = { ...players[1], roleKey: "villager" };
  assert.equal(Logic.buildRevealMouseView(null, target), null);
  assert.equal(Logic.buildRevealMouseView(actor, null), null);
  assert.equal(Logic.buildRevealMouseView(actor, { ...target, roleKey: "unknownRole" }), null);
  const beforeActor = JSON.stringify(actor);
  const beforeTarget = JSON.stringify(target);
  const a = Logic.buildRevealMouseView(actor, target, { random: () => 0.5 });
  const b = Logic.buildRevealMouseView(actor, target, { random: () => 0.5 });
  assert.equal(JSON.stringify(a), JSON.stringify(b), "同じ入力で同じ結果");
  assert.equal(JSON.stringify(actor), beforeActor, "actor を変更しない");
  assert.equal(JSON.stringify(target), beforeTarget, "target を変更しない");
});

test("ブラウザ側の revealMouse は共有モジュールの buildRevealMouseView と同一に表示する", () => {
  const { FB, elements } = loadGame({ seedSettings: BASE_SETTINGS });
  FB.setupGame();
  const s = FB.state;
  const me = s.players[s.playerId];
  me.roleKey = "mouse";
  const target = s.players.find((p) => p.id !== me.id);
  target.roleKey = "villager";
  const view = Logic.buildRevealMouseView(me, target);
  const before = elements.get("dialogueLog").children.length;
  FB.revealMouse(me, target);
  assert.equal(FB.state.revealedRoles[target.id], view.shownRoleKey);
  assert.equal(target.suspicion, view.suspicion);
  assert.equal(me.mouseUsed, true);
  const dialogueLines = elements.get("dialogueLog").children.slice(before).map((c) => c.textContent);
  assert.deepEqual(dialogueLines, [view.dialogueText]);
  const actionLines = elements.get("actionLog").children.map((c) => c.textContent);
  assert.ok(actionLines.includes(view.logText), `行動ログに公開行がある: ${actionLines.join(" / ")}`);
  assert.equal(elements.get("cutinTitle").textContent, view.cutin.title);
  assert.equal(elements.get("cutinSub").textContent, view.cutin.sub);
});
