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
 * 起動時の一連の流れを、順番に進めます。
 */
async function startUp(){

    // ---------- ① まずDBの内容で一覧を表示する ----------

    /*
    ここだけは await で待ちます。一覧が出るまでは画面が空なので、
    次の処理より先に必ず終わらせます。
    (DBから読むだけなので一瞬で終わります)
    */
    await loadMenuData();

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
            通常ここには来ません。c012が起動時に権限を確認し、
            切れていれば c012 の画面で許可を取り直してから
            メインメニューへ送り出しているためです。

            それでも権限が無い状態でここへ来た場合は、
            アプリを開き直せば c012 が許可を求めます。
            */
            console.error("Musicフォルダの権限が無いため、スキャンと解析を中止しました。");
            showLampError("フォルダ許可が必要");

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


// ==========================================================
// 画面起動
// ==========================================================

startUp();
