const TerserPlugin = require("terser-webpack-plugin");

module.exports = {
  entry: "./index.js",
  output: {
    filename: "bundle.js",
    libraryTarget: "commonjs",
  },
  mode: "production",
  target: "node",
  resolve: {
    extensions: [".js"],
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        parallel: true,
        extractComments: true,
      }),
    ],
  },
  stats: {
    errorDetails: true,
  },
};
