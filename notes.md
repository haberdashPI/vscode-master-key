Reconstructing the scope rather than serializing it would invovle

NOTE: `resolve` uses a mutable scope, but only because it is required to evaluate
expressions (which could in theory mutate the scope, but don't because of the constraints we
apply to expressions in this project)

x. parsing the asts in `[[bind]]` (process)
x. add modes to the scope (ser)
x. adding default mode to the scope (ser)
x. registering "all_modes" and "not_modes" (re-run)
x. parsing the asts in `mode.whenNoBinding.run` (process)
x. adding the `kinds` to the scope (ser)
x. adding `val.` variables to scope via `add_to_scope` (process)

TODO: remove BareValue from expression scope, since it uses spanned
TODO: test round tripping of bindings in a rust unit test
TODO: verify that outdated bindings are handled properly

Observation: though there is debugging left to do, I've gotten the storage down to
approximately 1-2KB of serialized/compressed data, so this effort is probably well worth the
effort (since that should be closer to the assumptions of the settings sync support in
VSCode)

ALSO: to reduce the size of the synced data further we could require that the binding docs
be re-parsed from the original file, and only populate it when the file exists (offering to
show the online docs when those are available). This would allow developers to use this
feature to review their output, but for most users the website outputs would suffice and for
users with their own custom bindings, they can always point to those said bindings

probably not necessary given the much smaller size we're seeing after serialization
