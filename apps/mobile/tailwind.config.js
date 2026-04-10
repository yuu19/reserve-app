/* eslint-disable @typescript-eslint/no-require-imports */
const heroUINativePlugin = require('heroui-native/tailwind-plugin').default;

const smartHrFontStack = [
  'AdjustedYuGothic',
  '"Yu Gothic"',
  'YuGothic',
  '"Hiragino Sans"',
  'sans-serif',
];

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
    extend: {
      colors: {
        brand: '#00c4cc',
        primary: '#0077c7',
        link: '#0071c1',
        warning: '#ffcc17',
        success: '#4bb47d',
        danger: '#e01e5a',
        white: '#ffffff',
        border: '#d6d3d0',
        'accent-strong': '#ff9900',
        'text-black': '#23221e',
        'text-grey': '#706d65',
        'text-disabled': '#c1bdb7',
        'stone-01': '#f8f7f6',
        'stone-02': '#edebe8',
        'stone-03': '#aaa69f',
        'stone-04': '#4e4c49',
        'over-background': '#f2f1f0',
        'action-background': '#d6d3d0',
        'chart-1': '#00c4cc',
        'chart-2': '#ffcd00',
        'chart-3': '#ff9100',
        'chart-4': '#e65537',
        'chart-5': '#2d4b9b',
        'chart-6': '#2d7df0',
        'chart-7': '#69d7ff',
        'chart-8': '#4bb47d',
        'chart-9': '#05878c',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '6px',
        xl: '6px',
      },
      fontSize: {
        xxs: ['0.667rem', { lineHeight: '1.5' }],
        xs: ['0.75rem', { lineHeight: '1.5' }],
        sm: ['0.857rem', { lineHeight: '1.5' }],
        base: ['1rem', { lineHeight: '1.5' }],
        lg: ['1.2rem', { lineHeight: '1.5' }],
        xl: ['1.5rem', { lineHeight: '1.25' }],
        '2xl': ['2rem', { lineHeight: '1.25' }],
      },
      fontFamily: {
        sans: smartHrFontStack,
        heading: smartHrFontStack,
      },
      boxShadow: {
        xs: '0 2px 4px rgba(0, 0, 0, 0.1)',
        sm: '0 2px 4px rgba(0, 0, 0, 0.1)',
        md: '0 4px 8px rgba(0, 0, 0, 0.15)',
        lg: '0 4px 8px rgba(0, 0, 0, 0.15)',
        xl: '0 4px 8px rgba(0, 0, 0, 0.15)',
      },
      screens: {
        sm: '600px',
        md: '960px',
      },
    },
  },
  plugins: [heroUINativePlugin],
};
