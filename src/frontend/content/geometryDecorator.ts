/** Viewport decorator for the Geometry widget: the oriented placement box, the axis-aligned world
 * range, a local axes triad and the selected op's local range, drawn as a world overlay. */
import { Point3d, Range3d, type Transform, Vector3d } from "@itwin/core-geometry";
import { ColorDef, type Placement2d, type Placement3d } from "@itwin/core-common";
import { type DecorateContext, type Decorator, GraphicType, IModelApp } from "@itwin/core-frontend";

export interface GeometryDecorationData {
  readonly placement: Placement3d | Placement2d;
  readonly worldRange?: Range3d;
  /** Local range of the selected op, drawn in the placement's frame. */
  readonly selectedLocalRange?: Range3d;
}

const PLACEMENT_COLOR = ColorDef.from(75, 167, 232);
const WORLD_COLOR = ColorDef.from(141, 150, 168, 128);
const SELECTED_COLOR = ColorDef.from(232, 160, 74);
const AXIS_COLORS = [ColorDef.from(220, 68, 68), ColorDef.from(74, 200, 110), ColorDef.from(80, 120, 240)];

class GeometryStreamDecorator implements Decorator {
  public data?: GeometryDecorationData;

  public decorate(context: DecorateContext): void {
    const data = this.data;
    if (!data || !context.viewport.view.isSpatialView?.()) return;
    const builder = context.createGraphicBuilder(GraphicType.WorldOverlay);
    const { placement, worldRange, selectedLocalRange } = data;

    if (worldRange && !worldRange.isNull) {
      builder.setSymbology(WORLD_COLOR, WORLD_COLOR, 1);
      builder.addRangeBox(worldRange);
    }

    if (placement.isValid) {
      builder.setSymbology(PLACEMENT_COLOR, PLACEMENT_COLOR, 2);
      builder.addRangeBoxFromCorners(placement.getWorldCorners().points);
    }

    this.drawAxes(builder, placement.transform, worldRange);

    if (selectedLocalRange && !selectedLocalRange.isNull) {
      builder.setSymbology(SELECTED_COLOR, SELECTED_COLOR, 3);
      builder.addRangeBoxFromCorners(selectedLocalRange.corners().map((c) => placement.transform.multiplyPoint3d(c)));
    }

    context.addDecorationFromBuilder(builder);
  }

  private drawAxes(builder: ReturnType<DecorateContext["createGraphicBuilder"]>, transform: Transform, worldRange: Range3d | undefined): void {
    const origin = transform.getOrigin();
    const scale = worldRange && !worldRange.isNull ? Math.max(worldRange.diagonal().magnitude() * 0.25, 0.1) : 1;
    const axes = [Vector3d.unitX(), Vector3d.unitY(), Vector3d.unitZ()];
    for (let i = 0; i < 3; i++) {
      const dir = transform.matrix.multiplyVector(axes[i]);
      dir.normalizeInPlace();
      builder.setSymbology(AXIS_COLORS[i], AXIS_COLORS[i], 3);
      builder.addLineString([origin.clone(), origin.plusScaled(dir, scale) as Point3d]);
    }
  }
}

let decorator: GeometryStreamDecorator | undefined;

/** Shows (or updates) the decoration; pass `undefined` to remove it. */
export function setGeometryDecoration(data: GeometryDecorationData | undefined): void {
  if (!data) {
    if (decorator) {
      IModelApp.viewManager.dropDecorator(decorator);
      decorator = undefined;
    }
    return;
  }
  if (!decorator) {
    decorator = new GeometryStreamDecorator();
    IModelApp.viewManager.addDecorator(decorator);
  }
  decorator.data = data;
  IModelApp.viewManager.invalidateDecorationsAllViews();
}
