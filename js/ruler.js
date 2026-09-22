/*
================================================================
 ruler.js … 指でなぞってBPMを選ぶ「定規」の部品(v221で新設)

----------------------------------------------------------------------

【このファイルの役割】

 画面のどこにでも置ける「定規」を1つの部品にしたものです。
 置きたい場所の箱(<div>)を渡して createSwipeRuler() を呼ぶだけで、
 その箱の中に定規が組み立てられます。

     const ruler = createSwipeRuler(箱,{ min:100, max:250, value:170 });
     ruler.start();          // 描き始める(箱を画面に出した後で呼ぶ)
     ruler.getValue();       // 今の値(整数のBPM)
     ruler.stop();           // 描くのをやめる(画面を閉じる時)

----------------------------------------------------------------------

【なぜ部品にしたのか(竹弘の要望、2026-09-22)】

    「一般的なプレイヤーにないUIで直感的でとても気に入ってます。
      今後も機能追加で使って行きたいので、UIとしてJSなどで
      呼び出すなどして一本化できないでしょうか」

 v220までの定規は、置き場所ごとに別々に書かれていました。

     js/setup.js … 初期設定・マイピッチ設定の定規
     js/pitch.js … メインメニュー上半分(エリア7〜8)の定規

 同じ仕組みが2か所にあると、片方だけ直して手触りが食い違う事故が
 起きます(実際 v161〜v162 で「上半分の定規だけ動きが速すぎる」
 「吸い付き方が違う」を1つずつ揃え直しました)。

 これからは、新しく定規を置く時は**必ずこの部品を使う**ことにします。
 最初の利用者は「みんなで走る同期モード」(js/sync.js)です。

 ⚠️ **上の2つの定規は、v221ではまだこの部品に乗せ替えていません。**
    どちらも完成済みの画面で、特に初期設定は起動時に必ず通る道です。
    「完成コードは今回のタスクで触らない」というデグレード防止の
    決まりに従い、**乗せ替えは1つずつ別の版で行います**
    (CLAUDE.md の未実装TODOに登録済み)。

----------------------------------------------------------------------

【手触りは初期設定の定規(js/setup.js)と同じにしてあります】

 竹弘が「初期設定の定規の吸い付く気持ちよさは意識して作成した」と
 言っている、あの動きをそのまま写しました。

     目盛り1つ(1BPM)の間隔 … 20px(setup.js の unitW)
     指を離した後の吸い付き … 1コマごとに残りの25%ずつ近づく
     目盛りの描き方         … 10ごとに長い線と数字、5ごとに中くらい

 setup.js から変えたのは1点だけです。

     ・画面の精細さ(devicePixelRatio)に合わせて描くようにした
       (js/pitch.js が v160頃に入れた改良。スマホで目盛りがにじまない)

----------------------------------------------------------------------

【音は鳴らしません(使う側が鳴らします)】

 初期設定の定規は、触るとカチッとテンポの音が鳴ります。一方、
 メインメニューの定規は曲が鳴っているので音を出しません。
 置き場所によって「鳴らすかどうか」「どの音で鳴らすか」が違うため、
 この部品は**見た目と指の動きだけ**を受け持ちます。

 音を鳴らしたい時は、下の onTouchStart(触り始めた時)と
 getCurrentBpm()(今この瞬間の値)を使って、使う側で鳴らします
 (例:js/sync.js の同期モード)。
================================================================
*/


// ==========================================================
// 1. 見た目と動きを決める数値
// ==========================================================
/*
⚠️ 名前の頭に SWIPE_RULER_ を付けています。

c014 の JavaScript は、ファイルが違っても**名前を全員で共有する**
昔ながらの書き方です(理由は js/config.js の冒頭)。js/pitch.js には
すでに RULER_GAP や RULER_SNAP_RATIO という名前があり、同じ名前で
const を書くと**読み込んだ瞬間にエラーになって、このファイルが
丸ごと動かなくなります。** 頭に目印を付けてぶつからないようにしています。
*/

// 目盛り1つ(1BPM)を何ピクセル離して描くか。js/setup.js の unitW と同じ
const SWIPE_RULER_PX_PER_BPM = 20;

/*
指を離した後、目標の値へ1コマあたり何割ずつ近づくか。

js/setup.js の
    state.bpm += (state.targetBpm - state.bpm) * 0.25; // 吸い付き補完
と同じ値です。大きいほど機敏で硬く、小さいほどぬるっと重い動きに
なります。0.25 は「スッと寄ってぴたりと止まる」ちょうどよい塩梅です。
*/
const SWIPE_RULER_SNAP_RATIO = 0.25;

/*
「もう目標に着いた」とみなす差です。

吸い付きは「残りの25%ずつ近づく」ので、計算上は永久に着きません
(半分の半分の…と、無限に小さくなっていくだけ)。十分近づいたら
目標の値にぴたりと合わせて、描き直しをやめます。
*/
const SWIPE_RULER_SETTLE = 0.001;

// 目盛りの色と太さ(js/setup.js の render() と同じ)
const SWIPE_RULER_BG_COLOR = "#ffffff";
const SWIPE_RULER_LINE_COLOR = "#3a3a3c";
const SWIPE_RULER_TEXT_COLOR = "#1c1c1e";


// ==========================================================
// 2. 定規を作る
// ==========================================================
/**
 * 渡された箱の中に定規を組み立てて、操作するための道具一式を返します。
 *
 * 【「道具一式を返す」とは】
 *
 * この関数は、定規を1つ作るたびに**その定規専用の変数**を持った
 * 関数のまとまり(start / stop / getValue …)を返します。
 * 同じ画面に定規を2つ置いても、それぞれが自分の値を覚えていて
 * 混ざりません。
 *
 * これは「クロージャ」と呼ばれる JavaScript の仕組みです。関数の
 * 中で作った変数(下の value や isDragging)は、関数が終わっても
 * 消えずに、中で作った関数たちからだけ見え続けます。
 *
 * @param {HTMLElement} container - 定規を置く箱(中身は空にしておく)
 * @param {Object}      options
 *        min          {number}   選べる下限のBPM
 *        max          {number}   選べる上限のBPM
 *        value        {number}   最初に指しておくBPM
 *        onChange     {Function} 表示の値(整数)が変わるたびに呼ばれる
 *        onTouchStart {Function} 指で触り始めた時に呼ばれる(音を鳴らす用)
 * @return {Object} 定規を操作する道具一式(下の return を参照)
 */
function createSwipeRuler(container,options){

    const min = options.min;
    const max = options.max;

    const onChange = options.onChange || function(){};
    const onTouchStart = options.onTouchStart || function(){};

    // ---- この定規だけの状態 ----

    // 今この瞬間に中央の赤い線が指している値(小数。吸い付きの途中を含む)
    let currentBpm = clampBpm(options.value);

    // 最終的にたどり着く値(指を離すと整数に丸められます)
    let targetBpm = currentBpm;

    // 指で掴んでいる最中か
    let isDragging = false;

    // 前回の指の位置(横方向)。動いた量を求めるために覚えておきます
    let lastX = 0;

    // 操作を受け付けないようにしているか(setLocked で切り替え)
    let isLocked = false;

    // 描き続けてよいか(start で立て、stop で下ろす)
    let isActive = false;

    /*
    ブラウザに頼んである「次のコマ」の受付番号です。

    requestAnimationFrame は頼むたびに番号を返し、その番号を
    cancelAnimationFrame に渡すと頼みを取り消せます。

    ⚠️ **止める時に取り消さないと、ループが二重に走ります。**
       閉じてすぐ開き直すと、「止まる前に頼んであったコマ」がまだ
       残っていて、開き直しで頼んだコマと合わせて2本のループになり、
       1コマに2回描くようになるためです。
    */
    let frameRequestId = 0;

    // 前回 onChange で知らせた値。変わった時だけ知らせるために覚えます
    let lastNotified = null;

    // 次に絵を描き直す必要があるか
    let needsDraw = true;

    // ---- 部品を組み立てる ----

    /*
    箱の中身は、真ん中の赤い線と、目盛りを描く紙(canvas)の2枚だけです。
    見た目の指定は c014.html の .swipe-ruler 一式にあります。
    */
    container.classList.add("swipe-ruler");

    const centerLine = document.createElement("div");
    centerLine.className = "swipe-ruler-center";

    const canvas = document.createElement("canvas");
    canvas.className = "swipe-ruler-canvas";

    container.appendChild(centerLine);
    container.appendChild(canvas);

    const ctx = canvas.getContext("2d");

    // ---- 値の範囲を守る ----

    /**
     * 値を下限〜上限の中に収めます。
     *
     * 数字でないものが来た時は、範囲の真ん中あたりではなく下限を
     * 返します。ここに来るのは読み込み失敗などの異常時だけなので、
     * 「とにかく壊れない値」であれば十分です。
     */
    function clampBpm(bpm){

        if(typeof bpm !== "number" || !isFinite(bpm)){ return min; }

        return Math.min(Math.max(bpm,min),max);

    }

    // ---- 紙の大きさを合わせる ----

    /**
     * canvas の方眼紙の細かさを、表示の大きさと画面の精細さに合わせます。
     *
     * canvas には「表示上の大きさ(CSS)」と「絵を描く方眼紙の目の
     * 細かさ(width/height)」の2つがあり、ずれていると絵がにじみます。
     * さらにスマホは CSS の1pxを2〜3個の点で描くので(devicePixelRatio)、
     * 方眼紙もその倍率で細かくします(js/pitch.js の
     * syncRulerCanvasSize と同じ考え方)。
     *
     * ⚠️ **箱が画面に出ている時に呼ぶこと。** 隠れている箱は幅が0と
     *    測られ、定規が何も描かれなくなります(js/setup.js にも同じ注意)。
     */
    function syncSize(){

        const ratio = window.devicePixelRatio || 1;

        const cssWidth = container.clientWidth;
        const cssHeight = container.clientHeight;

        if(cssWidth <= 0 || cssHeight <= 0){ return; }

        canvas.width = Math.round(cssWidth * ratio);
        canvas.height = Math.round(cssHeight * ratio);

        /*
        setTransform で筆の側に倍率を教えておくと、この後の描く命令は
        CSS のピクセルのまま書けます(倍率の掛け算を毎回書かずに済む)。
        */
        ctx.setTransform(ratio,0,0,ratio,0,0);

        needsDraw = true;

    }

    // ---- 目盛りを描く ----

    /**
     * 今の値(currentBpm)を中央にして、目盛りを描きます。
     *
     * 描き方は js/setup.js の render() とまったく同じです。
     */
    function draw(){

        const ratio = window.devicePixelRatio || 1;

        const width = canvas.width / ratio;
        const height = canvas.height / ratio;

        if(width <= 0 || height <= 0){ return; }

        const centerX = width / 2;

        ctx.fillStyle = SWIPE_RULER_BG_COLOR;
        ctx.fillRect(0,0,width,height);

        ctx.strokeStyle = SWIPE_RULER_LINE_COLOR;
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";

        /*
        画面に入る範囲の目盛りだけを描きます。
        中央から左右に「画面の半分 ÷ 目盛りの間隔」個ぶんで、端が
        欠けないよう1つずつ余分に描きます。
        */
        const halfCount = centerX / SWIPE_RULER_PX_PER_BPM;

        const start = Math.floor(currentBpm - halfCount) - 1;
        const end = Math.ceil(currentBpm + halfCount) + 1;

        for(let bpm = start; bpm <= end; bpm++){

            // 選べない範囲の目盛りは描きません(下限・上限の外は空白)
            if(bpm < min || bpm > max){ continue; }

            const x = centerX + (bpm - currentBpm) * SWIPE_RULER_PX_PER_BPM;

            ctx.beginPath();
            ctx.moveTo(x,0);

            if(bpm % 10 === 0){

                // 10ごと … 長い線と数字
                ctx.lineWidth = 2;
                ctx.lineTo(x,45);

                ctx.fillStyle = SWIPE_RULER_TEXT_COLOR;
                ctx.fillText(bpm,x,65);

            }
            else if(bpm % 5 === 0){

                // 5ごと … 中くらいの線
                ctx.lineWidth = 1.5;
                ctx.lineTo(x,30);

            }
            else{

                // それ以外 … 短い線
                ctx.lineWidth = 1;
                ctx.lineTo(x,15);

            }

            ctx.stroke();

        }

    }

    // ---- 1コマごとの処理 ----

    /**
     * 画面が描き変わるたび(1秒に約60回)に呼ばれます。
     *
     * requestAnimationFrame は「次に画面を描き変える直前に、この関数を
     * 呼んでください」とブラウザに頼む命令です。自分の最後でもう一度
     * 頼むことで、止めるまで呼ばれ続けます(js/setup.js の render と同じ)。
     */
    function frame(){

        // 止める札が出ていたら、ここで終わります(もう頼み直さない)
        if(!isActive){ return; }

        if(isDragging){

            // 掴んでいる間は、指にぴったり付いてきます
            if(currentBpm !== targetBpm){
                currentBpm = targetBpm;
                needsDraw = true;
            }

        }
        else if(currentBpm !== targetBpm){

            // 離した後は、目標へ少しずつ吸い付きます
            currentBpm += (targetBpm - currentBpm) * SWIPE_RULER_SNAP_RATIO;

            if(Math.abs(targetBpm - currentBpm) < SWIPE_RULER_SETTLE){
                currentBpm = targetBpm;
            }

            needsDraw = true;

        }

        /*
        何も動いていない時は描き直しません。

        js/setup.js の定規は毎コマ描き直していますが、止まっている
        定規を1秒60回描き続けるのは電池の無駄です。**見た目は同じ**で、
        動いている時だけ描くようにしました。
        */
        if(needsDraw){

            draw();

            needsDraw = false;

        }

        /*
        表示の値(整数)が変わった時だけ、使う側へ知らせます。
        毎コマ知らせると、画面の数字を1秒60回書き換えることになります。
        */
        const shown = Math.round(currentBpm);

        if(shown !== lastNotified){

            lastNotified = shown;

            onChange(shown);

        }

        frameRequestId = requestAnimationFrame(frame);

    }

    // ---- 指の動き ----

    /*
    指とマウスを1つの書き方で扱える「ポインターイベント」を使います。

        pointerdown … 触った(押した)
        pointermove … 触ったまま動かした
        pointerup   … 離した
        pointercancel … ブラウザの都合で操作が打ち切られた

    setPointerCapture は「離すまで、この指の動きは全部この定規に
    届けてください」という頼みです。これが無いと、指が定規の外へ
    はみ出した瞬間に動きが届かなくなり、定規が途中で止まります
    (js/setup.js が window 全体で動きを聞いていたのと同じ狙いを、
    定規の中だけで済ませています)。
    */
    canvas.addEventListener("pointerdown",function(event){

        if(isLocked){ return; }

        isDragging = true;

        lastX = event.clientX;

        try{
            canvas.setPointerCapture(event.pointerId);
        }
        catch(error){
            // 捕まえられなくても、定規の上で動かす分には困りません
        }

        onTouchStart();

    });

    canvas.addEventListener("pointermove",function(event){

        if(!isDragging){ return; }

        const deltaX = event.clientX - lastX;

        /*
        指を**左へ**動かすと数字が**大きく**なります(js/setup.js と同じ)。
        定規そのものを指で引っ張っている感覚で、左へ引けば右側の
        大きい目盛りが中央へ来るためです。
        */
        targetBpm = clampBpm(targetBpm - deltaX / SWIPE_RULER_PX_PER_BPM);

        lastX = event.clientX;

    });

    /**
     * 指を離した時(または打ち切られた時)の後片付けです。
     *
     * 目標を整数に丸めるので、ここから吸い付きが始まります。
     */
    function endDrag(){

        if(!isDragging){ return; }

        isDragging = false;

        targetBpm = clampBpm(Math.round(targetBpm));

    }

    canvas.addEventListener("pointerup",endDrag);
    canvas.addEventListener("pointercancel",endDrag);

    // ---- 外から使う道具一式 ----

    return {

        /**
         * 描き始めます。**箱を画面に出した後で呼ぶこと**(syncSize の注意)。
         */
        start: function(){

            syncSize();

            needsDraw = true;
            lastNotified = null;

            // すでに動いている時に二重に頼むと、1コマに2回描くことになります
            if(isActive){ return; }

            isActive = true;

            frameRequestId = requestAnimationFrame(frame);

        },

        /**
         * 描くのをやめます。画面を閉じる時に必ず呼ぶこと。
         * 止めないと、見えていない定規を裏で見張り続けます。
         */
        stop: function(){

            isActive = false;

            // 頼んであった次のコマも取り消します(frameRequestId のコメント)
            cancelAnimationFrame(frameRequestId);

            endDrag();

        },

        /**
         * 最終的な値(整数のBPM)を返します。
         *
         * 吸い付きの途中で聞かれても、たどり着く先の値を返します。
         * 掴んでいる最中なら、その時点の値を丸めて返します。
         */
        getValue: function(){

            return clampBpm(Math.round(targetBpm));

        },

        /**
         * 今この瞬間に中央が指している値(小数)を返します。
         *
         * テンポの音を鳴らす時に使います。吸い付きの途中の値も
         * そのまま返すので、js/setup.js の定規と同じく、指の動きに
         * 合わせて音の速さもなめらかに変わります。
         */
        getCurrentBpm: function(){

            return currentBpm;

        },

        /**
         * 値を外から決めます(吸い付かずに、その場へ飛びます)。
         */
        setValue: function(bpm){

            currentBpm = clampBpm(Math.round(bpm));
            targetBpm = currentBpm;

            needsDraw = true;
            lastNotified = null;

        },

        /**
         * 操作を受け付けるかどうかを切り替えます。
         *
         * true にすると、触っても動かなくなります。見た目(灰色にする等)は
         * 使う側がCSSで決めます(置き場所によって見せ方が違うため)。
         */
        setLocked: function(locked){

            isLocked = !!locked;

            if(isLocked){ endDrag(); }

        }

    };

}
