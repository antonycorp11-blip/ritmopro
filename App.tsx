
import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { GameState, LevelConfig, ScoreData, HitResult } from './types';
import { LEVELS, TIMING_THRESHOLDS } from './constants';
import { audioEngine } from './services/audioEngine';
import TouchArea from './components/TouchArea';
import { supabase } from './services/supabaseClient';

const TAP_LATENCY_COMPENSATION = 0.040;
const MAX_TIME_LIMIT = 60;
const ERROR_PENALTY_SECONDS = 30;

// --- Sub-componentes Otimizados ---

// Timer desacoplado para evitar re-render da App
const GameTimer = memo(({ timeLeft }: { timeLeft: number }) => (
  <div className="bg-[#1a0f0a]/80 backdrop-blur-md border border-orange-900/40 px-3 py-1.5 rounded-xl text-center shadow-xl min-w-[75px]">
    <span className="block text-[7px] text-orange-500 font-black uppercase">Tempo</span>
    <span className={`text-xl font-black tabular-nums ${timeLeft < 10 ? 'text-red-500 animate-pulse' : 'text-white'}`}>
      {timeLeft}s
    </span>
  </div>
));

// Overlay de Fogo (Usa apenas CSS para zero custo de CPU no metronomo)
const FireVfx = memo(({ intensity }: { intensity: number }) => {
  if (intensity < 10) return null;
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div
        className="absolute bottom-0 w-full h-full bg-orange-600/5 transition-opacity duration-1000"
        style={{ opacity: Math.min(intensity / 100, 0.4) }}
      />
      <div className="fire-glow fixed bottom-[-10vh] left-1/2 -translate-x-1/2 w-[120%] h-[40vh] bg-orange-600/10 blur-[100px] rounded-full" />
    </div>
  );
});

const App: React.FC = () => {
  // --- Estados de Navegação ---
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

  // --- Estados de Jogo (Reduzidos ao mínimo) ---
  const [bpm, setBpm] = useState(80);
  const [score, setScore] = useState({ pts: 0, combo: 0, accuracy: 100, maxCombo: 0 });
  const [timeLeft, setTimeLeft] = useState(20);
  const [activeBeat, setActiveBeat] = useState(-1);
  const [feedback, setFeedback] = useState('');
  const [lastDiff, setLastDiff] = useState<number | null>(null);
  const [globalRanking, setGlobalRanking] = useState<any[]>([]);

  // --- REFS para Lógica (Crucial para performance, evita re-renders) ---
  const timerIDRef = useRef<number | null>(null);
  const nextBeatTimeRef = useRef(0);
  const expectedHitsRef = useRef<{ time: number, processed: boolean }[]>([]);
  const currentBpmRef = useRef(80);
  const timeLeftRef = useRef(20);
  const lastTapTimeRef = useRef(0);
  const hitsRef = useRef<HitResult[]>([]);
  const startTimeRef = useRef(0);

  // --- Sincronização de Chaves ---
  useEffect(() => { currentBpmRef.current = bpm; }, [bpm]);

  // --- Ranking Lógica ---
  const fetchRanking = useCallback(async () => {
    const { data } = await supabase
      .from('ritmo_pro_ranking')
      .select('player_name, score, accuracy, bpm')
      .order('score', { ascending: false })
      .limit(10);
    if (data) setGlobalRanking(data);
  }, []);

  // --- Loop de Jogo (Scheduler) ---
  const scheduler = useCallback(() => {
    const now = audioEngine.getCurrentTime();

    // Atualização do Tempo (1x por ciclo de 25ms, mas renderiza apenas se mudar o segundo)
    timeLeftRef.current -= 0.025;
    const sec = Math.max(0, Math.round(timeLeftRef.current));
    if (sec !== timeLeft) setTimeLeft(sec);

    if (timeLeftRef.current <= 0) {
      stopGame();
      return;
    }

    // Agendamento de Sons
    const timeHorizon = now + 0.15;
    while (nextBeatTimeRef.current < timeHorizon) {
      const t = nextBeatTimeRef.current;
      const count = expectedHitsRef.current.length;
      audioEngine.playStrum(t, count % 4 === 0);
      expectedHitsRef.current.push({ time: t, processed: false });
      nextBeatTimeRef.current += (60.0 / currentBpmRef.current);
    }

    // Feedback Visual do Beat
    const activeNoteIdx = expectedHitsRef.current.findIndex(h => h.time > now - 0.1);
    if (activeNoteIdx !== -1) {
      const beat = activeNoteIdx % 4;
      if (beat !== activeBeat) setActiveBeat(beat);
    }

    // Verificação de Miss (Processa fora do estado para performance)
    expectedHitsRef.current.forEach(h => {
      if (!h.processed && now > h.time + 0.4) {
        h.processed = true;
        setScore(s => ({ ...s, combo: 0 }));
        setFeedback('FALTOU!');
      }
    });

    timerIDRef.current = window.setTimeout(scheduler, 25);
  }, [timeLeft, activeBeat]);

  const startGame = () => {
    audioEngine.init();
    expectedHitsRef.current = [];
    hitsRef.current = [];
    setScore({ pts: 0, combo: 0, accuracy: 100, maxCombo: 0 });
    setTimeLeft(20);
    timeLeftRef.current = 20;
    nextBeatTimeRef.current = audioEngine.getCurrentTime() + 0.3;
    startTimeRef.current = audioEngine.getCurrentTime();
    setState(GameState.PLAYING);
    scheduler();
  };

  const stopGame = useCallback(async () => {
    if (timerIDRef.current) window.clearTimeout(timerIDRef.current);
    const duration = audioEngine.getCurrentTime() - startTimeRef.current;

    // Salvar Ranking
    if (currentBpmRef.current >= 80 && score.pts > 0) {
      await supabase.from('ritmo_pro_ranking').insert([{
        player_name: playerName || 'Anon',
        device_id: deviceId,
        score: parseFloat(score.pts.toFixed(2)),
        accuracy: score.accuracy,
        max_combo: score.maxCombo,
        bpm: currentBpmRef.current
      }]);
    }

    setState(GameState.RESULTS);
  }, [score, playerName, deviceId]);

  // --- INPUT: Otimizado para latência Zero ---
  const handleTap = useCallback(() => {
    const rawNow = audioEngine.getCurrentTime();

    // Debounce de hardware (120ms)
    if (rawNow - lastTapTimeRef.current < 0.120) return;
    lastTapTimeRef.current = rawNow;

    const compNow = rawNow - TAP_LATENCY_COMPENSATION;
    let closest = -1;
    let minD = 0.4;

    // Busca rápida apenas nas últimas notas
    const start = Math.max(0, expectedHitsRef.current.length - 5);
    for (let i = start; i < expectedHitsRef.current.length; i++) {
      const h = expectedHitsRef.current[i];
      if (h.processed) continue;
      const d = Math.abs(compNow - h.time);
      if (d < minD) { minD = d; closest = i; }
    }

    setScore(prev => {
      let rating = 'MISS';
      let ptsEarned = 0;
      let diff = 0;

      if (closest !== -1) {
        const target = expectedHitsRef.current[closest];
        target.processed = true;
        diff = (compNow - target.time) * 1000;
        setLastDiff(diff);

        const absD = Math.abs(diff);
        if (absD < TIMING_THRESHOLDS.PERFECT) { rating = 'PERFECT'; ptsEarned = 1.0; setFeedback('PRO!'); }
        else if (absD < TIMING_THRESHOLDS.GOOD) { rating = 'GOOD'; ptsEarned = 0.5; setFeedback('BOA!'); }
        else if (absD < TIMING_THRESHOLDS.OK) { rating = 'OK'; ptsEarned = 0.2; setFeedback('OK'); }
        else { setFeedback(diff < 0 ? 'ANTECIPOU' : 'ATRASOU'); }
      } else {
        setFeedback('EXTRA!');
      }

      // Ganho de tempo
      if (ptsEarned > 0) {
        timeLeftRef.current = Math.min(MAX_TIME_LIMIT, timeLeftRef.current + (ptsEarned * 1.5));
      }

      const isG = ptsEarned > 0;
      const nc = isG ? prev.combo + 1 : 0;
      const finalP = ptsEarned > 0 ? (ptsEarned + (nc * 0.01)) : 0;
      const bpmMult = currentBpmRef.current / 100;

      return {
        pts: prev.pts + (finalP * bpmMult),
        combo: nc,
        maxCombo: Math.max(prev.maxCombo, nc),
        accuracy: Math.min(100, Math.max(0, isG ? prev.accuracy : prev.accuracy - 3))
      };
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-black text-white font-sans overflow-hidden select-none touch-none">
      <FireVfx intensity={score.combo} />

      {/* --- MODO: MENU --- */}
      {state === GameState.MENU && (
        <div className="flex flex-col h-full p-8 items-center justify-center animate-in fade-in duration-500">
          <header className="text-center mb-12">
            <h1 className="text-5xl font-black text-white italic tracking-tighter">STUDIO<span className="text-orange-500">ACORDE</span></h1>
            <p className="text-[10px] text-orange-900 font-bold tracking-[0.4em] uppercase">Métrica de Precisão 1.0</p>
          </header>

          <div className="w-full max-w-sm space-y-6">
            <div className="bg-[#1a0f0a] border border-orange-900/20 p-6 rounded-[2.5rem] shadow-2xl">
              <input
                type="text"
                placeholder="Seu Nome"
                value={playerName}
                onChange={(e) => { setPlayerName(e.target.value); localStorage.setItem('studio_acorde_player_name', e.target.value) }}
                className="w-full bg-black border border-orange-900/30 rounded-2xl py-4 px-6 text-white font-bold outline-none focus:border-orange-500 mb-6"
              />

              <div className="text-center mb-4">
                <span className={`text-8xl font-black tabular-nums ${bpm < 80 ? 'text-red-500' : 'text-white'}`}>{bpm}</span>
                <p className="text-orange-500 font-black text-[10px] uppercase tracking-widest mt-1">BPM Selecionado</p>
              </div>

              <input type="range" min="40" max="180" value={bpm} onChange={(e) => setBpm(parseInt(e.target.value))} className="w-full h-2 bg-black rounded-full accent-orange-500 mb-8" />

              <button
                disabled={!playerName.trim()}
                onClick={startGame}
                className="w-full bg-orange-600 text-white font-black py-5 rounded-3xl text-xl shadow-xl shadow-orange-900/20 active:scale-95 transition-all disabled:opacity-20"
              >
                COMEÇAR TREINO
              </button>
            </div>

            <button
              onClick={() => { fetchRanking(); setState(GameState.RANKING) }}
              className="w-full bg-black/40 border border-orange-900/20 py-4 rounded-2xl text-[10px] font-black text-orange-800 tracking-[0.3em] uppercase"
            >
              Ver Ranking Global
            </button>
          </div>
        </div>
      )}

      {/* --- MODO: RANKING (Tela Separada) --- */}
      {state === GameState.RANKING && (
        <div className="flex flex-col h-full p-6 animate-in slide-in-from-right duration-300 bg-[#0a0604]">
          <header className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-black text-white italic">RANKING <span className="text-orange-500">GLOBAL</span></h2>
            <button onClick={() => setState(GameState.MENU)} className="text-[10px] font-black text-orange-900 uppercase">Voltar</button>
          </header>

          <div className="flex-1 overflow-y-auto space-y-3 pr-2">
            {globalRanking.length > 0 ? globalRanking.map((r, i) => (
              <div key={i} className="flex justify-between items-center bg-[#1a0f0a] p-4 rounded-2xl border border-orange-900/10">
                <div className="flex items-center gap-4">
                  <span className="text-orange-500 font-black italic text-lg">{i + 1}º</span>
                  <div>
                    <p className="font-black text-white text-sm">{r.player_name}</p>
                    <p className="text-[9px] text-orange-900 font-bold uppercase">{r.bpm} BPM</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-black text-white">{r.score.toFixed(1)}</p>
                  <p className="text-[8px] text-orange-800 font-bold">{r.accuracy}% ACC</p>
                </div>
              </div>
            )) : (
              <p className="text-center text-orange-950 font-black py-20 animate-pulse">CARREGANDO RITMISTAS...</p>
            )}
          </div>
        </div>
      )}

      {/* --- MODO: PLAYING --- */}
      {state === GameState.PLAYING && (
        <div className="flex flex-col h-full p-6 justify-between items-center z-10">
          <header className="w-full flex justify-between items-start">
            <div className="bg-orange-600/10 border border-orange-500/20 px-3 py-1 rounded-lg">
              <span className="block text-[6px] text-orange-500 font-bold uppercase">Pontuação</span>
              <span className="text-lg font-black tabular-nums">{score.pts.toFixed(1)}</span>
            </div>
            <GameTimer timeLeft={timeLeft} />
          </header>

          <div className="w-full flex flex-col items-center">
            {/* Beat Tracker */}
            <div className="flex gap-5 mb-10">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-3 h-3 rounded-full transition-all duration-75 ${activeBeat === i ? 'bg-orange-500 scale-150 shadow-[0_0_15px_#f97316]' : 'bg-white/5'}`} />
              ))}
            </div>

            {/* Combo & Feedback */}
            <div className="text-center">
              <div className="text-9xl font-black text-white italic tracking-tighter leading-none">{score.combo}<span className="text-orange-500 text-4xl">x</span></div>
              <p className="text-2xl font-black text-orange-400 mt-4 h-8 drop-shadow-[0_0_10px_rgba(249,115,22,0.5)]">{feedback}</p>
            </div>
          </div>

          <div className="w-full max-w-xs flex flex-col items-center gap-8">
            <TouchArea onTap={handleTap} />

            {/* Accuracy Pinpoint */}
            <div className="w-full h-1.5 bg-white/10 rounded-full relative overflow-hidden">
              {lastDiff !== null && <div className="absolute h-full w-4 bg-orange-500 transition-all duration-100" style={{ left: `${50 + (lastDiff / 5.0)}%` }} />}
              <div className="absolute left-1/2 -translate-x-1/2 w-[1px] h-full bg-white/40" />
            </div>

            <button onClick={stopGame} className="text-[10px] font-black text-orange-950 uppercase tracking-[0.4em] hover:text-red-600 transition-colors">Encerrar Partida</button>
          </div>
        </div>
      )}

      {/* --- MODO: RESULTS --- */}
      {state === GameState.RESULTS && (
        <div className="flex flex-col h-full p-8 items-center justify-center animate-in zoom-in duration-300 bg-[#0a0604]">
          <div className="bg-[#1a0f0a] border border-orange-900/20 p-10 rounded-[3.5rem] w-full max-w-sm text-center shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-1 bg-orange-600" />
            <span className="text-[10px] text-orange-500 font-black uppercase tracking-[0.5em]">Treino Finalizado</span>
            <h2 className="text-8xl font-black text-white tracking-tighter my-4">{score.pts.toFixed(1)}</h2>

            <div className="grid grid-cols-2 gap-4 mb-10">
              <div className="bg-black/50 p-4 rounded-2xl">
                <p className="text-[8px] text-orange-900 font-bold uppercase">Precisão</p>
                <p className="text-xl font-black text-white">{score.accuracy}%</p>
              </div>
              <div className="bg-black/50 p-4 rounded-2xl">
                <p className="text-[8px] text-orange-900 font-bold uppercase">Combo Máx</p>
                <p className="text-xl font-black text-orange-500">{score.maxCombo}x</p>
              </div>
            </div>

            <button onClick={() => setState(GameState.MENU)} className="w-full bg-orange-600 text-white font-black py-5 rounded-2xl text-lg active:scale-95 transition-all">VOLTAR AO MENU</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
