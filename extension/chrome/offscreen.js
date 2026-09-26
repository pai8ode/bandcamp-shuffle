import { api } from "./lib/api.js";

// Audio-only page: plays what the background worker sends and reports back.
// Offscreen documents can use api.runtime but not chrome.storage.

const audio = document.querySelector("audio");

function tell(event) {
  api.runtime.sendMessage({ target: "background", event }).catch(() => {});
}

function setMetadata(track) {
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album,
    artwork: track.art ? [{ src: track.art, sizes: "1200x1200", type: "image/jpeg" }] : [],
  });
}

api.runtime.onMessage.addListener((msg) => {
  if (msg.target !== "offscreen") return;
  if (msg.cmd === "play") {
    audio.volume = msg.volume / 100;
    audio.src = msg.track.url;
    audio.play().catch(() => {}); // failures surface as the "error" event
    setMetadata(msg.track);
  } else if (msg.cmd === "pause") {
    audio.pause();
  } else if (msg.cmd === "resume") {
    audio.play().catch(() => {});
  } else if (msg.cmd === "volume") {
    audio.volume = msg.volume / 100;
  }
});

for (const event of ["playing", "pause", "ended", "error"]) {
  audio.addEventListener(event, () => tell(event));
}

// Windows media keys and the media overlay.
navigator.mediaSession.setActionHandler("play", () => audio.play().catch(() => {}));
navigator.mediaSession.setActionHandler("pause", () => audio.pause());
navigator.mediaSession.setActionHandler("nexttrack", () => tell("next"));
navigator.mediaSession.setActionHandler("stop", () => tell("stop"));
