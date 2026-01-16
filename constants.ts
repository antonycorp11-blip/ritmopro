
import { LevelConfig } from './types';

export const LEVELS: LevelConfig[] = [
  {
    id: 1,
    name: "Pulsação Quaternária",
    bpm: 60,
    description: "4 tempos por compasso. O básico fundamental.",
    targetNotes: 0,
    timeSignature: 4,
    durationSeconds: 20
  },
  {
    id: 2,
    name: "Valsa Básica (3/4)",
    bpm: 80,
    description: "Sinta o balanço ternário. 3 tempos por compasso.",
    targetNotes: 0,
    timeSignature: 3,
    durationSeconds: 20
  },
  {
    id: 3,
    name: "Marcha Firme",
    bpm: 100,
    description: "Constância e precisão em velocidade média.",
    targetNotes: 0,
    timeSignature: 4,
    durationSeconds: 20
  },
  {
    id: 4,
    name: "Valsa Veloz",
    bpm: 120,
    description: "Desafio de agilidade em compasso ternário.",
    targetNotes: 0,
    timeSignature: 3,
    durationSeconds: 20
  },
  {
    id: 5,
    name: "Desafio do Metrônomo",
    bpm: 140,
    description: "Velocidade de concerto. Mantenha a calma.",
    targetNotes: 0,
    timeSignature: 4,
    durationSeconds: 20
  }
];

// Thresholds ajustados para serem mais amigáveis e fáceis (experiência didática)
export const TIMING_THRESHOLDS = {
  PERFECT: 280,    // Janela maior para facilitar acertos
  GOOD: 380,
  OK: 500,
  EARLY_LATE: 650
};

export const QUOTES = [
  "A organização vem antes da velocidade.",
  "O compasso é a casa da música.",
  "Sinta o primeiro tempo, ele é sua âncora.",
  "Constância é mais importante que perfeição.",
  "Respire com o ritmo."
];
