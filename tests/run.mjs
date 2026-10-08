// Test runner: bundles each tests/*.test.ts with esbuild (stubbing the database and the session) and runs it with Node.
//   npm test                 all suites
//   npm test -- security     only suites whose file name contains "security"
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = join(root, "tests");
const out = join(root, "node_modules", ".cache", "neuro-tests"); // inside node_modules so externals (pglite) resolve
mkdirSync(out, { recursive: true });

const only = process.argv.slice(2);
const files = readdirSync(dir).filter((f) => f.endsWith(".test.ts") && (only.length === 0 || only.some((o) => f.includes(o))));
if (files.length === 0) {
  console.error("No test file matches:", only.join(", "));
  process.exit(1);
}

const stubs = {
  name: "stubs",
  setup(b) {
    // Production code reaches the database through ./db and the session through @/auth: swap both.
    b.onResolve({ filter: /(^|\/)db$/ }, () => ({ path: join(dir, "stubs", "db-shim.ts") }));
    b.onResolve({ filter: /^@\/auth$/ }, () => ({ path: join(dir, "stubs", "auth-stub.ts") }));
  },
};

let failed = 0;
for (const file of files) {
  const outfile = join(out, file.replace(/\.ts$/, ".mjs"));
  await build({
    entryPoints: [join(dir, file)],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    tsconfig: join(root, "tsconfig.json"),
    logLevel: "warning",
    external: ["@electric-sql/pglite"],
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    plugins: [stubs],
  });
  console.log(`\n▶ ${file}`);
  const run = spawnSync(process.execPath, [outfile], { stdio: "inherit", cwd: root });
  if (run.status !== 0) {
    failed++;
    console.log(`✖ ${file} failed`);
  }
}
console.log(failed ? `\n${failed} suite(s) failed` : `\nall ${files.length} suite(s) passed`);
process.exit(failed ? 1 : 0);
