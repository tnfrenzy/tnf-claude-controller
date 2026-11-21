keywords: trần, tran, ceiling, đèn, den, downlight, ô trần, o tran, hộp đèn
# Trần có ô đèn và đèn downlight
Trần là tấm phẳng; đèn âm là các lỗ tròn cắt xuyên rồi thêm đĩa phát sáng (id riêng, vật liệu emissive). Ô đèn giữa là tấm lõm ít mm. Cắt lỗ bằng trụ nhỏ hơn dày tấm một chút để không thủng.
```python
def ceiling_with_lights(w, d, thick, light_r, positions, panel_w=0, panel_d=0, panel_depth=0):
    plate = cq.Workplane("XY").box(w, d, thick, centered=(True, True, False))
    for (x, y) in positions:
        plate = plate.cut(cq.Workplane("XY").center(x, y).circle(light_r).extrude(thick))
    if panel_w and panel_d and panel_depth:
        plate = plate.cut(cq.Workplane("XY").rect(panel_w, panel_d).extrude(panel_depth).translate((0, 0, thick - panel_depth)))
    return plate


def light_discs(positions, light_r, thick):
    out = None
    for (x, y) in positions:
        disc = cq.Workplane("XY").center(x, y).circle(light_r * 0.85).extrude(thick * 0.5)
        out = disc if out is None else out.union(disc)
    return out
# TEST: ceiling_with_lights(1300, 1600, 10, 40, [(-400, -500), (400, -500), (-400, 500), (400, 500)], 600, 800, 4)
# TEST: light_discs([(0, 0), (100, 0)], 40, 10)
```
Mỗi đèn phải có emissive trong vật liệu, và chỉ đèn mới có emissive.
