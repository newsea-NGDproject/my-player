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

// ---- 差し替え機能の部品(v207で追加) ----
const jacketBtnOriginalEl = document.getElementById("jacket-btn-original");
const jacketBtnReplaceEl  = document.getElementById("jacket-btn-replace");
const jacketFileInputEl   = document.getElementById("jacket-file-input");

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

    // ---- 中身(画像 / カメラアイコン)を入れます ----
    renderJacketBig(track);

    // ---- 曲名とアーティスト ----
    // buildTitleText() も js/list-view.js から借ります
    // (タイトルが空の曲ではファイル名を出してくれます)
    jacketBigTitleEl.textContent  = buildTitleText(track);
    jacketBigArtistEl.textContent = track.artist || "";

    // ---- ボタン2つの押せる / 押せないを決めます ----
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
    どの画像を出すかは getTrackCover()(js/list-view.js)が決めます。
    差し替えがあればそちら、無ければ元のジャケットです。
    */
    const cover = getTrackCover(track);

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
 * ボタン2つの「押せる / 押せない」を決めます(v207)。
 *
 * 竹弘の指定を表にすると、こうなります。
 *
 *     曲の状態              オリジナルジャケット   📷 差し替え
 *     ------------------   -------------------   -----------
 *     元あり・差し替えなし   押せない(今それ)      押せる
 *     元あり・差し替えあり   押せる(元に戻る)      押せる(撮り直し)
 *     元なし                押せない(戻る先が無い) 押せる
 *
 * つまり『オリジナルジャケット』が押せるのは、**元のジャケットが
 * あり、かつ差し替え中**の時だけです。
 *
 * ⚠️ 『📷 差し替え』はいつでも押せます。何度撮り直しても、
 *    元のジャケット(cover_art)には一切触れません。
 *
 * @param {Object} track … 表示中の曲
 */
function refreshJacketButtons(track){

    if(!jacketBtnOriginalEl || !jacketBtnReplaceEl){ return; }

    const hasOriginal = !!(track && track.cover_art);
    const hasCustom   = !!(track && track.cover_art_custom);

    /*
    disabled は「このボタンは今押せません」という標準の印です。
    見た目は c014.html の :disabled のCSS(薄くする)が担当します。
    */
    jacketBtnOriginalEl.disabled = !(hasOriginal && hasCustom);

    jacketBtnReplaceEl.disabled = false;

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
 * 『📷 差し替え』が押された時の処理です。
 *
 * 見えないファイル選択(#jacket-file-input)を代わりに押します。
 * Androidでは「カメラで撮る / ギャラリーから選ぶ」の選択画面が出ます。
 */
function startJacketReplace(event){

    /*
    ⚠️ **この押下をパネルへ伝えません。**
       パネルは「どこを押しても閉じる」作りなので、これを書かないと
       ボタンを押した瞬間に画面が閉じます。
    */
    event.stopPropagation();

    if(!jacketFileInputEl){ return; }

    jacketFileInputEl.click();

}

/**
 * 写真が選ばれた(または撮られた)時の処理です。
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
        console.error("ジャケット差し替え中止 : 対象の曲が分かりません");
        return;
    }

    try{

        /*
        ---- 480px角のJPEGに縮小します ----

        shrinkImageBlob() は js/metadata.js の関数で、**埋め込み
        ジャケットを取り込む時とまったく同じもの**です。中央を正方形に
        切り取ってから縮小するので、4:3のスマホ写真でも歪みません。

        ⚠️ **同じ関数・同じ定数を通すことに意味があります。**
           竹弘の指定「取り込む際にファイルサイズを不用意に大きく
           したくない。480pxに解像度を落として登録したい」に対して、
           ここに別の数字を書くと、将来 COVER_ART_SIZE を変えた時に
           **差し替えだけ古いサイズのまま残ります。**

        スマホの写真は4000×3000(1200万画素)ほどありますが、
        480px角にすると約1/26になり、他のジャケットと同じ
        数十KBに収まります。
        */
        const blob = await shrinkImageBlob(
            file,
            COVER_ART_SIZE,
            COVER_ART_QUALITY
        );

        if(!blob){
            console.error("ジャケット差し替え中止 : 画像を読めませんでした");
            return;
        }

        /*
        ⚠️⚠️ **cover_art(元のジャケット)には一切触りません。**
           竹弘の指定「もともとあるジャケ写は上書きしない」。
           差し替えは cover_art_custom という別の場所に入れるので、
           何度撮り直しても元の絵は無傷で残ります。
        */
        track.cover_art_custom = blob;

        await idbPut(STORE_MUSIC,track);

        refreshCoverEverywhere(track);

        console.log(
            "ジャケットを差し替えました :",
            track.file_name,
            Math.round(blob.size / 1024) + "KB"
        );

    }
    catch(error){

        console.error(
            "ジャケット差し替え失敗 :",
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
差し替えの受け口(v207)。
*/
if(jacketBtnReplaceEl){

    jacketBtnReplaceEl.addEventListener("click",startJacketReplace);

}

if(jacketBtnOriginalEl){

    jacketBtnOriginalEl.addEventListener("click",restoreOriginalJacket);

}

if(jacketFileInputEl){

    /*
    "change" は「選んだ内容が変わった」時に起きる合図です。
    カメラで撮った直後も、ギャラリーから選んだ直後も、ここへ来ます。

    ⚠️ カメラを使っている間、ノリRunは裏に回ります。**音は鳴り
       続けます**(2デッキ構造で音が途切れないため)が、戻ってくる
       までに曲が次へ繋がっていることがあります。
       だから保存先は currentTrackId ではなく jacketViewTrackId です
       (ファイル上部の解説)。
    */
    jacketFileInputEl.addEventListener("change",handleJacketFileChosen);

}
