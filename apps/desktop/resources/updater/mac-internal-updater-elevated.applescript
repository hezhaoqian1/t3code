on run argv
  if (count of argv) is not 3 then error "Invalid updater arguments"
  set electronPath to item 1 of argv
  set helperPath to item 2 of argv
  set transactionPath to item 3 of argv
  set commandText to "/usr/bin/env ELECTRON_RUN_AS_NODE=1 " & quoted form of electronPath & " " & quoted form of helperPath & " " & quoted form of transactionPath
  do shell script commandText with administrator privileges
end run
