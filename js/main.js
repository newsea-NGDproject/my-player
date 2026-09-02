/*
======================================================================
 main.js ── 起動処理

----------------------------------------------------------------------

【このファイルの役割】

 メインメニューを開いた時に、最初に動くファイルです。
 やることは3つ。

   ① music_library から曲を読み込んで、一覧を表示する
   ② Musicフォルダを調べて、新しく増えた曲を登録する
   ③ タイトルやジャケットのメタデータを解析する

 このファイルは他の全ファイルの関数を使うため、
 c014.html の読み込み順で必ず一番最後に置きます。

----------------------------------------------------------------------

【なぜこの順番なのか】

 竹弘の方針「曲再生機能を妨げない最速起動」に沿って、
 重い処理は全部あとに回しています。

   1. まず一覧を表示  → この時点ですぐ曲を再生できる
   2. 裏でフォルダを調べる → 新しい曲があれば一覧に足す
   3. 裏でメタデータ解析   → タイトルやジャケットが順に埋まる

 ②③を待ってから一覧を出す作りにすると、369曲では起動に
 何十秒もかかってしまいます。

----------------------------------------------------------------------

【②のスキャンがここに来た経緯(v75)】

 以前は c013.html という独立した画面が担当していました。
 しかし竹弘の指摘

     「ノリRun利用者に無駄な操作をさせたくない。
       他の音楽プレイヤーと同じように、起動したら
       メインメニューが出てほしい」

 の通り、曲を1曲も追加していなくても毎回

     c013で「Musicフォルダ確認」→「OK」→「OK」

 と3回タップさせる作りになっていました。スキャン処理が正しく
 動くことは確認できたので、画面とボタンをまるごと省き、
 メインメニューを開いた時に裏側で自動実行する形にしています。

 c012 からは、このメインメニューへ直接来るようになりました。
 c013.html 自体はまだ残していますが、通常の導線からは外れています。
======================================================================
*/


/**
 * music_libraryの全曲と、playlistsに保存済みの並び順を読み込み、
 * 一覧を表示します。
 *
 * 並び順がまだ保存されていない場合は、
 * music_libraryから取得した順番をそのまま使います。
 *
 * 並び順は保存されているが、その後に新しく登録された曲がある場合は、
 * 保存されていた並び順の「後ろ」に追加します。
 *
 * 逆に、並び順には載っているが、
 * すでにmusic_libraryから消えた曲(track_id)があれば、
 * 一覧から除外します。
 */
async function loadMenuData(){

    const allTracks = await idbGetAll(STORE_MUSIC);

    libraryMap = {};
    allTracks.forEach(function(track){
        libraryMap[track.track_id] = track;
    });

    const playlistData = await idbGet(STORE_PLAYLISTS,MAIN_MENU_PLAYLIST_ID);

    if(playlistData && playlistData.track_id_list && playlistData.track_id_list.length > 0){

        // 保存済みの並び順のうち、今も存在する曲だけを残します。
        currentOrderList = playlistData.track_id_list.filter(function(trackId){
            return libraryMap[trackId] !== undefined;
        });

        // 並び順にまだ載っていない、新しく登録された曲を後ろに追加します。
        allTracks.forEach(function(track){
            if(currentOrderList.indexOf(track.track_id) === -1){
                currentOrderList.push(track.track_id);
            }
        });

    }
    else{

        // 並び順が未保存の場合は、登録されている順番をそのまま使います。
        currentOrderList = allTracks.map(function(track){
            return track.track_id;
        });

    }

    console.log("曲一覧の表示件数 :",currentOrderList.length);

    renderList();

}


/**
 * アプリを開いた時に最初に動く関数です。
 *
 * 【やること】
 * 初期設定が済んでいるかを調べて、見せる画面を決めます。
 *
 *   まだ初期設定していない → マイ・ピッチ設定 → Musicフォルダ登録
 *   もう初期設定が済んでいる → メインメニュー
 *
 * 判断そのものは setup.js の initSetupFlow() が行います。
 * フォルダの権限が残っているかの確認も含めて、あちらの担当です。
 *
 * 【v77で変わったこと】
 * 以前はこの2つが c012.html と c014.html という別々のページに
 * 分かれており、初期設定が終わるとページを移動していました。
 *
 * しかしブラウザは、ユーザーが選んだフォルダへのアクセス権限を
 * 「原則そのページを開いている間だけ」有効にします。移動した瞬間に
 * 許可が消えることがあり、実機で実際に起きました。
 *
 * そこで竹弘の発案により、両方を同じ1枚のページにまとめました。
 * 今は画面を切り替えるだけでページは移動しないので、
 * 取った許可がそのまま残ります。
 */
async function startUp(){

    /*
    initSetupFlow は setup.js が window に登録している関数です。
    IIFE(即時実行関数)で囲われた中から、この入口だけが
    外に公開されています。詳しくは setup.js の冒頭を参照。
    */
    initSetupFlow();

}


/**
 * メインメニューを表示して、曲一覧の準備を進めます。
 *
 * 初期設定が済んでいる場合や、初期設定が終わった直後に
 * setup.js から呼ばれます。
 */
async function showMainMenu(){

    // ---------- ⓪ 画面を初期設定からメインメニューへ切り替える ----------

    const setupScreen = document.getElementById("setup-screen");
    const appScreen = document.getElementById("app");

    if(setupScreen){ setupScreen.style.display = "none"; }

    /*
    #app のCSSは display:flex(縦に並べる)なので、
    "block" ではなく "flex" で戻します。
    "block" にすると上下2分割のレイアウトが崩れます。
    */
    if(appScreen){ appScreen.style.display = "flex"; }

    /*
    定規の描画と音を確実に止めます。
    通常は setup.js 側ですでに止まっていますが、
    裏で回り続けると動作が重くなるため念のため呼びます。
    */
    if(typeof stopSetupRuler === "function"){
        stopSetupRuler();
    }

    // ---------- ① まずDBの内容で一覧を表示する ----------

    /*
    ここだけは await で待ちます。一覧が出るまでは画面が空なので、
    次の処理より先に必ず終わらせます。
    (DBから読むだけなので一瞬で終わります)
    */
    await loadMenuData();

    /*
    前回どの並び順を選んでいたかを読み込みます(v81)。

    曲順そのものは playlists に保存されているので並べ替え直す必要は
    ありません。ここで読むのは「並び替えメニューのどの項目に
    ▲▼を付けるか」を復元するためです。
    */
    await loadSortSetting();

    /*
    前回どの再生モードを選んでいたかを読み込みます(v113)。

    走る前に「今日は全曲ループで」と決めた設定が、次にアプリを
    開いた時にも残っているようにするためです(並び順の復元と
    同じ考え方)。

    loadMenuData() の後に置くのが大事です。ランダムを選んでいた
    場合はここでシャッフル順を作り直しますが、その材料になる
    曲順(currentOrderList)が読み込まれている必要があるためです。
    */
    await loadPlayModeSetting();

    /*
    曲の繋ぎ方(クロスフェードの長さ)を読み込みます(v172)。

    設定 ⚙️ →「🎚️ 曲の繋ぎ方」で選んだ長さを、次にアプリを開いた
    時にも覚えているようにするためです。上の再生モードと同じ考え方。

    こちらは曲順を使わないので、置く場所は前後どちらでも構いません。
    設定を読み込む処理としてまとめておきたいので、隣に並べています。
    */
    await loadCrossfadeSetting();

    /*
    一つ前の曲順があるかを読み込みます(v85)。

    うっかり並び替えたままアプリを閉じても、次に開いた時に
    ↩ ボタンで戻せるようにするためです。戻せる状態が無ければ
    ボタンは薄いまま(押せない)になります。
    */
    await loadPreviousOrder();

    // ---------- ② Musicフォルダを調べて、新しい曲を登録する ----------

    setLampScanning();

    const scanResult = await scanAndRegisterNewTracks();

    /*
    スキャンがうまくいかなかった場合は、ランプで知らせて止まります。

    メタデータの解析にも同じフォルダの権限が必要なので、
    ここで失敗した状態のまま解析へ進んでも全曲失敗するだけです。

    なお、すでに登録済みの曲の一覧は①で表示済みなので、
    画面が真っ白になることはありません。
    */
    if(scanResult.status !== "done"){

        if(scanResult.status === "no-permission"){

            /*
            c012が起動時に権限を確認してから送り出しているので、
            本来ここには来ないはずですが、実機で発生しました。

            【なぜ起きるか】
            ブラウザのフォルダアクセス権限は、原則
            「そのページを開いている間だけ」有効で、
            ページを移動した瞬間に切れることがあります。
            (Chromeでは、PWAとしてインストールしていれば
              記憶されやすくなりますが、確実ではありません)

            この場合、竹弘に一度タップしてもらえば復帰できます。
            「許可をください」という命令(requestPermission)は、
            ブラウザの決まりで画面をタップした瞬間しか呼べない
            ためです。新しいボタンは増やさず、警告ランプ自体を
            押してもらう形にしています。
            */
            console.error("Musicフォルダの権限が無いため、スキャンと解析を中止しました。");

            showLampError("タップして許可",requestFolderPermissionAgain);

        }
        else if(scanResult.status === "no-folder"){

            console.error("Musicフォルダが登録されていません。");
            showLampError("フォルダ未登録");

        }
        else{

            showLampError("曲の検索に失敗");

        }

        return;

    }

    /*
    新しい曲が見つかった時だけ、一覧を作り直します。
    1曲も増えていなければ作り直す必要がないので、
    そのまま次へ進みます(通常はこちら)。
    */
    if(scanResult.registeredCount > 0){

        console.log("新しい曲が見つかったので一覧を作り直します :",scanResult.registeredCount,"曲");

        await loadMenuData();

    }

    // ---------- ③ メタデータの解析を裏で進める ----------

    /*
    ここで await を付けずに呼んでいるのが重要な点です。
    await を付けると解析が全部終わるまで次に進めませんが、
    付けないことで「一覧はすぐ操作できる状態にしたまま、
    裏で解析だけが進んでいく」形になります。

    ただし await を付けない場合、途中でエラーが起きても誰も
    受け止めないまま消えてしまうため、.catch() で拾って
    ログに残すようにしています。

    なお、この先のランプ表示(🟡→🟢→🔵)は metadata.js が
    管理します。解析するものが何も無ければ、metadata.js が
    スキャン中のランプを消して静かに終わります。
    */
    startMetadataEngine().catch(function(error){
        console.error("メタデータ解析エンジンで予想外のエラー :",error);
    });

}


/**
 * Musicフォルダの許可を取り直します。
 *
 * 警告ランプ「タップして許可」が押された時に呼ばれます。
 *
 * 【この関数が必要な理由】
 *
 * ブラウザは、ユーザーが意図しないうちにフォルダを覗かれないよう、
 * 「許可をください」という命令(requestPermission)を
 * **画面をタップした瞬間しか呼べない**ようにしています。
 *
 * 起動時に自動で走る scanner.js からは呼べないため、
 * 竹弘のタップを起点にするこの関数を用意しました。
 */
async function requestFolderPermissionAgain(){

    try{

        const folderHandle = await getMusicFolderHandle();

        // ここはタップの中なので requestPermission を呼べます
        const permission = await folderHandle.requestPermission({mode:"read"});

        if(permission !== "granted"){

            console.error("許可されませんでした :",permission);

            // もう一度押せるように、ランプはそのまま出しておきます
            showLampError("タップして許可",requestFolderPermissionAgain);

            return;

        }

        console.log("フォルダの許可を取り直しました。画面を読み込み直します。");

        /*
        許可が取れたので、画面を読み込み直して起動処理を
        最初からやり直します。

        startUp() をもう一度呼ぶ手もありますが、読み込み直す方が
        確実です。一覧やランプの状態が途中まで進んだまま残らず、
        まっさらな状態から始められるためです。
        */
        location.reload();

    }
    catch(error){

        console.error(
            "許可の取り直しに失敗 :",
            error.name,
            error.message
        );

        showLampError("許可の取得に失敗");

    }

}


// ==========================================================
// 画面起動
// ==========================================================

startUp();
