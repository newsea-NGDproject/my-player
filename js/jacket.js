/* ==========================================================
   js/jacket.js

   再生中のジャケット写真を、タップで大きく表示する画面です。

   竹弘の要望(2026-09-13、棚③の11番):
       「再生中のアルバムをタップで特大表示(画像がある時だけ)」

   ------------------------------------------------------------
   【この版(v204)でやること / やらないこと】

       やる     … タップで大きく見る
       やらない … ジャケ写の差し替え(カメラで撮る)
                  画像が無い曲に薄いカメラアイコンを出す

   差し替えとカメラアイコンは竹弘の指示で「次のブラッシュアップ」に
   回しました(CLAUDE.md の未実装リストに登録済み)。この画面の
   **アーティスト名の下**に、その時ボタンを2つ置く予定です。

   ------------------------------------------------------------
   【⚠️ 画質について ―― この版の本当の目的】

   DBに入っているジャケットは **96px角** です(js/metadata.js の
   COVER_MAX_SIZE)。曲一覧の44px角と上半分の表示には十分ですが、
   大きく映すと引き伸ばすことになります。

   原寸を保存していないのは「1曲500KB〜1MBで、数百曲だとDBが
   数百MBに膨れる」という竹弘の判断(2026-08-08)によるものです。

   **この版は、その96pxをそのまま拡大して「実際どのくらい粗いか」を
   竹弘の目で確かめるためのものです。** 粗くて気になるようなら、
   次のどちらかを足します:

       (b) 開く時だけ元ファイルから読み直す … 最高画質。開くのに
           一瞬待つ。⚠️ 走行中だと音がヨレる恐れ
       (c) 保存サイズを上げる(96→320px等) … 369曲の取り直しと
           DBの増加が要る

   ⚠️ **先に(c)をやってから「やっぱり今のままで十分だった」となると、
      369曲ぶんの時間とDB容量が無駄になります。** だから先に見ます。
   ========================================================== */


// ==========================================================
// 1. 大きさの決め方
// ==========================================================
/*
今のジャケットの何倍に拡大するか。

⚠️ **一辺を何倍にするか**の話です(面積ではありません)。上半分の
   ジャケットはエリア3〜4の2マスぶんの正方形で、端末によって実際の
   大きさが変わります。だから**決め打ちのピクセル数ではなく、
   その場で測って何倍**にします(getBoundingClientRect)。

------------------------------------------------------------
【4倍 → 3倍にした理由(v206、竹弘の実機テストの結果)】

v204では竹弘の指定どおり4倍にしていましたが、実機で見た竹弘の
判断はこうでした:

    「サイズは3倍でいい。**ブラッシュアップ機能の追加スペースが
      ない**」

つまり4倍だと画面がジャケットで埋まってしまい、この下に置く予定の
『オリジナルジャケット』『📷 差し替え』ボタンの置き場所が無い、
ということです。**実際に見たから分かった**ことで、先に作り込まずに
まず見てもらったのが正解でした。

⚠️ **この「3倍」は画面に映す大きさの話で、DBに保存する解像度
   (js/metadata.js の COVER_ART_SIZE)とは別物です。** 3倍表示
   (約228px)を高DPIでぼやけさせないために、保存側は480pxにして
   あります(v206)。混同しないこと。
------------------------------------------------------------
*/
const JACKET_BIG_SCALE = 3;

/*
上半分の高さに対する、いちばん大きくできる割合です。

竹弘の指定は「表示エリアは上半分のエリア内」。4倍がそのまま
上半分に収まらない端末(画面の低い機種など)では、はみ出さない
ようにここで頭を押さえます。

v204では0.72(72%)でした。**残りを曲名とアーティストの2行に使う**
ぶんだけを見込んだ値です。

⚠️ **v207で0.62に下げました。** アーティスト名の下に**ボタンの行が
   1つ増えた**ので、2行ぶんの余白では足りなくなったためです。
   足りないと、画面の低い端末でボタンが上半分からはみ出します。

⚠️ ふだんはこの上限に当たりません。3倍にした実際の大きさは上半分の
   6割くらいなので、**これは「画面が低い端末で崩れないための
   安全網」**です。普通の端末では竹弘の指定どおり、きっちり3倍で出ます。
*/
const JACKET_BIG_MAX_UPPER_RATIO = 0.62;

/*
画面の幅に対する上限です。

縦に長い端末では「上半分の72%」がそのまま横幅を超えることが
あります。正方形なので、**縦と横の両方で頭を押さえないと**
左右がはみ出します。
*/
const JACKET_BIG_MAX_WIDTH_RATIO = 0.86;


// ==========================================================
// 2. 画面の部品
// ==========================================================
const jacketPanelEl      = document.getElementById("jacket-panel");
const jacketBigEl        = document.getElementById("jacket-big");
const jacketBigTitleEl   = document.getElementById("jacket-big-title");
const jacketBigArtistEl  = document.getElementById("jacket-big-artist");

// ---- 差し替え機能の部品(v207で追加、v208で3ボタン化) ----
const jacketBtnOriginalEl = document.getElementById("jacket-btn-original");
const jacketBtnMyFileEl   = document.getElementById("jacket-btn-myfile");
const jacketBtnCameraEl   = document.getElementById("jacket-btn-camera");

// 撮った / 選んだ直後の確認ボタン(v208)
const jacketBigButtonsEl     = document.getElementById("jacket-big-buttons");
const jacketConfirmButtonsEl = document.getElementById("jacket-confirm-buttons");
const jacketBtnAcceptEl      = document.getElementById("jacket-btn-accept");
const jacketBtnRetryEl       = document.getElementById("jacket-btn-retry");
const jacketBtnCancelEl      = document.getElementById("jacket-btn-cancel");

// 見えないファイル選択(v208で2つに分けた)
const jacketMyFileInputEl = document.getElementById("jacket-myfile-input");
const jacketCameraInputEl = document.getElementById("jacket-camera-input");

/*
⚠️⚠️ **今どの曲を開いているかを、ここで覚えておきます(v207)。**

【なぜ currentTrackId を使ってはいけないのか】

『📷 差し替え』を押すとカメラアプリに切り替わり、竹弘が写真を
撮って戻ってくるまでに**何秒もかかります。** その間もノリRunは
鳴り続けているので、**曲が次に繋がっていることがあります。**

そこで currentTrackId を見て保存すると、**撮った写真が「今鳴って
いる別の曲」に付いてしまいます。** 画面には最初に開いた曲の名前が
出ているのに、中身は違う曲に書かれる ―― いちばん気づきにくい
種類の事故です。

だから「パネルを開いた時の曲」をここに控えておき、保存はその曲に
対して行います。
*/
let jacketViewTrackId = null;

/*
⚠️ **まだ保存していない画像を、ここで預かります(v208)。**

撮った(選んだ)直後は、すぐDBへ書かずに**この変数に置いたまま
ジャケット枠に映します。** 竹弘が ✓ を押して初めて保存します。

【なぜ即保存しないのか】

竹弘の当初案は「📷 を押したら『ジャケ写に設定する』『カメラで
撮影する』の2択」でした。その「設定する」という一手間が欲しい
感覚は正しく、**撮った瞬間に上書きされるのは怖い**からです。
ただ、それは押す前ではなく**撮った後**に置く方が自然で、
しかも「今ジャケットが何に設定されているか」に左右されません。

⚠️ 中身は**すでに480pxへ縮小済み**です。確認の段階で原寸を
   抱えておくと、大きな写真でメモリを無駄に使うためです。
*/
let jacketPendingBlob = null;

/*
その画像をどこから持ってきたか("camera" か "myfile")。
確認ボタンの真ん中を「📷 撮り直す」にするか「📁 選び直す」に
するかを決めるためだけに使います。
*/
let jacketPendingSource = "";

/*
上半分のエリアです。大きさの上限を決めるために、実際の高さを
測るのに使います。

⚠️ js/config.js には上半分そのものを指す変数が無かったので、
   ここで取っています。**#upper-area は検索モードで縮むことが
   あります**(v140)が、その時は曲一覧が上に来ているので
   ジャケットは押せません。だから測る時はいつも通常の高さです。
*/
const jacketUpperAreaEl = document.getElementById("upper-area");


// ==========================================================
// 3. 開く / 閉じる
// ==========================================================
/**
 * 再生中のジャケットを大きく表示します。
 *
 * ⚠️ **v207から、画像が無い曲でも開きます。**
 *    v206までは「画像が無ければ何もしない」でしたが、それだと
 *    **ジャケットが無い曲こそ差し替えられない**という逆さまなことに
 *    なります(竹弘の狙いは「画像がない曲や、お気に入りの曲について、
 *    写真を撮ってジャケを作れる楽しさ」)。
 *    無い曲は、代わりに薄いカメラアイコンを大きく出します。
 */
function openJacketView(){

    if(!jacketPanelEl || !currentTrackId){ return; }

    const track = libraryMap[currentTrackId];

    if(!track){ return; }

    /*
    ⚠️ 開いた時点の曲を控えます。以降この画面での保存は、
       **この曲**に対して行います(上の jacketViewTrackId の解説)。
    */
    jacketViewTrackId = currentTrackId;

    /*
    ---- 大きさを決めます ----

    今の枠を測って4倍にし、上半分の高さと画面の幅で頭を押さえます。

    ⚠️ **測るのは height です(width ではありません)。**
       この枠は align-self:stretch で「親の高さいっぱいの正方形」に
       なる作りなので(c014.html の .ua-jacket)、**高さが本物の
       大きさ**です。幅は中身によって変わることがあります。
    */
    const nowRect = npJacketEl.getBoundingClientRect();

    let size = nowRect.height * JACKET_BIG_SCALE;

    if(jacketUpperAreaEl){

        const upperRect = jacketUpperAreaEl.getBoundingClientRect();

        size = Math.min(size,upperRect.height * JACKET_BIG_MAX_UPPER_RATIO);

    }

    size = Math.min(size,window.innerWidth * JACKET_BIG_MAX_WIDTH_RATIO);

    jacketBigEl.style.width  = size + "px";
    jacketBigEl.style.height = size + "px";

    /*
    ⚠️ 前回の「確認中」を必ず持ち越さないようにします(v208)。
       撮ったまま閉じて別の曲で開くと、前の写真が映ったままに
       なってしまいます。
    */
    clearJacketPending();

    // ---- 中身(画像 / カメラアイコン)を入れます ----
    renderJacketBig(track);

    // ---- 曲名とアーティスト ----
    // buildTitleText() も js/list-view.js から借ります
    // (タイトルが空の曲ではファイル名を出してくれます)
    jacketBigTitleEl.textContent  = buildTitleText(track);
    jacketBigArtistEl.textContent = track.artist || "";

    // ---- ボタンの押せる / 押せないを決めます ----
    refreshJacketButtons(track);

    jacketPanelEl.style.display = "flex";

}


/**
 * 特大表示の中身(ジャケット画像、または薄いカメラ)を描きます。
 *
 * 開いた時と、差し替えた直後の両方から呼ばれます。
 *
 * @param {Object} track … 表示する曲
 */
function renderJacketBig(track){

    /*
    ⚠️ 毎回作り直します。使い回すと、曲が変わった時や差し替えた時に
       前の画像が残ります。
    */
    jacketBigEl.innerHTML = "";

    /*
    ---- どの画像を映すか ----

    ① まだ保存していない画像を預かっていれば、**それを優先**します
       (撮った直後の確認中。竹弘が ✓ を押すまでDBには入りません)
    ② それが無ければ getTrackCover()(js/list-view.js)に任せます
       (差し替えがあればそちら、無ければ元のジャケット)
    */
    const cover = jacketPendingBlob || getTrackCover(track);

    if(cover){

        /*
        createJacketImage()(js/list-view.js)を借ります。中で一時URLの
        後始末(onload / onerror で revokeObjectURL)までやってくれるので、
        こちらで覚えておく必要がありません。
        */
        const img = createJacketImage(cover);
        img.className = "jacket-big-img";

        jacketBigEl.appendChild(img);

        jacketBigEl.classList.remove("jacket-big-empty");

        return;

    }

    /*
    ---- まだジャケットが無い曲 ----

    大きなカメラアイコンを薄く置いて、「ここに作れる」ことを
    見せます。⚠️ 枠(縁取り)はテーマカラーのまま薄くしません
    (竹弘の「海色と暁色の縁取りは踏襲して欲しい」)。
    */
    const mark = document.createElement("span");
    mark.className = "jacket-big-empty-mark";
    mark.textContent = "📷";

    jacketBigEl.appendChild(mark);

    jacketBigEl.classList.add("jacket-big-empty");

}


/**
 * ボタンの見せ方を決めます(v208で3ボタン＋確認行に作り替え)。
 *
 * 画面には**2つの状態**があります。
 *
 *     ふつうの状態   🖼️ 📁 📷        … これから選ぶ
 *     確認中の状態   ✓ 📷/📁 ✕      … 撮った直後。保存する前
 *
 * どちらを出すかは jacketPendingBlob(預かり中の画像)があるかで
 * 決まります。**旗を別に持たない**のがこのアプリの流儀です
 * (旗とデータが食い違うと直しようがなくなるため)。
 *
 * ふつうの状態での「押せる / 押せない」:
 *
 *     曲の状態              🖼️ オリジナル        📁 📷
 *     ------------------   -----------------   -----
 *     元あり・差し替えなし   押せない(今それ)     押せる
 *     元あり・差し替えあり   押せる(元に戻る)     押せる
 *     元なし                押せない(戻る先が無い) 押せる
 *
 * ⚠️ 📁 と 📷 はいつでも押せます。何度やり直しても、元のジャケット
 *    (cover_art)には一切触れません。
 *
 * @param {Object} track … 表示中の曲
 */
function refreshJacketButtons(track){

    if(!jacketBigButtonsEl || !jacketConfirmButtonsEl){ return; }

    // ---- 確認中かどうかで、出すボタンの行を入れ替えます ----
    const confirming = !!jacketPendingBlob;

    jacketBigButtonsEl.style.display     = confirming ? "none" : "flex";
    jacketConfirmButtonsEl.style.display = confirming ? "flex" : "none";

    if(confirming){

        /*
        真ん中のボタンは「もう一度やる」です。どこから来たかで
        絵文字と説明を変えます(カメラから来たのに📁が出ると
        「別の物を選ばされる」ように見えるため)。
        */
        if(jacketBtnRetryEl){

            const fromCamera = (jacketPendingSource === "camera");

            jacketBtnRetryEl.textContent = fromCamera ? "📷" : "📁";
            jacketBtnRetryEl.title       = fromCamera ? "撮り直す" : "選び直す";

        }

        return;

    }

    // ---- ふつうの状態 ----
    if(!jacketBtnOriginalEl){ return; }

    const hasOriginal = !!(track && track.cover_art);
    const hasCustom   = !!(track && track.cover_art_custom);

    /*
    disabled は「このボタンは今押せません」という標準の印です。
    見た目は c014.html の :disabled のCSS(薄くする)が担当します。
    */
    jacketBtnOriginalEl.disabled = !(hasOriginal && hasCustom);

}


/**
 * 預かり中の画像を捨てます(確認をやめる / 画面を開き直す時)。
 */
function clearJacketPending(){

    jacketPendingBlob   = null;
    jacketPendingSource = "";

}

/**
 * 大きい表示を閉じます。
 */
function closeJacketView(){

    if(!jacketPanelEl){ return; }

    jacketPanelEl.style.display = "none";

    /*
    画像を捨てておきます。

    閉じている間ずっと持っている必要がないのと、次に開いた時は
    必ず作り直すためです。
    */
    jacketBigEl.innerHTML = "";
    jacketBigEl.classList.remove("jacket-big-empty");

    /*
    ⚠️ 「どの曲を開いていたか」も忘れます(v207)。

       残したままにすると、閉じた後にカメラから戻ってきた時などに
       **見ていない曲へ書き込んでしまう**恐れがあります。
       保存する側(handleJacketFileChosen)も、この値が無ければ
       何もしないようにしてあります。
    */
    jacketViewTrackId = null;

}


// ==========================================================
// 3-2. ジャケットの差し替え(v207)
// ==========================================================
/**
 * この画面が対象にしている曲を返します。
 *
 * ⚠️ currentTrackId ではなく jacketViewTrackId を見ます
 *    (理由はファイル上部の解説)。
 */
function getJacketViewTrack(){

    if(!jacketViewTrackId){ return null; }

    return libraryMap[jacketViewTrackId] || null;

}

/**
 * 差し替え / 元に戻す のあと、ジャケットを出している場所を全部
 * 描き直します。
 *
 * ⚠️ **ジャケットを映している場所は4つあります。**
 *    1つでも忘れると、そこだけ古い絵が残ります。
 *
 *        ① 特大表示(この画面そのもの)
 *        ② 曲一覧の行
 *        ③ 上半分の再生中表示
 *        ④ ロック画面(Media Session)
 *
 * ⚠️ ③と④は「今鳴っている曲」を映す場所なので、**差し替えた曲が
 *    今鳴っている時だけ**描き直します。裏で別の曲を編集していた
 *    場合に、鳴っている曲の表示を書き換えてしまわないためです。
 *
 * @param {Object} track … 差し替えた曲
 */
function refreshCoverEverywhere(track){

    // ① 特大表示
    renderJacketBig(track);
    refreshJacketButtons(track);

    // ② 曲一覧の行(js/list-view.js)
    refreshRow(track.track_id);

    // ③④ 今鳴っている曲だった時だけ
    if(track.track_id === currentTrackId){

        // 上半分のジャケットだけを描き直します(js/upper-area.js)
        refreshNowPlayingJacket(track);

        // ロック画面(js/media-session.js)
        updateMediaSessionMetadata(track);

    }

}

/**
 * 『📁 マイファイル』が押された時の処理です。
 *
 * 見えないファイル選択(#jacket-myfile-input)を代わりに押します。
 * capture が付いていないので、Androidの選択画面から写真フォルダを
 * たどって選べます。
 */
function startJacketFromMyFile(event){

    /*
    ⚠️ **この押下をパネルへ伝えません。**
       パネルは「どこを押しても閉じる」作りなので、これを書かないと
       ボタンを押した瞬間に画面が閉じます。
    */
    event.stopPropagation();

    jacketPendingSource = "myfile";

    if(jacketMyFileInputEl){ jacketMyFileInputEl.click(); }

}

/**
 * 『📷 カメラ』が押された時の処理です。
 *
 * #jacket-camera-input には capture="environment" が付いているので、
 * 選択画面をはさまず**いきなり外カメラ**が起動します
 * (竹弘:「📷ボタンを押したら、スマホには必ずカメラが付いているので」)。
 *
 * ⚠️ **v209でここをアプリ内カメラに差し替えます。** 竹弘の本来の
 *    希望は「ジャケ写の表示範囲に外カメラの撮影中映像をリアルで
 *    表示してキャプチャ」です。取り込んだ後の流れ(確認 → ✓ で保存)は
 *    そのまま使えるので、**差し替えるのはこの関数だけ**で済みます。
 */
function startJacketFromCamera(event){

    event.stopPropagation();

    jacketPendingSource = "camera";

    if(jacketCameraInputEl){ jacketCameraInputEl.click(); }

}

/**
 * 『もう一度』(確認中の真ん中のボタン)が押された時の処理です。
 *
 * 来た道と同じ方へ戻します。
 */
function retryJacketSource(event){

    event.stopPropagation();

    if(jacketPendingSource === "camera"){

        if(jacketCameraInputEl){ jacketCameraInputEl.click(); }

    }
    else{

        if(jacketMyFileInputEl){ jacketMyFileInputEl.click(); }

    }

}

/**
 * 『✕ やめる』が押された時の処理です。
 *
 * 預かっていた画像を捨てて、元の表示に戻します。
 * **DBには何も書いていない**ので、捨てるだけで元通りです。
 */
function cancelJacketPending(event){

    event.stopPropagation();

    clearJacketPending();

    const track = getJacketViewTrack();

    if(!track){ return; }

    renderJacketBig(track);
    refreshJacketButtons(track);

}

/**
 * 写真が選ばれた(または撮られた)時の処理です。
 *
 * ⚠️ **ここではまだDBに書きません。** 480pxに縮小して預かり、
 *    ジャケット枠に映して竹弘に見てもらいます。保存するのは
 *    ✓ が押された時(applyJacketPending)です。
 */
async function handleJacketFileChosen(event){

    const file = event.target.files && event.target.files[0];

    /*
    ⚠️ **選んだ内容を必ず空に戻します。**
       同じ写真をもう一度選んだ時、値が残っていると「変わっていない」
       と判断されて change が起きず、**2回目から反応しなくなります。**
    */
    event.target.value = "";

    if(!file){ return; }

    const track = getJacketViewTrack();

    if(!track){
        console.error("ジャケット取り込み中止 : 対象の曲が分かりません");
        return;
    }

    try{

        /*
        ---- 480px角のJPEGに縮小します ----

        shrinkImageBlob() は js/metadata.js の関数で、**埋め込み
        ジャケットを取り込む時とまったく同じもの**です。中央を正方形に
        切り取ってから縮小するので、4:3のスマホ写真でも歪みません。

        ⚠️ **同じ関数・同じ定数を通すことに意味があります。**
           竹弘の指定「1曲あたりのファイルサイズが大きくならないように、
           取込時に解像度を今のジャケ写サイズに解像度変更は絶対して
           取り込んで欲しい」に対して、ここに別の数字を書くと、将来
           COVER_ART_SIZE を変えた時に**ここだけ古いサイズのまま**
           残ります。

        スマホの写真は4000×3000(1200万画素)ほどありますが、
        480px角にすると約1/26になり、他のジャケットと同じ
        数十KBに収まります。

        ⚠️ **縮小は「確認の前」にやります。** 後回しにすると、
           確認している間ずっと1200万画素を抱えることになります。
        */
        const blob = await shrinkImageBlob(
            file,
            COVER_ART_SIZE,
            COVER_ART_QUALITY
        );

        if(!blob){
            console.error("ジャケット取り込み中止 : 画像を読めませんでした");
            return;
        }

        // ---- まだ保存せず、預かって映します ----
        jacketPendingBlob = blob;

        renderJacketBig(track);
        refreshJacketButtons(track);

        console.log(
            "ジャケット候補を取り込みました :",
            track.file_name,
            Math.round(blob.size / 1024) + "KB",
            "(まだ保存していません)"
        );

    }
    catch(error){

        console.error(
            "ジャケット取り込み失敗 :",
            error.name,
            error.message
        );

    }

}

/**
 * 『✓ 決定』が押された時の処理です。
 *
 * 預かっていた画像を、はじめてDBへ保存します。
 */
async function applyJacketPending(event){

    event.stopPropagation();

    const track = getJacketViewTrack();

    if(!track || !jacketPendingBlob){ return; }

    const blob = jacketPendingBlob;

    try{

        /*
        ⚠️⚠️ **cover_art(元のジャケット)には一切触りません。**
           竹弘の指定「もともとあるジャケ写は上書きしない」。
           差し替えは cover_art_custom という別の場所に入れるので、
           何度撮り直しても元の絵は無傷で残ります。
        */
        track.cover_art_custom = blob;

        await idbPut(STORE_MUSIC,track);

        // 保存できたので、預かりは終わりです
        clearJacketPending();

        refreshCoverEverywhere(track);

        console.log(
            "ジャケットを差し替えました :",
            track.file_name,
            Math.round(blob.size / 1024) + "KB"
        );

    }
    catch(error){

        console.error(
            "ジャケットの保存に失敗 :",
            error.name,
            error.message
        );

    }

}

/**
 * 『オリジナルジャケット』が押された時の処理です。
 *
 * 差し替えを**消す**だけで元に戻ります。getTrackCover() が
 * 「差し替えが無ければ cover_art」を返すためで、「今どちらを
 * 表示中か」という旗を別に持つ必要がありません。
 */
async function restoreOriginalJacket(event){

    // ⚠️ パネルが閉じないように(startJacketReplace と同じ理由)
    event.stopPropagation();

    const track = getJacketViewTrack();

    if(!track || !track.cover_art_custom){ return; }

    // 確認中の画像が残っていたら捨てます(元に戻すのが目的のため)
    clearJacketPending();

    try{

        /*
        delete は「そのフィールドごと消す」命令です。
        null を入れるのではなく消しているのは、DBに使われない項目を
        残さないためです(cover_art_custom が無い曲=差し替えていない曲、
        という見分けがそのまま付きます)。
        */
        delete track.cover_art_custom;

        await idbPut(STORE_MUSIC,track);

        refreshCoverEverywhere(track);

        console.log("オリジナルのジャケットに戻しました :",track.file_name);

    }
    catch(error){

        console.error(
            "オリジナルへの復帰に失敗 :",
            error.name,
            error.message
        );

    }

}


// ==========================================================
// 4. 受け口
// ==========================================================
/*
⚠️ **上半分の枠(#np-jacket)に、ここで直接タップを付けます。**

js/upper-area.js は曲が変わるたびに枠の**中身**(innerHTML)を
入れ替えますが、**枠そのものは作り直しません。** だから起動時に
1回付けるだけで、どの曲でも効きます。

こうすることで、**完成している js/upper-area.js を1文字も
書き換えずに済みます**(デグレ防止のいちばん確実な形)。
*/
if(npJacketEl){

    npJacketEl.addEventListener("click",openJacketView);

}

/*
竹弘の指定:「どこをタップしても閉じる」。

パネル全体で受けているので、画像の上でも余白でも閉じます。

⚠️⚠️ **この作りのせいで、パネルの中に「押せるもの」を足す時は
   必ず stopPropagation() が要ります**(押下がここまで上がってきて
   画面が閉じてしまうため)。v207で足したボタン2つは、それぞれの
   処理の先頭で止めてあります。**次に何か足す人も忘れないこと。**
*/
if(jacketPanelEl){

    jacketPanelEl.addEventListener("click",closeJacketView);

}

/*
ジャケット差し替えの受け口(v207で新設、v208で3ボタン＋確認に)。

⚠️ **どのボタンの処理も先頭で stopPropagation() を呼んでいます。**
   1つでも忘れると、そのボタンを押した瞬間に画面が閉じます。
*/
if(jacketBtnOriginalEl){
    jacketBtnOriginalEl.addEventListener("click",restoreOriginalJacket);
}

if(jacketBtnMyFileEl){
    jacketBtnMyFileEl.addEventListener("click",startJacketFromMyFile);
}

if(jacketBtnCameraEl){
    jacketBtnCameraEl.addEventListener("click",startJacketFromCamera);
}

// ---- 確認中の3つ ----
if(jacketBtnAcceptEl){
    jacketBtnAcceptEl.addEventListener("click",applyJacketPending);
}

if(jacketBtnRetryEl){
    jacketBtnRetryEl.addEventListener("click",retryJacketSource);
}

if(jacketBtnCancelEl){
    jacketBtnCancelEl.addEventListener("click",cancelJacketPending);
}

/*
見えないファイル選択の受け口。

"change" は「選んだ内容が変わった」時に起きる合図です。
カメラで撮った直後も、写真フォルダから選んだ直後も、ここへ来ます。
**2つとも同じ処理**へ繋ぎます(受け取った後にやることは同じで、
違うのは「どこから来たか」だけ。それは jacketPendingSource が
覚えています)。

⚠️ カメラを使っている間、ノリRunは裏に回ります。**音は鳴り続けます**
   (2デッキ構造で音が途切れないため)が、戻ってくるまでに曲が次へ
   繋がっていることがあります。だから保存先は currentTrackId ではなく
   jacketViewTrackId です(ファイル上部の解説)。
*/
if(jacketMyFileInputEl){
    jacketMyFileInputEl.addEventListener("change",handleJacketFileChosen);
}

if(jacketCameraInputEl){
    jacketCameraInputEl.addEventListener("change",handleJacketFileChosen);
}
