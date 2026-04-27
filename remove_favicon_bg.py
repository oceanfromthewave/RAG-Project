"""
favicon.png 흰색 배경 제거 스크립트
실행: python remove_favicon_bg.py
"""
from PIL import Image
import numpy as np
from pathlib import Path

src = Path(__file__).parent / "frontend" / "public" / "favicon.png"
dst = Path(__file__).parent / "frontend" / "public" / "favicon-transparent.png"

img = Image.open(src).convert("RGBA")
data = np.array(img)

r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]

# 흰색 및 밝은 회색 계열 픽셀 투명 처리
white_mask = (r > 220) & (g > 220) & (b > 220)
data[white_mask, 3] = 0

result = Image.fromarray(data)
result.save(dst, "PNG")
print(f"완료: {dst}")
print(f"제거된 픽셀: {white_mask.sum()}개")
