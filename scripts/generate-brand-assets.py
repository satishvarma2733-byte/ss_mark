"""Derives web and native brand assets from the owner-supplied logo files in references/brand/logo/.

The source files are used as supplied: never recoloured, redrawn or cropped into a new mark. Generated files are written
to apps/web and apps/mobile and are reproducible. Run from build-kit/:

    python -I scripts/generate-brand-assets.py

Requires Pillow. Source resolution is limited (monogram 300x433 px), so icons are upscaled with Lanczos resampling;
replace the sources with vector or >=1024 px masters when available and re-run this script.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "references" / "brand" / "logo"
WEB = ROOT / "apps" / "web"
MOBILE = ROOT / "apps" / "mobile" / "assets"

# Exact colours sampled from the supplied logo files (not the UI tokens): olive #373822, cream #F5F1E5.
LOGO_CREAM = (0xF5, 0xF1, 0xE5, 255)


def load(name: str) -> Image.Image:
    return Image.open(SRC / name).convert("RGBA")


def fit(mark: Image.Image, max_w: int, max_h: int) -> Image.Image:
    scale = min(max_w / mark.width, max_h / mark.height)
    size = (max(1, round(mark.width * scale)), max(1, round(mark.height * scale)))
    return mark.resize(size, Image.Resampling.LANCZOS)


def on_canvas(mark: Image.Image, size: int, mark_h: int, background=(0, 0, 0, 0)) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background)
    scaled = fit(mark, size, mark_h)
    canvas.alpha_composite(scaled, ((size - scaled.width) // 2, (size - scaled.height) // 2))
    return canvas


def single_colour(mark: Image.Image, rgb: tuple[int, int, int]) -> Image.Image:
    # Same shape, one colour, alpha preserved: used only for Android's system-tinted monochrome icon.
    solid = Image.new("RGBA", mark.size, (*rgb, 255))
    solid.putalpha(mark.getchannel("A"))
    return solid


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    print(f"wrote {path.relative_to(ROOT)} {image.size[0]}x{image.size[1]}")


def main() -> None:
    mono_olive = load("monogram-olive.png")
    mono_cream = load("monogram-cream.png")
    lockup_olive = load("lockup-olive.png")
    lockup_cream = load("lockup-cream.png")

    # Web: in-page marks are the supplied files as-is; favicons use the olive monogram on logo cream.
    for name, image in {
        "monogram-olive.png": mono_olive,
        "monogram-cream.png": mono_cream,
        "lockup-olive.png": lockup_olive,
        "lockup-cream.png": lockup_cream,
    }.items():
        save(image, WEB / "public" / "brand" / name)
    save(on_canvas(mono_olive, 192, 150, LOGO_CREAM), WEB / "app" / "icon.png")
    save(on_canvas(mono_olive, 180, 136, LOGO_CREAM), WEB / "app" / "apple-icon.png")

    # Native app icons. iOS/legacy icon: full square, olive monogram on logo cream.
    save(on_canvas(mono_olive, 1024, 640, LOGO_CREAM), MOBILE / "icon.png")
    # Android adaptive icon: transparent foreground kept inside the 66/108 safe zone (circle of ~633 px at 1024).
    save(on_canvas(mono_olive, 1024, 520), MOBILE / "adaptive-icon.png")
    save(on_canvas(single_colour(mono_olive, (255, 255, 255)), 1024, 520), MOBILE / "monochrome-icon.png")
    # Splash: monogram only (the lockup's tagline would be unreadable at splash size).
    save(fit(mono_olive, 600, 600), MOBILE / "splash-icon.png")
    # In-app marks.
    save(lockup_olive, MOBILE / "brand" / "lockup-olive.png")
    save(mono_olive, MOBILE / "brand" / "monogram-olive.png")


if __name__ == "__main__":
    main()
