import en from './locales/en.json';

type Dictionary = Record<string, any>;
const dictionaries: Record<string, Dictionary> = { en };
let currentLanguage = 'en';

export function setLanguage(language: string) {
  currentLanguage = dictionaries[language] ? language : 'en';
}

export function translate(path: string, values: Record<string, string | number> = {}) {
  const template = path.split('.').reduce<any>((node, part) => node?.[part], dictionaries[currentLanguage]) ?? path;
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), String(value)),
    template,
  );
}

export function useTranslation(namespace?: string) {
  return {
    t: (key: string, values?: Record<string, string | number>) =>
      translate(namespace ? `${namespace}.${key}` : key, values),
    i18n: { language: currentLanguage, changeLanguage: setLanguage },
  };
}
