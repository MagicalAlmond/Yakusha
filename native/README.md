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
`install --native` do.

The binaries are unsigned; the CLI verifies the manifest SHA-256 before
copying anything into a game.
