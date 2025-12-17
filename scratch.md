- `header.version` is now 2.0
- `[[define]]` now has several sub fields. Definitions
  previously under `[[define]]` should usually go under `[[define.val]]`, but
  also see `[[define.command]]`.
- generalized expressions. This changed or replaced several
  other features:
  - `bind.computedArgs` no longer exists: instead, place expressions inside of `args`
  - `bind.foreach` has changed
    - `{key: [regex]}` is now `{{keys(&grave;[regex]&grave;)}}`
    - foreach variables are interpolated as expressions (`{{symbol}}`
      instead of `{symbol}`).
  - `bind.path` and `[[path]]`: A similar, but more explicit approach
     is possible using `default` and `define.bind`
  - replaced `mode = []` with `mode = '{{all_modes()}}'`
  - replaced `mode = ["!normal", "!visual"]` with
    `mode = '{{not_modes(["normal", "visual"])}}'`
- revised several fields:
  - replaced `prefixes = ["a", "b", ...]` with `prefixes.anyOf = ["a", "b", ...]`
  - replaced prefixes = "&lt;all-prefixes&gt;" with `prefixes.any = true`
  - `name`, `description`, `hideInPalette` and `hideInDocs` moved to
    `doc.name`, `doc.description`, `doc.hideInPalette` and `doc.hideInDocs`
  - `combinedName`, `combinedDescription` and `combinedKey` moved to
    `doc.combined.name`, `doc.combined.description` and `doc.combined.key`.
  - `resetTransient` is now `finalKey`
  - `bind.if` replaced with `bind.skipWhen`
  - `name` renamed to `register` in `(re)storeNamed` command
  - replay-related command fields have changed their semantics, see examples
    under `replayFromHistory`
