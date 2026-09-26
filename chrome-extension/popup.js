const $ = (id) => document.getElementById(id);

function send(cmd, value) {
  return chrome.runtime.sendMessage({ target: "background", cmd, value });
}

let volumeDragging = false;

function render(state) {
  if (!state) return;
  const { playing, paused, track, status, volume, releases } = state;

  $("title").textContent = track ? track.title : "Nothing playing";
  $("artist").textContent = track ? track.artist : "Shuffle your Bandcamp collection";
  $("album").textContent = track ? track.album : "";
  const art = $("art");
  art.style.backgroundImage = track?.art ? `url("${track.art}")` : "";
  art.classList.toggle("has-image", Boolean(track?.art));

  $("status").textContent = status || "";
  $("main-label").textContent = playing ? "Skip" : "Shuffle";
  $("main").title = playing ? "Play another random track" : "Start shuffling your collection";
  $("pause").hidden = !playing;
  $("stop").hidden = !playing;
  $("pause").title = paused ? "Resume" : "Pause";
  $("pause-icon").setAttribute("d", paused ? "M7 4.5v15l12-7.5z" : "M8 5v14M16 5v14");

  if (!volumeDragging) $("volume").value = volume;
  $("volume-value").textContent = `${volume}%`;

  $("releases").textContent = releases ? `${releases.toLocaleString()} releases` : "Collection not synced yet";
  $("sync").disabled = (status || "").startsWith("Syncing");
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target === "popup") render(msg.state);
});

$("main").addEventListener("click", () => send("start").then(render));
$("pause").addEventListener("click", () => send("toggle").then(render));
$("stop").addEventListener("click", () => send("stop").then(render));
$("sync").addEventListener("click", () => send("sync").then(render));

const volume = $("volume");
volume.addEventListener("pointerdown", () => { volumeDragging = true; });
volume.addEventListener("pointerup", () => { volumeDragging = false; });
volume.addEventListener("input", () => {
  $("volume-value").textContent = `${volume.value}%`;
  send("volume", Number(volume.value));
});

send("state").then(render);
