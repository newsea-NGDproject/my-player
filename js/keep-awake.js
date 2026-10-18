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
     層5 寝ずの番(このファイル)… 聞こえない音で、アプリを眠らせない

 曲は鳴らしません。デッキA・Bとは別物です。

----------------------------------------------------------------------

【なぜ要るのか(竹弘の実機、2026-10-18)】

 同期スタートした後、曲を止めて画面を消しておくと、XPERIA では
 ブラウザ版で約2分、インストール版で約4分45秒で、Chrome がページを
 「凍結」しました(document の 'freeze')。凍結している間は、イヤホンの
 ▶ がノリRunまで届かず、再開できません。

 Chrome は「**聞こえる音**を出しているページ」だけを凍結しません。
 止めている間は無音なので、凍結されます(海外の事例を調べても、ここを
 きれいに解いた Web アプリは見つからなかった)。

 v240 で、−60dB の聞こえない信号(直流)を流せば凍結しないことは確かめて
 あります。ところがそれだけだと、イヤホンが2回タップになります。

----------------------------------------------------------------------

【2回タップになる仕組みと、先回り(竹弘の案「必要な起動を複数」)】

     ・Chrome(門番)は、止まっている時は ▶ だけ、鳴っている時は ⏸ だけを
       ノリRunに渡し、もう片方は渡す前に捨てる
       (Chromium の MediaNotificationController の onPlay / onPause)
     ・イヤホンは ⏸ と ▶ を自分で交互に送り、スマホの状態が変わったと
       知らされると、そこで合わせ直す
     ・信号が流れていると、イヤホンは「鳴っている」と思って ⏸ を送るのに、
       Chrome は「止まっている」と思っているので捨てる → 2回目の ▶ で再開

 1回目のタップは Chrome がページへ渡す前に捨てるので、ノリRunからは
 見張ることもできません。そこで**先回り**します。

     止めている間、寝ずの番が Chrome に「再生中」と伝える
       (navigator.mediaSession.playbackState = "playing")
     → Chrome・イヤホンの両方が「鳴っている」で揃い、イヤホンの ⏸ が届く
     → 届いた ⏸ を、札を掛けた係(同期モード)へ「再開して」と渡す

 ⚠️ Chrome は、ページが「再生中」と言えば、曲が止まっていても再生中として
    扱います。逆の「止まっている」と偽ることだけは禁止です(曲が鳴って
    いるのに止まっていると言っても、再生中のまま)。Chromium の
    media_session_impl.cc の GetMediaSessionInfoSync で確かめました。

----------------------------------------------------------------------

【「札」の仕組み】

 寝ずの番に起きていてほしい係は、名前の付いた**札**を掛けます。
 寝ずの番は、札が1枚でも掛かっていれば起き、全部外れたら休みます。
 札を掛けた係は、自分の札を外すだけでよく、ほかの係のことは
 知らなくて構いません。

     hangKeepAwakeTag(名前, ⏸が届いた時に呼ぶ関数)
     removeKeepAwakeTag(名前, 理由)

 いまの札は1枚だけです。

     「同期の一時停止」… js/sync.js の 5-5(同期スタート後に止めた時)

 「起こすかどうか」「どの強さで鳴らすか」「いつ止めるか」はこのファイルの
 refreshKeepAwake() の1か所で決めます(getTrackCover や
 findMetronomeBlockReason と同じ「決めるのは1か所」の考え方)。

 ⚠️ 同期モードの画面を開いている間の −80dB の信号(js/sync.js の v232、
    startSyncKeepAwake)は、まだ sync.js の中にあります。この版(v245)の
    実験がうまく行ったら、次の版で寝ずの番へ引っ越す予定です。

----------------------------------------------------------------------

【流れ】

  止めた(同期スタート後。js/sync.js が札を掛ける)
    → KEEP_AWAKE_START_DELAY_MS(1.5秒)待つ
       (その間に v238 が音の出口を休ませ、Chrome とイヤホンに
        「止まった」がはっきり伝わる)
    → 音の出口を起こして −60dB の信号を流し、Chrome に「再生中」と伝える
       (イヤホンに「鳴っている」が伝わる)

  イヤホン・通知・ロック画面の ⏸ が届いた(js/media-session.js から)
    → 信号を止め、Chrome に「止まった」と伝える
    → KEEP_AWAKE_HANDOFF_MS(0.2秒)後に、札を掛けた係へ「再開して」と渡す
       (同期モードは曲を鳴らし、みんなの拍に合わせ直す = v241・v242)

  鳴り始めた・取りやめた(js/sync.js が札を外す)
    → 信号を止める。曲が止まったままなら、v238 の「出口を休ませる」に戻す

----------------------------------------------------------------------

【「止まった」と「再生中」の間を空ける理由】

 Chrome は、通知(とイヤホンへ伝える状態)を **500ms に1回**までにまとめます
 (Chromium の MediaNotificationController の THROTTLE_MILLIS = 500)。
 間が短いと途中の「止まった」が上書きされて消え、イヤホンには何も変わって
 いないように見えます(v239 の「音だけ消す」で2回タップになったのと同じ形)。

     止めてから「再生中」と伝えるまで … 1.5秒(500ms より十分長く)
     ⏸ が届いて「止まった」と伝えてから鳴らすまで … 0.2秒
       (「止まった」はすぐ伝わり、鳴り始めた「再生中」は Chrome が
        500ms 後にまとめて伝える。どちらもイヤホンに届く)

----------------------------------------------------------------------

【⚠️ 実験の版(v245)です】

 イヤホンが本当に「スマホの状態が変わったら合わせ直す」かは、イヤホンの
 機種しだいで、実機で確かめるしかありません。見ること:

     ・画面を消して5分以上止めても、凍結しない(🐛に 'freeze' が出ない)
     ・止めている間のイヤホンの ⏸(1回)で再開する
       (🐛に「⏸ が届いた … 伝えてある状態 = playing」→「再開を頼みます」)
     ・再開した後の、次の一時停止も1回で効く

 外れた時の代わりの案は「止めて1分たってから起こす」(短い一時停止は
 v238 のまま1タップ、長い休みは2タップ・凍結しない)。

 電池:起こしている間は、曲を鳴らしている時と同じくらい使います。
 止め忘れの保険として、KEEP_AWAKE_MAX_MIN(120分)で休みます。
======================================================================
*/


// ==========================================================
// 1. 決めごと
// ==========================================================

/*
流す信号の大きさ(直流の値。1 が最大)。0.001 = −60dB。

Chrome が「鳴っている」とみなす境目は約 −72dB です。

    −80dB(0.0001)… 鳴っていない扱い。音の出口だけ起こしておける
                      (同期モードの画面の v232 の信号はこちら)
    −60dB(0.001) … 鳴っている扱い。ページごと起こしておける(凍結しない。v240 で実証)

直流(ずっと同じ値)なので、イヤホンやスピーカーからは音になりません。
*/
const KEEP_AWAKE_LEVEL = 0.001;

// 信号を上げ下げする時間(秒)。いきなり変えると「プツ」の元になりうるため(v232 と同じ)
const KEEP_AWAKE_RAMP_SEC = 0.05;

// 札が掛かってから、起こし始めるまでの待ち(ms)。理由は冒頭の【「止まった」と「再生中」の間…】
const KEEP_AWAKE_START_DELAY_MS = 1500;

// ⏸ が届いて「止まった」と伝えてから、札を掛けた係へ渡すまでの待ち(ms)。理由は同上
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

// 流している信号(ConstantSourceNode)。null = 流していない
let keepAwakeNode = null;

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
 * いま寝ずの番が起こしている(信号を流し、Chrome に「再生中」と伝えている)かを返します。
 *
 * js/deck.js の isDeckAudioWantedAwake() が、起こしている間は音の出口を
 * 休ませないために使います。
 *
 * @return {boolean}
 */
function isKeepAwakeSounding(){

    return keepAwakeNode !== null;

}


// ==========================================================
// 4. 起こしている間に ⏸ が届いた時(js/media-session.js から呼ぶ)
// ==========================================================

/**
 * イヤホン・通知・ロック画面の ⏸ が届いた時に、js/media-session.js が
 * まずここに聞きます。
 *
 * 寝ずの番が起こしている間に届いた ⏸ は、Chrome に「再生中」と伝えて
 * あるから届いたもので、本当は**曲は止まっています**。つまり竹弘の
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

    // 信号を止め、Chrome に「止まった」と伝えます(冒頭の【「止まった」と「再生中」の間…】)
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

        if(isKeepAwakeSounding()){ stopKeepAwakeSound(why,false); }

        return;

    }

    // もう起こしている・起こす予約がある時は、そのままにします
    if(isKeepAwakeSounding() || keepAwakeStartTimerId){ return; }

    keepAwakeStartTimerId = setTimeout(function(){

        keepAwakeStartTimerId = 0;

        startKeepAwakeSound();

    },KEEP_AWAKE_START_DELAY_MS);

}


// ==========================================================
// 6. 信号を流す・止める
// ==========================================================

/**
 * 音の出口を起こして −60dB の信号を流し、Chrome に「再生中」と伝えます。
 */
function startKeepAwakeSound(){

    // 待っている間に事情が変わっていたら、起こしません
    if(keepAwakeTags.size === 0 || keepAwakeHandingOff || keepAwakeGaveUp || isKeepAwakeSounding()){ return; }

    /*
    曲がもう鳴っているなら、曲そのものが「聞こえる音」なので要りません
    (ふつうは鳴り始めた時に札が外れているので、ここには来ません)。
    */
    if(!audioPlayer.paused){ return; }

    /*
    音の回路(js/deck.js の deckAudioCtx)が無い・ConstantSourceNode が無い
    古いブラウザでは、起こせません。その時は Chrome に「再生中」とも伝えません
    (信号が無いのに「再生中」と伝えると、イヤホンは「止まっている」と思って
    ▶ を送り、Chrome はそれを捨ててしまう)。今までどおり(v241)の動きになります。
    */
    if(!deckAudioCtx || typeof deckAudioCtx.createConstantSource !== "function"){

        console.warn("寝ずの番(レイヤー5): この端末では起こしておけません(今までどおり動きます)");

        return;

    }

    /*
    止めた時に v238 が休ませた音の出口を、起こします(js/deck.js の
    resumeDeckAudio。休んでいなければ何もしません)。起きるまでの間に
    予約した信号は、起きてから流れます。
    */
    resumeDeckAudio();

    try{

        /*
        ConstantSourceNode は「ずっと同じ値を出し続ける」音源です(直流)。
        ⚠️ 最初は1(最大)なので、鳴らし始める前に必ず0にしてから、
           KEEP_AWAKE_RAMP_SEC 秒かけて上げます(v232 の信号と同じ書き方)。

            setValueAtTime(値,時刻)          … その時刻に、その値にする
            linearRampToValueAtTime(値,時刻) … その時刻までに、まっすぐその値へ
        */
        const node = deckAudioCtx.createConstantSource();

        const now = deckAudioCtx.currentTime;

        node.offset.value = 0;
        node.offset.setValueAtTime(0,now);
        node.offset.linearRampToValueAtTime(KEEP_AWAKE_LEVEL,now + KEEP_AWAKE_RAMP_SEC);

        /*
        スピーカーへ直接つなぎます。全体の音量つまみ(js/deck.js の 3-4)は
        通しません。同期の一時停止の間はつまみが0なので、通すと消えてしまい、
        Chrome から見て「聞こえる音」にならないためです。
        */
        node.connect(deckAudioCtx.destination);

        node.start();

        keepAwakeNode = node;

    }
    catch(error){

        console.error("寝ずの番(レイヤー5): 信号を流せませんでした :",error.name,error.message);

        return;

    }

    keepAwakeStartedAtMs = performance.now();

    setKeepAwakePlaybackState("playing");

    // 止め忘れの保険(120分)
    clearKeepAwakeTimer("max");

    keepAwakeMaxTimerId = setTimeout(function(){

        keepAwakeMaxTimerId = 0;

        keepAwakeGaveUp = true;

        refreshKeepAwake(KEEP_AWAKE_MAX_MIN + "分たった(止め忘れの保険)");

    },KEEP_AWAKE_MAX_MIN * 60 * 1000);

    // 【開発用調査ログ】(v245)
    console.log(
        "寝ずの番(レイヤー5): 起こし始めました(聞こえない信号 −60dB を流し、" +
        "Chrome には「再生中」と伝えました)/ 札 : " + formatKeepAwakeTags()
    );

}

/**
 * 信号を止めます。
 *
 * Chrome に伝える状態は、曲が止まっていれば「止まった」、鳴っていれば
 * 「再生中」に戻します。
 *
 * @param {string}  why     - 止める理由(🐛パネルに出す)
 * @param {boolean} handoff - true = ⏸ を係へ渡すために止める(すぐ鳴らし直すので、
 *                            v238 の「出口を休ませる」はしない)
 */
function stopKeepAwakeSound(why,handoff){

    clearKeepAwakeTimer("max");

    if(!keepAwakeNode){ return; }

    const node = keepAwakeNode;

    keepAwakeNode = null;

    try{

        const now = deckAudioCtx.currentTime;

        /*
        予約してある変化を取り消し、今の値から0へ下げてから止めます
        (v232 の stopSyncKeepAwake と同じ書き方)。cancelScheduledValues は
        「この時刻より後の予約を取り消す」命令です。
        */
        node.offset.cancelScheduledValues(now);
        node.offset.setValueAtTime(node.offset.value,now);
        node.offset.linearRampToValueAtTime(0,now + KEEP_AWAKE_RAMP_SEC);

        // 下げきった少し後に止め、止まったら配線を外します(部品を残さない)
        node.onended = function(){ node.disconnect(); };

        node.stop(now + KEEP_AWAKE_RAMP_SEC + 0.01);

    }
    catch(error){

        // 止める予約に失敗しても、配線だけは外しておきます(流れ続けないように)
        try{ node.disconnect(); }catch(ignore){ /* すでに外れていても構いません */ }

    }

    setKeepAwakePlaybackState(audioPlayer.paused ? "paused" : "playing");

    // 【開発用調査ログ】(v245)
    console.log(
        "寝ずの番(レイヤー5): 止めました(" + why + ")/ 起こしていた時間 " +
        ((performance.now() - keepAwakeStartedAtMs) / 1000).toFixed(1) + "秒"
    );

    /*
    曲が止まったまま休む時は、v238 の「音の出口を休ませる」に戻します
    (イヤホンの1回目の ▶ が効くように。js/deck.js の sleepDeckAudioSoon)。
    ⏸ を係へ渡す時は、すぐ鳴らし直すので休ませません。
    */
    if(!handoff && audioPlayer.paused && typeof sleepDeckAudioSoon === "function"){

        sleepDeckAudioSoon();

    }

}


// ==========================================================
// 7. 小さな道具
// ==========================================================

/**
 * Chrome(Media Session)に伝える再生状態を書き換えます。
 * 対応していないブラウザでは何もしません。
 *
 * @param {string} state - "playing" / "paused"
 */
function setKeepAwakePlaybackState(state){

    if(!("mediaSession" in navigator)){ return; }

    navigator.mediaSession.playbackState = state;

}

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
