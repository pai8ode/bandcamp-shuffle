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
    tooltipText: root.playing
      ? "Bandcamp shuffle · click: skip · right-click: stop"
      : "Bandcamp shuffle · click: play · middle-click: resync collection"
    onPressed: function(b) {
      if (b === Qt.RightButton) root.run("stop")
      else if (b === Qt.MiddleButton) root.run("sync")
      else root.run("start")
    }
  }
}
