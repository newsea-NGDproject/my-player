/*
======================================================================
 keep-awake.js ── 寝ずの番(レイヤー5):止めている間もアプリを眠らせない

----------------------------------------------------------------------

【呼び方】

 竹弘との相談では「寝ずの番」「レイヤー5」「デッキ5」「層5」のどれで
 呼んでも、このファイルの仕組みのことです(竹弘の指定、2026-10-18)。

 docs/connect-method.html の図解の層に並べると、こうなります。

     層1 デッキA / 層2 デッキB … 曲を鳴らす
     層3 ノリノリアシスト      … カチッを鳴らす
     層4 司令塔(JavaScript)   … 値を書く・時刻を予約する
     層5 寝ずの番(このファイル)… 聞こえない曲で、アプリを眠らせない

 竹弘の曲は鳴らしません。デッキA・Bとは別の、小さな <audio> を1つ持ちます。

----------------------------------------------------------------------

【なぜ要るのか(竹弘の実機、2026-10-18)】

 同期スタートした後、曲を止めて画面を消しておくと、XPERIA では
 ブラウザ版で約2分、インストール版で約4分45秒で、Chrome がページを
 「凍結」しました(document の 'freeze')。凍結している間は、イヤホンの
 ▶ がノリRunまで届かず、再開できません。

 Chrome は「**聞こえる音**を出しているページ」だけを凍結しません。
 止めている間は無音なので、凍結されます(海外の事例を調べても、ここを
 きれいに解いた Web アプリは見つからなかった)。

----------------------------------------------------------------------

【イヤホンの ⏸ ▶ が届く仕組み(Chrome の関所は2つある)】

 イヤホンのボタンは、Chrome の中の2つの関所を通ってからノリRunに届きます。

     ① 外側の関所(Java の MediaNotificationController)
          「止まっている」時は ▶ だけ、「再生中」の時は ⏸ だけを通す
     ② 内側の関所(C++ の MediaSessionImpl::Suspend)
          ⏸ は、**本当に鳴っているプレイヤーがある**時だけ通す
          (`if (!IsActive()) return;`。2026-10-18 に Chromium のソースで確かめた)

 イヤホンは ⏸ と ▶ を自分で交互に送り、スマホの状態が変わったと知らされると
 そこで合わせ直します。Bluetooth で音が流れていると「鳴っている」と思って
 ⏸ を送ります。

 そこで寝ずの番は、止めている間、**聞こえない曲を本当に鳴らします**
 (下の【聞こえない曲】)。すると

     ・Chrome から見て「本当に再生中」→ ①も②も ⏸ を通す
     ・聞こえる音を出しているページなので、凍結されない
     ・イヤホンも「鳴っている」と思って ⏸ を送る

 届いた ⏸ は、本当は「再開して」の合図です。札を掛けた係(同期モード)へ渡します。

----------------------------------------------------------------------

【v245 の失敗と、v246 で直したこと(⚠️ 二度と同じ穴を踏まないために)】

 v245 は、曲を鳴らさずに **Chrome に「再生中」と名乗るだけ**にしていました
 (navigator.mediaSession.playbackState = "playing"。−60dB の信号は音の回路から
 流していた)。Chrome は、ページが「再生中」と名乗ると①の関所では再生中として
 扱うので、うまく行くと考えていました。

 竹弘の実機(2台とも)では、**画面を消すとイヤホンが全く効かなくなりました**。

     ⏸ … ①は「再生中」なので通す → ②が「本当に鳴っているプレイヤーが無い」と捨てる
     ▶ … ①が「再生中なのに ▶?」と捨てる

 → **どちらのボタンも届かない**。名乗るだけの「再生中」は、②の関所を通れません。

 ⚠️ **本当に鳴っているプレイヤー無しで「再生中」と名乗ってはいけない。**
    v246 からは playbackState には触りません。聞こえない曲が鳴っている間だけ、
    Chrome が自分で「再生中」と判断します(曲を鳴らせなかった時は「止まっている」
    のままなので、今までどおり ▶ で再開できる)。

----------------------------------------------------------------------

【v247:2回目に起こした時に効いていなかった件】

 v246 の実機テスト(2026-10-18 19:43〜19:58、5分以上止める試験)は成功しましたが、
 そのあと2台とも、**2回目に起こした時は「聞こえる音」として扱われていません
 でした**(1回目は2台とも6分半、凍結も間引きも無し)。

     GALAXY … 2回目に止めて画面を消すと、14秒で凍結した(document 'freeze')
     XPERIA … 2回目に止めて画面を消すと、心拍の時刻が 0.868秒 → 0.531秒 に
               ずれた(Chrome が「音を出していないページ」のタイマーを
               1秒単位にまとめる時の形。1回目は 0.868秒 のまま)

 どちらも「寝ずの番 起こし始めました」は出ていた(= play() は成功していた)ので、
 聞こえない曲の <audio> を**使い回した2回目**に、何かが起きています
 (どの出来事も記録していなかったので、まだ分からない)。そこで v247 では:

     ① 聞こえない曲の <audio> を、起こすたびに**新しく作る**(古い方は片付ける)
     ② 音を**音の回路(js/deck.js の deckAudioCtx)に通す**
        → v240・v245 の実機で、音の回路から出した −60dB は毎回「聞こえる音」と
          扱われていた(凍結も間引きも無し)。v246 の「直接鳴らす」は1回目は
          効いたが2回目に効かなかったので、実証済みの道に乗せる
        → <audio> のまま(Chrome から見て本当に再生中のプレイヤー)なので、
          イヤホンの ⏸ が届く仕組み(冒頭の関所の話)は変わらない
        → 音の回路が無い時だけ、直接鳴らす(v246 と同じ)
     ③ 聞こえない曲の出来事(鳴り始めた・止まった・終わった・詰まった・壊れた)を
        🐛パネルに出す。心拍の行にも寝ずの番の様子を足す(js/debug-log.js)
        → また効かなかった時に、どこで止まったか分かるように

----------------------------------------------------------------------

【聞こえない曲】

 その場で作る、30秒の WAV ファイルです(ファイルとしては置かない)。

     中身   … ずっと同じ値(直流)。大きさ 0.001 = −60dB
     形     … 8000Hz・モノラル・16bit(約480KB)
     鳴らし方 … <audio> の loop で繰り返す(JavaScript が動かなくても続く)

 ・Chrome が「鳴っている」とみなす境目は約 −72dB。−60dB なら「聞こえる音」の
   扱いで凍結しない(v240 で実証した大きさ)
 ・直流は、イヤホンやスピーカーからは音になりません
 ・30秒にしているのは、Chrome が5秒以下の短い音を「効果音」として扱い、
   ふつうのプレイヤー(再生中の扱い)に入れないためです(余裕を持たせた長さ)
 ・【v247】音の回路(js/deck.js の deckAudioCtx)に通します(上の【v247】②)。
   止めた時に v238 が休ませた出口を、起こし始める時に起こします
   (起こしている間は js/deck.js の isDeckAudioWantedAwake が休ませない)
 ・WAV のデータ(blob: の住所)は1つだけ作り、新しい <audio> で使い回します

----------------------------------------------------------------------

【「札」の仕組み】

 寝ずの番に起きていてほしい係は、名前の付いた**札**を掛けます。
 寝ずの番は、札が1枚でも掛かっていれば起き、全部外れたら休みます。

     hangKeepAwakeTag(名前, ⏸が届いた時に呼ぶ関数)
     removeKeepAwakeTag(名前, 理由)

 いまの札は1枚だけです。

     「同期の一時停止」… js/sync.js の 5-5(同期スタート後に止めた時)

 「起こすかどうか」はこのファイルの refreshKeepAwake() の1か所で決めます。

 ⚠️ 同期モードの画面を開いている間の −80dB の信号(js/sync.js の v232、
    startSyncKeepAwake)は、まだ sync.js の中にあります。この実験がうまく
    行ったら、寝ずの番へ引っ越す予定です。

----------------------------------------------------------------------

【流れ】

  止めた(同期スタート後。js/sync.js が札を掛ける)
    → KEEP_AWAKE_START_DELAY_MS(1.5秒)待つ
       (その間に v238 が音の出口を休ませ、Chrome とイヤホンに
        「止まった」がはっきり伝わる)
    → 聞こえない曲を鳴らす(Chrome もイヤホンも「再生中」になる)

  イヤホン・通知・ロック画面の ⏸ が届いた(js/media-session.js から)
    → 聞こえない曲を止める(Chrome に「止まった」が伝わる)
    → KEEP_AWAKE_HANDOFF_MS(0.2秒)後に、札を掛けた係へ「再開して」と渡す
       (同期モードは曲を鳴らし、みんなの拍に合わせ直す = v241・v242)

  鳴り始めた・取りやめた(js/sync.js が札を外す)
    → 聞こえない曲を止める。竹弘の曲が止まったままなら、v238 の
      「出口を休ませる」に戻す

----------------------------------------------------------------------

【「止まった」と「再生中」の間を空ける理由】

 Chrome は、通知(とイヤホンへ伝える状態)を **500ms に1回**までにまとめます
 (Chromium の MediaNotificationController の THROTTLE_MILLIS = 500)。
 間が短いと途中の「止まった」が上書きされて消え、イヤホンには何も変わって
 いないように見えます(v239 の「音だけ消す」で2回タップになったのと同じ形)。

     止めてから聞こえない曲を鳴らすまで … 1.5秒(500ms より十分長く)
     ⏸ が届いて聞こえない曲を止めてから、竹弘の曲を鳴らすまで … 0.2秒
       (「止まった」はすぐ伝わり、鳴り始めた「再生中」は Chrome が
        500ms 後にまとめて伝える。どちらもイヤホンに届く)

----------------------------------------------------------------------

【⚠️ 実験の版です(v245 → v246 → v247)】

 イヤホンが本当に「スマホの状態が変わったら合わせ直す」かは、イヤホンの
 機種しだいで、実機で確かめるしかありません。見ること:

     ・止めている間のイヤホンの ⏸(1回)で再開する
       (🐛に「⏸ が届いた … 伝えてある状態 = paused」→「再開を頼みます」)
       ※「伝えてある状態」は media-session.js が伝えた値で、paused のままです
        (寝ずの番は名乗らないため)。Chrome 自身は聞こえない曲を見て再生中と判断します
     ・再開した後の、次の一時停止も1回で効く
     ・画面を消して5分以上止めても、凍結しない(🐛に 'freeze' が出ない)

 外れた時の代わりの案は「止めて1分たってから起こす」(短い一時停止は
 v238 のまま1タップ、長い休みは2タップ・凍結しない)。

 電池:起こしている間は、曲を鳴らしている時と同じくらい使います。
 止め忘れの保険として、KEEP_AWAKE_MAX_MIN(120分)で休みます。
 止めている間、ロック画面・通知のボタンは ⏸(再生中の姿)になります。
======================================================================
*/


// ==========================================================
// 1. 決めごと
// ==========================================================

/*
聞こえない曲の大きさ(直流の値。1 が最大)。0.001 = −60dB。

Chrome が「鳴っている」とみなす境目は約 −72dB です。

    −80dB(0.0001)… 鳴っていない扱い。音の出口だけ起こしておける
                      (同期モードの画面の v232 の信号はこちら)
    −60dB(0.001) … 鳴っている扱い。ページごと起こしておける(凍結しない。v240 で実証)
*/
const KEEP_AWAKE_LEVEL = 0.001;

// 聞こえない曲の長さ(秒)と、1秒あたりの点の数(Hz)。理由は冒頭の【聞こえない曲】
const KEEP_AWAKE_SONG_SEC = 30;
const KEEP_AWAKE_SONG_RATE = 8000;

// 札が掛かってから、起こし始めるまでの待ち(ms)。理由は冒頭の【「止まった」と「再生中」の間…】
const KEEP_AWAKE_START_DELAY_MS = 1500;

// ⏸ が届いて聞こえない曲を止めてから、札を掛けた係へ渡すまでの待ち(ms)。理由は同上
const KEEP_AWAKE_HANDOFF_MS = 200;

/*
⏸ を渡した後、これだけ(ms)たっても曲が鳴らず札も外れなければ、
また起こし直します(渡した先で鳴らせなかった時の保険。凍結させないため)。
*/
const KEEP_AWAKE_REARM_MS = 4000;

// 起こし続ける上限(分)。止め忘れの保険(竹弘の「昼ごはんで1時間止めることもある」より長く)
const KEEP_AWAKE_MAX_MIN = 120;


// ==========================================================
// 2. 状態
// ==========================================================

/*
掛かっている札。Map は「名前 → 中身」の組を覚えておく入れ物です。

    名前  … 札の名前(🐛パネルにも出す。例:「同期の一時停止」)
    中身  … { onPauseKey:⏸が届いた時に呼ぶ関数(無ければ null), hungAtMs:掛けた時刻 }
*/
const keepAwakeTags = new Map();

/*
聞こえない曲を鳴らしている <audio>。null = 鳴らしていない。
【v247】起こすたびに新しく作り、止めたら片付けます(冒頭の【v247】①)。
*/
let keepAwakeAudio = null;

// その <audio> を音の回路につないだ部品(MediaElementAudioSourceNode)。null = つないでいない
let keepAwakeSource = null;

// いまの <audio> の音の道(🐛パネル用):"音の回路" / "直接"
let keepAwakeRoute = "";

// 聞こえない曲の WAV の住所(blob:…)。初めて起こす時に1回だけ作り、使い回す
let keepAwakeSongUrl = null;

/*
【開発用調査ログ】(v247)聞こえない曲の <audio> で、🐛パネルに出す出来事。
    playing … 鳴り始めた    pause   … 止まった(寝ずの番が止めた時は出さない)
    ended   … 最後まで鳴って終わった(loop なので、ふつうは起きない)
    waiting / stalled … データ待ちで詰まった    emptied … 中身が空になった
    error   … 壊れた
*/
const KEEP_AWAKE_AUDIO_EVENTS = ["playing","pause","ended","waiting","stalled","emptied","error"];

// 聞こえない曲を鳴らしているか(play() が成功してから true)
let keepAwakeSounding = false;

// play() の答えを待っている途中か(二重に鳴らし始めないため)
let keepAwakeStarting = false;

// 起こし始めた時刻(performance.now。🐛パネルに「何秒起こしていたか」を出す)
let keepAwakeStartedAtMs = 0;

// 予約した setTimeout の番号(0 = 予約なし)
let keepAwakeStartTimerId = 0;      // 起こし始める予約
let keepAwakeMaxTimerId = 0;        // 120分の保険
let keepAwakeHandoffTimerId = 0;    // ⏸ を係へ渡す予約
let keepAwakeRearmTimerId = 0;      // 渡した後の保険

/*
⏸ を係へ渡している途中か。true の間は、札が掛かっていても起こし直しません
(係が曲を鳴らして札を外すのを待つ)。札が全部外れると false に戻ります。
*/
let keepAwakeHandingOff = false;

// 120分たって休んだか。true の間は起こし直しません。札が全部外れると false に戻ります
let keepAwakeGaveUp = false;


// ==========================================================
// 3. 札を掛ける・外す(ほかのファイルから呼ぶ入口)
// ==========================================================

/**
 * 「起こしておいて」の札を掛けます。同じ名前の札がもう掛かっていれば、
 * 中身(⏸ が届いた時に呼ぶ関数)だけ置き換えます。
 *
 * @param {string}        name       - 札の名前(🐛パネルにも出す)
 * @param {Function|null} onPauseKey - 起こしている間にイヤホン・通知の ⏸ が届いた時に
 *                                     呼ぶ関数(「再開して」の合図)。無ければ null
 */
function hangKeepAwakeTag(name,onPauseKey){

    keepAwakeTags.set(name,{ onPauseKey:onPauseKey || null, hungAtMs:performance.now() });

    refreshKeepAwake("札「" + name + "」を掛けた");

}

/**
 * 札を外します。掛かっていなければ何もしません。
 *
 * @param {string} name - 札の名前
 * @param {string} why  - 外す理由(🐛パネルに出す)
 */
function removeKeepAwakeTag(name,why){

    if(!keepAwakeTags.has(name)){ return; }

    keepAwakeTags.delete(name);

    // 札が全部外れたら、⏸ の受け渡しや120分の保険の印を元に戻します
    if(keepAwakeTags.size === 0){

        keepAwakeHandingOff = false;
        keepAwakeGaveUp = false;

        clearKeepAwakeTimer("handoff");
        clearKeepAwakeTimer("rearm");

    }

    refreshKeepAwake("札「" + name + "」を外した(" + why + ")");

}

/**
 * いま寝ずの番が起こしている(聞こえない曲を鳴らしている)かを返します。
 *
 * js/deck.js の isDeckAudioWantedAwake() も使います(起こしている間は、
 * 音の出口を休ませない。【v247】聞こえない曲は音の回路を通るので、休ませると
 * 「聞こえる音」でなくなってしまう)。
 *
 * @return {boolean}
 */
function isKeepAwakeSounding(){

    return keepAwakeSounding;

}


// ==========================================================
// 4. 起こしている間に ⏸ が届いた時(js/media-session.js から呼ぶ)
// ==========================================================

/**
 * イヤホン・通知・ロック画面の ⏸ が届いた時に、js/media-session.js が
 * まずここに聞きます。
 *
 * 寝ずの番が起こしている間に届いた ⏸ は、聞こえない曲が鳴っていて Chrome から
 * 見て再生中だから届いたもので、竹弘の曲は**止まっています**。つまり竹弘の
 * 「再開して」の合図です。札を掛けた係へ渡します。
 *
 * @return {boolean} true = 引き受けた(media-session.js はここで終わる)/
 *                   false = 起こしていない(いつもの ⏸ として止める)
 */
function handleKeepAwakePauseKey(){

    if(!isKeepAwakeSounding()){ return false; }

    // ⏸ の受け手がいる札を探します(後から掛けた札を優先)
    let name = "";
    let handler = null;

    keepAwakeTags.forEach(function(tag,tagName){

        if(typeof tag.onPauseKey === "function"){

            name = tagName;
            handler = tag.onPauseKey;

        }

    });

    if(!handler){ return false; }

    keepAwakeHandingOff = true;

    // 【開発用調査ログ】(v245)
    console.log("寝ずの番(レイヤー5): 起こしている間に ⏸ が届きました → 「" + name + "」の係へ再開を頼みます");

    // 聞こえない曲を止めます(Chrome に「止まった」が伝わる。冒頭の【「止まった」と「再生中」の間…】)
    stopKeepAwakeSound("⏸ が届いた",true);

    clearKeepAwakeTimer("handoff");

    keepAwakeHandoffTimerId = setTimeout(function(){

        keepAwakeHandoffTimerId = 0;

        try{

            handler();

        }
        catch(error){

            console.error("寝ずの番(レイヤー5): 再開を頼んだ先でエラー :",error.name,error.message);

        }

    },KEEP_AWAKE_HANDOFF_MS);

    /*
    保険:しばらくたっても曲が鳴らず、札も外れていなければ、また起こし直します
    (渡した先で鳴らせなかった時に、そのまま凍結させないため)。
    */
    clearKeepAwakeTimer("rearm");

    keepAwakeRearmTimerId = setTimeout(function(){

        keepAwakeRearmTimerId = 0;

        if(!keepAwakeHandingOff || !keepAwakeTags.has(name) || !audioPlayer.paused){ return; }

        console.warn("寝ずの番(レイヤー5): ⏸ を渡したのに曲が鳴り始めないので、また起こします(札 : " + name + ")");

        keepAwakeHandingOff = false;

        refreshKeepAwake("⏸ を渡した後の保険");

    },KEEP_AWAKE_REARM_MS);

    return true;

}


// ==========================================================
// 5. 起こすか休むかを決める(このファイルの心臓部。決めるのはここ1か所)
// ==========================================================

/**
 * 札と状態を見て、起こすか休むかを決め直します。
 *
 *     起こす … 札が1枚以上・⏸ を渡している途中でない・120分たっていない
 *     休む   … それ以外
 *
 * 起こす時は、すぐには起こさず KEEP_AWAKE_START_DELAY_MS 待ちます
 * (冒頭の【「止まった」と「再生中」の間を空ける理由】)。
 *
 * @param {string} why - きっかけ(休む時に🐛パネルへ出す)
 */
function refreshKeepAwake(why){

    const wanted = keepAwakeTags.size > 0 && !keepAwakeHandingOff && !keepAwakeGaveUp;

    if(!wanted){

        clearKeepAwakeTimer("start");

        if(keepAwakeSounding || keepAwakeStarting){ stopKeepAwakeSound(why,false); }

        return;

    }

    // もう起こしている・起こしている途中・起こす予約がある時は、そのままにします
    if(keepAwakeSounding || keepAwakeStarting || keepAwakeStartTimerId){ return; }

    keepAwakeStartTimerId = setTimeout(function(){

        keepAwakeStartTimerId = 0;

        startKeepAwakeSound();

    },KEEP_AWAKE_START_DELAY_MS);

}

/**
 * いまも起こしたいか(札があり、渡している途中でなく、120分たっておらず、
 * 竹弘の曲が止まっている)を返します。play() の答えを待つ間に事情が
 * 変わっていないかを確かめるのに使います。
 *
 * @return {boolean}
 */
function isKeepAwakeStillWanted(){

    return keepAwakeTags.size > 0 && !keepAwakeHandingOff && !keepAwakeGaveUp && audioPlayer.paused;

}


// ==========================================================
// 6. 聞こえない曲を鳴らす・止める
// ==========================================================

/**
 * 聞こえない曲を鳴らし始めます。
 */
function startKeepAwakeSound(){

    // 待っている間に事情が変わっていたら、起こしません
    if(keepAwakeSounding || keepAwakeStarting || !isKeepAwakeStillWanted()){ return; }

    // 【v247】前の <audio> が残っていたら片付けてから、新しく作ります(冒頭の【v247】①)
    releaseKeepAwakeAudio();

    const audio = makeKeepAwakeAudio();

    /*
    <audio> や Blob が使えない古いブラウザでは、起こせません。
    今までどおり(v241)の動きになります(止まっている扱いのままなので、
    イヤホンの ▶ で再開できる)。
    */
    if(!audio){

        console.warn("寝ずの番(レイヤー5): この端末では起こしておけません(今までどおり動きます)");

        return;

    }

    keepAwakeAudio = audio;

    // 【開発用調査ログ】(v247)この <audio> の出来事を🐛パネルに出します
    watchKeepAwakeAudio(audio);

    // 【v247】音の回路に通します(冒頭の【v247】②)。通せなければ直接鳴らします
    connectKeepAwakeAudio(audio);

    keepAwakeStarting = true;

    let result = null;

    try{

        /*
        play() は「鳴らし始めてください」と頼む命令で、結果(Promise)が後から返ります。
        then は「うまく行った時」、catch は「失敗した時」にする仕事です。
        */
        result = audio.play();

    }
    catch(error){

        keepAwakeStarting = false;

        releaseKeepAwakeAudio();

        console.warn("寝ずの番(レイヤー5): 聞こえない曲を鳴らせませんでした(今までどおり動きます) :",error.name,error.message);

        return;

    }

    Promise.resolve(result).then(function(){

        /*
        答えを待っている間に片付けた(別の <audio> に替わった)時は、念のため古い方を
        止めておくだけにします(鳴りっぱなしにしないため。片付けた印が付いているので、
        この 'pause' は🐛パネルに出ません)。
        */
        if(keepAwakeAudio !== audio){

            audio.pause();

            return;

        }

        keepAwakeStarting = false;

        // 答えを待っている間に、札が外れた・竹弘の曲が鳴り始めた時は、すぐ止めます
        if(!isKeepAwakeStillWanted()){

            releaseKeepAwakeAudio();

            return;

        }

        keepAwakeSounding = true;
        keepAwakeStartedAtMs = performance.now();

        // 止め忘れの保険(120分)
        clearKeepAwakeTimer("max");

        keepAwakeMaxTimerId = setTimeout(function(){

            keepAwakeMaxTimerId = 0;

            keepAwakeGaveUp = true;

            refreshKeepAwake(KEEP_AWAKE_MAX_MIN + "分たった(止め忘れの保険)");

        },KEEP_AWAKE_MAX_MIN * 60 * 1000);

        // 【開発用調査ログ】(v245。v247 で「経路」を足した)
        console.log(
            "寝ずの番(レイヤー5): 起こし始めました(聞こえない曲 −60dB を鳴らし、" +
            "Chrome から見て再生中)/ 経路 : " + keepAwakeRoute + " / 札 : " + formatKeepAwakeTags()
        );

    }).catch(function(error){

        // 片付けた後の古い <audio> の答えなら、何もしません
        if(keepAwakeAudio !== audio){ return; }

        keepAwakeStarting = false;

        releaseKeepAwakeAudio();

        // 鳴らし始める途中で止めた時(札が外れた時など)は、失敗ではないので黙っています
        if(error && error.name === "AbortError"){ return; }

        console.warn("寝ずの番(レイヤー5): 聞こえない曲を鳴らせませんでした(今までどおり動きます) :",error.name,error.message);

    });

}

/**
 * 聞こえない曲を止めます。
 *
 * @param {string}  why     - 止める理由(🐛パネルに出す)
 * @param {boolean} handoff - true = ⏸ を係へ渡すために止める(すぐ鳴らし直すので、
 *                            v238 の「出口を休ませる」はしない)
 */
function stopKeepAwakeSound(why,handoff){

    clearKeepAwakeTimer("max");

    const wasSounding = keepAwakeSounding;

    keepAwakeSounding = false;
    keepAwakeStarting = false;

    // 【v247】止めたら <audio> ごと片付けます(次に起こす時は新しく作る)
    releaseKeepAwakeAudio();

    if(!wasSounding){ return; }

    // 【開発用調査ログ】(v245)
    console.log(
        "寝ずの番(レイヤー5): 止めました(" + why + ")/ 起こしていた時間 " +
        ((performance.now() - keepAwakeStartedAtMs) / 1000).toFixed(1) + "秒"
    );

    /*
    竹弘の曲が止まったまま休む時は、v238 の「音の出口を休ませる」に戻します
    (イヤホンの1回目の ▶ が効くように。js/deck.js の sleepDeckAudioSoon)。
    ⏸ を係へ渡す時は、すぐ鳴らし直すので休ませません。
    */
    if(!handoff && audioPlayer.paused && typeof sleepDeckAudioSoon === "function"){

        sleepDeckAudioSoon();

    }

}

/**
 * 聞こえない曲の <audio> を、新しく1つ作って返します(v247。起こすたびに呼ぶ)。
 *
 * @return {HTMLAudioElement|null} 作れない古いブラウザでは null
 */
function makeKeepAwakeAudio(){

    if(typeof Audio !== "function" || typeof Blob !== "function" || !window.URL || typeof URL.createObjectURL !== "function"){

        return null;

    }

    try{

        /*
        URL.createObjectURL は、メモリの中のデータ(Blob)に一時的な住所(blob:…)を
        付ける命令です。ファイルを置かなくても、<audio> がそれを読めます。
        住所は1回だけ作って、新しい <audio> でも使い回します(ページを閉じるまで
        使うので、住所を消す revokeObjectURL はしません)。
        */
        if(!keepAwakeSongUrl){ keepAwakeSongUrl = URL.createObjectURL(makeKeepAwakeSongBlob()); }

        const audio = new Audio();

        // loop = 最後まで鳴ったら頭に戻って繰り返す(JavaScript が動かなくても続く)
        audio.loop = true;
        audio.preload = "auto";
        audio.src = keepAwakeSongUrl;

        return audio;

    }
    catch(error){

        console.error("寝ずの番(レイヤー5): 聞こえない曲を作れませんでした :",error.name,error.message);

        return null;

    }

}

/**
 * 聞こえない曲の <audio> を、音の回路(js/deck.js の deckAudioCtx)に通します(v247)。
 *
 * 音の回路が無い・通せない時は、直接鳴らします(v246 と同じ)。
 *
 * createMediaElementSource は「<audio> の音を、音の回路の部品として取り出す」
 * 命令です。1つの <audio> に1回しか使えないので、<audio> を新しく作るたびに
 * 部品も作り直します。スピーカーへ直接つなぎ、全体の音量つまみ(js/deck.js の 3-4)
 * は通しません(同期の一時停止の間はつまみが0なので、通すと消えてしまう)。
 *
 * @param {HTMLAudioElement} audio
 */
function connectKeepAwakeAudio(audio){

    keepAwakeRoute = "直接";

    if(!deckAudioCtx || typeof deckAudioCtx.createMediaElementSource !== "function"){ return; }

    try{

        /*
        止めた時に v238 が休ませた出口を、起こします(js/deck.js の resumeDeckAudio。
        休んでいなければ何もしない)。起きるまでの短い間に鳴った分は、起きてから流れます。
        */
        resumeDeckAudio();

        const source = deckAudioCtx.createMediaElementSource(audio);

        source.connect(deckAudioCtx.destination);

        keepAwakeSource = source;
        keepAwakeRoute = "音の回路";

    }
    catch(error){

        // 通せなくても、直接鳴らせば Chrome から見て再生中にはなります
        console.warn("寝ずの番(レイヤー5): 音の回路に通せなかったので、直接鳴らします :",error.name,error.message);

    }

}

/**
 * 聞こえない曲の <audio> を止めて片付けます(v247)。無ければ何もしません。
 *
 * removeAttribute("src") と load() は「中身を外して、読み込んだデータを手放す」
 * 書き方です。片付けた <audio> の 'pause' や 'emptied' は寝ずの番がしたことなので、
 * 🐛パネルには出しません(印 keepAwakeReleasing)。
 */
function releaseKeepAwakeAudio(){

    const audio = keepAwakeAudio;
    const source = keepAwakeSource;

    keepAwakeAudio = null;
    keepAwakeSource = null;
    keepAwakeRoute = "";

    if(!audio){ return; }

    audio.keepAwakeReleasing = true;

    try{

        audio.pause();

        if(source){ source.disconnect(); }

        audio.removeAttribute("src");

        audio.load();

    }
    catch(ignore){ /* 片付けに失敗しても、もう使わないので構いません */ }

}

/**
 * 【開発用調査ログ】(v247)聞こえない曲の <audio> の出来事を🐛パネルに出す耳を付けます。
 *
 * @param {HTMLAudioElement} audio
 */
function watchKeepAwakeAudio(audio){

    KEEP_AWAKE_AUDIO_EVENTS.forEach(function(type){

        audio.addEventListener(type,function(){

            // 寝ずの番が自分で片付けた時の 'pause' 'emptied' は出しません
            if(audio.keepAwakeReleasing && (type === "pause" || type === "emptied")){ return; }

            let text = "寝ずの番の曲 '" + type + "' / t=" + (isFinite(audio.currentTime) ? audio.currentTime.toFixed(2) : "?") + "秒";

            if(type === "error" && audio.error){ text += " / エラーの番号 " + audio.error.code; }

            // 寝ずの番が止めていないのに止まった・終わった時は★(Chrome などが止めた手がかり)
            if((type === "pause" || type === "ended" || type === "emptied") && !audio.keepAwakeReleasing){ text += " ★寝ずの番は止めていない"; }

            // 時刻を付けたいので、js/debug-log.js の logDebugEvent があれば使います
            if(typeof logDebugEvent === "function"){ logDebugEvent(text); }
            else{ console.log(text); }

        });

    });

}

/**
 * 【開発用調査ログ】(v247)心拍の行(js/debug-log.js)の後ろに足す、寝ずの番の様子を返します。
 *
 * @return {string} 例:「寝ずの番 = 鳴らしている(曲 t=12.34 paused=false / 経路 音の回路 / 出口 running)」
 */
function describeKeepAwakeForLog(){

    if(!keepAwakeSounding && !keepAwakeStarting){

        return "寝ずの番 = 休み" + (keepAwakeTags.size > 0 ? "(札 : " + formatKeepAwakeTags() + ")" : "");

    }

    const audio = keepAwakeAudio;

    return "寝ずの番 = " + (keepAwakeSounding ? "鳴らしている" : "鳴らし始める途中") +
        "(曲 t=" + (audio ? audio.currentTime.toFixed(2) : "-") +
        " paused=" + (audio ? audio.paused : "-") +
        " / 経路 " + keepAwakeRoute +
        (deckAudioCtx ? " / 出口 " + deckAudioCtx.state : "") + ")";

}

/**
 * 聞こえない曲(WAV ファイル)を、メモリの中に作ります。
 *
 * WAV は「最初の44バイトに形の説明(ヘッダー)、その後ろに音の値を並べる」
 * だけの単純な形式です。ここでは 16bit(1つの値が2バイト)・モノラルで、
 * すべての値を同じ大きさ(KEEP_AWAKE_LEVEL)にします。
 *
 * DataView は、バイトの並び(ArrayBuffer)に、数字を決まった形で書き込む道具です。
 * 最後の true は「小さい桁から先に書く(リトルエンディアン)」で、WAV の決まりです。
 *
 * @return {Blob} audio/wav の Blob
 */
function makeKeepAwakeSongBlob(){

    const count = KEEP_AWAKE_SONG_SEC * KEEP_AWAKE_SONG_RATE;     // 値の数
    const dataBytes = count * 2;                                  // 16bit = 2バイト

    const buffer = new ArrayBuffer(44 + dataBytes);
    const view = new DataView(buffer);

    // 文字(4文字の目印)を書き込む小さな道具
    const writeText = function(offset,text){
        for(let i = 0; i < text.length; i++){ view.setUint8(offset + i,text.charCodeAt(i)); }
    };

    writeText(0,"RIFF");
    view.setUint32(4,36 + dataBytes,true);          // この後ろの大きさ
    writeText(8,"WAVE");
    writeText(12,"fmt ");
    view.setUint32(16,16,true);                     // fmt の説明の長さ
    view.setUint16(20,1,true);                      // 1 = 圧縮しない(PCM)
    view.setUint16(22,1,true);                      // 1 = モノラル
    view.setUint32(24,KEEP_AWAKE_SONG_RATE,true);   // 1秒あたりの値の数
    view.setUint32(28,KEEP_AWAKE_SONG_RATE * 2,true);   // 1秒あたりのバイト数
    view.setUint16(32,2,true);                      // 1つの値のバイト数
    view.setUint16(34,16,true);                     // 1つの値のビット数
    writeText(36,"data");
    view.setUint32(40,dataBytes,true);              // 音の値の大きさ

    // 16bit の最大は 32767。0.001 なら 33(四捨五入)
    const value = Math.round(KEEP_AWAKE_LEVEL * 32767);

    for(let i = 0; i < count; i++){ view.setInt16(44 + i * 2,value,true); }

    return new Blob([buffer],{ type:"audio/wav" });

}


// ==========================================================
// 7. 小さな道具
// ==========================================================

/**
 * 予約を1つ取り消します。
 *
 * @param {string} which - "start" / "max" / "handoff" / "rearm"
 */
function clearKeepAwakeTimer(which){

    if(which === "start" && keepAwakeStartTimerId){ clearTimeout(keepAwakeStartTimerId); keepAwakeStartTimerId = 0; }
    if(which === "max" && keepAwakeMaxTimerId){ clearTimeout(keepAwakeMaxTimerId); keepAwakeMaxTimerId = 0; }
    if(which === "handoff" && keepAwakeHandoffTimerId){ clearTimeout(keepAwakeHandoffTimerId); keepAwakeHandoffTimerId = 0; }
    if(which === "rearm" && keepAwakeRearmTimerId){ clearTimeout(keepAwakeRearmTimerId); keepAwakeRearmTimerId = 0; }

}

/**
 * 掛かっている札の名前を、🐛パネル用の文字にします。
 *
 * Array.from(Map.keys()) は「Map の名前だけを並べた配列」を作る書き方です。
 *
 * @return {string} 例:「同期の一時停止」
 */
function formatKeepAwakeTags(){

    return Array.from(keepAwakeTags.keys()).join("・") || "(なし)";

}
