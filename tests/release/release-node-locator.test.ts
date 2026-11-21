import { describe, expect, it } from "vitest";
import { findNodeToolchain, NODE_MISSING_MSG } from "../../src/core/release/node-locator.js";

/** Fake file system: only the listed paths exist. */
const fsOf = (paths: string[]) => (p: string) => paths.includes(p);

const APP_NODE = "C:\\Users\\u\\AppData\\Local\\TNF\\Controller\\app\\node.exe";
const SYS_DIR = "C:\\Program Files\\nodejs";
const SYS_NODE = `${SYS_DIR}\\node.exe`;
const SYS_NPM = `${SYS_DIR}\\node_modules\\npm\\bin\\npm-cli.js`;

describe("findNodeToolchain", () => {
  it("uses the running node when npm sits next to it", () => {
    const own = "D:\\tools\\node\\node.exe";
    const npm = "D:\\tools\\node\\node_modules\\npm\\bin\\npm-cli.js";
    expect(findNodeToolchain({}, own, fsOf([own, npm]))).toEqual({ node: own, npmCli: npm });
  });

  it("the installed app's own node.exe has no npm: falls back to the node found on PATH", () => {
    const r = findNodeToolchain({ PATH: `C:\\Windows;${SYS_DIR}` }, APP_NODE, fsOf([APP_NODE, SYS_NODE, SYS_NPM]));
    expect(r).toEqual({ node: SYS_NODE, npmCli: SYS_NPM });
  });

  it("matches the PATH variable case-insensitively (Windows uses Path)", () => {
    const r = findNodeToolchain({ Path: SYS_DIR }, APP_NODE, fsOf([APP_NODE, SYS_NODE, SYS_NPM]));
    expect(r?.node).toBe(SYS_NODE);
  });

  it("falls back to Program Files when PATH has no node", () => {
    const r = findNodeToolchain({ PATH: "C:\\Windows", ProgramFiles: "C:\\Program Files" }, APP_NODE, fsOf([APP_NODE, SYS_NODE, SYS_NPM]));
    expect(r).toEqual({ node: SYS_NODE, npmCli: SYS_NPM });
  });

  it("TNF_NODE_DIR wins over PATH", () => {
    const custom = "E:\\my-node";
    const files = [APP_NODE, SYS_NODE, SYS_NPM, `${custom}\\node.exe`, `${custom}\\node_modules\\npm\\bin\\npm-cli.js`];
    const r = findNodeToolchain({ TNF_NODE_DIR: custom, PATH: SYS_DIR }, APP_NODE, fsOf(files));
    expect(r?.node).toBe(`${custom}\\node.exe`);
  });

  it("skips a node.exe that has no npm next to it", () => {
    const noNpmDir = "C:\\other";
    const r = findNodeToolchain({ PATH: `${noNpmDir};${SYS_DIR}` }, APP_NODE, fsOf([APP_NODE, `${noNpmDir}\\node.exe`, SYS_NODE, SYS_NPM]));
    expect(r?.node).toBe(SYS_NODE);
  });

  it("an existing npm_execpath is honoured", () => {
    const cli = "C:\\x\\npm-cli.js";
    expect(findNodeToolchain({ npm_execpath: cli }, APP_NODE, fsOf([cli]))).toEqual({ node: APP_NODE, npmCli: cli });
  });

  it("returns null and the message tells how to fix it when no Node with npm exists", () => {
    expect(findNodeToolchain({ PATH: "C:\\Windows" }, APP_NODE, fsOf([APP_NODE]))).toBeNull();
    expect(NODE_MISSING_MSG).toMatch(/Node\.js/);
    expect(NODE_MISSING_MSG).toMatch(/TNF_NODE_DIR/);
  });
});
