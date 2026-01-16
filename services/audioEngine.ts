
class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      // Compressor para evitar distorção e aumentar volume percebido
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-20, this.ctx.currentTime);
      compressor.knee.setValueAtTime(40, this.ctx.currentTime);
      compressor.ratio.setValueAtTime(12, this.ctx.currentTime);
      compressor.attack.setValueAtTime(0, this.ctx.currentTime);
      compressor.release.setValueAtTime(0.25, this.ctx.currentTime);

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(2.0, this.ctx.currentTime); // Volume extra alto

      compressor.connect(this.ctx.destination);
      this.masterGain.connect(compressor);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playStrum(time: number, isAccent: boolean = false) {
    if (!this.ctx || !this.masterGain) return;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    // Som de clique de alta frequência para máxima clareza
    osc.type = 'sine'; 
    osc.frequency.setValueAtTime(isAccent ? 1600 : 800, time);
    
    // Envelope de ataque imediato
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1.0, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.start(time);
    osc.stop(time + 0.1);
  }

  getCurrentTime(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }
}

export const audioEngine = new AudioEngine();
