import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

export type Lang = 'zh' | 'en';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (zh: string, en: string) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'zh',
  setLang: () => {},
  t: (zh) => zh,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('nv-lang');
      return saved === 'en' ? 'en' : 'zh';
    } catch { return 'zh'; }
  });

  const handleSetLang = useCallback((newLang: Lang) => {
    setLang(newLang);
    try { localStorage.setItem('nv-lang', newLang); } catch { /* ignore */ }
  }, []);

  const t = useCallback((zh: string, en: string) => lang === 'en' ? en : zh, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang: handleSetLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}

/** Standalone translation for non-component code (validators, generators) */
export function tl(lang: Lang, zh: string, en: string): string {
  return lang === 'en' ? en : zh;
}
