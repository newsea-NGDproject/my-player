/*
================================================================
 bpm.js … 曲の本来のBPM(元ピッチ)を自動で割り出す

----------------------------------------------------------------------

【このファイルの役割】

 音楽ファイルの音の波形を調べて、その曲が1分間に何拍かを
 推定します。ここで求めた値が、画面の「元ピッチ」です。

 ノリRunは設定したテンポに合わせて曲を再生するアプリなので、
 「その曲がもともと何BPMなのか」が分からないと、どれだけ
 速さを変えればよいかを決められません。すべての土台になる値です。

----------------------------------------------------------------------

【legacy(ver8.5)からの移植です】

 竹弘が ver8.5 で完成させた estimateBPM() を移植しました。
 やっていることは4段階です。

   ① 音楽ファイルを「音の波形の数値」に変換する
   ② 波形が大きく振れた瞬間(=ドンと鳴った所)を拾う
   ③ その間隔の平均を出す
   ④ 「60秒 ÷ 平均間隔」で1分あたりの拍数(BPM)に直す

 移植にあたって3点だけ手を入れています(理由は各所のコメント)。

   ・使い終わった AudioContext を閉じるようにした
   ・BPMが180を超えた時の半分にする計算で、整数に丸めるようにした
   ・解析済みかどうかを bpm_analyzer_version で管理するようにした

----------------------------------------------------------------------

【この方式の精度について(竹弘へ)】

 「一定より大きい音を拍とみなす」という素直な方法なので、
 ドラムのはっきりした曲は得意ですが、次のような曲は苦手です。

   ・イントロが静かで、大きな音が10回に満たない曲 → 120を返します
   ・生演奏でテンポが揺れる曲
   ・拍の裏で大きな音が鳴る曲(実際の倍のBPMになることがある)

 ver8.5でも、この自動解析だけに頼らず「タップ補正」で人が
 直せる作りになっていました。まずは自動解析でどこまで合うかを
 実機で確かめて、精度が足りなければ改善するか、タップ補正を
 足すかを決めるのがよいと思います。
================================================================
*/


/*
BPM解析ロジックのバージョンです。

解析の仕方を改善したらこの番号を1つ上げてください。番号が上がると、
すでに解析済みの曲も次に再生した時に自動で解析し直されます
(js/metadata.js の META_ANALYZER_VERSION と全く同じ仕組みです)。

これが無いと、解析を改善しても一度解析した曲は古い値のまま残り、
竹弘がDBをクリアして全曲登録し直すしか直す方法が無くなります。
*/
const BPM_ANALYZER_VERSION = 1;

/*
解析できなかった時に使う値です。

登録時の初期値(js/scanner.js)も 120 で、legacy の estimateBPM が
返す値とも揃えてあります。世の中の曲の平均的なテンポでもあります。
*/
const BPM_FALLBACK = 120;

/*
BPMとして受け入れる範囲です。

音楽で使われるテンポはおおむねこの間に収まります。範囲から外れた値は
「実際の倍」または「半分」を拾ってしまったと考えて、2倍したり半分に
したりして、この範囲へ収めます(下の estimateBpm を参照)。
*/
const BPM_MIN = 60;
const BPM_MAX = 180;


/**
 * その曲のBPM解析が必要かどうかを返します。
 *
 * @param  {Object}  track … music_library の1曲分のデータ
 * @return {Boolean} 解析が必要なら true
 */
function needsBpmAnalysis(track){

    if(!track){ return false; }

    /*
    タップ補正(ノリ注入)で人が耳で測った値がある曲は、自動解析しません。

    その曲の基準として実際に使われるのは manualBPM の方なので
    (js/pitch.js の getEffectiveBaseBpm)、自動解析しても結果は
    どこにも使われません。それでも解析は数秒かかり、曲を丸ごと
    波形にほどくため80MBほどのメモリを使います。使われない値の
    ために毎回それを払うのは無駄なので、ここで打ち切ります。

    竹弘の確認(2026-08-15)への答えでもあります。タップ補正した曲が
    後から自動解析に上書きされることはありません。
    */
    if(track.manualBPM){ return false; }

    /*
    まだ一度も解析していない曲は bpm_analyzer_version を持っていないので、
    || 0 で「0番」として扱い、必ず解析対象になるようにしています。

    逆に言うと、一度解析した曲はこの番号が入るので二度と解析されません。
    同じ曲を何度再生しても、baseBPM が解析し直されることはありません
    (私が解析ロジックを改善して BPM_ANALYZER_VERSION を上げた時だけ、
      その1回に限り解析し直されます)。
    */
    return (track.bpm_analyzer_version || 0) < BPM_ANALYZER_VERSION;

}


/**
 * 音楽ファイルからBPMを推定します(legacy ver8.5 からの移植)。
 *
 * @param  {File}   file … 音楽ファイル
 * @return {Number} 推定したBPM(整数)
 */
async function estimateBpm(file){

    /*
    AudioContext は「音を扱うための作業台」のようなものです。
    ここでは音を鳴らすためではなく、ファイルを波形の数値に
    ほどくためだけに使います。
    */
    const audioContext = new AudioContext();

    try{

        // --- ① 音楽ファイルを波形の数値に変換する ---

        /*
        arrayBuffer() はファイルの中身をそのままの並びで取り出す命令、
        decodeAudioData() はそれ(MP3などの圧縮された形)を、
        実際の音の波を表す数値の列にほどく命令です。

        ここが一番時間とメモリを使う処理で、4分の曲でおよそ80MBに
        なります。全曲まとめてやるとメモリが足りなくなるため、
        再生した曲だけを1曲ずつ解析する作りにしています。
        */
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        /*
        getChannelData(0) は左チャンネルの波形です。ステレオでも
        片方だけ見れば拍は分かるので、処理を半分に減らしています。

        中身は -1.0 〜 +1.0 の数値が1秒あたり44100個ほど並んだもので、
        0が無音、絶対値が大きいほど大きな音です。
        */
        const data = audioBuffer.getChannelData(0);

        // --- ② 大きな音が鳴った瞬間(ピーク)を拾う ---

        /*
        441個おきに見ているのは、1秒を100等分する間隔です
        (44100 ÷ 441 = 100)。すべての数値を見ると数百万回の
        繰り返しになりますが、拍の間隔は速い曲でも0.3秒ほどあるので、
        100分の1秒ごとに覗けば十分間に合います。

        0.8 は「これ以上大きければ拍とみなす」という境目です。
        */
        const peaks = [];

        for(let i = 0; i < data.length; i += 441){
            if(Math.abs(data[i]) > 0.8){
                peaks.push(i);
            }
        }

        /*
        大きな音がほとんど無い曲(静かな曲、録音レベルの低い曲)は
        拍を判断できないので、諦めて既定値を返します。
        */
        if(peaks.length < 10){

            console.log("BPM解析: 大きな音が少ないため既定値を使います :",file.name);

            return BPM_FALLBACK;

        }

        // --- ③ ピークとピークの間隔の平均を出す ---

        let totalInterval = 0;

        for(let i = 1; i < peaks.length; i++){
            totalInterval += peaks[i] - peaks[i - 1];
        }

        const averageInterval = totalInterval / (peaks.length - 1);

        // --- ④ 1分あたりの拍数に直す ---

        /*
        averageInterval は「数値何個分」という単位なので、
        sampleRate(1秒あたりの数値の個数)で割ると秒に直せます。
        60をその秒数で割れば、1分あたりの拍数になります。
        */
        const secondsPerBeat = averageInterval / audioBuffer.sampleRate;

        let bpm = Math.round(60 / secondsPerBeat);

        /*
        範囲外の値を2倍・半分して収めます。

        拍の裏でも音が鳴っていると間隔が半分に見えてBPMが倍になり、
        逆に静かで拍を拾い損ねると半分になります。音楽のテンポは
        60〜180に収まることがほとんどなので、その範囲へ寄せます。

        legacy では半分にする時に bpm /= 2 としていて小数が出る
        可能性がありましたが、画面には3桁の整数で出すため
        Math.round で丸めるようにしました。
        */
        while(bpm < BPM_MIN){ bpm = bpm * 2; }
        while(bpm > BPM_MAX){ bpm = Math.round(bpm / 2); }

        return bpm;

    }
    finally{

        /*
        finally は「成功しても失敗しても最後に必ず通る」場所です。

        AudioContext は作りっぱなしにするとブラウザ側で数を数えられて
        いて、一定数を超えると新しく作れなくなります。1曲再生するたびに
        1つ作るため、解析が終わったら必ず閉じます(legacyには無かった
        処理で、あちらは2曲だけを扱う作りだったため問題が出なかった
        のだと思われます)。
        */
        audioContext.close();

    }

}


/**
 * 1曲を解析して、結果を music_library に保存します。
 *
 * @param  {String} trackId … 解析する曲のID
 * @return {Number} 解析後のBPM(失敗時は既定値)
 */
async function analyzeTrackBpm(trackId){

    const track = libraryMap[trackId];

    if(!track || !track.file_handle){ return BPM_FALLBACK; }

    try{

        // --- 権限を確認し直します(再生処理と同じパターン) ---
        let permission = await track.file_handle.queryPermission({mode:"read"});

        if(permission !== "granted"){
            permission = await track.file_handle.requestPermission({mode:"read"});
        }

        if(permission !== "granted"){
            return track.baseBPM || BPM_FALLBACK;
        }

        const file = await track.file_handle.getFile();

        const bpm = await estimateBpm(file);

        // --- 結果をDBへ保存します ---
        track.baseBPM = bpm;

        // どのバージョンのロジックで解析したかも記録します
        track.bpm_analyzer_version = BPM_ANALYZER_VERSION;

        await idbPut(STORE_MUSIC,track);

        console.log("BPM解析 :",track.file_name,"→",bpm);

        return bpm;

    }
    catch(error){

        /*
        1曲の失敗で再生まで止めないよう、ここで受け止めます。
        bpm_analyzer_version を立てないままにしているので、
        次にこの曲を再生した時にもう一度挑戦されます。
        */
        console.error(
            "BPM解析失敗 :",
            track.file_name,
            error.name,
            error.message
        );

        return track.baseBPM || BPM_FALLBACK;

    }

}
