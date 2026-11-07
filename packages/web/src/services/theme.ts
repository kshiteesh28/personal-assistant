import { useState, useEffect } from 'react';

export function useTheme() {
  const [theme, setThemeState] = useState(localStorage.getItem('secretary_theme') || 'apple');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('secretary_theme', theme);
  }, [theme]);

  const setTheme = (newTheme: string) => {
    setThemeState(newTheme);
  };

  return { theme, setTheme };
}
