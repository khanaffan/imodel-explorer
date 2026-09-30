import { Button, Modal, ModalButtonBar, ModalContent, Select, Text, ToggleSwitch } from "@itwin/itwinui-react";
import { APP_THEMES, appThemeActions, DEFAULT_APP_THEME, useAppThemeStore } from "../state/appTheme";
import { DEFAULT_FEATURES, featureActions, featureEnabled, FEATURES, useFeatureStore } from "../state/featureStore";
import "./widgets.css";

const CORE = [
  "Open iModel & 3D viewport",
  "ECSQL seed query",
  "Instance graph & traversal filters",
  "Properties panel",
];

/** Settings for optional features, available both from the Welcome page and in the app.
 * Disabling a feature hides its controls and stops the queries it would run; children of a
 * disabled parent become inactive but keep their saved choice. */
export function FeatureSettingsDialog() {
  const open = useFeatureStore((s) => s.settingsOpen);
  const features = useFeatureStore((s) => s.features);
  const featureStorageError = useFeatureStore((s) => s.storageError);
  const theme = useAppThemeStore((s) => s.theme);
  const themeStorageError = useAppThemeStore((s) => s.storageError);
  const isDefault = theme === DEFAULT_APP_THEME && FEATURES.every((f) => features[f.id] === DEFAULT_FEATURES[f.id]);
  const resetDefaults = () => {
    featureActions.resetDefaults();
    appThemeActions.resetDefault();
  };
  return (
    <Modal isOpen={open} title="App settings" onClose={featureActions.closeSettings}>
      <ModalContent>
        <div className="ig-settings">
          <Text isMuted variant="small">
            Theme and feature choices apply to every iModel you open.
          </Text>
          <div className="ig-settings__section">
            <Text variant="leading">Appearance</Text>
            <div className="ig-settings__row">
              <Text>Theme</Text>
              <Select
                options={[...APP_THEMES]}
                value={theme}
                onChange={appThemeActions.setTheme}
              />
            </div>
          </div>
          <div className="ig-settings__section">
            <Text variant="leading">Core (always on)</Text>
            {CORE.map((label) => (
              <div key={label} className="ig-settings__row"><ToggleSwitch checked disabled label={label} /></div>
            ))}
          </div>
          <div className="ig-settings__section">
            <Text variant="leading">Optional features</Text>
            <Text isMuted variant="small">
              Switch off optional features to skip their queries and keep the app focused on the data-model view.
            </Text>
            {FEATURES.map((f) => {
              const parentOn = f.parent === undefined || featureEnabled(f.parent, features);
              return (
                <div key={f.id} className={f.parent ? "ig-settings__row ig-settings__row--child" : "ig-settings__row"}>
                  <ToggleSwitch
                    checked={features[f.id]}
                    disabled={!parentOn}
                    label={f.label}
                    onChange={(e) => featureActions.setEnabled(f.id, e.target.checked)}
                  />
                  <Text isMuted variant="small" className="ig-settings__desc">{f.description}</Text>
                </div>
              );
            })}
          </div>
          {(featureStorageError || themeStorageError) && (
            <div className="ig-error">Could not save settings: {featureStorageError ?? themeStorageError}</div>
          )}
        </div>
      </ModalContent>
      <ModalButtonBar>
        <Button disabled={isDefault} onClick={resetDefaults}>Reset to defaults</Button>
        <Button styleType="high-visibility" onClick={featureActions.closeSettings}>Close</Button>
      </ModalButtonBar>
    </Modal>
  );
}
