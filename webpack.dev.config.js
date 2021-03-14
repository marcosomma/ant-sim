const CopyWebpackPlugin = require('copy-webpack-plugin')
const webpack = require('webpack')
const { SourceMapDevToolPlugin } = require('webpack')
const nodeExternals = require('webpack-node-externals')
const HtmlWebpackPlugin = require('html-webpack-plugin')

module.exports = {
  entry: {
    mainDev: __dirname + '/src/index.js',
  },
  output: {
    filename: '[name].js',
    path: __dirname + '/dist',
  },
  performance: {
    hints: false,
  },
  plugins: [
    new SourceMapDevToolPlugin({
      filename: '[file].map',
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: __dirname + '/src/index_dev.html',
        },
        {
          from: __dirname + '/src/favicon.ico',
        },
        {
          from: __dirname + '/src/db.json',
        },
        {
          from: __dirname + '/src/assets/',
          to: __dirname + '/dist/assets',
        },
      ],
    }),
    new webpack.EnvironmentPlugin({
      NODE_ENV: process.env.NODE_ENV,
    }),
    new HtmlWebpackPlugin({
      filename: 'index.html',
      inject: false,
      template: 'src/index_dev.html',
    }),
  ],
  resolve: {
    extensions: ['.js', '.ttf', '.obj', '.mtl', '.ico', '.tga', '.*', '*'],
  },
  devServer: {
    inline: true,
    port: 8080,
  },
  module: {
    rules: [
      {
        test: /\.test.js$/,
        exclude: ['/node_modules/', '/src/assets'],
        use: [
          {
            loader: 'babel-loader',
            options: {},
          },
        ],
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/,
        loader: 'file-loader',
      },
      {
        test: /\.(css)$/,
        use: ['css-loader'],
      },
      {
        test: /\.js$/,
        enforce: 'pre',
        use: ['source-map-loader'],
      },
      {
        test: /\.obj$/,
        loader: 'webpack-obj-loader',
      },
      {
        test: /\.mtl$/,
        loader: 'mtl-loader',
      },
    ],
  },
}
