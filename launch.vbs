Set WshShell = CreateObject("WScript.Shell")
' Start the Node.js server silently in the background
WshShell.Run "node server.js", 0, False

' Wait 2 seconds for the server to wake up, then open the browser
WScript.Sleep 2000
WshShell.Run "cmd /c start http://localhost:3000", 0, False