/*
================================================================
 back-guard.js … 戻るの番人(下の帯の「<」= Android の戻るを、アプリの中の戻るにする)(v289)

----------------------------------------------------------------------

【何が困っていたか】竹弘の報告(2026-11-23):

    「下帯の『<』を誤ってアプリを終了してしまう誤操作が多発してます。
      例えば、『ノリ注入』ボタンを押して『やめる』ボタンを押さず
      つい下帯の『<』を押してアプリを終了してしまうのです。
      他にも例えば『設定』ボタンを押して『ノリノリアシスト』に入り、
      右上の『×』ボタンを押さずつい、下帯の『<』を押してアプリを終了してしまうのです」

 インストール版の Chrome では、「<」を押すとページの履歴を1つ戻ります。戻る先が無いと、アプリが閉じます。
 ノリRun はページを移らない作り(c014.html 1枚)なので、いつも「戻る先が無い」= 「<」1回で終了でした。
 走っている最中(同期モードのロック画面)に押すと、曲まで止まってしまいます。

【どう直したか】ページの履歴に「戻る先」を1つだけ置いておき(history.pushState)、「<」が押されたら
 その知らせ(popstate)を受け止めて、次のどちらかをします(竹弘と決めた 2026-11-23):

    設定の小窓が開いている → いちばん上の1つだけ閉じる(✕ を押したのと同じ)
        ⚙️ のメニュー / 🎚️ 曲の繋ぎ方 / 👣 拍倍率 / 🏃 ノリノリアシスト / 📜 ライセンス /
        みんなで走る同期モードの画面(と、その中の確認のポップ・拍合わせ画面)
    それ以外 → 「ノリRunアプリを終了しますか?」のメニューを出す
        メインメニュー・🕺ノリノリRun・ノリ注入・マイピッチ設定・同期モードのロック画面 など
        (竹弘「何もしないより、メニューを出す方が丁寧」「ノリ注入も、ほかと同じく
          『ノリRunアプリを終了しますか?』」)

 閉じた後は、すぐ「戻る先」を置き直します(次の「<」もまた受け止める)。
 メニューを出している間は置き直しません。**その間にもう一度「<」を押すと、アプリが終了します**
 (メニューに「終了する時は、もう一度『<』を押してください」と書いてある)。
 「続ける」を押した時に、置き直します。

【「終了する」ボタンを置かない理由】
 ページの中のボタンから、インストール版のアプリを閉じる方法がありません
 (window.close() は、プログラムが開いた窓しか閉じられない決まり)。だから終了は「<」にまかせます。

⚠️⚠️ 【Chrome の決まり(戻れなくする悪いページを防ぐため)】
 画面を一度も触らないうちに置いた「戻る先」は、「<」で飛ばされることがあります(Chrome の
 「履歴の操作への介入」)。間に1回でも画面を触れば、また受け止められます。だから、
 「<」で小窓を閉じた後、画面を触らずにすぐもう一度「<」を押すと、アプリが閉じることがあります。
 (竹弘に説明済み 2026-11-23)

⚠️ 「戻る先」は、いつも1つだけです(重ねない)。小窓を ✕ で閉じた時も、履歴は触りません。
   isBackGuardArmed() で「いま戻る先の上にいるか」を確かめてから置きます。
⚠️ ページの履歴(history)は、ノリRun のほかの所では使っていません(2026-11-23 に Grep で確かめた)。
   将来、画面の行き来に履歴を使う時は、ここと食い違わないように考えること。

 経緯と竹弘の言葉 → CLAUDE.md「いまの到達点」(v289)
================================================================
*/


// ==========================================================
// 1. 決まった値・今の状態
// ==========================================================

/*
「戻る先」の印。history.pushState に渡す小さな入れ物に、この名前で true を入れておきます。
「<」で戻った後の history.state は、ページを開いた時の入れ物(null)になるので、
印があるか無いかで「いま戻る先の上にいるか」が分かります。
*/
const BACK_GUARD_STATE_KEY = "noriRunBackGuard";

/*
今の状態。
    confirmShown … 「ノリRunアプリを終了しますか?」を出しているか
*/
const backGuard = {
    confirmShown: false
};


// ==========================================================
// 2. 「戻る先」を置く
// ==========================================================

/**
 * いま「戻る先」の上にいるか(= 次の「<」を受け止められるか)を返します。
 */
function isBackGuardArmed(){

    return !!(window.history && history.state && history.state[BACK_GUARD_STATE_KEY]);

}

/**
 * 「戻る先」を1つ置きます(もう置いてあれば何もしない)。
 *
 * history.pushState(入れ物, 題名) は「ページを移らずに、履歴に1つ足す」命令です。
 * 画面もアドレスも変わりません。「<」を押すと、この1つ分だけ戻り、popstate という知らせが来ます。
 * (2つ目の題名は、今のブラウザでは使われていないので空にしています)
 *
 * @param {string} why - 置いた理由(ログ用)
 */
function armBackGuard(why){

    if(!window.history || typeof history.pushState !== "function"){ return; }

    if(isBackGuardArmed()){ return; }

    try{

        const state = {};

        state[BACK_GUARD_STATE_KEY] = true;

        history.pushState(state,"");

        console.log("戻るの番人 : 「<」を受け止める用意をしました(" + why + ")");

    }
    catch(error){

        // 置けなくても、今までどおり「<」でアプリが閉じるだけ(ほかの動きは壊さない)
        console.warn("戻るの番人 : 用意できませんでした :",error.name,error.message);

    }

}


// ==========================================================
// 3. 「<」が押された時
// ==========================================================

/**
 * 「<」が押されて、履歴を1つ戻った時に呼ばれます(popstate)。
 */
function handleBackGuardPop(){

    // 戻った先がまた「戻る先」なら(「進む」で来た時など)、何もしません
    if(isBackGuardArmed()){ return; }

    const closedName = closeTopSmallWindowByBack();

    if(closedName){

        console.log("戻るの番人 : 「<」を受け止めました → " + closedName + " を閉じました");

        armBackGuard("小窓を閉じた後");

        return;

    }

    showBackGuardConfirm();

}

/**
 * 設定の小窓が開いていれば、いちばん上の1つだけを閉じて、その名前を返します。開いていなければ空の文字。
 *
 * 【順番】重なっている時は、手前(上)にある方から確かめます。
 *     同期モードの確認のポップ → 拍合わせ画面 → 同期モードの画面 → ⚙️ のメニュー → 4つの設定の画面
 *
 * 閉じ方は、どれも ✕(や「まだ」「終わる」)のボタンが呼んでいるのと同じ関数です(js/settings.js・js/sync.js)。
 * ほかのファイルの関数は、typeof で「ある」と確かめてから呼びます(無くても、ここでエラーにしない)。
 */
function closeTopSmallWindowByBack(){

    // 同期モードの確認のポップ(「まだ」と同じ。js/sync.js の closeSyncDialog)
    if(isBackGuardShown("sync-dialog") && typeof closeSyncDialog === "function"){

        closeSyncDialog();

        return "同期モードの確認";

    }

    // 同期モードの拍合わせ画面(「終わる」と同じ。js/sync.js の closeSyncBeatScreen)
    if(typeof isSyncBeatScreenOpen === "function" && isSyncBeatScreenOpen() &&
       typeof closeSyncBeatScreen === "function"){

        closeSyncBeatScreen();

        return "同期モードの拍合わせ画面";

    }

    // みんなで走る同期モードの画面(✕ と同じ。js/sync.js の closeSyncPanel)
    if(isBackGuardShown("sync-panel") && typeof closeSyncPanel === "function"){

        closeSyncPanel();

        return "みんなで走る同期モード";

    }

    // ⚙️ のメニュー(js/settings.js)
    if(typeof isSettingsMenuOpen === "function" && isSettingsMenuOpen() &&
       typeof closeSettingsMenu === "function"){

        closeSettingsMenu();

        return "⚙️ 設定のメニュー";

    }

    /*
    ⚙️ から開く4つの画面(✕ と同じ。js/settings.js)。
    関数の名前を文字で持っているのは、settings.js より先に読まれても困らないようにするためです
    (window[名前] で、呼ぶ時に探します)。
    */
    const panels = [
        ["connect-panel",         "closeConnectPanel",        "🎚️ 曲の繋ぎ方"],
        ["beat-multiplier-panel", "closeBeatMultiplierPanel", "👣 拍倍率"],
        ["metronome-panel",       "closeMetronomePanel",      "🏃 ノリノリアシスト"],
        ["license-panel",         "closeLicensePanel",        "📜 ライセンス"]
    ];

    for(const panel of panels){

        if(isBackGuardShown(panel[0]) && typeof window[panel[1]] === "function"){

            window[panel[1]]();

            return panel[2];

        }

    }

    return "";

}

/**
 * その要素が、いま画面に出ているかを返します。
 *
 * getClientRects() は「画面の上で、その要素が占めている四角の一覧」を返す命令です。
 * 自分か親のどれかが display:none なら、四角は0個になります(親が隠れている時も「出ていない」と分かる)。
 */
function isBackGuardShown(id){

    const el = document.getElementById(id);

    return !!el && el.getClientRects().length > 0;

}


// ==========================================================
// 4. 「ノリRunアプリを終了しますか?」
// ==========================================================

/**
 * 終了の確かめのメニューを出します。
 *
 * 色は、いまの画面の色(#app の --theme-color。メインメニューは海の青、🕺 は暁色)を借ります
 * (色の数字を書き写さない。js/norirun.js の refreshThemeColorMeta と同じ借り方)。
 */
function showBackGuardConfirm(){

    const el = document.getElementById("back-guard-confirm");

    if(!el){ return; }

    const appEl = document.getElementById("app");

    const color = appEl ? getComputedStyle(appEl).getPropertyValue("--theme-color").trim() : "";

    if(color){ el.style.setProperty("--back-guard-color",color); }

    el.style.display = "flex";

    backGuard.confirmShown = true;

    console.log("戻るの番人 : 「<」を受け止めました → 「ノリRunアプリを終了しますか?」を出しました(もう一度「<」で終了)");

}

/**
 * 「続ける」(またはメニューの外)が押された時。メニューを閉じて、また「<」を受け止める用意をします。
 *
 * ⚠️ 用意(armBackGuard)はここ、竹弘が画面を触った時にします。触った時に置いた「戻る先」は、
 *    Chrome に飛ばされません(冒頭の【Chrome の決まり】)。
 */
function continueFromBackGuardConfirm(){

    const el = document.getElementById("back-guard-confirm");

    if(el){ el.style.display = "none"; }

    backGuard.confirmShown = false;

    console.log("戻るの番人 : 「続ける」が押されました");

    armBackGuard("続ける");

}


// ==========================================================
// 5. つなぐ
// ==========================================================

(function bindBackGuard(){

    window.addEventListener("popstate",handleBackGuardPop);

    const el = document.getElementById("back-guard-confirm");

    if(el){

        /*
        「続ける」のボタンでも、メニューの外(暗い幕)を触っても、続けます。
        カードの中の文字を触った時は何もしません(event.target が幕そのものの時だけ)。
        */
        el.addEventListener("click",function(event){

            if(event.target === el){ continueFromBackGuardConfirm(); }

        });

    }

    const continueBtn = document.getElementById("back-guard-continue");

    if(continueBtn){ continueBtn.addEventListener("click",continueFromBackGuardConfirm); }

    /*
    ページを開いた時に、最初の「戻る先」を置きます。
    この時はまだ画面を触っていないので、Chrome は、竹弘が一度画面を触るまで、この「戻る先」を
    飛ばすことがあります(開いてすぐ、何も触らずに「<」を押すと、今までどおり閉じる)。
    */
    armBackGuard("ページを開いた時");

})();
