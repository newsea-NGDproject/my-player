/*
======================================================================
 favorite.js ── お気に入りボタン

----------------------------------------------------------------------

【このファイルの役割】

 曲一覧の行、ノリ注入ボタンの次・曲名の前にある小さな丸ボタンです。

   ☆ … まだお気に入りにしていない曲
   ⭐ … お気に入りにした曲

 ノリ注入ボタン(nori.js)と記号を入れ替える方式は同じですが、
 こちらは**何度でも外せます**(竹弘の指示。飽きたら外せるように)。
 ノリ注入の「一方通行」とは違う点なので混同しないこと。

----------------------------------------------------------------------

【favorited_at というフィールドについて】

 お気に入りにした日時を music_library の favorited_at に記録します
 (docs/db-schema.md 参照)。この1つのフィールドが「お気に入りの印」と
 「お気に入り曲同士の並び順」を兼ねます。excluded_at・nori_injected_at
 と同じ設計です。

 外した時はこの値を undefined に戻します。除外解除(exclude.js の
 clearExclusion)と同じやり方です。
======================================================================
*/


// ==========================================================
// 1. ボタンに出す記号
// ==========================================================
const FAVORITE_ICON_OFF = "☆";
const FAVORITE_ICON_ON = "⭐";


/**
 * その曲が今お気に入りかどうかを返します。
 *
 * 判定に使うのは favorited_at(お気に入りにした日時)です。
 * 未設定(または0)なら、お気に入りにしていない曲です。
 */
function isFavorited(track){

    // !! は「あるかないかの2択に直す」書き方です(0やundefinedはfalseになります)
    return !!(track && track.favorited_at);

}

/**
 * その曲に出すべき記号を返します。
 *
 * 曲一覧の行を作る時(list-view.js)から呼ばれます。
 */
function buildFavoriteIcon(track){

    return isFavorited(track) ? FAVORITE_ICON_ON : FAVORITE_ICON_OFF;

}


// ==========================================================
// 2. お気に入りを切り替える
// ==========================================================
/**
 * お気に入りボタンが押された時の処理です。ON/OFFを切り替えます。
 *
 * @param {string} trackId       - 対象の曲
 * @param {Element} buttonElement - 押されたボタン本体(表示を変えるため)
 *
 * 【なぜボタンそのものを受け取るのか】
 *
 * 行を丸ごと作り直さず、押されたボタンの記号だけを書き換えることで、
 * 押した瞬間に行が消えて作り直される「ちらつき」を防ぎます。
 * nori.js の injectNori() と同じ考え方です。
 */
async function toggleFavorite(trackId,buttonElement){

    const track = libraryMap[trackId];

    if(!track){ return; }

    /*
    切り替え前の状態を覚えておきます。保存に失敗した時、
    メモリ上の値を元に戻すために使います。
    */
    const wasFavorited = isFavorited(track);
    const previousValue = track.favorited_at;

    try{

        if(wasFavorited){

            // 外す時は未設定に戻します(nori_injected_atのような一方通行ではありません)
            track.favorited_at = undefined;

        }
        else{

            // Date.now() は1970年1月1日からの経過ミリ秒を返す標準の命令です。
            // 数値なので、お気に入りにした順に並べ替えられます。
            track.favorited_at = Date.now();

        }

        await idbPut(STORE_MUSIC,track);

        // 保存が成功してから表示を変えます
        buttonElement.textContent = buildFavoriteIcon(track);

        console.log(
            wasFavorited ? "お気に入りを外しました :" : "お気に入りにしました :",
            track.file_name
        );

    }
    catch(error){

        /*
        保存に失敗した場合は、メモリ上の値も元に戻します。
        戻さないでいると「画面ではお気に入りなのに、次に開くと
        元に戻っている」という分かりにくい食い違いが起きるためです。
        */
        track.favorited_at = previousValue;

        console.error(
            "お気に入りの保存に失敗 :",
            track.file_name,
            error.name,
            error.message
        );

    }

}
