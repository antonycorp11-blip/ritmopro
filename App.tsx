
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
  const [isLocked, setIsLocked] = useState(true); // Começa travado até verificar
  const [loadingAuth, setLoadingAuth] = useState(true);

  const [playerName, setPlayerName] = useState(() => localStorage.getItem('studio_acorde_player_name') || '');
  const [playerPin, setPlayerPin] = useState(() => localStorage.getItem('studio_acorde_player_pin') || ''); // Novo estado para PIN

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  const timerIDRef = useRef<number | null>(null);
  const nextBeatTimeRef = useRef(0);
  const expectedHitsRef = useRef<{ time: number, processed: boolean }[]>([]);
  const currentBpmRef = useRef(80);
  const timeLeftRef = useRef(INITIAL_TIME);
  const lastTapTimeRef = useRef(0);
  const startTimeRef = useRef(0);
  const consecutiveMissesRef = useRef(0);
  const activeBeatRef = useRef(-1);
  const lastStateTimeRef = useRef(INITIAL_TIME);
  const scoreRef = useRef(score);
  const playerNameRef = useRef(playerName);
  const playerPinRef = useRef(playerPin);
  const deviceIdRef = useRef(deviceId);

  useEffect(() => { scoreRef.current = score; }, [score]);
  useEffect(() => { playerNameRef.current = playerName; }, [playerName]);
  useEffect(() => { playerPinRef.current = playerPin; }, [playerPin]);
  useEffect(() => { deviceIdRef.current = deviceId; }, [deviceId]);

  // --- TRAVA DE SEGURANÇA E LOGIN ---
  useEffect(() => {
    const performAuth = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlPin = params.get('pin');
      const storedPin = localStorage.getItem('studio_acorde_player_pin');

      const pinToVerify = urlPin || storedPin;

      if (!pinToVerify) {
        setIsLocked(true);
        setLoadingAuth(false);
        return;
      }

      try {
        // Busca na tabela UNIFICADA 'players'
        const { data, error } = await supabase
          .from('players')
          .select('name, recovery_pin')
          .eq('recovery_pin', pinToVerify)
          .single();

        if (data && !error) {
          // SUCESSO
          setPlayerName(data.name);
          setPlayerPin(data.recovery_pin);
          localStorage.setItem('studio_acorde_player_name', data.name);
          localStorage.setItem('studio_acorde_player_pin', data.recovery_pin);
          setIsLocked(false);

          // Limpa URL
          if (urlPin) {
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } else {
          // FALHA
          console.error("Auth falhou:", error);
          if (urlPin) {
            // Se o PIN da URL for inválido, podemos limpar ou bloquear.
            // Bloqueia se não achar.
          }
          // Se o PIN armazenado não for mais válido (ex: mudou no banco), deve bloquear?
          // Por segurança, se a verificação falha, bloqueia.
          setIsLocked(true);
          localStorage.removeItem('studio_acorde_player_pin'); // Limpa inválido
        }
      } catch (err) {
        console.error("Erro auth:", err);
        setIsLocked(true);
      } finally {
        setLoadingAuth(false);
      }
    };

    performAuth();
  }, []);

  useEffect(() => { currentBpmRef.current = bpm; }, [bpm]);

  const fetchRanking = useCallback(async () => {
    try {
      // Buscamos um número maior de registros para filtrar duplicados no JS
      // e mostrar apenas o melhor score de cada jogador no Top 10.
      const { data } = await supabase
        .from('ritmo_pro_ranking')
        .select('player_name, score, accuracy, bpm, pin')
        .order('score', { ascending: false })
        .limit(50);

      if (data) {
        const uniqueEntries: any[] = [];
        const seenPins = new Set();

        for (const entry of data) {
          if (!seenPins.has(entry.pin)) {
            uniqueEntries.push(entry);
            seenPins.add(entry.pin);
          }
          if (uniqueEntries.length >= 10) break;
        }
        setGlobalRanking(uniqueEntries);
      }
    } catch (e) {
      console.warn("Ranking loading failed");
    }
  }, []);

  const isStoppingRef = useRef(false);

  const stopGame = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    if (timerIDRef.current) window.clearTimeout(timerIDRef.current);
    setState(GameState.RESULTS);

    const currentScore = scoreRef.current;

    // Debug interno
    (window as any).lastFinishedScore = currentScore;

    console.log("Tentando encerrar partida...", { pts: currentScore.pts, bpm: currentBpmRef.current });

    // Só salvamos se atingiu o BPM mínimo e tem pontos
    if (currentBpmRef.current >= 80 && currentScore.pts > 0) {
      setSaveStatus('saving');
      const pName = playerNameRef.current.trim() || 'Anon';

      try {
        const { error } = await supabase.from('ritmo_pro_ranking').insert([{
          player_name: pName,
          device_id: deviceIdRef.current,
          pin: playerPinRef.current,
          score: parseFloat(currentScore.pts.toFixed(2)),
          accuracy: currentScore.accuracy,
          max_combo: currentScore.maxCombo,
          bpm: currentBpmRef.current
        }]);

        if (error) {
          console.error("Erro Supabase:", error);
          setSaveStatus('error');
        } else {
          setSaveStatus('success');
          // Redireciona se houver flag de saída pendente
          if ((window as any).pendingExitRitmo) {
            window.top.location.href = "https://acordegallery.vercel.app";
          }
        }
      } catch (err) {
        console.error("Erro fatal ao salvar score:", err);
        setSaveStatus('error');
      }
    } else {
      console.warn("Partida não elegível para ranking");
    }
  }, []);

  const handleMiss = useCallback(() => {
    consecutiveMissesRef.current += 1;
    const shouldBreakCombo = consecutiveMissesRef.current >= 2;

    setScore(s => {
      const newScore = { ...s, combo: shouldBreakCombo ? 0 : s.combo };
      // Sincroniza o ref imediatamente para que stopGame() veja o valor correto
      scoreRef.current = newScore;

      // Penalidade de tempo apenas após 20x combo
      if (s.maxCombo >= 20 || s.combo >= 20) {
        setTimeAddedFeedback('-2.0s');
        timeLeftRef.current = Math.max(0, timeLeftRef.current - 2.0);
        setTimeout(() => setTimeAddedFeedback(null), 800);
      }
      return newScore;
    });

    setFeedback(shouldBreakCombo ? 'COMBO QUEBROU!' : 'FALTOU! (1/2)');
  }, []);

  const scheduler = useCallback(() => {
    const now = audioEngine.getCurrentTime();
    timeLeftRef.current -= 0.025;

    const sec = Math.max(0, Math.round(timeLeftRef.current));
    if (sec !== lastStateTimeRef.current) {
      lastStateTimeRef.current = sec;
      setTimeLeft(sec);
    }

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
      if (beat !== activeBeatRef.current) {
        activeBeatRef.current = beat;
        setActiveBeat(beat);
      }
    }

    expectedHitsRef.current.forEach(h => {
      if (!h.processed && now > h.time + 0.6) {
        h.processed = true;
        handleMiss();
      }
    });
    timerIDRef.current = window.setTimeout(scheduler, 25);
  }, [stopGame, handleMiss]);

  const startGame = () => {
    audioEngine.init();
    expectedHitsRef.current = [];
    consecutiveMissesRef.current = 0;
    setScore({ pts: 0, combo: 0, accuracy: 100, maxCombo: 0 });
    setTimeLeft(INITIAL_TIME);
    timeLeftRef.current = INITIAL_TIME;
    lastStateTimeRef.current = INITIAL_TIME;
    activeBeatRef.current = -1;
    nextBeatTimeRef.current = audioEngine.getCurrentTime() + 0.4;
    startTimeRef.current = audioEngine.getCurrentTime();
    setFeedback('FOCO!');
    isStoppingRef.current = false;
    setIsSpeedUp(false);
    setSaveStatus('idle'); // Reset status
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

      const isG = ptsValue > 0;
      let nc = prev.combo;

      if (isG) {
        consecutiveMissesRef.current = 0; // Reset ao acertar
        nc = prev.combo + 1;
      } else {
        consecutiveMissesRef.current += 1; // Incrementa ao errar
        if (consecutiveMissesRef.current >= 2) {
          nc = 0; // Quebra o combo apenas no segundo erro seguido
        }
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

      if (isG && nc > 0 && nc % 20 === 0) {
        currentBpmRef.current += 10;
        setIsSpeedUp(true);
        setFeedback('⚡ ACELERO!');
        setTimeout(() => setIsSpeedUp(false), 1500);
      }

      const fPoints = ptsValue > 0 ? (ptsValue + (nc * 0.015)) : 0;
      const bpmMult = currentBpmRef.current / 100;

      const newScore = {
        pts: prev.pts + (fPoints * bpmMult),
        combo: nc,
        maxCombo: Math.max(prev.maxCombo, nc),
        accuracy: Math.min(100, Math.max(0, prev.accuracy + accChange))
      };

      // Garantir que o Ref tenha o valor exato no momento do encerramento
      scoreRef.current = newScore;
      return newScore;
    });
  }, []);

  // --- RENDER DO BLOCK/LOADING ---
  if (loadingAuth) {
    return <div className="fixed inset-0 bg-black flex items-center justify-center text-orange-500 font-black">LOGIN...</div>;
  }

  if (isLocked) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center p-8 z-50">
        <h1 className="text-4xl font-black text-white italic tracking-tighter mb-4 text-center">ACESSO NEGADO</h1>
        <p className="text-orange-500 text-sm font-bold uppercase tracking-widest mb-8 text-center max-w-xs">
          Acesse este jogo através da plataforma Acorde Gallery.
        </p>
        <a
          href="https://acordegallery.com"
          className="bg-orange-600 text-white font-black py-4 px-8 rounded-2xl text-[10px] uppercase tracking-[0.2em] shadow-lg active:scale-95 transition-all"
        >
          Ir para Acorde Gallery
        </a>
      </div>
    );
  }

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
              <div className="bg-white/5 border border-white/10 px-4 py-2 rounded-2xl">
                <span className="block text-[8px] text-white/40 font-black uppercase mb-0.5">BPM</span>
                <span className="text-2xl font-black text-orange-500 leading-none">{currentBpmRef.current}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <GameTimer timeLeft={timeLeft} />
              <button
                onClick={() => {
                  if (score.pts > 0) {
                    (window as any).pendingExitRitmo = true;
                    stopGame();
                  } else {
                    window.top.location.href = "https://acordegallery.vercel.app";
                  }
                }}
                className={`bg-white/5 border border-white/10 px-4 py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest text-orange-500 active:scale-95 transition-all ${saveStatus === 'saving' ? 'opacity-50' : ''}`}
              >
                {saveStatus === 'saving' ? 'Sincronizando...' : 'Sair'}
              </button>
            </div>
          </header>

          <div className="w-full flex flex-col items-center">
            <div className="flex gap-8 mb-12">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className={`w-6 h-6 rounded-full transition-all duration-100 ${activeBeat === i ? 'bg-orange-500 scale-150 shadow-[0_0_30px_#f97316]' : 'bg-white/5 border border-white/10'}`} />
              ))}
            </div>
            <div className="text-center relative">
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
