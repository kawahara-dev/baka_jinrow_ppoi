// Fake Bloom オンライン対戦 フェーズ1 第2歩：配役とプレイヤー別ビュー。
// 試合の進行（夜・議論・投票）は後の歩で追加する。ここでは部屋の
// プレイヤーへ 8 席分の役職を配り、席ごとに「見てよい情報だけ」を
// 組み立てる。実役職・うっかり flag・他人の夜入力はサーバー内に留め、
// クライアントへ送る player view には絶対に含めない（設計メモ §8）。
// - バカには表示役職だけを送る。本人は自分がバカだと分からない。
// - うっかり個体の占い師も、本人を含め誰にも flag を送らない。
// - インポスター同士は仲間の名前だけを知る（役職キーは送らない）。
// - 人間のいない席は CPU 席として役職だけ配っておく（補充は第5歩）。
// 試合ロジックは共有モジュール game-logic.js の dealRoles を使う。
"use strict";

const {
  ROLES,
  PLAYER_NAMES,
  PLAYER_ICONS,
  DEFAULT_SETTINGS,
  dealRoles,
} = require("../game-logic.js");

const IMPOSTOR_ROLE_KEYS = ["fakeGirl", "mimic"];
const MIN_PLAYERS_TO_START = 2;

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
    };
  });
  return { code, players, phase: "night", day: 1 };
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

module.exports = {
  createGame,
  validateStart,
  playerView,
  IMPOSTOR_ROLE_KEYS,
  MIN_PLAYERS_TO_START,
};
