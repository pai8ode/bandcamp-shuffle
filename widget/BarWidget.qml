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

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

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

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: ""
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
}
