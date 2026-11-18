// Fake Bloom オンライン対戦 フェーズ1：WebSocket の最小実装（RFC 6455）。
// Node 標準のみ（crypto）。ブラウザの WebSocket クライアントと話すための
// ハンドシェイク＋テキストフレームの送受信だけを担う。ゲームの進行は扱わない。
"use strict";

const crypto = require("node:crypto");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// RFC 6455 §1.3 の例：
// Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
// Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
function computeAcceptKey(key) {
  return crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
}

// サーバー→クライアントのフレーム（マスクなし）。payload は string | Buffer。
// 126 / 127 の拡張長にも対応する。opcode: 1 = text, 9 = ping, 10 = pong, 8 = close。
function encodeFrame(payload, opcode = 1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const len = data.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, data]);
}

function encodeTextFrame(text) {
  return encodeFrame(text, 1);
}

// クライアント→サーバー方向のフレーム列を1回分だけ読む。
// 戻り値 { frames, rest }：frames は { opcode, payload: Buffer, fin } の配列、
// rest は次のフレームの途中までしか届いていない未処理バイト列。
// クライアントのフレームはマスク必須（RFC 6455 §5.1）。マスクなしは不正として
// そのフレームを破棄せず rest に残して呼び出し側に判断させるのではなく、
// Error を投げて接続を切る（ブラウザは必ずマスクするので実害はない）。
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let cursor = offset + 2;
    if (len === 126) {
      if (cursor + 2 > buffer.length) break;
      len = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (len === 127) {
      if (cursor + 8 > buffer.length) break;
      const big = buffer.readBigUInt64BE(cursor);
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("frame too large");
      }
      len = Number(big);
      cursor += 8;
    }
    if (!masked) throw new Error("unmasked client frame");
    if (cursor + 4 > buffer.length) break;
    const mask = buffer.subarray(cursor, cursor + 4);
    cursor += 4;
    if (cursor + len > buffer.length) break;
    const payload = Buffer.alloc(len);
    for (let i = 0; i < len; i++) payload[i] = buffer[cursor + i] ^ mask[i % 4];
    frames.push({ opcode, payload, fin });
    offset = cursor + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

module.exports = { computeAcceptKey, encodeFrame, encodeTextFrame, decodeFrames };
