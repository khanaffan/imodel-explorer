import { ConfigurableUiContent, ThemeManager } from "@itwin/appui-react";
import { Root as StrataKitRoot } from "@stratakit/mui";
import { useGraphStore } from "./state/graphStore";
import { WelcomePage } from "./WelcomePage";
import "./app.css";

export function App() {
  const connection = useGraphStore((s) => s.connection);
  return (
    <ThemeManager>
      {/* The tree widget components are built on StrataKit. */}
      <StrataKitRoot colorScheme="light" className="ig-app">
        {connection ? <ConfigurableUiContent appBackstage={undefined} /> : <WelcomePage />}
      </StrataKitRoot>
    </ThemeManager>
  );
}

