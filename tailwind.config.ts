import type { Config } from 'tailwindcss'

/**
 * Tailwind configuration — foundation only.
 *
 * Brand theme (colours, fonts, spacing scale) and the Arabic/RTL font stack are
 * defined in Milestone 2 (Doc 22 M2-T04, Doc 23 REL-M2-T01). Nothing branded is
 * invented here.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}

export default config
