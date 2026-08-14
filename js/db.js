/*
======================================================================
 db.js ── IndexedDB(NoriRunDB)を読み書きするための共通部品

----------------------------------------------------------------------

【このファイルの役割】

 IndexedDBは「ブラウザの中にある小さなデータベース」です。
 曲の情報や並び順は、ここに保存されています。

 ただしIndexedDBの命令はそのままだと書き方が長く、
 「開いて、取引(トランザクション)を始めて、成功したら…」
 という手順を毎回書く必要があります。

 そこで、よく使う4つの操作を短く呼べる形にまとめました。

   openNoriRunDB() … データベースを開く
   idbGet()        … キーを1つ指定して1件取り出す
   idbPut()        … 1件保存する(同じキーがあれば上書き)
   idbGetAll()     … そのストアの全件を取り出す

 中身は c013.html にあるものと同じ内容です。

----------------------------------------------------------------------

【Promise について(初めて見る人向け)】

 IndexedDBは「命令を出してもすぐには終わらず、終わったら
 教えてくれる」形の仕組みです。この「あとで結果が返ってくる」
 を扱うためのJavaScriptの標準の仕組みが Promise です。

 Promiseで包んでおくと、呼ぶ側が

     const track = await idbGet(STORE_MUSIC, id);

 のように、await を付けるだけで「終わるまで待ってから次へ進む」
 と書けるようになります。

 なお、各関数の中で db.close() を必ず呼んでいるのは、
 開いたままにしておくと、あとでDBの構造を変更したい時に
 「他で使用中」となって変更できなくなるためです。

----------------------------------------------------------------------

【ストアの定義について】

 このアプリのIndexedDBに、どんなストア(表)があり、
 どんなフィールドが入っているかは docs/db-schema.md に
 まとめてあります。フィールドを追加・変更した時は、
 コードと一緒にそちらも必ず更新すること。
======================================================================
*/


function openNoriRunDB(){

    return new Promise(function(resolve,reject){

        const request = indexedDB.open(DB_NAME,DB_VERSION);

        /*
        onupgradeneeded は「そのデータベースがまだ無い時」と
        「バージョン番号を上げた時」にだけ呼ばれる特別な場所です。
        データを入れる棚(ストア)を作れるのは、ここだけです。

        【v77でここに棚を作る処理を移した理由】

        以前この処理は c012.html(初期設定画面)だけが持っていました。
        必ず c012 を通ってからメインメニューへ進む作りだったので、
        棚は c012 が作ってくれる前提で問題なかったのです。

        しかしv77で初期設定をメインメニューと同じページにまとめた結果、
        このファイルがアプリで最初にデータベースを開くことになりました。
        棚を作る処理が無いままだと、初回起動で
        「settings という棚が見つかりません」というエラーになり、
        アプリが動き出せません。

        contains() で「すでにあるか」を確かめてから作っているので、
        2回目以降の起動で作り直してしまうことはありません。
        */
        request.onupgradeneeded = function(event){

            const db = event.target.result;

            console.log("NoriRunDB 新規作成");

            // アプリ設定(マイ・ピッチ、初期設定の完了フラグなど)
            if(!db.objectStoreNames.contains(STORE_SETTINGS)){
                db.createObjectStore(STORE_SETTINGS);
            }

            // 曲マスター。1曲ごとの主キーは track_id
            if(!db.objectStoreNames.contains(STORE_MUSIC)){
                db.createObjectStore(STORE_MUSIC,{ keyPath: "track_id" });
            }

            // プレイリスト(曲の並び順)。主キーは playlist_id
            if(!db.objectStoreNames.contains(STORE_PLAYLISTS)){
                db.createObjectStore(STORE_PLAYLISTS,{ keyPath: "playlist_id" });
            }

            // Musicフォルダの鍵。主キーは folder_roots_id
            if(!db.objectStoreNames.contains(STORE_FOLDER_ROOTS)){
                db.createObjectStore(STORE_FOLDER_ROOTS,{ keyPath: "folder_roots_id" });
            }

        };

        request.onsuccess = function(event){
            resolve(event.target.result);
        };

        request.onerror = function(){
            reject("NoriRunDBを開けませんでした。");
        };

    });

}

function idbGet(storeName,key){

    return new Promise(async function(resolve,reject){

        try{
            const db = await openNoriRunDB();
            const tx = db.transaction(storeName,"readonly");
            const store = tx.objectStore(storeName);
            const request = store.get(key);

            request.onsuccess = function(){
                db.close();
                resolve(request.result);
            };

            request.onerror = function(){
                db.close();
                reject("データ取得失敗");
            };

        }
        catch(error){
            reject(error);
        }

    });

}

function idbPut(storeName,value,key){

    return new Promise(async function(resolve,reject){

        try{
            const db = await openNoriRunDB();
            const tx = db.transaction(storeName,"readwrite");
            const store = tx.objectStore(storeName);

            if(key === undefined){
                store.put(value);
            }
            else{
                store.put(value,key);
            }

            tx.oncomplete = function(){
                db.close();
                resolve();
            };

            tx.onerror = function(){
                db.close();
                reject("保存失敗");
            };

        }
        catch(error){
            reject(error);
        }

    });

}

function idbGetAll(storeName){

    return new Promise(async function(resolve,reject){

        try{
            const db = await openNoriRunDB();
            const tx = db.transaction(storeName,"readonly");
            const store = tx.objectStore(storeName);
            const request = store.getAll();

            request.onsuccess = function(){
                db.close();
                resolve(request.result || []);
            };

            request.onerror = function(){
                db.close();
                reject("全件取得失敗");
            };

        }
        catch(error){
            reject(error);
        }

    });

}
