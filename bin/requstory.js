#!/usr/bin/env node
import { run } from "../src/cli.js";

run(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (error) => {
    const hint = error.status === 401 ? "\nCreate a key at https://requstory.com/#profile, then run: requstory login <key>" : "";
    process.stderr.write(`requstory: ${error.message}${hint}\n`);
    process.exit(error.code === "USAGE" ? 2 : 1);
  },
);
