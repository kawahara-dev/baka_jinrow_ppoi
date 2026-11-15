// 実行方法: リポジトリのルートで `node --test server/tests/ws.test.js`
// WebSocket 最小実装（server/ws.js）のテスト。RFC 6455 の既知の値で検証する。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { computeAcceptKey, encodeFrame, encodeTextFrame, decodeFrames } = require("../ws.js");

test("ハンドシェイクの Accept キーは RFC 6455 の例と一致する", () => {
  assert.equal(computeAcceptKey("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
});

test("サーバーのテキストフレームはマスクなしで短い payload を往復できる", () => {
  const frame = encodeTextFrame("hello");
  assert.equal(frame[0], 0x81);
  assert.equal(frame[1], 5);
  assert.equal(frame.subarray(2).toString("utf8"), "hello");
});

test("126 バイト以上の payload は拡張長で往復できる", () => {
  const text = "あ".repeat(200);
  const frame = encodeTextFrame(text);
  assert.equal(frame[1], 126);
  assert.equal(frame.readUInt16BE(2), Buffer.byteLength(text));
  assert.equal(frame.subarray(4).toString("utf8"), text);
});

// クライアントフレーム（マスク付き）を手で組み立てる。
function maskedClientFrame(text, mask = Buffer.from([1, 2, 3, 4])) {
  const data = Buffer.from(text, "utf8");
  const header = Buffer.from([0x81, 0x80 | data.length]);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

test("マスク付きクライアントフレームを復号できる", () => {
  const { frames, rest } = decodeFrames(maskedClientFrame("create"));
  assert.equal(rest.length, 0);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].opcode, 1);
  assert.equal(frames[0].payload.toString("utf8"), "create");
});

test("途中で届いたフレームは rest に残り、続きと合わせて読める", () => {
  const full = maskedClientFrame("join");
  const first = decodeFrames(full.subarray(0, 4));
  assert.equal(first.frames.length, 0);
  assert.equal(first.rest.length, 4);
  const second = decodeFrames(Buffer.concat([first.rest, full.subarray(4)]));
  assert.equal(second.frames.length, 1);
  assert.equal(second.frames[0].payload.toString("utf8"), "join");
});

test("複数フレームが一度に届いたら全部読める", () => {
  const buf = Buffer.concat([maskedClientFrame("a"), maskedClientFrame("b")]);
  const { frames } = decodeFrames(buf);
  assert.equal(frames.length, 2);
  assert.equal(frames[0].payload.toString("utf8"), "a");
  assert.equal(frames[1].payload.toString("utf8"), "b");
});

test("マスクなしのクライアントフレームは拒否する", () => {
  const frame = encodeFrame("hello", 1);
  assert.throws(() => decodeFrames(frame), /unmasked/);
});

test("ping フレームの opcode が読める", () => {
  const frame = encodeFrame("ping!", 9);
  // サーバー発の encodeFrame はマスクなしなので、ここでは手組みのマスク付き ping を使う。
  const data = Buffer.from("ping!", "utf8");
  const mask = Buffer.from([9, 9, 9, 9]);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  const ping = Buffer.concat([Buffer.from([0x89, 0x80 | data.length]), mask, masked]);
  const { frames } = decodeFrames(ping);
  assert.equal(frames[0].opcode, 9);
  assert.equal(frames[0].payload.toString("utf8"), "ping!");
  assert.equal(frame[0], 0x89);
});
