import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "pai.bandcamp-shuffle"

  readonly property string command: Quickshell.env("HOME") + "/.local/bin/bandcamp-shuffle"
  property bool playing: false
  property int volume: 100
  property string username: "fedexlatte"
  property bool favorite: false
  property string song: "" // "Artist - Title" of the song playing
  property real lastScroll: 0 // polled volume is ignored briefly after a scroll

  function setVolume(level) {
    root.volume = Math.max(0, Math.min(100, level))
    root.lastScroll = Date.now()
    Quickshell.execDetached([root.command, "volume", String(root.volume)])
    if (root.bar) root.bar.showTooltip(button, button.tooltipText)
  }

  function refresh() {
    if (!infoProc.running) infoProc.running = true
  }

  function run(action) {
    Quickshell.execDetached([root.command, action])
    refreshSoon.restart()
  }

  implicitWidth: row.implicitWidth
  implicitHeight: row.implicitHeight

  Process {
    id: infoProc
    command: [root.command, "info"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        let info
        try { info = JSON.parse(text) } catch (e) { return }
        root.playing = info.playing
        root.username = info.fan.username
        root.favorite = info.favorite
        root.song = info.song ? info.song.artist + " - " + info.song.title : ""
        if (Date.now() - root.lastScroll > 2000) root.volume = info.volume
      }
    }
  }

  Timer {
    interval: 3000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    id: refreshSoon
    interval: 700
    onTriggered: root.refresh()
  }

  Row {
    id: row
    anchors.centerIn: parent

    BarIconButton {
      id: button
      bar: root.bar
      text: "\uf074"
      dimmed: !root.playing
      tooltipText: "Bandcamp shuffle · @" + root.username + " · " + root.volume + "%\n"
        + (root.playing ? "click: skip" : "click: play")
        + " · right-click: menu · scroll: volume"
      onWheelMoved: function(delta) {
        if (delta !== 0) root.setVolume(root.volume + (delta > 0 ? 5 : -5))
      }
      onPressed: function(b) {
        if (b === Qt.LeftButton) root.run("start")
        else root.run("pick") // right-click (two-finger tap) or middle-click
      }
    }

    BarIconButton {
      id: searchButton
      bar: root.bar
      text: "\uf002"
      dimmed: !root.playing
      tooltipText: "Search Bandcamp users or paste a bandcamp.com link"
      onPressed: function(b) { root.run("find") }
    }

    BarIconButton {
      id: starButton
      bar: root.bar
      text: root.favorite ? "\uf005" : "\uf006"
      dimmed: !root.playing
      tooltipText: !root.playing ? "Favorites: play something to star it"
        : (root.favorite ? "★ In favorites: " + root.song + "\nclick: remove" : "click: add to favorites\n" + root.song)
      onPressed: function(b) {
        if (!root.playing) return
        root.favorite = !root.favorite // instant feedback; the next info poll confirms
        root.run("fav")
      }
    }
  }
}
