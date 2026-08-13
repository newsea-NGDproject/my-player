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

    row.innerHTML =
        "<button class='square-btn play-btn'>▶️</button>" +
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

    const playBtn = row.querySelector(".play-btn");
    playBtn.addEventListener("click",function(){
        playTrack(trackId);
    });

    // 1行目・2行目それぞれ、タップすると横スクロールで全文を見せます。
    const lineTitle = row.querySelector(".line-title");
    const lineMeta = row.querySelector(".line-meta");
    lineTitle.addEventListener("click",function(){ triggerMarquee(lineTitle); });
    lineMeta.addEventListener("click",function(){ triggerMarquee(lineMeta); });

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

    const sortHandle = row.querySelector(".sort-handle");
    bindDragAndDropEvents(row,sortHandle);

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
