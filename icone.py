# Disegna le icone di MassiDeck (una volta sola; i PNG/ICO sono nel repository)
from PIL import Image, ImageDraw
import os
def icona(n, sfondo=True):
    S = 1024
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if sfondo:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=220, fill=(16, 18, 24, 255))
    colori = [(29,185,84),(43,108,222),(232,112,42),(217,56,56),(138,79,216),(230,168,23)]
    m, g = 170, 52
    lato = (S - 2*m - 2*g) / 3
    alto = (S - 2*m - g) / 2
    for i, c in enumerate(colori):
        x = m + (i % 3) * (lato + g); y = m + (i // 3) * (alto + g) + 40
        h = alto - 60
        ombra = tuple(int(v*0.55) for v in c)
        d.rounded_rectangle([x, y + 26, x + lato, y + h + 26], radius=60, fill=ombra + (255,))
        d.rounded_rectangle([x, y, x + lato, y + h], radius=60, fill=c + (255,))
    return im.resize((n, n), Image.LANCZOS)
os.makedirs("web", exist_ok=True); os.makedirs("icone/android", exist_ok=True)
for n in (192, 512):
    icona(n).save("web/icona-%d.png" % n)
for nome, n in (("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)):
    icona(n).save("icone/android/%s.png" % nome)
icona(256).save("icone/massideck.ico", sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])
