/* ============================================================
   走行タイマー(1拍目からの経過時間)

   竹弘の発案(2026-09-23):
       「ノリRunで走行開始、1拍目から始まるタイマーを持ち、メニュー画面の
         ロック画面に走行開始からのタイマーを表示したくなりました」

   最初の使い手は、同期モードの薄暗いロック画面(段④。js/sync-lock.js)です。
   ⚠️ CLAUDE.md の約束で、**同期モード専用にしない形**で作っています。
      「今は時間を進めてよいか」の判断は、使う側が関数で渡します
      (startRunTimer の isMoving)。このファイルは同期モードのことを何も知りません。
      ふつうのノリノリRunで使う時も、判断の関数を変えるだけで済みます。

   ------------------------------------------------------------
   【数え方】

   「走った時間」だけを数えます。信号待ちなどで曲を止めている間は数えません
   (竹弘と決めた仕様:一時停止では止め、再開で続ける)。

       経過時間 = 「進めてよい」間の時間の合計

   数え直し(settleRunTimer)のたびに、前回からの時間を
   「前回の時点で進めてよかったなら」足し込みます。

       前回の数え直し ───── 今
       ↑ この時に進めてよかったか(lastMoving)で、間の時間を足すか決める

   数え直すのは次の時です。状態が変わる瞬間(曲が止まった・鳴り始めた)に
   数え直すほど、正確になります。

       ・主役のデッキの pause / play / playing(bindDeckEvent)
       ・画面の見える・見えないが変わった時(visibilitychange)
       ・1秒ごと(状態が知らせ無しに変わった時の保険。下の RUN_TIMER_TICK_MS)
       ・値を読む時(getRunTimerElapsedMs)

   ⚠️ 時刻は performance.now()(指の時計)で測ります。Date.now()(スマホの時計)は
      電波で合わせ直されて飛ぶことがあるためです(同期モードの v227〜v228 の教訓)。
      画面オフで深く眠ると performance.now() が止まる端末がありますが(v242)、
      深く眠るのは曲が止まっている時だけなので、その間は数えておらず影響しません。
   ============================================================ */


// ==========================================================
// 1. 決まった数値
// ==========================================================

/*
知らせ無しに状態が変わった時の保険として、数え直す間隔(ミリ秒)。

たとえば同期モードで、一時停止から再開した後の「みんなの拍への合わせ直し」が
終わった瞬間には、曲の知らせ(play など)が出ません。そこで1秒ごとにも数え直し、
ずれても最大1秒で済むようにしています。数え直しは足し算1回なので軽い処理です。
*/
const RUN_TIMER_TICK_MS = 1000;


// ==========================================================
// 2. 今の状態
// ==========================================================

const runTimer = {

    // 数え始めたか(startRunTimer を呼んだか)
    started: false,

    // 終えたか(stopRunTimer を呼んだか)。終えた後も、最後の値は読めます
    ended: false,

    // これまでに数えた時間(ミリ秒)
    elapsedMs: 0,

    // 最後に数え直した時刻(performance.now の物差し)
    lastPerfMs: 0,

    // 最後に数え直した時、時間を進めてよかったか
    lastMoving: false,

    // 「今は時間を進めてよいか」を答える関数(使う側が渡す)
    isMoving: null,

    // 誰が動かしているか(🐛パネルに出す名前。例:「同期モード」)
    owner: "",

    // 1秒ごとの数え直しの番号(setInterval)。0 = 動いていない
    tickId: 0

};


// ==========================================================
// 3. 数える
// ==========================================================

/**
 * 「今は時間を進めてよいか」を使う側に聞きます。
 *
 * 使う側の関数がエラーを出しても、タイマーごと止まらないように
 * try で包んでいます(その時は「進めない」と答える)。
 *
 * @return {boolean}
 */
function askRunTimerMoving(){

    if(typeof runTimer.isMoving !== "function"){ return false; }

    try{

        return !!runTimer.isMoving();

    }catch(error){

        console.error("走行タイマー : 進めてよいかの判断でエラー :",error.name,error.message);

        return false;

    }

}

/**
 * 前回の数え直しから今までの時間を足し込み、今の状態を覚え直します。
 *
 * 数えていない時(まだ始めていない・終えた後)は何もしません。
 */
function settleRunTimer(){

    if(!runTimer.started || runTimer.ended){ return; }

    const nowMs = performance.now();

    const passedMs = nowMs - runTimer.lastPerfMs;

    /*
    まだ1拍目の瞬間が来ていない時(数え始めの時刻が少し先)は、何もしません。
    lastPerfMs を動かさないので、1拍目の瞬間からきっちり数え始めます。
    */
    if(passedMs < 0){ return; }

    if(runTimer.lastMoving){ runTimer.elapsedMs += passedMs; }

    runTimer.lastPerfMs = nowMs;

    runTimer.lastMoving = askRunTimerMoving();

}

/**
 * タイマーを数え始めます。
 *
 * ⚠️ もう数えている途中(始めたが、まだ終えていない)なら、0 に戻さず
 *    **続きから**数えます。判断の関数だけ新しいものに取り替えます。
 *    同期モードで、走っている途中にもう一度スタートし直した時に、
 *    それまでの走った時間が消えないようにするためです。
 *
 * @param {number}   startPerfMs - 数え始める瞬間(performance.now の物差し。少し先でもよい)
 * @param {Function} isMoving    - 「今は時間を進めてよいか」を true / false で答える関数
 * @param {string}   owner       - 誰が動かしているか(🐛パネルに出す名前)
 */
function startRunTimer(startPerfMs,isMoving,owner){

    if(runTimer.started && !runTimer.ended){

        // 続きから:ここまでを足し込んでから、判断の関数を取り替えます
        settleRunTimer();

        runTimer.isMoving = isMoving;
        runTimer.owner = owner;
        runTimer.lastMoving = askRunTimerMoving();

        // 【開発用調査ログ】(v248)
        console.log("走行タイマー : 続きから数えます(" + owner + " / ここまで " + formatRunTimer(runTimer.elapsedMs) + ")");

        return;

    }

    runTimer.started = true;
    runTimer.ended = false;
    runTimer.elapsedMs = 0;
    runTimer.isMoving = isMoving;
    runTimer.owner = owner;

    /*
    数え始めの瞬間(1拍目)からは「進めてよい」とみなします。
    その瞬間に曲が鳴り始めているはずだからです。もし違っていても、
    次の数え直し(最大1秒後)で正しい状態に直ります。
    */
    runTimer.lastPerfMs = isFinite(startPerfMs) ? startPerfMs : performance.now();
    runTimer.lastMoving = true;

    if(runTimer.tickId){ clearInterval(runTimer.tickId); }

    runTimer.tickId = setInterval(settleRunTimer,RUN_TIMER_TICK_MS);

    // 【開発用調査ログ】(v248)
    console.log("走行タイマー : 数え始めました(" + owner + " / 1拍目の瞬間から " +
                Math.round(performance.now() - runTimer.lastPerfMs) + "ms 後)");

}

/**
 * タイマーを終えます。最後の値はそのまま読めます(getRunTimerElapsedMs)。
 * 数えていなければ何もしません。
 *
 * @param {string} why - 終えた理由(🐛パネルに出す)
 */
function stopRunTimer(why){

    if(!runTimer.started || runTimer.ended){ return; }

    settleRunTimer();

    runTimer.ended = true;

    if(runTimer.tickId){

        clearInterval(runTimer.tickId);

        runTimer.tickId = 0;

    }

    // 【開発用調査ログ】(v248)
    console.log("走行タイマー : 終えました(" + why + " / 走った時間 " + formatRunTimer(runTimer.elapsedMs) + ")");

}

/**
 * これまでに数えた時間(ミリ秒)を返します。数えている途中なら、今の分まで足し込みます。
 *
 * @return {number}
 */
function getRunTimerElapsedMs(){

    settleRunTimer();

    return runTimer.elapsedMs;

}

/**
 * 数えている途中か(始めたが、まだ終えていない)を返します。
 *
 * @return {boolean}
 */
function isRunTimerCounting(){

    return runTimer.started && !runTimer.ended;

}

/**
 * 今、時間が進んでいるか(最後に数え直した時の状態)を返します。
 * 画面に「走っています / 止めています」を出す時に使います。
 *
 * @return {boolean}
 */
function isRunTimerMoving(){

    return isRunTimerCounting() && runTimer.lastMoving;

}


// ==========================================================
// 4. 表示の形
// ==========================================================

/**
 * ミリ秒を「時:分:秒」(例 0:12:34)の文字にします。
 *
 * 1時間に届かなくても時を出します(0:12:34)。マラソンは何時間も走るので、
 * 1時間を越えた瞬間に文字の幅が変わって、数字が横にずれないようにするためです。
 *
 * padStart(2,"0") は「2文字に満たなければ、前に0を足す」書き方です(5 → "05")。
 *
 * @param  {number} ms
 * @return {string}
 */
function formatRunTimer(ms){

    const totalSec = Math.max(0,Math.floor(ms / 1000));

    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;

    return h + ":" + String(m).padStart(2,"0") + ":" + String(s).padStart(2,"0");

}


// ==========================================================
// 5. 状態が変わる瞬間に数え直す
// ==========================================================
/*
bindDeckEvent(js/deck.js)は「主役のデッキ」の知らせだけを届けます。
デッキが2枚とも当たるので、曲が繋がって主役が交代しても漏れません。

⚠️ typeof で確かめるのは、このファイルを別の画面で読み込んだ時にも
   エラーで止まらないようにするためです(c014.html では deck.js が先に読まれます)。
*/
if(typeof bindDeckEvent === "function"){

    bindDeckEvent("pause",settleRunTimer);
    bindDeckEvent("play",settleRunTimer);
    bindDeckEvent("playing",settleRunTimer);

}

document.addEventListener("visibilitychange",settleRunTimer);
