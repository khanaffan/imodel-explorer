import { ConfigurableUiContent, ThemeManager } from "@itwin/appui-react";
import { Root as StrataKitRoot } from "@stratakit/mui";
import { CommandPalette } from "./commands/CommandPalette";
import { ToastBridge } from "./commands/ToastBridge";
import { useAppThemeStore } from "./state/appTheme";
import { useGraphStore } from "./state/graphStore";
import { useColorScheme } from "./useColorScheme";
import { FeatureSettingsDialog } from "./widgets/FeatureSettingsDialog";
import { WelcomePage } from "./WelcomePage";
import "./app.css";

export function App() {
  const connection = useGraphStore((s) => s.connection);
  const theme = useAppThemeStore((s) => s.theme);
  const colorScheme = useColorScheme();
  return (
    <ThemeManager theme={theme}>
      {/* The tree widget components are built on StrataKit. */}
      <StrataKitRoot colorScheme={colorScheme} className="ig-app">
        {connection ? <ConfigurableUiContent appBackstage={undefined} /> : <WelcomePage />}
        <FeatureSettingsDialog />
        <CommandPalette />
        <ToastBridge />
      </StrataKitRoot>
    </ThemeManager>
  );
}
