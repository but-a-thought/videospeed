# Firefox Reviewer Build

The reviewer source archive is the exact project source used for the Chrome and Firefox
packages. It includes `package-lock.json`; do not update dependencies before building.

## Requirements

- Node.js 22.22.2 or a compatible version listed in `package.json`
- npm, included with Node.js

## Reproduce the submitted Firefox package

From the extracted source archive:

```sh
npm ci
npm run build:release
npm run validate:firefox
```

The Firefox extension is written to `dist/firefox/`. The submitted ZIP contains the contents
of that directory at the archive root. `npm run release` runs the complete lint, Vitest, TLA+
model, browser-manifest validation, release build, and packaging pipeline; the TLA+ step also
requires Java 11 or newer.

The Firefox build target is `firefox128`. Its manifest uses the stable Gecko ID
`videospeed@but-a-thought.github`, Firefox 128 as the compatibility floor, and the display name
**Video Speed Controller — Community**.
