from pathlib import Path
from PIL import Image, ImageOps, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "IconeAPP.jpeg"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

NAVY = (2, 26, 38, 255)       # #021A26
LIME = (188, 249, 94, 255)    # #BCF95E
WHITE = (255, 255, 255, 255)  # #FFFFFF

# Mantém a arte inteira: não recorta as pontas do símbolo.
original = Image.open(SOURCE).convert("RGBA")
canvas = Image.new("RGBA", (1024, 1024), NAVY)
art = ImageOps.contain(original, (790, 790), method=Image.Resampling.LANCZOS)
canvas.alpha_composite(art, ((1024 - art.width) // 2, (1024 - art.height) // 2))

# Ícone de launcher e foreground adaptativo precisam ser gerados juntos.
# Android usa a zona central segura para aplicar máscaras circulares/arredondadas.
sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
for density, size in sizes.items():
    folder = RES / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon = canvas.resize((size, size), Image.Resampling.LANCZOS).convert("RGB")
    icon.save(folder / "ic_launcher.png", optimize=True)
    icon.save(folder / "ic_launcher_round.png", optimize=True)

    # Foreground com transparência e escala segura; fundo fica no recurso adaptativo.
    foreground = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    foreground.alpha_composite(art, ((1024 - art.width) // 2, (1024 - art.height) // 2))
    foreground.resize((size, size), Image.Resampling.LANCZOS).save(
        folder / "ic_launcher_foreground.png", optimize=True
    )

print("Ícones do JogueAI preparados com margem segura e fundo #021A26.")
