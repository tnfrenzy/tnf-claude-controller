keywords: tôn nhám, ton nham, chống trượt, chong truot, diamond, caro, gân, gan, sàn tôn
# Sàn tôn gân chống trượt (thang tải hàng)
KHÔNG dựng hàng nghìn gân bằng hình học: script chậm, STEP nặng, dễ vượt giới hạn thời gian. Làm sàn là một tấm phẳng và để vật liệu texture.kind = diamond_plate (scale 8) tạo gân. Chỉ khi cần cận cảnh mới thêm vài chục gân thật.
```python
def tread_plate(w, d, thick, lug_l=24.0, lug_w=6.0, lug_h=1.5, pitch=30.0, max_lugs=60):
    plate = cq.Workplane("XY").box(w, d, thick, centered=(True, True, False))
    n = 0
    lugs = None
    x = -w / 2 + pitch
    while x < w / 2 - pitch and n < max_lugs:
        lug = cq.Workplane("XY").rect(lug_l, lug_w).extrude(lug_h).rotate((0, 0, 0), (0, 0, 1), 45 if n % 2 == 0 else -45).translate((x, 0, thick))
        lugs = lug if lugs is None else lugs.union(lug)
        n += 1
        x += pitch
    return plate if lugs is None else plate.union(lugs)
# TEST: tread_plate(600, 400, 4)
```
