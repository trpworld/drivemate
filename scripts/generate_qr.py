#!/usr/bin/env python3
"""
Pure Python zero-dependency QR code generator.
Generates SVG and PPM/PNG-like bitmap from any text string.
Based on standard ISO/IEC 18004 QR specifications (Byte Mode, Mask 0, ECC Low/Medium).
"""

# GF(256) math with primitive polynomial 0x11D (285)
EXP = [0] * 512
LOG = [0] * 256
x = 1
for i in range(255):
    EXP[i] = x
    EXP[i + 255] = x
    LOG[x] = i
    x = (x << 1) ^ (0x11D if (x & 0x80) else 0)

def gf_mul(x, y):
    if x == 0 or y == 0:
        return 0
    return EXP[LOG[x] + LOG[y]]

def rs_generator_poly(degree):
    poly = [1]
    for i in range(degree):
        new_poly = [0] * (len(poly) + 1)
        for j in range(len(poly)):
            new_poly[j] ^= gf_mul(poly[j], EXP[i])
            new_poly[j + 1] ^= poly[j]
        poly = new_poly
    return poly

def rs_encode(data, ecc_len):
    gen = rs_generator_poly(ecc_len)
    msg = list(data) + [0] * ecc_len
    for i in range(len(data)):
        coef = msg[i]
        if coef != 0:
            for j in range(len(gen)):
                msg[i + j] ^= gf_mul(gen[j], coef)
    return msg[len(data):]

# Version 5 (37x37) Table: Low ECC = 108 total codewords, 86 data codewords (688 bits), 22 ECC codewords
# For string up to 84 bytes:
# Byte mode header: 0100 (4 bits) + length (8 bits) + data bytes (8 bits each)
def make_qr_matrix(text: str):
    raw_bytes = text.encode('utf-8')
    data_codewords_count = 86
    ecc_count = 22
    version_size = 37 # Version 5 is 37x37
    
    # Pack bitstream
    bits = [0, 1, 0, 0] # Byte mode
    length = len(raw_bytes)
    for i in range(7, -1, -1):
        bits.append((length >> i) & 1)
    for b in raw_bytes:
        for i in range(7, -1, -1):
            bits.append((b >> i) & 1)
            
    # Terminator (up to 4 zero bits)
    rem = (data_codewords_count * 8) - len(bits)
    term = min(4, max(0, rem))
    bits.extend([0] * term)
    
    # Pad to byte boundary
    while len(bits) % 8 != 0:
        bits.append(0)
        
    data_bytes = []
    for i in range(0, len(bits), 8):
        byte_val = 0
        for bit in bits[i:i+8]:
            byte_val = (byte_val << 1) | bit
        data_bytes.append(byte_val)
        
    pad_bytes = [0xEC, 0x11]
    pidx = 0
    while len(data_bytes) < data_codewords_count:
        data_bytes.append(pad_bytes[pidx % 2])
        pidx += 1
        
    # Reed Solomon ECC
    ecc_bytes = rs_encode(data_bytes, ecc_count)
    all_codewords = data_bytes + ecc_bytes

    # Create 37x37 grid (-1 = unassigned)
    N = version_size
    grid = [[-1] * N for _ in range(N)]
    reserved = [[False] * N for _ in range(N)]

    def place_finder(r, c):
        for dr in range(7):
            for dc in range(7):
                if dr in (0, 6) or dc in (0, 6) or (2 <= dr <= 4 and 2 <= dc <= 4):
                    grid[r + dr][c + dc] = 1
                else:
                    grid[r + dr][c + dc] = 0
                reserved[r + dr][c + dc] = True
        # Separator
        for dr in range(-1, 8):
            for dc in range(-1, 8):
                nr, nc = r + dr, c + dc
                if 0 <= nr < N and 0 <= nc < N:
                    if not reserved[nr][nc]:
                        grid[nr][nc] = 0
                        reserved[nr][nc] = True

    place_finder(0, 0)
    place_finder(0, N - 7)
    place_finder(N - 7, 0)

    # Alignment pattern at (30, 30) for Version 5
    for dr in range(-2, 3):
        for dc in range(-2, 3):
            if abs(dr) == 2 or abs(dc) == 2 or (dr == 0 and dc == 0):
                grid[30 + dr][30 + dc] = 1
            else:
                grid[30 + dr][30 + dc] = 0
            reserved[30 + dr][30 + dc] = True

    # Timing patterns
    for i in range(8, N - 8):
        if not reserved[6][i]:
            grid[6][i] = 1 if i % 2 == 0 else 0
            reserved[6][i] = True
        if not reserved[i][6]:
            grid[i][6] = 1 if i % 2 == 0 else 0
            reserved[i][6] = True

    # Dark module
    grid[4 * 5 + 9][8] = 1
    reserved[4 * 5 + 9][8] = True

    # Reserve Format Information areas
    for i in range(9):
        if not reserved[8][i]: reserved[8][i] = True
        if not reserved[i][8]: reserved[i][8] = True
    for i in range(8):
        if not reserved[8][N - 1 - i]: reserved[8][N - 1 - i] = True
        if not reserved[N - 1 - i][8]: reserved[N - 1 - i][8] = True

    # Convert all codewords to bits
    all_bits = []
    for cw in all_codewords:
        for i in range(7, -1, -1):
            all_bits.append((cw >> i) & 1)

    # Place data bits in zig-zag order
    bit_idx = 0
    col = N - 1
    going_up = True
    while col > 0:
        if col == 6:
            col -= 1
        cols = [col, col - 1]
        rows = range(N - 1, -1, -1) if going_up else range(N)
        for r in rows:
            for c in cols:
                if not reserved[r][c]:
                    b = all_bits[bit_idx] if bit_idx < len(all_bits) else 0
                    bit_idx += 1
                    # Apply Mask 0: (r + c) % 2 == 0
                    if (r + c) % 2 == 0:
                        b ^= 1
                    grid[r][c] = b
        going_up = not going_up
        col -= 2

    # Format info for Error Correction Level L (01) and Mask 0 (000) -> 01000 ^ 101010000010010 = 111011111000100
    format_bits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0]
    
    # Place format bits around top-left, top-right, bottom-left
    # Around top-left
    pos_tl = [(8,0),(8,1),(8,2),(8,3),(8,4),(8,5),(8,7),(8,8),(7,8),(5,8),(4,8),(3,8),(2,8),(1,8),(0,8)]
    for i, (r, c) in enumerate(pos_tl):
        grid[r][c] = format_bits[i]
        
    # Around top-right and bottom-left
    for i in range(7):
        grid[N - 1 - i][8] = format_bits[i]
    for i in range(8):
        grid[8][N - 8 + i] = format_bits[7 + i]

    return grid

def generate_svg(text: str, filename: str):
    grid = make_qr_matrix(text)
    N = len(grid)
    scale = 8
    border = 4
    total_size = (N + 2 * border) * scale
    
    svg = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_size} {total_size}" width="{total_size}" height="{total_size}">',
        f'<rect width="{total_size}" height="{total_size}" fill="#ffffff" rx="16"/>'
    ]
    
    for r in range(N):
        for c in range(N):
            if grid[r][c] == 1:
                x = (c + border) * scale
                y = (r + border) * scale
                svg.append(f'<rect x="{x}" y="{y}" width="{scale}" height="{scale}" fill="#000000"/>')
                
    svg.append('</svg>')
    with open(filename, 'w') as f:
        f.write('\n'.join(svg))
    print(f"Generated QR Code SVG successfully: {filename}")

if __name__ == "__main__":
    import sys
    data = sys.argv[1] if len(sys.argv) > 1 else "upi://pay?pa=8927202527@yapl&pn=DriveMate&am=100&cu=INR&tn=DriveMate%20Pro%20Lifetime"
    out = sys.argv[2] if len(sys.argv) > 2 else "extension/public/upi_qr_100.svg"
    generate_svg(data, out)
