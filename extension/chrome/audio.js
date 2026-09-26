// Chrome audio: an offscreen document owns the <audio> element and Media Session.
import { api } from "./lib/api.js";

let creating = null;

async function ensureDocument() {
  if (await api.offscreen.hasDocument()) return;
  creating ??= api.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Plays shuffled tracks from the Bandcamp collection",
    })
    .finally(() => { creating = null; });
  await creating;
}

async function send(msg) {
  await ensureDocument();
  await api.runtime.sendMessage({ ...msg, target: "offscreen" });
}

export function init(onEvent) {
  api.runtime.onMessage.addListener((msg) => {
    if (msg.target === "background" && msg.event) onEvent(msg.event);
  });
}

// Chrome closes the offscreen document after ~30 s without sound.
export const isAlive = () => api.offscreen.hasDocument();
export const play = (track, volume) => send({ cmd: "play", track, volume });
export const pause = () => send({ cmd: "pause" });
export const resume = () => send({ cmd: "resume" });

export async function setVolume(volume) {
  if (await isAlive()) await send({ cmd: "volume", volume });
}

export async function stop() {
  if (await isAlive()) await api.offscreen.closeDocument();
}
