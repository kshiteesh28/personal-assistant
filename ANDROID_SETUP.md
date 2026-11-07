# Flow-State: Android Capacitor Setup Guide (Phase 7)

## Prerequisites
- Android Studio installed
- JDK 17+ installed
- Android SDK installed (via Android Studio)

---

## Step 1: Install Capacitor Core & CLI (run from repo root)

```bash
# From project root
npm install @capacitor/core @capacitor/cli

# Initialize Capacitor (only needed first time)
npx cap init "Flow-State" "com.flowstate.app" --web-dir packages/web/dist
```

---

## Step 2: Install Capacitor Plugins

```bash
npm install @capacitor/android
npm install @capacitor/status-bar
npm install @capacitor/haptics
npm install @capacitor/network
npm install @capacitor/app
npm install @capacitor/splash-screen
```

---

## Step 3: Add Android Platform

```bash
npx cap add android
```

---

## Step 4: Build Web App & Sync to Android

```bash
# Build the web app
cd packages/web && npm run build && cd ../..

# Copy web build into Android project
npx cap sync android
```

---

## Step 5: Open in Android Studio

```bash
npx cap open android
```

Then in Android Studio:
- Click **Run ▶** to build and deploy to your device/emulator
- To sign for release: **Build → Generate Signed Bundle/APK**

---

## Step 6: Android-Specific Configuration

After `npx cap add android`, edit `android/app/src/main/AndroidManifest.xml`:

```xml
<!-- Add inside <activity> tag for keyboard resize support -->
android:windowSoftInputMode="adjustResize"
```

Edit `android/app/src/main/res/values/strings.xml`:
```xml
<string name="app_name">Flow-State</string>
```

---

## Update Workflow (after every web change)

```bash
cd packages/web && npm run build && cd ../..
npx cap sync android
# Then rebuild in Android Studio or run via CLI:
npx cap run android
```

---

## Capacitor Integration Status

| Feature | Status | Location |
|---------|--------|----------|
| Back button handler | ✅ Ready | `src/services/capacitor.ts` |
| Status bar theming | ✅ Ready | `src/services/capacitor.ts` |
| Haptic feedback utility | ✅ Ready | `hapticFeedback()` export |
| Splash screen config | ✅ Ready | `capacitor.config.ts` |
| Network offline banner | ✅ Ready | `NetworkStatus.tsx` |
| App config | ✅ Ready | `capacitor.config.ts` |
| Android platform files | ⏳ Run `npx cap add android` | — |
| Plugins installed | ⏳ Run Step 2 above | — |
