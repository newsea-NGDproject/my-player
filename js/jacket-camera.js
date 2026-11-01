/* ==========================================================
   js/jacket-camera.js

   特大表示(js/jacket.js)の中で使う、アプリ内カメラです。
   📷 を押すと、ジャケット枠の中に外カメラの映像を流し、📸 でその瞬間を切り取ります。
   v212 で js/jacket.js の中に作り、v262(① 特大表示のジャケの ①-3)でこのファイルへ切り出しました。

   ------------------------------------------------------------
   【v262(①-3)でやったこと】

   竹弘の相談(2026-11-01):

       「galaxyはジャケ写の接写ができないようです。広角レンズが選択されるからでしょうか。
         写真がピントが合わずボケてしまいます。旧機種のxperiaはカメラが一つなので綺麗に撮れます。」
       「jsなどに切り出して、ネイティブアプリのカメラを今の撮影サイズでパンチインアウトで
         制御できると嬉しいのですが。」

   のりの見立て:GALAXY の主カメラは、約10cm より近いとピントが合わない(近くを撮る時は
   スマホのカメラアプリが別のレンズに切り替えているが、ブラウザから借りるカメラは1つだけ)。
   しかも v261 までは映像の大きさを頼んでおらず、Chrome の標準の 640×480 だった
   (撮った絵は 480点まで)。

       映像を大きく借りる  … 1920×1080 を頼む(JACKET_CAMERA_WIDTH / HEIGHT)
                             → 撮った絵は、大きい箱の 1080点まで(COVER_ART_BIG_SIZE)
       ピンチで拡大・縮小  … 少し離して(ピントが合う所で)構え、ピンチで大きくして撮る
                             (「3. ズーム」)
       カメラができることを🐛へ … 映像の大きさ・ズームの幅・ピントの合わせ方
                             (端末ごとの違いを確かめるため。logLiveCameraAbility)

   ⚠️ スマホのカメラアプリそのものは、ブラウザからは操作できません。
      (📁 マイファイルから、カメラアプリで撮った写真を選ぶことは今でもできます)

   ------------------------------------------------------------
   【js/jacket.js との分担】

       js/jacket.js が持つもの  … 画面の部品(jacketBigEl・ボタン)・画面の段階(jacketUiState)・
                                  預かっている絵(jacketPendingBlob)・描き直し
                                  (renderJacketBig / refreshJacketButtons / showJacketWarning)・
                                  どの曲か(getJacketViewTrack)
       このファイルが持つもの   … カメラそのもの(映像・ズーム・撮る・止める)

   js/jacket.js から呼ばれるのは2つだけです:
       openLiveCamera() … 📷 / 撮り直す(📷)が押された時
       stopLiveCamera() … 特大表示を開く時・閉じる時(カメラのランプを消すため)

   ⚠️ **読み込み順:c014.html で js/jacket.js のすぐ後ろに置きます。** このファイルは
      読み込んだその場で、js/jacket.js の部品(jacketBigEl・jacketBtnShootEl など)に
      受け口を付けるためです(CLAUDE.md の「読み込み順の罠」)。
      逆に js/jacket.js からこのファイルの関数を呼ぶのは、ボタンが押された時
      (全部読み終わった後)だけなので、順番は関係ありません。
   ⚠️ 名前は jacketCamera / LiveCamera で始めています。ほかのファイルに同じ名前の
      const があると、読み込んだ瞬間にエラーになり、このファイルが丸ごと動かなくなるためです。

   経緯 → devlog/ジャケ写.md
   ========================================================== */


// ==========================================================
// 1. 決まりごとの数字と、カメラの状態
// ==========================================================
/*
借りる映像の大きさ(頼む大きさ)です(v262)。

⚠️ ideal(できれば)で頼みます。exact(必ず)にすると、その大きさを出せないカメラで
   エラーになって何も映りません。ideal なら、カメラが出せるいちばん近い大きさに譲ります。
⚠️ 縦に持っていると、映像は 1080×1920 で届くことがあります(どちらでも、真ん中の
   正方形は 1080点。shootFromLiveCamera は短い辺で切り取るので同じに扱える)。
⚠️ 16:9 の映像の真ん中の正方形は、4:3(v261 までの 640×480)の時より少し狭く写ります
   (カメラの絵の上下が少し切られるため)。ジャケットに少し離れて構えることになるので、
   近いとピントが合わない GALAXY にはかえって都合がよい。
*/
const JACKET_CAMERA_WIDTH  = 1920;
const JACKET_CAMERA_HEIGHT = 1080;

/*
ピンチで上げられる倍率の上限です(v262)。

    カメラのズーム … ×5 まで(カメラが ×8・×10 まで出せても、ジャケットを撮るには要らない。
                     上げすぎると手ぶれで狙いが定まらない)
    切り抜き       … ×3 まで(1080点 ÷ 3 = 360点。これより上は保存する絵が粗くなりすぎる)

「カメラのズーム」と「切り抜き」の違いは、下の jacketCameraZoom の説明。
*/
const JACKET_CAMERA_ZOOM_MAX      = 5;
const JACKET_CAMERA_CROP_ZOOM_MAX = 3;

/*
カメラのズームの能力を、もう一度確かめるまでの間(ms)です(v262)。

⚠️ Chrome は、カメラのズームの能力(getCapabilities の zoom)を、カメラを借りた直後には
   まだ持っていないことがあります(カメラに問い合わせている途中)。だから、最初に
   見つからなかった時は、この時間だけ待って1回だけ確かめ直します。
   それでも無ければ、切り抜きで拡大します。
*/
const JACKET_CAMERA_ABILITY_RETRY_MS = 1000;

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
⚠️ **今のズームの状態(v262)。** カメラを止めると null に戻します。

    way      … どうやって拡大するか
                 "camera" … カメラのズーム。カメラの中で、写す範囲そのものを狭める
                            (センサーの細かい点を使うので、拡大しても粗くなりにくい)
                 "crop"   … 切り抜き。届いた映像の真ん中を大きく見せ、撮る時もそこだけを切り取る
                            (カメラのズームが使えない端末用。拡大するほど保存する絵の点が減る)
    base     … 倍率の基準になる値(カメラのズームの最小値。切り抜きなら 1)
                 ⚠️ カメラのズームの値は、端末によって「倍率そのもの(1〜8)」のことも、
                    「決まった単位(100〜400 など)」のこともあります。だから
                    **倍率 = 値 ÷ base** として扱い、画面には倍率を出します
    min/max  … 使ってよい値の幅(max は JACKET_CAMERA_ZOOM_MAX / CROP_ZOOM_MAX で抑える)
    step     … 値の刻み(カメラのズームは、刻みに合わない値を受け付けないことがある)
    value    … 今の値
    touched  … 竹弘が一度でもピンチしたか(画面の案内の言葉を切り替えるため)
    applying … カメラへズームを頼んでいる最中か(頼みは1つずつ。下の sendLiveCameraZoom)
    pending  … 頼んでいる間に、また指が動いたか(終わったら最新の値でもう一度頼む)
*/
let jacketCameraZoom = null;

/*
画面に触れている指の位置です(v262。ピンチを測るため)。
pointerId(指ごとの番号)→ {x, y}。

jacketCameraPinch … 2本目の指が触れた瞬間の「指の間の距離」と「その時の倍率」。
                    指を広げた割合だけ、倍率を掛けて大きくします。
*/
const jacketCameraPoints = new Map();
let jacketCameraPinch = null;


// ==========================================================
// 2. 開く・止める
// ==========================================================
/**
 * ジャケット枠に、外カメラの映像を流し始めます。
 *
 * ⚠️⚠️ **必ず逃げ道を用意してあります。** カメラが使えない場合
 *    (許可されなかった / カメラが無い / 安全な接続でない)は、
 *    元の画面に戻して、理由を注意書きに出します(abortLiveCamera)。
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

        console.log("この環境ではアプリ内カメラを使えません");

        abortLiveCamera("この端末ではカメラを使えません");

        return;

    }

    try{

        const stream = await borrowLiveCamera();

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

        prepareLiveCameraZoom(stream);

    }
    catch(error){

        console.log("アプリ内カメラを開けませんでした :",error.name);

        /*
        ⚠️ **断られた理由で言葉を変えます。**

            NotAllowedError … 竹弘が「許可しない」を選んだ
                              (または以前に拒否したまま覚えられている)
            それ以外        … カメラが無い / 他のアプリが使っている等

        「許可されていません」と出しておけば、Chromeの設定で
        許可を出し直せばよい、と気づけます。
        */
        const denied = (error && error.name === "NotAllowedError");

        abortLiveCamera(
            denied
                ? "カメラの使用が許可されていません"
                : "カメラを使えませんでした"
        );

    }

}

/**
 * カメラを借ります(v262 で openLiveCamera から切り出した)。
 *
 * 【頼む中身】
 *
 *     facingMode:"environment" … **外カメラ**(画面と反対側)。ジャケットは目の前の
 *                                 ものを撮るので外カメラが自然です。
 *                                 ideal なので、外カメラが無い端末では内カメラに譲ります
 *     width / height(v262)    … 1920×1080(上の JACKET_CAMERA_WIDTH の説明)
 *     zoom:true(v262)          … 「カメラのズームも使いたい」という頼み。
 *                                 ⚠️ Chrome は、これを頼んだページにだけ、カメラのズームの
 *                                    能力を見せます(頼まないと、ズームできるカメラでも
 *                                    getCapabilities に zoom が出てこない)
 *
 * ⚠️⚠️ **audio:false を必ず書きます。** 書かないつもりでも、
 *    マイクを一緒に借りてしまうと**音楽の再生が止まる恐れ**が
 *    あります。ノリRunは走行中に鳴り続けることが最優先なので、
 *    映像だけを借ります。
 *
 * ⚠️ **zoom:true で断られた時は、zoom を外してもう一度だけ頼みます。**
 *    端末によっては、ズームを頼むと「カメラの使用と移動」という別の許可を聞かれる
 *    ことがあり、そこで断られてもカメラ自体は使えるようにするためです
 *    (ズームは切り抜きで代わりができる)。2回目も断られたら、その理由を返します。
 *
 * @return {Promise<MediaStream>} 借りた映像の流れ
 */
async function borrowLiveCamera(){

    const video = {
        facingMode : { ideal:"environment" },
        width      : { ideal:JACKET_CAMERA_WIDTH },
        height     : { ideal:JACKET_CAMERA_HEIGHT }
    };

    try{

        return await navigator.mediaDevices.getUserMedia({
            video : Object.assign({ zoom:true },video),
            audio : false
        });

    }
    catch(error){

        // 【開発用調査ログ】(v262)ズームを頼んで断られたかを、実機で確かめるため
        console.log("カメラのズームを頼んだら断られたので、ズーム無しで頼み直します :",error.name);

        /*
        ⚠️ 許可を聞いている間に ✕ が押されていたら、頼み直しません
           (もう一度許可の画面が出ると、閉じたのに何かが起きることになる)。
        */
        if(!jacketCameraWanted){ throw error; }

        return await navigator.mediaDevices.getUserMedia({
            video : video,
            audio : false
        });

    }

}

/**
 * アプリ内カメラが使えない時に、元の画面へ戻します(v213で変更)。
 *
 * ⚠️ **v212はスマホ標準のカメラアプリに切り替えていました。**
 *    竹弘の指定(2026-09-21):
 *
 *        「カメラの許可を拒否したら標準のカメラアプリに切り替わるの
 *          ではなく、次の画面に進まない。元の画面に戻るにしたい」
 *
 *    勝手に別のアプリが立ち上がると「何が起きたのか分からない」と
 *    なるためです。拒否したなら、何も起きずに戻るのが素直です。
 *
 * ⚠️ **ただし「押しても無反応」にはしません。** 注意書きの場所
 *    (曲名・アーティストの2行の場所)に理由を出します。無言で戻ると、
 *    壊れたのか拒否されたのか分かりません。
 *
 * ⚠️ カメラが使えなくても**📁 マイファイルは使えます。** 標準の
 *    カメラアプリで撮った写真を、そこから選べば同じことができます。
 *
 * @param {String} reasonText … 注意書きに出す理由(空なら出さない)
 */
function abortLiveCamera(reasonText){

    stopLiveCamera();

    jacketUiState = "normal";

    const track = getJacketViewTrack();

    renderJacketBig(track);
    refreshJacketButtons(track);

    /*
    ⚠️ **refreshJacketButtons の後に出します。** あの関数は
       ふつうの状態に戻る時に注意書きを消すので、先に出すと
       すぐ消されてしまいます。
    */
    if(reasonText){ showJacketWarning(reasonText); }

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
 *
 * v262 から、枠の右下に倍率の札(.jacket-live-zoom)も置きます。
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
    倍率の札です(v262)。最初は「少し離してピンチで拡大」と使い方を出し、
    一度ピンチしたら「×2.0」のような倍率に変わります(updateLiveZoomLabel)。

    ⚠️ 「少し離して」と書くのは、近すぎるとピントが合わない端末(GALAXY)のためです。
    ⚠️ 札は指の邪魔をしません(c014.html で pointer-events:none)。
    */
    const zoomLabel = document.createElement("div");
    zoomLabel.className = "jacket-live-zoom";

    jacketBigEl.appendChild(zoomLabel);

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
 *    画面を開き直した時(念のため)/ カメラが使えなかった時(abortLiveCamera)。
 *    どれか1つでも抜けると、カメラが点いたままになります。
 * ⚠️ ズームとピンチの状態も、ここで空にします(v262)。次に開いた時は ×1 から。
 */
function stopLiveCamera(){

    jacketCameraWanted = false;

    if(jacketCameraStream){

        stopStreamTracks(jacketCameraStream);
        jacketCameraStream = null;

    }

    jacketCameraZoom  = null;
    jacketCameraPinch = null;
    jacketCameraPoints.clear();

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


// ==========================================================
// 3. ズーム(ピンチで拡大・縮小。v262)
// ==========================================================
/*
【流れ】

    ① カメラを借りたら、まず「切り抜き」で拡大できる状態にする(すぐピンチできるように)
    ② カメラのズームが使えると分かったら、「カメラのズーム」に切り替える
       (まだピンチしていない時だけ。途中で切り替えると倍率が飛ぶため)
    ③ 2本の指の間の距離が、触れた時の何倍になったかで倍率を決める
         新しい倍率 = 触れた時の倍率 × (今の距離 ÷ 触れた時の距離)

【カメラのズームと切り抜きの違い】(上の jacketCameraZoom の説明も)

    カメラのズーム … 写す範囲そのものを狭めるので、拡大しても保存する絵は 1080点のまま
    切り抜き       … 届いた映像を大きく見せるだけ。×2 なら真ん中の半分(540点)を保存する

⚠️ どちらでも「見えている範囲 = 保存する範囲」です(撮る時の shootFromLiveCamera が、
   切り抜きの時は同じ倍率で真ん中を切り取る)。
*/

/**
 * カメラを借りた直後に、ズームの準備をします(openLiveCamera が呼ぶ)。
 *
 * @param {MediaStream} stream … 借りた映像の流れ
 */
function prepareLiveCameraZoom(stream){

    const track = getLiveCameraTrack(stream);

    // ① まずは切り抜きで(すぐピンチできるように)
    jacketCameraZoom = {
        way      : "crop",
        base     : 1,
        min      : 1,
        max      : JACKET_CAMERA_CROP_ZOOM_MAX,
        step     : 0,
        value    : 1,
        touched  : false,
        applying : false,
        pending  : false
    };

    updateLiveZoomLabel();

    if(!track){ return; }

    /*
    ② カメラのズームが使えるかを確かめます。見つからなければ、少し待って1回だけ
       確かめ直します(上の JACKET_CAMERA_ABILITY_RETRY_MS の説明)。
       🐛へのカメラの能力の記録は、確かめ終わった時に1回だけ出します。
    */
    const check = function(isLast){

        // その間にカメラを止めた・借り直した → 何もしない
        if(jacketCameraStream !== stream){ return; }

        const found = useLiveCameraZoomIfAble(track);

        if(found || isLast){

            logLiveCameraAbility(track);

            return;

        }

        setTimeout(function(){ check(true); },JACKET_CAMERA_ABILITY_RETRY_MS);

    };

    check(false);

}

/**
 * 映像の流れから、映像の track(1本目)を取り出します。
 *
 * ⚠️ この track は「曲」の track(1曲分のデータ)とは別物です。
 *    MediaStreamTrack という、カメラの映像1本を指す部品です。
 *
 * @param  {MediaStream} stream
 * @return {MediaStreamTrack|null}
 */
function getLiveCameraTrack(stream){

    if(!stream || typeof stream.getVideoTracks !== "function"){ return null; }

    return stream.getVideoTracks()[0] || null;

}

/**
 * カメラのズームが使えれば、拡大のやり方を「カメラのズーム」に切り替えます。
 *
 * ⚠️ 竹弘がもうピンチしていたら切り替えません(倍率が急に飛ぶため)。
 *    その時は、カメラを閉じるまで切り抜きのままです。
 *
 * @param  {MediaStreamTrack} track
 * @return {boolean} カメラのズームが見つかったら true(切り替えなかった時も)
 */
function useLiveCameraZoomIfAble(track){

    const ability = readLiveCameraZoomAbility(track);

    if(!ability){ return false; }

    const zoom = jacketCameraZoom;

    if(!zoom || zoom.touched){ return true; }

    /*
    倍率の基準(base)は、カメラのズームの最小値です。最小値が 0 以下という
    おかしな値の時は、値そのものを倍率とみなします。
    */
    const base = (ability.min > 0) ? ability.min : 1;

    zoom.way   = "camera";
    zoom.base  = base;
    zoom.min   = ability.min;
    zoom.max   = Math.min(ability.max,base * JACKET_CAMERA_ZOOM_MAX);
    zoom.step  = ability.step;
    zoom.value = ability.min;

    /*
    ⚠️ 前に開いた時のズームがカメラに残っていることがあるので、いちばん引いた所
       (最小値)から始めます。今の値が最小値でなければ、カメラに頼みます。
    */
    const settings = (typeof track.getSettings === "function") ? track.getSettings() : {};

    if(typeof settings.zoom === "number" && settings.zoom !== ability.min){
        sendLiveCameraZoom();
    }

    // 切り抜きで大きく見せていた分を戻します(まだピンチしていないので ×1 のはず)
    const video = jacketBigEl ? jacketBigEl.querySelector("video") : null;

    if(video){ video.style.transform = ""; }

    updateLiveZoomLabel();

    return true;

}

/**
 * カメラのズームの能力(使える値の幅)を調べます。
 *
 * getCapabilities() は「このカメラで設定できる値の幅」を返す標準の命令です。
 * その中の zoom が {min, max, step} の形で入っていれば、カメラのズームが使えます。
 *
 * @param  {MediaStreamTrack} track
 * @return {{min:number,max:number,step:number}|null} 使えなければ null
 */
function readLiveCameraZoomAbility(track){

    if(!track || typeof track.getCapabilities !== "function"){ return null; }

    let abilities = null;

    try{ abilities = track.getCapabilities(); }
    catch(error){ return null; }

    const zoom = abilities ? abilities.zoom : null;

    if(!zoom || typeof zoom.min !== "number" || typeof zoom.max !== "number"){ return null; }

    // 幅が無い(最小 = 最大)なら、ズームできないのと同じです
    if(!(zoom.max > zoom.min)){ return null; }

    return {
        min  : zoom.min,
        max  : zoom.max,
        step : (typeof zoom.step === "number" && zoom.step > 0) ? zoom.step : 0
    };

}

/**
 * 倍率を変えます(ピンチの指が動くたびに呼ばれる)。
 *
 * @param {number} ratio … 新しい倍率(×1.0 なら 1)
 */
function setLiveCameraZoomRatio(ratio){

    const zoom = jacketCameraZoom;

    if(!zoom){ return; }

    // 倍率 → カメラの値(上の jacketCameraZoom の説明の「倍率 = 値 ÷ base」の逆)
    let value = ratio * zoom.base;

    // 刻みに合わせます(カメラは刻みに合わない値を受け付けないことがある)
    if(zoom.step > 0){
        value = zoom.min + Math.round((value - zoom.min) / zoom.step) * zoom.step;
    }

    /*
    小数の計算で出る小さな誤差(1.2000000000000002 など)を、1000分の1で丸めます。
    カメラへ渡す値と、「同じ値か」の比べ(すぐ下)を素直にするためです。
    */
    value = Math.round(value * 1000) / 1000;

    value = Math.max(zoom.min,Math.min(zoom.max,value));

    zoom.touched = true;

    if(value === zoom.value){

        updateLiveZoomLabel();

        return;

    }

    zoom.value = value;

    updateLiveZoomLabel();

    if(zoom.way === "crop"){

        /*
        切り抜き:映像を真ん中から大きく見せます。枠(#jacket-big)は overflow:hidden
        なので、はみ出した外側は見えません = 見えているのは真ん中の 1/倍率 だけ。
        撮る時も同じ範囲を切り取ります(shootFromLiveCamera)。
        */
        const video = jacketBigEl ? jacketBigEl.querySelector("video") : null;

        if(video){
            video.style.transform = (value > 1) ? "scale(" + value + ")" : "";
        }

        return;

    }

    sendLiveCameraZoom();

}

/**
 * カメラに「この値にズームして」と頼みます。
 *
 * ⚠️ **頼みは1つずつです。** 指が動くたびに頼むと、カメラが追いつかずに頼みが
 *    溜まり、指を止めた後もしばらく倍率が動き続けます。頼んでいる最中に指が
 *    動いたら印(pending)だけ付け、終わったら最新の値でもう一度だけ頼みます。
 *
 * ⚠️ 頼みが断られたら(カメラが受け付けない)、切り抜きに切り替えます。
 *    倍率はそのまま引き継ぐので、見え方は大きく変わりません。
 */
async function sendLiveCameraZoom(){

    const zoom  = jacketCameraZoom;
    const track = getLiveCameraTrack(jacketCameraStream);

    if(!zoom || zoom.way !== "camera" || !track){ return; }

    if(zoom.applying){

        zoom.pending = true;

        return;

    }

    zoom.applying = true;
    zoom.pending  = false;

    try{

        /*
        advanced に入れると「できればこうして」という頼みになります
        (できない時に、借りている映像そのものが止まることはない)。
        */
        await track.applyConstraints({ advanced:[{ zoom:zoom.value }] });

    }
    catch(error){

        console.warn("カメラのズームを変えられなかったので、切り抜きで拡大します :",error.name);

        if(jacketCameraZoom === zoom){

            const ratio = zoom.value / zoom.base;

            zoom.way   = "crop";
            zoom.base  = 1;
            zoom.min   = 1;
            zoom.max   = JACKET_CAMERA_CROP_ZOOM_MAX;
            zoom.step  = 0;
            zoom.value = 1;

            zoom.applying = false;
            zoom.pending  = false;

            setLiveCameraZoomRatio(ratio);

        }

        return;

    }

    zoom.applying = false;

    // 頼んでいる間に指が動いていたら、最新の値でもう一度
    if(zoom.pending && jacketCameraZoom === zoom){ sendLiveCameraZoom(); }

}

/**
 * 枠の右下の札を書き換えます。
 *
 *     まだピンチしていない … 「🤏 少し離してピンチで拡大」(使い方の案内)
 *     ピンチした後         … 「🤏 ×2.0」(今の倍率)
 */
function updateLiveZoomLabel(){

    const label = jacketBigEl ? jacketBigEl.querySelector(".jacket-live-zoom") : null;

    if(!label){ return; }

    const zoom = jacketCameraZoom;

    if(!zoom || !zoom.touched){

        label.textContent = "🤏 少し離してピンチで拡大";

        return;

    }

    label.textContent = "🤏 ×" + (zoom.value / zoom.base).toFixed(1);

}

/**
 * 今、ピンチを受け付けてよいか(カメラの映像が流れているか)を返します。
 */
function isLiveCameraPinchable(){

    return jacketUiState === "camera" && !!jacketCameraStream && !!jacketCameraZoom;

}

/**
 * 2本の指の間の距離を測ります(触れている指がちょうど2本の時だけ)。
 *
 * @return {number} 距離(px)。2本でなければ 0
 */
function measureLiveCameraPinch(){

    if(jacketCameraPoints.size !== 2){ return 0; }

    const [a,b] = Array.from(jacketCameraPoints.values());

    return Math.hypot(a.x - b.x,a.y - b.y);

}

/**
 * ピンチを測り始めます(指がちょうど2本になった瞬間)。
 */
function startLiveCameraPinch(){

    const distance = measureLiveCameraPinch();

    if(distance <= 0 || !jacketCameraZoom){

        jacketCameraPinch = null;

        return;

    }

    jacketCameraPinch = {
        distance : distance,
        ratio    : jacketCameraZoom.value / jacketCameraZoom.base
    };

}

/**
 * 指が触れた時(pointerdown)。
 *
 * pointer の合図(pointerdown / pointermove / pointerup)は、指でもマウスでも
 * 同じ形で届く標準の合図です。pointerId で、どの指の話かを見分けます。
 */
function handleLiveCameraPointerDown(event){

    if(!isLiveCameraPinchable()){ return; }

    jacketCameraPoints.set(event.pointerId,{ x:event.clientX, y:event.clientY });

    if(jacketCameraPoints.size === 2){ startLiveCameraPinch(); }
    else{ jacketCameraPinch = null; }

}

/**
 * 指が動いた時(pointermove)。
 */
function handleLiveCameraPointerMove(event){

    if(!jacketCameraPoints.has(event.pointerId)){ return; }

    jacketCameraPoints.set(event.pointerId,{ x:event.clientX, y:event.clientY });

    if(!jacketCameraPinch || !isLiveCameraPinchable()){ return; }

    const distance = measureLiveCameraPinch();

    if(distance <= 0){ return; }

    setLiveCameraZoomRatio(jacketCameraPinch.ratio * distance / jacketCameraPinch.distance);

}

/**
 * 指が離れた時(pointerup / pointercancel)。
 *
 * ⚠️ 3本触れていて1本離れた時は、残った2本でピンチを測り直します
 *    (触れた時の距離が変わるので、そのまま続けると倍率が飛ぶ)。
 */
function handleLiveCameraPointerUp(event){

    if(!jacketCameraPoints.delete(event.pointerId)){ return; }

    if(jacketCameraPoints.size === 2){ startLiveCameraPinch(); }
    else{ jacketCameraPinch = null; }

}


// ==========================================================
// 4. 撮る
// ==========================================================
/**
 * 『📸』が押された時の処理です。今映っている瞬間を切り取ります。
 *
 * ⚠️⚠️ **切り取る大きさと画質は、📁 の取り込みとまったく同じ定数**
 *    (COVER_ART_BIG_SIZE / COVER_ART_QUALITY)を使います。竹弘の指定
 *    「1曲あたりのファイルサイズが大きくならないように、取込時に
 *      解像度を今のジャケ写サイズに解像度変更は絶対して欲しい」。
 *    v260(①-2)から、撮った絵は「大きい箱」の大きさ(1080点まで)で預かり、
 *    小さい箱(160点)は保存の時に作ります(js/jacket.js の applyJacketPending)。
 *    ⚠️ 映像より大きくはしません(引き伸ばさない)。v262 から映像を 1920×1080 で
 *       借りるので、真ん中の正方形は 1080点です(v261 までは Chrome の標準の 640×480 で 480点)。
 *    ⚠️ 切り抜きで拡大している時は、見えている真ん中だけを切り取るので、点の数は
 *       1080 ÷ 倍率 になります(×2 なら 540点。v262)。
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

        /*
        ---- 中央を正方形に切り取ります ----

        画面では object-fit:cover で「中央の正方形」だけが見えて
        いるので、**同じ場所を切り出せば見たまま**が保存されます。

        切り抜きで拡大している時(v262)は、見えているのはその正方形のさらに
        真ん中の 1/倍率 なので、そこだけを切り取ります。
        カメラのズームの時は、届く映像がもう拡大されているので、そのまま切り取ります。
        */
        const zoom = jacketCameraZoom;
        const cropRatio = (zoom && zoom.way === "crop") ? zoom.value : 1;

        const side = Math.min(video.videoWidth,video.videoHeight) / cropRatio;
        const sourceX = (video.videoWidth  - side) / 2;
        const sourceY = (video.videoHeight - side) / 2;

        /*
        描く大きさ = 大きい箱の一辺。ただし映像の正方形より大きくはしない(v260。上の解説)。
        */
        const outSize = Math.floor(Math.min(side,COVER_ART_BIG_SIZE));

        // 🐛に残す、撮った時の様子(v262)
        const ratioText = zoom ? (zoom.value / zoom.base).toFixed(1) : "1.0";
        const wayText   = (zoom && zoom.way === "camera") ? "カメラのズーム" : "切り抜き";
        const shotNote  =
            "映像 " + video.videoWidth + "×" + video.videoHeight +
            "・×" + ratioText + " " + wayText;

        const canvas = document.createElement("canvas");
        canvas.width  = outSize;
        canvas.height = outSize;

        const context = canvas.getContext("2d");

        context.drawImage(
            video,
            sourceX,sourceY,side,side,
            0,0,outSize,outSize
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
                outSize + "点",
                Math.round(blob.size / 1024) + "KB",
                "(" + shotNote + ")",
                "(まだ保存していません)"
            );

        },"image/jpeg",COVER_ART_QUALITY);

    }
    catch(error){

        console.error("撮影に失敗 :",error.name,error.message);

        cancelLiveCamera({stopPropagation:function(){}});

    }

}


// ==========================================================
// 5. カメラができることを🐛へ(v262)
// ==========================================================
/**
 * 借りたカメラが何をできるかを、🐛に1行で出します。
 *
 * 竹弘の2台(GALAXY と XPERIA)で、カメラの違いを確かめるためです
 * (GALAXY は近くでピントが合わない、の手がかり)。
 *
 *     映像     … 実際に届いている大きさ(頼んだのは 1920×1080)と、出せる最大
 *     ズーム   … カメラのズームの幅(無ければ「切り抜きで拡大」)
 *     ピント   … ピントの合わせ方(continuous = 自動で合わせ続ける 等)と、ピントの距離の幅
 *     カメラ   … カメラの名前(どのカメラを借りたか)
 *
 * 【開発用調査ログ】(v262)この関数ごと消してよい(呼んでいるのは prepareLiveCameraZoom の1か所)。
 *
 * @param {MediaStreamTrack} track
 */
function logLiveCameraAbility(track){

    try{

        const settings  = (typeof track.getSettings === "function") ? track.getSettings() : {};
        const abilities = (typeof track.getCapabilities === "function") ? track.getCapabilities() : {};

        const range = function(r){
            return (r && typeof r.min === "number") ? r.min + "〜" + r.max : "不明";
        };

        const zoom = jacketCameraZoom;

        const zoomText = (zoom && zoom.way === "camera")
            ? "カメラのズーム " + range(abilities.zoom) + "(使うのは ×" + (zoom.max / zoom.base).toFixed(1) + " まで)"
            : "カメラのズーム無し → 切り抜きで ×" + JACKET_CAMERA_CROP_ZOOM_MAX + " まで";

        const focusModes = Array.isArray(abilities.focusMode) ? abilities.focusMode.join("・") : "不明";

        console.log(
            "カメラができること :",
            "映像 " + settings.width + "×" + settings.height +
                "(頼んだのは " + JACKET_CAMERA_WIDTH + "×" + JACKET_CAMERA_HEIGHT +
                "・最大 " + (abilities.width ? abilities.width.max : "?") + "×" +
                (abilities.height ? abilities.height.max : "?") + ")",
            "/ " + zoomText,
            "/ ピント " + (settings.focusMode || "不明") + "(選べるもの " + focusModes +
                "・距離 " + range(abilities.focusDistance) + ")",
            "/ " + (settings.facingMode || "向き不明") + " " + (track.label || "")
        );

    }
    catch(error){

        console.warn("カメラができることを調べられませんでした :",error.name);

    }

}


// ==========================================================
// 6. 受け口
// ==========================================================
/*
📸 と ✕(カメラ中)。v212 から。

⚠️ どちらの処理も先頭で stopPropagation() を呼んでいます(js/jacket.js の
   「どこをタップしても閉じる」があるため。押した瞬間に画面が閉じないように)。
*/
if(jacketBtnShootEl){
    jacketBtnShootEl.addEventListener("click",shootFromLiveCamera);
}

if(jacketBtnCameraCancelEl){
    jacketBtnCameraCancelEl.addEventListener("click",cancelLiveCamera);
}

/*
ピンチ(v262)。ジャケット枠(#jacket-big)そのものに付けます。

⚠️ 枠は特大表示を開いている間ずっと同じもので、中身(映像)だけが入れ替わります。
   だから起動時に1回付けるだけで済みます(受け口の中で、カメラの映像が流れている
   時だけ動くように確かめている。isLiveCameraPinchable)。
⚠️ カメラの映像が流れている間、ブラウザが指の動きを横取りしないように、
   c014.html で枠に touch-action:none を付けています(#jacket-big.jacket-big-live)。
*/
if(jacketBigEl){

    jacketBigEl.addEventListener("pointerdown",handleLiveCameraPointerDown);
    jacketBigEl.addEventListener("pointermove",handleLiveCameraPointerMove);
    jacketBigEl.addEventListener("pointerup",handleLiveCameraPointerUp);
    jacketBigEl.addEventListener("pointercancel",handleLiveCameraPointerUp);

    /*
    ⚠️ **カメラ中は、枠をタップしても特大表示を閉じません(v262)。**

    特大表示は「どこをタップしても閉じる」作りです(js/jacket.js の受け口)。
    ピンチをしようと指を置いただけで閉じてしまうと、カメラも止まり、撮り直しになります。
    カメラ中に閉じたい時は ✕ を押します(枠の外のグレーの所を押しても、今までどおり閉じます)。
    v261 までは、カメラの映像をタップすると閉じていました。
    */
    jacketBigEl.addEventListener("click",function(event){

        if(jacketUiState === "camera"){ event.stopPropagation(); }

    });

}
