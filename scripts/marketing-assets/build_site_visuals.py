#!/usr/bin/env python3

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Iterable

import cv2
from PIL import Image, ImageChops, ImageColor, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
MEDIA_ROOT = ROOT / "apps/site/public/media"
SOURCE_ROOT = MEDIA_ROOT / "source"
DEMO_RUG_ROOT = SOURCE_ROOT / "demo-rugs"


def ensure_dirs() -> None:
    for dirname in ["hero", "inventory", "product", "process", "video", "source"]:
        (MEDIA_ROOT / dirname).mkdir(parents=True, exist_ok=True)


def load_font(size: int, serif: bool = False, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates: list[str] = []
    if serif:
        if bold:
            candidates += [
                "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
                "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
            ]
        else:
            candidates += [
                "/System/Library/Fonts/Supplemental/Georgia.ttf",
                "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
            ]
    else:
        if bold:
            candidates += [
                "/System/Library/Fonts/Supplemental/Avenir Next Bold.ttf",
                "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                "/System/Library/Fonts/Supplemental/Helvetica.ttc",
            ]
        else:
            candidates += [
                "/System/Library/Fonts/Supplemental/Avenir Next.ttc",
                "/System/Library/Fonts/Supplemental/Arial.ttf",
                "/System/Library/Fonts/Supplemental/Helvetica.ttc",
            ]

    for candidate in candidates:
        if Path(candidate).exists():
            try:
                return ImageFont.truetype(candidate, size=size)
            except Exception:
                continue

    return ImageFont.load_default()


FONT_UI_SM = load_font(24)
FONT_UI_MD = load_font(28)
FONT_UI_LG = load_font(34, bold=True)
FONT_UI_XL = load_font(44, bold=True)
FONT_SERIF_MD = load_font(44, serif=True)
FONT_SERIF_LG = load_font(66, serif=True, bold=True)
FONT_SERIF_XL = load_font(88, serif=True, bold=True)


PALETTE = {
    "bg": "#f5efe6",
    "paper": "#fffaf3",
    "paper_2": "#fbf3e7",
    "ink": "#2e241b",
    "muted": "#7a6651",
    "line": "#e5d8c5",
    "gold": "#c9a14a",
    "gold_soft": "#edd9aa",
    "brown": "#4b3523",
    "green": "#2e7c61",
    "red": "#b94f43",
}


def rounded_rect_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0], size[1]), radius=radius, fill=255)
    return mask


def add_shadow(base: Image.Image, offset: tuple[int, int] = (0, 18), blur: int = 28, color: str = "#6e553d33") -> Image.Image:
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    alpha = base.split()[-1] if base.mode == "RGBA" else Image.new("L", base.size, 255)
    rgba = ImageColor.getcolor(color, "RGBA")
    colored = Image.new("RGBA", base.size, rgba)
    colored.putalpha(alpha)
    shadow.alpha_composite(colored, dest=(0, 0))
    shadow = shadow.filter(ImageFilter.GaussianBlur(blur))
    canvas = Image.new("RGBA", (base.width + abs(offset[0]) * 2, base.height + abs(offset[1]) * 2), (0, 0, 0, 0))
    canvas.alpha_composite(shadow, dest=(abs(offset[0]), abs(offset[1])))
    canvas.alpha_composite(base, dest=(0, 0))
    return canvas


def save_webp(img: Image.Image, path: Path, quality: int = 92) -> None:
    img.convert("RGB").save(path, format="WEBP", quality=quality, method=6)


def open_image(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def cover_crop(path: Path, size: tuple[int, int]) -> Image.Image:
    img = Image.open(path).convert("RGB")
    return ImageOps.fit(img, size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5)).convert("RGBA")


def draw_text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font: ImageFont.ImageFont, fill: str) -> None:
    draw.text(xy, text, font=font, fill=fill)


def multiline(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, font: ImageFont.ImageFont, fill: str, spacing: int = 8) -> None:
    draw.multiline_text(xy, text, font=font, fill=fill, spacing=spacing)


def resize_contain(img: Image.Image, size: tuple[int, int]) -> Image.Image:
    out = img.copy()
    out.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    x = (size[0] - out.width) // 2
    y = (size[1] - out.height) // 2
    canvas.alpha_composite(out, (x, y))
    return canvas


def crop_panel(img: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    return img.crop(box).convert("RGBA")


def load_demo_metadata() -> list[dict]:
    data = json.loads((DEMO_RUG_ROOT / "metadata.json").read_text())
    return data


def file_for_rug(item: dict) -> Path:
    return DEMO_RUG_ROOT / item["localFile"]


def truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 1].rsplit(" ", 1)[0] + "…"


def inches_to_label(width_total_in: int | None, length_total_in: int | None) -> str:
    def fmt(value: int | None) -> str:
        if not value:
            return "?"
        feet = value // 12
        inches = value % 12
        return f"{feet}'{inches}\"" if inches else f"{feet}'"

    return f"{fmt(width_total_in)} × {fmt(length_total_in)}"


def create_screen_bg(size: tuple[int, int], left_glow: bool = True) -> Image.Image:
    img = Image.new("RGBA", size, PALETTE["bg"])
    draw = ImageDraw.Draw(img)
    for y in range(size[1]):
        blend = y / max(size[1] - 1, 1)
        tone = (
            int(245 - 7 * blend),
            int(239 - 6 * blend),
            int(230 - 3 * blend),
            255,
        )
        draw.line((0, y, size[0], y), fill=tone)

    glow = Image.new("RGBA", size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    if left_glow:
        glow_draw.ellipse((-240, -140, 540, 540), fill=(255, 251, 242, 120))
        glow_draw.ellipse((size[0] - 440, -80, size[0] + 180, 520), fill=(236, 219, 178, 90))
    else:
        glow_draw.ellipse((size[0] - 440, -80, size[0] + 180, 520), fill=(236, 219, 178, 90))
    return Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(90)))


def draw_chip(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fill: str, text_fill: str, padding: tuple[int, int] = (18, 12)) -> tuple[int, int]:
    bbox = draw.textbbox((0, 0), text, font=FONT_UI_SM)
    width = bbox[2] - bbox[0] + padding[0] * 2
    height = bbox[3] - bbox[1] + padding[1] * 2
    x, y = xy
    draw.rounded_rectangle((x, y, x + width, y + height), radius=height // 2, fill=fill)
    draw.text((x + padding[0], y + padding[1] - 2), text, font=FONT_UI_SM, fill=text_fill)
    return width, height


def device_frame(inner: Image.Image, size: tuple[int, int], radius: int = 42) -> Image.Image:
    frame = Image.new("RGBA", size, (35, 28, 22, 255))
    screen = Image.new("RGBA", (size[0] - 50, size[1] - 58), PALETTE["paper"])
    screen_mask = rounded_rect_mask(screen.size, radius - 12)
    screen.putalpha(screen_mask)
    fitted = ImageOps.fit(inner.convert("RGBA"), screen.size, method=Image.Resampling.LANCZOS)
    screen.alpha_composite(fitted, (0, 0))
    mask = rounded_rect_mask(size, radius)
    frame.putalpha(mask)
    composed = Image.new("RGBA", size, (0, 0, 0, 0))
    composed.alpha_composite(frame)
    composed.alpha_composite(screen, (25, 29))
    cam = Image.new("RGBA", (84, 10), (22, 18, 15, 255))
    cam.putalpha(rounded_rect_mask(cam.size, 6))
    composed.alpha_composite(cam, ((size[0] - cam.width) // 2, 11))
    return add_shadow(composed, offset=(0, 18), blur=34, color="#6c52353b")


def rug_card(item: dict, size: tuple[int, int], show_heart: bool = False, heart_filled: bool = False) -> Image.Image:
    card = Image.new("RGBA", size, PALETTE["paper"])
    card.putalpha(rounded_rect_mask(size, 30))
    draw = ImageDraw.Draw(card)
    img = cover_crop(file_for_rug(item), (size[0] - 28, int(size[1] * 0.58)))
    img.putalpha(rounded_rect_mask(img.size, 24))
    card.alpha_composite(img, (14, 14))
    y = img.height + 26
    title = truncate(item["intake_label"], 25)
    draw.text((20, y), title, font=FONT_UI_MD, fill=PALETTE["ink"])
    y += 38
    colors = ", ".join(item.get("ai_structured_fields", {}).get("primary_colors", [])[:3]).title()
    draw.text((20, y), colors or "Persian selection", font=FONT_UI_SM, fill=PALETTE["muted"])
    y += 34
    draw.text((20, y), inches_to_label(item.get("width_total_in"), item.get("length_total_in")), font=FONT_UI_SM, fill=PALETTE["muted"])
    if show_heart:
        heart_fill = PALETTE["gold"] if heart_filled else PALETTE["paper"]
        heart_text = PALETTE["paper"] if heart_filled else PALETTE["muted"]
        draw.rounded_rectangle((size[0] - 80, 20, size[0] - 20, 76), radius=24, fill=heart_fill, outline=PALETTE["line"], width=2)
        draw.text((size[0] - 63, 28), "♥" if heart_filled else "♡", font=FONT_UI_LG, fill=heart_text)
    return add_shadow(card, offset=(0, 12), blur=20, color="#7a604022")


def patch_brand_bar(img: Image.Image, brand: str) -> Image.Image:
    out = img.copy()
    draw = ImageDraw.Draw(out)
    draw.rounded_rectangle((24, 20, 356, 96), radius=24, fill=(250, 245, 237, 235), outline=(229, 216, 197, 255), width=2)
    draw.ellipse((42, 34, 86, 78), fill=(242, 231, 214, 255))
    draw.text((102, 35), brand, font=FONT_UI_MD, fill=PALETTE["ink"])
    return out


def overlay_center_brand(img: Image.Image, brand: str) -> Image.Image:
    out = img.copy()
    draw = ImageDraw.Draw(out)
    w, h = out.size
    box_w, box_h = 360, 70
    x = (w - box_w) // 2
    y = 174
    draw.rounded_rectangle((x, y, x + box_w, y + box_h), radius=24, fill=(255, 250, 243, 235))
    draw.text((x + 36, y + 16), brand, font=FONT_UI_MD, fill=PALETTE["ink"])
    inner_x = (w - 420) // 2
    draw.rounded_rectangle((inner_x, 552, inner_x + 420, 620), radius=22, fill=(255, 250, 243, 238))
    draw.text((inner_x + 40, 568), brand, font=FONT_UI_MD, fill=PALETTE["ink"])
    return out


def make_product_capture_assets(metadata: list[dict]) -> dict[str, Image.Image]:
    attract = open_image(SOURCE_ROOT / "explore-concierge.png")
    active = open_image(SOURCE_ROOT / "explore-active-chat.png")
    intake = open_image(SOURCE_ROOT / "explore-intake.png")
    browse = crop_panel(active, (112, 52, 1328, 1420))
    intake_panel = crop_panel(intake, (76, 42, 1210, 904))
    attract_panel = crop_panel(overlay_center_brand(attract, "Rugdesk Studio"), (128, 118, 1172, 1120))

    return {
        "attract": attract_panel,
        "browse": browse,
        "intake": intake_panel,
    }


def make_search_results_asset(metadata: list[dict]) -> Image.Image:
    canvas = Image.new("RGBA", (1240, 980), PALETTE["paper"])
    canvas.putalpha(rounded_rect_mask(canvas.size, 38))
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle((36, 28, 372, 88), radius=28, fill="#f5ece0")
    draw.text((58, 42), "Rugdesk Studio", font=FONT_UI_MD, fill=PALETTE["ink"])
    draw.text((36, 120), "Blue and cream Persian rugs", font=FONT_SERIF_MD, fill=PALETTE["ink"])
    draw.text((36, 182), "Natural conversation, visual results, and easy comparison on the showroom floor.", font=FONT_UI_SM, fill=PALETTE["muted"])

    positions = [(64, 260), (454, 260)]
    for idx, item in enumerate([metadata[2], metadata[6]]):
        card = rug_card(item, (360, 600), show_heart=True, heart_filled=idx == 1)
        canvas.alpha_composite(card, positions[idx])
    preview = Image.new("RGBA", (300, 220), "#fbf3e7")
    preview.putalpha(rounded_rect_mask(preview.size, 26))
    pdraw = ImageDraw.Draw(preview)
    pdraw.text((24, 24), "Customer asks", font=FONT_UI_SM, fill=PALETTE["muted"])
    multiline(pdraw, (24, 62), "\"Show me something elegant\nfor a formal living room.\"", FONT_UI_MD, PALETTE["ink"], spacing=6)
    canvas.alpha_composite(add_shadow(preview, offset=(0, 10), blur=20, color="#6a51353b"), (860, 334))
    return canvas


def make_inventory_before_after(metadata: list[dict]) -> tuple[Image.Image, Image.Image]:
    source = open_image(file_for_rug(metadata[0]))
    before = Image.new("RGBA", (1500, 1100), PALETTE["bg"])
    draw = ImageDraw.Draw(before)
    draw.rounded_rectangle((90, 90, 1410, 1010), radius=44, fill=PALETTE["paper"])
    draw.text((118, 110), "Before photo", font=FONT_UI_LG, fill=PALETTE["ink"])
    draw.text((118, 164), "Quick phone shot with uneven angle, showroom clutter, and poor framing", font=FONT_UI_SM, fill=PALETTE["muted"])
    tilted = ImageOps.fit(source, (1040, 680), method=Image.Resampling.LANCZOS)
    tilted = tilted.rotate(-7, resample=Image.Resampling.BICUBIC, expand=True)
    tilted = ImageEnhance.Contrast(tilted).enhance(0.92)
    tilted = ImageEnhance.Color(tilted).enhance(0.96)
    shadow = add_shadow(tilted, offset=(18, 22), blur=26, color="#573f2935")
    before.alpha_composite(shadow, (170, 240))
    draw.rounded_rectangle((998, 780, 1320, 880), radius=26, fill=(255, 250, 243, 245), outline=ImageColor.getrgb(PALETTE["line"]), width=2)
    draw.text((1028, 804), "Framing cut off", font=FONT_UI_SM, fill=PALETTE["ink"])
    draw.text((1028, 842), "Background visible", font=FONT_UI_SM, fill=PALETTE["muted"])

    cleaned = ImageOps.fit(source, (820, 820), method=Image.Resampling.LANCZOS, bleed=0.03)
    cleaned = cleaned.crop((60, 60, 760, 760))
    cleaned = ImageOps.fit(cleaned, (760, 760), method=Image.Resampling.LANCZOS)
    cleaned = ImageEnhance.Color(cleaned).enhance(1.08)
    cleaned = ImageEnhance.Contrast(cleaned).enhance(1.08)
    cleaned = ImageEnhance.Sharpness(cleaned).enhance(1.18)

    after = Image.new("RGBA", (1500, 1100), PALETTE["bg"])
    draw = ImageDraw.Draw(after)
    draw.rounded_rectangle((90, 90, 1410, 1010), radius=44, fill=PALETTE["paper"])
    draw.text((118, 110), "After enhancement", font=FONT_UI_LG, fill=PALETTE["ink"])
    draw.text((118, 164), "Centered, cleaned, brighter, and ready for customer-facing inventory", font=FONT_UI_SM, fill=PALETTE["muted"])
    panel = Image.new("RGBA", (900, 820), "#fbf6ee")
    panel.putalpha(rounded_rect_mask(panel.size, 34))
    panel.alpha_composite(cleaned, ((panel.width - cleaned.width) // 2, (panel.height - cleaned.height) // 2))
    after.alpha_composite(add_shadow(panel, offset=(0, 18), blur=28, color="#5b473034"), (150, 218))
    draw.rounded_rectangle((1070, 276, 1330, 338), radius=24, fill="#ecf5ef")
    draw.text((1098, 290), "Centered", font=FONT_UI_SM, fill=PALETTE["green"])
    draw.rounded_rectangle((1070, 360, 1330, 422), radius=24, fill="#fff7e6")
    draw.text((1098, 374), "Brighter image", font=FONT_UI_SM, fill="#8b6b2d")
    draw.rounded_rectangle((1070, 444, 1330, 506), radius=24, fill="#f6efe5")
    draw.text((1098, 458), "Background reduced", font=FONT_UI_SM, fill=PALETTE["muted"])
    return before, after


def make_listing_asset(item: dict) -> Image.Image:
    canvas = create_screen_bg((1500, 1100))
    draw = ImageDraw.Draw(canvas)
    draw.text((100, 88), "Inventory ready", font=FONT_SERIF_MD, fill=PALETTE["ink"])
    draw.text((100, 152), "One rug photo becomes a polished listing your team can actually use.", font=FONT_UI_MD, fill=PALETTE["muted"])

    card = Image.new("RGBA", (1260, 760), PALETTE["paper"])
    card.putalpha(rounded_rect_mask(card.size, 42))
    draw_card = ImageDraw.Draw(card)
    art = cover_crop(file_for_rug(item), (420, 560))
    art.putalpha(rounded_rect_mask(art.size, 30))
    card.alpha_composite(art, (46, 96))
    draw_card.text((520, 110), item["intake_label"], font=FONT_SERIF_MD, fill=PALETTE["ink"])
    draw_card.text((520, 178), inches_to_label(item["width_total_in"], item["length_total_in"]), font=FONT_UI_MD, fill=PALETTE["muted"])

    desc = (item["ai_description"] or "").strip()
    if len(desc) > 180:
        desc = desc[:176].rsplit(" ", 1)[0] + "..."
    multiline(draw_card, (520, 250), desc, FONT_UI_SM, PALETTE["ink"], spacing=10)
    chips = item.get("ai_structured_fields", {}).get("primary_colors", [])[:4]
    x = 520
    for chip in chips:
        w, _ = draw_chip(draw_card, (x, 390), chip.title(), "#f5ece0", PALETTE["muted"], padding=(16, 10))
        x += w + 12
    draw_card.rounded_rectangle((520, 470, 1134, 650), radius=28, fill=PALETTE["paper_2"], outline=ImageColor.getrgb(PALETTE["line"]), width=2)
    stats = [
        ("Origin", item.get("ai_structured_fields", {}).get("origin", "Persian")),
        ("Style", item.get("ai_structured_fields", {}).get("style", "Traditional")),
        ("Mood", item.get("ai_structured_fields", {}).get("mood", "Traditional")),
        ("Stock ID", item.get("stock_id", "AUTO-XXXX")),
    ]
    y = 500
    for label, value in stats:
        draw_card.text((554, y), label.upper(), font=FONT_UI_SM, fill=PALETTE["muted"])
        draw_card.text((760, y), str(value), font=FONT_UI_SM, fill=PALETTE["ink"])
        y += 38

    canvas.alpha_composite(add_shadow(card, offset=(0, 20), blur=34, color="#6c52353b"), (120, 240))
    return canvas


def make_detail_asset(item: dict) -> Image.Image:
    canvas = create_screen_bg((1500, 1100))
    shell = Image.new("RGBA", (1320, 820), PALETTE["paper"])
    shell.putalpha(rounded_rect_mask(shell.size, 42))
    draw = ImageDraw.Draw(shell)
    draw_chip(draw, (44, 36), "Available", "#ecf5ef", PALETTE["green"])
    draw.text((44, 108), item["intake_label"], font=FONT_SERIF_MD, fill=PALETTE["ink"])
    draw.text((44, 168), f"Size: {inches_to_label(item['width_total_in'], item['length_total_in'])}", font=FONT_UI_SM, fill=PALETTE["muted"])

    img = cover_crop(file_for_rug(item), (420, 540))
    img.putalpha(rounded_rect_mask(img.size, 30))
    shell.alpha_composite(img, (44, 228))

    right = Image.new("RGBA", (784, 540), PALETTE["paper"])
    right.putalpha(rounded_rect_mask(right.size, 30))
    right_draw = ImageDraw.Draw(right)
    right_draw.rounded_rectangle((0, 0, 784, 172), radius=30, fill=PALETTE["paper_2"], outline=ImageColor.getrgb(PALETTE["line"]), width=2)
    right_draw.text((28, 20), "DESCRIPTION", font=FONT_UI_SM, fill=PALETTE["gold"])
    desc = item["ai_description"]
    if len(desc) > 220:
        desc = desc[:216].rsplit(" ", 1)[0] + "..."
    multiline(right_draw, (28, 58), desc, FONT_UI_SM, PALETTE["ink"], spacing=10)
    right_draw.rounded_rectangle((0, 198, 784, 540), radius=30, fill=PALETTE["paper"], outline=ImageColor.getrgb(PALETTE["line"]), width=2)
    right_draw.text((28, 220), "DETAILS", font=FONT_UI_SM, fill=PALETTE["gold"])
    stats = [
        ("Origin", item.get("ai_structured_fields", {}).get("origin", "Persian")),
        ("Style", item.get("ai_structured_fields", {}).get("style", "Traditional")),
        ("Pattern", " · ".join(item.get("ai_structured_fields", {}).get("pattern", [])[:2]) or "Floral motif"),
        ("Colors", " · ".join(item.get("ai_structured_fields", {}).get("primary_colors", [])[:4]).title()),
        ("Stock ID", item.get("stock_id", "AUTO-XXXX")),
    ]
    y = 264
    for label, value in stats:
        right_draw.text((34, y), label.upper(), font=FONT_UI_SM, fill=PALETTE["muted"])
        right_draw.text((250, y), str(value), font=FONT_UI_SM, fill=PALETTE["ink"])
        y += 52

    shell.alpha_composite(right, (492, 228))
    canvas.alpha_composite(add_shadow(shell, offset=(0, 18), blur=34, color="#6c52353b"), (90, 178))
    return canvas


def make_saved_asset(metadata: list[dict]) -> Image.Image:
    canvas = create_screen_bg((1500, 1100))
    draw = ImageDraw.Draw(canvas)
    draw.text((90, 82), "Customers can save rugs they love", font=FONT_SERIF_MD, fill=PALETTE["ink"])
    draw.text((90, 146), "A simple saved list makes it easier for shoppers to compare, remember, and come back.", font=FONT_UI_MD, fill=PALETTE["muted"])

    screen = Image.new("RGBA", (1320, 820), PALETTE["paper"])
    screen.putalpha(rounded_rect_mask(screen.size, 42))
    screen_draw = ImageDraw.Draw(screen)
    screen_draw.text((42, 36), "Saved rugs", font=FONT_SERIF_MD, fill=PALETTE["ink"])
    screen_draw.text((42, 92), "Shoppers can heart rugs during the conversation and keep a shortlist.", font=FONT_UI_SM, fill=PALETTE["muted"])

    selected = [metadata[2], metadata[6]]
    positions = [(42, 170), (406, 170)]
    for idx, item in enumerate(selected):
        card = rug_card(item, (320, 500), show_heart=True, heart_filled=True)
        screen.alpha_composite(card, positions[idx])

    panel = Image.new("RGBA", (450, 560), "#fbf3e7")
    panel.putalpha(rounded_rect_mask(panel.size, 30))
    panel_draw = ImageDraw.Draw(panel)
    panel_draw.text((34, 34), "Save your list", font=FONT_SERIF_MD, fill=PALETTE["ink"])
    multiline(panel_draw, (34, 100), "Customers can leave their\nname and email to keep the\nshortlist connected to the store.", FONT_UI_SM, PALETTE["muted"], spacing=6)
    for y, label in [(248, "Full name"), (332, "Email address")]:
        panel_draw.text((34, y - 30), label, font=FONT_UI_SM, fill=PALETTE["muted"])
        panel_draw.rounded_rectangle((34, y, 416, y + 56), radius=18, fill=PALETTE["paper"], outline=ImageColor.getrgb(PALETTE["line"]), width=2)
    panel_draw.rounded_rectangle((34, 448, 416, 512), radius=22, fill=PALETTE["gold"])
    panel_draw.text((136, 464), "Save favorites", font=FONT_UI_MD, fill="#241a12")
    screen.alpha_composite(panel, (820, 176))

    canvas.alpha_composite(add_shadow(screen, offset=(0, 18), blur=34, color="#6c52353b"), (90, 220))
    return canvas


def make_follow_up_asset(metadata: list[dict]) -> Image.Image:
    canvas = create_screen_bg((1500, 1100), left_glow=False)
    draw = ImageDraw.Draw(canvas)
    draw.text((92, 82), "Turn saved rugs into follow-up", font=FONT_SERIF_MD, fill=PALETTE["ink"])
    draw.text((92, 146), "When a customer leaves with favorites saved, your staff already knows what caught their eye.", font=FONT_UI_MD, fill=PALETTE["muted"])

    shell = Image.new("RGBA", (1320, 820), PALETTE["paper"])
    shell.putalpha(rounded_rect_mask(shell.size, 42))
    shell_draw = ImageDraw.Draw(shell)

    left = Image.new("RGBA", (420, 720), "#fbf3e7")
    left.putalpha(rounded_rect_mask(left.size, 34))
    left_draw = ImageDraw.Draw(left)
    left_draw.text((28, 26), "Interested customer", font=FONT_UI_LG, fill=PALETTE["ink"])
    left_draw.text((28, 82), "David Rahimi", font=FONT_SERIF_MD, fill=PALETTE["ink"])
    left_draw.text((28, 136), "david@example.com", font=FONT_UI_SM, fill=PALETTE["muted"])
    left_draw.text((28, 172), "(555) 555-0142", font=FONT_UI_SM, fill=PALETTE["muted"])
    draw_chip(left_draw, (28, 232), "3 rugs saved", "#ecf5ef", PALETTE["green"])
    draw_chip(left_draw, (184, 232), "Follow up", "#fff2db", "#8b6b2d")
    left_draw.rounded_rectangle((28, 308, 392, 476), radius=28, fill=PALETTE["paper"], outline=ImageColor.getrgb(PALETTE["line"]), width=2)
    left_draw.text((50, 334), "Showroom note", font=FONT_UI_SM, fill=PALETTE["muted"])
    multiline(left_draw, (50, 376), "Warm-toned Persian pieces\nfor a formal living room.\nWants the shortlist emailed.", FONT_UI_SM, PALETTE["ink"], spacing=6)
    left_draw.rounded_rectangle((28, 520, 392, 664), radius=28, fill=PALETTE["paper"], outline=ImageColor.getrgb(PALETTE["line"]), width=2)
    left_draw.text((50, 548), "Next step", font=FONT_UI_SM, fill=PALETTE["muted"])
    multiline(left_draw, (50, 590), "Send saved rugs and invite\nhim back to compare the\ntwo blue selections in person.", FONT_UI_SM, PALETTE["ink"], spacing=6)

    shell.alpha_composite(left, (36, 50))
    shell_draw.text((500, 42), "Saved rugs", font=FONT_SERIF_MD, fill=PALETTE["ink"])
    shell_draw.text((500, 96), "These favorites can be emailed or reviewed by staff right away.", font=FONT_UI_SM, fill=PALETTE["muted"])
    xs = [500, 820]
    for idx, item in enumerate([metadata[2], metadata[6]]):
        card = rug_card(item, (260, 440), show_heart=True, heart_filled=True)
        shell.alpha_composite(card, (xs[idx], 150))

    canvas.alpha_composite(add_shadow(shell, offset=(0, 18), blur=34, color="#6c52353b"), (90, 220))
    return canvas


def make_hero_asset(device_screen: Image.Image, saved_asset: Image.Image, follow_asset: Image.Image) -> Image.Image:
    canvas = create_screen_bg((1800, 1200))
    draw = ImageDraw.Draw(canvas)
    draw.text((112, 110), "Help customers find\nthe right rug faster.", font=FONT_SERIF_LG, fill=PALETTE["ink"])
    multiline(
        draw,
        (118, 286),
        "Rugdesk helps rug stores show inventory beautifully,\nsave customer favorites, and turn showroom interest into real sales.",
        FONT_UI_LG,
        PALETTE["muted"],
        spacing=14,
    )
    draw_chip(draw, (118, 448), "Simple for staff", "#f5ece0", PALETTE["muted"])
    draw_chip(draw, (336, 448), "Easy for customers", "#f5ece0", PALETTE["muted"])

    inner = ImageOps.fit(device_screen.convert("RGBA"), (760, 990), method=Image.Resampling.LANCZOS)
    framed = device_frame(inner, (820, 1050), radius=48)
    canvas.alpha_composite(framed, (940, 64))

    saved_crop = crop_panel(saved_asset, (810, 176, 1270, 736))
    follow_crop = crop_panel(follow_asset, (130, 248, 520, 718))
    saved_crop = ImageOps.fit(saved_crop, (330, 200), method=Image.Resampling.LANCZOS)
    follow_crop = ImageOps.fit(follow_crop, (300, 220), method=Image.Resampling.LANCZOS)
    saved_crop.putalpha(rounded_rect_mask(saved_crop.size, 30))
    follow_crop.putalpha(rounded_rect_mask(follow_crop.size, 30))
    canvas.alpha_composite(add_shadow(saved_crop, offset=(0, 12), blur=24, color="#6a51353b"), (1324, 796))
    canvas.alpha_composite(add_shadow(follow_crop, offset=(0, 12), blur=24, color="#6a51353b"), (876, 736))

    mini = Image.new("RGBA", (300, 140), PALETTE["paper"])
    mini.putalpha(rounded_rect_mask(mini.size, 28))
    mini_draw = ImageDraw.Draw(mini)
    mini_draw.text((26, 24), "Inventory from photo", font=FONT_UI_LG, fill=PALETTE["ink"])
    mini_draw.text((26, 76), "Clean image, polished listing, ready for the showroom", font=FONT_UI_SM, fill=PALETTE["muted"])
    canvas.alpha_composite(add_shadow(mini, offset=(0, 10), blur=22, color="#6a51353b"), (1120, 602))
    return canvas


def make_process_cards(intake_before: Image.Image, browse_capture: Image.Image, saved_asset: Image.Image, follow_asset: Image.Image) -> dict[str, Image.Image]:
    def frame(source: Image.Image, title: str, accent: str) -> Image.Image:
        canvas = Image.new("RGBA", (960, 640), PALETTE["paper"])
        canvas.putalpha(rounded_rect_mask(canvas.size, 34))
        draw = ImageDraw.Draw(canvas)
        draw.rounded_rectangle((28, 28, 196, 82), radius=24, fill=accent)
        draw.text((50, 42), title, font=FONT_UI_SM, fill=PALETTE["ink"])
        crop = ImageOps.fit(source.convert("RGBA"), (904, 500), method=Image.Resampling.LANCZOS)
        crop.putalpha(rounded_rect_mask(crop.size, 28))
        canvas.alpha_composite(crop, (28, 112))
        return canvas

    return {
        "process-add-rugs": frame(intake_before, "Add rugs", "#fff2db"),
        "process-browse": frame(browse_capture, "Browse naturally", "#f5ece0"),
        "process-save": frame(saved_asset, "Save favorites", "#fff2db"),
        "process-follow-up": frame(follow_asset, "Follow up", "#ecf5ef"),
    }


def make_video(hero: Image.Image, browse: Image.Image, before: Image.Image, after: Image.Image, saved: Image.Image, follow: Image.Image) -> None:
    import numpy as np

    frames = [
        ImageOps.fit(hero.convert("RGB"), (1600, 900), method=Image.Resampling.LANCZOS),
        ImageOps.fit(browse.convert("RGB"), (1600, 900), method=Image.Resampling.LANCZOS),
        ImageOps.fit(before.convert("RGB"), (1600, 900), method=Image.Resampling.LANCZOS),
        ImageOps.fit(after.convert("RGB"), (1600, 900), method=Image.Resampling.LANCZOS),
        ImageOps.fit(saved.convert("RGB"), (1600, 900), method=Image.Resampling.LANCZOS),
        ImageOps.fit(follow.convert("RGB"), (1600, 900), method=Image.Resampling.LANCZOS),
    ]
    poster = frames[0]
    poster.save(MEDIA_ROOT / "video/demo-poster.webp", format="WEBP", quality=92, method=6)

    out_path = str(MEDIA_ROOT / "video/demo-loop.mp4")
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    video = cv2.VideoWriter(out_path, fourcc, 24.0, (1600, 900))

    def simple_bgr(img: Image.Image):
        return cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)

    for idx, frame in enumerate(frames):
        curr = simple_bgr(frame)
        video.write(curr)
        for _ in range(26):
            video.write(curr)
        if idx < len(frames) - 1:
            nxt = simple_bgr(frames[idx + 1])
            for step in range(1, 16):
                alpha = step / 15
                mixed = cv2.addWeighted(curr, 1 - alpha, nxt, alpha, 0)
                video.write(mixed)

    video.release()


def build_assets() -> None:
    ensure_dirs()
    metadata = load_demo_metadata()
    captures = make_product_capture_assets(metadata)
    search_results = make_search_results_asset(metadata)
    intake_before, intake_after = make_inventory_before_after(metadata)
    listing = make_listing_asset(metadata[2])
    detail_asset = make_detail_asset(metadata[9])
    saved = make_saved_asset(metadata)
    follow = make_follow_up_asset(metadata)
    hero = make_hero_asset(search_results, saved, follow)
    process_cards = make_process_cards(intake_before, search_results, saved, follow)

    save_webp(hero, MEDIA_ROOT / "hero/hero-composite.webp")
    save_webp(intake_before, MEDIA_ROOT / "inventory/intake-before.webp")
    save_webp(intake_after, MEDIA_ROOT / "inventory/intake-after.webp")
    save_webp(listing, MEDIA_ROOT / "inventory/listing-result.webp")
    save_webp(captures["browse"], MEDIA_ROOT / "product/browse-capture.webp")
    save_webp(search_results, MEDIA_ROOT / "product/search-results.webp")
    save_webp(detail_asset, MEDIA_ROOT / "product/rug-detail-capture.webp")
    save_webp(saved, MEDIA_ROOT / "product/saved-rugs.webp")
    save_webp(follow, MEDIA_ROOT / "product/follow-up.webp")
    save_webp(captures["attract"], MEDIA_ROOT / "product/attract-mode.webp")
    save_webp(captures["intake"], MEDIA_ROOT / "product/intake-capture.webp")

    for name, asset in process_cards.items():
        save_webp(asset, MEDIA_ROOT / f"process/{name}.webp")

    make_video(hero, search_results, intake_before, intake_after, saved, follow)

    manifest = {
        "hero": "hero/hero-composite.webp",
        "inventory": {
            "before": "inventory/intake-before.webp",
            "after": "inventory/intake-after.webp",
            "listing": "inventory/listing-result.webp",
        },
        "product": {
            "browse": "product/browse-capture.webp",
            "search_results": "product/search-results.webp",
            "detail": "product/rug-detail-capture.webp",
            "saved": "product/saved-rugs.webp",
            "follow_up": "product/follow-up.webp",
            "attract": "product/attract-mode.webp",
            "intake": "product/intake-capture.webp",
        },
        "process": [f"process/{name}.webp" for name in process_cards.keys()],
        "video": {
            "loop": "video/demo-loop.mp4",
            "poster": "video/demo-poster.webp",
        },
    }
    (MEDIA_ROOT / "source/asset-manifest.json").write_text(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    build_assets()
