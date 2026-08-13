/*
======================================================================
 metadata.js ── メタデータ解析エンジン(3フェーズ演出つき)

----------------------------------------------------------------------

【このファイルの役割】

 音楽ファイルの中に埋め込まれているメタデータ(タグ情報)を読み取り、
 music_libraryへ保存し、画面の表示を更新します。

   フェーズ1 … タイトル / アーティスト名 / 曲の長さ
   フェーズ2 … ジャケット画像
   フェーズ3 … 完了

 タグの読み取りには、外部ライブラリ jsmediatags(BSD 3-Clause)を
 使っています。c014.html で lib/jsmediatags.min.js を読み込むと、
 このファイルから jsmediatags という名前で使えるようになります。

----------------------------------------------------------------------

【legacy(OFS Ver1.1)からの設計変更点】

 legacyの3フェーズ演出は「シミュレーター」で、実際のタグ読み取りは
 行っておらず、150ms・400msの固定ウェイトで見た目だけを再現していました。
 そのままの作りにすると、100曲で15秒+40秒の「ただ待つだけの時間」が
 発生し、竹弘の「最速起動」方針と矛盾します。

 そこで固定ウェイトは全て外し、ランプを「実際の解析の進捗」に
 連動させる作りに変更しました。演出の見え方は変わりませんが、
 1曲ずつ表示が書き換わっていくのが本物の処理になります。

【解析済みの曲は二度と解析しない】

 is_meta_analyzed フラグで判定します。全曲解析済みなら
 ランプすら出さずに終了するため、2回目以降の起動は一瞬です。

----------------------------------------------------------------------

【他のファイルとの関係】

   startMetadataEngine() … main.js が起動時に呼ぶ(裏で進む)
   refreshRow()          → list-view.js(解析が済んだ行を差し替える)
   setLampPhase()        → lamp.js(進捗ランプの表示)
   idbPut()              → db.js(解析結果をDBへ保存)
======================================================================
*/


// ==========================================================
// 1. 解析ロジックのバージョン番号と設定値
// ==========================================================
/*
============================================================
タグ解析ロジックのバージョン番号

【何のための仕組みか】

「解析済みの曲は二度と解析しない」(is_meta_analyzed)という
仕組みには、一つ困った副作用があります。
解析のプログラム自体を改善しても、すでに解析済みの曲は
古い結果のまま残り、新しいロジックが適用されないのです。

実際にv69→v70でこの問題が起きました。v69で「アーティスト名が
空」のまま解析済みと記録された曲は、v70でロジックを直しても
再解析されず、いつまでも空欄のままになってしまいます。

そこで、曲ごとに「どのバージョンのロジックで解析したか」を
記録しておき、この番号を上げると自動的に再解析される
ようにしました。

【使い方】
タグ解析のやり方を改善した時に、この数字を1つ上げる。
それだけで、既存の曲も次回起動時に自動で解析し直される。
(竹弘がDBをクリアしてc013から再スキャンする必要はない)

v70で 2 に上げたので、v69で解析済みの曲も再解析される。
============================================================
*/
const META_ANALYZER_VERSION = 2;

/*
ジャケット画像の取得ロジックのバージョン番号。
考え方は META_ANALYZER_VERSION と全く同じで、
画像の取り出し方や縮小サイズを変更した時にこの数字を上げると、
取得済みの曲も自動でジャケットを取り直す。
*/
const COVER_ANALYZER_VERSION = 1;

/*
DBに保存するジャケット画像の一辺の長さ(ピクセル)。

画面上の表示は44px角だが、その2倍を超える96pxで保存している。
スマホの画面は「1ピクセル」を実際には2〜3個の点で表示する
高精細なもの(高DPI)が主流で、44pxのまま保存すると
輪郭がぼやけて見えてしまうため。

原寸のまま保存しない理由は、1曲あたり500KB〜1MBになり、
数百曲でDBが数百MBに膨れ上がるから(竹弘の判断、2026-08-08)。
96px角のJPEGなら1曲あたり数KBで収まる。
*/
const COVER_ART_SIZE = 96;

// 保存するJPEGの画質(0〜1)。0.8は画質とサイズのバランスが良い定番の値。
const COVER_ART_QUALITY = 0.8;


// ==========================================================
// 2. 解析エンジン本体
// ==========================================================
/*
============================================================
外部ライブラリが本当に読み込めているかを確認します。

【なぜこの確認が必要になったか(v71で追加)】

v70の実機テストで、lib/jsmediatags.min.js がサーバー上に
存在せず(Gitへの登録漏れ)、全1107曲で
「jsmediatags is not defined」という例外が出続けた。

その時のログは同じエラーが延々と並ぶだけで、
「ライブラリが無い」という本当の原因にたどり着くまでに
時間がかかった。

そこで、起動時に一度だけ明確に警告を出し、
さらに画面のランプにも赤字で知らせるようにした。
これなら次に同じことが起きても一目で分かる。

typeof で調べているのは、存在しない変数を直接参照すると
それ自体がエラーになるため。typeof は未定義の変数に対しても
安全に "undefined" を返してくれる。
============================================================
*/
function isTagLibraryReady(){
    return (typeof jsmediatags !== "undefined");
}

/**
 * 未解析の曲を順番に解析していきます。
 */
async function startMetadataEngine(){

    // ライブラリが無ければ、解析しても全曲失敗するだけなので中止します。
    if(!isTagLibraryReady()){

        console.error(
            "【重大】jsmediatags が読み込めていません。" +
            "lib/jsmediatags.min.js がサーバー上に存在するか確認してください" +
            "(Gitへの登録漏れ・パス間違いが原因になりやすい)。"
        );

        showLampError("ライブラリ未読込");

        return;

    }

    /*
    解析が必要な曲だけを集めます。対象になるのは次の2種類です。

      ① まだ一度も解析していない曲
      ② 古いバージョンのロジックで解析された曲
         (META_ANALYZER_VERSIONの解説を参照)

    ②の判定で「|| 1」を付けているのは、この仕組みを作る前に
    解析された曲には meta_analyzer_version が入っていないため、
    その場合は「バージョン1で解析された」とみなすためです。
    */
    const metaTargets = currentOrderList.filter(function(trackId){

        const track = libraryMap[trackId];
        if(!track){ return false; }

        if(!track.is_meta_analyzed){ return true; }

        return (track.meta_analyzer_version || 1) < META_ANALYZER_VERSION;

    });

    /*
    ジャケット画像がまだ取得できていない曲を集めます。
    判定の考え方は上の文字情報と同じです。

    is_cover_analyzed は「画像が入っていたかどうか」ではなく
    「調べ終わったかどうか」を表します。ジャケットが入っていない
    ファイルも調べ終われば true になるので、毎回無駄に調べ直しません。
    */
    const coverTargets = currentOrderList.filter(function(trackId){

        const track = libraryMap[trackId];
        if(!track){ return false; }

        if(!track.is_cover_analyzed){ return true; }

        return (track.cover_analyzer_version || 1) < COVER_ANALYZER_VERSION;

    });

    /*
    やることが何も無ければ、ランプを出さずに終了します。
    竹弘の「曲再生機能を妨げない最速起動」の方針により、
    2回目以降の起動は一覧が完成形で一瞬で出ます。
    */
    if(metaTargets.length === 0 && coverTargets.length === 0){

        console.log("メタデータ・ジャケットとも全曲解析済み");

        /*
        起動時のスキャン中に出していた「曲を探しています」の
        ランプを、ここで消します。

        解析するものが何も無い時に「全工程完了」の青ランプまで
        見せる必要はないので、余韻を付けずすっと消します
        (竹弘の「最速起動」の方針。何も起きていない時は
          ランプを出さないのが基本)。
        */
        hideLampNow();

        return;
    }

    // ============ フェーズ1:文字情報(タイトル・アーティスト・曲長) ============

    if(metaTargets.length > 0){

        console.log("メタデータ未解析 :",metaTargets.length,"曲");

        let metaDone = 0;
        setLampPhase(1,metaDone,metaTargets.length);

        /*
        for...of で1曲ずつ順番に処理します。

        あえて同時並行(Promise.all)にしていないのは、
        ・何十曲も同時にファイルを開くと端末のメモリを圧迫する
        ・1曲ずつ順に表示が変わっていく方が、竹弘の狙った演出になる
        という2つの理由からです。
        */
        for(const trackId of metaTargets){

            await analyzeOneTrack(trackId);

            metaDone = metaDone + 1;
            setLampPhase(1,metaDone,metaTargets.length);

        }

        console.log("メタデータ解析完了 :",metaDone,"曲");

    }

    // ============ フェーズ2:ジャケット画像 ============

    /*
    竹弘の選択(2026-08-08)により、文字情報とジャケットは
    別々の工程に分けています。

    1回の読み込みで両方取得すれば初回の解析時間は約半分になりますが、
    ・解析は裏で進むので曲の再生を妨げない
    ・一度取得すれば次回以降は読み込まない
    という理由から、竹弘は「文字が全部揃ってから、ジャケットが
    1枚ずつ現れる」という演出がはっきり分かれる方を選びました。
    */
    if(coverTargets.length > 0){

        console.log("ジャケット未取得 :",coverTargets.length,"曲");

        let coverDone = 0;
        setLampPhase(2,coverDone,coverTargets.length);

        for(const trackId of coverTargets){

            await analyzeCoverArt(trackId);

            coverDone = coverDone + 1;
            setLampPhase(2,coverDone,coverTargets.length);

        }

        console.log("ジャケット取得完了 :",coverDone,"曲");

    }

    // ============ フェーズ3:完了 ============

    setLampPhase(3);

}

/**
 * 1曲分のメタデータを解析して、DBと画面に反映します。
 */
async function analyzeOneTrack(trackId){

    const track = libraryMap[trackId];

    if(!track || !track.file_handle){
        return;
    }

    try{

        /*
        ファイルを読む前に、必ず権限を確認し直します。
        c013の権限バグ、および再生処理(playTrack)と全く同じ理由です
        (ページ遷移でJSの実行コンテキストがリセットされるため)。
        */
        let permission = await track.file_handle.queryPermission({mode:"read"});

        if(permission !== "granted"){
            permission = await track.file_handle.requestPermission({mode:"read"});
        }

        if(permission !== "granted"){
            console.error("解析中止(権限なし) :",track.file_name);
            return;
        }

        const file = await track.file_handle.getFile();

        // --- ① タグから タイトル と アーティスト名 を取得 ---
        const tags = await readTagsFromFile(file);

        if(tags){

            /*
            タグの値は、ファイルの形式や作られ方によって
            「どのキーに、どんな形で入っているか」がバラバラです。
            そのため pickTagValue() で複数の可能性を順番に試します
            (v70での修正。詳しくはpickTagValueの解説を参照)。
            */
            const tagTitle = pickTagValue(tags,"title",TITLE_FRAME_IDS);
            const tagArtist = pickTagValue(tags,"artist",ARTIST_FRAME_IDS);

            if(tagTitle !== ""){
                track.title = tagTitle;
            }
            if(tagArtist !== ""){
                track.artist = tagArtist;
            }

        }

        // タイトルが取れなければファイル名を使う(竹弘の指示)
        if(!track.title){
            track.title = track.file_name;
        }

        // --- ② 曲の長さを実測 ---
        const measured = await measureDuration(file);

        if(measured > 0){
            track.duration = measured;
        }

        // --- ③ 解析済みの印を付けてDBへ保存 ---
        track.is_meta_analyzed = true;

        // どのバージョンのロジックで解析したかも記録しておきます
        // (次にロジックを改善した時、自動で再解析させるため)
        track.meta_analyzer_version = META_ANALYZER_VERSION;

        await idbPut(STORE_MUSIC,track);

        // --- ④ 画面のその行だけを差し替え ---
        refreshRow(trackId);

    }
    catch(error){

        /*
        1曲の失敗で全体を止めないよう、ここで受け止めて次の曲へ進みます。
        is_meta_analyzed を立てないままにしているので、
        次回の起動時にもう一度挑戦されます
        (一時的な権限エラーなら次は成功するため)。
        */
        console.error(
            "解析失敗 :",
            track.file_name,
            error.name,
            error.message
        );

    }

}

/**
 * 1曲分のジャケット画像を取得して、縮小してDBへ保存します。
 *
 * 【処理の流れ】
 *   ① ファイルの権限を確認して開く
 *   ② タグの中から画像データ(picture)を取り出す
 *   ③ 96px角のJPEGに縮小する
 *   ④ DBへ保存し、画面のその行だけ差し替える
 *
 * ジャケットが入っていないファイルも珍しくありません。
 * その場合も「調べ終わった」印(is_cover_analyzed)は付けるので、
 * 次回以降くり返し調べにいくことはありません。
 */
async function analyzeCoverArt(trackId){

    const track = libraryMap[trackId];

    if(!track || !track.file_handle){
        return;
    }

    try{

        // 権限の確認(文字情報の解析・再生処理と全く同じパターン)
        let permission = await track.file_handle.queryPermission({mode:"read"});

        if(permission !== "granted"){
            permission = await track.file_handle.requestPermission({mode:"read"});
        }

        if(permission !== "granted"){
            console.error("ジャケット取得中止(権限なし) :",track.file_name);
            return;
        }

        const file = await track.file_handle.getFile();

        const tags = await readTagsFromFile(file);

        // タグから画像を取り出します(無ければ null が返ります)
        const originalBlob = extractPictureBlob(tags);

        if(originalBlob){

            // 表示に必要なサイズまで小さくしてから保存します
            const smallBlob = await shrinkImageBlob(
                originalBlob,
                COVER_ART_SIZE,
                COVER_ART_QUALITY
            );

            if(smallBlob){
                track.cover_art = smallBlob;
            }

        }

        // 画像が無かった場合も「調べ終わった」印は付けます
        track.is_cover_analyzed = true;
        track.cover_analyzer_version = COVER_ANALYZER_VERSION;

        await idbPut(STORE_MUSIC,track);

        refreshRow(trackId);

    }
    catch(error){

        // 1曲の失敗で全体を止めません(文字情報の解析と同じ方針)
        console.error(
            "ジャケット取得失敗 :",
            track.file_name,
            error.name,
            error.message
        );

    }

}


// ==========================================================
// 3. ジャケット画像の取り出しと縮小
// ==========================================================

/**
 * タグの中から、ジャケット画像をBlob(ファイルの実体)として取り出します。
 *
 * jsmediatagsが返す picture は
 *     { format:"image/jpeg", data:[137, 80, 78, ...] }
 * のような形で、data は画像1バイトずつを数値で並べた配列です。
 * このままでは画像として扱えないため、Blobに組み立て直します。
 *
 * Uint8Array は「0〜255の数値だけを詰める、コンピュータが扱いやすい形の配列」で、
 * 画像や音声のような生データを扱う時に使います。
 */
function extractPictureBlob(tags){

    if(!tags || !tags.picture){
        return null;
    }

    const picture = tags.picture;

    if(!picture.data || !picture.data.length){
        return null;
    }

    try{

        const bytes = new Uint8Array(picture.data);

        // format(image/jpeg 等)が入っていない場合に備え、既定値を用意します
        const mimeType = picture.format || "image/jpeg";

        return new Blob([bytes],{type:mimeType});

    }
    catch(error){
        console.error("画像データの組み立てに失敗 :",error.name,error.message);
        return null;
    }

}

/**
 * 画像を指定サイズの正方形に縮小します。
 *
 * 【なぜ縮小するのか】
 * 元のジャケット画像は600×600px以上(数百KB〜1MB)が普通です。
 * 一覧に44pxで表示するだけなのに原寸で保存すると、
 * 数百曲でDBが数百MBに膨れ上がってしまいます。
 *
 * 【正方形に切り取る理由】
 * ジャケットは正方形が多いものの、まれに横長・縦長の画像もあります。
 * そのまま縮めると絵が歪むため、中央を正方形に切り取ってから縮小します
 * (写真アプリのサムネイルと同じ考え方)。
 */
async function shrinkImageBlob(blob,size,quality){

    let bitmap = null;

    try{

        /*
        createImageBitmap は、画像データを「描画に使える形」に
        変換してくれる標準の命令です。
        <img>タグを作って読み込みを待つ昔ながらの方法より速く、
        まとめて処理する時に向いています。
        */
        bitmap = await createImageBitmap(blob);

        /*
        canvas(キャンバス)は、JavaScriptから絵を描ける画用紙です。
        画面には表示せず、縮小した画像を作るための作業台として使います。
        */
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;

        const context = canvas.getContext("2d");

        // 元画像の短い方の辺に合わせて、中央から正方形に切り取ります
        const sourceSize = Math.min(bitmap.width,bitmap.height);
        const sourceX = (bitmap.width - sourceSize) / 2;
        const sourceY = (bitmap.height - sourceSize) / 2;

        /*
        drawImage の引数は
            (元画像, 切り取るX, 切り取るY, 切り取る幅, 切り取る高さ,
             描く先のX, 描く先のY, 描く先の幅, 描く先の高さ)
        です。切り取りと縮小を一度に行っています。
        */
        context.drawImage(
            bitmap,
            sourceX,sourceY,sourceSize,sourceSize,
            0,0,size,size
        );

        // canvasの内容を、保存できるJPEGファイルの形に変換します
        return await new Promise(function(resolve){

            canvas.toBlob(
                function(result){ resolve(result); },
                "image/jpeg",
                quality
            );

        });

    }
    catch(error){
        console.error("画像の縮小に失敗 :",error.name,error.message);
        return null;
    }
    finally{

        /*
        finally は「成功しても失敗しても最後に必ず実行する」ブロックです。
        close() は画像が使っていたメモリを解放する命令で、
        何百曲も処理する今回のようなケースでは必ず呼ぶべきものです。
        */
        if(bitmap && typeof bitmap.close === "function"){
            bitmap.close();
        }

    }

}


// ==========================================================
// 4. タグから文字を取り出す部品
// ==========================================================
/*
============================================================
タグの値を取り出すための「候補キー」の一覧

音楽ファイルのタグは、形式ごとに項目名(キー)が全く違います。
jsmediatagsは "title" / "artist" という分かりやすい名前
(ショートカット)も用意してくれますが、ファイルの作られ方に
よってはショートカットが作られないことがあります。

そこで、ショートカットが空だった場合の保険として、
形式ごとの「生の項目名」も順番に試すようにしました。

  TIT2 / TPE1 … MP3(ID3v2.3・2.4)で使われる項目名
  TT2  / TP1  … MP3(ID3v2.2、より古い形式)の項目名
  ©nam / ©ART … M4A・MP4で使われる項目名(先頭の記号も名前の一部)
  aART        … M4A のアルバムアーティスト(最後の保険)
============================================================
*/
const TITLE_FRAME_IDS = ["TIT2","TT2","©nam"];
const ARTIST_FRAME_IDS = ["TPE1","TP1","©ART","aART"];

/**
 * タグの中から、目的の文字列を取り出します。
 *
 * 【なぜこんな回り道が必要なのか(v70での修正理由)】
 *
 * v69では tags.title / tags.artist をそのまま使っていましたが、
 * 実機テストでアーティスト名が表示されませんでした。
 *
 * タグの値は、次の3つの形のどれかで入っている可能性があります。
 *
 *   ① 文字列そのまま            tags.artist = "山田太郎"
 *   ② オブジェクトの中のdata     tags.TPE1 = { data:"山田太郎", ... }
 *   ③ ショートカットが作られず、生の項目名にだけ入っている
 *
 * この関数は ①→②→③ の順に探しにいくので、
 * どの形で入っていても取り出せます。
 */
function pickTagValue(tags,shortcutName,frameIds){

    // --- ① ショートカット名(title / artist)で探す ---
    const shortcutValue = extractText(tags[shortcutName]);
    if(shortcutValue !== ""){
        return shortcutValue;
    }

    // --- ②③ 生の項目名を順番に試す ---
    for(const frameId of frameIds){
        const frameValue = extractText(tags[frameId]);
        if(frameValue !== ""){
            return frameValue;
        }
    }

    return "";

}

/*
値が「文字列」でも「{data:文字列} のオブジェクト」でも、
中の文字を取り出して返します。取れなければ空文字を返します。

trim() は文字列の前後の余分な空白を削る命令です。
タグには末尾に空白や余分な文字が入っていることがよくあります。
*/
function extractText(value){

    if(value === undefined || value === null){
        return "";
    }

    if(typeof value === "string"){
        return value.trim();
    }

    // typeof が "object" の時だけ .data を見にいきます。
    if(typeof value === "object" && typeof value.data === "string"){
        return value.data.trim();
    }

    return "";

}

/**
 * jsmediatagsでタグを読み取ります。
 *
 * 【v70での変更】setTagsToRead() の指定を外しました。
 *
 * v69では読む項目を ["title","artist"] に絞って速くしていましたが、
 * 実機でアーティスト名が取得できなかったため、原因の切り分けとして
 * 「全部のタグを読む」方式に変更しています。
 * 絞り込みを外すことで、ショートカットが作られない形式のファイルでも
 * 生の項目名から値を拾えるようになります。
 *
 * ジャケット画像(picture)も一緒に読み込まれますが、1曲ずつ処理して
 * 使い終わったら捨てるため、メモリを溜め込むことはありません。
 * なお、竹弘の選択により文字情報とジャケットは別々の工程に分けている
 * ため、この関数は1曲につき2回呼ばれます(フェーズ1とフェーズ2)。
 */
function readTagsFromFile(file){

    return new Promise(function(resolve){

        /*
        jsmediatagsは「終わったらこの関数を呼んでね」というコールバック
        方式のライブラリで、そのままではawaitで待てません。
        そこでPromiseで包んで、awaitできる形に変換しています
        (コールバックをPromise化する定番の書き方)。

        失敗時もrejectせずresolve(null)にしているのは、
        タグが無いファイルは珍しくなく、それを「エラー」として
        扱うと解析全体が止まってしまうためです。
        */
        try{

            new jsmediatags.Reader(file).read({

                onSuccess:function(result){

                    resolve(result && result.tags ? result.tags : null);

                },

                onError:function(error){

                    console.log("タグなし/読み取り不可 :",file.name);

                    resolve(null);

                }

            });

        }
        catch(error){
            console.error(
                "タグ読み取りで例外 :",
                file.name,
                error.name,
                error.message
            );
            resolve(null);
        }

    });

}

/**
 * 曲の長さ(秒)を実測します。
 *
 * 竹弘の指示「曲の長さが取得できない時は、一般的なプレイヤーと
 * 同じように算出表示する」への対応です。
 *
 * タグの中にも長さの情報(TLENフレーム)を持てる仕様はありますが、
 * 実際には入っていないファイルが多く、入っていても値が
 * 信頼できないことが知られています。そのため一般的な音楽プレイヤーは
 * 音声そのものを読んで長さを測っています。ここでも同じ方式を採ります。
 */
function measureDuration(file){

    return new Promise(function(resolve){

        const url = URL.createObjectURL(file);

        // new Audio() は、画面に出さない再生用の部品を作る命令です。
        const probe = new Audio();

        /*
        preload="metadata" は「曲全体ではなく、長さなどの基本情報だけ
        読み込む」指定です。曲を丸ごと読むより大幅に速く終わります。
        */
        probe.preload = "metadata";

        // 二重に終了処理が走らないようにする見張り役のフラグです。
        let settled = false;

        function finish(value){

            if(settled){ return; }
            settled = true;

            clearTimeout(timer);

            // 使い終わった一時URLを解放します(放置するとメモリを食い続けます)
            URL.revokeObjectURL(url);

            resolve(value);

        }

        /*
        コーデック非対応のファイルなどで、成功も失敗もせず
        永久に待たされてしまうことへの保険です。
        8秒で諦めて0(=長さ不明)として次へ進みます。
        */
        const timer = setTimeout(function(){
            console.log("長さの測定がタイムアウト :",file.name);
            finish(0);
        },8000);

        // 長さなどの基本情報が読めた時に呼ばれます。
        probe.onloadedmetadata = function(){
            finish(probe.duration);
        };

        probe.onerror = function(){
            finish(0);
        };

        probe.src = url;

    });

}
