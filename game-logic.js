// Fake Bloom の共有ゲームロジック（オンライン対戦フェーズ0）。
// 試合のデータと、DOM を使わない純粋な関数だけを集めた共有モジュール。
// ブラウザでは index.html が <script src> で読み込み globalThis.FakeBloomLogic
// に載せ、将来のサーバー（フェーズ1）は require で同じものを使う。
// ルール：このファイルに画面操作・保存領域・通信・タイマーは置かない。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FakeBloomLogic = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROLES = {
    apprenticeSeer: {
      name: "見習い占い師",
      icon: "🔮",
      faction: "イノセント",
      desc: "夜に1人の陣営を調べる。結果がズレる個体が混ざることがある（本人にも分からない）。",
      nightActionHint: "怪しい相手を1人選んで調査しよ。",
      resultInterpretation: "表示された陣営をそのまま参考にしてOK。",
      riskNote: "相手が『なりすまし』だと65%でイノセント判定に化けることがある。",
      nightAction: { type: "investigate", priority: 20, allowSelf: false }
    },
    guardian: {
      name: "守り手",
      icon: "🛡️",
      faction: "イノセント",
      desc: "夜に1人を守る。",
      nightActionHint: "襲われそうな子を1人選んでガード。",
      resultInterpretation: "夜の報告で襲撃が防がれたらガード成功の可能性あり。",
      riskNote: "誰を守ったかは公開されない。読み負けると守り切れない。",
      nightAction: { type: "protect", priority: 10, allowSelf: true }
    },
    tracker: {
      name: "追跡係",
      icon: "👣",
      faction: "イノセント",
      desc: "夜に1人が誰を訪ねたか分かる。",
      nightActionHint: "行動が怪しい相手を1人選んで追跡。",
      resultInterpretation: "『誰を訪れたか』は間接情報。単体で黒確定にはしないのがコツ。",
      riskNote: "追跡先の行動理由までは分からないため、早とちり注意。",
      nightAction: { type: "track", priority: 30, allowSelf: false }
    },
    police: {
      name: "ポリス",
      icon: "🚔",
      faction: "イノセント",
      desc: "夜に1人を訪ねて、その夜の行動を封じる（FeignのPolice方式）。",
      nightActionHint: "能力を使いそうな相手を1人選んで足止め。",
      resultInterpretation: "妨害した相手はその夜、能力を使えない（調査・護衛・追跡・盗み見・爆弾など）。ただしインポスター陣営の襲撃そのものは止められない。",
      riskNote: "味方の能力者を止めると損。相手の役職読みが大事。",
      nightAction: { type: "block", priority: 5, allowSelf: false }
    },
    lookout: {
      name: "見張り役",
      icon: "🔭",
      faction: "イノセント",
      desc: "夜に1人の家を見張り、その夜に訪れた全員が分かる（FeignのLookout方式）。",
      nightActionHint: "狙われそうな子や怪しい子の家を見張ろう。",
      resultInterpretation: "訪問者の中に襲撃者や能力者が混ざっている。誰が何をしたかまでは分からない。",
      riskNote: "訪問＝黒ではない。護衛や調査の訪問も見えてしまう。",
      nightAction: { type: "lookout", priority: 35, allowSelf: true }
    },
    trapper: {
      name: "トラッパー",
      icon: "🪤",
      faction: "イノセント",
      desc: "夜に1人の家へ罠を設置。その人が襲撃されて倒れたら、襲撃者も道連れになる（FeignのTrapper方式）。",
      nightActionHint: "襲われそうな子の家に罠を仕掛けよう。自分の家にも設置できる。",
      resultInterpretation: "罠が作動したら朝の報告で分かる。罠はその夜かぎり。",
      riskNote: "護衛と重なると襲撃自体が防がれて罠は不発。爆弾には反応しない。",
      nightAction: { type: "trap", priority: 12, allowSelf: true }
    },
    doctor: {
      name: "ドクター",
      icon: "🩺",
      faction: "イノセント",
      desc: "夜に1人を診察。その人がその夜に襲撃や爆発で倒れたら、朝までに蘇生させる。",
      nightActionHint: "狙われそうな子を診察しておこう。自分も選べる。",
      resultInterpretation: "蘇生が起きると朝の報告で公開される（倒れた人の役職は公開されたまま）。",
      riskNote: "倒れなかった相手では何も起きない。妨害されると蘇生できない。",
      nightAction: { type: "revive", priority: 38, allowSelf: true }
    },
    mouse: {
      name: "マウス",
      icon: "🐭",
      faction: "イノセント",
      desc: "能力は昼。ゲーム中1回だけ、議論中に1人の本当の役職を全員に公開できる（FeignのMouse方式）。",
      nightActionHint: "夜は能力なし。昼の議論で公開ボタンのタイミングを計ろう。",
      resultInterpretation: "公開された役職は確定情報。インポスターがバレれば追放まっしぐら。",
      riskNote: "1回きり。誰を公開するかで勝敗が動く。",
      nightAction: null
    },
    politician: {
      name: "政治家",
      icon: "🗳️",
      faction: "イノセント",
      desc: "能力は投票。自分の票が常に2票分になる（FeignのPolitician方式）。",
      nightActionHint: "夜は能力なし。昼は投票で決着をつける動きを考えよう。",
      resultInterpretation: "票が割れそうな場面で特に強い。",
      riskNote: "票の重さから正体を推測されることもある。",
      nightAction: null
    },
    villager: {
      name: "村ガール",
      icon: "🏠",
      faction: "イノセント",
      desc: "能力なし。議論と投票で戦う。",
      nightActionHint: "夜は情報整理に集中。朝ログと発言の矛盾を探そう。",
      resultInterpretation: "自分の夜結果はないので、他者の報告の整合性がカギ。",
      riskNote: "強い能力はないぶん、ミスリードに流されやすい。",
      nightAction: null
    },
    fakeGirl: {
      name: "フェイクガール",
      icon: "🎭",
      faction: "インポスター",
      desc: "インポスター陣営として夜に1人を脱落させる。襲撃しない夜は、イノセント側1人の夜行動を妨害する。",
      nightActionHint: "仲間と相談した想定で、インポスター陣営として襲撃先を1人に絞る。",
      resultInterpretation: "襲撃が通れば盤面有利、守られると計画を立て直し。妨害された相手はその夜、能力を使えない。",
      riskNote: "守り手の防衛先に当たると襲撃失敗。襲撃は陣営で1回だけ。",
      nightAction: { type: "attack", priority: 40, allowSelf: false }
    },
    mimic: {
      name: "なりすまし",
      icon: "🪞",
      faction: "インポスター",
      desc: "調査でイノセントに見えることがある。襲撃しない夜は、イノセント側1人の実役職を盗み見る。得た情報は陣営の襲撃先決定に使われる。",
      nightActionHint: "占いをいなしつつ、インポスター陣営の襲撃先相談に乗る立ち回り。",
      resultInterpretation: "調査を受けると、相手視点でイノセント結果が出る可能性がある。盗み見で占い師や守り手が割れると、優先的に狙われる。",
      riskNote: "target.roleKey === \"mimic\" のとき65%でイノセント判定に化ける。襲撃実行はインポスター陣営で1回だけ。",
      nightAction: { type: "attack", priority: 40, allowSelf: false }
    },
    bomber: {
      name: "ボマー",
      icon: "💣",
      faction: "ニュートラル",
      desc: "第三勢力。夜に1人へ爆弾を仕掛け、翌日の夜に爆発する（FeignのBomber方式）。最後の1人になるか、爆弾で2人以上を倒して生き残ると勝利。",
      nightActionHint: "毎晩だれか1人に爆弾を仕掛けよう。自分以外を全員倒せば勝ち。",
      resultInterpretation: "爆弾は護衛されている相手には効かない。占われると『ニュートラル』とバレる。",
      riskNote: "イノセント・インポスターどちらの勝利条件にも数えられない。両陣営から狙われる孤独な役職。",
      nightAction: { type: "plant", priority: 25, allowSelf: false }
    },
    baka: {
      name: "バカ",
      icon: "🃏",
      faction: "イノセント",
      desc: "本人には分からないが、別のイノセント役職として振る舞うトリッキー枠。表示された役職で夜行動できるが、その結果はすべて偽物（FeignのInsane方式）。",
      nightActionHint: "表示された役職として夜行動しよう（能力なしのこともある）。ただし結果は信用できない。",
      resultInterpretation: "夜の結果はすべて偽物。占い判定はランダム、護衛は実際には守れず、追跡情報もデタラメ。実役職が分かるのは結果画面だけ。",
      riskNote: "自分の結果を根拠に推理すると論理が破綻して疑われる。周りから見ると、結果の矛盾がバカのサイン。",
      nightAction: null
    }
  };

  const PHASE_META = {
    night: { label: "夜行動", button: "夜行動を実行" },
    morning: { label: "朝の報告", button: "報告を読む" },
    discussion: { label: "昼の議論", button: "議論を終えて投票へ" },
    vote: { label: "投票", button: "投票する" },
    end: { label: "勝敗", button: "-" }
  };

  const PLAYER_NAMES = ["ルナ", "ミオ", "ユイ", "カノン", "スズ", "リリ", "ノア", "エマ"];
  const PLAYER_ICONS = ["🌸", "🪄", "🧁", "🎀", "💫", "🫧", "🍬", "🌙"];
  const ICON_SLUGS = ["luna", "mio", "yui", "kanon", "suzu", "riri", "noa", "ema"];

  // Character voice (キャラ別セリフ第1弾): each of the 8 girls speaks in her
  // own tone during discussion. Shape mirrors `templates` inside
  // morningToDiscussion: defense/pressure are tiered (low/mid/high), the
  // rest are flat arrays. A character line is used ~60% of the time when
  // one exists; the shared templates stay as the fallback.
  const CHAR_TALK = {
    "ルナ": {
      defense: {
        low: ["{target} は大丈夫だよ！いつも通りだし", "{target} を疑うのはまだ早いよ！"],
        mid: ["{target}、ちょっと気になるけど…まだ決めつけないでおこう", "{target} の様子、なんか変だったかも？"],
        high: ["{target}、絶対怪しいよ！みんな、見てたでしょ", "{target} は今日落とすべきだと思う！"]
      },
      pressure: {
        low: ["{target} は大丈夫そうだよ、安心して", "{target} に圧をかけるのはまだ早いって"],
        mid: ["{target}、昨夜のこと教えてよ！", "{target} は何か知ってそうだよね"],
        high: ["{target}、正直に言って！昨夜何してたの", "{target} を信じきれないよ…説明して！"]
      },
      tracker: ["昨夜は誰も見なかったなぁ…静かだったよ"],
      observe: ["まだ情報が少ないね。話を聞こうよ", "まずはみんなの話を聞きたいな"],
      claimFake: ["占いの結果…{target} がインポスターだったよ！", "{target}、占いで黒って出たの。信じて！"],
      claimWhite: ["{target} は白だったよ！安心してね", "占いでは {target} はイノセントだったよ"],
      claimNeutral: ["{target}、どっちでもないみたい…第三勢力かも", "{target} はニュートラル判定だったよ"],
      bomb: ["爆弾って怖いよね…ボマーを早く見つけよう！"],
      guardian: ["昨夜の襲撃、防げてよかったね！"],
      endgame: ["人数が少ないよ…一票を大事にいこう"]
    },
    "ミオ": {
      defense: {
        low: ["{target} は怪しくないの。星がそう言ってるの", "{target} のオーラは白いの"],
        mid: ["{target}、ちょっと影が見えるの…", "{target} の運命、少し曇ってるの"],
        high: ["{target} の影は真っ黒なの。間違いないの", "星の導きよ…{target} がインポスターなの"]
      },
      pressure: {
        low: ["{target} は大丈夫なの。心配ないの", "{target} を疑うのはまだ早いの"],
        mid: ["{target}、昨夜のことを話すの。月が見てるの", "{target} は何か隠してるの"],
        high: ["{target}、嘘は星にバレるの。正直に言うの", "{target} を信じられないの…"]
      },
      tracker: ["昨夜は誰の気配もなかったの。静かな夜だったの"],
      observe: ["まだ星の声が小さいの。もう少し待つの", "情報が少ないの。様子を見るの"],
      claimFake: ["占いの水晶が告げたの…{target} がインポスターなの", "私の占いでは {target} は黒なの"],
      claimWhite: ["{target} は白なの。星が微笑んでるの", "占いでは {target} はイノセントなの"],
      claimNeutral: ["{target}、どっちの陣営でもないの。不思議なの", "{target} は第三勢力の気配なの"],
      bomb: ["爆弾の気配…ボマーがいるの、気をつけるの"],
      guardian: ["昨夜の襲撃、誰かが防いだの。よかったの"],
      endgame: ["もう人数が少ないの…星に祈るしかないの"]
    },
    "ユイ": {
      defense: {
        low: ["{target} は大丈夫だよぉ。いつも通りだよぉ", "{target} を疑うのはかわいそうだよぉ"],
        mid: ["{target}、ちょっと気になるなぁ…", "{target} の様子、少し変だったかもぉ"],
        high: ["{target} は怪しいよぉ…怖いなぁ", "{target}、今日は落としたほうがいいかもぉ"]
      },
      pressure: {
        low: ["{target} は大丈夫そうだよぉ", "{target} に厳しくするのはまだ早いよぉ"],
        mid: ["{target}、昨夜のこと教えてほしいなぁ", "{target} は何か知ってそうだよぉ"],
        high: ["{target}、正直に言ってほしいなぁ…", "{target} を信じきれないよぉ…"]
      },
      tracker: ["昨夜は誰も見なかったよぉ。静かだったなぁ"],
      observe: ["まだよくわからないなぁ。話を聞こうよぉ", "様子見でいいかなぁ…"],
      claimFake: ["占いの結果なんだけどぉ…{target} がインポスターだったよぉ", "{target}、占いで黒って出ちゃったよぉ"],
      claimWhite: ["{target} は白だったよぉ。よかったねぇ", "占いでは {target} はイノセントだったよぉ"],
      claimNeutral: ["{target}、どっちでもないみたいだよぉ…", "{target} は第三勢力かもぉ…"],
      bomb: ["爆弾って怖いよぉ…ボマー、早く見つけたいなぁ"],
      guardian: ["昨夜の襲撃、防げてよかったよぉ…"],
      endgame: ["人数が少ないよぉ…慎重にいこうねぇ"]
    },
    "カノン": {
      defense: {
        low: ["{target} は怪しくありませんわ。ご安心なさいませ", "{target} を疑うのは時期尚早ですわ"],
        mid: ["{target}、少々気になりますわね", "{target} の態度、少し不審ですわ"],
        high: ["{target} は非常に怪しいですわ。今日落とすべきですわ", "{target} が黒であることは明白ですわ"]
      },
      pressure: {
        low: ["{target} は大丈夫ですわ。ご心配なく", "{target} に圧をかけるのはまだ早いですわ"],
        mid: ["{target}、昨夜のことをお話しなさい", "{target} は何かご存知のようですわね"],
        high: ["{target}、正直にお答えなさい。昨夜何をしていたのかしら", "{target} を信じることはできませんわ"]
      },
      tracker: ["昨夜は誰もお見かけしませんでしたわ。静かな夜でした"],
      observe: ["まだ情報が不足していますわ。お話を伺いましょう", "まずは皆様のお話を聞くべきですわね"],
      claimFake: ["占いの結果ですわ…{target} がインポスターでしたわ", "私の占いでは {target} は黒ですわ"],
      claimWhite: ["{target} は白でしたわ。ご安心くださいませ", "占いでは {target} はイノセントでしたわ"],
      claimNeutral: ["{target}、どちらでもないようですわ。第三勢力かしら", "{target} はニュートラル判定でしたわ"],
      bomb: ["爆弾とは恐ろしいことですわ…ボマーを早く見つけませんと"],
      guardian: ["昨夜の襲撃を防げたのは大きいですわね"],
      endgame: ["人数が少なくなりましたわ…一票を慎重に使いましょう"]
    },
    "スズ": {
      defense: {
        low: ["{target} は白だ。疑う理由はない", "{target} は普通だ。様子見でいい"],
        mid: ["{target}、少し気になるな", "{target} の動きが引っかかる"],
        high: ["{target} は黒だ。今日落とす", "{target}、間違いなく怪しい"]
      },
      pressure: {
        low: ["{target} は大丈夫だ。放っておけ", "{target} はまだいい。急ぐな"],
        mid: ["{target}、昨夜のことを話せ", "{target} は何か知ってるはずだ"],
        high: ["{target}、昨夜何してた。言え", "{target} は信用できない"]
      },
      tracker: ["昨夜は誰も見てない。静かだった"],
      observe: ["情報が足りない。聞くしかない", "まだ決めるな。様子見だ"],
      claimFake: ["占いの結果。{target} はインポスターだ", "{target}、黒だ。信じろ"],
      claimWhite: ["{target} は白だ。安心しろ", "占いでは {target} はイノセントだ"],
      claimNeutral: ["{target} はどっちでもない。第三勢力だ", "{target}、ニュートラル判定だ"],
      bomb: ["爆弾か。ボマーを早く見つける"],
      guardian: ["昨夜の襲撃、防げたのは大きい"],
      endgame: ["人数が少ない。外したら終わりだ"]
    },
    "リリ": {
      defense: {
        low: ["{target} は白い雲みたいだよぉ。怪しくないよぉ", "{target} を疑うのはまだ早いかなぁ"],
        mid: ["{target}、なんだかもやもやするなぁ…", "{target} の色、ちょっと曇ってるかもぉ"],
        high: ["{target} は真っ黒な雲だよぉ…怖いなぁ", "{target}、今日落としたほうがいいかもぉ"]
      },
      pressure: {
        low: ["{target} は大丈夫そうだよぉ。ふわふわしてるよぉ", "{target} に圧をかけるのはまだ早いかなぁ"],
        mid: ["{target}、昨夜のこと教えてほしいなぁ。夢で見たの？", "{target} は何か知ってそうだよぉ"],
        high: ["{target}、正直に言ってほしいなぁ…雲の上から見てるよぉ", "{target} を信じきれないかなぁ…"]
      },
      tracker: ["昨夜は誰も見なかったなぁ。夢みたいに静かだったよぉ"],
      observe: ["まだよくわからないなぁ。ふわふわしてるよぉ", "様子見がいいかなぁ…雲の流れを見ようよぉ"],
      claimFake: ["占いの結果なんだけどぉ…{target} がインポスターだったよぉ", "{target}、夢の中で黒って見えたよぉ"],
      claimWhite: ["{target} は白い雲みたいだったよぉ。よかったねぇ", "占いでは {target} はイノセントだったよぉ"],
      claimNeutral: ["{target}、どっちでもないみたいだよぉ…不思議な色だよぉ", "{target} は第三勢力かもぉ…"],
      bomb: ["爆弾って怖いなぁ…ボマー、早く見つけたいよぉ"],
      guardian: ["昨夜の襲撃、防げてよかったなぁ…ほっとしたよぉ"],
      endgame: ["人数が少ないなぁ…慎重にいこうねぇ"]
    },
    "ノア": {
      defense: {
        low: ["{target} は大丈夫だよ！信じてあげようよ", "{target} を疑うのはまだ早いじゃん！"],
        mid: ["{target}、ちょっと怪しいかも…", "{target} の様子、なんか変じゃん？"],
        high: ["{target}、絶対怪しいじゃん！今日落とそうよ", "{target} は黒だよ！みんな見てたでしょ"]
      },
      pressure: {
        low: ["{target} は大丈夫そうじゃん。放っておこうよ", "{target} に圧をかけるのはまだ早いって"],
        mid: ["{target}、昨夜のこと教えてよ！", "{target} は何か知ってそうじゃん"],
        high: ["{target}、正直に言いなよ！昨夜何してたの", "{target} を信じきれないよ…説明してよ！"]
      },
      tracker: ["昨夜は誰も見なかったよ。静かだったな"],
      observe: ["まだ情報が少ないよ。話を聞こうよ", "まずはみんなの話を聞きたいな"],
      claimFake: ["占いの結果…{target} がインポスターだったよ！", "{target}、占いで黒って出たよ。信じて！"],
      claimWhite: ["{target} は白だったよ！安心してね", "占いでは {target} はイノセントだったよ"],
      claimNeutral: ["{target}、どっちでもないみたい…第三勢力かも", "{target} はニュートラル判定だったよ"],
      bomb: ["爆弾って怖すぎる…ボマーを早く見つけようよ！"],
      guardian: ["昨夜の襲撃、防げてよかったね！"],
      endgame: ["人数が少ないよ…一票を大事にいこう"]
    },
    "エマ": {
      defense: {
        low: ["{target} は怪しくないわ。様子を見るのがいいわね", "{target} を疑う根拠はまだ薄いわ"],
        mid: ["{target}、少し気になるわね", "{target} の行動に違和感があるわ"],
        high: ["{target} はかなり怪しいわ。今日落とすべきね", "{target} の票の動きが不自然よ"]
      },
      pressure: {
        low: ["{target} は大丈夫そうね。急ぐ必要はないわ", "{target} に圧をかけるのはまだ早いわね"],
        mid: ["{target}、昨夜の行動を説明してちょうだい", "{target} は何か知っているはずよ"],
        high: ["{target}、昨夜何をしていたのか正直に言って", "{target} を信じきるのは難しいわね"]
      },
      tracker: ["昨夜は誰も見なかったわ。静かだったわね"],
      observe: ["まだ情報が少ないわね。話を聞きましょう", "まずは全員の話を聞くべきね"],
      claimFake: ["占いの結果よ…{target} がインポスターだったわ", "私の占いでは {target} は黒よ"],
      claimWhite: ["{target} は白だったわ。安心してちょうだい", "占いでは {target} はイノセントだったわ"],
      claimNeutral: ["{target}、どっちの陣営でもないわね。第三勢力かしら", "{target} はニュートラル判定だったわ"],
      bomb: ["爆弾か…ボマーを早く見つけないと全員危ないわ"],
      guardian: ["昨夜の襲撃を防げたのは大きいわね"],
      endgame: ["人数が少ないわ…一票が重いわね。慎重にいきましょう"]
    }
  };

  // Character-specific pool for one discussion category (tiered pools take
  // a tier). Returns null when the character has no line for it.
  function charTalkPool(name, category, tier) {
    const char = CHAR_TALK[name];
    if (!char) return null;
    const pool = char[category];
    if (Array.isArray(pool)) return pool;
    if (pool && tier) return pool[tier] || null;
    return null;
  }

  // Pick a discussion line: prefer the speaker's own voice (~60%) and fall
  // back to the shared template pool otherwise.
  function pickTalkLine(player, category, tier, genericPool) {
    const charPool = charTalkPool(player.name, category, tier);
    if (charPool && charPool.length && Math.random() < 0.6) return rand(charPool);
    return rand(genericPool);
  }
  const INNOCENT_ROLE_KEYS = ["apprenticeSeer", "guardian", "tracker", "villager", "police", "lookout", "trapper", "doctor", "mouse", "politician"];
  // うっかり占い師は独立役職ではなく、見習い占い師の隠し個体。
  // 占い師のうちこの割合が「うっかり個体」になり、本人にも分からない
  // まま 45% の確率で判定がランダムに上書きされる。出現率は
  // シミュレーションで勝率を見ながら調整する（目安 30〜40%）。
  const CLUMSY_SEER_RATE = 0.35;

  function rand(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

  function getEffectiveRoleKey(player) {
    if (player.roleKey === "baka") return player.fakeDisplayRoleKey || "villager";
    return player.roleKey;
  }
  // ゲーム中の公開情報で見せる役職。バカは結果画面まで表示役職の
  // まま（脱落時の公開・カード・マウスの公開・盗み見も同じ）で、
  // うっかり個体の占い師も常にただの見習い占い師として見える。
  function getPublicRoleKey(player) {
    return getEffectiveRoleKey(player);
  }

  // 廃止済み役職の旧戦績データを表示するための名前（現行の ROLES にはない）。
  const LEGACY_ROLE_NAMES = { clumsySeer: "うっかり占い師" };
  // 2026-11-12 の陣営改名（ピュア→イノセント、フェイク→インポスター）より前に
  // 保存された戦績の陣営キーを、新しい陣営名へ読み替える（後方互換）。
  const LEGACY_FACTION_NAMES = { "ピュア": "イノセント", "フェイク": "インポスター" };
  function migrateFactionWins(factionWins) {
    const out = {};
    for (const [key, value] of Object.entries(factionWins || {})) {
      const name = LEGACY_FACTION_NAMES[key] || key;
      out[name] = (out[name] || 0) + value;
    }
    return out;
  }
  return {
    ROLES,
    PHASE_META,
    PLAYER_NAMES,
    PLAYER_ICONS,
    ICON_SLUGS,
    CHAR_TALK,
    charTalkPool,
    pickTalkLine,
    INNOCENT_ROLE_KEYS,
    CLUMSY_SEER_RATE,
    rand,
    getEffectiveRoleKey,
    getPublicRoleKey,
    LEGACY_ROLE_NAMES,
    LEGACY_FACTION_NAMES,
    migrateFactionWins,
  };
});
