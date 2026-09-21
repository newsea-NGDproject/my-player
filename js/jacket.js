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

// アートワークの選び直しと、上書きの確認(v210)
const jacketArtworkButtonsEl   = document.getElementById("jacket-artwork-buttons");
const jacketOverwriteButtonsEl = document.getElementById("jacket-overwrite-buttons");
const jacketBtnOverwriteEl     = document.getElementById("jacket-btn-overwrite");
const jacketBtnOverwriteCancelEl = document.getElementById("jacket-btn-overwrite-cancel");
const jacketWarningEl          = document.getElementById("jacket-warning");

// アプリ内カメラ(v212)
const jacketCameraButtonsEl    = document.getElementById("jacket-camera-buttons");
const jacketBtnShootEl         = document.getElementById("jacket-btn-shoot");
const jacketBtnCameraCancelEl  = document.getElementById("jacket-btn-camera-cancel");

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
⚠️ **この画面が今どのボタンの行を出しているか(v210)。**

    "normal"    🖼️ 📁 📷              ふつう
    "confirm"   ✓/⚠️ 📷 ✕            撮った / 選んだ直後
    "artwork"   [元][自作] ✕          アートワークの選び直し
    "overwrite" 🗑️ ✕ + 赤い注意書き   上書きの最終確認

【なぜ状態を変数で持つのか】

v207では「旗を持たない(データだけで決める)」方針を書きましたが、
あれは**どの画像を見せるか**という"データ"の話です。
こちらは**画面がどの段階にいるか**という別の話で、データからは
決められません(「アートワークの選び直しを開いているか」は、
どこにも書かれていないため)。

⚠️ **代わりに、出す行を決める場所を refreshJacketButtons() の
   1か所だけにしてあります。** あちこちで display を触ると、
   「2つの行が同時に出る」という事故が必ず起きます。
*/
let jacketUiState = "normal";

/*
⚠️ **動いているカメラ(v212)。**

getUserMedia() が返す「映像の流れ」です。**使い終わったら必ず
止めます**(stopLiveCamera)。止め忘れると、画面を閉じても
カメラのランプが点いたままになり、電池を食い続けます。

⚠️ ノリRunは走りながら使うアプリなので、**電池の食い逃げは
   特に困ります。** 止める場所は4つあります:
   撮った時 / ✕ / 画面を閉じた時 / 画面を開き直した時(念のため)。
*/
let jacketCameraStream = null;

/*
⚠️ **今カメラを使いたいかどうか(v212)。**

カメラの許可を聞いている間に竹弘が ✕ を押すことがあります。
その後で許可が下りると、**誰も見ていないのにカメラが動き出します。**
この旗を見て、いらなくなっていたらすぐ止めます。
*/
let jacketCameraWanted = false;

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
    ⚠️⚠️ **ボタン行にも同じ幅を入れます(v209で追加)。**

    竹弘の実機報告(v208):
        「ジャケ幅ではなく、曲名もしくはアーティスト名、ファイル名で
          幅が決まっている。ボタン3つは、ジャケ幅に合わせて欲しい」

    CSSの width:100% は「親の幅」ですが、その親
    (#jacket-panel-inner)は**中でいちばん広い部品に合わせて広がる**
    ので、長い曲名があると親ごと広がり、ボタンもそれに付き合って
    いました。

    → ここでジャケットと**まったく同じ数字**を渡します。
      上で計算した size をそのまま使うので、**2か所で別々に
      計算することはありません**(片方だけ直す事故が起きない)。

    ⚠️ 曲名・アーティスト名の幅は今のままでOK(竹弘の指定)。
       揃えるのはボタンだけです。
    */
    const buttonRows = [
        jacketBigButtonsEl,
        jacketConfirmButtonsEl,
        jacketArtworkButtonsEl,
        jacketOverwriteButtonsEl,
        jacketCameraButtonsEl
    ];

    for(const row of buttonRows){
        if(row){ row.style.width = size + "px"; }
    }

    /*
    注意書きもジャケット幅に収めます。はみ出すと、パネル全体が
    そのぶん広がってボタンまで巻き添えになります。
    */
    if(jacketWarningEl){
        jacketWarningEl.style.width = size + "px";
    }

    /*
    ⚠️ 前回の「確認中」を必ず持ち越さないようにします(v208)。
       撮ったまま閉じて別の曲で開くと、前の写真が映ったままに
       なってしまいます。
    */
    clearJacketPending();

    /*
    ⚠️ カメラが動いたままだったら止めます(v212の念のため)。
       ふつうは閉じる時に止まっていますが、止める場所が1つでも
       抜けるとカメラが点いたままになるので、開く時にも確認します。
    */
    stopLiveCamera();

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
    ⚠️ カメラ用の見た目(黒い背景)を必ず外します(v212)。
       残っていると、写真を出しているのに枠が黒いままになります。
    */
    jacketBigEl.classList.remove("jacket-big-live");

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

    /*
    ---- 出す行を1つだけ決めます ----

    ⚠️ **display を触るのはこの4行だけ**にしてあります。
       他の場所から個別に触ると「2つの行が同時に出る」事故が
       必ず起きます。
    */
    setRowVisible(jacketBigButtonsEl,      jacketUiState === "normal");
    setRowVisible(jacketConfirmButtonsEl,  jacketUiState === "confirm");
    setRowVisible(jacketArtworkButtonsEl,  jacketUiState === "artwork");
    setRowVisible(jacketOverwriteButtonsEl,jacketUiState === "overwrite");
    setRowVisible(jacketCameraButtonsEl,   jacketUiState === "camera");

    const hasOriginal = !!(track && track.cover_art);
    const hasCustom   = !!(track && track.cover_art_custom);

    // ---- 撮った / 選んだ直後 ----
    if(jacketUiState === "confirm"){

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

        /*
        ⚠️ **すでに自作ジャケットがある時は ✓ ではなく ⚠️ にします**
           (v210、竹弘の指定)。自作の置き場所は1つしかないので、
           決定すると**前に作ったものが消えます。**

           押す前から「これは上書きだ」と分かるようにしておき、
           ⚠️ を押した時に最終確認("overwrite"の行)へ進みます。
        */
        if(jacketBtnAcceptEl){

            jacketBtnAcceptEl.textContent = hasCustom ? "⚠️" : "✓";

            jacketBtnAcceptEl.title = hasCustom
                ? "今の自作ジャケットに上書きする"
                : "この写真をジャケットにする";

        }

        hideJacketWarning();

        return;

    }

    // ---- 上書きの最終確認 ----
    if(jacketUiState === "overwrite"){

        showJacketWarning("今の自作ジャケットは消えます。上書きしますか?");

        return;

    }

    hideJacketWarning();

    // ---- カメラで撮っている最中 ----
    if(jacketUiState === "camera"){

        // 出すものは openLiveCamera() 側が用意するので、ここでは何もしません
        return;

    }

    // ---- アートワークの選び直し ----
    if(jacketUiState === "artwork"){

        renderArtworkChoices(track);

        return;

    }

    // ---- ふつうの状態 ----
    if(!jacketBtnOriginalEl){ return; }

    /*
    ⚠️ 🖼️ が押せるのは **選べる絵が2つある時だけ**(v210)。

       v209までは「元に戻せる時だけ」でしたが、v210で役割が
       「オリジナルに戻す」から「**どちらを使うか選ぶ**」に
       変わりました。1つしか無ければ選びようがないので押せません。

    見た目は c014.html の :disabled のCSS(背景は不透明のまま、
    縁を灰色に、絵文字だけ薄く)が担当します。
    */
    jacketBtnOriginalEl.disabled = !(hasOriginal && hasCustom);

}


/**
 * ボタンの行を出す / 隠すだけの小さな部品です。
 *
 * flex で並べているので、出す時は "flex" に戻す必要があります
 * ("block" にすると横並びが崩れます)。
 */
function setRowVisible(rowEl,visible){

    if(!rowEl){ return; }

    rowEl.style.display = visible ? "flex" : "none";

}

/** 赤い注意書きを出します。 */
function showJacketWarning(text){

    if(!jacketWarningEl){ return; }

    jacketWarningEl.textContent   = text;
    jacketWarningEl.style.display = "block";

}

/** 赤い注意書きを消します。 */
function hideJacketWarning(){

    if(!jacketWarningEl){ return; }

    jacketWarningEl.style.display = "none";

}


/**
 * アートワークの選び直しの中身(最大2つ)を作ります(v210)。
 *
 * 竹弘の指定:
 *     「ノリRunDBにある最大2つジャケ写(オリジナルとそれ以外)の
 *       ボタンを表示してもらい、ボタンのサイズの中で、ジャケ写を表示」
 *
 * ⚠️ 今選ばれている方には .jacket-artwork-on を付けて、内側に
 *    テーマ色の線を出します(枠を太くすると中の画像がガタつくため)。
 *
 * @param {Object} track … 表示中の曲
 */
function renderArtworkChoices(track){

    if(!jacketArtworkButtonsEl){ return; }

    jacketArtworkButtonsEl.innerHTML = "";

    if(!track){ return; }

    // 今どちらが使われているか(getTrackCover と同じ判断)
    const usingOriginal = (track.cover_art_use === "original" && track.cover_art);

    /*
    候補は最大2つです。持っていない方は並べません
    (押せないボタンを置いても選びようがないため)。
    */
    const choices = [
        {blob:track.cover_art,        use:"original", label:"元のジャケット"},
        {blob:track.cover_art_custom, use:"custom",   label:"自分で作ったジャケット"}
    ];

    for(const choice of choices){

        if(!choice.blob){ continue; }

        const button = document.createElement("button");
        button.type  = "button";
        button.title = choice.label;

        /*
        createJacketImage()(js/list-view.js)を借ります。一時URLの
        後始末まで面倒を見てくれるので、こちらで覚える必要がありません。
        */
        const img = createJacketImage(choice.blob);
        img.className = "jacket-artwork-thumb";

        button.appendChild(img);

        // 今使われている方に印を付けます
        const isOn = (choice.use === "original") ? usingOriginal : !usingOriginal;

        if(isOn){ button.classList.add("jacket-artwork-on"); }

        /*
        ⚠️ ここでも stopPropagation が要ります(パネルは
           「どこを押しても閉じる」作りのため)。
        */
        button.addEventListener("click",function(event){
            event.stopPropagation();
            chooseArtwork(choice.use);
        });

        jacketArtworkButtonsEl.appendChild(button);

    }

    /*
    最後に「やめる」を置きます。開いたけれど変えたくない、という
    時に閉じられないと困るためです。
    */
    const closeButton = document.createElement("button");
    closeButton.type        = "button";
    closeButton.title       = "やめる";
    closeButton.textContent = "✕";

    closeButton.addEventListener("click",function(event){
        event.stopPropagation();
        jacketUiState = "normal";
        refreshJacketButtons(getJacketViewTrack());
    });

    jacketArtworkButtonsEl.appendChild(closeButton);

}


/**
 * 預かり中の画像を捨てます(確認をやめる / 画面を開き直す時)。
 */
function clearJacketPending(){

    jacketPendingBlob   = null;
    jacketPendingSource = "";

    /*
    ⚠️ 画面の段階も「ふつう」へ戻します(v210)。預かりを捨てたのに
       確認の行が出たままだと、押しても何も起きないボタンが
       画面に残ります。
    */
    jacketUiState = "normal";

}

/**
 * 大きい表示を閉じます。
 */
function closeJacketView(){

    if(!jacketPanelEl){ return; }

    jacketPanelEl.style.display = "none";

    /*
    ⚠️⚠️ **カメラを必ず止めます(v212)。** ここを忘れると、画面を
       閉じてもカメラのランプが点いたままになり、電池を食い続けます。
       走りながら使うアプリなので、電池の食い逃げは特に困ります。
    */
    stopLiveCamera();

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
 * 『📷 カメラ』が押された時の処理です(v212でアプリ内カメラに)。
 *
 * 竹弘の希望:
 *     「ジャケ写の表示範囲の所に外カメラの撮影中映像をリアルで表示し
 *       (解像度はジャケ画像と同じ)、ジャケットをキャプチャしたい」
 *
 * ⚠️ v208〜v211はスマホ標準のカメラアプリを呼んでいました。
 *    取り込んだ後の流れ(確認 → ✓ で保存)は同じものを使うので、
 *    **差し替えたのはこの関数と、下のカメラ一式だけ**です。
 */
function startJacketFromCamera(event){

    event.stopPropagation();

    jacketPendingSource = "camera";

    openLiveCamera();

}


// ==========================================================
// 3-3. アプリ内カメラ(v212)
// ==========================================================
/**
 * ジャケット枠に、外カメラの映像を流し始めます。
 *
 * ⚠️⚠️ **必ず逃げ道を用意してあります。** カメラが使えない場合
 *    (許可されなかった / カメラが無い / 安全な接続でない)は、
 *    **スマホ標準のカメラアプリに切り替えます。**
 *    走っている最中に「押しても何も起きない」が一番困るためです
 *    (v203で学んだ「待つ処理には必ず時間切れを用意する」と同じ考え方)。
 */
async function openLiveCamera(){

    const track = getJacketViewTrack();

    if(!track){ return; }

    jacketCameraWanted = true;
    jacketUiState      = "camera";

    // 先に画面を切り替えて、「押したのに無反応」を無くします
    showLiveMessage("カメラを準備しています…");
    refreshJacketButtons(track);

    /*
    navigator.mediaDevices は、**安全な接続(https)でないと存在しません。**
    GitHub Pages は https なので本番では使えますが、手元のファイルを
    直接開いた時などに落ちないよう確かめておきます。
    */
    if(!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){

        console.log("アプリ内カメラが使えないので、標準のカメラアプリに切り替えます");
        fallbackToCameraApp();
        return;

    }

    try{

        /*
        ---- カメラを借ります ----

        facingMode:"environment" は**外カメラ**(画面と反対側)です。
        ジャケットは目の前のものを撮るので外カメラが自然です。

        ⚠️ **ideal にしています。** exact にすると、外カメラが無い端末で
           エラーになって何も映りません。ideal なら「できれば外、
           無ければ内」と譲ってくれます。

        ⚠️⚠️ **audio:false を必ず書きます。** 書かないつもりでも、
           マイクを一緒に借りてしまうと**音楽の再生が止まる恐れ**が
           あります。ノリRunは走行中に鳴り続けることが最優先なので、
           映像だけを借ります。
        */
        const stream = await navigator.mediaDevices.getUserMedia({
            video:{ facingMode:{ ideal:"environment" } },
            audio:false
        });

        /*
        ⚠️ 許可を待っている間に ✕ が押されているかもしれません。
           その場合は**すぐ返します**(誰も見ていないのにカメラが
           動き続けるのを防ぐため)。
        */
        if(!jacketCameraWanted){

            stopStreamTracks(stream);
            return;

        }

        jacketCameraStream = stream;

        showLiveVideo(stream);

    }
    catch(error){

        console.log(
            "アプリ内カメラを開けませんでした :",
            error.name,
            "→ 標準のカメラアプリに切り替えます"
        );

        fallbackToCameraApp();

    }

}

/**
 * アプリ内カメラが使えない時に、スマホ標準のカメラアプリへ逃がします。
 */
function fallbackToCameraApp(){

    stopLiveCamera();

    jacketUiState = "normal";

    const track = getJacketViewTrack();

    renderJacketBig(track);
    refreshJacketButtons(track);

    if(jacketCameraInputEl){ jacketCameraInputEl.click(); }

}

/**
 * ジャケット枠に文字だけを出します(準備中の案内など)。
 */
function showLiveMessage(text){

    if(!jacketBigEl){ return; }

    jacketBigEl.innerHTML = "";

    jacketBigEl.classList.remove("jacket-big-empty");
    jacketBigEl.classList.add("jacket-big-live");

    const message = document.createElement("div");
    message.className   = "jacket-live-message";
    message.textContent = text;

    jacketBigEl.appendChild(message);

}

/**
 * ジャケット枠に、カメラの映像を流します。
 */
function showLiveVideo(stream){

    if(!jacketBigEl){ return; }

    jacketBigEl.innerHTML = "";

    jacketBigEl.classList.remove("jacket-big-empty");
    jacketBigEl.classList.add("jacket-big-live");

    const video = document.createElement("video");
    video.className = "jacket-live-video";

    /*
    ⚠️ **playsInline は必須です。** これが無いと、Androidや
       iPhoneで映像が**画面いっぱいに乗っ取られ**、ジャケット枠の
       中に収まりません。

    ⚠️ muted も付けます。音は借りていない(audio:false)ので
       鳴るものはありませんが、付けておかないと自動再生が
       ブラウザに止められることがあります。
    */
    video.playsInline = true;
    video.muted       = true;
    video.autoplay    = true;

    video.srcObject = stream;

    jacketBigEl.appendChild(video);

    /*
    play() は約束(Promise)を返し、失敗することがあります。
    ここで落としてもカメラが止まらず残るだけなので、握りつぶさずに
    記録だけしておきます。
    */
    const playPromise = video.play();

    if(playPromise && typeof playPromise.catch === "function"){

        playPromise.catch(function(error){
            console.log("カメラ映像の再生に失敗 :",error.name);
        });

    }

}

/**
 * 映像の流れを止めます(カメラのランプを消すための後始末)。
 */
function stopStreamTracks(stream){

    if(!stream || typeof stream.getTracks !== "function"){ return; }

    for(const track of stream.getTracks()){
        track.stop();
    }

}

/**
 * アプリ内カメラを完全に止めます。
 *
 * ⚠️ **呼ぶ場所は5つ**:撮った時 / ✕ / 画面を閉じた時 /
 *    画面を開き直した時(念のため)/ 標準カメラへ逃がす時。
 *    どれか1つでも抜けると、カメラが点いたままになります。
 */
function stopLiveCamera(){

    jacketCameraWanted = false;

    if(jacketCameraStream){

        stopStreamTracks(jacketCameraStream);
        jacketCameraStream = null;

    }

}

/**
 * 『✕』(カメラ中)が押された時の処理です。
 */
function cancelLiveCamera(event){

    event.stopPropagation();

    stopLiveCamera();

    jacketUiState = "normal";

    const track = getJacketViewTrack();

    renderJacketBig(track);
    refreshJacketButtons(track);

}

/**
 * 『📸』が押された時の処理です。今映っている瞬間を切り取ります。
 *
 * ⚠️⚠️ **切り取る大きさと画質は、他の取り込みとまったく同じ定数**
 *    (COVER_ART_SIZE / COVER_ART_QUALITY)を使います。竹弘の指定
 *    「1曲あたりのファイルサイズが大きくならないように、取込時に
 *      解像度を今のジャケ写サイズに解像度変更は絶対して欲しい」。
 *
 * ⚠️ shrinkImageBlob()(js/metadata.js)を通していないのは、あちらが
 *    **ファイル(Blob)を受け取る**作りで、映像のひとコマは渡せない
 *    ためです。**やっていること(中央を正方形に切り取って縮小)は
 *    同じ**で、数字も同じ定数を見ています。いったんJPEGにしてから
 *    もう一度縮めると、二重に画質が落ちるので直接描いています。
 */
function shootFromLiveCamera(event){

    event.stopPropagation();

    const track = getJacketViewTrack();
    const video = jacketBigEl ? jacketBigEl.querySelector("video") : null;

    if(!track || !video){ return; }

    /*
    videoWidth は「映像の本当の大きさ」です。カメラが動き出す前は
    0 なので、その時は何もしません(0で切り取ると真っ黒になります)。
    */
    if(!video.videoWidth || !video.videoHeight){

        console.log("まだカメラの映像が来ていません");
        return;

    }

    try{

        const canvas = document.createElement("canvas");
        canvas.width  = COVER_ART_SIZE;
        canvas.height = COVER_ART_SIZE;

        const context = canvas.getContext("2d");

        /*
        ---- 中央を正方形に切り取ります ----

        画面では object-fit:cover で「中央の正方形」だけが見えて
        いるので、**同じ場所を切り出せば見たまま**が保存されます。
        */
        const side = Math.min(video.videoWidth,video.videoHeight);
        const sourceX = (video.videoWidth  - side) / 2;
        const sourceY = (video.videoHeight - side) / 2;

        context.drawImage(
            video,
            sourceX,sourceY,side,side,
            0,0,COVER_ART_SIZE,COVER_ART_SIZE
        );

        // 撮ったのでカメラは止めます(ランプを消す)
        stopLiveCamera();

        canvas.toBlob(function(blob){

            if(!blob){
                console.error("撮影に失敗しました");
                cancelLiveCamera({stopPropagation:function(){}});
                return;
            }

            // ---- ここから先は 📁 と同じ流れです ----
            jacketPendingBlob   = blob;
            jacketPendingSource = "camera";
            jacketUiState       = "confirm";

            renderJacketBig(track);
            refreshJacketButtons(track);

            console.log(
                "カメラで撮りました :",
                track.file_name,
                Math.round(blob.size / 1024) + "KB",
                "(まだ保存していません)"
            );

        },"image/jpeg",COVER_ART_QUALITY);

    }
    catch(error){

        console.error("撮影に失敗 :",error.name,error.message);

        cancelLiveCamera({stopPropagation:function(){}});

    }

}

/**
 * 『もう一度』(確認中の真ん中のボタン)が押された時の処理です。
 *
 * 来た道と同じ方へ戻します。
 */
function retryJacketSource(event){

    event.stopPropagation();

    if(jacketPendingSource === "camera"){

        /*
        ⚠️ v212から、カメラは**アプリ内の生映像**に戻します
           (標準のカメラアプリではありません)。撮り直しのたびに
           別の撮り方になると、竹弘が戸惑うためです。
        */
        openLiveCamera();

        return;

    }

    if(jacketMyFileInputEl){ jacketMyFileInputEl.click(); }

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

    jacketUiState = "normal";

    const track = getJacketViewTrack();

    if(!track){ return; }

    renderJacketBig(track);
    refreshJacketButtons(track);

}

/**
 * 確認中の ✓ / ⚠️ が押された時の入口です(v210)。
 *
 * すでに自作ジャケットがある(＝上書きになる)なら、**もう一段だけ**
 * 確認をはさみます。無ければそのまま保存します。
 *
 * ⚠️ ブラウザ標準の confirm() は使いません。押されるまでJavaScriptが
 *    止まり、走行中だと曲の接続やノリノリアシストの予約まで
 *    巻き添えで止まるためです(js/queue.js の解説、v110の判断)。
 */
function acceptJacketPending(event){

    event.stopPropagation();

    const track = getJacketViewTrack();

    if(!track || !jacketPendingBlob){ return; }

    if(track.cover_art_custom){

        // 上書きになるので、赤い注意書きを出して1回だけ確認します
        jacketUiState = "overwrite";

        refreshJacketButtons(track);

        return;

    }

    applyJacketPending();

}

/**
 * 上書き確認の『✕ やめる』です。撮った写真は捨てずに、
 * 1つ前(確認中)へ戻します。
 */
function cancelJacketOverwrite(event){

    event.stopPropagation();

    jacketUiState = "confirm";

    refreshJacketButtons(getJacketViewTrack());

}

/**
 * 上書き確認の『🗑️ 上書きする』です。
 */
function confirmJacketOverwrite(event){

    event.stopPropagation();

    applyJacketPending();

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

        jacketUiState = "confirm";

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
 * 預かっていた画像を、はじめてDBへ保存します。
 *
 * ⚠️ ボタンから直接は呼びません。必ず acceptJacketPending()
 *    (上書きになるかを見る係)か、上書き確認の 🗑️ から呼ばれます。
 */
async function applyJacketPending(){

    const track = getJacketViewTrack();

    if(!track || !jacketPendingBlob){ return; }

    const blob = jacketPendingBlob;

    try{

        /*
        ⚠️⚠️ **cover_art(元のジャケット)には一切触りません。**
           竹弘の指定「もともとあるジャケ写は上書きしない」。
           差し替えは cover_art_custom という別の場所に入れるので、
           何度撮り直しても元の絵は無傷で残ります。

        ⚠️ 一方 cover_art_custom は**1つしか持ちません。** だから
           ここへ来る前に上書き確認をはさんでいます(v210)。
        */
        track.cover_art_custom = blob;

        /*
        ⚠️ 作ったばかりの絵を見せないと意味がないので、旗も
           「自作を使う」に倒します(v210)。元のジャケットを見ている
           最中に撮った場合でも、撮った直後はそれが出ます。
        */
        track.cover_art_use = "custom";

        await idbPut(STORE_MUSIC,track);

        // 保存できたので、預かりは終わりです
        clearJacketPending();

        jacketUiState = "normal";

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
 * 🖼️ 『アートワーク』が押された時の処理です(v210で役割を変更)。
 *
 * ⚠️ **v209までは「オリジナルに戻す(＝自作を削除する)」でした。**
 *    竹弘の指摘「オリジナルに戻すとカメラ写真を破棄してしまう」を
 *    受けて、**消さずに選び直す**形に変えました。
 *
 * ここでは選び直しの行を開くだけで、DBには何も書きません。
 */
function openArtworkChoices(event){

    // ⚠️ パネルが閉じないように
    event.stopPropagation();

    jacketUiState = "artwork";

    refreshJacketButtons(getJacketViewTrack());

}

/**
 * アートワークの候補が選ばれた時の処理です(v210)。
 *
 * ⚠️⚠️ **どちらの画像も消しません。** 「どちらを使うか」の旗
 *    (cover_art_use)を書き換えるだけです。だから何度でも
 *    行ったり来たりできます ―― これが竹弘の求めていた
 *    「オリジナルに戻した後、さらに前回の設定に簡単に戻せる」です。
 *
 * @param {String} use … "original" か "custom"
 */
async function chooseArtwork(use){

    const track = getJacketViewTrack();

    if(!track){ return; }

    try{

        track.cover_art_use = use;

        await idbPut(STORE_MUSIC,track);

        jacketUiState = "normal";

        refreshCoverEverywhere(track);

        console.log(
            "ジャケットを切り替えました :",
            track.file_name,
            use === "original" ? "元のジャケット" : "自分で作ったジャケット"
        );

    }
    catch(error){

        console.error(
            "ジャケットの切り替えに失敗 :",
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
    jacketBtnOriginalEl.addEventListener("click",openArtworkChoices);
}

if(jacketBtnMyFileEl){
    jacketBtnMyFileEl.addEventListener("click",startJacketFromMyFile);
}

if(jacketBtnCameraEl){
    jacketBtnCameraEl.addEventListener("click",startJacketFromCamera);
}

// ---- 確認中の3つ ----
if(jacketBtnAcceptEl){
    jacketBtnAcceptEl.addEventListener("click",acceptJacketPending);
}

if(jacketBtnRetryEl){
    jacketBtnRetryEl.addEventListener("click",retryJacketSource);
}

if(jacketBtnCancelEl){
    jacketBtnCancelEl.addEventListener("click",cancelJacketPending);
}

// ---- アプリ内カメラ(v212) ----
if(jacketBtnShootEl){
    jacketBtnShootEl.addEventListener("click",shootFromLiveCamera);
}

if(jacketBtnCameraCancelEl){
    jacketBtnCameraCancelEl.addEventListener("click",cancelLiveCamera);
}

// ---- 上書きの確認(v210) ----
if(jacketBtnOverwriteEl){
    jacketBtnOverwriteEl.addEventListener("click",confirmJacketOverwrite);
}

if(jacketBtnOverwriteCancelEl){
    jacketBtnOverwriteCancelEl.addEventListener("click",cancelJacketOverwrite);
}

/*
⚠️ アートワークの選び直しのボタンは**その都度作る**ので、
   受け口は renderArtworkChoices() の中で付けています
   (どの画像を持っているかが曲ごとに違うため)。
*/

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
