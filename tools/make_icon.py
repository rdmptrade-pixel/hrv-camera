"""Рисует иконки приложения 192×192 и 512×512 (PNG) без сторонних библиотек.

Тёмный круг, внутри красное сердце. Запуск: python3 tools/make_icon.py
Результат: icons/icon-192.png, icons/icon-512.png
"""
import struct
import zlib
from pathlib import Path

SIZES = [192, 512]
OUT_DIR = Path(__file__).resolve().parent.parent / "icons"
SIZE = 192

BG = (31, 31, 31, 255)       # тёмный круг
HEART = (229, 57, 53, 255)   # красное сердце
EMPTY = (0, 0, 0, 0)         # прозрачный фон за кругом


def pixel(px: int, py: int) -> tuple:
    # Координаты относительно центра, ось y вверх
    cx = (px + 0.5) / SIZE * 2 - 1
    cy = 1 - (py + 0.5) / SIZE * 2
    if cx * cx + cy * cy > 1:
        return EMPTY
    # Классическая кривая сердца: (x²+y²−1)³ − x²·y³ ≤ 0, масштаб под круг
    x, y = cx / 0.62, (cy + 0.08) / 0.62
    if (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0:
        return HEART
    return BG


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def render(out: Path) -> None:
    rows = bytearray()
    for py in range(SIZE):
        rows.append(0)  # фильтр строки: без фильтра
        for px in range(SIZE):
            rows.extend(pixel(px, py))
    header = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)  # 8 бит, RGBA
    data = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + png_chunk(b"IEND", b"")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)
    print(f"Иконка записана: {out} ({len(data)} байт)")


def main() -> None:
    global SIZE
    for SIZE in SIZES:
        render(OUT_DIR / f"icon-{SIZE}.png")


if __name__ == "__main__":
    main()
