
import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { GameState, LevelConfig, ScoreData, HitResult } from './types';
import { LEVELS, TIMING_THRESHOLDS } from './constants';
import { audioEngine } from './services/audioEngine';
import TouchArea from './components/TouchArea';

// Supabase Import
import { supabase } from './services/supabaseClient';

const TAP_LATENCY_COMPENSATION = 0.040;
const MAX_TIME_LIMIT = 60;
const ERROR_PENALTY_SECONDS = 30;

const FireParticle = memo(({ index }: { index: number }) => {
  const style = useMemo(() => ({
    left: `${(index * 7.7) % 100}%`,
    width: `${15 + (index % 5) * 10}px`,
    height: `${60 + (index % 10) * 20}px`,
    '--duration': `${0.6 + (index % 4) * 0.2}s`,
    animationDelay: `${(index % 10) * 0.1}s`,
    backgroundColor: index % 2 === 0 ? '#f97316' : '#ea580c',
    filter: `blur(${4 + (index % 3)}px)`,
  }), [index]);

  return <div className="fire-particle" style={style as any} />;
});

const FireOverlay = memo(({ intensity }: { intensity: number }) => {
  if (intensity < 3) return null;
  const maxParticles = 40;
  const activeCount = Math.min(Math.floor(intensity / 2), maxParticles);
  const opacity = Math.min(intensity / 40, 0.7);

  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div
        className="absolute bottom-0 w-full h-full bg-gradient-to-t from-orange-600/10 via-orange-900/5 to-transparent transition-opacity duration-1000"
        style={{ opacity }}
      />
      {Array.from({ length: activeCount }).map((_, i) => (
        <FireParticle key={i} index={i} />
      ))}
    </div>
  );
});

const App: React.FC = () => {
  const [state, setState] = useState<GameState>(GameState.MENU);
  const [currentLevel, setCurrentLevel] = useState<LevelConfig>(LEVELS[0]);
  const [customBpm, setCustomBpm] = useState(80);
  const [customSignature, setCustomSignature] = useState<3 | 4>(4);

  const [playerName, setPlayerName] = useState(() => localStorage.getItem('studio_acorde_player_name') || '');
  const [deviceId] = useState(() => {
    let id = localStorage.getItem('studio_acorde_device_id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('studio_acorde_device_id', id);
    }
    return id;
  });

  const [score, setScore] = useState<ScoreData>({
    playerName: '', hits: [], combo: 0, maxCombo: 0, totalPoints: 0, accuracy: 0
  });
  const [activeBeat, setActiveBeat] = useState(-1);
  const [lastDiff, setLastDiff] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [timeLeft, setTimeLeft] = useState(20);
  const [survivalDuration, setSurvivalDuration] = useState(0);
  const [timeAddedFeedback, setTimeAddedFeedback] = useState<string | null>(null);
  const [speedUpFeedback, setSpeedUpFeedback] = useState(false);
  const [speedUpCount, setSpeedUpCount] = useState(0);
  const [showRanking, setShowRanking] = useState(false);
  const [globalRanking, setGlobalRanking] = useState<any[]>([]);

  const timerIDRef = useRef<number | null>(null);
  const nextBeatTimeRef = useRef(0);
  const expectedHitsRef = useRef<{ time: number, processed: boolean }[]>([]);
  const currentLevelRef = useRef<LevelConfig>(currentLevel);
  const startTimeRef = useRef(0);
  const timeLeftRef = useRef(20);
  const lastTapProcessedTime = useRef(0);

  useEffect(() => {
    currentLevelRef.current = currentLevel;
  }, [currentLevel]);

  // Supabase Real-time Ranking Fetch
  const fetchRanking = useCallback(async () => {
    const { data, error } = await supabase
      .from('ritmo_pro_ranking')
      .select('*')
      .order('score', { ascending: false })
      .limit(5);

    if (error) {
      console.error("Erro ao buscar ranking:", error);
    } else {
      setGlobalRanking(data || []);
    }
  }, []);

  useEffect(() => {
    fetchRanking();

    // Inscrição em tempo real para atualizações do ranking
    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'ritmo_pro_ranking' },
        () => fetchRanking()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRanking]);

  const dynamicBackground = useMemo(() => {
    if (state !== GameState.PLAYING) return 'rgb(0,0,0)';
    const hue = 20;
    const saturation = Math.min(50, speedUpCount * 6);
    const lightness = Math.min(12, speedUpCount * 1.5);
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
  }, [speedUpCount, state]);

  const isValidMatch = useMemo(() => {
    return currentLevel.bpm >= 80;
  }, [currentLevel.bpm]);

  const stopGame = useCallback(async () => {
    if (timerIDRef.current) window.clearTimeout(timerIDRef.current);
    const finalDuration = Math.max(0, audioEngine.getCurrentTime() - startTimeRef.current);
    setSurvivalDuration(finalDuration);
    setState(GameState.RESULTS);
    setActiveBeat(-1);

    // Envio para o Supabase
    if (isValidMatch && score.totalPoints > 0) {
      const { error } = await supabase
        .from('ritmo_pro_ranking')
        .insert([{
          player_name: playerName || 'Anônimo',
          device_id: deviceId,
          score: parseFloat(score.totalPoints.toFixed(2)),
          accuracy: score.accuracy,
          max_combo: score.maxCombo,
          bpm: currentLevel.bpm
        }]);

      if (error) console.error("Erro ao salvar no Supabase:", error);
    }
  }, [playerName, score.totalPoints, score.accuracy, score.maxCombo, currentLevel.bpm, isValidMatch, deviceId]);

  const handleMiss = useCallback((hitTime: number) => {
    setScore(prev => {
      const newHits = [...prev.hits, { timing: 'MISS', diff: 0, timestamp: hitTime, points: 0 }];
      if (speedUpCount > 0) {
        timeLeftRef.current = Math.max(0, timeLeftRef.current - ERROR_PENALTY_SECONDS);
        setTimeAddedFeedback(`-${ERROR_PENALTY_SECONDS}.0s`);
        setTimeout(() => setTimeAddedFeedback(null), 800);
      }
      setFeedback('FALTOU TOCAR!');
      return { ...prev, hits: newHits, combo: 0 };
    });
    if ('vibrate' in navigator) navigator.vibrate(50);
  }, [speedUpCount]);

  const scheduler = useCallback(() => {
    const now = audioEngine.getCurrentTime();
    const config = currentLevelRef.current;
    timeLeftRef.current -= 0.025;
    const currentDisplayTime = Math.max(0, timeLeftRef.current);
    if (Math.round(currentDisplayTime) !== timeLeft) setTimeLeft(Math.round(currentDisplayTime));
    if (currentDisplayTime <= 0) { stopGame(); return; }

    while (nextBeatTimeRef.current < now + 0.20) {
      const time = nextBeatTimeRef.current;
      const totalNotesScheduled = expectedHitsRef.current.length;
      audioEngine.playStrum(time, totalNotesScheduled % config.timeSignature === 0);
      expectedHitsRef.current.push({ time, processed: false });
      nextBeatTimeRef.current += (60.0 / config.bpm);
    }

    const currentNoteIndex = expectedHitsRef.current.findIndex(h => h.time > now - 0.1);
    if (currentNoteIndex !== -1) {
      const beat = currentNoteIndex % config.timeSignature;
      if (beat !== activeBeat) setActiveBeat(beat);
    }

    expectedHitsRef.current.forEach((hit) => {
      if (!hit.processed && now > hit.time + 0.60) {
        hit.processed = true;
        handleMiss(hit.time);
      }
    });
    timerIDRef.current = window.setTimeout(scheduler, 25);
  }, [stopGame, timeLeft, activeBeat, handleMiss]);

  const startGame = (level: LevelConfig) => {
    if (timerIDRef.current) window.clearTimeout(timerIDRef.current);
    audioEngine.init();
    setCurrentLevel({ ...level });
    currentLevelRef.current = { ...level };
    savePlayerName(playerName);
    setScore({ playerName, hits: [], combo: 0, maxCombo: 0, totalPoints: 0, accuracy: 100 });
    setFeedback('FOCO!');
    setLastDiff(null);
    setTimeLeft(20);
    timeLeftRef.current = 20;
    expectedHitsRef.current = [];
    setActiveBeat(-1);
    setSpeedUpFeedback(false);
    setSpeedUpCount(0);
    lastTapProcessedTime.current = 0;
    setTimeout(() => {
      setState(GameState.PLAYING);
      startTimeRef.current = audioEngine.getCurrentTime();
      nextBeatTimeRef.current = startTimeRef.current + 0.5;
      scheduler();
    }, 600);
  };

  const handleTap = useCallback(() => {
    const rawNow = audioEngine.getCurrentTime();
    if (rawNow - lastTapProcessedTime.current < 0.150) return;
    lastTapProcessedTime.current = rawNow;
    const compensatedNow = rawNow - TAP_LATENCY_COMPENSATION;
    let closestIndex = -1;
    let minDiffAbs = Infinity;
    const startIndex = Math.max(0, expectedHitsRef.current.length - 10);
    for (let i = startIndex; i < expectedHitsRef.current.length; i++) {
      const hit = expectedHitsRef.current[i];
      if (hit.processed) continue;
      const diff = Math.abs(compensatedNow - hit.time);
      if (diff < 0.60 && diff < minDiffAbs) { minDiffAbs = diff; closestIndex = i; }
    }

    setScore(prev => {
      let rating: HitResult['timing'] = 'MISS';
      let baseBonus = 0;
      let finalDiff = 0;
      if (closestIndex !== -1) {
        const targetNote = expectedHitsRef.current[closestIndex];
        finalDiff = (compensatedNow - targetNote.time) * 1000;
        targetNote.processed = true;
        setLastDiff(finalDiff);
        const absDiff = Math.abs(finalDiff);
        if (absDiff < TIMING_THRESHOLDS.PERFECT) { rating = 'PERFECT'; baseBonus = 2.0; setFeedback('🔥 PERFEITO!'); }
        else if (absDiff < TIMING_THRESHOLDS.GOOD) { rating = 'GOOD'; baseBonus = 1.0; setFeedback('MUITO BOM!'); }
        else if (absDiff < TIMING_THRESHOLDS.OK) { rating = 'OK'; baseBonus = 0.5; setFeedback('OK!'); }
        else { rating = finalDiff < 0 ? 'EARLY' : 'LATE'; baseBonus = 0.1; setFeedback(finalDiff < 0 ? 'ACELEROU' : 'ATRASOU'); }
      } else {
        setFeedback('TOQUE EXTRA!'); rating = 'MISS';
        if (speedUpCount > 0) {
          timeLeftRef.current = Math.max(0, timeLeftRef.current - ERROR_PENALTY_SECONDS);
          setTimeAddedFeedback(`-${ERROR_PENALTY_SECONDS}.0s`);
          setTimeout(() => setTimeAddedFeedback(null), 800);
        }
      }

      const timeBonus = baseBonus * Math.max(0.1, 1 - (speedUpCount * 0.15));
      if (timeBonus > 0) {
        const prevT = timeLeftRef.current;
        timeLeftRef.current = Math.min(MAX_TIME_LIMIT, timeLeftRef.current + timeBonus);
        if (prevT < MAX_TIME_LIMIT) {
          setTimeAddedFeedback(`+${(timeLeftRef.current - prevT).toFixed(1)}s`);
          setTimeout(() => setTimeAddedFeedback(null), 800);
        }
      }

      const isGood = rating !== 'MISS';
      const newCombo = isGood ? prev.combo + 1 : 0;
      let pointsEarn = rating === 'PERFECT' ? 1.0 : rating === 'GOOD' ? 0.5 : rating === 'OK' ? 0.2 : 0;
      const finalP = pointsEarn > 0 ? (pointsEarn + (newCombo * 0.01)) : 0;

      if (isGood && newCombo > 0 && newCombo % 20 === 0) {
        setSpeedUpCount(c => c + 1);
        setCurrentLevel(old => ({ ...old, bpm: old.bpm + 10 }));
        setSpeedUpFeedback(true);
        setTimeout(() => setSpeedUpFeedback(false), 1200);
      }

      const newHits: HitResult[] = [...prev.hits, { timing: rating, diff: finalDiff, timestamp: rawNow, points: finalP }];
      const accuracy = Math.round((newHits.reduce((acc, h) => acc + (h.timing === 'PERFECT' ? 1 : h.timing === 'GOOD' ? 0.8 : h.timing === 'OK' ? 0.5 : 0), 0) / Math.max(newHits.length, expectedHitsRef.current.filter(h => h.time < rawNow - 0.2).length)) * 100);

      const bpmF = currentLevelRef.current.bpm >= 80 ? (currentLevelRef.current.bpm / 100) : 0;
      return { ...prev, hits: newHits, combo: newCombo, maxCombo: Math.max(prev.maxCombo, newCombo), totalPoints: prev.totalPoints + (finalP * bpmF), accuracy: Math.min(100, Math.max(0, accuracy || 0)) };
    });
  }, [speedUpCount]);

  const formatDuration = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const savePlayerName = (n: string) => localStorage.setItem('studio_acorde_player_name', n);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden text-slate-100 font-sans relative transition-colors duration-1000 ease-in-out" style={{ backgroundColor: dynamicBackground }}>
      <FireOverlay intensity={score.combo} />

      <header className="p-6 flex justify-between items-start z-30 relative">
        <div>
          <h1 className="text-orange-500 font-black tracking-tight text-3xl leading-none">STUDIO<span className="text-white">ACORDE</span></h1>
          <p className="text-[9px] text-orange-800 font-black uppercase tracking-[0.3em] mt-1">Alta Performance Rítmica</p>
        </div>
        {state === GameState.PLAYING && (
          <div className="flex flex-col gap-2 items-end">
            <div className="flex gap-2">
              <div className="bg-[#1a0f0a]/60 backdrop-blur-sm border border-orange-900/40 px-3 py-1.5 rounded-xl text-center shadow-xl">
                <span className="block text-[7px] text-orange-500 font-black">PONTOS</span>
                <span className="text-lg font-black text-white">{score.totalPoints.toFixed(2)}</span>
              </div>
              <div className="bg-[#1a0f0a]/60 backdrop-blur-sm border border-orange-900/40 px-3 py-1.5 rounded-xl text-center shadow-xl">
                <span className="block text-[7px] text-orange-800 font-black uppercase tracking-widest transition-colors">{timeLeft}s</span>
                <span className="text-xl font-black">{timeLeft}s</span>
              </div>
            </div>
            <button onClick={stopGame} className="bg-red-950/40 border border-red-500/30 text-red-500 px-4 py-2 rounded-xl text-[10px] font-black uppercase active:scale-95">Encerrar Partida</button>
          </div>
        )}
      </header>

      <main className="flex-1 flex flex-col items-center relative overflow-y-auto px-6 z-10">
        {state === GameState.MENU && (
          <div className="w-full max-w-lg space-y-6 animate-in fade-in zoom-in duration-500 pt-2 pb-20">
            <div className="bg-[#1a0f0a] border-2 border-orange-600/10 rounded-[2.5rem] p-6 space-y-4 shadow-2xl">
              <input type="text" placeholder="Seu Nome ou @user" value={playerName} onChange={(e) => setPlayerName(e.target.value)} className="w-full bg-black border border-orange-900/30 rounded-2xl py-4 px-6 text-white font-black outline-none focus:border-orange-500" />
              <div className="text-center py-2">
                <span className={`text-9xl font-black tabular-nums transition-colors ${customBpm < 80 ? 'text-red-500' : 'text-white'}`}>{customBpm}</span>
                <span className="text-orange-500 font-black text-[11px] uppercase block">BPM INICIAL</span>
                {customBpm < 80 && <p className="text-red-500 font-black text-[8px] mt-2">⚠️ ABAIXO DE 80 BPM NÃO VALE PONTOS</p>}
              </div>
              <input type="range" min="40" max="180" value={customBpm} onChange={(e) => setCustomBpm(parseInt(e.target.value))} className="w-full h-3 bg-black rounded-full accent-orange-500 mb-4" />
              <button disabled={!playerName.trim()} onClick={() => startGame({ id: 99, name: 'Sessão Livre', bpm: customBpm, timeSignature: customSignature, targetNotes: 0, description: '' })} className="w-full bg-orange-600 text-white font-black py-6 rounded-[2rem] text-lg active:scale-95 disabled:opacity-30">INICIAR ESTUDO</button>
            </div>

            <div className="bg-[#1a0f0a] border-2 border-orange-900/20 rounded-[2.5rem] p-6">
              <h3 className="text-white font-black uppercase text-xs mb-4">🏆 RANKING GLOBAL (Supabase Real-time)</h3>
              <div className="space-y-3">
                {globalRanking.map((r, i) => (
                  <div key={i} className="flex justify-between items-center bg-black/40 p-3 rounded-2xl border border-orange-900/10">
                    <div className="flex items-center gap-3">
                      <span className="text-orange-500 font-black">{i + 1}º</span>
                      <span className="text-xs font-black text-white">{r.player_name}</span>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-black text-white">{r.score.toFixed(2)} pts</div>
                      <div className="text-[8px] text-orange-900 font-black">{r.accuracy}% ACC</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {state === GameState.PLAYING && (
          <div className="w-full h-full flex flex-col items-center justify-between py-10 relative">
            {!isValidMatch && <div className="bg-red-600/20 border border-red-500/40 px-4 py-1 rounded-full animate-pulse z-30"><span className="text-[7px] font-black text-red-500 uppercase">MODO TREINO (SEM PONTOS)</span></div>}
            <div className="text-center">
              <div className="text-9xl font-black text-white tabular-nums tracking-tighter">{score.combo}<span className="text-orange-500 text-5xl ml-2">x</span></div>
              <div className="text-2xl font-black text-orange-400 mt-4 h-8">{feedback}</div>
            </div>
            <div className="w-full max-w-sm"><TouchArea onTap={handleTap} /></div>
          </div>
        )}

        {state === GameState.RESULTS && (
          <div className="w-full h-full flex items-center justify-center p-6">
            <div className="bg-[#1a0f0a]/80 backdrop-blur-xl border-2 border-orange-900/20 rounded-[3rem] p-10 space-y-8 w-full max-w-md text-center">
              <div>
                <h2 className="text-7xl font-black text-white">{formatDuration(survivalDuration)}</h2>
                <p className="text-orange-600 font-black uppercase">PONTOS: {isValidMatch ? score.totalPoints.toFixed(2) : "0.00"}</p>
              </div>
              <button onClick={() => setState(GameState.MENU)} className="w-full bg-orange-600 text-white font-black py-5 rounded-3xl active:scale-95">VOLTAR AO MENU</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
