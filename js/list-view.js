/*
======================================================================
 list-view.js ── 曲一覧の描画

----------------------------------------------------------------------

【このファイルの役割】

 画面下半分の曲一覧に、1曲ずつの行を作って並べます。
 legacy(ver8.5-gemini)のOFSモジュールから移植し、
 file_path基準だったものを track_id 基準に置き換えたものです。

   renderList()        … 一覧を全部作り直す(起動時に1回だけ)
   createRowElement()  … 1曲分の行を作る
   refreshRow()        … 解析が終わった曲の行「だけ」を差し替える

 1行の見た目は次の構成です。

   [再生ボタン] [ 曲情報エリア ] [ジャケット] [並び替えボタン]
                     ↑
              1行目 … タイトル
              2行目 … 曲の長さ + 空白 + アーティスト名

 他は、表示する文字を作る小さな部品です
 (buildTitleText / buildMetaHtml / formatDuration / escapeHtml)。

----------------------------------------------------------------------

【他のファイルとの関係】

 このファイルの関数は、次のファイルの関数を呼び出します。

   playTrack()            → player.js
   bindDragAndDropEvents()→ drag-sort.js
   draggingRow(変数)     → drag-sort.js

 逆に、このファイルの refreshRow() は metadata.js から呼ばれます。
 (解析が1曲終わるたびに、その行の表示を最新にするため)
======================================================================
*/


function renderList(){

    menuListEl.innerHTML = "";

    if(currentOrderList.length === 0){
        menuListEl.innerHTML =
            "<div class='empty-message'>まだ曲が登録されていません。<br>" +
            "c013の「Musicフォルダ確認」から曲を登録してください。</div>";
        return;
    }

    currentOrderList.forEach(function(trackId){

        /*
        🕺ノリノリRun再生モードでは、ノリ注入済みの曲だけを並べます
        (v163、竹弘の指示)。

            「曲一覧には、ノリ注入曲のみが表示され、曲接続演奏となる」

        繋ぐのに必要なBPMと拍の位置を持っている曲だけが対象なので、
        持っていない曲は、そもそも選べないようにしておきます。

        ⚠️ ここで飛ばすのは**表示だけ**です。並び順そのもの
           (currentOrderList)には手を触れていないので、メインメニューへ
           戻れば竹弘が並べた順のまま全曲が戻ります。
        */
        if(isNoriRunMode){

            const track = libraryMap[trackId];

            if(!track || !hasSavedTapResult(track)){ return; }

        }

        const row = createRowElement(trackId);
        if(row){ menuListEl.appendChild(row); }

    });

}

/*
1曲分の行(.music-row)を作って返します。

renderList()から切り出して独立した関数にしたのは、
メタデータの解析が終わった曲を「その行だけ」差し替えたいためです。

【なぜ「その行だけ」にこだわるのか】
OFS Ver1.1(legacy)では、1曲解析するたびにリスト全体を作り直して
いました。100曲だと延べ5,050回も行を作ることになり、曲数が増えるほど
二次関数的に重くなります(いわゆるO(n²)問題)。
1曲=1行だけ差し替えれば、何百曲になっても速度が落ちません。
*/
function createRowElement(trackId){

    const track = libraryMap[trackId];
    if(!track){ return null; }

    const row = document.createElement("div");
    row.className = "music-row";
    row.dataset.trackId = trackId;

    /*
    再生できないと分かっている曲は、行ごと薄いグレーにします(v110)。

    竹弘の指示:
        「可能なら薄いグレーアウトを絵文字含むその1曲に掛けて欲しい」

    CSSの .excluded は行全体の透明度を下げる指定なので、中にある
    絵文字(🛌)もジャケット画像も、まとめて薄くなります。文字色を
    1つずつ変えていく必要はありません。

    excluded という状態を「クラス名」で表しておくと、見た目の調整は
    CSS側だけで完結します。JSは「この曲は除外中である」と伝える
    だけで済み、両者の役割がはっきり分かれます。
    */
    const excluded = isExcluded(track);

    if(excluded){
        row.classList.add("excluded");
    }

    row.innerHTML =
        "<button class='square-btn norinori-btn'>" + buildNoriIcon(track) + "</button>" +
        "<button class='favorite-btn'>" + buildFavoriteIcon(track) + "</button>" +
        "<div class='info-area'>" +
            "<div class='text-block'>" +
                "<div class='info-line line-title'>" +
                    "<span class='scroll-text'>" + escapeHtml(buildTitleText(track)) + "</span>" +
                "</div>" +
                "<div class='info-line line-meta'>" +
                    "<span class='artist-text'>" + buildMetaHtml(track) + "</span>" +
                "</div>" +
            "</div>" +
        "</div>" +
        "<button class='square-btn sort-handle'>" +
            "<svg width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'>" +
                "<line x1='12' y1='2' x2='12' y2='22'></line>" +
                "<polyline points='7 7 12 2 17 7'></polyline>" +
                "<polyline points='7 17 12 22 17 17'></polyline>" +
            "</svg>" +
        "</button>";

    /*
    一番左のボタンは「ノリ注入ボタン」です(nori.js が担当)。

    ノリRunの一番の売りになる部分で、押すと 🛌(寝ている)から
    🕺(踊っている)へ変わり、その曲がノリ注入済みであることを表します。
    */
    const noriBtn = row.querySelector(".norinori-btn");

    /*
    除外中の曲には、ノリ注入ボタンを働かせません(v110、竹弘の指示)。

    鳴らない曲にノリを注入しても意味がないうえ、ノリ注入は
    一度きりで取り消せない操作(nori.js の一方通行)なので、
    間違って押してしまうと元に戻せなくなるためです。

    押しても何も起きないよう、そもそも click の受付を登録して
    いません。あわせて disabled を付けているのは、ブラウザに
    「このボタンは今使えない」と伝えるためです。押した時の
    色の変化も止まるので、反応しないことが指先で伝わります。
    */
    if(excluded){

        noriBtn.disabled = true;

    }
    else{

        noriBtn.addEventListener("click",function(){
            injectNori(trackId,noriBtn);
        });

    }

    /*
    お気に入りボタン(☆/⭐)は favorite.js が担当します。
    ノリ注入と違い、何度でもON/OFFを切り替えられます。
    */
    const favoriteBtn = row.querySelector(".favorite-btn");

    favoriteBtn.addEventListener("click",function(){
        toggleFavorite(trackId,favoriteBtn);
    });

    /*
    曲情報エリア(1行目のタイトル / 2行目の曲長+アーティスト)を
    タップすると、次の2つを同時に行います。

      ① 長い文字を横スクロールさせて全文を見せる
      ② その曲を再生する

    【なぜ1つのタップに2つの働きを持たせるのか】

    v78で一番左のボタンがノリ注入ボタンになったため、再生の操作を
    どこに置くかを決める必要がありました。竹弘の判断で、もともと
    全文表示に使っていたこのエリアに再生も持たせています。

        「再生選択した時に同時にスクロールを始めるギミックは、
          何もユーザーの機能を阻害するものはなく、見た目にも良い」

    確かに、押した曲の文字が流れ出すので「今これを選んだ」と
    目で分かる利点もあります。
    */
    const lineTitle = row.querySelector(".line-title");
    const lineMeta = row.querySelector(".line-meta");

    lineTitle.addEventListener("click",function(){
        triggerMarquee(lineTitle);
        playTrack(trackId);
    });

    lineMeta.addEventListener("click",function(){
        triggerMarquee(lineMeta);
        playTrack(trackId);
    });

    /*
    ジャケット画像は、取得できている曲にだけ差し込みます。

    上のinnerHTMLに混ぜず、あとから要素として追加しているのには
    理由があります。画像を表示するには一時URLを作る必要があり、
    そのURLは使い終わったら必ず解放しなければならないためです
    (createJacketImage の解説を参照)。
    */
    if(track.cover_art){
        const infoArea = row.querySelector(".info-area");
        infoArea.appendChild(createJacketImage(track.cover_art));
    }

    /*
    除外中の曲は、ドラッグで動かせないようにします(v110、竹弘の指示)。

    「常に一覧の一番下」という約束を、手で動かして破れてしまっては
    意味がないためです。掴めるのに離すと戻される作りにすると、
    操作しているのに言うことを聞かない、という嫌な感触になります。
    最初から掴めない方が、はっきりしていて分かりやすい。

    やり方は単純で、ドラッグの受付(bindDragAndDropEvents)を
    登録しないだけです。ボタン自体は残しますが、上の .excluded に
    よって薄く表示されるので、触れないことは見て分かります。
    */
    if(!excluded){

        const sortHandle = row.querySelector(".sort-handle");
        bindDragAndDropEvents(row,sortHandle);

    }

    return row;

}

/**
 * ジャケット画像の<img>要素を作ります。
 *
 * 【一時URLと、その後始末について】
 *
 * DBに保存されているのはBlob(ファイルの実体)で、そのままでは
 * <img>のsrcに指定できません。URL.createObjectURL() を使うと
 * 「このブラウザの中だけで通用する一時的なURL」が発行され、
 * それを指定することで画像として表示できます。
 *
 * ただしこの一時URLは、作った分だけブラウザがメモリを確保し続け、
 * 明示的に解放するまで居座ります。竹弘のライブラリは369曲あるので、
 * 解放を忘れると画面を開くたびにメモリを食いつぶしていきます。
 *
 * そこで、画像の表示が終わった瞬間(onload)に解放しています。
 * 表示に使い終わった後なので、解放しても画像は消えません。
 * 読み込みに失敗した時(onerror)も同様に解放します。
 */
function createJacketImage(blob){

    const img = document.createElement("img");
    img.className = "jacket-img";

    const objectUrl = URL.createObjectURL(blob);

    img.onload = function(){
        URL.revokeObjectURL(objectUrl);
    };

    img.onerror = function(){
        URL.revokeObjectURL(objectUrl);
    };

    img.src = objectUrl;

    return img;

}

/*
1行目に出す文字を決めます。

竹弘の指示:
    「タイトルが取得できない時は、ファイル名を表示する仕様とします」

c013の登録時点で title には file_name が入っているため、
通常はそのままでも表示できますが、タグ解析で空文字が
入ってしまった場合の保険としても || で受け止めています。
*/
function buildTitleText(track){
    return track.title || track.file_name || "(名称不明)";
}

/*
2行目に出すHTMLを組み立てます。

竹弘の指示:
    「1行目をタイトル、2行目を曲長さ(時分秒対応**.**.**)表示の後ろに
      1ブランク空けてアーティスト名とする」
    「アーティスト名が取得できない時は、何も表示しません」

曲の長さだけ数字の幅を揃えたい(.duration-text)ので、
文字列ではなくHTMLとして組み立てています。
*/
function buildMetaHtml(track){

    const durationText = formatDuration(track.duration);
    const artistText = track.artist || "";

    let html = "";

    if(durationText !== ""){
        html = "<span class='duration-text'>" + durationText + "</span>";
    }

    if(artistText !== ""){
        // 曲の長さとアーティスト名の間に、指示通り空白を1つ入れます。
        // &nbsp; ではなく通常の空白でよいのは、HTMLの空白が詰められるのは
        // 「連続した空白」の場合だけで、1つなら維持されるためです。
        if(html !== ""){ html = html + " "; }
        html = html + escapeHtml(artistText);
    }

    return html;

}

/*
秒数を「時.分.秒」の文字列に変換します。

竹弘の指示により、区切り文字は一般的な「:」ではなく「.」を使います。
1時間未満の曲は「分.秒」の2枠、1時間を超える曲だけ「時.分.秒」の3枠。

    222秒   → "03.42"
    725秒   → "12.05"
    3872秒  → "1.04.32"

まだ解析していない(duration が 0)場合は空文字を返し、
2行目には何も表示しません。解析が済んだ時点で数字が現れます。
*/
function formatDuration(seconds){

    // 数値として扱えない値・0以下・無限大(Infinity)を弾きます。
    // isFiniteは「ちゃんと有限の数値か」を判定する標準関数です。
    if(!seconds || !isFinite(seconds) || seconds <= 0){
        return "";
    }

    const total = Math.round(seconds);

    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    // padStart(2,"0") は「2桁になるまで先頭に0を足す」という命令です。
    // (例: "5" → "05")
    function pad2(value){
        return String(value).padStart(2,"0");
    }

    if(hours > 0){
        return hours + "." + pad2(minutes) + "." + pad2(secs);
    }

    return pad2(minutes) + "." + pad2(secs);

}

/*
HTMLとして表示する文字に、曲名由来の記号(<や>など)が
含まれていても崩れないようにする、簡易的なエスケープ関数です。
*/
function escapeHtml(text){
    return String(text)
        .replace(/&/g,"&amp;")
        .replace(/</g,"&lt;")
        .replace(/>/g,"&gt;");
}

// 長いタイトル/アーティスト名をタップした時、横スクロールで見せます。
function triggerMarquee(areaElement){

    const textElement = areaElement.firstElementChild;
    textElement.classList.remove("scroll-active");
    void textElement.offsetWidth;

    const areaWidth = areaElement.offsetWidth;
    const textWidth = textElement.scrollWidth;
    const speed = 50;

    let scrollDistance = textWidth > areaWidth ? textWidth - areaWidth + 20 : textWidth * 0.6;
    const duration = (scrollDistance + areaWidth) / speed;

    textElement.style.setProperty("--scroll-x","-" + scrollDistance + "px");
    textElement.style.setProperty("--scroll-duration",duration + "s");
    textElement.classList.add("scroll-active");

    textElement.addEventListener("animationend",function(){
        textElement.classList.remove("scroll-active");
    },{once:true});

}

/**
 * 指定した曲の行だけを作り直して差し替えます。
 *
 * メタデータの解析が1曲終わるたびに metadata.js から呼ばれます。
 */
function refreshRow(trackId){

    /*
    querySelectorに文字列を埋め込む方式は、track_idに記号が
    含まれていた場合に壊れる恐れがあるため、
    地道に全行を見て一致するものを探しています。
    (曲数が数百でも、DOMを作り直すより軽い処理です)
    */
    const rows = menuListEl.querySelectorAll(".music-row");

    let targetRow = null;

    for(const row of rows){
        if(row.dataset.trackId === trackId){
            targetRow = row;
            break;
        }
    }

    if(!targetRow){ return; }

    /*
    掴んでドラッグしている最中の行は差し替えません。
    浮遊中の行を作り直すと、指との位置関係や
    並び替えの状態が壊れてしまうためです。

    draggingRow は drag-sort.js が持っている変数です。
    */
    if(targetRow === draggingRow){ return; }

    const newRow = createRowElement(trackId);
    if(!newRow){ return; }

    // replaceWith は「この要素を別の要素と入れ替える」標準の命令です。
    targetRow.replaceWith(newRow);

}
