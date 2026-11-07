import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.flowstate.app',
  appName: 'Flow-State',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    // Resize viewport when the on-screen keyboard appears, preventing layout jump
    allowMixedContent: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#010101',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
    StatusBar: {
      // Will be dynamically set in capacitor.ts based on theme
      style: 'Dark',
    },
  },
};

export default config;
