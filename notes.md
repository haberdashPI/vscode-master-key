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


ALSO: to reduce the size of the synced data further we could require that the binding docs
be re-parsed from the original file, and only populate it when the file exists (offering to
show the online docs when those are available). This would allow developers to use this
feature to review their output, but for most users the website outputs would suffice and for
users with their own custom bindings, they can always point to those said bindings
