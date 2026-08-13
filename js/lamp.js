/*
======================================================================
 lamp.js ── 解析状況ランプの表示

----------------------------------------------------------------------

【このファイルの役割】

 画面の右上に出る、小さな状況ランプ(#ofs-lamp)の見た目を
 切り替えます。曲情報の解析が今どこまで進んでいるかを、
 竹弘に一目で伝えるためのものです。

   フェーズ1 … 🟡 黄・速い点滅  「曲データ取込中 3/369」
   フェーズ2 … 🟢 緑・普通の点滅「ジャケ写同期 3/369」
   フェーズ3 … 🔵 青・常時点灯  「全工程完了」→5秒後に消える

 このほか、異常を知らせる赤いランプ(showLampError)もあります。
 こちらは自動では消えません。

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
 * 「曲を探しています」の表示を出します(スキャン中)。
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
    const lampIcon = document.getElementById("ofs-lamp-icon");

    if(!lamp || !lampText || !lampIcon){ return; }

    lampPhase = 0;

    lamp.style.display = "flex";
    lamp.style.opacity = "1";
    lamp.style.background = "#f2f2f7";
    lamp.style.color = "#8e8e93";

    lampText.innerText = "曲を探しています";
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
    const lampIcon = document.getElementById("ofs-lamp-icon");

    if(!lamp || !lampText || !lampIcon){ return; }

    lampPhase = phase;

    lamp.style.display = "flex";
    lamp.style.opacity = "1";

    if(phase === 1){

        lamp.style.background = "#fff9e6";
        lamp.style.color = "#ff9500";
        lampText.innerText = "曲データ取込中" + buildProgressText(doneCount,totalCount);
        lampIcon.innerText = "🟡";
        lampIcon.className = "blink-fast";

    }
    else if(phase === 2){

        lamp.style.background = "#f2fbe6";
        lamp.style.color = "#34c759";
        lampText.innerText = "ジャケ写同期" + buildProgressText(doneCount,totalCount);
        lampIcon.innerText = "🟢";
        lampIcon.className = "blink-normal";

    }
    else if(phase === 3){

        lamp.style.background = "#e6f6ff";
        lamp.style.color = "#007aff";
        lampText.innerText = "全工程完了";
        lampIcon.innerText = "🔵";

        // classNameを空にして点滅アニメを解除し、常時点灯にします。
        lampIcon.className = "";

        hideLampAfterDelay();

    }

}

/*
異常を知らせる赤いランプを出します(消えません)。

ライブラリの読み込み失敗のように「竹弘が気づかないと
先に進めない問題」を、画面上ではっきり伝えるためのものです。
通常のフェーズ表示と違い、自動では消しません。
*/
function showLampError(message){

    const lamp = document.getElementById("ofs-lamp");
    const lampText = document.getElementById("ofs-lamp-text");
    const lampIcon = document.getElementById("ofs-lamp-icon");

    if(!lamp || !lampText || !lampIcon){ return; }

    lamp.style.display = "flex";
    lamp.style.opacity = "1";
    lamp.style.background = "#ffebe6";
    lamp.style.color = "#ff453a";

    lampText.innerText = message;
    lampIcon.innerText = "⚠️";
    lampIcon.className = "blink-fast";

}

/*
「3/50」のような進捗の文字を作ります。
解析対象が無い場合は何も付けません。
*/
function buildProgressText(doneCount,totalCount){

    if(!totalCount){ return ""; }

    return " " + doneCount + "/" + totalCount;

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
