# Plan: Update `palette.ts` Keybinding Disambiguation & Fallback Detection

The goal is to update how `src/extension/commands/palette.ts` disambiguates keybindings: **use the name UNLESS the name is a fallback like `"prefix"`**.

If it is a fallback name, disambiguate by key sequence (e.g. `${name}:${key}`) so that all prefix bindings appear independently and neither is overwritten.

If there are two prefixes, one being a fallback and the other being one explicitly defined by the user, do not introduce an entry in the palette for the fallback value at all. They're only there in case the user has *not* documented a prefix.

## Refactoring Strategy

### 1. Encode Fallback Status in `palette.ts`
In `src/extension/commands/palette.ts`:
- Extend `IPaletteBinding` with an optional `isFallbackName?: boolean` flag.
- When evaluating `docName` in `updateKeys`:
  ```typescript
  let docName = docs?.name;
  let isFallbackName = false;
  if (binding.command === 'master-key.prefix' && !docName) {
      docName = 'prefix';
      isFallbackName = true;
  }
  if (docs?.hideInPalette || !docName) {
      continue;
  }
  ```
- Store `isFallbackName` on the constructed `paletteEntry`.

### 2. Disambiguate Dictionary Keys in `bindingMap[context]`
In `src/extension/commands/palette.ts` (`updateKeys`):
- Compute the entry key in `mapping` based on fallback status:
  ```typescript
  // Use the name unless it is a fallback name (such as "prefix")
  const mapKey = isFallbackName ? `${name}:${key}` : name;
  const oldEntry = mapping[mapKey] || {};
  mapping[mapKey] = {
      key: (key || oldEntry.key),
      name,
      sections: section?.names || [],
      description: paletteEntry.description || oldEntry.description,
      combinedKey: combinedKey || oldEntry.combinedKey,
      combinedDescription: paletteEntry.combinedDescription ||
          oldEntry.combinedDescription,
      order: Math.max(paletteEntry.order || -1, oldEntry.order || -1),
      command_id: binding.args.command_id || oldEntry.command_id,
      prefix_id: binding.args.prefix_id || oldEntry.prefix_id,
      isFallbackName,
  };
  bindingMap[context] = mapping;
  ```
- **Result:**
  - Standard user commands named `"text docs"`, `"show visual docs"`, or explicit prefixes named `"utility"` continue to deduplicate and combine cleanly across mode/prefix variations using their explicit name.
  - Fallback-named items (e.g. `prefix:SPACE` and `prefix:TAB`) are keyed separately so both entries are preserved in `paletteEntries["0:normal"]`.

### 3. Co-ordination with `prefix.ts`
- In `prefix.ts`, command execution receives `prefix_id` and `key` via `prefixArgs`.
- Because each item in `paletteEntries` now preserves its distinct `prefix_id`, `command_id`, and `key`, clicking or activating either item via `master-key.executePaletteItem` triggers the correct prefix state in `prefix.ts`.
- No invasive changes are required in `prefix.ts` or the Rust parser WASM boundary, keeping the fix self-contained in `palette.ts`.

---

## Verification & Testing Plan

1. **Targeted Unit Test for `palette.ts` Disambiguation:**
   - Create/run a unit test providing a `KeyFileResult` containing two multi-key bindings without explicit prefix docs (`space f1` and `tab f1`).
   - Confirm that `paletteEntries["0:normal"]` contains entries for both `SPACE` (name `"prefix"`) and `TAB` (name `"prefix"`), and neither is omitted.
2. **Explicit Name Merging Verification:**
   - Provide two bindings with the same explicit `doc.name` / `doc.combined.name` (e.g., `format`).
   - Confirm that they merge into a single combined entry in `paletteEntries`.
3. **Integration & Regression Suites:**
   - Run Rust parser tests: `cargo test -p parsing` (in `src/rust/parsing`).
   - Run extension test suites: `npm test` or VSCode extension test runner covering `show-binding-palette.test.ts`.

---

## Critical Files & Anchors
- `src/extension/commands/palette.ts` (`updateKeys` ~lines 216–272): Where `isFallbackName` is detected and `mapKey` is disambiguated.
- `src/extension/commands/prefix.ts` (`prefix` ~lines 142–196): Prefix handler handling `prefix_id` and state updates.
- `src/rust/parsing/src/bind.rs` (`outputs_for_mode_and_prefix` ~lines 1683–1810): Where `BindingOutput::Prefix` items are emitted.
- `src/rust/parsing/src/file.rs` (`docs` ~lines 640–665): Where binding docs are resolved.
- `src/test/integration/show-binding-palette.test.ts`: Palette UI and tree provider integration tests.
