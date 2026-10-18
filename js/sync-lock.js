/* ============================================================
   みんなで走る同期モード:薄暗いロック画面(段④。v248)

   同期スタートした瞬間に、🕺ノリノリRun画面の上へ薄暗い幕をかぶせ、
   **音量以外の操作をロック**します(音量はスマホ本体のボタンで変えられる。
   アプリ側では何もしなくても効く)。走っている間に、ポケットの中や
   汗の付いた指で、うっかり曲を変えたり止めたりしないためです。

   📘 仕様は CLAUDE.md の「追加1」(2026-09-22 に竹弘と詰めた仕様と、
      「段④に足すこと」)が正。この版で作ったのは次の分です。

       ・同期スタートしたら、薄暗いロック画面を出す(finishSyncStart から呼ばれる)
       ・幕の真ん中に、走行タイマー(1拍目からの経過時間。js/run-timer.js)
       ・画面に触れると、確認を出す
           「ロック解除」「解除しない」
           止めている時だけ、スライドで再開
           リードランナーだけ「🔊 カチッを鳴らす」(竹弘の要望 2026-10-04)
           スライドで同期モードを終える(誤操作防止。竹弘の要望 2026-10-04)
       ・ロックしている間は、イヤホンの ⏭⏮ を使わない(js/media-session.js が
         isSyncLockShown() を見る)。⏸ ▶ は今までどおり効く
         (再開したら js/sync.js の 5-5 が、みんなの拍に合わせ直す。v241)

   ⚠️ 「時刻ボタンから再開」(2026-09-22 の仕様)は作っていません。v241 から、
      どこから再開しても自動でみんなの拍に合わせ直すようになったためです
      (CLAUDE.md の「追加1」の 2026-10-18 の決め直し)。

   ------------------------------------------------------------
   【見た目】

   ジャケ写の特大表示(#jacket-panel)と同じく、**薄く透けて下の画面が見える**
   幕です(竹弘のイメージ:2026-10-18「ジャケ写の特大表示のような透ける画面」)。
   #app の外に置き、暁色は「#app.norirun-mode ~ #sync-lock」で受け取ります
   (ジャケの特大表示と同じ受け渡し。c014.html の CSS のコメント)。

   ⚠️ 重なり順(z-index)は 2500 です。ほかのパネル(2000)より手前、
      横向きのお知らせ(9000)と開発用デバッグログ(20000)より奥にしてあります。
      🐛 が押せなくなると、実機テストでログが取れなくなるためです。
   ============================================================ */


// ==========================================================
// 1. 決まった数値
// ==========================================================

/*
確認を出したまま触らなければ、薄暗い画面へ戻すまでの時間(ミリ秒)。
ポケットの中で確認が開いたままになり、そこへさらに何かが触れて
スライドが動いてしまう、という重なりを避けるためです。
*/
const SYNC_LOCK_SHEET_AUTO_CLOSE_MS = 10000;

/*
スライドを、つまみが動ける幅の何割まで動かしたら「決まり」とするか。
最後まで(1.0)だと指の幅の分だけ届かないことがあるので、少し手前にしています。
*/
const SYNC_LOCK_SLIDE_DONE_RATIO = 0.85;

// 走行タイマーの表示を書き換える間隔(ミリ秒)。秒が変わった時だけ文字を書き換えます
const SYNC_LOCK_REFRESH_MS = 250;


// ==========================================================
// 2. 画面部品
// ==========================================================

const syncLockEl         = document.getElementById("sync-lock");
const syncLockFaceEl     = document.getElementById("sync-lock-face");
const syncLockTimerEl    = document.getElementById("sync-lock-timer");
const syncLockStateEl    = document.getElementById("sync-lock-state");

const syncLockSheetEl    = document.getElementById("sync-lock-sheet");
const syncLockUnlockBtn  = document.getElementById("sync-lock-unlock");
const syncLockKeepBtn    = document.getElementById("sync-lock-keep");
const syncLockResumeEl   = document.getElementById("sync-lock-resume");
const syncLockLeadBtn    = document.getElementById("sync-lock-lead");
const syncLockEndEl      = document.getElementById("sync-lock-end");

const syncLockConfirmEl        = document.getElementById("sync-lock-confirm");
const syncLockConfirmMessageEl = document.getElementById("sync-lock-confirm-message");
const syncLockConfirmOkBtn     = document.getElementById("sync-lock-confirm-ok");
const syncLockConfirmCancelBtn = document.getElementById("sync-lock-confirm-cancel");

const syncLockFinishEl     = document.getElementById("sync-lock-finish");
const syncLockFinishTimeEl = document.getElementById("sync-lock-finish-time");
const syncLockFinishNoteEl = document.getElementById("sync-lock-finish-note");
const syncLockFinishBtn    = document.getElementById("sync-lock-finish-close");


// ==========================================================
// 3. 今の状態
// ==========================================================

const syncLock = {

    // ロック画面を出しているか
    shown: false,

    /*
    いま見せている面。

        "face"    … 薄暗い画面(タイマーだけ)
        "sheet"   … 触った時の確認(ロック解除・スライド …)
        "confirm" … リードのカチッの前の「Bluetoothを切りましたか?」
        "finish"  … 同期モードを終えた後の「おつかれさまでした」
    */
    view: "face",

    // 確認を自動で閉じる予約(setTimeout の番号)。0 = 予約なし
    sheetTimerId: 0,

    // 表示を書き換える係(setInterval の番号)。0 = 動いていない
    refreshId: 0,

    // 最後に書いたタイマーの文字(同じなら書き換えない)
    lastTimerText: ""

};


// ==========================================================
// 4. 走行タイマーに渡す「今は時間を進めてよいか」
// ==========================================================

/**
 * 同期モードで走っている最中か(走行タイマーの時間を進めてよいか)を返します。
 *
 *     進める   … 曲が鳴っている / 🎬頭出し接続の無音の間(走り続けているため)
 *     進めない … 竹弘が止めている / 止めた後、みんなの拍に合わせ直している途中 /
 *                同期モードの画面を開き直した(syncState.running が false)/
 *                🕺ノリノリRunを出た
 *
 * syncResume(js/sync.js の 5-5)は、竹弘が止めた時に作られ、合わせ直しが
 * 終わると消える「再開の約束」です。これがある間は進めません。
 *
 * @return {boolean}
 */
function isSyncRunMoving(){

    if(!syncState.running || !isNoriRunMode){ return false; }

    if(syncResume){ return false; }

    if(!audioPlayer.paused){ return true; }

    return (typeof isConnectSilence === "function") && isConnectSilence();

}


// ==========================================================
// 5. 出す・隠す
// ==========================================================

/**
 * 同期スタートした瞬間に、ロック画面を出して走行タイマーを動かします。
 * js/sync.js の finishSyncStart() から呼ばれます。
 *
 * ⚠️ 走行タイマーは、走っている途中でもう一度スタートし直した時は 0 に戻さず、
 *    続きから数えます(js/run-timer.js の startRunTimer)。
 *
 * @param {number} firstBeatPerfMs - 1拍目の瞬間(performance.now の物差し)
 */
function showSyncLock(firstBeatPerfMs){

    if(!syncLockEl){ return; }

    startRunTimer(firstBeatPerfMs,isSyncRunMoving,"同期モード");

    syncLock.shown = true;
    syncLock.lastTimerText = "";

    syncLockEl.style.display = "flex";

    showSyncLockView("face");

    refreshSyncLock();

    if(!syncLock.refreshId){

        syncLock.refreshId = setInterval(refreshSyncLock,SYNC_LOCK_REFRESH_MS);

    }

    // 【開発用調査ログ】(v248)
    console.log("同期モード ④ ロック画面を出しました(音量以外の操作をロック)");

}

/**
 * ロック画面を隠します。走行タイマーは止めません(同期モードは続いている)。
 *
 * @param {string} why - 隠す理由(🐛パネルに出す)
 */
function hideSyncLock(why){

    if(!syncLockEl){ return; }

    clearSyncLockSheetTimer();

    if(syncLock.refreshId){

        clearInterval(syncLock.refreshId);

        syncLock.refreshId = 0;

    }

    syncLock.shown = false;

    syncLockEl.style.display = "none";

    // 【開発用調査ログ】(v248)
    console.log("同期モード ④ ロック画面を閉じました(" + why + ")");

}

/**
 * ロック画面を出しているかを返します。
 *
 * js/media-session.js が、イヤホンの ⏭⏮ を使わないかどうかの判断に使います。
 *
 * @return {boolean}
 */
function isSyncLockShown(){

    return syncLock.shown;

}


// ==========================================================
// 6. 面の切り替え(薄暗い画面・確認・カチッの確認・終わり)
// ==========================================================

/**
 * ロック画面の中で、どの面を見せるかを切り替えます。
 *
 * @param {string} view - "face" / "sheet" / "confirm" / "finish"(syncLock.view のコメント)
 */
function showSyncLockView(view){

    syncLock.view = view;

    /*
    薄暗い画面(タイマー)は、終わりの面の時だけ隠します。
    確認を出している間も後ろにタイマーが見えている方が、
    「いまロック画面の中にいる」と分かりやすいためです。
    */
    syncLockFaceEl.style.display    = (view === "finish")  ? "none" : "flex";
    syncLockSheetEl.style.display   = (view === "sheet")   ? "flex" : "none";
    syncLockConfirmEl.style.display = (view === "confirm") ? "flex" : "none";
    syncLockFinishEl.style.display  = (view === "finish")  ? "flex" : "none";

    syncLockEl.classList.toggle("sync-lock-dim-more",view !== "face");

    clearSyncLockSheetTimer();

    // 確認とカチッの確認は、触らなければ薄暗い画面へ戻します
    if(view === "sheet" || view === "confirm"){ armSyncLockSheetTimer(); }

    refreshSyncLock();

}

/**
 * 確認を自動で閉じる予約を入れ直します(触るたびに延ばす)。
 */
function armSyncLockSheetTimer(){

    clearSyncLockSheetTimer();

    syncLock.sheetTimerId = setTimeout(function(){

        syncLock.sheetTimerId = 0;

        if(syncLock.shown && (syncLock.view === "sheet" || syncLock.view === "confirm")){

            showSyncLockView("face");

        }

    },SYNC_LOCK_SHEET_AUTO_CLOSE_MS);

}

/**
 * 確認を自動で閉じる予約を取り消します。
 */
function clearSyncLockSheetTimer(){

    if(!syncLock.sheetTimerId){ return; }

    clearTimeout(syncLock.sheetTimerId);

    syncLock.sheetTimerId = 0;

}


// ==========================================================
// 7. 表示の書き換え
// ==========================================================

/**
 * タイマー・いまの状態・出すボタンを書き換えます(0.25秒ごと + 曲の知らせの時)。
 */
function refreshSyncLock(){

    if(!syncLock.shown){ return; }

    // ---- タイマー(秒が変わった時だけ書き換える)----
    const timerText = formatRunTimer(getRunTimerElapsedMs());

    if(timerText !== syncLock.lastTimerText){

        syncLock.lastTimerText = timerText;

        syncLockTimerEl.textContent = timerText;

    }

    // ---- いまの状態 ----
    const paused = isSyncLockMusicStopped();

    let stateText;

    if(!syncState.running){

        stateText = "🏁 同期モードを終えました";

    }else if(paused){

        stateText = "⏸ 止めています(再開すると、みんなの拍に合わせ直します)";

    }else if(syncResume){

        stateText = "⏳ みんなの拍に合わせ直しています";

    }else{

        stateText = "▶ 走っています";

    }

    if(syncLockStateEl.textContent !== stateText){ syncLockStateEl.textContent = stateText; }

    syncLockEl.classList.toggle("sync-lock-paused",paused);

    // ---- 確認の中のボタン ----

    // 再開のスライドは、止めている時だけ出します
    syncLockResumeEl.style.display = paused ? "flex" : "none";

    // リードの「カチッを鳴らす」は、リードのスマホだけに出します
    const lead = (typeof isSyncLeadPhone === "function") && isSyncLeadPhone() && syncAnchorPerfMs !== null;

    syncLockLeadBtn.style.display = lead ? "block" : "none";

    const ringing = (syncClockBeepTimerId !== 0);

    const leadText = ringing ? "■ カチッを止める" : "🔊 カチッを鳴らす";

    if(syncLockLeadBtn.textContent !== leadText){ syncLockLeadBtn.textContent = leadText; }

}

/**
 * 曲が止まっているか(竹弘が止めた・何かで止まった)を返します。
 * 🎬頭出し接続の無音の間は「止まっている」に数えません(走り続けている)。
 *
 * @return {boolean}
 */
function isSyncLockMusicStopped(){

    if(!audioPlayer.paused){ return false; }

    return !((typeof isConnectSilence === "function") && isConnectSilence());

}


// ==========================================================
// 8. ボタンの中身
// ==========================================================

/**
 * 「ロック解除」:ロック画面を閉じて、ふつうのノリノリRun画面に戻します。
 * 同期モードは続きます(止めて再開しても、みんなの拍に合わせ直す)。
 */
function unlockSyncLock(){

    hideSyncLock("ロック解除");

}

/**
 * 「スライドで再開」:止めている曲を鳴らします。
 *
 * イヤホンの ▶ と同じ手順です(js/media-session.js):休ませた音の出口を
 * 起こしてから鳴らすだけ。鳴り始めたら、js/sync.js の 5-5 が
 * みんなの拍に合わせ直します(v241)。
 */
function resumeFromSyncLock(){

    // 【開発用調査ログ】(v248)
    console.log("同期モード ④ ロック画面のスライドで再開します");

    if(typeof resumeDeckAudio === "function"){ resumeDeckAudio(); }

    const playing = audioPlayer.play();

    if(playing && typeof playing.catch === "function"){

        playing.catch(function(error){

            console.error("同期モード ④ 再開できませんでした :",error.name,error.message);

        });

    }

    showSyncLockView("face");

}

/**
 * 「スライドで同期モードを終える」:走り終わった時に使います。
 *
 *     ・止めている間の「再開の約束」を取り消す(消しておいた音を戻し、
 *       寝ずの番の札も外す。js/sync.js の cancelSyncResume)
 *     ・同期モードを終える(syncState.running = false。もう合わせ直さない)
 *     ・リードのカチッが鳴っていたら止める
 *     ・走行タイマーを止めて、走った時間を見せる
 *
 * ⚠️ 曲は止めません(鳴っていれば鳴ったまま・止めていれば止めたまま)。
 *    走り終わった後のクールダウンでも聴けるようにするためです(のりの判断。
 *    違和感があれば竹弘に聞き直すこと)。
 */
function finishSyncRun(){

    if(typeof cancelSyncResume === "function"){ cancelSyncResume("同期モードを終えた"); }

    syncState.running = false;

    if(typeof stopSyncClockBeeps === "function"){ stopSyncClockBeeps(); }

    stopRunTimer("同期モードを終えた");

    syncLockFinishTimeEl.textContent = formatRunTimer(getRunTimerElapsedMs());

    syncLockFinishNoteEl.innerHTML = isSyncLockMusicStopped()
        ? "同期モードを終えました。<br>曲は止まったままです"
        : "同期モードを終えました。<br>曲はそのまま鳴っています<br>(止める時は ■)";

    // 【開発用調査ログ】(v248)
    console.log("同期モード ④ スライドで同期モードを終えました");

    showSyncLockView("finish");

}

/**
 * リードの「🔊 カチッを鳴らす / ■ カチッを止める」。
 *
 * 鳴らす前に「Bluetoothイヤホンを切りましたか?」を確かめます
 * (④の「もう一度カチッを鳴らす」と同じ。理由は js/sync.js の SYNC_BLUETOOTH_OFF_TEXT)。
 * ⚠️ js/sync.js の toggleSyncReplay() は使いません。あちらの確認のポップは
 *    同期モードの画面の中にあり、画面を閉じた今は見えないためです。
 *    鳴らす・止める本体(startSyncLeadClicks / stopSyncClockBeeps)は同じものを使います。
 */
function toggleSyncLockLeadClicks(){

    if(syncClockBeepTimerId !== 0){

        stopSyncClockBeeps();

        // 【開発用調査ログ】(v248)
        console.log("同期モード ④ ロック画面からカチッを止めました");

        refreshSyncLock();

        return;

    }

    syncLockConfirmMessageEl.innerHTML = SYNC_BLUETOOTH_OFF_TEXT;

    showSyncLockView("confirm");

}

/**
 * 「Bluetoothイヤホンを切りましたか?」の「鳴らす」。
 */
function confirmSyncLockLeadClicks(){

    const ok = startSyncLeadClicks();

    // 【開発用調査ログ】(v248)
    console.log("同期モード ④ ロック画面からカチッを鳴らします(最初と同じリズムの位置で)" +
                (ok ? "" : " → ⚠️ 音を出す準備ができませんでした"));

    showSyncLockView(ok ? "face" : "sheet");

}


// ==========================================================
// 9. スライドの部品
// ==========================================================

/**
 * スライドが「決まり」の位置まで動いたかを返します(計算だけの関数)。
 *
 * @param  {number} x    - つまみを動かした量(px)
 * @param  {number} maxX - つまみが動ける幅(px)
 * @return {boolean}
 */
function isSyncLockSlideDone(x,maxX){

    return maxX > 0 && x >= maxX * SYNC_LOCK_SLIDE_DONE_RATIO;

}

/**
 * スライドの溝(slideEl)の中のつまみを、指で右へ動かせるようにします。
 * 決まりの位置まで動かして指を離したら onDone を呼び、つまみは左へ戻ります。
 *
 * ------------------------------------------------------------
 * 【指の追いかけ方】
 *
 *   pointerdown … つまみを押した。setPointerCapture で「この指の知らせは、
 *                 指がつまみの外へ出ても、つまみに届け続けて」と頼む
 *   pointermove … 押した所からの横の移動量だけ、つまみを動かす
 *   pointerup   … 離した。決まりの位置を越えていたら onDone
 *
 * 溝には CSS で touch-action:none を付けてあります。付けないと、横に
 * 動かした指がブラウザの「画面を戻る」などの操作に取られてしまうためです。
 *
 * @param {HTMLElement} slideEl - スライドの溝(.sync-lock-slide)
 * @param {Function}    onDone  - 決まった時に呼ぶ係
 */
function setupSyncLockSlide(slideEl,onDone){

    if(!slideEl){ return; }

    const thumb = slideEl.querySelector(".sync-lock-slide-thumb");

    if(!thumb){ return; }

    let dragging = false;
    let pointerId = null;
    let startX = 0;
    let maxX = 0;
    let x = 0;

    const moveTo = function(px,animate){

        thumb.style.transition = animate ? "transform 0.2s ease" : "none";
        thumb.style.transform = "translateX(" + px + "px)";

    };

    thumb.addEventListener("pointerdown",function(event){

        dragging = true;
        pointerId = event.pointerId;

        // 溝の幅 − つまみの幅 − 左右の余白(つまみの左の余白と同じだけ右にも空ける)
        maxX = slideEl.clientWidth - thumb.offsetWidth - thumb.offsetLeft * 2;

        startX = event.clientX;
        x = 0;

        try{ thumb.setPointerCapture(pointerId); }catch(error){ /* 試験の作り物の指では失敗することがある */ }

        // 触っている間は、確認を自動で閉じない
        armSyncLockSheetTimer();

        moveTo(0,false);

        event.preventDefault();

    });

    thumb.addEventListener("pointermove",function(event){

        if(!dragging || event.pointerId !== pointerId){ return; }

        x = Math.min(Math.max(event.clientX - startX,0),Math.max(maxX,0));

        moveTo(x,false);

    });

    const finish = function(event,cancelled){

        if(!dragging || event.pointerId !== pointerId){ return; }

        dragging = false;

        const done = !cancelled && isSyncLockSlideDone(x,maxX);

        x = 0;

        moveTo(0,true);

        if(done){ onDone(); }

    };

    thumb.addEventListener("pointerup",function(event){ finish(event,false); });
    thumb.addEventListener("pointercancel",function(event){ finish(event,true); });

}


// ==========================================================
// 10. ボタンの結び付け
// ==========================================================

if(syncLockEl){

    /*
    薄暗い画面のどこを触っても、確認を出します。
    確認の外(幕のところ)を触った時は「解除しない」と同じに、薄暗い画面へ戻します。

    ⚠️ 確認・カチッの確認・終わりの面の**中**で起きたタッチは、ここでは何もしません
       (それぞれのボタンが受け持つ)。ボタンの click は、ボタンの処理が終わった後に
       この幕にも届きます(「泡が上がるように」親へ伝わる。イベントのバブリング)。
       たとえば「解除しない」で薄暗い画面に戻した直後に、ここが「薄暗い画面を
       触った」と読んで、確認をまた開いてしまうのを防ぐためです。
       スライドを最後まで動かして指を離した時の click も同じです。
    */
    syncLockEl.addEventListener("click",function(event){

        if(syncLockSheetEl.contains(event.target) ||
           syncLockConfirmEl.contains(event.target) ||
           syncLockFinishEl.contains(event.target)){ return; }

        if(syncLock.view === "face"){

            showSyncLockView("sheet");

            return;

        }

        if(syncLock.view === "sheet"){ showSyncLockView("face"); }

    });

    // 確認の中を触っている間は、自動で閉じるのを延ばします
    syncLockSheetEl.addEventListener("pointerdown",function(){ armSyncLockSheetTimer(); });

    syncLockUnlockBtn.addEventListener("click",unlockSyncLock);

    syncLockKeepBtn.addEventListener("click",function(){ showSyncLockView("face"); });

    syncLockLeadBtn.addEventListener("click",toggleSyncLockLeadClicks);

    syncLockConfirmOkBtn.addEventListener("click",confirmSyncLockLeadClicks);

    syncLockConfirmCancelBtn.addEventListener("click",function(){ showSyncLockView("sheet"); });

    syncLockFinishBtn.addEventListener("click",function(){ hideSyncLock("同期モードを終えて閉じた"); });

    setupSyncLockSlide(syncLockResumeEl,resumeFromSyncLock);
    setupSyncLockSlide(syncLockEndEl,finishSyncRun);

    /*
    曲が止まった・鳴り始めた時は、すぐに表示を直します
    (0.25秒ごとの書き換えを待たずに「止めています」を出すため)。
    */
    if(typeof bindDeckEvent === "function"){

        bindDeckEvent("pause",refreshSyncLock);
        bindDeckEvent("play",refreshSyncLock);

    }

}
