# Mô hình 3D cabin thang máy chở khách

Script tham số CadQuery: `cabin.py`. Đơn vị: **mm**. Thông số gốc: `notes/cabin-spec.md`.

## Cách chạy

Cài cadquery trong môi trường ảo (venv) của thư mục này, không cài toàn cục:

```
python -m venv .venv
.venv\Scripts\activate
pip install cadquery
python models/elevator-cabin/cabin.py
```

Trên Linux/macOS, thay dòng thứ hai bằng `source .venv/bin/activate`.

Thư mục xuất: đối số dòng lệnh đầu tiên, hoặc biến môi trường `OUTPUT_DIR`, mặc định `models/elevator-cabin/outputs/`.

File xuất:
- `elevator_cabin.step`: assembly, giữ tên bộ phận và màu. Đơn vị **mm**.
- `elevator_cabin.stl`: một lưới gộp mọi bộ phận, không có màu. Đơn vị **mm**. Các bộ phận chỉ đặt sát nhau, không hợp khối, nên file này **không phải một khối kín duy nhất**. Đừng dùng file này cho in 3D hay tính thể tích.
- `parts/elevator_cabin_<bộ phận>.stl`: mỗi bộ phận một file STL, mỗi file là một khối kín. Đơn vị **mm**.
- `elevator_cabin.glb`: glTF nhị phân, có màu. Đơn vị **mét**, vì glTF quy định đơn vị là mét. Script thu nhỏ mọi bộ phận theo hệ số `GLB_SCALE = 0.001` trước khi xuất GLB. Khi mở trong trình xem, cabin có kích thước bao khoảng 1,15 x 1,45 x 2,4 m. Nếu cabin hiện to gấp 1000 lần hoặc nhỏ đi 1000 lần, có thể phiên bản CadQuery đã tự đổi đơn vị. Khi đó hãy đặt `GLB_SCALE = 1.0` rồi chạy lại.

STL và GLB dùng cùng độ mịn lưới: `STL_TOLERANCE` = 0,5 mm và `STL_ANGULAR_TOLERANCE` = 0,2 rad. Với GLB, sai số tuyến tính được nhân thêm `GLB_SCALE` để khớp đơn vị mét.

Script chưa được chạy thử. Hãy mở file xuất để kiểm tra trước khi dùng.

## Hệ tọa độ

Gốc tọa độ là góc trước bên trái của khoảng thông thủy, nằm trên mặt sàn hoàn thiện. +X hướng từ trái sang phải, +Y từ cửa vào vách sau, +Z hướng lên. Khoảng thông thủy là X 0..1100, Y 0..1400, Z 0..2300.

## Thông số người dùng đã cho

Thông thủy rộng 1100, sâu 1400, cao 2300. Vách bằng Inox Sọc Nhuyễn. Cabin chở khách.

## Giả định (cần người dùng xác nhận)

- Vách dày 25, sàn dày 50, trần dày 50.
- Cửa mở giữa, 2 cánh, lỗ cửa 800 x 2100. Cánh dày 30, mỗi cánh chèn 25 sau vách trước, cách vách 10. Mô hình vẽ cửa ở trạng thái đóng; tham số `DOOR_OPEN_FRACTION` đặt từ 0 đến 1 để mở cửa. Cửa dùng cùng vật liệu inox với vách.
- Ngưỡng cửa 900 x 75 x 50. Chiều dài ngưỡng bằng bề rộng lỗ cửa cộng 100 (`SILL_EXTRA_WIDTH`).
- Tay vịn chỉ có ở vách sau: ống D38, mép trên cao 900, cách vách 50. Mỗi đầu ống cách vách bên 100 (`HANDRAIL_END_MARGIN`), nên ống dài 900. Ống gắn bằng 2 chân đế D25, mỗi chân cách đầu ống 100 (`HANDRAIL_BRACKET_INSET`), tức tại X = 200 và X = 900. Mỗi chân đế chạy từ tâm ống tới mặt vách sau, dài 69, nên cắm vào trong ống.
- Vân sọc inox chạy theo phương đứng. Mô hình chỉ thể hiện bằng màu, không dựng vân.
- Chưa có thông tin: tải trọng, vật liệu sàn, trần, đèn và ngưỡng cửa. Các bộ phận này tạm tô màu xám.
- Không dựng ray và cơ cấu cửa, đèn, quạt, bảng gọi tầng (COP).
