import { createContext, useCallback, useContext, useEffect, useState } from "react";
import en from "./messages.en.js";
import { dataFonts } from "../../public/data-fonts.js";

export const preferenceKey = "storagebar.preferences";
const systemLanguage = () => (globalThis.chrome?.i18n?.getUILanguage() || navigator.language).toLowerCase().startsWith("zh") ? "zh" : "en";
const colorQuery = "(prefers-color-scheme: dark)";
const defaults = { section: "cookies", density: "compact", automatic: true, theme: "system", language: "system", font: "auto" };
const validSections = ["cookies", "local", "session", "idb", "cache"];

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(preferenceKey) || "{}");
    return {
      section: validSections.includes(saved.section) ? saved.section : defaults.section,
      density: saved.density === "comfortable" ? saved.density : defaults.density,
      automatic: typeof saved.automatic === "boolean" ? saved.automatic : defaults.automatic,
      theme: ["light", "dark"].includes(saved.theme) ? saved.theme : defaults.theme,
      language: ["zh", "en"].includes(saved.language) ? saved.language : defaults.language,
      font: Object.hasOwn(dataFonts, saved.font) ? saved.font : defaults.font,
    };
  } catch {
    return defaults;
  }
}

export const Preferences = createContext(null);
export const usePreferences = () => useContext(Preferences);

export function usePreferenceState() {
  const [prefs, setPrefs] = useState(readPreferences);
  const [systemDark, setSystemDark] = useState(() => matchMedia(colorQuery).matches);
  useEffect(() => {
    const query = matchMedia(colorQuery);
    const onTheme = ({ matches }) => setSystemDark(matches);
    const onStorage = (event) => { if (event.key === preferenceKey || event.key === null) setPrefs(readPreferences()); };
    query.addEventListener("change", onTheme);
    window.addEventListener("storage", onStorage);
    return () => {
      query.removeEventListener("change", onTheme);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const language = prefs.language === "system" ? systemLanguage() : prefs.language;
  const dark = prefs.theme === "system" ? systemDark : prefs.theme === "dark";
  const t = useCallback((message, values) => {
    if (typeof message !== "string") return message;
    const translated = language === "en" && Object.hasOwn(en, message) ? en[message] : message;
    return values ? translated.replace(/\{(\w+)\}/g, (match, key) => String(values[key] ?? match)) : translated;
  }, [language]);
  const savePrefs = (next) => {
    localStorage.setItem(preferenceKey, JSON.stringify(next));
    setPrefs(next);
  };
  return { prefs, savePrefs, language, dark, t };
}
