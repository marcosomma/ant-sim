var CopyWebpackPlugin = require('copy-webpack-plugin')
var webpack = require('webpack')
var nodeExternals = require('webpack-node-externals')

module.exports = {
  entry: {
    main: __dirname + '/src/index.js',
  },
  output: {
    filename: '[name].js',
    path: __dirname + '/dist',
  },
  performance: {
    hints: false,
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        {
          from: __dirname + '/src/index.html',
        },
        {
          from: __dirname + '/src/favicon.ico',
        },
        {
          from: __dirname + '/src/assets/fonts/',
          to: __dirname + '/dist/fonts',
        },
        {
          from: __dirname + '/src/assets/css/',
          to: __dirname + '/dist/css',
        },
      ],
    }),
    new webpack.EnvironmentPlugin({
      NODE_ENV: process.env.NODE_ENV,
    }),
  ],
  resolve: {
    extensions: ['.js', '.ttf', '*'],
  },
  devServer: {
    inline: true,
    contentBase: __dirname + '/dist',
    port: 8080,
  },
  module: {
    rules: [
      {
        test: /\.test.js$/,
        exclude: ['/node_modules/'],
        use: [
          {
            loader: 'babel-loader',
            options: {},
          },
        ],
      },
    ],
  },
}
