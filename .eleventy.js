module.exports = function (eleventyConfig) {
  eleventyConfig.addPassthroughCopy("src/assets");
  eleventyConfig.addPassthroughCopy({
    "src/_data/taxiProject.json": "assets/project-code/snapshot.json"
  });

  eleventyConfig.addWatchTarget("src/assets/css/");
  eleventyConfig.addWatchTarget("src/assets/js/");

  eleventyConfig.addFilter("year", () => new Date().getFullYear());
  eleventyConfig.addFilter("count", value =>
    Number(value).toLocaleString("en-US")
  );
  eleventyConfig.addFilter("moneyCents", value =>
    (Number(value) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })
  );
  eleventyConfig.addFilter("barHeight", value =>
    (Number(value) / 4500000 * 100).toFixed(2)
  );

  return {
    templateFormats: ["njk"],
    dir: {
      input: "src",
      includes: "_includes",
      data: "_data",
      output: "_site"
    }
  };
};
