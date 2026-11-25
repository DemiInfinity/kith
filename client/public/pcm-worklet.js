// Collects microphone audio for a voice turn. Audio stays in memory and is sent to the home
// server for speech-to-text; nothing is recorded or kept.
class PcmCollector extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      let sum = 0;
      for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
      this.port.postMessage({ samples: ch.slice(0), rms: Math.sqrt(sum / ch.length) });
    }
    return true;
  }
}
registerProcessor("pcm-collector", PcmCollector);
