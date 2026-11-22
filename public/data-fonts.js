const fallback = 'ui-monospace, "Cascadia Mono", Consolas, "Microsoft YaHei UI", monospace';
export const dataFonts = {
  auto: fallback,
  cascadia: `"Cascadia Mono", ${fallback}`,
  consolas: `Consolas, ${fallback}`,
  jetbrains: `"JetBrains Mono", ${fallback}`,
};

export const dataFont = (name) => Object.hasOwn(dataFonts, name) ? dataFonts[name] : fallback;
