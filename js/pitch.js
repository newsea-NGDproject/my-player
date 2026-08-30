/*
================================================================
 pitch.js … 定規UIと再生ピッチ(再生速度)の制御

----------------------------------------------------------------------

【このファイルの役割】

 エリア7〜8の定規を描き、指でなぞって再生速度を変えられるように
 します。エリア6の「再生ピッチ」「元ピッチ」の表示も、ここから
 まとめて更新します。

 ノリRunの本題である「設定したテンポで走る」の中心になる部分です。

----------------------------------------------------------------------

【legacy(ver8.5)からの移植です】

 竹弘が ver8.5 で完成させた drawRuler / setupDraggable /
 applyTempo / getEffectiveBaseBpm を移植しました。数値(1BPM=12px、
 前後35BPM、速度は0.5〜2.0倍)もそのまま引き継いでいます。

 移植にあたって変えたのは3点です。

   ・定規の高さを、60px固定からエリアの高さに合わせる形にした
     (ノリRunの上半分は画面を10等分しているため)
   ・画面の精細さ(devicePixelRatio)に合わせて描くようにした
     (ver8.5のままだとスマホで目盛りがぼやける)
   ・「元ピッチ」の表示を、実際に基準として使っている値に合わせた
     (下の getEffectiveBaseBpm の解説を参照。竹弘の判断で修正)

----------------------------------------------------------------------

【3つのBPMの関係(ここが仕様の中心)】

     baseBPM   … 自動解析で出した、その曲本来のテンポ
     manualBPM … タップ補正(ノリ注入)で、人が耳で測ったテンポ
     userBPM   … 竹弘が定規で選んだ、実際に鳴らすテンポ

 再生速度は次の式で決まります。

     再生速度 = userBPM ÷ 基準BPM

 「基準BPM」は manualBPM があればそちら、無ければ baseBPM です
 (getEffectiveBaseBpm)。自動解析は精度が高くないため、人が耳で
 測った値がある曲はそちらを信じる、という考え方です。
================================================================
*/


// ==========================================================
// 1. 定規の見た目と動きを決める数値(ver8.5から継承)
// ==========================================================

// 1BPMあたり何ピクセル離すか
const RULER_GAP = 12;

// 中心から前後何BPM分の目盛りを描くか
const RULER_RANGE = 35;

/*
---- 指が何ピクセル動いたら1BPM変えるか(v161で廃止) ----

以前はここに RULER_DRAG_STEP = 3 という別の数字があり、
「3px動くごとに1BPM」動かしていました。ver8.5から引き継いだ値です。

しかし定規の目盛りは1BPM＝12px(RULER_GAP)で描かれているので、
**目盛り1つ分ぶん指を動かすと、値は4つ分も進んでいました。**

    竹弘の報告(2026-08-30):
        「定規の動きが手についづいして欲しいです。今、指の動きに対して
          2倍か3倍で動く為、ウリであるはずの定規ギミックで
          自分の思うように値が設定しにくいのです」

実際には4倍でした。いまは RULER_GAP をそのまま使い、
**掴んだ目盛りが指の下から離れない**ようにしています
(マイピッチ設定 js/setup.js と同じ考え方)。
*/

/*
定規が目標の位置へ、1コマあたり何割ぶん近づくか(v162)。

マイピッチ設定(js/setup.js)にある

    state.bpm += (state.targetBpm - state.bpm) * 0.25; // 吸い付き補完

と同じ値です。竹弘が「初期設定の定規の吸い付く気持ちよさは意識して
作成した」と言っている、その正体がこの1行でした。

数字を大きくすると機敏だが硬い動きに、小さくするとぬるっと重い
動きになります。0.25は「指を離すとスッと寄ってぴたりと止まる」
ちょうどよい塩梅なので、揃えてあります。
*/
const RULER_SNAP_RATIO = 0.25;

/*
再生速度の下限と上限(ver8.5から継承)。

例えば元ピッチ120の曲なら、60〜240BPMの範囲でしか変えられません。
極端に速く/遅くすると音が壊れて聞けたものではなくなるため、
安全装置として入っています。
*/
const RATE_MIN = 0.5;
const RATE_MAX = 2.0;


// ==========================================================
// 2. 画面部品と、今の状態
// ==========================================================

const rulerCanvas = document.getElementById("pitch-ruler");

/*
getContext("2d") は「このcanvasに絵を描くための筆」を受け取る命令です。
以後、この筆(rulerCtx)に線や文字を描かせます。
*/
const rulerCtx = rulerCanvas ? rulerCanvas.getContext("2d") : null;

/*
今、定規の中心(赤い線の位置)が指しているBPMです。

曲を選んでいない間は、竹弘の指定通り120から始めます。
*/
let currentRulerBpm = 120;


// ==========================================================
// 3. 基準になるBPMを決める
// ==========================================================

/**
 * その曲の「基準BPM」を返します(ver8.5の getEffectiveBaseBpm)。
 *
 * タップ補正で人が測った値(manualBPM)があればそれを、
 * 無ければ自動解析の値(baseBPM)を使います。
 *
 * 【ver8.5から変えた点】
 * ver8.5は、計算にはmanualBPMを使うのに画面の「元ピッチ」表示は
 * baseBPMのままで、ノリ注入した曲は表示と実際の基準がズレていました。
 * 竹弘の判断で、表示も基準に合わせるようにしています
 * (画面に出ている数字が、実際に使われている数字と同じになる)。
 */
function getEffectiveBaseBpm(track){

    if(!track){ return BPM_FALLBACK; }

    return track.manualBPM || track.baseBPM || BPM_FALLBACK;

}


// ==========================================================
// 4. 定規を描く
// ==========================================================

/**
 * canvasの解像度を、今の表示サイズと画面の精細さに合わせます。
 *
 * 【canvasに大きさが2つある話】
 *
 * canvasには「表示上の大きさ(CSS)」と「絵を描く方眼紙の目の細かさ
 * (width/height属性)」の2つがあります。これがズレていると、絵を
 * 引き伸ばしたようにぼやけます。
 *
 * さらにスマホの画面は、CSSの1pxが実際には2〜3個の点でできています
 * (その倍率が devicePixelRatio)。方眼紙もその倍率で細かくしないと、
 * 目盛りの細い線がにじみます。ver8.5は倍率を見ていなかったため、
 * スマホで見るとぼやけていました。
 *
 * setTransform で筆の側に倍率を教えておくと、描く時の座標は
 * CSSピクセルのまま書けるので、描画のコードは読みやすいままです。
 */
function syncRulerCanvasSize(){

    if(!rulerCanvas || !rulerCtx){ return; }

    const parent = rulerCanvas.parentElement;
    if(!parent){ return; }

    const ratio = window.devicePixelRatio || 1;

    const cssWidth = parent.clientWidth;
    const cssHeight = parent.clientHeight;

    // 表示されていない(大きさ0)間は何もしません
    if(cssWidth <= 0 || cssHeight <= 0){ return; }

    rulerCanvas.width = Math.round(cssWidth * ratio);
    rulerCanvas.height = Math.round(cssHeight * ratio);

    rulerCtx.setTransform(ratio,0,0,ratio,0,0);

}

/**
 * 定規の目盛りを描きます(ver8.5の drawRuler)。
 *
 * @param {Number} centerBpm … 中央の赤い線が指すBPM
 */
function drawRuler(centerBpm){

    if(!rulerCanvas || !rulerCtx){ return; }

    const ratio = window.devicePixelRatio || 1;
    const width = rulerCanvas.width / ratio;
    const height = rulerCanvas.height / ratio;

    if(width <= 0 || height <= 0){ return; }

    rulerCtx.clearRect(0,0,width,height);

    const centerX = width / 2;

    /*
    目盛りの長さを高さに対する割合で決めています。

    ver8.5は高さ60px固定で「25px / 15px / 8px」という決め打ちでしたが、
    ノリRunの定規は画面の高さに応じて伸び縮みするため、同じ見た目の
    比率になるよう割合に直しました(25÷60 ≒ 0.42 など)。
    */
    const tickLong = height * 0.42;
    const tickMiddle = height * 0.25;
    const tickShort = height * 0.13;

    /*
    【v106】目盛りの数字を2倍にしました(竹弘の指示)。

        「定規の目盛りの数値が小さすぎて読めない」

    走りながら見る数字なので、止まって画面を覗き込む前提の
    大きさでは用をなしません。0.17 → 0.34 と、割合をそのまま
    倍にしています。

    あわせて数字の描く位置(textY)を 0.72 → 0.78 と少し下げました。
    文字が大きくなるとその分だけ上へ伸びるため、そのままだと
    目盛りの線(tickLong = 高さの0.42)に頭がぶつかるためです。
    下げても文字の足元は定規の下端に届きません。

    textY は文字の「足元の線(ベースライン)」の位置で、
    文字はそこから上へ向かって描かれます。
    */
    const textY = height * 0.78;

    const fontSize = Math.max(18,Math.round(height * 0.34));
    rulerCtx.font = fontSize + "px sans-serif";
    rulerCtx.textAlign = "center";

    const from = Math.floor(centerBpm - RULER_RANGE);
    const to = Math.ceil(centerBpm + RULER_RANGE);

    for(let bpm = from; bpm <= to; bpm++){

        // 中心からの差(BPM)に間隔を掛けると、その目盛りの横位置になります
        const x = Math.round(centerX + (bpm - centerBpm) * RULER_GAP);

        // 画面の外に出る目盛りは描きません(無駄な描画を減らします)
        if(x < -20 || x > width + 20){ continue; }

        rulerCtx.beginPath();
        rulerCtx.strokeStyle = "#999";

        /*
        10刻みは長い線と数字、5刻みは中くらい、それ以外は短い線。
        目盛りに強弱を付けると、今どのあたりを見ているかが
        ひと目で分かります(定規や物差しと同じ考え方)。
        */
        if(bpm % 10 === 0){

            rulerCtx.moveTo(x,0);
            rulerCtx.lineTo(x,tickLong);

            rulerCtx.fillStyle = "#333";
            rulerCtx.fillText(bpm,x,textY);

        }
        else if(bpm % 5 === 0){

            rulerCtx.moveTo(x,0);
            rulerCtx.lineTo(x,tickMiddle);

        }
        else{

            rulerCtx.moveTo(x,0);
            rulerCtx.lineTo(x,tickShort);

        }

        rulerCtx.stroke();

    }

    /*
    最後に、設定できない範囲へうすいグレーをかぶせます(v107)。

    目盛りを描いた「後」に重ねているのがポイントで、こうすると
    その範囲の目盛りも一緒に薄く沈み、「ここは使えない場所」として
    見えます。先に塗ってしまうと目盛りだけがはっきり浮いてしまい、
    使える場所との差が出ません。
    */
    drawOutOfRangeMask(centerBpm,width,height,centerX);

}

/**
 * 再生速度を変えられない範囲に、うすいグレーをかぶせます。
 *
 * 竹弘の要望(v107):
 *     「定規UIの設定できないピッチエリアの少しグレー化。
 *       これ以上は設定範囲ではないよとわかればいいレベル。
 *       ユーザーがなんでこれ以上定規UIが動かないのかなといった
 *       疑問がでるかもしれない為」
 *
 * 再生速度には 0.5〜2.0倍 という安全装置があるため(RATE_MIN /
 * RATE_MAX)、定規もそこで止まります。何も無いまま止まると
 * 故障のように見えてしまうので、行き止まりを目で分かるようにします。
 *
 * 例えば元ピッチ120の曲なら、60BPMより下と240BPMより上が
 * グレーになります。
 */
function drawOutOfRangeMask(centerBpm,width,height,centerX){

    const track = libraryMap[currentTrackId];

    // 曲を選んでいない間は、そもそも設定できる範囲が決まりません
    if(!track){ return; }

    const base = getEffectiveBaseBpm(track);

    // 設定できるBPMの下限と上限
    const minBpm = base * RATE_MIN;
    const maxBpm = base * RATE_MAX;

    /*
    その境目が、定規の上でどの位置(x座標)に来るかを求めます。
    計算の仕方は目盛りを描く時とまったく同じで、
    「中心からのBPMの差 × 1BPMあたりの間隔」です。
    */
    const minX = centerX + (minBpm - centerBpm) * RULER_GAP;
    const maxX = centerX + (maxBpm - centerBpm) * RULER_GAP;

    /*
    rgba の4つ目の数字が透明度で、0で透明・1で真っ黒です。
    0.12 は「言われてみれば色が違う」程度の薄さで、竹弘の
    「わかればいいレベル」に合わせています。
    */
    rulerCtx.fillStyle = "rgba(0,0,0,0.12)";

    // 下限より左側(遅すぎて設定できない範囲)
    if(minX > 0){
        rulerCtx.fillRect(0,0,minX,height);
    }

    // 上限より右側(速すぎて設定できない範囲)
    if(maxX < width){
        rulerCtx.fillRect(maxX,0,width - maxX,height);
    }

}


// ==========================================================
// 5. 再生速度を変える
// ==========================================================

/**
 * 再生速度を変えて、画面(再生ピッチ・元ピッチ・定規)を更新します。
 *
 * @param {Number}  rate       … 基準に対する速度の倍率(1.0で等速)
 * @param {Boolean} shouldSave … DBに保存するかどうか
 */
function applyTempo(rate,shouldSave){

    const track = libraryMap[currentTrackId];

    if(!track){ return; }

    const base = getEffectiveBaseBpm(track);

    // 安全装置。0.5〜2.0倍からはみ出さないようにします
    const safeRate = Math.min(Math.max(rate,RATE_MIN),RATE_MAX);

    /*
    playbackRate が再生速度そのものです(1.0で等速、2.0で2倍速)。

    preservesPitch は「速度を変えても音の高さは変えない」という指定で、
    竹弘の要望した「声などのトーンは変えない」がこれにあたります。
    これが無いと、速くすると声が甲高くなり、遅くすると低い声に
    なってしまいます(昔のテープの早送りと同じ現象)。

    webkitPreservesPitch も一緒に指定しているのは、古いブラウザが
    こちらの名前しか知らないためです。片方を知らないブラウザは
    その行を黙って無視するので、両方書いておくのが安全です。
    */
    audioPlayer.preservesPitch = true;
    audioPlayer.webkitPreservesPitch = true;
    audioPlayer.playbackRate = safeRate;

    // 今鳴らしているテンポ(小数は出さず、1BPM単位に丸めます)
    const currentBpm = Math.round(base * safeRate);

    currentRulerBpm = currentBpm;

    // --- 画面を更新します ---
    pitchValueEl.textContent = formatPitch(currentBpm);
    basePitchValueEl.textContent = formatPitch(base);

    drawRuler(currentBpm);

    // --- 選んだテンポを曲データに覚えさせます ---
    track.userBPM = currentBpm;

    if(shouldSave){
        savePitchToDb(track);
    }

}

/**
 * 選んだテンポ(userBPM)をDBへ保存します。
 *
 * 指を離した時など、操作が一区切りついた時だけ呼びます。
 * なぞっている間ずっと保存すると、1BPM動かすたびにDBへの
 * 書き込みが起きて動きが重くなるためです
 * (シークバーで input と change を分けているのと同じ考え方)。
 */
async function savePitchToDb(track){

    try{
        await idbPut(STORE_MUSIC,track);
    }
    catch(error){
        console.error("再生ピッチの保存に失敗 :",error.name,error.message);
    }

}

/**
 * 曲を再生する時に、その曲のテンポを適用します。
 *
 * 前回この曲で選んだテンポ(userBPM)があればそれを、
 * 無ければ元ピッチ(等速)で鳴らします。竹弘の指定した
 * 「次回同曲が再生される時、userBPMを優先する」がこれです。
 */
function applyTrackTempo(track){

    if(!track){ return; }

    const base = getEffectiveBaseBpm(track);

    const targetBpm = (track.userBPM && track.userBPM !== 0)
        ? track.userBPM
        : base;

    /*
    保存しないのは、ここが「前回の続きを再現しているだけ」で、
    竹弘が新しく選び直したわけではないためです。
    */
    applyTempo(targetBpm / base,false);

}


// ==========================================================
// 6. 定規を指でなぞる
// ==========================================================

/**
 * 定規を1BPM分ずらします。
 *
 * @param {Number} delta … +1 か -1
 */
function changePitchBy(delta){

    const track = libraryMap[currentTrackId];

    // 曲を選んでいない時は、動かしても意味がないので何もしません
    if(!track){ return; }

    const base = getEffectiveBaseBpm(track);

    applyTempo((currentRulerBpm + delta) / base,false);

}

/**
 * 定規をこのBPMに合わせます(v162で追加)。
 *
 * changePitchBy が「今より1つ隣へ」なのに対し、こちらは
 * 「この値ちょうどに」動かします。なぞっている最中は指の位置から
 * 直接BPMが決まるので、差分ではなく絶対値で指定できる方が素直です。
 *
 * @param {Number} bpm … 合わせたいBPM
 */
function changePitchTo(bpm){

    const track = libraryMap[currentTrackId];

    if(!track){ return; }

    const base = getEffectiveBaseBpm(track);

    applyTempo(bpm / base,false);

}

/*
定規を指でなぞる操作の登録です(ver8.5の setupDraggable)。

【なぜ mousemove を window に登録するのか】

指(やマウス)が定規の外へ出ても、動かしている間は追いかけたいためです。
canvasにだけ登録すると、少し外へはみ出した瞬間に操作が止まってしまい、
「引っかかる」感じになります。
*/
(function setupRulerDrag(){

    if(!rulerCanvas){ return; }

    let dragging = false;
    let lastX = 0;

    /*
    ---- 目盛りに吸い付く動き(v162) ----

    竹弘の指摘(2026-08-30):

        「滑らかなメモリに吸い付く気持ちよさがない。
          初期設定の定規の吸い付く気持ちよさは意識して作成した」

    マイピッチ設定(js/setup.js)の定規は、位置を**2つ**持っています。
    それを移植しました。

        targetBpm … 指が示している位置。小数のまま持つ
        viewBpm   … いま実際に描いている位置。targetBpm を追いかける

    毎コマ「差の25%」だけ近づけると、指を止めた時にスッと寄って
    ぴたりと止まります。これが「吸い付く」感触の正体です。
    さらに指を離した瞬間に targetBpm を整数へ丸めるので、
    定規が最寄りの目盛りへ吸い寄せられて着地します。

    v161では整数しか持っていなかったため、12pxごとにカクッと
    切り替わるだけで、この気持ちよさがありませんでした。
    */
    let targetBpm = 0;
    let viewBpm = 0;

    // アニメーションの予約番号。止める時に使います
    let rafId = null;

    /*
    定規が動ける範囲に収めます。

    再生速度は0.5〜2.0倍までなので、その外側へ指を運んでも
    定規は端で止まります(元ピッチ120の曲なら60〜240BPM)。
    */
    function clampTarget(){

        const track = libraryMap[currentTrackId];

        if(!track){ return; }

        const base = getEffectiveBaseBpm(track);

        const minBpm = base * RATE_MIN;
        const maxBpm = base * RATE_MAX;

        if(targetBpm < minBpm){ targetBpm = minBpm; }
        if(targetBpm > maxBpm){ targetBpm = maxBpm; }

    }

    /**
     * 1コマ分だけ定規を目標へ近づけて、描き直します。
     */
    function animate(){

        const diff = targetBpm - viewBpm;

        /*
        差が十分小さくなったら、ぴたりと合わせて終わりにします。

        0.25ずつ近づける計算は、いつまでも「限りなく近いが届かない」
        状態が続くため、この打ち切りが無いと永久に描き続けてしまいます。
        */
        if(Math.abs(diff) < 0.005){

            viewBpm = targetBpm;

        }
        else{

            viewBpm = viewBpm + diff * RULER_SNAP_RATIO;

        }

        /*
        実際の再生速度は、丸めた整数が変わった時だけ合わせます。

        毎コマ速度を変えると音が細切れになりますし、画面の数字も
        小数で震えて読めません。**見た目は滑らかに、音は1BPM単位で**
        という役割分担です。
        */
        const rounded = Math.round(viewBpm);

        if(rounded !== currentRulerBpm){

            changePitchTo(rounded);

        }

        /*
        最後に小数の位置で描き直します。

        ⚠️ 順番が大事です。上の changePitchTo() の中でも定規を
           整数の位置で描いているので、その後に描かないと
           カクついた見た目に戻ってしまいます。
        */
        drawRuler(viewBpm);

        // 指を離していて、もう動く必要が無ければループを終えます
        if(!dragging && viewBpm === targetBpm){

            rafId = null;

            return;

        }

        rafId = requestAnimationFrame(animate);

    }

    /**
     * アニメーションが止まっていたら動かし始めます。
     */
    function ensureAnimating(){

        if(rafId === null){

            rafId = requestAnimationFrame(animate);

        }

    }

    function start(x){

        dragging = true;
        lastX = x;

        /*
        なぞり始める前に、いまの値と足並みを揃えます。

        曲を変えたり「元ピッチ」ボタンを押したりすると、定規は
        こちらを通らずに動いています。揃えておかないと、指を
        置いた瞬間に前回の位置へ飛んでしまいます。
        */
        targetBpm = currentRulerBpm;
        viewBpm = currentRulerBpm;

    }

    function move(x){

        if(!dragging){ return; }

        const dx = x - lastX;

        lastX = x;

        /*
        指が動いた距離を、目盛りの幅(RULER_GAP＝12px)で割って
        「何BPM分動いたか」を出します。**小数のまま**足すのが要点です
        (v161では整数に丸めていたため、カクついていました)。

        こうすると掴んだ目盛りが指の下から離れず、1px動かせば
        1pxぶんきっちり定規が流れます。

        引き算にしているのは、定規を右へ引っぱると目盛りが右へ流れ、
        中央の赤い線が指す値は小さくなるからです
        (紙の定規を手で押しやる感覚と同じ向きです)。
        */
        targetBpm = targetBpm - (dx / RULER_GAP);

        clampTarget();

        ensureAnimating();

    }

    function end(){

        if(!dragging){ return; }

        dragging = false;

        /*
        指を離したら、いちばん近い目盛りへ吸い寄せます(v162)。

        小数のまま止めると、定規が目盛りの間で半端な位置に居座り、
        画面の数字と定規の絵がずれて見えます。整数へ丸めておけば、
        上の animate() が残りをスッと詰めてくれます。
        */
        targetBpm = Math.round(targetBpm);

        clampTarget();

        ensureAnimating();

        // なぞり終わった時に一度だけ保存します
        const track = libraryMap[currentTrackId];
        if(track){ savePitchToDb(track); }

    }

    // --- 指での操作(スマホ) ---
    rulerCanvas.addEventListener("touchstart",function(event){
        start(event.touches[0].clientX);
    },{passive:true});

    rulerCanvas.addEventListener("touchmove",function(event){
        move(event.touches[0].clientX);
    },{passive:true});

    window.addEventListener("touchend",end);
    window.addEventListener("touchcancel",end);

    // --- マウスでの操作(PCでの確認用) ---
    rulerCanvas.addEventListener("mousedown",function(event){
        start(event.clientX);
    });

    window.addEventListener("mousemove",function(event){
        move(event.clientX);
    });

    window.addEventListener("mouseup",end);

})();


// ==========================================================
// 7. 「元ピッチ」ボタン
// ==========================================================

/*
押すと、その曲本来のテンポ(等速)に戻ります。

applyTempo(1.0) を呼ぶだけで、再生速度・再生ピッチの数字・定規の位置・
userBPM のすべてが基準の値に揃います。竹弘の指定した「定規UI、
再生ピッチ、userBPMがリンクする」がこの1行で実現しています。
*/
(function bindResetPitchButton(){

    const button = document.getElementById("reset-pitch-btn");

    if(!button){ return; }

    button.addEventListener("click",function(){

        if(!libraryMap[currentTrackId]){ return; }

        applyTempo(1.0,true);

    });

})();


// ==========================================================
// 8. 再生ピッチの直打ち入力
// ==========================================================

/*
「再生ピッチ：___」をタップすると開く、数値入力のパネルです。

定規は1BPMずつ動かす道具なので、今120で鳴っている曲を170にしたい
ような時は何度もなぞることになります。目当ての数字が決まっている時は
打ち込んだ方が早い、という竹弘の指示によるものです。
*/

const pitchInputPanel = document.getElementById("pitch-input-panel");
const pitchInput = document.getElementById("pitch-input");
const pitchInputRange = document.getElementById("pitch-input-range");

function openPitchInput(){

    const track = libraryMap[currentTrackId];

    // 曲を選んでいない時は、変える相手がいないので開きません
    if(!track || !pitchInputPanel){ return; }

    const base = getEffectiveBaseBpm(track);

    // 設定できる範囲を先に見せておきます
    const minBpm = Math.round(base * RATE_MIN);
    const maxBpm = Math.round(base * RATE_MAX);

    pitchInputRange.textContent =
        "設定できる範囲：" + minBpm + " 〜 " + maxBpm + " BPM";

    // 今のテンポを入れておきます
    pitchInput.value = currentRulerBpm;

    pitchInputPanel.style.display = "flex";

    /*
    focus() で入力欄に狙いを定め、select() で中の数字を選択状態にします。
    こうしておくと開いた直後にキーを打てばそのまま置き換わるので、
    今入っている数字をいちいち消す手間がありません。

    スマホの数字キーボードもここで開きます。画面のタップから呼ばれて
    いるため、ブラウザに「利用者の操作によるもの」と認めてもらえます
    (勝手に開くキーボードは、どのブラウザでも止められます)。
    */
    pitchInput.focus();
    pitchInput.select();

}

function closePitchInput(){

    if(!pitchInputPanel){ return; }

    pitchInputPanel.style.display = "none";

    // blur() は focus() の逆で、キーボードを引っ込めます
    pitchInput.blur();

}

function commitPitchInput(){

    const track = libraryMap[currentTrackId];

    if(!track){
        closePitchInput();
        return;
    }

    const value = Number(pitchInput.value);

    // 数字として読めない・0以下の時は、何もせずに閉じます
    if(!value || !isFinite(value) || value <= 0){
        closePitchInput();
        return;
    }

    const base = getEffectiveBaseBpm(track);

    /*
    applyTempo には「基準に対する倍率」を渡します。範囲からはみ出す値は
    applyTempo の中で0.5〜2.0倍に丸められるので、ここでは入力された
    数字をそのまま素直に渡しています(丸めの判断を2か所に書くと、
    片方だけ直した時に食い違うため)。

    第2引数の true は「DBに保存する」という意味です。竹弘が自分で
    決めた値なので、次にこの曲を再生した時も同じテンポで鳴ります。

    applyTempo の中で定規も再生ピッチの数字も一緒に更新されるので、
    竹弘の指定した「直打ち変更が定規UIにリアルで反映する」は
    これだけで実現しています。
    */
    applyTempo(value / base,true);

    closePitchInput();

}

(function bindPitchInput(){

    /*
    タップの受け口は、数字だけでなく「再生ピッチ：」を含む左半分
    ぜんぶ(.ua-pitch-now)にしています。走りながら狙うには、
    数字だけでは的が小さすぎるためです。
    */
    const pitchArea = document.querySelector(".ua-pitch-now");

    if(pitchArea){
        pitchArea.addEventListener("click",openPitchInput);
    }

    const okButton = document.getElementById("pitch-input-ok");
    const cancelButton = document.getElementById("pitch-input-cancel");

    if(okButton){
        okButton.addEventListener("click",commitPitchInput);
    }

    if(cancelButton){
        cancelButton.addEventListener("click",closePitchInput);
    }

    /*
    背景の暗い部分をタップしても閉じます。

    event.target === pitchInputPanel で「幕そのものが押された時だけ」に
    限っているのが要点です。この判定が無いと、中の入力欄やボタンを
    押した時にもここへ伝わってきて、操作するそばから閉じてしまいます。
    */
    if(pitchInputPanel){

        pitchInputPanel.addEventListener("click",function(event){

            if(event.target === pitchInputPanel){
                closePitchInput();
            }

        });

    }

    // キーボードのEnterでも決定できるようにします
    if(pitchInput){

        pitchInput.addEventListener("keydown",function(event){

            if(event.key === "Enter"){
                event.preventDefault();
                commitPitchInput();
            }

        });

    }

})();


// ==========================================================
// 9. 大きさが決まったら描く
// ==========================================================

/*
定規は起動時から120を中心に表示します(竹弘の指定)。

ただし、この画面は起動直後は非表示(display:none)で、初期設定が
済んでいることを確認してから表示されます。隠れている間はcanvasの
大きさが0なので、そのタイミングで描いても何も見えません。

ResizeObserver は「この要素の大きさが変わったら教えて」と
ブラウザに頼んでおく仕組みです。画面が表示されて大きさが決まった
瞬間や、端末を横向きにした時にも呼ばれるので、そのたびに
描き直せば常に正しい大きさの定規が出ます。

起動処理(js/main.js)側に手を入れずに済むのも利点です。
*/
(function watchRulerSize(){

    if(!rulerCanvas || !window.ResizeObserver){ return; }

    const observer = new ResizeObserver(function(){

        syncRulerCanvasSize();
        drawRuler(currentRulerBpm);

    });

    observer.observe(rulerCanvas.parentElement);

})();
