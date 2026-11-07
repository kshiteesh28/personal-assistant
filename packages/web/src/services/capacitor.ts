/**
 * capacitor.ts — Android-native integrations (Phase 7)
 * 
 * This file safely imports Capacitor plugins. It checks for the Capacitor
 * runtime before calling any native APIs, so the web app still works in
 * a regular browser without any errors.
 * 
 * Import and call `initCapacitor()` from your main App component.
 */

/** True when running inside a Capacitor native app (Android/iOS) */
export const isNative = (): boolean => {
  return !!(window as any).Capacitor?.isNativePlatform?.();
};

/**
 * Initialize all Capacitor Android integrations.
 * Call once at app startup (e.g., in App.tsx useEffect).
 */
export async function initCapacitor(theme: 'ocean' | 'light' | string = 'light') {
  if (!isNative()) return; // No-op in browser

  try {
    // ── Back button (CRITICAL — prevents instant app exit) ────────────────
    const { App: CapApp } = await import('@capacitor/app');
    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        // Allow double-tap to exit pattern — for now just exit
        CapApp.exitApp();
      }
    });

    // ── Status bar color — match theme ────────────────────────────────────
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const isDark = theme === 'ocean';
    await StatusBar.setBackgroundColor({ color: isDark ? '#010101' : '#f5f5f7' });
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });

    // ── Haptics on task completion (imported lazily) ──────────────────────
    // Haptics are called from individual components via hapticFeedback() below

    // ── Splash screen hide ────────────────────────────────────────────────
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide();

  } catch (err) {
    // Graceful fallback — plugin not installed yet
    console.warn('[Capacitor] Native plugin not available:', err);
  }
}

/**
 * Update status bar color when theme changes.
 * Call from your theme toggle handler.
 */
export async function updateStatusBarTheme(theme: string) {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    const isDark = theme === 'ocean';
    await StatusBar.setBackgroundColor({ color: isDark ? '#010101' : '#f5f5f7' });
    await StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light });
  } catch {}
}

/**
 * Haptic feedback helper — call on task complete, button taps, etc.
 * Gracefully no-ops in browser.
 * 
 * @example
 * await hapticFeedback('medium'); // task complete
 * await hapticFeedback('light');  // button tap
 * await hapticFeedback('heavy');  // destructive action
 */
export async function hapticFeedback(style: 'light' | 'medium' | 'heavy' = 'light') {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    const styleMap = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: styleMap[style] });
  } catch {}
}
