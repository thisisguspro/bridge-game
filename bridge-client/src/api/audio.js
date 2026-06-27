// Audio Manager using Web Audio API for synthetic placeholder sounds.
// Will be replaced with real assets later.
const AudioContext = window.AudioContext || window.webkitAudioContext;
let ctx = null;

export function initAudio() {
  if (!ctx) {
    ctx = new AudioContext();
  }
  if (ctx.state === "suspended") {
    ctx.resume();
  }
}

// Helper to play an oscillator sound
function playTone(type, freq, duration, vol = 0.1, sweep = false) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (sweep) {
    osc.frequency.exponentialRampToValueAtTime(freq * 0.1, ctx.currentTime + duration);
  }
  
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

// Noise generator for slashes/explosions
function playNoise(duration, vol = 0.2, highpass = false) {
  if (!ctx) return;
  const bufferSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  
  let lastNode = noise;
  if (highpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1000;
    lastNode.connect(filter);
    lastNode = filter;
  }
  
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(vol, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);
  
  lastNode.connect(gain);
  gain.connect(ctx.destination);
  
  noise.start();
}

export const sfx = {
  walk: () => playTone("triangle", 150, 0.1, 0.05),
  click: () => playTone("sine", 800, 0.05, 0.1),
  taskComplete: () => {
    playTone("square", 440, 0.1, 0.1);
    setTimeout(() => playTone("square", 660, 0.3, 0.1), 100);
  },
  taskError: () => playTone("sawtooth", 150, 0.3, 0.1),
  slash: () => {
    playNoise(0.4, 0.5, true);
    playTone("sawtooth", 200, 0.4, 0.2, true);
  },
  alarm: () => {
    playTone("square", 600, 0.5, 0.15);
    setTimeout(() => playTone("square", 400, 0.5, 0.15), 500);
  },
  siren: () => {
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(350, now);
    osc.frequency.linearRampToValueAtTime(700, now + 0.4);
    osc.frequency.linearRampToValueAtTime(350, now + 0.8);
    
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.8);
    
    osc.start();
    osc.stop(now + 0.8);
  },
  eject: () => {
    playNoise(1.5, 0.6);
    playTone("triangle", 100, 1.5, 0.4, true);
  }
};
