import { ConfigurableUiContent, ThemeManager } from "@itwin/appui-react";
import { Root as StrataKitRoot } from "@stratakit/mui";
import { CommandPalette } from "./commands/CommandPalette";
import { ShortcutSheet } from "./commands/ShortcutSheet";
import { FirstRunTour } from "./commands/FirstRunTour";
import { AboutDialog } from "./commands/AboutDialog";
import { ToastBridge } from "./commands/ToastBridge";
import { useEffect } from "react";
import { startDeepLinks } from "./commands/deepLinks";
import { useAppThemeStore } from "./state/appTheme";
import { useGraphStore } from "./state/graphStore";
import { useColorScheme } from "./useColorScheme";
import { FileDropTarget } from "./FileDropTarget";
import { FeatureSettingsDialog } from "./widgets/FeatureSettingsDialog";
import { WelcomePage } from "./WelcomePage";
import "./app.css";

export function App() {
  const connection = useGraphStore((s) => s.connection);
  const theme = useAppThemeStore((s) => s.theme);
  const colorScheme = useColorScheme();
  useEffect(() => startDeepLinks(), []);
  return (
    <ThemeManager theme={theme}>
      {/* The tree widget components are built on StrataKit. */}
      <StrataKitRoot colorScheme={colorScheme} className="ig-app">
        {connection ? <ConfigurableUiContent appBackstage={undefined} /> : <WelcomePage />}
        <FeatureSettingsDialog />
        <CommandPalette />
        <ShortcutSheet />
        <FirstRunTour />
        <AboutDialog />
        <ToastBridge />
        <FileDropTarget />
      </StrataKitRoot>
    </ThemeManager>
  );
}
