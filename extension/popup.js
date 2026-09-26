import { api } from "./lib/api.js";
import { DEFAULT_FAN, parseProfileInput } from "./lib/shuffle.js";

const $ = (id) => document.getElementById(id);

function send(cmd, extra = {}) {
  return api.runtime.sendMessage({ target: "background", cmd, ...extra });
}

let volumeDragging = false;

function render(state) {
  if (!state) return;
  const { playing, paused, track, status, volume, releases, fan } = state;

  $("fan-name").textContent = fan.name;
  $("fan-user").textContent = `@${fan.username}`;
  $("reset").hidden = fan.id === DEFAULT_FAN.id;

  $("title").textContent = track ? track.title : "Nothing playing";
  $("artist").textContent = track ? track.artist : "Shuffle the fedexlatte collection";
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

  $("releases").textContent = releases ? `${releases.toLocaleString()} releases` : "Collection not loaded yet";
  $("sync").disabled = (status || "").startsWith("Loading");
}

api.runtime.onMessage.addListener((msg) => {
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
  send("volume", { value: Number(volume.value) });
});

// --- Collection picker ------------------------------------------------------

const picker = $("picker");
const input = $("picker-input");
const results = $("results");
let query = 0; // latest keystroke; older lookups are ignored
let timer;

function openPicker(open) {
  picker.hidden = !open;
  $("change").setAttribute("aria-expanded", String(open));
  $("change").textContent = open ? "Cancel" : "Change";
  if (open) {
    input.value = "";
    results.replaceChildren();
    input.focus();
  }
}

function note(text) {
  const li = document.createElement("li");
  li.className = "note";
  li.textContent = text;
  results.replaceChildren(li);
}

function fanOption(fan, first) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "option");
  button.setAttribute("aria-selected", String(first));
  button.disabled = !fan.collectionSize;

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  if (fan.image) avatar.style.backgroundImage = `url("${fan.image}")`;

  const who = document.createElement("span");
  who.className = "who";
  const name = document.createElement("strong");
  name.textContent = fan.name;
  const detail = document.createElement("span");
  detail.textContent = fan.collectionSize
    ? `@${fan.username} · ${fan.collectionSize.toLocaleString()} ${fan.collectionSize === 1 ? "item" : "items"}`
    : `@${fan.username} · private or empty`;
  who.append(name, detail);

  button.append(avatar, who);
  button.addEventListener("click", () => choose(fan));
  const li = document.createElement("li");
  li.append(button);
  return li;
}

function showFans(fans, heading) {
  if (!fans.length) return note("No users found");
  const options = fans.map((fan, i) => fanOption(fan, i === 0));
  if (heading) {
    const li = document.createElement("li");
    li.className = "note";
    li.textContent = heading;
    options.unshift(li);
  }
  results.replaceChildren(...options);
}

async function choose(fan) {
  openPicker(false);
  render(await send("select", { fan: { id: fan.id, username: fan.username, name: fan.name } }));
}

async function lookup(text, q) {
  const username = parseProfileInput(text);
  if (!username) {
    const res = await send("search", { value: text });
    if (q !== query) return;
    return res?.error ? note(res.error) : showFans(res.results);
  }
  const res = await send("lookup", { value: username });
  if (q !== query) return;
  if (res?.fan) return showFans([res.fan]);
  if (!res?.notFound) return note(res?.error || "Lookup failed");
  // Display names aren't usernames (hotPai is @onepie), so offer similar names.
  const similar = await send("search", { value: username });
  if (q !== query) return;
  if (similar?.results?.length) showFans(similar.results, `No user @${username} — similar names:`);
  else note(`No Bandcamp user @${username}, and no similar names`);
}

input.addEventListener("input", () => {
  clearTimeout(timer);
  const text = input.value.trim();
  const q = ++query;
  if (text.length < 2 && !parseProfileInput(text)) return results.replaceChildren();
  note(parseProfileInput(text) ? `Looking up @${parseProfileInput(text)}…` : "Searching…");
  timer = setTimeout(() => lookup(text, q), 250);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") results.querySelector("button:not(:disabled)")?.click();
});

$("change").addEventListener("click", () => openPicker(picker.hidden));
$("reset").addEventListener("click", () => choose({ ...DEFAULT_FAN, collectionSize: 1 }));

send("state").then(render);
