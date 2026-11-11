// Turns the engine's TypeScript into plain browser modules for the development harness (dev/harness.html).
// The engine has no dependency on Mendix or React, so the harness can drive it on hand-made lists.
//
//   npm run harness        builds dev/build/engine/*.js
//   node dev/serve.mjs     serves the project; open http://localhost:4173/dev/harness.html

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "src", "engine");
const target = path.join(root, "dev", "build", "engine");

fs.mkdirSync(target, { recursive: true });
for (const file of fs.readdirSync(source)) {
    if (!file.endsWith(".ts")) {
        continue;
    }
    const result = ts.transpileModule(fs.readFileSync(path.join(source, file), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
        fileName: file
    });
    // Browsers need the file extension on relative imports.
    const code = result.outputText.replace(/(from\s+["'])(\.\/[^"']+)(["'])/g, "$1$2.js$3");
    fs.writeFileSync(path.join(target, file.replace(/\.ts$/, ".js")), code);
}
console.log(`Engine built to ${path.relative(root, target)}`);
