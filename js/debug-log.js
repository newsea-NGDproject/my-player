/*
======================================================================
 【開発用・調査専用】debug-log.js ── 画面ロック中に音楽が止まる
 不具合を調査するための一時的なログ機能

----------------------------------------------------------------------

【このファイルの役割】

 竹弘の報告(2026-08-22): スマホの電源ボタンを1回押して画面ロック
 (時計やカレンダーが出る節電状態)にすると、曲が2曲ほど鳴った後に
 完全に止まる。これまでに試した対策(Media Session API・alertの撤去・
 バッテリー制限の変更)はどれも効果が無かった。

 USBデバッグでPCから直接ログを見ようとしたが、接続がうまく確立
 できなかった。そこで console.log の代わりに、**スマホの中に残る
 保存領域(localStorage)へ出来事を書き残す**方式に変更した。

 console.logは画面を閉じたりページが固まったりすると消えてしまうが、
 localStorageはブラウザを閉じても消えない。画面ロックが解除された
 後にこのファイルが用意するパネルを開けば、「止まる直前に何が
 起きていたか」をPC無しで読める。

----------------------------------------------------------------------

【何を記録しているか】

 竹弘が何も操作していないのに音楽が止まるので、アプリ自身のコード
 より「ブラウザ/OSが裏で何をしたか」を疑っている。そこで、

   ・visibilitychange … 画面が見えなくなった/見えるようになった瞬間
   ・pagehide / pageshow … ページが裏に回った/戻ってきた瞬間
   ・freeze / resume … Chromeが明示的にページを凍結/復帰させた瞬間
     (Chrome 68+ の専用イベント。これが記録されていれば「ブラウザが
      意図的に止めた」ことの動かぬ証拠になる)
   ・audio要素の play/pause/ended/stalled/waiting/suspend/abort/error
   ・js/player.js・js/queue.js の要所(権限確認・play()呼び出しの前後)

 を記録する。あわせて js/player.js と js/queue.js にも、この
 logDebugEvent() を呼ぶ行を数か所だけ足してある。

----------------------------------------------------------------------

【★本番リリース前に必ず削除すること★】

 これは調査専用の一時的な機能です。原因が判明したら、次のすべてを
 削除してください(CLAUDE.mdの「本番リリース前に削除するもの」に
 登録済み)。

   ・このファイル(js/debug-log.js)
   ・c014.html内の対応するscriptタグ
   ・c014.html内の「【開発用デバッグログパネル】」のHTML/CSSブロック
   ・sw.jsのASSETSへの登録
   ・js/player.js・js/queue.jsに足した logDebugEvent(...) の行
======================================================================
*/


// ==========================================================
// 1. ログを書き残す
// ==========================================================

const DEBUG_LOG_KEY = "norirun_debug_log";

// 増えすぎてlocalStorageを圧迫しないよう、直近300行だけ残します
const DEBUG_LOG_MAX = 300;

/**
 * 出来事を1行、localStorageへ追記します。
 *
 * js/player.js・js/queue.js からも呼ばれます。
 *
 * @param {string} message - 記録したい内容
 */
function logDebugEvent(message){

    try{

        const stored = localStorage.getItem(DEBUG_LOG_KEY);
        const lines = stored ? JSON.parse(stored) : [];

        lines.push(formatDebugTimestamp() + " | " + message);

        // 古い行から間引きます(shiftは配列の先頭を1つ取り除く命令です)
        while(lines.length > DEBUG_LOG_MAX){
            lines.shift();
        }

        localStorage.setItem(DEBUG_LOG_KEY,JSON.stringify(lines));

    }
    catch(error){

        // 記録自体の失敗で再生を止めては本末転倒なので、ここは黙って諦めます
        console.error("デバッグログの記録に失敗 :",error.name,error.message);

    }

}

/**
 * 「時:分:秒.ミリ秒」の形で、今の時刻の文字列を返します。
 *
 * ミリ秒まで出しているのは、複数のイベントが起きた前後関係を
 * 細かく追うためです。
 */
function formatDebugTimestamp(){

    const now = new Date();

    function pad(value,length){
        return String(value).padStart(length || 2,"0");
    }

    return pad(now.getHours()) + ":" +
           pad(now.getMinutes()) + ":" +
           pad(now.getSeconds()) + "." +
           pad(now.getMilliseconds(),3);

}


// ==========================================================
// 2. ブラウザ・OS側の合図を記録する
// ==========================================================

// 画面が見えなくなった/見えるようになった瞬間(画面ロックの合図)
document.addEventListener("visibilitychange",function(){
    logDebugEvent("visibilitychange → " + document.visibilityState);
});

// ページが裏に回った/戻ってきた瞬間(persistedはBFCacheに保存されたかどうか)
window.addEventListener("pagehide",function(event){
    logDebugEvent("pagehide (persisted=" + event.persisted + ")");
});

window.addEventListener("pageshow",function(event){
    logDebugEvent("pageshow (persisted=" + event.persisted + ")");
});

/*
Chromeが「もうこのページのJavaScriptを動かさない」と明示的に
判断した時に発火する専用イベントです(Chrome 68+のPage Lifecycle API)。
これがログに記録されていれば、「ブラウザが意図的にページを凍結した」
ことの動かぬ証拠になります。
*/
document.addEventListener("freeze",function(){
    logDebugEvent("★ document 'freeze' イベント発火(ブラウザがページを凍結しました)");
});

document.addEventListener("resume",function(){
    logDebugEvent("★ document 'resume' イベント発火(凍結から復帰しました)");
});

/*
audio要素の細かい状態変化です。再生が途切れる過程を追うために、
成功時の play/pause/ended だけでなく、データ待ちや中断を示す
stalled/waiting/suspend/abort/error もまとめて記録します。
*/
["play","pause","ended","stalled","waiting","suspend","abort","error"].forEach(function(eventName){

    audioPlayer.addEventListener(eventName,function(){
        logDebugEvent("audio '" + eventName + "' (currentTrackId=" + currentTrackId + ")");
    });

});

logDebugEvent("=== ページ読み込み ===");


// ==========================================================
// 3. ログを見るためのパネル(画面右下の🐛ボタン)
// ==========================================================

const debugLogPanel = document.getElementById("debug-log-panel");
const debugLogText = document.getElementById("debug-log-text");
const debugLogOpenBtn = document.getElementById("debug-log-open-btn");
const debugLogCloseBtn = document.getElementById("debug-log-close-btn");
const debugLogClearBtn = document.getElementById("debug-log-clear-btn");

debugLogOpenBtn.addEventListener("click",function(){

    const stored = localStorage.getItem(DEBUG_LOG_KEY);
    const lines = stored ? JSON.parse(stored) : [];

    /*
    textareaに入れているのは、スマホでも指で長押し→全選択→コピーが
    しやすいためです(pre/divだと機種によって全選択がやりにくい)。
    */
    debugLogText.value = lines.length > 0
        ? lines.join("\n")
        : "(まだ記録がありません)";

    debugLogPanel.style.display = "flex";

});

debugLogCloseBtn.addEventListener("click",function(){
    debugLogPanel.style.display = "none";
});

debugLogClearBtn.addEventListener("click",function(){
    localStorage.removeItem(DEBUG_LOG_KEY);
    debugLogText.value = "(まだ記録がありません)";
});
