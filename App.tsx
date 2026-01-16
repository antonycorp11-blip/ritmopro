
import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { GameState, LevelConfig, ScoreData, HitResult } from './types';
import { LEVELS, TIMING_THRESHOLDS } from './constants';
import { audioEngine } from './services/audioEngine';
import TouchArea from './components/TouchArea';
import { supabase } from './services/supabaseClient';

const TAP_LATENCY_COMPENSATION = 0.055;
const MAX_TIME_LIMIT = 90;
const INITIAL_TIME = 45;

// --- Efeitos Visuais ---

const FireVfx = memo(({ intensity }: { intensity: number }) => {
  if (intensity < 5) return null;
  const opacity = Math.min(intensity / 100, 0.45);
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div
        className="absolute bottom-0 w-full h-[60vh] bg-gradient-to-t from-orange-600/20 via-orange-900/5 to-transparent transition-opacity duration-1000"
        style={{ opacity }}
      />
      <div
        className="absolute bottom-[-10vh] left-1/2 -translate-x-1/2 w-[140%] h-[50vh] bg-orange-500/10 blur-[120px] rounded-full transition-all duration-700"
        style={{ transform: `translateX(-50%) scale(${1 + intensity / 200})`, opacity: opacity * 1.5 }}
      />
    </div>
  );
});

const GameTimer = memo(({ timeLeft }: { timeLeft: number }) => (
  <div className="bg-[#1a0f0a]/90 backdrop-blur-xl border border-orange-500/40 px-4 py-2 rounded-2xl text-center shadow-[0_0_20px_rgba(249,115,22,0.15)] min-w-[85px]">
    <span className="block text-[8px] text-orange-500 font-black uppercase tracking-widest mb-0.5">TEMPO</span>
    <span className={`text-2xl font-black tabular-nums leading-none ${timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
      {timeLeft}s
    </span>
  </div>
));

const App: React.FC = () => {
  const [state, setState] = useState<GameState>(GameState.MENU);
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('studio_acorde_player_name') || '');
  const [deviceId] = useState(() => {
    let id = localStorage.getItem('studio_acorde_device_id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('studio_acorde_device_id', id);
    }
    return id;
  });

  const [bpm, setBpm] = useState(80);
  const [score, setScore] = useState({ pts: 0, combo: 0, accuracy: 100, maxCombo: 0 });
  const [timeLeft, setTimeLeft] = useState(INITIAL_TIME);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [feedback, setFeedback] = useState('');
  const [lastDiff, setLastDiff] = useState<number | null>(null);
  const [globalRanking, setGlobalRanking] = useState<any[]>([]);
  const [timeAddedFeedback, setTimeAddedFeedback] = useState<string | null>(null);
  const [isSpeedUp, setIsSpeedUp] = useState(false);

  const timerIDRef = useRef<number | null>(null);
  const nextBeatTimeRef = useRef(0);
  const expectedHitsRef = useRef<{ time: number, processed: boolean }[]>([]);
  const currentBpmRef = useRef(80);
  const timeLeftRef = useRef(INITIAL_TIME);
  const lastTapTimeRef = useRef(0);
  const startTimeRef = useRef(0);

  useEffect(() => { currentBpmRef.current = bpm; }, [bpm]);

  const fetchRanking = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('ritmo_pro_ranking')
        .select('player_name, score, accuracy, bpm')
        .order('score', { ascending: false })
        .limit(10);
      if (data) setGlobalRanking(data);
    } catch (e) {
      console.warn("Ranking loading failed");
    }
  }, []);

  const stopGame = useCallback(async () => {
    if (timerIDRef.current) window.clearTimeout(timerIDRef.current);
    setState(GameState.RESULTS);

    if (currentBpmRef.current >= 80 && score.pts > 0) {
      const pName = playerName.trim() || 'Anon';
      const { data: existingData } = await supabase
        .from('ritmo_pro_ranking')
        .select('score')
        .eq('player_name', pName)
        .order('score', { ascending: false })
        .limit(1);

      const highP = existingData && existingData.length > 0 ? existingData[0].score : 0;
      if (score.pts > highP) {
        await supabase.from('ritmo_pro_ranking').insert([{
          player_name: pName,
          device_id: deviceId,
          score: parseFloat(score.pts.toFixed(2)),
          accuracy: score.accuracy,
          max_combo: score.maxCombo,
          bpm: currentBpmRef.current
        }]);
      }
    }
  }, [score.pts, score.accuracy, score.maxCombo, playerName, deviceId]);

  const handleMiss = useCallback(() => {
    setScore(s => {
      if (s.maxCombo >= 20 || s.combo >= 20) {
        setTimeAddedFeedback('-2.0s');
        timeLeftRef.current = Math.max(0, timeLeftRef.current - 2.0);
        setTimeout(() => setTimeAddedFeedback(null), 800);
      }
      return { ...s, combo: 0 };
    });
    setFeedback('FALTOU!');
  }, []);

  const scheduler = useCallback(() => {
    const now = audioEngine.getCurrentTime();
    timeLeftRef.current -= 0.025;
    const sec = Math.max(0, Math.round(timeLeftRef.current));
    if (sec !== timeLeft) setTimeLeft(sec);
    if (timeLeftRef.current <= 0) { stopGame(); return; }

    const tHorizon = now + 0.20;
    while (nextBeatTimeRef.current < tHorizon) {
      const t = nextBeatTimeRef.current;
      audioEngine.playStrum(t, expectedHitsRef.current.length % 4 === 0);
      expectedHitsRef.current.push({ time: t, processed: false });
      nextBeatTimeRef.current += (60.0 / currentBpmRef.current);
    }

    const activeIdx = expectedHitsRef.current.findIndex(h => h.time > now - 0.1);
    if (activeIdx !== -1) {
      const beat = activeIdx % 4;
      if (beat !== activeBeat) setActiveBeat(beat);
    }

    expectedHitsRef.current.forEach(h => {
      if (!h.processed && now > h.time + 0.6) {
        h.processed = true;
        handleMiss();
      }
    });
    timerIDRef.current = window.setTimeout(scheduler, 25);
  }, [timeLeft, activeBeat, stopGame, handleMiss]);

  const startGame = () => {
    audioEngine.init();
    expectedHitsRef.current = [];
    setScore({ pts: 0, combo: 0, accuracy: 100, maxCombo: 0 });
    setTimeLeft(INITIAL_TIME);
    timeLeftRef.current = INITIAL_TIME;
    nextBeatTimeRef.current = audioEngine.getCurrentTime() + 0.4;
    startTimeRef.current = audioEngine.getCurrentTime();
    setFeedback('FOCO!');
    setIsSpeedUp(false);
    setState(GameState.PLAYING);
    scheduler();
  };

  const handleTap = useCallback(() => {
    const now = audioEngine.getCurrentTime();
    if (now - lastTapTimeRef.current < 0.120) return;
    lastTapTimeRef.current = now;
    const compNow = now - TAP_LATENCY_COMPENSATION;
    let closestIdx = -1;
    let minD = 0.6;
    const start = Math.max(0, expectedHitsRef.current.length - 8);
    for (let i = start; i < expectedHitsRef.current.length; i++) {
      const h = expectedHitsRef.current[i];
      if (h.processed) continue;
      const d = Math.abs(compNow - h.time);
      if (d < minD) { minD = d; closestIdx = i; }
    }

    setScore(prev => {
      let rating = 'MISS';
      let ptsValue = 0;
      let diff = 0;
      let accChange = -4;

      if (closestIdx !== -1) {
        const target = expectedHitsRef.current[closestIdx];
        target.processed = true;
        diff = (compNow - target.time) * 1000;
        setLastDiff(diff);
        const absD = Math.abs(diff);
        if (absD < TIMING_THRESHOLDS.PERFECT) { rating = 'PERFECT'; ptsValue = 1.0; setFeedback('🔥 PERFEITO!'); accChange = 1; }
        else if (absD < TIMING_THRESHOLDS.GOOD) { rating = 'GOOD'; ptsValue = 0.5; setFeedback('BOM!'); accChange = 0.5; }
        else if (absD < TIMING_THRESHOLDS.OK) { rating = 'OK'; ptsValue = 0.2; setFeedback('REGULAR'); accChange = 0; }
        else { setFeedback(diff < 0 ? 'ANTECIPOU' : 'ATRASOU'); accChange = -2; }
      } else {
        setFeedback('ERROU!');
      }

      if (ptsValue > 0) {
        const timeBase = ptsValue * 1.0;
        const comboBonus = prev.combo * 0.01;
        const timeGain = timeBase + comboBonus;
        const prevT = timeLeftRef.current;
        timeLeftRef.current = Math.min(MAX_TIME_LIMIT, timeLeftRef.current + timeGain);

        if (prevT < MAX_TIME_LIMIT) {
          setTimeAddedFeedback(`+${(timeLeftRef.current - prevT).toFixed(1)}s`);
          setTimeout(() => setTimeAddedFeedback(null), 800);
        }
      } else if (prev.maxCombo >= 20 || prev.combo >= 20) {
        setTimeAddedFeedback('-1.0s');
        timeLeftRef.current = Math.max(0, timeLeftRef.current - 1.0);
        setTimeout(() => setTimeAddedFeedback(null), 800);
      }

      const isG = ptsValue > 0;
      const nc = isG ? prev.combo + 1 : 0;

      // MECANISMO DE SPEED UP: Aumenta 10 BPM a cada 20 de combo
      if (nc > 0 && nc % 20 === 0 && isG) {
        currentBpmRef.current += 10;
        setIsSpeedUp(true);
        setFeedback('⚡ ACELERO!');
        setTimeout(() => setIsSpeedUp(false), 1500);
      }

      const fPoints = ptsValue > 0 ? (ptsValue + (nc * 0.015)) : 0;
      const bpmMult = currentBpmRef.current / 100;

      return {
        pts: prev.pts + (fPoints * bpmMult),
        combo: nc,
        maxCombo: Math.max(prev.maxCombo, nc),
        accuracy: Math.min(100, Math.max(0, prev.accuracy + accChange))
      };
    });
  }, []);

  return (
    <div className={`fixed inset-0 bg-black text-white font-sans overflow-hidden select-none touch-none transition-colors duration-300 ${isSpeedUp ? 'bg-orange-950/20' : 'bg-[radial-gradient(circle_at_50%_0%,_#1a100a_0%,_#000000_100%)]'}`}>
      <FireVfx intensity={score.combo} />

      {state === GameState.MENU && (
        <div className="flex flex-col h-full p-8 items-center justify-between animate-in fade-in zoom-in duration-500 py-12">
          <header className="text-center">
            <h1 className="text-5xl font-black text-orange-500 italic tracking-tighter drop-shadow-[0_0_20px_rgba(249,115,22,0.3)]">
              STUDIO<span className="text-white">ACORDE</span>
            </h1>
            <p className="text-[10px] text-orange-900 font-black tracking-[0.5em] uppercase mt-2">ALTA PERFORMANCE RÍTMICA</p>
          </header>
          <div className="w-full max-w-sm space-y-4">
            <div className="bg-[#1a0f0a]/80 backdrop-blur-xl border-2 border-orange-500/10 p-8 rounded-[3rem] shadow-2xl relative">
              <div className="absolute -top-3 left-8 bg-orange-600 px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest text-white">IDENTIFICAÇÃO</div>
              <input type="text" placeholder="Nome ou @user" value={playerName} onChange={(e) => { setPlayerName(e.target.value); localStorage.setItem('studio_acorde_player_name', e.target.value) }} className="w-full bg-black/60 border border-orange-950/50 rounded-2xl py-5 px-6 text-white font-black outline-none focus:border-orange-500 mb-8 transition-all" />
              <div className="text-center mb-6">
                <span className={`text-9xl font-black leading-none tabular-nums tracking-tighter transition-colors ${bpm < 80 ? 'text-red-500' : 'text-white'}`}>{bpm}</span>
                <p className="text-orange-900 font-extrabold text-[10px] uppercase tracking-[0.2em] mt-2">BPM DO ESTUDO</p>
              </div>
              <input type="range" min="80" max="180" step="10" value={bpm} onChange={(e) => setBpm(parseInt(e.target.value))} className="w-full h-3 bg-black rounded-full appearance-none accent-orange-500 mb-8" />
              <button disabled={!playerName.trim()} onClick={startGame} className="w-full bg-orange-600 text-white font-black py-6 rounded-[2rem] text-xl shadow-2xl shadow-orange-600/20 active:scale-95 transition-all disabled:opacity-30">INICIAR ESTUDO</button>
            </div>
            <button onClick={() => { fetchRanking(); setState(GameState.RANKING) }} className="w-full bg-white/5 border border-white/10 py-5 rounded-3xl text-[10px] font-black text-white/40 tracking-[0.3em] uppercase transition-colors">🏆 Ver Ranking Global</button>
          </div>
          <footer className="opacity-20 text-[7px] font-bold tracking-[1em] text-orange-900 uppercase">PRO SERIES 2.0</footer>
        </div>
      )}

      {state === GameState.RANKING && (
        <div className="flex flex-col h-full p-6 animate-in slide-in-from-right duration-300 bg-[#0a0604] py-10">
          <header className="flex justify-between items-center mb-10 px-2">
            <h2 className="text-3xl font-black text-white italic">RANKING <span className="text-orange-500 uppercase">LIVE</span></h2>
            <button onClick={() => setState(GameState.MENU)} className="bg-white/5 p-3 rounded-2xl text-[10px] font-black text-orange-500 uppercase active:scale-90 transition-all">Sair</button>
          </header>
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {globalRanking.length > 0 ? globalRanking.map((r, i) => (
              <div key={i} className={`flex justify-between items-center p-5 rounded-[2rem] border transition-all ${i === 0 ? 'bg-orange-600 border-orange-400' : 'bg-[#1a0f0a] border-orange-900/10'}`}>
                <div className="flex items-center gap-5">
                  <span className={`font-black italic text-2xl ${i === 0 ? 'text-white' : 'text-orange-500'}`}>{i + 1}º</span>
                  <div>
                    <p className={`font-black text-sm ${i === 0 ? 'text-white' : 'text-slate-100'}`}>{r.player_name}</p>
                    <p className={`text-[9px] font-bold uppercase ${i === 0 ? 'text-orange-200' : 'text-orange-900'}`}>{r.bpm} BPM</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-black">{r.score.toFixed(1)}</p>
                  <p className={`text-[9px] font-bold ${i === 0 ? 'text-orange-200' : 'text-orange-800'}`}>{r.accuracy}% ACC</p>
                </div>
              </div>
            )) : (
              <p className="text-center text-orange-900 font-black py-10">Buscando melhores...</p>
            )}
          </div>
        </div>
      )}

      {state === GameState.PLAYING && (
        <div className="flex flex-col h-full p-6 justify-between items-center z-10 py-12">
          <header className="w-full flex justify-between items-start">
            <div className="flex gap-2">
              <div className="bg-orange-600/10 backdrop-blur-md border border-orange-500/20 px-4 py-2 rounded-2xl">
                <span className="block text-[8px] text-orange-500 font-black uppercase tracking-widest mb-0.5">PTS</span>
                <span className="text-2xl font-black tabular-nums leading-none">{score.pts.toFixed(1)}</span>
              </div>
              {/* INDICADOR DE VELOCIDADE ATUAL */}
              <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-2xl">
                <span className="block text-[8px] text-white/40 font-black uppercase mb-0.5">BPM</span>
                <span className="text-2xl font-black text-orange-500 leading-none">{currentBpmRef.current}</span>
              </div>
            </div>
            <GameTimer timeLeft={timeLeft} />
          </header>

          <div className="w-full flex flex-col items-center">
            <div className="flex gap-8 mb-12">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-6 h-6 rounded-full transition-all duration-100 ${activeBeat === i ? 'bg-orange-500 scale-150 shadow-[0_0_30px_#f97316]' : 'bg-white/5 border border-white/10'}`} />
              ))}
            </div>
            <div className="text-center relative">
              {/* Efeito Visual de Speed Up */}
              {isSpeedUp && (
                <div className="absolute -top-20 left-1/2 -translate-x-1/2 text-orange-500 text-4xl font-black italic animate-ping whitespace-nowrap">
                  SPEED UP! +10 BPM
                </div>
              )}
              <div className="text-[min(11rem,25vw)] font-black text-white italic tracking-tighter leading-none transition-all duration-100">{score.combo}<span className="text-orange-500 text-[min(4rem,10vw)]">x</span></div>
              <p className="text-2xl font-black text-orange-400 mt-6 h-8 drop-shadow-[0_0_20px_rgba(249,115,22,0.4)]">{feedback}</p>
            </div>
          </div>

          <div className="w-full max-w-[300px] flex flex-col items-center gap-4">
            <div className="w-full h-2 bg-white/5 rounded-full relative overflow-hidden ring-1 ring-white/10 mb-4 shadow-inner">
              {lastDiff !== null && (
                <div className={`absolute h-full w-6 transition-all duration-150 ${Math.abs(lastDiff) < TIMING_THRESHOLDS.PERFECT ? 'bg-orange-500 shadow-[0_0_30px_#f97316]' : 'bg-red-900'}`} style={{ left: `${50 + (lastDiff / 5.0)}%` }} />
              )}
              <div className="absolute left-1/2 -translate-x-1/2 w-[2px] h-full bg-white/20" />
            </div>

            <TouchArea onTap={handleTap} />

            <button onClick={stopGame} className="bg-red-600/10 border-2 border-red-600/20 text-red-500 font-black py-4 px-10 rounded-2xl text-[12px] uppercase tracking-[0.3em] active:bg-red-600 active:text-white shadow-xl transition-all mt-6">ENCERRAR PARTIDA</button>
          </div>

          {timeAddedFeedback && (
            <div className={`fixed top-1/4 right-5 text-4xl font-black animate-bounce z-50 drop-shadow-2xl ${timeAddedFeedback.includes('-') ? 'text-red-500' : 'text-green-500'}`}>
              {timeAddedFeedback}
            </div>
          )}
        </div>
      )}

      {state === GameState.RESULTS && (
        <div className="flex flex-col h-full p-8 items-center justify-center animate-in zoom-in duration-300 bg-[#0a0604] py-12">
          <div className="bg-[#1a0f0a] border-2 border-orange-600/20 p-12 rounded-[4rem] w-full max-w-md text-center shadow-[0_0_100px_rgba(249,115,22,0.1)] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1.5 bg-orange-600" />
            <span className="text-[11px] text-orange-500 font-black uppercase tracking-[0.5em]">Treino Finalizado</span>
            <h2 className="text-8xl font-black text-white tracking-tighter my-8">{score.pts.toFixed(1)}</h2>
            <div className="grid grid-cols-2 gap-6 mb-12">
              <div className="bg-black/60 p-5 rounded-3xl border border-orange-900/10">
                <p className="text-[9px] text-orange-900 font-black uppercase mb-1">Precisão</p>
                <p className="text-2xl font-black text-white">{score.accuracy}%</p>
              </div>
              <div className="bg-black/60 p-5 rounded-3xl border border-orange-900/10">
                <p className="text-[9px] text-orange-900 font-black uppercase mb-1">Combo Máx</p>
                <p className="text-2xl font-black text-orange-500">{score.maxCombo}x</p>
              </div>
            </div>
            <button onClick={() => setState(GameState.MENU)} className="w-full bg-orange-600 text-white font-black py-6 rounded-[2rem] text-xl active:scale-95 shadow-xl shadow-orange-900/20 transition-all">VOLTAR AO MENU</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
