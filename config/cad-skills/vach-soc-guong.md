keywords: sọc, soc, xen kẽ, xen ke, gương, guong, inox sọc, vách, vach, tấm vách, panel
# Vách ốp xen kẽ tấm sọc và tấm gương
Mỗi tấm là một bộ phận với id riêng theo kiểu `vach_trai_1`, `vach_trai_2`… để vật liệu xen kẽ (lẻ = sọc xước, chẵn = gương). Dùng split_panels của khung xương để tổng bề rộng tấm và khe đúng bằng chiều dài vách; không tự cộng tay.
```python
def striped_wall(parts, prefix, length, height, thick, count, gap, x, y0, along="y"):
    pw = split_panels(length, count, gap)
    for i in range(count):
        off = y0 + pw / 2 + i * (pw + gap)
        if along == "y":
            parts[f"{prefix}_{i + 1}"] = box(thick, pw, height, x=x, y=off)
        else:
            parts[f"{prefix}_{i + 1}"] = box(pw, thick, height, x=off, y=x)
# TEST-WALL: striped_wall
```
Gán vật liệu: tấm lẻ texture hairline/brushed theo màu của brief, tấm chẵn gương (roughness 0.02, không texture). Đừng làm họa tiết sọc bằng hình học: sọc nhỏ hơn 1 mm là việc của texture.
