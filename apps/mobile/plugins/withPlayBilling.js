const { withGradleProperties } = require("expo/config-plugins");

/**
 * Pins the Google Play Billing Library version used by react-native-iap.
 *
 * Why this exists: react-native-iap resolves its billing dependency as
 *
 *     implementation "com.android.billingclient:billing-ktx:$playBillingSdkVersion"
 *
 * where `playBillingSdkVersion` falls back to `RNIap_playBillingSdkVersion`
 * in the library's own android/gradle.properties. That makes the Billing
 * Library version — which Google enforces a hard minimum on, and raises
 * roughly annually — an internal detail of a node_modules package, invisible
 * from the repo and unchangeable without patching a dependency.
 *
 * This plugin lifts it into app.json, so it is one reviewable value that the
 * operator can raise when Play's minimum moves, exactly like targetSdkVersion.
 *
 * IMPORTANT: raising this number is not always sufficient on its own. Major
 * Billing Library releases remove APIs, so a version the installed
 * react-native-iap was not written against may fail to compile or misbehave
 * at runtime. Confirm Play's current minimum, then verify with a real Android
 * build — see SLATE_PRODUCTION_CONFIGURATION.md.
 */
const PROPERTY = "RNIap_playBillingSdkVersion";

module.exports = function withPlayBilling(config, props) {
  const version = props && props.playBillingSdkVersion;
  if (!version) {
    throw new Error(
      "withPlayBilling: `playBillingSdkVersion` is required. Set it in app.json so the " +
        "Play Billing Library version is explicit rather than inherited from react-native-iap.",
    );
  }

  return withGradleProperties(config, (cfg) => {
    // Replace any existing entry rather than appending a duplicate — Gradle
    // takes the last value, so a stale earlier line would silently win on
    // some orderings.
    cfg.modResults = cfg.modResults.filter(
      (item) => !(item.type === "property" && item.key === PROPERTY),
    );
    cfg.modResults.push({
      type: "comment",
      value:
        " Google Play Billing Library version, set from app.json by plugins/withPlayBilling.js.",
    });
    cfg.modResults.push({ type: "property", key: PROPERTY, value: String(version) });

    console.log(
      `withPlayBilling: Play Billing Library pinned to ${version}. ` +
        "Confirm this still meets Google Play's current minimum before submitting.",
    );
    return cfg;
  });
};
