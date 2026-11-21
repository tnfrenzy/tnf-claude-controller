"""Write parts + materials to a USDZ for iOS Quick Look: UsdPreviewSurface with the same textures as the GLB
(albedo, normal, roughness from w3d_textures / a material library), packed inside the archive.
Usage: export_usdz.py <parts_dir> <materials.json> <out.usdz> [--texture-px N]  (default 1024)"""
import argparse
import os
import shutil
import tempfile

import w3d_common as c
from assemble_glb import texture_set_for
from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdUtils


def save_image(img, path):
    """JPEG-backed images (procedural sets) stay JPEG, everything else is PNG. Returns the written file name."""
    if getattr(img, "format", None) == "JPEG":
        path += ".jpg"
        img.save(path, format="JPEG", quality=92)
    else:
        path += ".png"
        img.save(path, format="PNG")
    return os.path.basename(path)


def texture_node(stage, mat_path, name, file_rel, st_out, colour_space, scale=None, bias=None):
    t = UsdShade.Shader.Define(stage, f"{mat_path}/{name}")
    t.CreateIdAttr("UsdUVTexture")
    t.CreateInput("file", Sdf.ValueTypeNames.Asset).Set(file_rel)
    t.CreateInput("st", Sdf.ValueTypeNames.Float2).ConnectToSource(st_out)
    t.CreateInput("wrapS", Sdf.ValueTypeNames.Token).Set("repeat")
    t.CreateInput("wrapT", Sdf.ValueTypeNames.Token).Set("repeat")
    t.CreateInput("sourceColorSpace", Sdf.ValueTypeNames.Token).Set(colour_space)
    if scale is not None:
        t.CreateInput("scale", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(*scale))
    if bias is not None:
        t.CreateInput("bias", Sdf.ValueTypeNames.Float4).Set(Gf.Vec4f(*bias))
    return t


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("parts_dir")
    ap.add_argument("materials")
    ap.add_argument("out")
    ap.add_argument("--texture-px", type=int, default=1024)
    a = ap.parse_args()

    mats = c.load_materials(a.materials)
    parts = c.load_parts(a.parts_dir)
    warnings = []
    tmp = tempfile.mkdtemp(prefix="w3d-usd-")
    try:
        os.makedirs(os.path.join(tmp, "textures"))
        usda = os.path.join(tmp, "model.usdc")  # binary crate: several times smaller than text
        stage = Usd.Stage.CreateNew(usda)
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
        UsdGeom.SetStageMetersPerUnit(stage, 1.0)
        root = UsdGeom.Xform.Define(stage, "/Model")
        stage.SetDefaultPrim(root.GetPrim())
        cache = {}
        files = {}  # id(image) -> relative asset path, so a shared texture is written once
        resolved, _inh, _miss = c.resolve_materials(mats, parts.keys(), [])  # the GLB step already reported them
        for pid, m in parts.items():
            spec = c.normalise_spec(pid, resolved.get(pid) or c.GREY, warnings)
            imgs, tile, source = texture_set_for(spec, a.texture_px, a.materials, cache, warnings, pid)
            uv = None
            if imgs is not None:
                uv = c.planar_uv(m, tiles_per_metre=1.0 / max(0.001, float(tile) / 100.0))  # unmerges: 1 vertex per corner
            mesh = UsdGeom.Mesh.Define(stage, f"/Model/{pid}")
            mesh.CreatePointsAttr([Gf.Vec3f(*map(float, v)) for v in m.vertices])
            mesh.CreateFaceVertexCountsAttr([3] * len(m.faces))
            mesh.CreateFaceVertexIndicesAttr([int(i) for f in m.faces for i in f])
            mesh.CreateSubdivisionSchemeAttr("none")
            mat_path = f"/Model/Materials/{pid}"
            mat = UsdShade.Material.Define(stage, mat_path)
            sh = UsdShade.Shader.Define(stage, f"{mat_path}/Surface")
            sh.CreateIdAttr("UsdPreviewSurface")
            sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(float(spec["metallic"]))
            rough = float(spec["roughness"])
            if imgs is None:
                sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*spec["color"]))
                sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(rough)
            else:
                UsdGeom.PrimvarsAPI(mesh.GetPrim()).CreatePrimvar("st", Sdf.ValueTypeNames.TexCoord2fArray, UsdGeom.Tokens.vertex).Set(
                    [Gf.Vec2f(float(u), float(v)) for u, v in uv])
                reader = UsdShade.Shader.Define(stage, f"{mat_path}/stReader")
                reader.CreateIdAttr("UsdPrimvarReader_float2")
                reader.CreateInput("varname", Sdf.ValueTypeNames.Token).Set("st")
                st_out = reader.CreateOutput("result", Sdf.ValueTypeNames.Float2)

                def rel(kind, img):
                    key = id(img)
                    if key not in files:
                        files[key] = "textures/" + save_image(img, os.path.join(tmp, "textures", "t%d_%s" % (len(files), kind)))
                    return files[key]
                alb = texture_node(stage, mat_path, "albedo", rel("albedo", imgs["albedo"]), st_out, "sRGB")
                sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).ConnectToSource(alb.CreateOutput("rgb", Sdf.ValueTypeNames.Float3))
                if imgs.get("normal") is not None:
                    nrm = texture_node(stage, mat_path, "normal", rel("normal", imgs["normal"]), st_out, "raw", (2, 2, 2, 1), (-1, -1, -1, 0))
                    sh.CreateInput("normal", Sdf.ValueTypeNames.Normal3f).ConnectToSource(nrm.CreateOutput("rgb", Sdf.ValueTypeNames.Float3))
                if imgs.get("mr") is not None:
                    f = 1.0 if source == "library" else min(1.0, rough / 0.85)
                    mr = texture_node(stage, mat_path, "roughness", rel("mr", imgs["mr"]), st_out, "raw", (f, f, f, 1), (0, 0, 0, 0))
                    sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).ConnectToSource(mr.CreateOutput("g", Sdf.ValueTypeNames.Float))
                else:
                    sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(rough)
            if spec.get("emissive"):
                sh.CreateInput("emissiveColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*spec["emissive"]))
            if float(spec.get("opacity", 1.0)) < 1.0:
                sh.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(float(spec["opacity"]))
            mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(mat)
        stage.GetRootLayer().Save()
        if os.path.exists(a.out):
            os.remove(a.out)
        if not UsdUtils.CreateNewUsdzPackage(usda, a.out):
            raise c.W3DError("Không đóng gói được USDZ.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    c.emit({"ok": True, "bytes": os.path.getsize(a.out), "textures": len(files), "warnings": warnings})


if __name__ == "__main__":
    c.run_main(main)
