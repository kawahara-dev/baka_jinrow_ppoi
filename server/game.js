// Fake Bloom オンライン対戦 フェーズ1 第3歩：夜フェーズ。
// 試合の進行（夜・議論・投票）は後の歩で追加する。ここでは部屋の
// プレイヤーへ 8 席分の役職を配り、席ごとに「見てよい情報だけ」を
// 組み立てる。実役職・うっかり flag・他人の夜入力はサーバー内に留め、
// クライアントへ送る player view には絶対に含めない（設計メモ §8）。
// - バカには表示役職だけを送る。本人は自分がバカだと分からない。
// - うっかり個体の占い師も、本人を含め誰にも flag を送らない。
// - インポスター同士は仲間の名前だけを知る（役職キーは送らない）。
// - 人間のいない席は CPU 席として役職だけ配っておく（補充は第5歩）。
// 夜フェーズ：人間の夜入力（nightAction）を集め、全員分が揃うか
// タイムアウト（設計メモ §6、目安60秒）で共有モジュールの
// planNightActions／resolveNightActions で一括解決する。未入力は
// 「行動しない」扱い（＝ CPU 扱い）。夜の解決はパス＆プレイ流で
// 行う（mode "pnp"＋humanPlayerIds＋pnpNightInputs）：複数人間の
// 夜入力をそのまま扱え、インポスター人間の代表者の入力が襲撃先に
// なるのも同じ仕組みだから。mode はサーバー内部の流用であって、
// クライアントへ送るものではない。
// 試合ロジックは共有モジュール game-logic.js の dealRoles を使う。
"use strict";

const {
  ROLES,
  PLAYER_NAMES,
  PLAYER_ICONS,
  DEFAULT_SETTINGS,
  dealRoles,
  getEffectiveRoleKey,
  getPublicRoleKey,
  planNightActions,
  resolveNightActions,
} = require("../game-logic.js");

const IMPOSTOR_ROLE_KEYS = ["fakeGirl", "mimic"];
const MIN_PLAYERS_TO_START = 2;
// 夜の入力締め切り（設計メモ §6 の目安60秒）。createServer の
// options.nightTimeoutMs で上書きできる（テスト用）。
const NIGHT_TIMEOUT_MS = 60000;

// 役職を配り、サーバー内だけが持つ試合状態を作る。
// roomPlayers: 部屋の players（id / name / icon）。8 席に満たない分は
// CPU 席になる。settings は dealRoles 用（fakeCount / bomber）。
// random は () => [0,1) の注入可能な乱数源（既定は Math.random）。
function createGame(code, roomPlayers, settings, random) {
  const dealt = dealRoles(settings || DEFAULT_SETTINGS, random);
  const players = dealt.map((dealtRole, seat) => {
    const human = roomPlayers.find((p) => p.id === seat);
    return {
      id: seat,
      name: human ? human.name : PLAYER_NAMES[seat],
      icon: human ? human.icon : PLAYER_ICONS[seat],
      roleKey: dealtRole.roleKey,
      fakeDisplayRoleKey: dealtRole.fakeDisplayRoleKey,
      clumsy: dealtRole.clumsy,
      alive: true,
      isCpu: !human,
      // 結果画面まで公開しない役職（脱落時の公開などは後の歩で立てる）。
      publicRoleKey: null,
      // 夜の解決（共有モジュール）が読む・書く状態。初期値はソロと同じ。
      suspicion: 0,
      lastTarget: null,
    };
  });
  return {
    code,
    players,
    phase: "night",
    day: 1,
    settings: settings || DEFAULT_SETTINGS,
    // 夜の解決は共有モジュールのパス＆プレイ流（mode "pnp"）で回す。
    // humanPlayerIds は人間の席、pnpNightInputs は集まった夜入力。
    mode: "pnp",
    humanPlayerIds: roomPlayers.map((p) => p.id),
    pnpNightInputs: {},
    bombs: [],
    fakeIntel: {},
    nightActions: {},
    nightActionTypes: {},
    protectedTargets: new Set(),
    loneFakeAbility: null,
    nightReport: null,
    bombReport: null,
  };
}

// 開始できるかどうかの判定。開始できない理由のエラー文字列、
// 開始できる場合は null を返す。ホスト（作成者 = id 0）だけが開始できる。
function validateStart(room, playerId) {
  if (!room) return "room_not_found";
  if (room.game) return "game_already_started";
  if (playerId !== 0) return "not_host";
  if (room.players.length < MIN_PLAYERS_TO_START) return "not_enough_players";
  return null;
}

// そのプレイヤーだけが見てよい情報（player view）を組み立てる。
// サーバー内の実役職・うっかり flag・トークンは含まない。
// - me.roleKey はバカなら表示役職、占い師なら見習い占い師（clumsy 隠し）。
// - allies はインポスター同士の名前だけ（役職キーは送らない）。
// - players 一覧は生存・CPU 席・公開済み役職（開始時は全員 null）だけ。
function playerView(game, playerId) {
  const me = game.players.find((p) => p.id === playerId);
  if (!me) return null;
  const shownRoleKey = me.roleKey === "baka" ? me.fakeDisplayRoleKey : me.roleKey;
  const shownRole = ROLES[shownRoleKey];
  const isImpostor = IMPOSTOR_ROLE_KEYS.includes(me.roleKey);
  const allies = isImpostor
    ? game.players
        .filter((p) => p.id !== me.id && IMPOSTOR_ROLE_KEYS.includes(p.roleKey))
        .map((p) => ({ id: p.id, name: p.name, icon: p.icon }))
    : [];
  return {
    code: game.code,
    phase: game.phase,
    day: game.day,
    me: {
      id: me.id,
      name: me.name,
      icon: me.icon,
      roleKey: shownRoleKey,
      roleName: shownRole.name,
      faction: shownRole.faction,
      allies,
    },
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      alive: p.alive,
      isCpu: p.isCpu,
      publicRoleKey: p.publicRoleKey,
    })),
  };
}



// その席の人間が今夜の入力をする必要があるか。共有モジュールの
// planNightActions が行動を立てる席と一致させる。
// - 実役職がインポスター（fakeGirl／mimic）：襲撃または能力の入力。
// - バカがインポスターを表示：夜行動なし（planNightActions も立てない）。
// - それ以外：表示役職に夜行動がある席（占い・護衛・追跡・ポリス・
//   見張り・罠・診察・爆弾）。能力なしの役職（村人・政治家・ネズミ等）は不要。
function needsNightInput(game, playerId) {
  const p = game.players.find((x) => x.id === playerId);
  if (!p || !p.alive || p.isCpu) return false;
  if (IMPOSTOR_ROLE_KEYS.includes(p.roleKey)) return true;
  const effective = getEffectiveRoleKey(p);
  if (IMPOSTOR_ROLE_KEYS.includes(effective)) return false;
  return !!ROLES[effective]?.nightAction;
}

// 人間の夜入力を受け付ける。成功したら null、ダメなら理由を返す。
// 対象は生存者のみ。自分を選べない役職は自分を弾く。インポスターは
// 仲間・自分を襲撃先（能力先）にできない。同じ人間が送り直したら
// 上書きする（解決までは気が変わってよい）。
function submitNightAction(game, playerId, targetId) {
  if (!game) return "no_game";
  if (game.phase !== "night") return "not_night";
  const p = game.players.find((x) => x.id === playerId);
  if (!p || p.isCpu) return "not_a_player";
  if (!p.alive) return "not_alive";
  if (!needsNightInput(game, playerId)) return "no_night_action";
  const target = game.players.find((x) => x.id === targetId);
  if (!target || !target.alive) return "invalid_target";
  if (IMPOSTOR_ROLE_KEYS.includes(p.roleKey)) {
    if (targetId === playerId || IMPOSTOR_ROLE_KEYS.includes(target.roleKey)) {
      return "invalid_target";
    }
  } else {
    const action = ROLES[getEffectiveRoleKey(p)]?.nightAction;
    if (action && action.allowSelf === false && targetId === playerId) {
      return "invalid_target";
    }
  }
  game.pnpNightInputs[playerId] = targetId;
  return null;
}

// 夜入力が必要な生存中の人間全員分が揃ったか。切断中の人間も数える
// （§7：切断中は未入力扱いで、タイムアウトで解決する）。
function nightInputsComplete(game) {
  if (!game || game.phase !== "night") return false;
  return game.players.every(
    (p) => !needsNightInput(game, p.id) || game.pnpNightInputs[p.id] !== undefined
  );
}

// 夜を一括解決する。共有モジュールの planNightActions で人間の入力と
// CPU の行動を合わせ、resolveNightActions で解決する。夜に倒れた者の
// 役職は公開ログで明かされるので view の publicRoleKey にも反映する。
// 解決したら phase を "morning" にし、夜入力を空にする。夜以外や
// 二重解決では null を返す。戻り値は夜の結果（公開ログ・席ごとの
// 個人ログ・夜の報告・爆弾の報告）。
function resolveNight(game, random) {
  if (!game || game.phase !== "night") return null;
  const alive = game.players.filter((p) => p.alive);
  const difficulty = game.settings?.difficulty || "normal";
  const plan = planNightActions(game, alive, { difficulty, random });
  game.nightActions = plan.nightActions;
  game.nightActionTypes = plan.nightActionTypes;
  game.protectedTargets = plan.protectedTargets;
  game.loneFakeAbility = plan.loneFakeAbility;
  const { logs } = resolveNightActions(game, alive, { meId: -1, difficulty, random });
  for (const p of game.players) {
    if (!p.alive && p.publicRoleKey === null) p.publicRoleKey = getPublicRoleKey(p);
  }
  game.phase = "morning";
  const result = {
    publicLogs: logs.filter((l) => l.scope === "public").map((l) => l.message),
    privateLogs: Object.fromEntries(
      logs.filter((l) => l.scope === "private").map((l) => [l.actorId, l.message])
    ),
    report: game.nightReport,
    bombReport: game.bombReport,
  };
  game.pnpNightInputs = {};
  return result;
}

// その席へ送る nightResolved メッセージ。個人ログはその席の分だけ
// （他人の夜結果は含まない）。view にも他人の実役職は出ない。
function nightResolvedMessage(game, result, playerId) {
  const view = playerView(game, playerId);
  if (!view || !result) return null;
  return {
    type: "nightResolved",
    code: game.code,
    view,
    night: {
      publicLogs: result.publicLogs,
      privateLog: result.privateLogs[playerId] || null,
      report: result.report,
      bombReport: result.bombReport,
    },
  };
}

module.exports = {
  createGame,
  validateStart,
  playerView,
  needsNightInput,
  submitNightAction,
  nightInputsComplete,
  resolveNight,
  nightResolvedMessage,
  IMPOSTOR_ROLE_KEYS,
  MIN_PLAYERS_TO_START,
  NIGHT_TIMEOUT_MS,
};
