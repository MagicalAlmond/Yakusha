# Native components

These are the Rust sources for the RGSS delivery layer: `rgss-hook` is the
32-bit DLL that installs the `GetProcAddress` hook and runs the Ruby
bootstrap, and `injector` starts a suspended `Game.exe`, loads the DLL and
resumes the game.

Build both for the 32-bit gnullvm target and stage them with a SHA-256
manifest:

```
rustup target add i686-pc-windows-gnullvm
node native/build.mjs --llvm-mingw <path-to-llvm-mingw>
```

`build.mjs` writes `native/prebuilt/` (gitignored): the two PE files, the
`bootstrap.rb` script, the `libunwind.dll` the gnullvm target links against,
and `manifest.json`. `npm test` does not need the real binaries — the native
tests use a fixture with real hashes — but `npm pack` and a manual
`install` do (RGSS selects the native layer automatically since 0.71).

The binaries are unsigned; the CLI verifies the manifest SHA-256 before
copying anything into a game.

Before publishing, `npm pack` runs `native/verify.mjs` (the `prepack`
script). It checks the manifest schema, requires exactly the four files,
rejects unexpected or path-escaping entries, and recomputes every SHA-256.
The CI build runs the same check and confirms the tarball contains both the
staged native files and the GUI:

```
node native/verify.mjs
node native/verify.mjs --dir native/prebuilt
```
