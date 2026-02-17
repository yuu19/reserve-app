/* eslint-disable @typescript-eslint/no-require-imports */
const heroUINativePlugin = require('heroui-native/tailwind-plugin').default;

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './App.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
    './app/**/*.{js,jsx,ts,tsx}',
    './node_modules/heroui-native/lib/**/*.{js,ts,jsx,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [heroUINativePlugin],
};
