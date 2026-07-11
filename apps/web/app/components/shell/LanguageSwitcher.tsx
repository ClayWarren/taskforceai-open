import React from 'react';
import { useTranslation } from 'react-i18next';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    void i18n.changeLanguage(lng);
  };

  return (
    <div className="language-switcher">
      <button
        type="button"
        onClick={() => changeLanguage('en')}
        disabled={i18n.language === 'en'}
        aria-label="Switch to English"
      >
        EN
      </button>
      <button
        type="button"
        onClick={() => changeLanguage('es')}
        disabled={i18n.language === 'es'}
        aria-label="Switch to Spanish"
      >
        ES
      </button>
    </div>
  );
};

export default LanguageSwitcher;
