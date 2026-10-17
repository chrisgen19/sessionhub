// Uses the image renderer already installed with Next.js; no fonts or network assets.
// Run from the repo root: pnpm --filter @sessionhub/web exec node ../../infra/scripts/generate-extension-icons.mjs
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = new URL("../../", import.meta.url);
const require = createRequire(new URL("apps/web/package.json", root));
const sharp = createRequire(require.resolve("next/package.json"))("sharp");
for (const size of [16, 32, 48, 128]) {
  await sharp(fileURLToPath(new URL("apps/extension/assets/icon.svg", root)), { density: 384 })
    .resize(size, size).png().toFile(fileURLToPath(new URL(`apps/extension/public/icons/${size}.png`, root)));
}
