This directory contains development tooling for a simple approach to profiling bottlenecks
when the user is pressing keys. To use these scripts, uncomment the `console.profile` and
`console.profileEnd` commands inside `doCommandsCmd` and `prefix` functions. Then run a
debug session and press a lot of keys quickly. Make sure to include multi-key sequences if
you are trying to profile `master-key.prefix` in addition to `master-key.do`. Copy all
*.cpuprofile files to this `extension-profiles` directory. You can then run the script
`profile-key-presses.js` to get a sense of the callees of these function that are a bottle
neck. Change the TARGET_FUNCTION_NAME as needed to look within these callees.
