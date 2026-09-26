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

  function setVolume(level) {
    root.volume = Math.max(0, Math.min(100, level))
    Quickshell.execDetached([root.command, "volume", String(root.volume)])
    if (root.bar) root.bar.showTooltip(button, button.tooltipText)
  }

  function refresh() {
    if (!statusProc.running) statusProc.running = true
  }

  function run(action) {
    Quickshell.execDetached([root.command, action])
    refreshSoon.restart()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  Process {
    id: statusProc
    command: [root.command, "status"]
    onExited: function(exitCode) {
      root.playing = exitCode === 0
    }
  }

  Process {
    id: volumeProc
    command: [root.command, "volume"]
    running: true
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        const level = parseInt(text)
        if (!isNaN(level)) root.volume = level
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
    tooltipText: "Bandcamp shuffle · " + root.volume + "%\n" + (root.playing
      ? "click: skip · right-click: stop · scroll: volume"
      : "click: play · middle-click: resync · scroll: volume")
    onWheelMoved: function(delta) {
      if (delta !== 0) root.setVolume(root.volume + (delta > 0 ? 5 : -5))
    }
    onPressed: function(b) {
      if (b === Qt.RightButton) root.run("stop")
      else if (b === Qt.MiddleButton) root.run("sync")
      else root.run("start")
    }
  }
}
