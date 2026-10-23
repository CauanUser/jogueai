from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "IconeAPP.jpeg"
RES = ROOT / "android" / "app" / "src" / "main" / "res"

# Paleta oficial do JogueAI.
NAVY = (2, 26, 38)       # #021A26
LIME = (188, 249, 94)    # #BCF95E

# O arquivo-fonte tem 3200 x 3200 px. Trabalhamos em alta resolução e só
# reduzimos no fim, usando Lanczos, para evitar serrilhado nos tamanhos menores.
original = Image.open(SOURCE).convert("RGB")
if original.width < 1024 or original.height < 1024:
    raise ValueError("IconeAPP.jpeg precisa ter pelo menos 1024 x 1024 px.")

canvas_size = 1024
art_size = 790
art = ImageOps.contain(original, (art_size, art_size), method=Image.Resampling.LANCZOS)

# Ícones tradicionais: fundo sólido e arte centralizada.
canvas = Image.new("RGB", (canvas_size, canvas_size), NAVY)
canvas.paste(art, ((canvas_size - art.width) // 2, (canvas_size - art.height) // 2))

# Foreground adaptativo: retirar o fundo azul-marinho da imagem JPEG para que
# o Android aplique sua própria máscara sem transformar o quadrado inteiro
# em foreground. A transição suave mantém as bordas antialias da marca.
foreground = art.convert("RGBA")
pixels = foreground.load()
for y in range(foreground.height):
    for x in range(foreground.width):
        r, g, b, _ = pixels[x, y]
        distance = max(abs(r - NAVY[0]), abs(g - NAVY[1]), abs(b - NAVY[2]))
        if distance <= 5:
            alpha = 0
        elif distance >= 65:
            alpha = 255
        else:
            alpha = round((distance - 5) * 255 / 60)
        pixels[x, y] = (r, g, b, alpha)

# O foreground de um ícone adaptativo tem 108 dp. Geramos os cinco recursos
# com o tamanho correto por densidade (até 432 px em xxxhdpi).
sizes = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

for density, (icon_size, foreground_size) in sizes.items():
    folder = RES / f"mipmap-{density}"
    folder.mkdir(parents=True, exist_ok=True)

    icon = canvas.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    icon.save(folder / "ic_launcher.png", optimize=True)
    icon.save(folder / "ic_launcher_round.png", optimize=True)

    # Centraliza a marca em um canvas transparente com margem para as máscaras
    # circulares, squircle e outras formas usadas por launchers Android.
    fg_canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    fg_canvas.alpha_composite(foreground, ((canvas_size - foreground.width) // 2,
                                          (canvas_size - foreground.height) // 2))
    fg_canvas.resize((foreground_size, foreground_size), Image.Resampling.LANCZOS).save(
        folder / "ic_launcher_foreground.png", optimize=True
    )

print("Ícones JogueAI gerados: launcher em 48–192 px e foreground adaptativo em 108–432 px.")
