module.exports = function (eleventyConfig) {
  // Copy static assets straight through to the output folder.
  eleventyConfig.addPassthroughCopy("src/assets");

  // Watch CSS/JS for changes during local development.
  eleventyConfig.addWatchTarget("src/assets/css/");
  eleventyConfig.addWatchTarget("src/assets/js/");

  eleventyConfig.addFilter("year", () => new Date().getFullYear());

  return {
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site",
    },
  };
};
