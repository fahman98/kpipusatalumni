module.exports = {
  // js/*.js only: js/vendor/ holds third-party code whose words (e.g.
  // 'collapse') would otherwise become Tailwind classes
  content: ['./index.html', './js/*.js'],
  theme: {
    extend: {},
  },
  plugins: [],
};
