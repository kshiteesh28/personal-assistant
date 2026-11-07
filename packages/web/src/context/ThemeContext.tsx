import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'apple' | 'forge' | 'archive' | 'abyss' | string;

interface ThemeContextType {
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'apple',
  setTheme: () => {}
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(
    localStorage.getItem('secretary_theme') || 'apple'
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('secretary_theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useThemeContext = () => useContext(ThemeContext);
