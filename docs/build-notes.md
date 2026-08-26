# Build notes

Facts measured against the real build toolchain, written down because each one is a setting that
looks removable and is not. Measured 2026-08-26 against tsdown 0.15 and vite 7 on this repo.
Re-verify after a major bump of either.

- **`fixedExtension: false` is what makes the published binary resolvable.** `package.json` sets
  `"type": "module"` and `bin.prreview` to `./dist/cli.js`. With tsdown's default
  (`fixedExtension: true`) the same build emits `dist/cli.mjs` instead, byte-identical but under a
  name `bin` does not point at, so an installed `prreview` would fail to launch. Measured by
  flipping the flag: `dist/cli.mjs` appears, `dist/cli.js` does not.

- **`clean: ["dist/cli.js"]` is scoped so the Vite output survives.** `npm run build` is
  `tsdown && vite build src/client`, and Vite writes `dist/client/`. With `clean: true`, tsdown
  wipes all of `dist/` — measured with a marker file in `dist/client/`, which survives the narrow
  clean and does not survive the default one. The ordering inside `npm run build` hides this;
  running `npx tsdown` on its own after a client build is where it bites.
