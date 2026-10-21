from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "IconeAPP.jpeg"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

image = Image.open(SOURCE).convert("RGBA")
square = ImageOps.fit(image, (1024, 1024), method=Image.Resampling.LANCZOS)

# Os XMLs adaptativos do Android usam ic_launcher_foreground.
# Gerar esse arquivo é essencial: trocar apenas ic_launcher.png não altera
# o ícone exibido nos celulares Android modernos.
sizes = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

for density, size in sizes.items():
    folder = RES / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)
    icon = square.resize((size, size), Image.Resampling.LANCZOS)
    icon.save(folder / "ic_launcher.png", optimize=True)
    icon.save(folder / "ic_launcher_round.png", optimize=True)
    icon.save(folder / "ic_launcher_foreground.png", optimize=True)

print("Ícones adaptativos e tradicionais do JogueAI gerados da imagem oficial.")
