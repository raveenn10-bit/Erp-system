import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'lk.com.harshapex.sanjeewaerp',
  appName: 'Nugathalawa ERP',
  webDir: 'out',
  android: {
    // Never allow cleartext HTTP or debugging of the WebView in release builds.
    allowMixedContent: false,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#064808',
  },
  plugins: {
    // API calls go through the native HTTP stack: no browser CORS, and the
    // HttpOnly session cookie is kept in Android's private CookieManager.
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
    // Offline database: SQLCipher-encrypted, passphrase kept in Android Keystore-backed storage.
    // Live updates of the web bundle (self-hosted on GitHub Releases, no Capgo cloud):
    // the app downloads + verifies the bundle itself; nothing is sent to Capgo.
    CapacitorUpdater: { autoUpdate: false, statsUrl: '', resetWhenUpdate: true, appReadyTimeout: 15000, keepUrlPathAfterReload: true },
    CapacitorSQLite: { androidIsEncryption: true, androidBiometric: { biometricAuth: false } },
    SplashScreen: {
      launchShowDuration: 1200,
      launchAutoHide: true,
      backgroundColor: '#064808',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    StatusBar: { style: 'DARK', backgroundColor: '#0C5051', overlaysWebView: false },
    Keyboard: { resize: KeyboardResize.Body, resizeOnFullScreen: true },
  },
};

export default config;
