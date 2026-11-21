import { describe, expect, it } from "vitest";
import { isViewable, pickModelLoader } from "../../ui/src/components/workshop3d/model3d-loader";

describe("pickModelLoader", () => {
  it("maps extensions case-insensitively", () => {
    expect(pickModelLoader("a.STL")).toBe("stl");
    expect(pickModelLoader("x/y.glb")).toBe("glb");
    expect(pickModelLoader("m.gltf")).toBe("gltf");
  });
  it("marks STEP/OBJ as unsupported", () => {
    expect(pickModelLoader("p.step")).toBe("unsupported");
    expect(pickModelLoader("p.STP")).toBe("unsupported");
    expect(pickModelLoader("o.obj")).toBe("unsupported");
  });
  it("handles backslash and Windows paths", () => {
    expect(pickModelLoader("a\\b\\c.Stl")).toBe("stl");
    expect(pickModelLoader("C:\\x\\y.GLTF")).toBe("gltf");
  });
  it("handles missing or compound extensions", () => {
    expect(pickModelLoader("noext")).toBe("unsupported");
    expect(pickModelLoader("foo.stl.txt")).toBe("unsupported");
    expect(pickModelLoader("dir.stl/file")).toBe("unsupported");
  });
  it("isViewable", () => {
    expect(isViewable("stl")).toBe(true);
    expect(isViewable("unsupported")).toBe(false);
  });
});
