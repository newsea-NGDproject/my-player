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
     (v199から、デッキA・Bの**両方**を記録。下のコメント参照)

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

==========================================================
 ⚠️⚠️ v199で、デッキA・Bの**両方**を記録するように直しました
==========================================================

【v198までの穴(2026-09-13にのりが気づいた)】

v167で <audio> が2枚(デッキA・B)になった後も、ここは

    audioPlayer.addEventListener(...)

のままでした。audioPlayer は「いま主役のデッキ」を指す変数ですが、
addEventListener は**呼んだ瞬間に指していた1枚**にしか耳を付けません。
このファイルは起動時に1回だけ読まれるので、耳はデッキAに固定でした。

    play/pause/ended/abort/waiting … デッキAの分しか記録されていなかった
    心拍(10秒おき)                  … 主役を正しく追っていた

竹弘の報告「デッキ交代の時に先行曲が途切れる(20回に1回くらい)」の
ログに異常が見当たらなかったのは、**証拠の半分(デッキBの出来事)が
そもそも記録されていなかった**可能性があります。

【⚠️ bindDeckEvent(js/deck.js)を使わなかった理由】

bindDeckEvent は2枚に耳を付けてくれますが、**「主役ではないデッキからの
知らせは聞き流す」という関所**が付いています。再生の処理にはその関所が
正しいのですが(裏で終わった曲の ended で次へ飛ばないため)、

    今回いちばん見たいのは、交代した後の先行曲
    = **もう主役ではなくなった方** に何が起きたか

です。関所を通すと、まさにその知らせが捨てられてしまいます。
→ ここでは関所を通さず、2枚それぞれに直接耳を付けます。
   記録するだけで再生には何も影響しないので、聞き流す必要がありません。

【ログの形】

どちらのデッキか、その瞬間に主役だったか裏だったかも一緒に書きます。

    audio 'pause' デッキB(裏) (currentTrackId=…)
*/

/**
 * デッキの名前("A" / "B")を返します(v199)。
 *
 * ログを読む時に、どちらのデッキの出来事かを見分けるためです。
 *
 * @param  {HTMLAudioElement} deck - deckAudioA か deckAudioB
 * @return {string} "A" または "B"
 */
function getDebugDeckName(deck){

    return (deck === deckAudioA) ? "A" : "B";

}

/**
 * そのデッキが今、音程維持(WSOLA)を回しているかを返します(v200)。
 *
 * ------------------------------------------------------------
 * 【何を見るためのものか】
 *
 * 音程維持(preservesPitch)は、再生速度を変えても声の高さを
 * 変えないための仕組みです。とても重い計算(WSOLA)なので、
 * **聞こえていない音のためには切る**ようにしてあります。
 *
 *     入 … 計算を回している(耳に届く音。正しい)
 *     切 … 計算を止めている(音量0で聞こえない音。軽い)
 *
 * v200で「接続が終わって音量0になった先行曲」も切るようにしました。
 * ここが狙いどおり動いているかを、心拍ログで見られるようにします。
 *
 * ------------------------------------------------------------
 * 【読み方 ―― 竹弘へ】
 *
 * 🕺ノリノリRunで曲が繋がった後、**裏デッキが「音程維持=切」に
 * なっていれば成功**です。接続の直後は先行曲もまだ聞こえているので
 * 「入」のままで、フェードが終わった数秒後に「切」へ変わります。
 *
 *     繋いだ直後      裏デッキB … 音程維持=入   ← まだ聞こえている
 *     8秒くらい後     裏デッキB … 音程維持=切   ← ★これが出れば成功
 *
 * ⚠️ 主役のデッキは**いつでも「入」**でなければいけません。
 *    主役が「切」になっていたら、その曲は声が甲高く(または低く)
 *    鳴っているはずです。その時はログを見せてください。
 *
 * ⚠️ メインメニューでは曲を繋がないので、裏デッキはずっと
 *    「入」のままです(何も載っていないデッキなので、これで正常)。
 *
 * @param  {HTMLAudioElement} deck - 調べたいデッキ
 * @return {string} "入" または "切"
 */
function getDebugPitchState(deck){

    /*
    preservesPitch は、古いブラウザでは webkitPreservesPitch という
    別の名前で用意されていました。どちらかが false なら「切」と
    見なします(js/deck.js は両方に同じ値を入れています)。
    */
    const preserve = (deck.preservesPitch !== false)
                  && (deck.webkitPreservesPitch !== false);

    return preserve ? "入" : "切";

}

[deckAudioA,deckAudioB].forEach(function(deck){

    ["play","pause","ended","stalled","waiting","suspend","abort","error"].forEach(function(eventName){

        deck.addEventListener(eventName,function(){

            /*
            主役か裏かは、**知らせが来た瞬間に**判定します。
            耳を付けた時点で決めてしまうと、交代した後に食い違います
            (v198までの穴とまったく同じ間違いになるため)。
            */
            const role = (deck === audioPlayer) ? "主役" : "裏";

            logDebugEvent(
                "audio '" + eventName + "' デッキ" + getDebugDeckName(deck) +
                "(" + role + ") (currentTrackId=" + currentTrackId + ")"
            );

        });

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

    /*
    v199で、**裏のデッキの様子**も同じ行の後ろに足しました。

    曲を繋いでいる最中は、2曲が同時に鳴っています。主役だけを見ていると
    「交代した後の先行曲(=裏)が、最後まで鳴りきらずに止まって
    いないか」が分かりません。

        paused=true になっている    … 裏で止まっている
        currentTime が進んでいない  … 止まっている(または読み込み待ち)

    getIdleDeck() は js/deck.js にある「主役ではない方を返す」関数です。
    ⚠️ メインメニューでは交代が起きないので、裏はずっと
       「paused=true / currentTime=0.00」のままです(これは正常)。
    */
    const idleDeck = getIdleDeck();

    logDebugEvent(
        "心拍: デッキ" + getDebugDeckName(audioPlayer) +
        " currentTime=" + audioPlayer.currentTime.toFixed(2) +
        " paused=" + audioPlayer.paused +
        " muted=" + audioPlayer.muted +
        " volume=" + audioPlayer.volume +
        " readyState=" + audioPlayer.readyState +
        " networkState=" + audioPlayer.networkState +
        " 音程維持=" + getDebugPitchState(audioPlayer) +
        " visibility=" + document.visibilityState +
        " / 裏デッキ" + getDebugDeckName(idleDeck) +
        " currentTime=" + idleDeck.currentTime.toFixed(2) +
        " paused=" + idleDeck.paused +
        " 音程維持=" + getDebugPitchState(idleDeck)
    );

},10000);
