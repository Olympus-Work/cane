import { useI18n, type Lang } from '../i18n/index.js';
import { useTheme } from '../theme.js';
import { Icon } from './Icon.js';

const LANGS: { code: Lang; label: string }[] = [
  { code: 'th', label: 'TH' },
  { code: 'en', label: 'EN' },
];

/** TH / EN segmented control (spec: 3px padding, radius full, 1px --border-strong; active = --accent-strong + white). */
export function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="seg">
      {LANGS.map((l) => (
        <button key={l.code} type="button" className="seg-btn" aria-pressed={lang === l.code} onClick={() => setLang(l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

/** 34px circle theme toggle: fa-sun in dark, fa-moon in light. */
export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const { t } = useI18n();
  return (
    <button type="button" className="icon-circle" aria-label={t('theme')} onClick={toggle}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
