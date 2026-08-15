/*
======================================================================
 lamp.js ── 解析状況ランプの表示

----------------------------------------------------------------------

【このファイルの役割】

 画面の右上に出る、小さな状況ランプ(#ofs-lamp)の見た目を
 切り替えます。曲情報の解析が今どこまで進んでいるかを、
 竹弘に一目で伝えるためのものです。

   フェーズ1 … 🟡 黄・速い点滅  「曲データ取込中」
   フェーズ2 … 🟢 緑・普通の点滅「ジャケ写同期」
   フェーズ3 … 🔵 青・常時点灯  「全工程完了」→5秒後に消える

 このほか、異常を知らせる赤いランプ(showLampError)もあります。
 こちらは自動では消えません。

----------------------------------------------------------------------

【ランプの行数(v89-v90、竹弘の指示)】

 ランプは「進捗の数字を持つ表示だけ」縦2行になります。

     1行目(#ofs-lamp-text)     … 今なにをしているか
     2行目(#ofs-lamp-progress  … 進捗(18/371)
           + #ofs-lamp-icon)      とランプの色。右詰め

 表示は次のようになります。

     曲データ取込中            全工程完了 🔵
         18/371 🟡

     ↑進捗あり:2行            ↑進捗なし:1行

 v88までは横1行に「曲データ取込中 18/371」と並べていましたが、
 それだと解析が進んで桁数が増えるほどランプが横に伸び、
 画面の狭い端末で中央のタイトル「ノリRun」に近づいてしまいます。

 進捗を2行目へ逃がすと、ランプの幅は1行目の文言だけで決まるため、
 3/371 でも 300/371 でも横幅が一切変わりません。

 一方、進捗を持たない表示まで2行にすると、2行目にランプの色だけが
 ぽつんと残って間が抜けて見えます(竹弘の指摘「色だけの行は寂しい」)。
 そこで v90 から、進捗が無い表示は1行に戻しました。
 切り替えは applyLampLineMode() が進捗の有無だけを見て自動で行います。

 実際に「いつどのフェーズにするか」を決めているのは metadata.js で、
 このファイルは頼まれた通りに表示を変えるだけの担当です。

----------------------------------------------------------------------

【この演出の出どころ】

 legacy/ver8.5-gemini の OFS Ver1.1 から移植したものです。
 ただし legacy版は固定ウェイト(150ms・400ms)で見た目だけを
 再現した「演出シミュレーター」で、実際のタグ読み取りは
 行っていませんでした。

 今回は固定ウェイトを全て外し、本物の解析の進捗に連動させて
 います。見え方は legacy と同じですが、中身は本物です。

 ランプは解析が必要な曲がある時だけ出ます。全曲解析済みなら
 一度も表示されません(竹弘の「最速起動」方針)。
======================================================================
*/


// 現在のランプのフェーズ(0:非表示, 1:文字取込, 2:ジャケ写, 3:完了)
let lampPhase = 0;


/**
 * 「曲探索中」の表示を出します(スキャン中)。
 *
 * メインメニューを開いた直後、Musicフォルダの中に新しい曲が
 * 追加されていないかを調べる間だけ表示します。
 *
 * 【色を灰色にしている理由】
 * 竹弘が作った 黄🟡 → 緑🟢 → 青🔵 の3フェーズ演出は、
 * 「曲データを取り込んでいく流れ」を表す大事な演出です。
 * スキャンはその前の準備段階なので、3色のどれとも重ならない
 * 灰色にして、演出の流れを崩さないようにしています。
 */
function setLampScanning(){

    const lamp = document.getElementById("ofs-lamp");
    const lampText = document.getElementById("ofs-lamp-text");
    const lampProgress = document.getElementById("ofs-lamp-progress");
    const lampIcon = document.getElementById("ofs-lamp-icon");

    if(!lamp || !lampText || !lampProgress || !lampIcon){ return; }

    // 前に警告ランプを押せる状態にしていた場合は元へ戻す
    resetLampInteraction(lamp);

    lampPhase = 0;

    lamp.style.display = "flex";
    lamp.style.opacity = "1";
    lamp.style.background = "#f2f2f7";
    lamp.style.color = "#8e8e93";

    /*
    文言は v90 で「曲を探しています」から「曲探索中」に短くしました
    (竹弘の指示)。1行で表示するため、短いほどタイトルから離れます。
    */
    lampText.innerText = "曲探索中";

    // 進捗の数字は無いので、「曲探索中 🔍」の1行で表示します
    lampProgress.innerText = "";
    applyLampLineMode(lamp,lampProgress.innerText);

    lampIcon.innerText = "🔍";
    lampIcon.className = "blink-normal";

}

/*
スキャンが終わり、かつ解析するものが何も無かった時に
ランプを消します。

setLampPhase(3)(青・全工程完了)と違い、余韻を見せずに
すっと消すのは、新しい曲が無かった時にまで「完了しました」と
知らせる必要がないためです。竹弘の「最速起動」の方針により、
何も起きていない時のランプは出さないのが基本です。
*/
function hideLampNow(){

    const lamp = document.getElementById("ofs-lamp");
    if(!lamp){ return; }

    lampPhase = 0;

    lamp.style.opacity = "0";

    setTimeout(function(){

        /*
        消えるまでの0.5秒の間に、別の表示(黄色の取込中など)が
        始まっていた場合は、消さずにそのままにします。
        これが無いと、せっかく出た次の表示を後から
        消してしまう事故が起こりえます。
        */
        if(lampPhase !== 0){ return; }

        lamp.style.display = "none";

    },500);

}


/**
 * 解析状況ランプの表示を切り替えます。
 *
 * phase 1 … 黄・速い点滅  「曲データ取込中」
 * phase 2 … 緑・普通の点滅「ジャケ写同期」
 * phase 3 … 青・常時点灯  「全工程完了」→5秒後に消滅
 */
function setLampPhase(phase,doneCount,totalCount){

    const lamp = document.getElementById("ofs-lamp");
    const lampText = document.getElementById("ofs-lamp-text");
    const lampProgress = document.getElementById("ofs-lamp-progress");
    const lampIcon = document.getElementById("ofs-lamp-icon");

    if(!lamp || !lampText || !lampProgress || !lampIcon){ return; }

    // 前に警告ランプを押せる状態にしていた場合は元へ戻す
    resetLampInteraction(lamp);

    lampPhase = phase;

    lamp.style.display = "flex";
    lamp.style.opacity = "1";

    /*
    v88までは1行目に「曲データ取込中 18/371」とまとめて入れて
    いましたが、v89の2行組みでは進捗を2行目(lampProgress)へ
    分けて入れます。文言と進捗の入れ先が違うだけで、
    表示される中身は今までと同じです。
    */
    if(phase === 1){

        lamp.style.background = "#fff9e6";
        lamp.style.color = "#ff9500";
        lampText.innerText = "曲データ取込中";
        lampProgress.innerText = buildProgressText(doneCount,totalCount);
        lampIcon.innerText = "🟡";
        lampIcon.className = "blink-fast";

    }
    else if(phase === 2){

        lamp.style.background = "#f2fbe6";
        lamp.style.color = "#34c759";
        lampText.innerText = "ジャケ写同期";
        lampProgress.innerText = buildProgressText(doneCount,totalCount);
        lampIcon.innerText = "🟢";
        lampIcon.className = "blink-normal";

    }
    else if(phase === 3){

        lamp.style.background = "#e6f6ff";
        lamp.style.color = "#007aff";
        lampText.innerText = "全工程完了";

        // 進捗の数字は不要なので「全工程完了 🔵」の1行になります
        lampProgress.innerText = "";

        lampIcon.innerText = "🔵";

        // classNameを空にして点滅アニメを解除し、常時点灯にします。
        lampIcon.className = "";

        hideLampAfterDelay();

    }

    /*
    最後に、いま入れた進捗の有無を見て1行か2行かを決めます。

    3つのフェーズそれぞれに同じ処理を書かず、ここで1回だけ
    呼んでいるのは、フェーズを増やした時に書き忘れて
    そこだけ行数が食い違う事故を防ぐためです。
    */
    applyLampLineMode(lamp,lampProgress.innerText);

}

/*
ランプを「ただの表示」の状態に戻します。

【なぜこれが必要か】

ランプのCSSには pointer-events:none が指定されています。
これは「ランプの下にある曲名などを指でタップできるように、
ランプ自体は指に反応しない」ようにするための設定です。

ただし後述の showLampError() だけは例外で、竹弘がタップして
フォルダの許可を取り直せるよう、一時的に指に反応する状態へ
切り替えます。その後で別の表示に変わる時、反応する状態が
残っていると曲名がタップできなくなってしまうため、
表示を切り替えるたびにここで元へ戻します。
*/
function resetLampInteraction(lamp){

    lamp.style.pointerEvents = "none";
    lamp.style.cursor = "";
    lamp.style.padding = "";
    lamp.onclick = null;

}

/*
異常を知らせる赤いランプを出します(消えません)。

ライブラリの読み込み失敗のように「竹弘が気づかないと
先に進めない問題」を、画面上ではっきり伝えるためのものです。
通常のフェーズ表示と違い、自動では消しません。

【第2引数 onTapHandler について(v76で追加)】

タップされた時に実行したい処理を渡すと、ランプが押せるように
なります。渡さなければ、これまで通りただの表示です。

Musicフォルダの許可が切れた時に使っています。ブラウザの決まりで
「許可をください」という命令(requestPermission)は画面をタップ
した瞬間しか呼べないため、竹弘に一度タップしてもらう必要が
あるためです。新しくボタンを増やさず、すでに出ている警告ランプを
そのまま押してもらう形にしています。
*/
function showLampError(message,onTapHandler){

    const lamp = document.getElementById("ofs-lamp");
    const lampText = document.getElementById("ofs-lamp-text");
    const lampProgress = document.getElementById("ofs-lamp-progress");
    const lampIcon = document.getElementById("ofs-lamp-icon");

    if(!lamp || !lampText || !lampProgress || !lampIcon){ return; }

    resetLampInteraction(lamp);

    lampPhase = 0;

    lamp.style.display = "flex";
    lamp.style.opacity = "1";
    lamp.style.background = "#ffebe6";
    lamp.style.color = "#ff453a";

    lampText.innerText = message;

    /*
    警告に進捗の数字は無いので「タップして許可 ⚠️」のように1行で出ます。

    1行にすると横に長くなり、画面の狭い端末では中央のタイトル
    「ノリRun」に重なることがありますが、竹弘の判断でそのままに
    しています。

        「警告に関しては目立つ必要がある為、
          被るくらいで違和感があった方がよい」

    重なった時にランプが上に来るよう、CSSの #ofs-lamp には
    z-index:10 が指定してあります。
    */
    lampProgress.innerText = "";
    applyLampLineMode(lamp,lampProgress.innerText);

    lampIcon.innerText = "⚠️";
    lampIcon.className = "blink-fast";

    /*
    typeof で「関数が渡されたか」を確かめてから有効にします。
    何も渡されなかった場合(従来の使い方)は、上の
    resetLampInteraction で戻したままなので押せません。
    */
    if(typeof onTapHandler === "function"){

        // 指に反応するようにする(CSSのpointer-events:noneを上書き)
        lamp.style.pointerEvents = "auto";
        lamp.style.cursor = "pointer";

        // 押しやすいよう、この時だけ少し大きくする
        lamp.style.padding = "8px 12px";

        lamp.onclick = onTapHandler;

    }

}

/*
「3/50」のような進捗の文字を作ります。
解析対象が無い場合は何も付けません。

v88までは前の文言と続けて1行に並べていたため、区切りとして
先頭に半角スペースを1つ付けていました。v89でランプが2行組みに
なり、この文字は2行目に独立して置かれるようになったので、
その半角スペースを外しています(残っていると2行目だけ
1文字分よけいに幅を取ってしまうため)。
*/
function buildProgressText(doneCount,totalCount){

    if(!totalCount){ return ""; }

    return doneCount + "/" + totalCount;

}

/*
ランプを1行で出すか2行で出すかを決めます(v90)。

判断はとても単純で、進捗の数字があれば2行、無ければ1行です。

    曲データ取込中          ← 進捗あり:2行のまま
        18/371 🟡

    全工程完了 🔵           ← 進捗なし:1行に戻す

竹弘の「色だけの行は寂しい」という指摘への対応です。

【classList.add / remove とは】

HTMLの要素に付いているクラス名を、後から足したり外したりする
命令です。ここでは lamp-oneline というクラスを付け外ししていて、
実際に横1行へ切り替えているのは c014.html 側のCSS
(#ofs-lamp.lamp-oneline)です。

「JSは “どういう状態か” を伝えるだけ、見た目の作り方はCSSが決める」
という分担にしておくと、後から行間や隙間を調整したくなった時に
CSSだけ直せば済みます。

【なぜ表示ごとに書かず、この関数にまとめたのか】

ランプの種類は今5つ(曲探索中/フェーズ1/2/3/警告)あり、今後
増える可能性もあります。それぞれに「ここは1行」「ここは2行」と
書いて回ると、必ずどこかで書き忘れが起きます。
「進捗が空かどうか」という1つのルールに集約しておけば、
新しい表示を足しても自動的に正しい行数になります。
*/
function applyLampLineMode(lamp,progressText){

    if(progressText === ""){
        lamp.classList.add("lamp-oneline");
    }
    else{
        lamp.classList.remove("lamp-oneline");
    }

}

/*
完了の余韻を5秒キープしてから、0.5秒かけてフワッと消します。
(CSSのtransition:opacityが効くため、opacityを0にするだけで
 滑らかに消えていきます)
*/
function hideLampAfterDelay(){

    setTimeout(function(){

        const lamp = document.getElementById("ofs-lamp");
        if(!lamp){ return; }

        lamp.style.opacity = "0";

        setTimeout(function(){
            lamp.style.display = "none";
        },500);

    },5000);

}
