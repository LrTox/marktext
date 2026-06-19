import editorExportVariables from '../assets/styles/editorExportVariables.css?inline'
import {
  ayuDark,
  ayuLight,
  ayuMirage,
  catppuccinLatte,
  catppuccinMocha,
  cyberdream,
  dark,
  dracula,
  everforestDark,
  everforestLight,
  graphite,
  gruvboxDark,
  gruvboxLight,
  horizonDark,
  kanagawa,
  materialDark,
  monokaiPro,
  nightfox,
  nord,
  oneDark,
  oxocarbonDark,
  palenight,
  rosePine,
  rosePineDawn,
  rosePineMoon,
  solarizedDark,
  solarizedLight,
  synthwave84,
  tokyoNight,
  tokyoNightLight,
  tokyoNightStorm,
  ulysses
} from './themeColor'

const LIGHT_THEME_CSS =
  editorExportVariables +
  '\n:root {\n  --link-color: var(--linkColor);\n  --blockquote-border-color: var(--blockquoteBorderColor);\n}'

/**
 * Return the raw editor theme stylesheet (CSS variables + Prism theme) for a
 * given theme id. Used by the live editor and by static export.
 */
export const getThemeStylesheet = (theme: string): string => {
  switch (theme) {
    case 'light':
      return LIGHT_THEME_CSS
    case 'dark':
      return dark()
    case 'material-dark':
      return materialDark()
    case 'ulysses':
      return ulysses()
    case 'graphite':
      return graphite()
    case 'one-dark':
      return oneDark()
    case 'dracula':
      return dracula()
    case 'nord':
      return nord()
    case 'catppuccin-mocha':
      return catppuccinMocha()
    case 'gruvbox-dark':
      return gruvboxDark()
    case 'tokyo-night':
      return tokyoNight()
    case 'tokyo-night-storm':
      return tokyoNightStorm()
    case 'solarized-dark':
      return solarizedDark()
    case 'ayu-dark':
      return ayuDark()
    case 'ayu-mirage':
      return ayuMirage()
    case 'everforest-dark':
      return everforestDark()
    case 'rose-pine':
      return rosePine()
    case 'rose-pine-moon':
      return rosePineMoon()
    case 'monokai-pro':
      return monokaiPro()
    case 'synthwave-84':
      return synthwave84()
    case 'horizon-dark':
      return horizonDark()
    case 'palenight':
      return palenight()
    case 'oxocarbon-dark':
      return oxocarbonDark()
    case 'kanagawa':
      return kanagawa()
    case 'nightfox':
      return nightfox()
    case 'cyberdream':
      return cyberdream()
    case 'catppuccin-latte':
      return catppuccinLatte()
    case 'gruvbox-light':
      return gruvboxLight()
    case 'tokyo-night-light':
      return tokyoNightLight()
    case 'solarized-light':
      return solarizedLight()
    case 'ayu-light':
      return ayuLight()
    case 'everforest-light':
      return everforestLight()
    case 'rose-pine-dawn':
      return rosePineDawn()
    default:
      return LIGHT_THEME_CSS
  }
}
