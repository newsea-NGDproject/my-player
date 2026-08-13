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
