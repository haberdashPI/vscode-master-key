This directory contains development tooling for a simple approach to profiling bottlenecks
when the user is pressing keys. To use these scripts, uncomment the `console.profile` and
`console.profileEnd` commands inside `doCommandsCmd` and `prefix` functions. Then run a
debug session and press a lot of keys quickly. Make sure to include multi-key sequences if
you are trying to profile `master-key.prefix` in addition to `master-key.do`. Copy all
*.cpuprofile files to this `extension-profiles` directory. You can then run the script
`profile-key-presses.js` to get a sense of the callees of these function that are a bottle
neck. Change the TARGET_FUNCTION_NAME as needed to look within these callees.

NOTE: profiling has indicated that there is very little time spent running the commands in this extension. To the extent that it reduces latency it is most likely related to `await` related delays (e.g. use of async-mutex). Profiling is unlikely to yield future insight at this point, but is left here as is in case it becomes useful.
