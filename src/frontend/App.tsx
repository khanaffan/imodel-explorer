import { ConfigurableUiContent, ThemeManager } from "@itwin/appui-react";
import { Root as StrataKitRoot } from "@stratakit/mui";
import { useGraphStore } from "./state/graphStore";
import { useColorScheme } from "./useColorScheme";
import { WelcomePage } from "./WelcomePage";
import "./app.css";

export function App() {
  const connection = useGraphStore((s) => s.connection);
  const colorScheme = useColorScheme();
  return (
    <ThemeManager>
      {/* The tree widget components are built on StrataKit. */}
      <StrataKitRoot colorScheme={colorScheme} className="ig-app">
        {connection ? <ConfigurableUiContent appBackstage={undefined} /> : <WelcomePage />}
      </StrataKitRoot>
    </ThemeManager>
  );
}

