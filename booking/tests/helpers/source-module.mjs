import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

/** Execute actual TS/TSX with explicit dependencies; unexpected I/O fails closed. */
export function loadSource(path, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, URLSearchParams, Date, Intl, Buffer,
    console: { warn() {}, error() {} }, process: { env: {} },
    require(name) {
      if (name === "server-only") return {};
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw new Error(`Unmocked dependency: ${name}`);
    },
    ...globals,
  });
  return exports;
}

export function resultQuery(result, calls = []) {
  const query = new Proxy({}, { get(_, name) {
    if (name === "then") return (resolve) => resolve(result);
    return (...args) => { calls.push([name, ...args]); return query; };
  } });
  return query;
}
