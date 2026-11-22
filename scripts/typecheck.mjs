import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { rspack } from "@rsbuild/core";

const roots = ["src", "public"];
const failures = [];
const javascriptFiles = [];
const jsxFiles = [];
async function visit(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.(js|jsx|mjs)$/.test(entry.name)) {
      const source = await readFile(file, "utf8");
      if (source.includes("<<<<<<<") || source.includes(">>>>>>>")) failures.push(`${file}: merge conflict marker`);
      if (/\.(js|mjs)$/.test(entry.name)) javascriptFiles.push(file);
      else jsxFiles.push(file);
    }
  }
}
for (const root of roots) await visit(root);
for (const file of javascriptFiles) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) failures.push(`${file}: ${result.stderr || result.stdout}`);
}
for (const file of jsxFiles) {
  try {
    const source = await readFile(file, "utf8");
    rspack.experiments.swc.transformSync(source, {
      filename: file,
      swcrc: false,
      configFile: false,
      jsc: { parser: { syntax: "ecmascript", jsx: true } },
    });
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
  }
}
if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log(`Syntax passed for ${javascriptFiles.length} JavaScript and ${jsxFiles.length} JSX files.`);
