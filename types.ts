
export enum GameState {
  MENU = 'MENU',
  PLAYING = 'PLAYING',
  RESULTS = 'RESULTS'
}

export interface LevelConfig {
  id: number;
  name: string;
  bpm: number;
  description: string;
  targetNotes: number;
  timeSignature: 3 | 4;
  durationSeconds?: number;
}

export interface HitResult {
  timing: 'PERFECT' | 'GOOD' | 'OK' | 'MISS' | 'EARLY' | 'LATE';
  diff: number;
  timestamp: number;
  points: number; // New: points earned for this hit
}

export interface ScoreData {
  playerName: string;
  hits: HitResult[];
  combo: number;
  maxCombo: number;
  totalPoints: number;
  accuracy: number;
}

export interface RankingEntry {
  playerName: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  levelName: string;
}
