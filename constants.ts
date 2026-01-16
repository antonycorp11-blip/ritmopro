
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

// Thresholds ajustados: Perfeito em 210ms para uma experiência mais fluida e didática
export const TIMING_THRESHOLDS = {
  PERFECT: 210,    // Janela de 210ms (Aumentada de 160ms)
  GOOD: 300,       // Janela para acerto "Bom"
  OK: 400,        // Janela para acerto "Regular"
  EARLY_LATE: 550 // Limite máximo de detecção
};

export const QUOTES = [
  "A organização vem antes da velocidade.",
  "O compasso é a casa da música.",
  "Sinta o primeiro tempo, ele é sua âncora.",
  "Constância é mais importante que perfeição.",
  "Respire com o ritmo."
];
