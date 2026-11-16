// These native modules are present only because pnpm auto-installs peer dependencies of navigation packages the app
// does not use (react-native-drawer-layout). The app's JavaScript never imports them, so they are excluded from
// native autolinking. This also avoids a Windows 260-character path failure when CMake builds react-native-worklets.
// Remove an entry here if the app later adopts gestures or Reanimated animations.
module.exports = {
  dependencies: {
    "react-native-reanimated": { platforms: { android: null, ios: null } },
    "react-native-worklets": { platforms: { android: null, ios: null } },
    "react-native-gesture-handler": { platforms: { android: null, ios: null } }
  }
};
