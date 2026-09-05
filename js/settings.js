/*
================================================================
 settings.js … 設定メニュー(⚙️)とライセンス表示

----------------------------------------------------------------------

【このファイルの役割】

 上半分エリア10の ⚙️ ボタンを押した時に開くメニューと、そこから
 選ぶ画面を受け持ちます。

 竹弘の指示により、見た目も操作も曲一覧の並び替えメニュー
 (js/sort.js)とまったく同じにしてあります。

     「曲一覧のソートボタンと同じように、
       設定ボタンを押したらメニューを用意して欲しい」

 CSSも #sort-menu / .sort-menu-item と共有しているため、
 片方の見た目を直せば両方に効きます。

----------------------------------------------------------------------

【今ある項目】

     📜 ライセンス … 使用している外部ライブラリのライセンス表記

 ライセンス表示は2026-08-08に竹弘と約束していたもので、有償販売
 するアプリのため表記漏れは許されません。文面は docs/licenses.md の
 「掲載する文面」を c014.html にそのまま載せてあります。
 ライブラリを増やした時は、docs/licenses.md と c014.html の
 両方を更新すること。

 項目を増やす時は、下の SETTINGS_DEFINITIONS に1行足して、
 openSettingsItem() に処理を書き足します。
================================================================
*/


// ==========================================================
// 1. メニューの項目
// ==========================================================
/*
ここに並べた順で、そのままメニューに出ます。

  key   … どの項目が選ばれたかを見分けるための名前
  icon  … 行の先頭に出す記号
  label … 画面に出す文字

js/sort.js の SORT_DEFINITIONS と同じ形にしてあります。
*/
const SETTINGS_DEFINITIONS = [
    {
        key: "connect",
        icon: "🎚️",
        label: "曲の繋ぎ方"
    },
    {
        key: "metronome",
        icon: "🥁",
        label: "メトロノーム"
    },
    {
        key: "license",
        icon: "📜",
        label: "ライセンス"
    }
];


// ==========================================================
// 2. メニューの表示
// ==========================================================

/**
 * メニューの中身を作り直します。
 */
function renderSettingsMenu(){

    const menu = document.getElementById("settings-menu");

    if(!menu){ return; }

    menu.innerHTML = "";

    SETTINGS_DEFINITIONS.forEach(function(definition){

        const item = document.createElement("button");
        item.type = "button";
        item.className = "settings-menu-item";

        /*
        並び替えメニューは3つ目に ▲▼ を出しますが、こちらには
        並び順という考え方がありません。それでも空のspanを1つ
        置いているのは、CSSを共有しているためです(項目の横幅の
        配分が、記号・文字・余白の3つで決まっています)。
        */
        item.innerHTML =
            "<span class='settings-icon'>" + definition.icon + "</span>" +
            "<span>" + definition.label + "</span>" +
            "<span></span>";

        item.addEventListener("click",function(){
            openSettingsItem(definition.key);
        });

        menu.appendChild(item);

    });

}

/**
 * メニューを開きます。
 *
 * 位置の決め方は js/sort.js の openSortMenu() とほぼ同じですが、
 * 横位置の扱いだけ違います(下の解説を参照)。
 */
function openSettingsMenu(){

    const menu = document.getElementById("settings-menu");
    const button = document.getElementById("settings-btn");

    if(!menu || !button){ return; }

    renderSettingsMenu();

    /*
    大きさを測るために、いったん表示します。
    visibility:hidden は「場所は取るが見えない」状態で、
    display:none(場所も取らない)と違って大きさを測れます。
    */
    menu.style.visibility = "hidden";
    menu.style.display = "block";

    const buttonRect = button.getBoundingClientRect();
    const menuHeight = menu.offsetHeight;
    const menuWidth = menu.offsetWidth;

    // --- 縦の位置 ---

    // 基本はボタンのすぐ下
    let top = buttonRect.bottom + 6;

    /*
    ⚙️ は画面のかなり下(エリア10)にあるため、下に開くと
    ほぼ必ず画面からはみ出します。その時はボタンの上側に開きます。
    */
    if(top + menuHeight > window.innerHeight - 8){
        top = buttonRect.top - menuHeight - 6;
    }

    if(top < 8){
        top = 8;
    }

    // --- 横の位置 ---

    /*
    並び替えボタン(⇅)は画面の左寄りにあるので、js/sort.js は
    メニューの左端をボタンの左端に合わせるだけで済んでいました。

    一方 ⚙️ は画面の右端近くにあるため、同じことをすると
    メニューが画面の外へはみ出します。そこで、はみ出す時は
    「メニューの右端をボタンの右端に合わせる」形に切り替えます。
    (右揃えで開く、という言い方をします)
    */
    let left = buttonRect.left;

    if(left + menuWidth > window.innerWidth - 8){
        left = buttonRect.right - menuWidth;
    }

    if(left < 8){
        left = 8;
    }

    menu.style.top = top + "px";
    menu.style.left = left + "px";

    menu.style.visibility = "visible";

}

function closeSettingsMenu(){

    const menu = document.getElementById("settings-menu");

    if(!menu){ return; }

    menu.style.display = "none";

}

function isSettingsMenuOpen(){

    const menu = document.getElementById("settings-menu");

    return (menu && menu.style.display !== "none");

}


// ==========================================================
// 3. 項目が選ばれた時
// ==========================================================

/**
 * メニューの項目が選ばれた時に呼ばれます。
 *
 * 項目を増やした時は、ここに分岐を足します。
 */
function openSettingsItem(key){

    closeSettingsMenu();

    if(key === "connect"){
        openConnectPanel();
    }

    if(key === "metronome"){
        openMetronomePanel();
    }

    if(key === "license"){
        openLicensePanel();
    }

}


// ==========================================================
// 3-2. 曲の繋ぎ方(v172)
// ==========================================================
/*
🕺ノリノリRun再生で、曲と曲を何拍かけて入れ替えるかを選びます。

【なぜ設定画面に置いたか】

竹弘の指示:「メニューのレイアウトは今のテストで崩したくないから、
設定ボタンに16拍と8拍で選択できるようにできないかな」

上半分は10等分の窮屈な作りで、ボタンを1つ足すと他の段が潰れます。
実機テストの最中にレイアウトが変わると、何を確かめているのか
分からなくなるため、設定の中に入れました。

【この画面の位置づけ】

いまは長さを聞き比べるためのものですが、竹弘と約束している
「脳内整理モード(曲と曲の間を開けて繋ぐ)」の設定も、いずれ
ここに並びます。**その時のための入口**でもあります。
*/

/**
 * 選ばれている方のボタンに印を付け直します。
 */
function refreshConnectPanel(){

    const panel = document.getElementById("connect-panel");

    if(!panel){ return; }

    /*
    querySelectorAll は「その条件に当てはまる要素を全部」返します。
    ここでは選択肢のボタン2つが取れます。
    */
    panel.querySelectorAll(".connect-choice").forEach(function(button){

        /*
        data-beats / data-silence はHTML側に書いた「この選択肢は
        フェード何拍・無音何拍か」です。dataset で読み出すと文字列で
        返るので、Number() で数に直して比べます
        (文字の "16" と数の 16 は === では一致しないため)。
        */
        const beats   = Number(button.dataset.beats);
        const silence = Number(button.dataset.silence);

        /*
        **2つとも一致した選択肢だけ**に印を付けます。フェードの長さが
        同じでも、無音の有無が違えば別の設定だからです。

        classList.toggle は、第2引数が true ならクラスを付け、
        false なら外します。if文を書かずに済む書き方です。
        */
        const isOn = (beats === crossfadeBeats && silence === silenceBeats);

        button.classList.toggle("connect-choice-on",isOn);

    });

}

function openConnectPanel(){

    const panel = document.getElementById("connect-panel");

    if(!panel){ return; }

    refreshConnectPanel();

    panel.style.display = "flex";

    const body = panel.querySelector(".license-body");

    if(body){ body.scrollTop = 0; }

}

function closeConnectPanel(){

    const panel = document.getElementById("connect-panel");

    if(!panel){ return; }

    panel.style.display = "none";

}


// ==========================================================
// 3-3. メトロノーム(v177)
// ==========================================================
/*
🕺ノリノリRun再生で、拍に合わせてカチッと鳴らすかを選びます。

【なぜ設定画面に置いたか】
竹弘の指示(2026-09-05):「ON、OFFは設定ボタンにてお願いします」。
上半分の画面は10等分の窮屈な作りで、ボタンを1つ足すと他の段が
潰れます(「曲の繋ぎ方」を設定に入れたのと同じ理由)。

【なぜON/OFFなのに画面を開く形にしたか】
メニューを押しただけで切り替わる形(トグル)にもできますが、
2つ理由があって画面を開く形にしました。

  ① いま鳴る設定なのかが、開けば一目で分かる
  ② 竹弘と約束している「メトロノーム音を手拍子(クラップ)に
     変えられるようにする」を足す場所が、ここに要る

鳴らす/鳴らさない の実際の処理は js/metronome.js にあります。
*/

/**
 * 選ばれている方のボタンに印を付け直します。
 */
function refreshMetronomePanel(){

    const panel = document.getElementById("metronome-panel");

    if(!panel){ return; }

    panel.querySelectorAll(".connect-choice").forEach(function(button){

        /*
        data-metronome は "on" か "off" という**文字**です。
        metronomeEnabled は true/false なので、比べる前に
        同じ形に直します。
        */
        const isOn = (button.dataset.metronome === "on");

        button.classList.toggle("connect-choice-on",isOn === metronomeEnabled);

    });

}

function openMetronomePanel(){

    const panel = document.getElementById("metronome-panel");

    if(!panel){ return; }

    refreshMetronomePanel();

    panel.style.display = "flex";

    const body = panel.querySelector(".license-body");

    if(body){ body.scrollTop = 0; }

}

function closeMetronomePanel(){

    const panel = document.getElementById("metronome-panel");

    if(!panel){ return; }

    panel.style.display = "none";

}


// ==========================================================
// 4. ライセンス表示画面
// ==========================================================

function openLicensePanel(){

    const panel = document.getElementById("license-panel");

    if(!panel){ return; }

    panel.style.display = "flex";

    /*
    前回開いた時のスクロール位置が残らないよう、先頭に戻します。
    竹弘がソートの時に指摘した「見たいのは頭からなのに途中から
    始まる」のと同じ理屈で、開いた時は必ず1行目から読めるように
    しておきます。
    */
    const body = panel.querySelector(".license-body");

    if(body){ body.scrollTop = 0; }

}

function closeLicensePanel(){

    const panel = document.getElementById("license-panel");

    if(!panel){ return; }

    panel.style.display = "none";

}


// ==========================================================
// 5. ボタンの結び付け
// ==========================================================

(function bindSettingsButton(){

    const button = document.getElementById("settings-btn");

    if(!button){ return; }

    button.addEventListener("click",function(event){

        /*
        stopPropagation は「このタップを親の要素へ伝えない」という
        命令です。これが無いと、下で登録している「画面のどこかが
        タップされたらメニューを閉じる」処理にもこのタップが届き、
        開いた瞬間に閉じてしまいます。
        */
        event.stopPropagation();

        if(isSettingsMenuOpen()){
            closeSettingsMenu();
        }
        else{
            openSettingsMenu();
        }

    });

    // メニューの外側をタップしたら閉じます
    document.addEventListener("click",function(event){

        if(!isSettingsMenuOpen()){ return; }

        const menu = document.getElementById("settings-menu");

        // メニューの中を押した時は閉じません(項目を選んだ時は別途閉じます)
        if(menu && menu.contains(event.target)){ return; }

        closeSettingsMenu();

    });

    // ライセンス画面の閉じるボタン(✕)
    const closeBtn = document.getElementById("license-close-btn");

    if(closeBtn){
        closeBtn.addEventListener("click",function(){
            closeLicensePanel();
        });
    }

    // 曲の繋ぎ方の画面(v172)
    const connectCloseBtn = document.getElementById("connect-close-btn");

    if(connectCloseBtn){
        connectCloseBtn.addEventListener("click",function(){
            closeConnectPanel();
        });
    }

    /*
    長さの選択肢(16拍 / 8拍)。

    ボタンを1つずつ書かず、まとめて耳を付けています。将来
    選択肢が増えても、HTMLに1行足すだけでここは直さずに済みます。
    */
    document.querySelectorAll("#connect-panel .connect-choice").forEach(function(button){

        button.addEventListener("click",function(){

            /*
            setConnectStyle(js/connect.js)は保存まで済ませます。
            await せずに呼んでいるのは、保存の完了を待たなくても
            画面と次の接続には即座に効くためです(設定の値そのものは
            この関数の中で先に切り替わります)。
            */
            setConnectStyle(
                Number(button.dataset.beats),
                Number(button.dataset.silence)
            );

            // 選ばれている印を付け替えます
            refreshConnectPanel();

        });

    });

    // メトロノームの画面(v177)
    const metronomeCloseBtn = document.getElementById("metronome-close-btn");

    if(metronomeCloseBtn){
        metronomeCloseBtn.addEventListener("click",function(){
            closeMetronomePanel();
        });
    }

    /*
    鳴らす / 鳴らさない の選択肢。

    繋ぎ方の選択肢とまったく同じ作りです。まとめて耳を付けているので、
    将来「手拍子で鳴らす」を足す時も、HTMLに1行足すだけで済みます。
    */
    document.querySelectorAll("#metronome-panel .connect-choice").forEach(function(button){

        button.addEventListener("click",function(){

            /*
            setMetronomeEnabled(js/metronome.js)は保存まで済ませます。
            await せずに呼んでいるのは、保存の完了を待たなくても
            音と画面には即座に効くためです(繋ぎ方の設定と同じ)。
            */
            setMetronomeEnabled(button.dataset.metronome === "on");

            refreshMetronomePanel();

        });

    });

})();
