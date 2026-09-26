// Firefox audio: the persistent background page plays audio itself.

const audio = new Audio();
audio.preload = "auto";

export function init(onEvent) {
  for (const event of ["playing", "pause", "ended", "error"]) {
    audio.addEventListener(event, () => {
      if (audio.getAttribute("src")) onEvent(event);
    });
  }
  // System media keys and the OS media overlay.
  navigator.mediaSession.setActionHandler("play", () => audio.play().catch(() => {}));
  navigator.mediaSession.setActionHandler("pause", () => audio.pause());
  navigator.mediaSession.setActionHandler("nexttrack", () => onEvent("next"));
  navigator.mediaSession.setActionHandler("stop", () => onEvent("stop"));
}

export const isAlive = async () => Boolean(audio.getAttribute("src"));

export async function play(track, volume) {
  audio.volume = volume / 100;
  audio.src = track.url;
  audio.play().catch(() => {}); // failures surface as the "error" event
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.art ? [{ src: track.art, sizes: "1200x1200", type: "image/jpeg" }] : [],
  });
}

export async function pause() { audio.pause(); }
export async function resume() { audio.play().catch(() => {}); }
export async function setVolume(volume) { audio.volume = volume / 100; }

export async function stop() {
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  navigator.mediaSession.metadata = null;
}
