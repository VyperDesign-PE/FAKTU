/**
 * Detecta destinos de navegación declarados o usados pero no registrados en AppRouter
 * (la causa del hallazgo 1: navigate("Customers") fallaba en ejecución).
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dirname, "..", "src");
const router = readFileSync(join(src, "navigation", "AppRouter.tsx"), "utf8");
const types = readFileSync(join(src, "navigation", "types.ts"), "utf8");
const registered = new Set([...router.matchAll(/<Stack\.Screen name="(\w+)"/g)].map((m) => m[1]));
const declared = new Set([...types.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]));

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const used = new Set<string>();
for (const file of walk(src)) {
  const code = readFileSync(file, "utf8");
  for (const m of code.matchAll(/\.(?:navigate|replace|push)\(\s*"(\w+)"/g)) used.add(m[1]);
  for (const m of code.matchAll(/name:\s*"(\w+)"\s*\}/g)) if (declared.has(m[1])) used.add(m[1]);
}

const missingDeclared = [...declared].filter((name) => !registered.has(name));
const missingUsed = [...used].filter((name) => !registered.has(name));
assert.deepEqual(missingDeclared, [], `Rutas declaradas en types.ts sin registrar en AppRouter: ${missingDeclared.join(", ")}`);
assert.deepEqual(missingUsed, [], `Destinos usados en pantallas sin registrar en AppRouter: ${missingUsed.join(", ")}`);
console.log(`MOBILE NAVIGATION: PASS (${registered.size} rutas registradas, ${used.size} destinos usados)`);
