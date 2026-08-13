/*
======================================================================
 main.js ── 起動処理

----------------------------------------------------------------------

【このファイルの役割】

 メインメニューを開いた時に、最初に動くファイルです。
 やることは大きく3つ。

   ① music_library から全曲を読み込む
   ② playlists に保存してある並び順を復元して、一覧を表示する
   ③ 裏でメタデータの解析エンジンを走らせる

 このファイルは他の全ファイルの関数を使うため、
 c014.html の読み込み順で必ず一番最後に置きます。

----------------------------------------------------------------------

【曲一覧を先に出して、解析は裏で進める】

 竹弘の方針「曲再生機能を妨げない最速起動」に沿って、
 一覧の表示と解析の順番を分けています。

   1. まず一覧を表示 → すぐに曲を再生できる状態になる
   2. その裏でタイトルやジャケットが1曲ずつ埋まっていく

 解析が全部終わるのを待ってから一覧を出す作りだと、
 369曲では起動に何十秒もかかってしまいます。
======================================================================
*/


/**
 * music_libraryの全曲と、playlistsに保存済みの並び順を読み込みます。
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

    console.log("曲一覧読み込み件数 :",currentOrderList.length);

    renderList();

    /*
    曲一覧を先に表示してから、裏でメタデータの解析を進めます。

    ここで await を付けずに呼んでいるのが重要な点です。
    await を付けると解析が全部終わるまで次の処理に進めませんが、
    付けないことで「一覧はすぐ操作できる状態にしたまま、
    裏で解析だけが進んでいく」形になります。
    竹弘の「曲再生機能を妨げない最速起動」の方針そのものです。

    ただし await を付けない場合、途中でエラーが起きても誰も
    受け止めないまま消えてしまうため、.catch() で拾って
    ログに残すようにしています。
    */
    startMetadataEngine().catch(function(error){
        console.error("メタデータ解析エンジンで予想外のエラー :",error);
    });

}


// ==========================================================
// 画面起動
// ==========================================================

loadMenuData();
