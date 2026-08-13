/*
======================================================================
 scanner.js ── Musicフォルダのスキャンと、新しい曲の登録

----------------------------------------------------------------------

【このファイルの役割】

 Musicフォルダの中(サブフォルダ含む)を調べて、
 まだ登録されていない曲を music_library へ登録します。

 もともと c013.html(Musicフォルダ データ登録)という独立した画面が
 担当していた処理を、メインメニュー(c014)の中へ移してきたものです。

----------------------------------------------------------------------

【なぜ画面を1つ減らしたのか】

 竹弘の指摘:
     「ノリRun利用者に無駄な操作をさせたくない。
       他の音楽プレイヤーと同じように、起動したらメインメニューが
       出てほしい」

 これまでの流れは、曲を1曲も追加していなくても毎回

     初期設定(c012) → c013で「Musicフォルダ確認」を押す
                     → 「OK」を押す → 「OK」を押す → メインメニュー

 と、3回もタップが必要でした。スキャン処理が正しく動くことは
 確認できたので、画面とボタンを挟まず、メインメニューを開いた
 時点で裏側で自動的に実行する形に変えています。

----------------------------------------------------------------------

【権限について(このファイルで一番大事な注意点)】

 ブラウザは、ユーザーが選んだフォルダを勝手に読み続けられないよう、
 アクセス権限を厳しく管理しています。ポイントは2つ。

   ① queryPermission() … 今の権限状態を「調べるだけ」。
                          いつ呼んでもよい。
   ② requestPermission()… ユーザーに許可を求める。
                          **画面のタップの中でしか呼べない**。

 このファイルはメインメニューを開いた瞬間に自動で動くので、
 ②は呼べません(呼んでも失敗します)。そこで①だけを行い、
 権限が無ければ「権限がありません」と呼び出し元へ伝えて終わります。
 許可を求めるボタンを出すのは main.js の仕事です。

----------------------------------------------------------------------

【c013から変えた点】

 ・スキャン結果を入れる箱を、グローバル変数から
   「関数の中だけで使う変数」に変えた。
   c013では箱がグローバル変数だったため、空にし忘れると前回の
   中身が積み重なり、曲数が倍々に増える不具合が起きた(v74で修正)。
   関数の中で作れば、実行が終わるたびに自動で消えるので、
   同じ不具合が構造的に起こらない。

 ・登録済みの曲も「今回見たファイル名」として記録するようにした。
   c013では読み飛ばした曲の件数が、同名ファイルの分だけ多く
   数えられていた(実機で369曲なのに373と表示された)。

 ・1曲ごとのログを減らした。毎回の起動で数百行のログが出ると、
   デバッグログパネルが埋まって他の情報が読めなくなるため、
   新しく登録した曲だけを出す(通常は0件なので静かになる)。
======================================================================
*/


// ==========================================================
// 1. 定数
// ==========================================================
/*
c012で保存したMusicフォルダを取り出すための固定キーです。
folder_roots ストアの中で、この名前で1件だけ保存されています。
*/
const ROOT_MUSIC_ID = "root_music";

/*
音楽ファイルとして扱う拡張子。

Musicフォルダの中には、.nomedia(Androidが「この中身は音楽一覧に
出さないで」と伝えるための目印ファイル)や、.database(何らかの
アプリが残した管理用ファイル)のような、曲ではないファイルが
混ざっていることがあります。

これらは名前が「.」で始まるため、多くのファイラーアプリでは
隠しファイルとして表示されず気づきにくいのですが、スキャン処理は
隠しファイルかどうかを区別しないので、拡張子で判定します。
*/
const AUDIO_EXTENSIONS = [
    ".mp3",
    ".m4a",
    ".wav",
    ".aac",
    ".ogg",
    ".flac",
    ".wma",
    ".aiff"
];

/*
ファイル名の拡張子が、音楽ファイルとして扱ってよいものかを判定します。
*/
function isAudioFile(fileName){

    const lowerName = fileName.toLowerCase();

    return AUDIO_EXTENSIONS.some(function(extension){
        return lowerName.endsWith(extension);
    });

}


// ==========================================================
// 2. Musicフォルダを取り出す
// ==========================================================
/**
 * c012で保存したMusicフォルダの「鍵」を取得します。
 *
 * この関数ではフォルダの中身はまだ読みません。
 * 保存してある鍵(FileSystemDirectoryHandle)を取り出すだけです。
 */
async function getMusicFolderHandle(){

    const folderData = await idbGet(STORE_FOLDER_ROOTS,ROOT_MUSIC_ID);

    if(!folderData){
        throw new Error("Musicフォルダ情報が見つかりません。");
    }

    if(!folderData.root_folder_handle){
        throw new Error("Musicフォルダの鍵がありません。");
    }

    return folderData.root_folder_handle;

}

/**
 * Musicフォルダの中を再帰的に調べ、ファイルを1つずつ渡します。
 *
 * サブフォルダが見つかった場合は、その中も同じ処理で調べにいきます
 * (自分自身をもう一度呼び出す = 再帰処理)。
 *
 *   Musicフォルダ/
 *     J-POP/
 *       曲A.mp3
 *     洋楽/
 *       曲B.mp3
 *
 * のように何段あっても、中の曲ファイルを全部見つけられます。
 *
 * ※ フォルダの権限は一番上のフォルダで確認すれば、その中の
 *    サブフォルダにも自動的に有効になります。サブフォルダごとに
 *    取り直す必要はありません。
 *
 * async function* は「async generator(非同期ジェネレーター)」
 * という書き方です。for await (const x of ...) と組み合わせると、
 * 見つかったファイルを1つずつ順番に受け取れます。
 * 全部を配列に溜めてから返すのではないので、曲数が何百あっても
 * メモリを圧迫しません。
 */
async function* scanFolderRecursively(dirHandle){

    for await(const entry of dirHandle.values()){

        if(entry.kind === "file"){

            // ファイルなら、呼び出し元へそのまま渡します。
            yield entry;

        }
        else if(entry.kind === "directory"){

            /*
            フォルダなら、その中も同じ関数で調べます。

            yield* は「呼び出した先が渡してくるものを、
            そのまま全部中継する」という書き方です。
            */
            yield* scanFolderRecursively(entry);

        }

    }

}

/**
 * track_id(曲を見分けるための番号)を作ります。
 *
 * ファイル名を番号代わりにすると、同じ名前のファイルを別々の曲として
 * 登録できなくなるため、「現在時刻 + ランダムな数字」を組み合わせて
 * ほぼ重複しないIDを作ります。
 */
function createTrackId(){

    const now = Date.now();

    const random = Math.floor(Math.random() * 1000000);

    return "tr_" + now + "_" + random;

}


// ==========================================================
// 3. スキャンして、新しい曲を登録する
// ==========================================================
/**
 * Musicフォルダを調べ、まだ登録されていない曲を music_library へ
 * 登録します。メインメニューを開いた時に main.js から呼ばれます。
 *
 * 【戻り値】
 * 呼び出し元が次にどうすべきか判断できるよう、状態を返します。
 *
 *   { status:"done",          registeredCount:n, skippedCount:n }
 *   { status:"no-folder",     ... }  Musicフォルダが未登録
 *   { status:"no-permission", ... }  フォルダを読む許可が無い
 *   { status:"error",         ... }  その他の失敗
 *
 * 例外(throw)ではなく戻り値で知らせているのは、この処理が
 * 「失敗しても曲一覧の表示は続けたい」性質のものだからです。
 * フォルダが読めなくても、すでに登録済みの曲は再生できます。
 */
async function scanAndRegisterNewTracks(){

    // ---------- ① Musicフォルダの鍵を取り出す ----------

    let folderHandle = null;

    try{
        folderHandle = await getMusicFolderHandle();
    }
    catch(error){

        console.error("Musicフォルダの情報がありません :",error.message);

        return {
            status: "no-folder",
            registeredCount: 0,
            skippedCount: 0
        };

    }

    // ---------- ② 権限を確認する(求めることはしない) ----------

    /*
    queryPermission は「今どうなっているか」を調べるだけの命令です。
    ここでは requestPermission(許可を求める)は呼びません。
    画面のタップの中でしか呼べないためです(冒頭の解説を参照)。

    通常は c012 が起動時に権限を確認してからメインメニューへ
    送り出しているので、ここは "granted" になっているはずです。
    そうでなかった場合の保険としてこの確認を置いています。
    */
    const permission = await folderHandle.queryPermission({mode:"read"});

    if(permission !== "granted"){

        console.error("Musicフォルダの権限がありません :",permission);

        return {
            status: "no-permission",
            registeredCount: 0,
            skippedCount: 0
        };

    }

    // ---------- ③ すでに登録済みの曲を調べる ----------

    try{

        const existingTracks = await idbGetAll(STORE_MUSIC);

        /*
        Set(セット)は「同じ値を重複なく持てる入れ物」です。
        配列と違い、has() での検索が曲数に関係なく高速なので、
        何百曲あっても待たされません。

        ファイル名で判定しているのは竹弘の指示によるもので、
        同じファイル名は同じ曲として扱ってよい、という方針です。
        */
        const existingFileNames = new Set(
            existingTracks.map(function(existingTrack){
                return existingTrack.file_name;
            })
        );

        console.log("登録済みの曲 :",existingFileNames.size,"曲");

        // ---------- ④ フォルダの中を調べる ----------

        /*
        見つけた新曲を一時的に入れておく箱です。

        【c013から変えた重要な点】
        c013ではこの箱がグローバル変数だったため、空にし忘れると
        前回の中身が残り、同じ曲が何度も登録されて曲数が倍々に
        増える不具合が起きました(v74で修正)。

        関数の中で作れば、処理が終わるたびに自動的に消えるので、
        同じ不具合がそもそも起こりえません。
        */
        const newTrackMap = new Map();

        // 今回のスキャンですでに見たファイル名(同名の重複を弾くため)
        const seenFileNames = new Set();

        let skippedExistingCount = 0;

        for await(const fileEntry of scanFolderRecursively(folderHandle)){

            // 音楽ファイル以外(.nomedia など)は対象外
            if(!isAudioFile(fileEntry.name)){
                continue;
            }

            /*
            違うサブフォルダに同じ名前の曲があった場合は、
            最初に見つかった方だけを残します(竹弘の指示)。
            */
            if(seenFileNames.has(fileEntry.name)){
                continue;
            }

            seenFileNames.add(fileEntry.name);

            // すでに登録済みなら、登録し直さない
            if(existingFileNames.has(fileEntry.name)){
                skippedExistingCount = skippedExistingCount + 1;
                continue;
            }

            /*
            fileEntry は FileSystemFileHandle(ファイルの鍵)です。
            そのままMapへ保存でき、IndexedDBにも保存できます。
            */
            newTrackMap.set(fileEntry.name,fileEntry);

        }

        // ---------- ⑤ 新しい曲を登録する ----------

        let registeredCount = 0;

        for(const [fileName,fileHandle] of newTrackMap){

            /*
            登録する曲の中身です。
            この時点で分かるのはファイル名だけなので、
            タイトルや長さは後から解析して埋めていきます
            (metadata.js の担当)。

            各フィールドの意味は docs/db-schema.md を参照。
            */
            const track = {

                track_id: createTrackId(),

                file_name: fileName,
                file_handle: fileHandle,

                folder_roots_id: ROOT_MUSIC_ID,

                registered_at: Date.now(),

                title: fileName,
                artist: "",

                duration: 0,
                mix_duration: 0,

                is_analyzed: false,

                tag_bpm: null,
                baseBPM: 120,
                userBPM: null,
                manualBPM: null,

                startTS: 0,
                endTS: 0,
                tick13TS: 0,

                cover_art: null

            };

            await idbPut(STORE_MUSIC,track);

            registeredCount = registeredCount + 1;

            // 新曲は数が少ないので1曲ずつ出します(通常は0件)
            console.log("新規登録 :",fileName);

        }

        console.log(
            "スキャン完了 : 新規",registeredCount,"曲 / 登録済み",
            skippedExistingCount,"曲"
        );

        return {
            status: "done",
            registeredCount: registeredCount,
            skippedCount: skippedExistingCount
        };

    }
    catch(error){

        /*
        スキャンの途中で失敗しても、すでに登録済みの曲は再生できます。
        画面を止めず、状態だけ返して呼び出し元に判断を任せます。
        */
        console.error(
            "スキャンに失敗 :",
            error.name,
            error.message
        );

        return {
            status: "error",
            registeredCount: 0,
            skippedCount: 0
        };

    }

}
