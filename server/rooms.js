// Fake Bloom オンライン対戦 フェーズ1：部屋とセッションの管理。
// ゲームの進行は扱わない。部屋の作成/参加、セッショントークン、
// キャラの自動割当（入室順に PLAYER_NAMES / PLAYER_ICONS）だけを担う。
// 秘匿の要：トークンは部屋の参加者本人だけが持つ。再接続の本人確認に使う。
// publicPlayers() が返す一覧にはトークンを含めないこと。
"use strict";

const crypto = require("node:crypto");
const {
  PLAYER_NAMES,
  PLAYER_ICONS,
  DEFAULT_ROOM_SETTINGS,
  normalizeRoomSettings,
} = require("../game-logic.js");

const MAX_PLAYERS = 8;
// 見間違いやすい文字（0/O、1/I/l）を除いた 4 文字コード。
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 4;

function createRoomStore(deps = {}) {
  const randomBytes = deps.randomBytes || crypto.randomBytes;
  const randomUUID = deps.randomUUID || crypto.randomUUID;
  const now = deps.now || Date.now;
  const rooms = new Map();

  function makeCode() {
    for (let attempt = 0; attempt < 20; attempt++) {
      const bytes = randomBytes(ROOM_CODE_LENGTH);
      let code = "";
      for (const b of bytes) code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length];
      if (!rooms.has(code)) return code;
    }
    throw new Error("could not allocate room code");
  }

  function assignCharacter(seat) {
    return { name: PLAYER_NAMES[seat], icon: PLAYER_ICONS[seat] };
  }

  function addPlayer(room) {
    const seat = room.players.length;
    const character = assignCharacter(seat);
    const player = {
      id: seat,
      token: randomUUID(),
      name: character.name,
      icon: character.icon,
      connected: true,
    };
    room.players.push(player);
    return player;
  }

  // 公開してよい参加者一覧。トークンは含めない。
  function publicPlayers(room) {
    return room.players.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      connected: p.connected,
    }));
  }

  function normalizeCode(code) {
    return typeof code === "string" ? code.trim().toUpperCase() : "";
  }

  // 部屋設定はホストの初期設定で始まる（フェーズ2 第1歩）。
  // なければ既定値。検証は共有モジュール（normalizeRoomSettings）。
  function createRoom(settings) {
    const room = {
      code: makeCode(),
      createdAt: now(),
      players: [],
      game: null,
      settings: normalizeRoomSettings(settings),
    };
    rooms.set(room.code, room);
    const player = addPlayer(room);
    return { room, player };
  }

  // ホストが部屋設定を変える（フェーズ2 第1歩）。検証済みの設定を
  // 返し、部屋へ反映する。指定のないキーは今の部屋設定のままにする
  // （一部のキーだけ送っても、他のキーが既定値に戻らないようにする）。
  // ホストかどうか・試合開始前かどうかは呼び出し側（server.js）が見る。
  function setRoomSettings(room, settings) {
    room.settings = normalizeRoomSettings({ ...room.settings, ...(settings || {}) });
    return room.settings;
  }

  function joinRoom(code) {
    const room = rooms.get(normalizeCode(code));
    if (!room) return { error: "room_not_found" };
    if (room.players.length >= MAX_PLAYERS) return { error: "room_full" };
    const player = addPlayer(room);
    return { room, player };
  }

  function reconnect(code, token) {
    const room = rooms.get(normalizeCode(code));
    if (!room) return { error: "room_not_found" };
    const player = room.players.find((p) => p.token === token);
    if (!player) return { error: "bad_token" };
    player.connected = true;
    return { room, player };
  }

  function disconnect(code, token) {
    const room = rooms.get(normalizeCode(code));
    if (!room) return false;
    const player = room.players.find((p) => p.token === token);
    if (!player) return false;
    player.connected = false;
    return true;
  }

  function getRoom(code) {
    return rooms.get(normalizeCode(code)) || null;
  }

  return {
    createRoom,
    joinRoom,
    reconnect,
    disconnect,
    getRoom,
    publicPlayers,
    setRoomSettings,
    DEFAULT_ROOM_SETTINGS,
    normalizeRoomSettings,
    MAX_PLAYERS,
    ROOM_CODE_ALPHABET,
    ROOM_CODE_LENGTH,
  };
}

module.exports = {
  createRoomStore,
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  DEFAULT_ROOM_SETTINGS,
  normalizeRoomSettings,
};
