/*
================================================================
 mp3-remux.js … mp3 を、正確に飛べる入れ物(MP4)へ詰め替えて鳴らす(v290)

----------------------------------------------------------------------

【何が困っていたか】竹弘の報告(2026-11-23):

    「KICK BACK(×½)→ あの日の約束(×4)が再生された際、あの日の約束のノリノリアシストが
      合っていない事象が発生します。曲を頭から再生しなおすと正しいノリノリアシストになります」
    「CD取込ユーザーが多い想定なので、しっかり対応しておきたいです」(CD から取り込んだ曲は mp3 が主流)

 Chrome は `<audio>` で mp3 の途中へ飛ぶ時、「速いけど不正確な飛び方」をします。すると、
 曲の時刻(currentTime)が名乗る位置と、実際に鳴っている音がずれます。ノリRun は接続もアシストも
 currentTime を物差しにしているので、途中へ飛ぶ場面(助走の開始・同期モードの続きから・シークバー)で拍が合わなくなります。

 のりがパソコンの Chrome で測った値(2026-11-23。竹弘の mp3 5曲。道具は sandbox/audio-analysis/seekmeasure.html):

     頭から鳴らす                        … どの曲も 0.0ms(飛ばないのでずれない)
     VBR(データ量が変わる形)の途中へ飛ぶ … −665〜+516ms(あの日の約束は 11.83秒へ飛ぶと +516ms)
     CBR(データ量が一定の形)の途中へ飛ぶ … −25〜−3ms

【どう直すか】mp3 の「音のかたまり」(フレーム。1つ 1152サンプル ≒ 26ms)を、1ビットも変えずに、
 m4a と同じ MP4 の入れ物へ移し替えて鳴らします。MP4 は「何番目のかたまりが何秒か」の目次を持つので、
 どこへ飛んでも正確です。音は変えないので、音質は同じです。大きさも mp3 とほぼ同じです。
 詰め替えた後のずれ(同じ5曲):頭からも途中からも 0〜1.1ms で一定(合格の目安 30ms に対して十分小さい)。

【ノリ注入の物差しと合わせる決まり】(ここがいちばん大事)
 ノリ注入(js/tap.js)は、曲を decodeAudioData でまるごとほどいて叩きます。1拍目・13拍目の位置は、
 その「ほどいた音」の時刻で保存されています。詰め替えた MP4 も、同じ時刻で鳴らなければなりません。

 decodeAudioData は、mp3 の頭に LAME の情報(Xing / Info の後ろの "LAME" など)がある時だけ、
 頭の無音(LAME が書いた遅れ 576 + 復号の遅れ 529 = ふつう 1105サンプル ≒ 25ms)を切り捨てます。
 そこで:

     LAME の情報がある曲 … 最初のかたまりを、その長さに近い数だけ落とす(1105 → 1つ = 1152)。
                            残るずれは 1152 − 1105 = 47サンプル ≒ 1.1ms(44.1kHz)
     LAME の情報が無い曲 … 何も落とさない(decodeAudioData も何も切らないので、ずれ 0)

 (MP4 の「頭を切る指定」edit list も試したが、途中から鳴らすと 0ms なのに、頭から鳴らすと +25ms になった。
  頭からと途中からで食い違うのは困るので使わない。2026-11-23 の測定)

【うまくいかない時】(竹弘と決めた 2026-11-23「Over_the_Horizon.m4a と同じ扱い。うまく接続できないものは
 避けておき、発生の際、解析・対策に使えるようわかるようにしておきたい」)
     ・詰め替えに失敗した曲 → ⚠️ のパネルで知らせ、「了承」で除外(理由 "mp3_remux"。js/exclude.js)。
       何が起きたかを 🐛 に詳しく残す(ファイル名・どこで失敗したか・先頭のバイト)。助走も始めない
     ・⚠️ この Chrome が「MP4 の中の mp3」を再生できない時(canPlayType が空)は、詰め替えずに今までどおり
       mp3 のまま鳴らす。端末の都合で全部の mp3 が一斉に失敗し、全部グレーになる事故を防ぐため(js/exclude.js の冒頭)

【使う所】曲をデッキに載せる3つの入口が、getFile の後・setDeckSource の前に prepareDeckSource を呼びます。
     js/player.js   竹弘が曲をタップした時・次の曲へ進む時
     js/connect.js  助走を始める時(startPreRoll)・頭出し接続(startHeadConnect)
 ⚠️ ノリ注入(js/tap.js)・BPM の自動解析(js/bpm.js)・タグとジャケ(js/metadata.js・js/jacket.js)は、
    元の mp3 をそのまま読みます(ほどいたり、タグを読んだりするだけで、途中へ飛ばないため)。

 経緯と測定 → CLAUDE.md「いまの到達点」の mp3 の項目・「Chrome・Android の決まり」の 13
================================================================
*/


// ==========================================================
// 1. 決まった値・今の状態
// ==========================================================

/*
詰め替えに失敗した時に投げるエラーの名前。呼ぶ側(js/player.js・js/connect.js)は、この名前で見分けます。
*/
const MP3_REMUX_ERROR_NAME = "Mp3RemuxError";

/*
この数より少ないかたまりしか見つからない時は、壊れているとみなします(1秒 ≒ 38かたまり)。
*/
const MP3_REMUX_MIN_FRAMES = 38;

/*
復号の遅れ(mp3 の仕組みとして、どの復号器でも出る遅れ)。サンプルの数。
decodeAudioData は、LAME の情報がある時に「LAME の遅れ + これ」を切り捨てます。
*/
const MP3_DECODER_DELAY = 529;

/*
詰め替えに失敗した曲(track_id → 理由の文字)。同じ曲で何度も詰め替え直さないようにします
(助走は timeupdate のたびに「始めてよいか」を確かめるので、覚えておかないと失敗のログが積もる)。
アプリを開き直すと空になります(もう一度試せる)。
*/
const mp3RemuxFailures = new Map();

/*
この Chrome が「MP4 の中の mp3」を再生できるか(最初に聞かれた時に1回だけ調べる)。null はまだ調べていない。
*/
let mp3RemuxSupported = null;


// ==========================================================
// 2. 入口(曲をデッキに載せる前に呼ぶ)
// ==========================================================

/**
 * 曲をデッキに載せる前に呼びます。mp3 なら MP4 に詰め替えた Blob を、それ以外はファイルをそのまま返します。
 *
 * 返した Blob には noriRunRemux(詰め替えの内容)を付けてあります。js/deck.js の setDeckSource が、
 * 「このデッキは詰め替えた mp3 を鳴らしている」と覚えるのに使います(再生に失敗した時の除外の理由を分けるため)。
 *
 * ⚠️ 詰め替えに失敗した時は、名前が "Mp3RemuxError" のエラーを投げます(呼ぶ側が除外の案内を出す)。
 *
 * @param  {File}   file    - getFile() で取り出した曲のファイル
 * @param  {string} trackId - その曲の track_id
 * @return {Promise<Blob|File>}
 */
async function prepareDeckSource(file,trackId){

    if(!isMp3File(file)){ return file; }

    if(!canPlayMp3InMp4()){ return file; }

    // 前に失敗した曲は、詰め替え直さずにすぐ失敗を返します
    if(mp3RemuxFailures.has(trackId)){

        throw makeMp3RemuxError(mp3RemuxFailures.get(trackId));

    }

    const startMs = performance.now();

    /*
    ファイルの中身を読み出します。⚠️ ここで失敗した時(ファイルが動かされた・読めない など)は、
    詰め替えの失敗にしません(そのままのエラーを呼ぶ側へ返す)。曲そのものの問題ではないかもしれず、
    除外にすると全曲が一斉にグレーになる事故につながるため(js/exclude.js の冒頭)。
    */
    const bytes = new Uint8Array(await file.arrayBuffer());

    let result;

    try{

        result = remuxMp3ToMp4(bytes);

    }
    catch(error){

        const why = (error && error.message) ? error.message : String(error);

        mp3RemuxFailures.set(trackId,why);

        // 解析に使えるよう、何が起きたかを詳しく残します(竹弘の希望)
        console.error(
            "⚠️ mp3 を MP4 に詰め替えられませんでした :",
            file.name,
            "/ 理由 :",why,
            "/ 大きさ :",file.size,"バイト"
        );

        throw makeMp3RemuxError(why);

    }

    const blob = result.blob;

    blob.noriRunRemux = result.info;

    console.log(
        "mp3 を MP4 に詰め替えました :",
        file.name,
        "/ かたまり " + result.info.frames + "個(1つ " + result.info.samplesPerFrame + "サンプル・" + result.info.sampleRate + "Hz)",
        "/ " + result.info.header,
        "/ 落とした頭のかたまり " + result.info.droppedFrames + "個(LAME の頭の無音 " +
            (result.info.lameDelay === null ? "なし" : result.info.lameDelay + " + " + MP3_DECODER_DELAY + " サンプル") + ")",
        "/ ノリ注入の物差しとのずれ " + (result.info.residualSamples / result.info.sampleRate * 1000).toFixed(1) + "ms",
        "/ " + (performance.now() - startMs).toFixed(0) + "ms"
    );

    return blob;

}

/**
 * 接続(js/connect.js の助走・頭出し接続)から呼ぶ入口です。prepareDeckSource と同じですが、
 * 詰め替えに失敗した時はエラーを投げずに null を返します(呼ぶ側は、繋ぐのを取りやめるだけ)。
 *
 * 除外の案内はここでは出しません。助走は「次の曲」を裏で用意しているだけで、竹弘はまだその曲を
 * 選んでいないためです。今の曲が終わって、その曲を鳴らそうとした時に js/player.js が案内を出し、
 * その次の曲へ進みます(js/queue.js)。
 *
 * @return {Promise<Blob|File|null>}
 */
async function prepareConnectSource(file,trackId){

    try{

        return await prepareDeckSource(file,trackId);

    }
    catch(error){

        if(error && error.name === MP3_REMUX_ERROR_NAME){

            console.warn("mp3 の詰め替えに失敗した曲なので、繋ぎません :",file.name);

            return null;

        }

        throw error;

    }

}

/**
 * そのファイルが mp3 かを返します(ファイルの種類か、名前の .mp3 で見分ける)。
 */
function isMp3File(file){

    if(!file){ return false; }

    if(file.type === "audio/mpeg" || file.type === "audio/mp3"){ return true; }

    return /\.mp3$/i.test(file.name || "");

}

/**
 * この Chrome が「MP4 の中の mp3」を再生できるかを返します(最初の1回だけ調べて、覚えておく)。
 *
 * canPlayType は「この形式を再生できそうか」を "probably"(たぶんできる)/ "maybe" / ""(できない)で
 * 答える命令です。mp4a.6B は「MP4 の中の MPEG-1 Audio(mp3)」の呼び名。
 * パソコンの Chrome は "probably"(2026-11-23)。スマホでも 🐛 で確かめる。
 */
function canPlayMp3InMp4(){

    if(mp3RemuxSupported !== null){ return mp3RemuxSupported; }

    let answer = "";

    try{

        answer = document.createElement("audio").canPlayType('audio/mp4; codecs="mp4a.6B"');

    }
    catch(error){

        answer = "";

    }

    mp3RemuxSupported = (answer !== "");

    if(mp3RemuxSupported){

        console.log("mp3 の詰め替え : この Chrome は MP4 の中の mp3 を再生できます(" + answer + ")");

    }
    else{

        console.warn("mp3 の詰め替え : この Chrome は MP4 の中の mp3 を再生できないので、mp3 のまま鳴らします(途中へ飛ぶと拍がずれることがあります)");

    }

    return mp3RemuxSupported;

}

/**
 * 前に詰め替えに失敗した曲かを返します(js/connect.js が、助走を始めない判断に使う)。
 */
function isMp3RemuxFailed(trackId){

    return mp3RemuxFailures.has(trackId);

}

/**
 * 呼ぶ側が見分けられる名前のエラーを作ります。
 */
function makeMp3RemuxError(why){

    const error = new Error(why);

    error.name = MP3_REMUX_ERROR_NAME;

    return error;

}


// ==========================================================
// 3. 詰め替え(mp3 のかたまりを MP4 の入れ物へ)
// ==========================================================

/*
1秒あたりのデータ量(kbps)と、標本化の速さ(Hz)の表(mp3 の決まり)。
かたまりの頭(4バイト)の中の番号から、かたまりの長さを計算するのに使います。
    MPEG-1 Layer III … 44100 / 48000 / 32000 Hz
    MPEG-2 / 2.5 Layer III … その半分・4分の1(かたまりも半分の 576サンプル)
*/
const MP3_BITRATES = {
    v1: [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0],
    v2: [0,8,16,24,32,40,48,56,64,80,96,112,128,144,160,0]
};
const MP3_SAMPLE_RATES = { 3: [44100,48000,32000], 2: [22050,24000,16000], 0: [11025,12000,8000] };

/**
 * かたまりの頭(4バイト)を読みます。mp3(Layer III)のかたまりでなければ null。
 *
 *     1バイト目と2バイト目の頭 11ビット … 全部 1(かたまりの始まりの印 = 同期の印)
 *     ver   … 3 = MPEG-1 / 2 = MPEG-2 / 0 = MPEG-2.5(1 は使わない)
 *     layer … 1 = Layer III(mp3)
 *     bri   … データ量の番号 / sri … 標本化の速さの番号 / pad … 1バイト足すか / ch … 3 ならモノラル
 *
 * >> は「右へずらす」、& は「欲しいビットだけ残す」計算です。
 */
function readMp3FrameHeader(b,p){

    if(p + 4 > b.length){ return null; }

    if(b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0){ return null; }

    const ver   = (b[p + 1] >> 3) & 3;
    const layer = (b[p + 1] >> 1) & 3;
    const bri   = (b[p + 2] >> 4) & 15;
    const sri   = (b[p + 2] >> 2) & 3;
    const pad   = (b[p + 2] >> 1) & 1;
    const ch    = (b[p + 3] >> 6) & 3;

    if(ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3){ return null; }

    const bitrate = MP3_BITRATES[ver === 3 ? "v1" : "v2"][bri] * 1000;
    const sampleRate = MP3_SAMPLE_RATES[ver][sri];
    const samplesPerFrame = (ver === 3) ? 1152 : 576;

    return {
        ver: ver,
        sampleRate: sampleRate,
        channels: (ch === 3) ? 1 : 2,
        mono: (ch === 3),
        samplesPerFrame: samplesPerFrame,
        length: Math.floor(samplesPerFrame / 8 * bitrate / sampleRate) + pad
    };

}

/**
 * mp3 のバイトを、MP4 の Blob に詰め替えます(音は変えない)。
 *
 * 手順:
 *   1. 頭の ID3v2(曲名やジャケの入れ物)を飛ばす
 *   2. 最初のかたまりを探す(同期の印があり、その次のかたまりも正しい所)
 *   3. 最初のかたまりが Xing / Info / VBRI(目次だけで音が無いかたまり)なら飛ばす。LAME の情報があれば頭の無音の長さを読む
 *   4. 残りのかたまりを全部数える(途中にゴミがあれば、次の正しいかたまりまで読み飛ばす)
 *   5. LAME の頭の無音に合わせて、最初のかたまりを落とす(冒頭の【ノリ注入の物差しと合わせる決まり】)
 *   6. MP4 の入れ物(目次 moov + 音 mdat)を組み立てる
 *
 * @param  {Uint8Array} b - mp3 ファイルの中身
 * @return {{blob:Blob, info:Object}}
 */
function remuxMp3ToMp4(b){

    const n = b.length;

    // ---- 1. ID3v2 ----
    let pos = 0;

    if(n > 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33){   // "ID3"

        // 大きさは「7ビットずつの4バイト」で書かれている(ID3 の決まり)
        pos = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));

        if(b[5] & 0x10){ pos += 10; }   // 後ろにも同じ印(フッター)がある時

    }

    // ---- 2. 最初のかたまり ----
    const findFrame = function(from){

        for(let p = from; p < n - 4; p++){

            const h = readMp3FrameHeader(b,p);

            if(h && readMp3FrameHeader(b,p + h.length)){ return p; }

        }

        return -1;

    };

    pos = findFrame(pos);

    if(pos < 0){ throw new Error("mp3 のかたまりが見つかりません(先頭 " + describeMp3Head(b) + ")"); }

    const first = readMp3FrameHeader(b,pos);

    // ---- 3. Xing / Info / VBRI ----
    const sideInfo = (first.ver === 3) ? (first.mono ? 17 : 32) : (first.mono ? 9 : 17);
    const tagAt = pos + 4 + sideInfo;
    const tag = readMp3Ascii(b,tagAt,4);

    let header = "目次なし";
    let lameDelay = null;

    if(tag === "Xing" || tag === "Info"){

        header = tag;

        // 目次の中身の印(どの欄が入っているか)。欄の数で、LAME の情報の場所が決まる
        const flags = (b[tagAt + 4] << 24) | (b[tagAt + 5] << 16) | (b[tagAt + 6] << 8) | b[tagAt + 7];

        let q = tagAt + 8;

        if(flags & 1){ q += 4; }     // かたまりの数
        if(flags & 2){ q += 4; }     // バイトの数
        if(flags & 4){ q += 100; }   // 目次(TOC)
        if(flags & 8){ q += 4; }     // 音質

        const encoder = readMp3Ascii(b,q,4);

        // decodeAudioData(Chrome の中の FFmpeg)が頭の無音を切るのは、この3つの印の時(LAME と FFmpeg)
        if(encoder === "LAME" || encoder === "Lavf" || encoder === "Lavc"){

            lameDelay = (b[q + 21] << 4) | (b[q + 22] >> 4);   // 12ビット

            header += " + " + readMp3Ascii(b,q,9).trim();

        }

        pos += first.length;   // 目次のかたまりは音ではないので飛ばす

    }
    else if(readMp3Ascii(b,pos + 36,4) === "VBRI"){

        header = "VBRI";

        pos += first.length;   // 同じく、目次のかたまりは飛ばす

    }

    // ---- 4. かたまりを数える ----
    const offsets = [];
    const sizes = [];
    let skippedBytes = 0;

    while(pos < n - 4){

        const h = readMp3FrameHeader(b,pos);

        // 最初のかたまりと同じ形(標本化の速さ・版)のものだけを音として数える
        if(h && h.sampleRate === first.sampleRate && h.ver === first.ver && pos + h.length <= n){

            offsets.push(pos);
            sizes.push(h.length);
            pos += h.length;

            continue;

        }

        // 末尾のタグ("TAG" = ID3v1 / "APETAGEX")に来たら終わり
        const mark = readMp3Ascii(b,pos,3);

        if(mark === "TAG" || readMp3Ascii(b,pos,8) === "APETAGEX"){ break; }

        // 途中のゴミは、次の正しいかたまりまで読み飛ばす
        const next = findFrame(pos + 1);

        if(next < 0){ break; }

        skippedBytes += next - pos;
        pos = next;

    }

    // ---- 5. 頭の無音に合わせて落とす ----
    const spf = first.samplesPerFrame;
    const trimSamples = (lameDelay === null) ? 0 : lameDelay + MP3_DECODER_DELAY;
    const dropFrames = Math.round(trimSamples / spf);

    offsets.splice(0,dropFrames);
    sizes.splice(0,dropFrames);

    if(sizes.length < MP3_REMUX_MIN_FRAMES){

        throw new Error("mp3 のかたまりが少なすぎます(" + sizes.length + "個。先頭 " + describeMp3Head(b) + ")");

    }

    // ---- 6. MP4 を組み立てる ----
    const blob = buildMp4FromMp3Frames(b,offsets,sizes,first);

    return {
        blob: blob,
        info: {
            frames: sizes.length,
            sampleRate: first.sampleRate,
            samplesPerFrame: spf,
            channels: first.channels,
            header: header,
            lameDelay: lameDelay,
            droppedFrames: dropFrames,
            residualSamples: dropFrames * spf - trimSamples,
            skippedBytes: skippedBytes
        }
    };

}

// バイトを文字として読みます(印を見分ける用)
function readMp3Ascii(b,at,len){

    let s = "";

    for(let i = 0; i < len && at + i < b.length; i++){ s += String.fromCharCode(b[at + i]); }

    return s;

}

// 先頭16バイトを16進で(失敗した時の手がかり)
function describeMp3Head(b){

    const out = [];

    for(let i = 0; i < 16 && i < b.length; i++){ out.push(("0" + b[i].toString(16)).slice(-2)); }

    return out.join(" ");

}

/**
 * MP4 の入れ物を組み立てます。
 *
 * MP4 は「箱」(box)の入れ子です。どの箱も「大きさ(4バイト)+ 名前(4文字)+ 中身」の形です。
 *
 *     ftyp … 何の入れ物か(M4A = 音楽)
 *     moov … 目次
 *       mvhd … 全体の時間の決まり / trak … 1本の音の道
 *         tkhd … 道の決まり / mdia … 中身の決まり
 *           mdhd … 時間の単位(1秒 = 標本化の速さ)と長さ / hdlr … 音(soun)の道
 *           minf … smhd(音の道の印)・dinf(データはこのファイルの中)・stbl(かたまりの目次)
 *             stsd … 中身の種類:mp4a + esds(MPEG-1 Audio = mp3。番号 0x6B)
 *             stts … どのかたまりも同じ長さ(1152 か 576 サンプル)
 *             stsc … かたまりを全部1つの束に入れる
 *             stsz … かたまりそれぞれの大きさ(VBR は1つずつ違う)
 *             stco … 束が mdat のどこから始まるか
 *     mdat … 音そのもの(mp3 のかたまりを、そのまま並べる)
 *
 * ⚠️ 頭を切る指定(edts / elst)は入れません(冒頭のコメント。頭からと途中からで食い違ったため)。
 */
function buildMp4FromMp3Frames(b,offsets,sizes,first){

    const frames = sizes.length;
    const sr = first.sampleRate;
    const spf = first.samplesPerFrame;
    const totalSamples = frames * spf;

    // 数を4バイト・2バイトの並びにする / 文字をバイトの並びにする
    const u32 = function(v){ return [(v >>> 24) & 255,(v >>> 16) & 255,(v >>> 8) & 255,v & 255]; };
    const u16 = function(v){ return [(v >>> 8) & 255,v & 255]; };
    const str = function(s){ const a = []; for(let i = 0; i < s.length; i++){ a.push(s.charCodeAt(i)); } return a; };

    // 箱:大きさ + 名前 + 中身 / 版つきの箱:中身の頭に「版(1バイト)+ 印(3バイト)」
    const box = function(type,payload){ return [].concat(u32(8 + payload.length),str(type),payload); };
    const fullBox = function(type,version,flags,payload){ return box(type,[version].concat(u32(flags).slice(1),payload)); };

    // 映像用の変形の決まり(音でも書く決まりになっている。何も変えない値)
    const matrix = [].concat(u32(0x10000),u32(0),u32(0),u32(0),u32(0x10000),u32(0),u32(0),u32(0),u32(0x40000000));

    const mvhd = fullBox("mvhd",0,0,[].concat(u32(0),u32(0),u32(sr),u32(totalSamples),u32(0x10000),u16(0x100),u16(0),
                         u32(0),u32(0),matrix,u32(0),u32(0),u32(0),u32(0),u32(0),u32(0),u32(2)));
    const tkhd = fullBox("tkhd",0,3,[].concat(u32(0),u32(0),u32(1),u32(0),u32(totalSamples),u32(0),u32(0),
                         u16(0),u16(0),u16(0x100),u16(0),matrix,u32(0),u32(0)));
    const mdhd = fullBox("mdhd",0,0,[].concat(u32(0),u32(0),u32(sr),u32(totalSamples),u16(0x55c4),u16(0)));
    const hdlr = fullBox("hdlr",0,0,[].concat(u32(0),str("soun"),u32(0),u32(0),u32(0),str("SoundHandler"),[0]));
    const smhd = fullBox("smhd",0,0,[].concat(u16(0),u16(0)));
    const dinf = box("dinf",fullBox("dref",0,0,[].concat(u32(1),fullBox("url ",0,1,[]))));

    /*
    esds … 中身の種類の説明。0x6B = MPEG-1 Audio(mp3)/ 0x15 = 音の流れ。
    平均のデータ量は「音の大きさ × 8 ÷ 秒」で計算する(数字は再生には使われない、説明のための値)。
    */
    let audioBytes = 0;

    for(let i = 0; i < frames; i++){ audioBytes += sizes[i]; }

    const avgBitrate = Math.round(audioBytes * 8 / (totalSamples / sr));
    const decoderConfig = [0x04,13,0x6b,0x15,0,0,0].concat(u32(320000),u32(avgBitrate));
    const esDescriptor = [0x03,3 + decoderConfig.length + 3].concat(u16(1),[0],decoderConfig,[0x06,1,0x02]);
    const esds = fullBox("esds",0,0,esDescriptor);

    const mp4a = box("mp4a",[].concat([0,0,0,0,0,0],u16(1),u16(0),u16(0),u32(0),
                     u16(first.channels),u16(16),u16(0),u16(0),u32(sr * 65536),esds));
    const stsd = fullBox("stsd",0,0,[].concat(u32(1),mp4a));
    const stts = fullBox("stts",0,0,[].concat(u32(1),u32(frames),u32(spf)));
    const stsc = fullBox("stsc",0,0,[].concat(u32(1),u32(1),u32(frames),u32(1)));

    const sizeTable = [].concat(u32(0),u32(frames));

    for(let i = 0; i < frames; i++){ sizeTable.push(...u32(sizes[i])); }

    const stsz = fullBox("stsz",0,0,sizeTable);

    // moov は stco(音の始まりの位置)だけが後で決まるので、組み立てを関数にしておく
    const buildMoov = function(audioStart){

        const stco = fullBox("stco",0,0,[].concat(u32(1),u32(audioStart)));
        const stbl = box("stbl",[].concat(stsd,stts,stsc,stsz,stco));
        const minf = box("minf",[].concat(smhd,dinf,stbl));
        const mdia = box("mdia",[].concat(mdhd,hdlr,minf));
        const trak = box("trak",[].concat(tkhd,mdia));

        return box("moov",[].concat(mvhd,trak));

    };

    const ftyp = box("ftyp",[].concat(str("M4A "),u32(0),str("M4A "),str("mp42"),str("isom")));

    // moov の大きさは stco の値に関係しないので、仮に組んで大きさを知ってから、本物を組む
    const moovLength = buildMoov(0).length;
    const moov = buildMoov(ftyp.length + moovLength + 8);

    // mdat … かたまりをそのまま並べる
    const mdat = new Uint8Array(8 + audioBytes);

    mdat.set(u32(8 + audioBytes),0);
    mdat.set(str("mdat"),4);

    let o = 8;

    for(let i = 0; i < frames; i++){

        mdat.set(b.subarray(offsets[i],offsets[i] + sizes[i]),o);
        o += sizes[i];

    }

    return new Blob([new Uint8Array(ftyp),new Uint8Array(moov),mdat],{ type:"audio/mp4" });

}
