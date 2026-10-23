import { en } from "./en.js";
import { jaJP } from "./ja-JP.js";
import type { Messages } from "./types.js";
import { zhCN } from "./zh-CN.js";

export type UiLanguage = "zh-CN" | "ja-JP" | "en";

export const messages: Readonly<Record<UiLanguage, Messages>> = {
  "zh-CN": zhCN,
  "ja-JP": jaJP,
  en,
};
