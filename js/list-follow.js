/*
======================================================================
 list-follow.js ── 曲一覧を「今の曲」へ動かす係(v255。v256で形を変えた)

----------------------------------------------------------------------

【このファイルの役割】

 何曲も聴いていると、今鳴っている曲が曲一覧のどこにいるのか
 分からなくなります(竹弘の要望 2026-10-25)。そこで、竹弘が自分で
 操作した時だけ、今の曲の行を見える所へ動かします。

   ① 🐇ジャンプの右上「🎵 今の曲へ」
        jumpToPlayingRow()      … js/jump.js の jumpTo("now") が呼ぶ
        → 今の曲を上から2段目へ(一気に)

   ② ノリRun ⇔ ノリノリRun の切り替え
        showPlayingRowInList()  … js/norirun.js の refreshNoriRunList() が呼ぶ
        → 今の曲が新しい一覧にあれば2段目へ。無ければ今までどおり先頭

 再生中の行の色(枠の色。v185)は今までどおり js/list-view.js が付けます。
 竹弘:「とても気に入ってます」。このファイルは「動かす」ことだけをします。

----------------------------------------------------------------------

【⚠️ 曲が変わった時に、自動では動かしません(v256)】

 v255 では「曲が変わったら、一覧を10秒触っていなければ今の曲へ自動で
 付いていく」形も作りましたが、竹弘が使ってみて外しました(2026-10-26):

     竹弘:「🎵 ジャンプ機能が便利すぎて、しかも動きもよくてこれだけで
            いいです。自動スクロールして再生曲に戻ってくるのが、
            なんだかお節介機能に思えてきた」

 → 一覧は、竹弘が操作した時(🎵・モードの切り替え)にしか動きません。
   自動で付いていく形を戻したくなったら、その時の作り(2秒待つ・接続の
   重なりの間は待つ・触ってから10秒など)が devlog/画面とその他.md に
   残っています(v255 は実機で試した後、コミットせずに v256 で外した)。

 ⚠️ ②のモードの切り替えは残しました(のりの判断に竹弘が OK 2026-10-26)。
    竹弘が自分で切り替えた時だけ動くもので、勝手に戻ってくるものでは
    ないためです。

----------------------------------------------------------------------

【なぜ「上から2段目」なのか】

 1段目に置くと、1つ前の曲が見えません。2段目なら「さっきの曲 → 今の曲 →
 次の曲」が並んで見え、流れの中のどこにいるかが分かります。
 ⚠️ ①(ジャケの特大表示)を作り直す時、竹弘はこの「2段目」を前提に
    「特大表示の文字は1段目まで被ってよい」と決めた(2026-10-25)。
    ここを変える時は、特大表示の置き場所も一緒に見直すこと。

----------------------------------------------------------------------

【読み込み順】

 js/search.js の後・js/norirun.js の前に読み込みます。ほかのファイルの
 関数・変数(menuListEl・currentTrackId・showTapToast)は、関数の中から
 だけ使います。
 ⚠️ 名前はすべて list で始めています。search.js の appEl のような短い名前を
    const で作ると、名前がぶつかって読み込んだ瞬間にエラーになり、
    このファイルが丸ごと動かなくなるためです。

 経緯 → devlog/画面とその他.md(v255〜v256)
======================================================================
*/


// ==========================================================
// 1. 行を探す・動かす
// ==========================================================

/**
 * その曲の行を探します。
 *
 * ⚠️ track_id を querySelector の文字に埋め込まず、全行を見て探します
 *    (js/list-view.js の refreshRow と同じ理由。記号が入っていても壊れない)。
 *
 * @return {Element|null} 行。一覧に無い時は null
 */
function findListRowForTrack(trackId){

    if(!trackId){ return null; }

    const rows = menuListEl.querySelectorAll(".music-row");

    for(const row of rows){

        if(row.dataset.trackId === trackId){ return row; }

    }

    return null;

}

/**
 * 検索で隠れている行かどうか(js/search.js が .search-hidden を付けます)。
 */
function isListRowHidden(row){

    return row.classList.contains("search-hidden");

}

/**
 * 行が「上から2段目」に来るように、一覧を一気に動かします。
 *
 * 1つ前の行(検索で隠れている行は飛ばす)が1段目にぴったり来る位置
 * = その行の offsetTop までスクロールします。一覧のいちばん上と同じ
 * 並び方になるので、見た目が揃います。1つ前の行が無い(先頭の曲)なら
 * いちばん上へ。
 *
 * 【offsetTop を使う理由】
 * 曲一覧(.music-list)は position:relative なので、行の offsetTop は
 * 「一覧の中身のいちばん上から何px下か」になり、スクロールしても変わりません。
 * そのまま scrollTop に入れれば、その行が一覧の上端に来ます。
 *
 * 【なめらかに流さない理由】
 * 🐇の「一番上へ」などと同じく、一気に飛びます(js/jump.js の jumpTo の
 * コメント)。遠い所までなめらかに流すと、何百行も描きながら流れていくので
 * 重く、時間もかかるためです。
 *
 * @param {Element} row … 動かしたい行
 */
function scrollListRowToSecond(row){

    let prev = row.previousElementSibling;

    while(prev && (!prev.classList.contains("music-row") || isListRowHidden(prev))){

        prev = prev.previousElementSibling;

    }

    const scrollMax = Math.max(menuListEl.scrollHeight - menuListEl.clientHeight,0);

    // 一番下の方の曲は、それ以上スクロールできないので一番下で止まります
    menuListEl.scrollTop = Math.min(prev ? prev.offsetTop : 0,scrollMax);

}


// ==========================================================
// 2. ① 🐇の「🎵 今の曲へ」
// ==========================================================

/**
 * 今の曲の行を、上から2段目へ一気に動かします(js/jump.js の jumpTo("now"))。
 *
 * 見えていても2段目へ揃えます(自分で押したので、いつも同じ所に来る方が
 * 分かりやすい)。一覧に無い時は、お知らせを出すだけです。
 *
 * お知らせは js/tap.js の showTapToast() を借ります(js/norirun.js と同じ)。
 */
function jumpToPlayingRow(){

    const row = findListRowForTrack(currentTrackId);

    let message = "";

    if(!currentTrackId){ message = "まだ曲を選んでいません"; }
    else if(!row){ message = "今の曲はこの一覧にありません"; }
    else if(isListRowHidden(row)){ message = "今の曲は検索で隠れています"; }

    if(message){

        if(typeof showTapToast === "function"){ showTapToast(message); }

        console.log("曲一覧をジャンプしました : 今の曲へ(" + message + ")");

        return;

    }

    scrollListRowToSecond(row);

    console.log("曲一覧をジャンプしました : 今の曲へ");

}


// ==========================================================
// 3. ② ノリRun ⇔ ノリノリRun の切り替え
// ==========================================================

/**
 * 一覧を作り直した直後に、今の曲の行を上から2段目へ一気に動かします。
 *
 * js/norirun.js の refreshNoriRunList() が呼びます。
 *
 * @return {boolean} 動かせたら true。今の曲が新しい一覧に無ければ false
 *                   (その時は呼んだ側が、今までどおり先頭へ戻します。v101)
 */
function showPlayingRowInList(){

    const row = findListRowForTrack(currentTrackId);

    if(!row || isListRowHidden(row)){ return false; }

    scrollListRowToSecond(row);

    return true;

}
