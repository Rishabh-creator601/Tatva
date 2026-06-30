' Launches the Tatva Panel Node server with NO visible window.
' Run mode 0 = hidden, second arg False = don't wait for it to exit.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "D:\Tatva\panel"
sh.Run "node server.js", 0, False
