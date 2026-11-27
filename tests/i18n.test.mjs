// The extension's screens are in English by default, even when the browser itself is in Chinese.
// Chinese only when the user picks 中文, or picks "Same as browser" in a Chinese browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("../extension/i18n.js", import.meta.url), "utf8");

async function load(uiLanguage, stored) {
  const listeners = [];
  const g = {
    chrome: {
      i18n: { getUILanguage: () => uiLanguage },
      storage: {
        local: { get: async () => (stored === undefined ? {} : { ui_lang: stored }) },
        onChanged: { addListener: (f) => listeners.push(f) },
      },
    },
    navigator: { language: uiLanguage },
  };
  g.globalThis = g;
  vm.runInNewContext(SRC, g);
  await g.AB_LANG_READY;
  return { g, change: (v) => listeners.forEach((f) => f({ ui_lang: { newValue: v } }, "local")) };
}

test("English by default in an English browser", async () => {
  const { g } = await load("en-GB");
  assert.equal(g.AB_LANG, "en"); assert.equal(g.getUiLangPref(), "en"); assert.equal(g.tr("中文", "English"), "English");
});

test("English by default in a Chinese browser", async () => {
  for (const ui of ["zh-CN", "zh-TW", "zh"]) {
    const { g } = await load(ui);
    assert.equal(g.AB_LANG, "en", ui); assert.equal(g.tr("中文", "English"), "English", ui);
  }
});

test("Chinese only when the user picks it", async () => {
  assert.equal((await load("en-GB", "zh")).g.AB_LANG, "zh");
  assert.equal((await load("zh-CN", "auto")).g.AB_LANG, "zh");
  assert.equal((await load("en-GB", "auto")).g.AB_LANG, "en");
  assert.equal((await load("zh-CN", "en")).g.AB_LANG, "en");
  assert.equal((await load("zh-CN", "something-else")).g.AB_LANG, "en");
});

test("Clearing settings in My data goes back to English", async () => {
  const { g, change } = await load("zh-CN", "zh");
  assert.equal(g.AB_LANG, "zh");
  change(undefined);
  assert.equal(g.AB_LANG, "en"); assert.equal(g.getUiLangPref(), "en");
});
