#!/usr/bin/env python3
import sys
import os
import tempfile
import shutil

try:
    from PIL import Image
except ImportError:
    print("ERROR:PIL_NOT_INSTALLED")
    sys.exit(1)


def generate_thumbnail(input_path: str, output_path: str, width: int = 400) -> bool:
    ext = os.path.splitext(input_path)[1].lower()

    try:
        if ext == ".pdf":
            return _pdf_to_thumbnail(input_path, output_path, width)
        elif ext in [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]:
            return _image_to_thumbnail(input_path, output_path, width)
        elif ext in [".doc", ".docx", ".odt", ".xls", ".xlsx", ".ppt", ".pptx"]:
            return _office_to_thumbnail(input_path, output_path, width)
        else:
            return False
    except Exception:
        return False


def _pdf_to_thumbnail(input_path: str, output_path: str, width: int) -> bool:
    import subprocess
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            result = subprocess.run(
                ["pdftoppm", "-r", "150", "-f", "1", "-l", "1",
                 "-png", "-singlefile", "-r", "150",
                 input_path, os.path.join(tmpdir, "thumb")],
                capture_output=True, timeout=30
            )
            thumb_path = os.path.join(tmpdir, "thumb-1.png")
            if result.returncode == 0 and os.path.exists(thumb_path):
                _resize_image(thumb_path, output_path, width)
                return True
            return False
    except Exception:
        return False


def _image_to_thumbnail(input_path: str, output_path: str, width: int) -> bool:
    try:
        _resize_image(input_path, output_path, width)
        return True
    except Exception:
        return False


def _office_to_thumbnail(input_path: str, output_path: str, width: int) -> bool:
    import subprocess
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            basename = os.path.splitext(os.path.basename(input_path))[0]
            pdf_path = os.path.join(tmpdir, basename + ".pdf")

            result = subprocess.run(
                ["libreoffice", "--headless", "--convert-to", "pdf",
                 "--outdir", tmpdir, input_path],
                capture_output=True, timeout=60
            )
            if result.returncode != 0:
                return False

            pdf_files = [f for f in os.listdir(tmpdir) if f.endswith(".pdf")]
            if not pdf_files:
                return False

            pdf_full = os.path.join(tmpdir, pdf_files[0])
            return _pdf_to_thumbnail(pdf_full, output_path, width)
    except Exception:
        return False


def _resize_image(input_path: str, output_path: str, width: int) -> None:
    with Image.open(input_path) as img:
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        ratio = width / img.width
        new_height = int(img.height * ratio)
        img = img.resize((width, new_height), Image.LANCZOS)
        img.save(output_path, "PNG", quality=85)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: generate_thumbnail.py <input> <output>")
        sys.exit(1)
    success = generate_thumbnail(sys.argv[1], sys.argv[2])
    sys.exit(0 if success else 1)
