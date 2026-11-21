keywords: vòm, vom, arch, cột, cot, column, ionic, cổng, cong
# Vòm cổng và cột (khung trang trí vách hậu)
Dải khung vòm: thanh dọc hai bên + nửa vòng tròn trên, dựng bằng hiệu hai hình (ngoài trừ trong) rồi đùn mỏng. Cột có chân và đầu cột là hộp/trụ chồng nhau; thân cột có rãnh bằng cách cắt các trụ nhỏ. Mọi số đo lấy từ PARAMS.
```python
def arch_frame(width, height, band, depth):
    # width: bề rộng ngoài của vòm; height: tổng cao tính cả nửa vòng; band: bề dày dải khung; depth: độ nổi
    r = width / 2.0
    straight = height - r
    outer = (cq.Workplane("XZ").moveTo(-r, 0).lineTo(-r, straight).threePointArc((0, straight + r), (r, straight)).lineTo(r, 0).close().extrude(depth))
    ri = r - band
    inner = (cq.Workplane("XZ").moveTo(-ri, -1).lineTo(-ri, straight).threePointArc((0, straight + ri), (ri, straight)).lineTo(ri, -1).close().extrude(depth))
    return outer.cut(inner)


def fluted_column(radius, height, flutes=8, flute_r=3.0, depth=3.0):
    col = cq.Workplane("XY").circle(radius).extrude(height)
    for i in range(flutes):
        a = 2 * math.pi * i / flutes
        cutter = cq.Workplane("XY").center(math.cos(a) * radius, math.sin(a) * radius).circle(flute_r).extrude(height)
        col = col.cut(cutter)
    return col


def column_with_capital(radius, height, base_h, cap_h):
    shaft = fluted_column(radius * 0.9, height - base_h - cap_h).translate((0, 0, base_h))
    base = cq.Workplane("XY").circle(radius * 1.15).extrude(base_h)
    cap = cq.Workplane("XY").circle(radius * 1.2).extrude(cap_h).translate((0, 0, height - cap_h))
    return base.union(shaft).union(cap)
# TEST: arch_frame(500, 1500, 40, 10)
# TEST: column_with_capital(30, 1200, 40, 60)
```
Lưu ý: arch_frame nằm trong mặt phẳng XZ và đùn theo -Y; đặt vào vách bằng translate/rotate rồi kiểm khối bao. Dùng một id bộ phận cho cả khung vòm (union), không tách từng thanh.
