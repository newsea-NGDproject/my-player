/*
======================================================================
 search.js ── 曲一覧の検索(🐇の左フリック)

----------------------------------------------------------------------

【このファイルの役割】

 🐇ジャンプボタンを左にフリックすると、曲一覧の検索モードに入ります。

   openSearchMode()  … 検索モードに入る(検索欄を出す)
   closeSearchMode() … 検索モードを終える(検索欄を閉じる)

 js/jump.js の jumpTo("search") から呼ばれます。

----------------------------------------------------------------------

【第1段階(v140)】

 左フリックで検索モードに入る/✕で終える、上半分が縮み曲一覧が
 広がる演出、検索欄をタップすると標準キーボードが立ち上がる、
 という「ジェスチャーと見た目の切り替え」を実装しました。

【第2段階(v141)】

 打った文字で、実際に曲一覧を絞り込む機能を追加しました。

   applySearchFilter() … 入力文字に合わない曲の行を隠す

 竹弘の狙いどおり「打つたびにどんどん曲が絞られていく」ように、
 1文字打つたびに(inputイベント)即座に絞り込み直します。

 【絞り込みの判定】
 曲名(タイトルが無ければファイル名)・アーティスト名のどちらかに、
 入力文字が含まれていれば一致とみなします。大文字/小文字、
 半角/全角カタカナの違いは吸収します(js/sort.js の
 normalizeForSort() を再利用)。読み仮名では判定できません
 (漢字の読みをコンピュータは知らないため。並び替え機能と同じ制約)。

 【行を作り直さず、隠すだけにした理由】
 すでに描画済みの .music-row(369個)を毎回作り直すと重くなります。
 曲順(currentOrderList)そのものは変えず、CSSクラス
 (.search-hidden)を付け外しして見た目だけ隠す方式にしたので、
 検索を終えれば元の並びのまま何も変わらずに戻ります。

----------------------------------------------------------------------

【上半分が縮んで曲一覧が広がる演出について】

 竹弘の要望(2026-08-23):「下半分の曲一覧が上半分側に滑らかに
 素早くスクロール移動し、上半分側を曲一覧で隠す...かっこいいでしょ」

 実際の実装は「曲一覧が上半分に重なって覆いかぶさる」のではなく、
 「上半分(#upper-area)自体が検索欄1行の高さまで縮み、その分
 曲一覧(#list-area)が伸びて空いた場所を埋める」という作りに
 しています(のりのアレンジ、竹弘の「かっこよければアレンジで
 いい」という了承のもとで採用)。

 理由は、要素を重ねる(position:fixedで上に被せる)方式は、
 タップの当たり判定や影の表現でズレが出やすいためです。#app に
 .search-mode クラスを付け外しするだけで両方のカードが連動して
 滑らかにサイズを変わるので、見た目のドラマチックさは保ちつつ、
 仕組みはシンプルです(CSSは c014.html)。

----------------------------------------------------------------------

【検索欄が #upper-area の中にある理由】

 #search-panel は #upper-area の中に置き、position:absolute で
 その内側いっぱいに広げています。#upper-area 自体のサイズが
 アニメーションで変わるのに合わせて、検索欄も自動で追従して
 大きさが変わるようにするためです(親のサイズ変化にただ乗りする
 形なので、検索欄側で別にアニメーションを書く必要がありません)。
======================================================================
*/


const appEl = document.getElementById("app");
const searchInput = document.getElementById("search-input");
const searchCloseBtn = document.getElementById("search-close-btn");


/**
 * 検索モードに入ります。
 */
function openSearchMode(){

    appEl.classList.add("search-mode");

    /*
    focus() を呼ぶと、スマホ標準のキーボードが自動で立ち上がります。
    タップの手間を1回省くためのものです。
    */
    searchInput.focus();

}

/**
 * 検索モードを終えます。
 */
function closeSearchMode(){

    appEl.classList.remove("search-mode");

    /*
    blur() は focus() の逆で、キーボードを引っ込めます
    (js/pitch.js の直打ち入力パネルと同じ命令です)。
    */
    searchInput.blur();

    /*
    検索欄を空にして、絞り込みも解除します(v141)。
    次に検索モードを開いた時に、前回の続きが残っていると
    分かりにくいためです。
    */
    searchInput.value = "";
    applySearchFilter("");

}

searchCloseBtn.addEventListener("click",function(){
    closeSearchMode();
});


// ==========================================================
// 絞り込み(v141)
// ==========================================================

const searchNoResultsEl = document.getElementById("search-no-results");

/*
1文字打つたびに(input イベント)絞り込み直します。
「打つたびにどんどん曲が絞られていく」という竹弘の狙いどおり、
確定操作(Enter等)を待たずに即座に反映します。
*/
searchInput.addEventListener("input",function(){
    applySearchFilter(searchInput.value);
});

/**
 * 入力文字に合わない曲の行を隠します。
 *
 * @param {string} query - 検索欄に打たれている文字
 */
function applySearchFilter(query){

    /*
    normalizeForSort() は js/sort.js の関数です。半角/全角カタカナの
    表記ゆれを揃えます。並び替えの時と同じ理由で、比較の前に
    かけておきます。toLowerCase() は英字の大文字/小文字を揃えます。
    */
    const normalizedQuery = normalizeForSort(query).toLowerCase();

    const rows = menuListEl.querySelectorAll(".music-row");

    // 何か1件でも見えているかを数えます(0件だった時の案内に使います)
    let visibleCount = 0;

    for(const row of rows){

        const track = libraryMap[row.dataset.trackId];

        if(!track){ continue; }

        /*
        検索欄が空の時は、判定するまでもなく全曲を表示します
        (indexOfで空文字を探すと必ず0番目で見つかってしまい、
         全曲一致になるのでこれ自体でも動作はしますが、意図を
         はっきりさせるため明示しています)。
        */
        const matched = (normalizedQuery === "") || trackMatchesSearch(track,normalizedQuery);

        row.classList.toggle("search-hidden",!matched);

        if(matched){ visibleCount++; }

    }

    /*
    1件も見つからなかった時だけ案内を出します。
    検索欄が空の時(まだ何も打っていない時)には出しません。
    */
    if(searchNoResultsEl){
        searchNoResultsEl.style.display =
            (normalizedQuery !== "" && visibleCount === 0) ? "block" : "none";
    }

}

/**
 * 1曲が、検索文字にマッチするかを判定します。
 *
 * @param {Object} track          - libraryMap から取り出した1曲分のデータ
 * @param {string} normalizedQuery - normalizeForSort + toLowerCase 済みの検索文字
 */
function trackMatchesSearch(track,normalizedQuery){

    const title = normalizeForSort(track.title || track.file_name || "").toLowerCase();
    const artist = normalizeForSort(track.artist || "").toLowerCase();

    return title.indexOf(normalizedQuery) !== -1 ||
           artist.indexOf(normalizedQuery) !== -1;

}
