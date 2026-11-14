// Fake Bloom のゲームロジックを Node の vm で動かすためのテストハーネス。
// index.html の <script> を読み、IIFE の外枠だけ外して DOM スタブ付きの
// vm コンテキストで実行する。jsdom 等の外部依存は不要。
// 実行後に globalThis.__FB__ へゲーム内部（setupGame / runNight /
// checkWin / state など）を公開するので、テスト側から直接操作できる。
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

function makeElement(id) {
  const el = {
    id: id || "",
    textContent: "",
    className: "",
    dataset: {},
    style: {},
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    offsetWidth: 0,
    tabIndex: -1,
    onclick: null,
    // focus() はフォーカス移動の検証用に記録する（実 DOM の activeElement
    // までは再現しないが、どの要素へ移ったかは _focused で判定できる）。
    _focused: false,
    focus() { el._focused = true; },
    blur() { el._focused = false; },
    _attributes: {},
    _listeners: {},
    classList: {
      // 実際の classList と同じく状態を保持する。テストから表示・非表示
      // （hidden クラスの有無）を検証できるようにする。
      add(...names) { for (const n of names) el._classes.add(n); },
      remove(...names) { for (const n of names) el._classes.delete(n); },
      toggle(name, force) {
        const on = force === undefined ? !el._classes.has(name) : !!force;
        if (on) el._classes.add(name); else el._classes.delete(name);
        return on;
      },
      contains(name) { return el._classes.has(name); },
    },
    _classes: new Set(),
    appendChild(child) {
      // 実 DOM と同じく、既に別の親を持つ子はそちらから外してから付ける
      // （draw() での吹き出し付け直しなど、要素の移動を再現するため）。
      if (child._parent && child._parent !== el) {
        const i = child._parent.children.indexOf(child);
        if (i >= 0) child._parent.children.splice(i, 1);
      }
      child._parent = el; el.children.push(child); return child;
    },
    // 実 DOM と同じく、remove() は親の子リストから自分を外す
    // （吹き出し・ゴースト歩行者の消去をテストで検証できるようにする）。
    remove() {
      if (el._parent) {
        const i = el._parent.children.indexOf(el);
        if (i >= 0) el._parent.children.splice(i, 1);
        el._parent = null;
      }
    },
    setAttribute(name, value) { el._attributes[name] = String(value); },
    getAttribute(name) { return name in el._attributes ? el._attributes[name] : null; },
    removeAttribute(name) { delete el._attributes[name]; },
    addEventListener(type, fn) {
      if (!el._listeners[type]) el._listeners[type] = [];
      el._listeners[type].push(fn);
    },
    // テストからイベントを発火させるためのヘルパー。
    dispatch(type, event = {}) {
      for (const fn of el._listeners[type] || []) fn(event);
    },
    querySelector(sel) {
      // ステージの歩行者だけ、描画済みの innerHTML から解決する
      // （stageBounce / stageEventMotion / stageGhostWalker の検証用）。
      // それ以外は従来通り null。
      const m = typeof sel === "string" && sel.match(/^\.walker\[data-player="(\d+)"\]$/);
      if (!m) return null;
      if (!String(el.innerHTML).includes(`data-player="${m[1]}"`)) return null;
      if (!el._walkerStubs) el._walkerStubs = new Map();
      if (!el._walkerStubs.has(m[1])) el._walkerStubs.set(m[1], makeElement(`walker-${m[1]}`));
      return el._walkerStubs.get(m[1]);
    },
    querySelectorAll() { return []; },
    closest() { return el; },
    scrollIntoView() {},
  };
  // 実 DOM と同じく innerHTML = "" は子要素を消す。カードやログの
  // 再描画で children が溜まり続けるのを防ぐ。
  let _innerHTML = "";
  Object.defineProperty(el, "innerHTML", {
    get() { return _innerHTML; },
    set(v) {
      _innerHTML = String(v);
      if (_innerHTML === "") el.children.length = 0;
    },
    enumerable: true,
    configurable: true,
  });
  return el;
}

// AudioContext の最小スタブ。BGM の発音パス（oscillator / gain の生成・
 // 接続・開始・停止）が壊れていないことを、ブラウザ無しで確認するため。
// 生成したノード数とインスタンスを記録する。
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.state = "running";
    this.sampleRate = 44100;
    this.destination = {};
    this.createdOscillators = [];
    this.createdGains = [];
    this.resumed = false;
    FakeAudioContext.instances.push(this);
  }
  resume() { this.resumed = true; return Promise.resolve(); }
  createOscillator() {
    const osc = {
      type: "sine",
      frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() { return osc; },
      start() {}, stop() {},
    };
    this.createdOscillators.push(osc);
    return osc;
  }
  createGain() {
    const g = {
      gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() { return g; },
      disconnect() {},
    };
    this.createdGains.push(g);
    return g;
  }
  createBuffer() { return { getChannelData: () => new Float32Array(10) }; }
  createBufferSource() {
    const src = { buffer: null, connect() { return src; }, start() {}, stop() {} };
    return src;
  }
  createBiquadFilter() {
    const f = { type: "lowpass", frequency: { value: 0 }, connect() { return f; } };
    return f;
  }
}
FakeAudioContext.instances = [];

function createSandbox(seedSettings, { fakeAudio = false, seedStorage = null } = {}) {
  const elements = new Map();
  const storage = new Map();
  const alerts = [];
  const getEl = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  };
  // gameSettings はスクリプト読み込み時に localStorage から読まれるため、
  // テストしたい設定はここで先に仕込んでおく。
  if (seedSettings) {
    localStorage.setItem("fakeBloomSettings", JSON.stringify(seedSettings));
  }
  // ログの折りたたみなど、他の localStorage キーの初期状態も仕込める。
  if (seedStorage) {
    for (const [k, v] of Object.entries(seedStorage)) localStorage.setItem(k, v);
  }
  // 画面振動の検証用：document.querySelector(".wrap") は振動対象の
  // ラッパー要素を返す（それ以外は従来通り null）。
  const wrapEl = makeElement("wrap");
  const sandbox = {
    console,
    Math,
    JSON,
    // カットイン等の遅延タイマーはテスト終了を妨げないよう unref する。
    setTimeout: (fn, ms, ...args) => {
      const t = setTimeout(fn, ms, ...args);
      if (t && typeof t.unref === "function") t.unref();
      return t;
    },
    clearTimeout,
    alert: (msg) => alerts.push(String(msg)),
    // アイコン・歩行画像の fetch は失敗扱いにし、ゲーム側の catch に任せる。
    fetch: async () => ({ ok: false, text: async () => "" }),
    localStorage,
    document: {
      body: makeElement("body"),
      getElementById: getEl,
      createElement: () => makeElement(),
      querySelector: (sel) => (sel === ".wrap" ? wrapEl : null),
      querySelectorAll: () => [],
      // 役職説明ポップオーバーの委譲リスナー検証用：document 直付けの
      // リスナーを記録し、テストから dispatch できるようにする。
      _listeners: {},
      addEventListener(type, fn, opts) {
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push({ fn, capture: !!(opts && opts.capture) || opts === true });
      },
      dispatch(type, event = {}) {
        for (const l of this._listeners[type] || []) l.fn(event);
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  if (fakeAudio) sandbox.AudioContext = FakeAudioContext;
  return { sandbox, alerts, elements, localStorage };
}

// index.html を読み込んでゲームを実行し、内部 API とスタブを返す。
// seedSettings: タイトル画面の設定（fakeCount / bomber / sound / difficulty / bgm）。
// fakeAudio: true なら FakeAudioContext を差し込み、BGM の発音パスを検証できる。
// seedStorage: localStorage に先に仕込む任意のキー（折りたたみ状態など）。
// 共有モジュール game-logic.js を先に同じコンテキストで読み、ブラウザと
// 同じ順序（game-logic.js → index.html のメインスクリプト）で実行する。
function loadGame({ seedSettings, fakeAudio, seedStorage } = {}) {
  const root = path.resolve(__dirname, "..");
  const logicSrc = fs.readFileSync(path.join(root, "game-logic.js"), "utf8");
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("index.html に <script> が見つかりません");
  let src = m[1];
  // IIFE の外枠だけ外す。残りの本体と、後ろに追加する公開コードが
  // 同じスコープを共有するのがポイント。
  src = src.replace(/^\s*\(\(\) => \{\s*\n?/, "");
  src = src.replace(/\}\)\(\);\s*$/, "");
  src += `
;globalThis.__FB__ = {
  ROLES, PHASE_META, CHAR_TALK, charTalkPool, pickTalkLine, setupGame, runNight, resolveNightActions, doVote,
  morningToDiscussion, discussionToVote, revealMouse, checkWin, dealRoles, resolveVoteTally, checkWinCondition,
  getEffectiveRoleKey, getPublicRoleKey, getPhaseHint, updateInGameRoleCard,
  getFakeAlliesText, getAlliesLineForRole, showRoleInfo, closeRoleInfo, renderRoleGuide, renderParade,
  renderStats, renderAchievements, CLUMSY_SEER_RATE, showResults, buildHighlights, gameSettings,
  draw, paintSettings, roleHtmlFor, startHandoff, showPnpCover, showPnpRole,
  startPnpNight, showPnpNightCover, showPnpNightTurn, showPnpNightAction,
  confirmPnpNightAction, advancePnpNight, finishPnpNight,
  pnpNightCurrentPlayer, pnpHumanFakeRep, showPnpFakeAbility,
  startPnpVote, showPnpVoteCover, showPnpVoteTurn,
  confirmPnpVoteAction, advancePnpVote, finishPnpVote,
  pnpVoteCurrentPlayer, tallyVotes, cpuVotePick, addVoteTo, selectTarget,
  pnpCpuTalkCap, startDiscussTimer, stopDiscussTimer, discussTimerTick,
  renderDiscussTimer,
  get discussSecondsLeft() { return discussSecondsLeft; },
  enqueueSpeechBubble, showNextSpeechBubble, expireSpeechBubble, clearSpeechBubbles,
  get speechQueue() { return speechQueue; },
  recordPnpStats, loadPnpStats, renderPnpStats, recordStats, loadStats, focusEl,
  get state() { return state; },
  resolveNightActionsLogic, cpuVotePickLogic, planNightActionsLogic, planDiscussionTalksLogic, buildHighlightsLogic, applySoloStatsLogic, applyPnpStatsLogic, buildStatsViewLogic, buildResultSummaryLogic, buildResultRowsViewLogic, getPhaseHintLogic, getFakeAlliesTextLogic, getAlliesLineForRoleLogic, roleHtmlForLogic, buildRoleCardViewLogic, buildCardsViewLogic, buildStageViewLogic, buildDrawViewLogic, normalizeSettingsLogic, buildSettingsViewLogic, normalizeLogFoldLogic, buildLogFoldViewLogic, withLogFoldedLogic, buildAchievementsViewLogic, roleIconButtonHtmlLogic, buildRoleInfoViewLogic, buildRoleGuideViewLogic, buildParadeViewLogic, buildDiscussTimerViewLogic, formatActionLog,
  buildPnpCoverViewLogic, buildPnpRoleViewLogic, buildPnpNightResultViewLogic, buildPnpNightActionViewLogic, buildPnpTurnBannerTextLogic,
  BGM_CHORDS, startBgm, stopBgm, isBgmPlaying,
  nightCutins, runNightCutinMotion, stageBounce, stageGhostWalker, stageEventMotion, stageFlashRed, stageOwnActionMotion,
  showCutin, clearCutins,
  get cutinQueueLength() { return cutinQueue.length; },
  get cutinQueue() { return cutinQueue; },
  buildCutinItemLogic, buildCutinFaceHtmlLogic, buildCutinViewLogic, cutinSfxForLogic,
  buildSpeechBubbleItemLogic, buildSpeechBubbleViewLogic, pickNextSpeechBubbleLogic,
  celebrate, shakeScreen, buildShakeViewLogic, buildConfettiViewLogic, CONFETTI_REMOVE_MS,
  buildStageBounceViewLogic, buildStageEventMotionViewLogic, buildGhostWalkerViewLogic, buildStageFlashViewLogic, buildOwnActionMotionViewLogic, OWN_ACTION_FAMILIES, buildNightCutinsViewLogic, buildRevealMouseViewLogic,
  setLogFolded, toggleLogFold, LOG_FOLD_KEY,
  get logFold() { return logFold; },
};
`;
  const { sandbox, alerts, elements, localStorage } = createSandbox(seedSettings, { fakeAudio, seedStorage });
  vm.createContext(sandbox);
  vm.runInContext(logicSrc, sandbox, { filename: "game-logic.js" });
  vm.runInContext(src, sandbox, { filename: "index.html<script>" });
  return { FB: sandbox.__FB__, alerts, elements, localStorage, sandbox, FakeAudioContext };
}

module.exports = { loadGame };
