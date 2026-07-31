module.exports = function (api) {
  api.cache(true);
  return {
    // unstable_transformImportMeta: zustand v5 ships `import.meta` in its
    // ESM output, which Metro serves as a classic script — without this
    // transform the web bundle throws "Cannot use 'import.meta' outside a
    // module" at startup.
    presets: [['babel-preset-expo', { unstable_transformImportMeta: true }]],
  };
};
