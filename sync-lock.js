/* ============================================================
   みんなで走る同期モード:薄暗いロック画面(段④。v248 / v249 でメニューを作り直し)

   同期スタートした瞬間に、🕺ノリノリRun画面の上へ薄暗い幕をかぶせ、
   **音量以外の操作をロック**します(音量はスマホ本体のボタンで変えられる。
   アプリ側では何もしなくても効く)。走っている間に、ポケットの中や
   汗の付いた指で、うっかり曲を変えたり止めたりしないためです。

   📘 仕様は CLAUDE.md の「追加1」(2026-09-22 に竹弘と詰めた仕様と、
      「段④に足すこと」)と、2026-10-24 の竹弘の作り直しの案が正。

       ・同期スタートしたら、薄暗いロック画面を出す(finishSyncStart から呼ばれる)
       ・幕の真ん中に、走行タイマー(1拍目からの経過時間。js/run-timer.js)
       ・画面に触れると、メニューが下から「ニョキッ」と上がってくる(v249)
           (1) スライドで 一時停止 ⇔ 再開(いまの状態で文字と記号が入れ替わる)
           (2) ノリノリアシストの4つのボタン:🔇 OFF / 🥁 カチッ / 📻 ピッ / 🎉 セット1
               (⚙️ の設定と同じもの。いまの設定のボタンが光る。セット1 はまだ押せない)
           (3) スライドで同期モードを終える(誤操作防止。竹弘の要望 2026-10-04)
       ・メニューは、外(幕)を触るか、10秒触らなければ閉じる
       ・ロックしている間は、イヤホンの ⏭⏮ を使わない(js/media-session.js が
         isSyncLockShown() を見る)。⏸ ▶ は今までどおり効く。イヤホンの1タップと
         (1)のスライドは、まったく同じ止め方・再開の仕方(相談2。竹弘 2026-10-24)

   【v249 で外したもの(竹弘の判断 2026-10-24)】

       ・「ロック解除」「解除しない」… 10秒たつか外を触れば戻る。アシストのボタンは
         押し間違えてもすぐ直せて、同期にも走る人にも影響しないので、ロックを
         外す必要が無い。**同期モードは「終える」スライドで終わり**(途中で合わせ
         直したい時も、終えてから同期モードの画面で設定し直す。③の基準は前回の
         ものを使える = js/sync.js の「画面を閉じても基準は残す」)
       ・リードの「🔊 カチッを鳴らす」… ③の叩き直し用に、2拍に1回・スピーカーから
         出す前提の音。イヤホンがつながっているとアシストとずれて2重に聞こえた
         (竹弘の実機 2026-10-24)。途中で合わせ直すことはしないので要らなくなった

   ⚠️ 「時刻ボタンから再開」(2026-09-22 の仕様)は作っていません。v241 から、
      どこから再開しても自動でみんなの拍に合わせ直すようになったためです
      (CLAUDE.md の「追加1」の 2026-10-18 の決め直し)。

   ------------------------------------------------------------
   【見た目】

   ジャケ写の特大表示(#jacket-panel)と同じく、**薄く透けて下の画面が見える**
   幕です(竹弘のイメージ:2026-10-18「ジャケ写の特大表示のような透ける画面」)。
   #app の外に置き、暁色は「#app.norirun-mode ~ #sync-lock」で受け取ります
   (ジャケの特大表示と同じ受け渡し。c014.html の CSS のコメント)。

   メニューの出方は、検索モード(🐇ウサギボタンの左)で曲一覧が上がってくるのと
   同じ 0.28秒・ease(竹弘の指定 2026-10-24「ニョキッと滑らかに」)。
   CSS の .sync-lock-sheet-open を付け外しするだけで、動きは CSS が受け持ちます。

   ⚠️ 重なり順(z-index)は 2500 です。ほかのパネル(2000)より手前、
      横向きのお知らせ(9000)と開発用デバッグログ(20000)より奥にしてあります。
      🐛 が押せなくなると、実機テストでログが取れなくなるためです。

   📘 経緯 → devlog/同期モード.md(段④。完成したら移す)
   ============================================================ */


// ==========================================================
// 1. 決まった数値
// ==========================================================

/*
メニューを出したまま触らなければ、薄暗い画面へ戻すまでの時間(ミリ秒)。
ポケットの中でメニューが開いたままになり、そこへさらに何かが触れて
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

/*
(1)のスライドの文字と、つまみの記号(v249)。いまの状態で入れ替えます。

⚠️ 一時停止の記号は ⏸ ではなく「❚❚」(太い縦棒2本)にしています。
   ⏸ は Android では色の付いた絵文字の四角で描かれ、暁色の丸いつまみの上で
   浮いてしまうためです。▶ は、ほかのボタン(■ / ▶)と同じ文字の記号です。
*/
const SYNC_LOCK_PAUSE_TEXT  = "スライドで一時停止";
const SYNC_LOCK_PAUSE_THUMB = "❚❚";
const SYNC_LOCK_RESUME_TEXT  = "スライドで再開";
const SYNC_LOCK_RESUME_THUMB = "▶";


// ==========================================================
// 2. 画面部品
// ==========================================================

const syncLockEl         = document.getElementById("sync-lock");
const syncLockFaceEl     = document.getElementById("sync-lock-face");
const syncLockTimerEl    = document.getElementById("sync-lock-timer");
const syncLockStateEl    = document.getElementById("sync-lock-state");

const syncLockSheetEl      = document.getElementById("sync-lock-sheet");
const syncLockPauseEl      = document.getElementById("sync-lock-pause");
const syncLockPauseTextEl  = document.getElementById("sync-lock-pause-text");
const syncLockPauseThumbEl = document.getElementById("sync-lock-pause-thumb");
const syncLockEndEl        = document.getElementById("sync-lock-end");

/*
ノリノリアシストの4つのボタン(v249)。data-sync-lock-assist に
"off" / "click" / "beep" / "set1" が入っています(c014.html)。
querySelectorAll は、当てはまる部品を全部集めて返す命令です。
*/
const syncLockAssistBtns = syncLockSheetEl
    ? Array.from(syncLockSheetEl.querySelectorAll("[data-sync-lock-assist]"))
    : [];

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
        "sheet"   … 触った時のメニュー(スライド・アシストのボタン)
        "finish"  … 同期モードを終えた後の「おつかれさまでした」

    (v248 にあった "confirm"〔リードのカチッの前の確認〕は、v249 でボタンごと外しました)
    */
    view: "face",

    // メニューを自動で閉じる予約(setTimeout の番号)。0 = 予約なし
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
 *    (v249 からは「ロック解除」が無いので、ロック画面のままもう一度スタートする
 *     ことはありません。「終える」で終えた後のスタートは 0 から)
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
 * ロック画面を隠します。v249 からは、同期モードを終えた後の「閉じる」だけが呼びます。
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
// 6. 面の切り替え(薄暗い画面・メニュー・終わり)
// ==========================================================

/**
 * ロック画面の中で、どの面を見せるかを切り替えます。
 *
 * 【v249 メニューは display で消さない】
 *
 * メニュー(#sync-lock-sheet)は、いつも置いたままにして、CSS の
 * .sync-lock-sheet-open を付け外しします。外すと画面の下へずれて隠れ、
 * 付けると 0.28秒で上がってきます(c014.html の CSS)。
 * display:none ⇔ flex で出し入れすると、動きの途中が無いので「パッ」と出てしまい、
 * 竹弘の「ニョキッ」になりません。
 *
 * @param {string} view - "face" / "sheet" / "finish"(syncLock.view のコメント)
 */
function showSyncLockView(view){

    syncLock.view = view;

    /*
    薄暗い画面(タイマー)は、終わりの面の時だけ隠します。
    メニューを出している間も後ろにタイマーが見えている方が、
    「いまロック画面の中にいる」と分かりやすいためです。
    */
    syncLockFaceEl.style.display   = (view === "finish") ? "none" : "flex";
    syncLockFinishEl.style.display = (view === "finish") ? "flex" : "none";

    const sheetOpen = (view === "sheet");

    syncLockSheetEl.classList.toggle("sync-lock-sheet-open",sheetOpen);

    // 読み上げ機能に、隠れているメニューを読ませないための印です
    syncLockSheetEl.setAttribute("aria-hidden",sheetOpen ? "false" : "true");

    syncLockEl.classList.toggle("sync-lock-dim-more",view !== "face");

    clearSyncLockSheetTimer();

    // メニューは、触らなければ薄暗い画面へ戻します
    if(sheetOpen){ armSyncLockSheetTimer(); }

    refreshSyncLock();

}

/**
 * メニューを自動で閉じる予約を入れ直します(触るたびに延ばす)。
 */
function armSyncLockSheetTimer(){

    clearSyncLockSheetTimer();

    syncLock.sheetTimerId = setTimeout(function(){

        syncLock.sheetTimerId = 0;

        if(syncLock.shown && syncLock.view === "sheet"){

            showSyncLockView("face");

        }

    },SYNC_LOCK_SHEET_AUTO_CLOSE_MS);

}

/**
 * メニューを自動で閉じる予約を取り消します。
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
 * タイマー・いまの状態・スライドの文字・アシストのボタンを書き換えます
 * (0.25秒ごと + 曲の知らせの時)。
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

    // ---- (1)のスライド:止めていれば「再開」、鳴っていれば「一時停止」(v249)----
    const slideText  = paused ? SYNC_LOCK_RESUME_TEXT  : SYNC_LOCK_PAUSE_TEXT;
    const slideThumb = paused ? SYNC_LOCK_RESUME_THUMB : SYNC_LOCK_PAUSE_THUMB;

    if(syncLockPauseTextEl.textContent !== slideText){ syncLockPauseTextEl.textContent = slideText; }
    if(syncLockPauseThumbEl.textContent !== slideThumb){ syncLockPauseThumbEl.textContent = slideThumb; }

    // ---- (2)ノリノリアシストのボタン(v249)----
    refreshSyncLockAssist();

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

/**
 * ノリノリアシストの4つのボタンのうち、いまの設定のボタンを光らせます(v249)。
 *
 *     🔇 OFF    … 鳴らさない(metronomeEnabled が false)
 *     🥁 カチッ … 鳴らす + 音色カチッ
 *     📻 ピッ   … 鳴らす + 音色ピッ
 *     🎉 セット1 … まだ押せない(⑮ モリアゲアシストを作る時に、セットした音色を鳴らす)
 *
 * 設定そのものは js/metronome.js が持っています(⚙️ の「🏃 ノリノリアシスト」と同じ値)。
 * ⚙️ で変えても、0.25秒ごとの書き換えでここにも映ります。
 *
 * ⚠️ typeof で確かめるのは、js/metronome.js は「ファイルを消すだけでアシストを
 *    丸ごと外せる」作りだからです(js/sync.js の kickSyncMetronome と同じ)。
 *    無い時は、どのボタンも光らせません。
 */
function refreshSyncLockAssist(){

    const ready = (typeof metronomeEnabled !== "undefined") && (typeof metronomeSound !== "undefined");

    syncLockAssistBtns.forEach(function(button){

        const kind = button.dataset.syncLockAssist;

        let on = false;

        if(ready){

            if(kind === "off"){ on = !metronomeEnabled; }
            else if(kind === "click"){ on = metronomeEnabled && metronomeSound === METRONOME_SOUND_CLICK; }
            else if(kind === "beep"){ on = metronomeEnabled && metronomeSound === METRONOME_SOUND_BEEP; }

        }

        if(button.classList.contains("sync-lock-assist-on") !== on){

            button.classList.toggle("sync-lock-assist-on",on);

            // aria-pressed は「押されている(選ばれている)ボタンか」を読み上げ機能に伝える印です
            button.setAttribute("aria-pressed",on ? "true" : "false");

        }

    });

}


// ==========================================================
// 8. ボタンの中身
// ==========================================================

/**
 * (1)のスライド:いまの状態で「一時停止」か「再開」かを決めます(v249)。
 *
 * 決めるのは指を離した瞬間の状態です。動かしている途中にイヤホンで止められて
 * 文字が「再開」に変わっていれば、再開になります(文字どおりの動き)。
 */
function toggleSyncLockPause(){

    if(isSyncLockMusicStopped()){

        resumeFromSyncLock();

    }else{

        pauseFromSyncLock();

    }

}

/**
 * 「スライドで一時停止」:鳴っている曲を止めます(v249)。
 *
 * ⚠️⚠️ イヤホンの ⏸(js/media-session.js)と画面の ■(js/upper-area.js)と
 *    **まったく同じ手順・同じ順番**です(相談2。竹弘「イヤホンの1タップと同期操作」)。
 *
 *     1. intentionalPause = true … 「竹弘が自分で止めた」の印(■ ▶ の記号の切り替え。v135)
 *     2. prepareUserPause()    … 裏で鳴っている曲(助走・クロスフェード)を先に止める(v236)
 *     3. audioPlayer.pause()    … 主役を最後に止める
 *     4. sleepDeckAudioSoon()   … 少し後に音の出口を休ませる(v238。必ず止めた後)
 *
 *    2 と 3 を入れ替えると、イヤホンの ▶ で再開できなくなります(Chrome の決まり。
 *    CLAUDE.md の「Chrome・Android の決まり」の 4)。
 *
 * 止まると js/sync.js の 5-5 が「再開したら合わせ直す」約束を作り、寝ずの番
 * (レイヤー5)に札を掛けます。だから止めた後はイヤホン1回でも、(1)のスライドでも
 * 再開でき、どちらでもみんなの拍に合わせ直します。
 *
 * ⚠️ 🎬頭出し接続の無音の間(曲の切れ目の数秒)に止めると、繋ぐ準備ごと取りやめに
 *    なり、再開の約束が作られません(イヤホンの ⏸ でも同じ。v248 までと同じ穴。
 *    CLAUDE.md の「ひとりの時の🎬の無音の間の ⏸」の仲間)。
 */
function pauseFromSyncLock(){

    // 【開発用調査ログ】(v249)
    console.log("同期モード ④ ロック画面のスライドで一時停止します");

    intentionalPause = true;

    if(typeof prepareUserPause === "function"){ prepareUserPause(); }

    audioPlayer.pause();

    if(typeof sleepDeckAudioSoon === "function"){ sleepDeckAudioSoon(); }

    showSyncLockView("face");

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
 * (2)ノリノリアシストのボタンが押された時(v249)。
 *
 * ⚙️ の「🏃 ノリノリアシスト」と同じ設定を、同じ関数で変えます(js/metronome.js の
 * setMetronomeEnabled / setMetronomeSound。保存もされるので、次に走る時もこの音)。
 * 押した瞬間に効きます(走りながら変えても、次の曲まで待たない)。
 *
 * ⚠️ 同じ音色を選び直した時は setMetronomeSound を呼びません。呼ぶと予約済みの
 *    カチッを取り消すので(切り替えた瞬間に新しい音色で鳴らすため)、選び直す
 *    だけで1〜2拍ぶん抜けてしまいます。ON/OFF も、変わる時だけ呼びます。
 *
 * ⚠️ 音色を先に、ON を後に変えます。先に ON にすると、見張りが古い音色で
 *    1拍目を予約してしまうことがあるためです。
 *
 * @param {string} kind - "off" / "click" / "beep"("set1" はまだ押せない)
 */
function setSyncLockAssist(kind){

    if(typeof setMetronomeEnabled !== "function" || typeof setMetronomeSound !== "function"){ return; }

    if(kind === "off"){

        if(metronomeEnabled){ setMetronomeEnabled(false); }

    }
    else if(kind === "click" || kind === "beep"){

        const sound = (kind === "beep") ? METRONOME_SOUND_BEEP : METRONOME_SOUND_CLICK;

        if(metronomeSound !== sound){ setMetronomeSound(sound); }

        if(!metronomeEnabled){ setMetronomeEnabled(true); }

    }

    refreshSyncLockAssist();

}

/**
 * 「スライドで同期モードを終える」:走り終わった時に使います。
 *
 *     ・止めている間の「再開の約束」を取り消す(消しておいた音を戻し、
 *       寝ずの番の札も外す。js/sync.js の cancelSyncResume)
 *     ・同期モードを終える(syncState.running = false。もう合わせ直さない)
 *     ・③のカチッが万一鳴っていたら止める(ふつうは時刻ボタンで止まっている)
 *     ・走行タイマーを止めて、走った時間を見せる
 *
 * ⚠️ 曲は止めません(鳴っていれば鳴ったまま・止めていれば止めたまま)。
 *    走り終わった後のクールダウンでも聴けるようにするためです
 *    (竹弘が OK 2026-10-24)。
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

        // 触っている間は、メニューを自動で閉じない
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
    薄暗い画面のどこを触っても、メニューを出します。
    メニューの外(幕のところ)を触った時は、薄暗い画面へ戻します。

    ⚠️ メニュー・終わりの面の**中**で起きたタッチは、ここでは何もしません
       (それぞれのボタンが受け持つ)。ボタンの click は、ボタンの処理が終わった後に
       この幕にも届きます(「泡が上がるように」親へ伝わる。イベントのバブリング)。
       たとえばスライドで一時停止して薄暗い画面に戻した直後に、ここが「薄暗い画面を
       触った」と読んで、メニューをまた開いてしまうのを防ぐためです。
       スライドを最後まで動かして指を離した時の click も同じです。
    */
    syncLockEl.addEventListener("click",function(event){

        if(syncLockSheetEl.contains(event.target) ||
           syncLockFinishEl.contains(event.target)){ return; }

        if(syncLock.view === "face"){

            showSyncLockView("sheet");

            return;

        }

        if(syncLock.view === "sheet"){ showSyncLockView("face"); }

    });

    // メニューの中を触っている間は、自動で閉じるのを延ばします
    syncLockSheetEl.addEventListener("pointerdown",function(){ armSyncLockSheetTimer(); });

    // ノリノリアシストのボタン(セット1 は disabled なので押せない)
    syncLockAssistBtns.forEach(function(button){

        button.addEventListener("click",function(){

            if(button.disabled){ return; }

            setSyncLockAssist(button.dataset.syncLockAssist);

        });

    });

    syncLockFinishBtn.addEventListener("click",function(){ hideSyncLock("同期モードを終えて閉じた"); });

    setupSyncLockSlide(syncLockPauseEl,toggleSyncLockPause);
    setupSyncLockSlide(syncLockEndEl,finishSyncRun);

    /*
    曲が止まった・鳴り始めた時は、すぐに表示を直します
    (0.25秒ごとの書き換えを待たずに「止めています」と、スライドの「再開」を出すため。
     イヤホンで止めた・再開した時も、ここでスライドの文字が入れ替わります)。
    */
    if(typeof bindDeckEvent === "function"){

        bindDeckEvent("pause",refreshSyncLock);
        bindDeckEvent("play",refreshSyncLock);

    }

}
