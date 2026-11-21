keywords: sàn, san, hoa văn, hoa van, sao, ngôi sao, thoi, đá ghép, da ghep, inlay, mosaic, vòng tròn, vong tron
# Sàn đá ghép hoa văn (ngôi sao, vòng tròn, viền thoi)
Mỗi màu đá là một bộ phận riêng (id riêng) để gán vật liệu khác nhau: nền, ngôi sao, vòng viền, viền thoi. Các miếng nằm cùng mặt phẳng, dày bằng nhau, không chồng lên nhau.
```python
def star_points(n, r_out, r_in):
    pts = []
    for i in range(2 * n):
        r = r_out if i % 2 == 0 else r_in
        a = math.pi * i / n
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def star_inlay(n, r_out, r_in, thick):
    return cq.Workplane("XY").polyline(star_points(n, r_out, r_in)).close().extrude(thick)


def ring_inlay(r_out, r_in, thick):
    return cq.Workplane("XY").circle(r_out).circle(r_in).extrude(thick)


def diamond_border(length, size, thick, gap=1.0):
    # hàng thoi dọc theo trục X (xoay 45 độ), một khối union để gọn script
    step = size * 1.414 + gap
    count = max(1, int(length // step))
    out = None
    for i in range(count):
        d = cq.Workplane("XY").rect(size, size).extrude(thick).rotate((0, 0, 0), (0, 0, 1), 45).translate((-length / 2 + step * (i + 0.5), 0, 0))
        out = d if out is None else out.union(d)
    return out
# TEST: star_inlay(12, 250, 120, 8)
# TEST: ring_inlay(300, 280, 8)
# TEST: diamond_border(600, 30, 8)
```
Nền sàn: một hộp phẳng, rồi `cut` phần ngôi sao/vòng khỏi nền để chúng không chồng thể tích. Tên id gợi ý: san_nen, san_sao, san_vong, san_thoi.
