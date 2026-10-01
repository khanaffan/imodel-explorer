import { type PropertyRecord, PropertyValueFormat } from "@itwin/appui-abstract";
import { PropertyValueRendererManager, type PropertyValueRendererContext, VirtualizedPropertyGridWithDataProvider } from "@itwin/components-react";
import type { IModelConnection } from "@itwin/core-frontend";
import { Text } from "@itwin/itwinui-react";
import { KeySet } from "@itwin/presentation-common";
import { PresentationPropertyDataProvider } from "@itwin/presentation-components";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { ELEMENT_PROPERTIES_RULESET } from "../engine/elementPropertiesRuleset";
import { InstanceLink } from "./InstanceLink";

class InstanceLinkRendererManager extends PropertyValueRendererManager {
  public override render(record: PropertyRecord, context?: PropertyValueRendererContext): ReactNode {
    if (!record.isMerged && record.value.valueFormat === PropertyValueFormat.Primitive) {
      const value = record.value.value;
      if (value && typeof value === "object" && "id" in value && "className" in value
        && typeof value.id === "string" && typeof value.className === "string") {
        return <InstanceLink reference={{ id: value.id, targetBaseClass: value.className }}>
          {record.value.displayValue || value.id}
        </InstanceLink>;
      }
    }
    return PropertyValueRendererManager.defaultManager.render(record, context);
  }
}

const instanceLinkRendererManager = new InstanceLinkRendererManager();

class PropertyGridErrorBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  public override state: { error?: Error } = {};

  public static getDerivedStateFromError(error: Error) {
    return { error };
  }

  public override render() {
    return this.state.error
      ? <div className="ig-error">Failed to load element properties: {this.state.error.message}</div>
      : this.props.children;
  }
}

export function ElementProperties({ imodel, className, id }: { imodel: IModelConnection; className: string; id: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [provider, setProvider] = useState<PresentationPropertyDataProvider>();

  useEffect(() => {
    const dataProvider = new PresentationPropertyDataProvider({ imodel, ruleset: ELEMENT_PROPERTIES_RULESET });
    // Inspect the graph selection, not unified selection (which also drives the viewport).
    dataProvider.keys = new KeySet([{ className, id }]);
    setProvider(dataProvider);
    return () => dataProvider[Symbol.dispose]();
  }, [imodel, className, id]);

  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="ig-element-properties" ref={container}>
      {provider && size.width > 0 && size.height > 0
        ? <PropertyGridErrorBoundary key={`${imodel.key}:${className}:${id}`}>
          <VirtualizedPropertyGridWithDataProvider
            dataProvider={provider}
            width={size.width}
            height={size.height}
            editorSystem="new"
            propertyValueRendererManager={instanceLinkRendererManager}
            isPropertyEditingEnabled={false}
          />
        </PropertyGridErrorBoundary>
        : <Text variant="small" isMuted>Loading properties...</Text>}
    </div>
  );
}
