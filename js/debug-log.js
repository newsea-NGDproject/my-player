/*
======================================================================
 【開発用・調査専用】debug-log.js ── 画面ロック中に音楽が止まる
 不具合を調査するための一時的なログ記録

----------------------------------------------------------------------

【このファイルの役割】

 竹弘の報告(2026-08-22): スマホの電源ボタンを1回押して画面ロック
 (時計やカレンダーが出る節電状態)にすると、曲が何曲か鳴った後に
 完全に止まる。これまでに試した対策(Media Session API・alertの撤去・
 バッテリー制限の変更)はどれも効果が無かった。

 このアプリには既にc014.html末尾に「開発用デバッグログパネル」
 (console.log/console.errorを横取りして画面に表示する仕組み、左上の
 🐛アイコン)があるので、**そのパネルの中身を増やすだけ**にする。

 【v130の失敗、v131で作り直した経緯】
 最初は自分専用の別パネルを新設したが、既存パネルとHTMLのID
 (id="debug-log-panel")が重複し、画面が壊れてしまった(竹弘の報告)。
 既存のパネルがすでに console.log を横取りして表示してくれるので、
 このファイルは logDebugEvent() から console.log を呼ぶだけの
 薄い作りに直した。新しい画面は増やさない。

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

 を記録する。あわせて js/player.js と js/queue.js にも、この
 logDebugEvent() を呼ぶ行を数か所だけ足してある(権限確認・
 play()呼び出しの前後など)。

 localStorageにも同じ内容を残しているのは保険です。万が一ページが
 完全に再読み込みされて既存パネルの表示が消えてしまっても、
 「止まる直前に何が起きていたか」の記録自体は端末に残ります。

----------------------------------------------------------------------

【★本番リリース前に必ず削除すること★】

 これは調査専用の一時的な機能です。原因が判明したら、次のすべてを
 削除してください(CLAUDE.mdの「本番リリース前に削除するもの」に
 登録済み)。

   ・このファイル(js/debug-log.js)
   ・c014.html内の対応するscriptタグ
   ・sw.jsのASSETSへの登録
   ・js/player.js・js/queue.jsに足した logDebugEvent(...) の行

 ※ console.log/console.errorを横取りする既存の「開発用デバッグログ
   パネル」自体は、このファイルより前からある別物なので触らないこと。
======================================================================
*/


// ==========================================================
// ログを書き残す
// ==========================================================

const DEBUG_LOG_KEY = "norirun_debug_log";

// 増えすぎてlocalStorageを圧迫しないよう、直近300行だけ残します
const DEBUG_LOG_MAX = 300;

/**
 * 出来事を記録します。
 *
 * 既存の「開発用デバッグログパネル」がconsole.logを横取りして
 * 画面に表示してくれるので、ここではconsole.logを呼ぶだけです。
 * あわせてlocalStorageにも同じ内容を保険として残します。
 *
 * js/player.js・js/queue.js からも呼ばれます。
 *
 * @param {string} message - 記録したい内容
 */
function logDebugEvent(message){

    /*
    時刻を付けています(v133で追加)。前回、既存パネル(console.log
    横取り)にはタイムスタンプが出ず、イベントの前後関係を追うのに
    苦労したための改善です。
    */
    const timestamp = formatDebugTimestamp();

    console.log("[調査ログ " + timestamp + "] " + message);

    try{

        const stored = localStorage.getItem(DEBUG_LOG_KEY);
        const lines = stored ? JSON.parse(stored) : [];

        lines.push(timestamp + " | " + message);

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
// ブラウザ・OS側の合図を記録する
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
// 定期的に再生状態を記録する(心拍ログ)
// ==========================================================
/*
竹弘の報告(2026-08-22):「ログだと最後の行で再生開始と出ているのに、
実際は鳴っていない」

これは重要な手がかりです。audioPlayer.play() は成功した(エラーが
出ていない)のに、実際の音は出ていない、という状態を意味します。
play/pause/endedなどの「変化した瞬間」のイベントだけでは、
この食い違いを捉えられません。

そこで10秒おきに、今の状態をまるごと記録します。

    currentTime   … 今何秒目を再生していることになっているか。
                    これが時間とともに進んでいれば「ブラウザの中では
                    ちゃんと再生が進んでいる」ことになり、鳴らない原因は
                    もっと下(OS側の音声出力)にあると分かります。
                    逆に増えていなければ、再生そのものが止まっています。
    paused        … 一時停止中かどうか
    muted         … ミュート状態かどうか(意図せずミュートされていないか)
    volume        … 音量(0になっていないか)
    readyState    … データがどこまで読み込めているか(0〜4の数値)
    networkState  … データの取得状況(0〜3の数値)
    visibilityState … 画面がロック中かどうか(同時に見比べるため)
*/
setInterval(function(){

    logDebugEvent(
        "心拍: currentTime=" + audioPlayer.currentTime.toFixed(2) +
        " paused=" + audioPlayer.paused +
        " muted=" + audioPlayer.muted +
        " volume=" + audioPlayer.volume +
        " readyState=" + audioPlayer.readyState +
        " networkState=" + audioPlayer.networkState +
        " visibility=" + document.visibilityState
    );

},10000);
